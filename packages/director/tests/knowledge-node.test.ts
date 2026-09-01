import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadDirectorKnowledgeFromFileSystem } from "../src/knowledge-node.js";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("synchronized Super Director knowledge", () => {
  it("loads the audited snapshot and only task-relevant references", async () => {
    const loaded = await loadDirectorKnowledgeFromFileSystem(
      packageRoot,
      "knowledge/manifest.json",
      { query: "生成一段打斗视频", maxReferences: 3 },
    );

    expect(loaded.manifest.source.head).toMatch(/^[a-f0-9]{40}$/u);
    expect(loaded.manifest.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(loaded.references).toHaveLength(3);
    expect(loaded.references.map((reference) => reference.id)).toEqual(
      expect.arrayContaining([
        "core-contract",
        "action-and-fight-direction",
        "production-and-generation",
      ]),
    );
    expect(loaded.skill.content).toContain("AI 超级导演");
    expect(loaded.routing?.content).toContain("schemaVersion");
  });
});
