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
  it("conditionally writes task memory and approval against the expected turn and preflight", async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    const repository = new PostgresRepository("postgres://test");
    expect(
      await repository.updateDirectorSession(
        "s",
        { metadata: { activeTurnId: "two" } },
        { expectedTurnId: "one" },
      ),
    ).toBeNull();
    const session = mocks.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE director_session SET"),
    );
    expect(String(session?.[0])).toContain("IS NOT DISTINCT FROM");
    expect(session?.[1]).toContain("one");
    expect(
      await repository.updateDirectorProposal(
        "p",
        { status: "approved" },
        {
          expectedVersion: 1,
          expectedStatuses: ["awaiting_execution"],
          expectedPreflightId: "exact-snapshot",
        },
      ),
    ).toBeNull();
    const proposal = mocks.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE director_proposal SET"),
    );
    expect(String(proposal?.[0])).toContain("plan->'preflight'->>'id'");
    expect(proposal?.[1]).toContain("exact-snapshot");
  });
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
    mocks.client.query.mockImplementation(async (sql: string) => {
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
      return { rows: [] };
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

    const insertCall = mocks.client.query.mock.calls.find(([sql]) =>
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

describe("Postgres supplier transactions", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const supplier = {
    id: "s",
    name: "S",
    supplierKey: "custom",
    siteUrl: "https://example.com",
    apiUrl: "https://example.com/v1",
    kind: "auto" as const,
    catalog: { groups: [] },
    scanStatus: "unscanned" as const,
    state: {
      version: 1 as const,
      revision: 1,
      visibility: "visible" as const,
      sourceId: "one",
      fingerprint: "one",
      history: [],
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  function setup(failWrite = false) {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql === "SELECT * FROM supplier")
        return {
          rows: [
            {
              id: "s",
              name: "S",
              supplier_key: "custom",
              site_url: supplier.siteUrl,
              api_url: supplier.apiUrl,
              kind: "auto",
              catalog: supplier.catalog,
              scan_status: "unscanned",
              state: supplier.state,
              created_at: now,
              updated_at: now,
            },
          ],
        };
      if (sql.startsWith("INSERT INTO supplier") && failWrite)
        throw new Error("simulated disk failure");
      return { rows: [] };
    });
  }
  it("commits the lifecycle in one transaction with a row-version guard", async () => {
    setup();
    const db = new PostgresRepository("postgres://test");
    expect(
      (
        await db.commitSupplier({
          supplier: {
            ...supplier,
            state: { ...supplier.state, revision: 2, visibility: "hidden" },
          },
          expectedRevision: 1,
          expectedConnections: [],
          connections: [],
        })
      ).state?.visibility,
    ).toBe("hidden");
    expect(mocks.client.query.mock.calls.map((c) => c[0])).toContain("COMMIT");
    expect(mocks.client.release).toHaveBeenCalled();
  });
  it("rolls back stale versions and storage failures without writing connection changes", async () => {
    setup();
    const db = new PostgresRepository("postgres://test");
    await expect(
      db.commitSupplier({
        supplier,
        expectedRevision: 0,
        expectedConnections: [],
        connections: [],
      }),
    ).rejects.toThrow();
    expect(
      mocks.client.query.mock.calls.some((c) =>
        String(c[0]).startsWith("INSERT INTO supplier"),
      ),
    ).toBe(false);
    expect(mocks.client.query.mock.calls.map((c) => c[0])).toContain(
      "ROLLBACK",
    );
    setup(true);
    await expect(
      db.commitSupplier({
        supplier,
        expectedRevision: 1,
        expectedConnections: [],
        connections: [],
      }),
    ).rejects.toThrow("simulated disk failure");
    expect(
      mocks.client.query.mock.calls.some((c) =>
        String(c[0]).startsWith("UPDATE provider_connection"),
      ),
    ).toBe(false);
  });
});
