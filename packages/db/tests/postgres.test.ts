import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    client,
    connect: vi.fn(async () => client),
    poolQuery: vi.fn(async () => ({ rows: [{ ok: 1 }] })),
  };
});

vi.mock("pg", () => ({
  Pool: class {
    query = mocks.poolQuery;
    connect = mocks.connect;
  },
}));

import { PostgresRepository } from "../src/postgres.js";
import { CanvasRevisionConflictError } from "../src/types.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.poolQuery.mockResolvedValue({ rows: [{ ok: 1 }] });
});

describe("PostgresRepository canvas revision guard", () => {
  it("updates or creates through one conditional statement", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("WITH updated AS")) {
        return {
          rows: [
            {
              id: "canvas-1",
              title: "Canvas",
              graph: { version: "accepted" },
              revision: 3,
              created_at: new Date("2026-01-01T00:00:00.000Z"),
              updated_at: new Date("2026-01-01T00:00:01.000Z"),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repository = new PostgresRepository("postgres://test");

    await expect(
      repository.saveCanvas({
        id: "canvas-1",
        title: "Canvas",
        graph: { version: "accepted" },
        expectedRevision: 2,
      }),
    ).resolves.toMatchObject({ revision: 3 });

    const conditionalCall = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("WITH updated AS"),
    );
    expect(String(conditionalCall?.[0])).toContain(
      "WHERE id=$1 AND revision=$5",
    );
    expect(String(conditionalCall?.[0])).toContain("WHERE $5=0");
    expect(String(conditionalCall?.[0])).toContain(
      "ON CONFLICT(id) DO NOTHING",
    );
    expect(conditionalCall?.[1]).toEqual([
      "canvas-1",
      "Canvas",
      JSON.stringify({ version: "accepted" }),
      expect.any(Date),
      2,
    ]);
    expect(mocks.client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("rolls back and reports the latest revision after a conditional miss", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT revision FROM canvas")) {
        return { rows: [{ revision: 5 }] };
      }
      return { rows: [] };
    });
    const repository = new PostgresRepository("postgres://test");

    const error = await repository
      .saveCanvas({
        id: "canvas-1",
        graph: { version: "stale" },
        expectedRevision: 3,
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(CanvasRevisionConflictError);
    expect(error).toMatchObject({
      expectedRevision: 3,
      currentRevision: 5,
    });
    expect(mocks.client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.client.release).toHaveBeenCalledOnce();
    expect(
      mocks.client.query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO canvas_revision"),
      ),
    ).toBe(false);
  });
});

describe("PostgresRepository director persistence", () => {
  it("uses proposal version and status as compare-and-set guards", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE director_proposal")) {
        return {
          rows: [
            {
              id: "proposal-1",
              session_id: "session-1",
              canvas_id: "canvas-1",
              version: 1,
              status: "approved",
              base_canvas_revision: 2,
              plan: { nodes: [] },
              quote: { maximum: 3 },
              knowledge_version: "knowledge-1",
              catalog_fingerprint: "catalog-1",
              expires_at: new Date("2026-08-30T12:15:00.000Z"),
              workflow_run_id: "run-1",
              created_at: new Date("2026-08-30T12:00:00.000Z"),
              updated_at: new Date("2026-08-30T12:01:00.000Z"),
            },
          ],
        };
      }
      return { rows: [{ ok: 1 }] };
    });
    const repository = new PostgresRepository("postgres://test");

    await expect(
      repository.updateDirectorProposal(
        "proposal-1",
        { status: "approved", workflowRunId: "run-1" },
        { expectedVersion: 1, expectedStatuses: ["awaiting_approval"] },
      ),
    ).resolves.toMatchObject({
      id: "proposal-1",
      status: "approved",
      workflowRunId: "run-1",
    });

    const updateCall = mocks.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE director_proposal"),
    );
    expect(String(updateCall?.[0])).toContain("version=$4");
    expect(String(updateCall?.[0])).toContain("status=ANY($5::text[])");
    expect(updateCall?.[1]).toEqual([
      "proposal-1",
      "approved",
      "run-1",
      1,
      ["awaiting_approval"],
    ]);
  });

  it("stores explicit run node ids in jsonb", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO workflow_run")) {
        return {
          rows: [
            {
              id: "run-1",
              canvas_id: "canvas-1",
              client_request_id: "request-1",
              scope: "selection",
              node_id: null,
              node_ids: ["image", "video"],
              status: "queued",
              revision_graph: {},
              created_at: new Date("2026-08-30T12:00:00.000Z"),
              updated_at: new Date("2026-08-30T12:00:00.000Z"),
            },
          ],
        };
      }
      return { rows: [{ ok: 1 }] };
    });
    const repository = new PostgresRepository("postgres://test");

    await expect(
      repository.createRun({
        id: "run-1",
        canvasId: "canvas-1",
        clientRequestId: "request-1",
        scope: "selection",
        nodeIds: ["image", "video"],
        status: "queued",
        revisionGraph: {},
      }),
    ).resolves.toMatchObject({ nodeIds: ["image", "video"] });

    const insertCall = mocks.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO workflow_run"),
    );
    expect(String(insertCall?.[0])).toContain("node_ids");
    expect(insertCall?.[1]).toEqual([
      "run-1",
      "canvas-1",
      "request-1",
      "selection",
      null,
      JSON.stringify(["image", "video"]),
      "queued",
      JSON.stringify({}),
      expect.any(Date),
    ]);
  });
});
