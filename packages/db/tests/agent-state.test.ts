import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/memory.js";
import { FileRepository } from "../src/file.js";
describe("agent task persistence", () => {
  it("rejects stale turn writes without replacing newer memory", async () => {
    const repo = new MemoryRepository();
    await repo.saveCanvas({ id: "c", title: "C", graph: {} });
    await repo.createDirectorSession({
      id: "s",
      canvasId: "c",
      title: "S",
      metadata: { conversationType: "agent-task" },
    });
    expect(
      await repo.updateDirectorSession(
        "s",
        { metadata: { activeTurnId: "one", taskMemory: "first" } },
        { expectedTurnId: null },
      ),
    ).not.toBeNull();
    await repo.updateDirectorSession(
      "s",
      { metadata: { activeTurnId: "two", taskMemory: "new" } },
      { expectedTurnId: "one" },
    );
    expect(
      await repo.updateDirectorSession(
        "s",
        { metadata: { activeTurnId: "one", taskMemory: "stale" } },
        { expectedTurnId: "one" },
      ),
    ).toBeNull();
    expect((await repo.getDirectorSession("s"))?.metadata.taskMemory).toBe(
      "new",
    );
  });
  it("restores new approval states from JSON and keeps old records intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-state-"));
    const path = join(dir, "state.json");
    try {
      const repo = new FileRepository(path);
      await repo.saveCanvas({ id: "c", title: "C", graph: {} });
      await repo.createDirectorSession({
        id: "s",
        canvasId: "c",
        title: "S",
        metadata: { conversationType: "agent-task", activeTurnId: "one" },
      });
      await repo.createDirectorProposal({
        id: "p",
        sessionId: "s",
        canvasId: "c",
        version: 1,
        status: "awaiting_execution",
        baseCanvasRevision: 1,
        plan: {
          schemaVersion: 2,
          mode: "agent",
          prepared: { serverOnly: true },
        },
        quote: {},
        knowledgeVersion: "v1",
        catalogFingerprint: "test",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      const restored = new FileRepository(path);
      expect((await restored.getDirectorProposal("p"))?.status).toBe(
        "awaiting_execution",
      );
      expect(
        await restored.updateDirectorSession(
          "s",
          { title: "stale" },
          { expectedTurnId: "old" },
        ),
      ).toBeNull();
      expect(
        (await new FileRepository(path).getDirectorSession("s"))?.title,
      ).toBe("S");
    } finally {
      if (!resolve(dir).startsWith(resolve(tmpdir())))
        throw new Error("Unexpected test directory");
      await rm(dir, { recursive: true, force: true });
    }
  });
});
