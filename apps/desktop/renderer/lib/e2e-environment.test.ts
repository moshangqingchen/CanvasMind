import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestEnvironment } from "../e2e/test-environment";

describe("E2E data isolation", () => {
  it("overrides inherited user paths and cleans only its own generated files", async () => {
    const first = await createTestEnvironment("http://127.0.0.1:3211", "test-token", {
      LOCAL_DATABASE_PATH: "user-database.json",
      LOCAL_STORAGE_PATH: "user-storage",
      SUPERCANVAS_PROJECT_ROOT: "user-projects",
      SUPERCANVAS_RECOVERY_ROOT: "user-recovery",
      SUPERCANVAS_REFERENCE_CHANNEL_FILE: "user-reference-channel.json",
      MASTER_KEY: "user-master-key",
      PATH: "preserved-runtime-path",
    });
    const second = await createTestEnvironment("http://127.0.0.1:3212", "other-token", {});
    try {
      expect(first.root).not.toBe(second.root);
      expect(first.env.LOCAL_DATABASE_PATH).toBe(join(first.root, "data", "super-canvas.json"));
      expect(first.env.LOCAL_STORAGE_PATH).toBe(join(first.root, "storage"));
      expect(first.env.SUPERCANVAS_PROJECT_ROOT).toBe(join(first.root, "projects"));
      expect(first.env.SUPERCANVAS_RECOVERY_ROOT).toBe(join(first.root, "data", "artifact-recovery"));
      expect(first.env.SUPERCANVAS_REFERENCE_CHANNEL_FILE).toBe(join(first.root, "reference-channel-status.json"));
      expect(first.env.MASTER_KEY).toBe("e2e-local-master-key");
      expect(first.env).toHaveProperty("PATH", "preserved-runtime-path");
      await mkdir(first.env.SUPERCANVAS_PROJECT_ROOT);
      await writeFile(join(first.env.SUPERCANVAS_PROJECT_ROOT, "test.png"), "fixture");
      await first.cleanup();
      await expect(access(first.root)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(second.root)).resolves.toBeUndefined();
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });
});
