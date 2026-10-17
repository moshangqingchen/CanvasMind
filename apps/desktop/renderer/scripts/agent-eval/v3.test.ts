import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V3_EVALUATION_CASES } from "./cases-v3";
import { removeIsolatedCredentials } from "./cleanup";
import { EVALUATION_TEMP, assertInside } from "./paths";

describe("stage three evaluation boundaries", () => {
  it("keeps the same five auto messages and explicit legacy baseline mapping", () => {
    expect(V3_EVALUATION_CASES).toHaveLength(5);
    expect(new Set(V3_EVALUATION_CASES.map(item => item.id)).size).toBe(5);
    expect(V3_EVALUATION_CASES.every(item => item.intent === "auto" && item.baselineIntent && item.checks.length)).toBe(true);
    expect(V3_EVALUATION_CASES.find(item => item.id.includes("injection"))?.selectedText).toContain("供应商Key");
  });
  it("deletes plaintext, encrypted copies and Local State without touching historical locks", () => {
    mkdirSync(EVALUATION_TEMP, { recursive: true });
    const root = mkdtempSync(join(EVALUATION_TEMP, "cleanup-test-"));
    try {
      mkdirSync(join(root, "snapshot"));
      for (const name of ["source.secret.json", "snapshot/profile-key.dpapi.bin", "snapshot/Local State", "snapshot/Local State.bak", "source-read-once.json", "capture-checkpoint.json"])
        writeFileSync(join(root, name), "fixture only");
      expect(removeIsolatedCredentials(root)).toEqual(["snapshot/Local State", "snapshot/Local State.bak", "snapshot/profile-key.dpapi.bin", "source.secret.json"]);
      expect(existsSync(join(root, "source-read-once.json"))).toBe(true);
      expect(existsSync(join(root, "capture-checkpoint.json"))).toBe(true);
      expect(removeIsolatedCredentials(root)).toEqual([]);
    } finally { rmSync(assertInside(EVALUATION_TEMP, root), { recursive: true, force: true }); }
  });
});
