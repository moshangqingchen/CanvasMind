import { describe, expect, it } from "vitest";

import {
  loadDirectorKnowledge,
  parseKnowledgeManifest,
  selectKnowledgeReferences,
} from "../src/knowledge.js";

const HASH = "a".repeat(64);
const manifest = {
  schemaVersion: 1,
  packageName: "AI Super Director",
  contentHash: HASH,
  source: {
    path: "D:/source",
    head: "abc123",
    dirty: true,
    syncedAt: "2026-08-30T00:00:00.000Z",
  },
  skill: { path: "SKILL.md", sha256: HASH },
  routing: { path: "routing.json", sha256: HASH },
  references: [
    {
      id: "core",
      title: "Core contract",
      path: "references/core.md",
      sha256: HASH,
      priority: 1,
      always: true,
      triggers: [],
      tags: [],
    },
    {
      id: "fight",
      title: "Fight direction",
      path: "references/fight.md",
      sha256: HASH,
      priority: 10,
      triggers: ["打斗", "fight"],
      tags: ["action"],
    },
    {
      id: "production",
      title: "Production",
      path: "references/production.md",
      sha256: HASH,
      priority: 20,
      triggers: ["视频", "video"],
      tags: ["generation"],
    },
    {
      id: "dialogue",
      title: "Dialogue",
      path: "references/dialogue.md",
      sha256: HASH,
      priority: 20,
      triggers: ["对白"],
      tags: ["dialogue"],
    },
  ],
  artifacts: [],
};

describe("director knowledge loader", () => {
  it("selects no more than three task-relevant references", () => {
    const parsed = parseKnowledgeManifest(manifest);
    expect(
      selectKnowledgeReferences(parsed, {
        query: "做一段打斗视频",
        tags: ["action"],
        maxReferences: 3,
      }).map((reference) => reference.id),
    ).toEqual(["core", "fight", "production"]);
  });

  it("loads skill, routing, and only selected references with integrity checks", async () => {
    const files = new Map<string, string>([
      ["knowledge/manifest.json", JSON.stringify(manifest)],
      ["knowledge/SKILL.md", "skill"],
      ["knowledge/routing.json", "routing"],
      ["knowledge/references/core.md", "core"],
      ["knowledge/references/fight.md", "fight"],
      ["knowledge/references/production.md", "production"],
      ["knowledge/references/dialogue.md", "dialogue"],
    ]);
    const reads: string[] = [];
    const loaded = await loadDirectorKnowledge(
      {
        async readText(path) {
          reads.push(path);
          const content = files.get(path);
          if (content === undefined) throw new Error(`Missing ${path}`);
          return content;
        },
      },
      "knowledge/manifest.json",
      { query: "fight video", tags: ["action"], maxReferences: 3 },
      async () => HASH,
    );

    expect(loaded.references.map((reference) => reference.id)).toEqual([
      "core",
      "fight",
      "production",
    ]);
    expect(reads).not.toContain("knowledge/references/dialogue.md");
    expect(loaded.skill.content).toBe("skill");
    expect(loaded.routing?.content).toBe("routing");
  });

  it("fails closed when a synchronized document hash changes", async () => {
    await expect(
      loadDirectorKnowledge(
        {
          readText: async (path) =>
            path.endsWith("manifest.json")
              ? JSON.stringify(manifest)
              : "changed",
        },
        "knowledge/manifest.json",
        { query: "unrelated", maxReferences: 1 },
        async () => "b".repeat(64),
      ),
    ).rejects.toThrow("integrity check failed");
  });

  it("rejects traversal paths in manifests", () => {
    expect(() =>
      parseKnowledgeManifest({
        ...manifest,
        skill: { path: "../SKILL.md", sha256: HASH },
      }),
    ).toThrow();
  });
});
