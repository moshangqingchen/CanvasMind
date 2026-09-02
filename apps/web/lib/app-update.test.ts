import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultUpdateStatus,
  compareAppVersions,
  isValidAppVersion,
  normalizeUpdateStatus,
  readUpdateStatus,
  updateManagerAvailable,
  validateReleaseManifest,
  writeUpdateCommand,
} from "./app-update";

const envKeys = [
  "SUPERCANVAS_UPDATE_ENABLED",
  "SUPERCANVAS_UPDATE_REPOSITORY",
  "SUPERCANVAS_UPDATE_INTERVAL_SECONDS",
  "SUPERCANVAS_UPDATE_STATUS_PATH",
  "SUPERCANVAS_UPDATE_COMMAND_PATH",
] as const;

describe("application update protocol", () => {
  let directory = "";
  const original = new Map<string, string | undefined>();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "super-canvas-update-"));
    for (const key of envKeys) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.SUPERCANVAS_UPDATE_STATUS_PATH = join(directory, "status.json");
    process.env.SUPERCANVAS_UPDATE_COMMAND_PATH = join(directory, "command.json");
  });

  afterEach(async () => {
    for (const key of envKeys) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  it("falls back to a safe idle status when the manager has not written one", async () => {
    const status = await readUpdateStatus();
    expect(status).toMatchObject({ formatVersion: 1, phase: "idle" });
    expect(status.currentVersion).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(defaultUpdateStatus().formatVersion).toBe(1);
  });

  it("reads status files written with a UTF-8 BOM", async () => {
    await writeFile(
      join(directory, "status.json"),
      `\uFEFF${JSON.stringify({
        formatVersion: 1,
        currentVersion: "0.2.6",
        phase: "available",
        latest: { version: "0.2.7", tag: "v0.2.7" },
        updatedAt: "2026-09-02T00:00:00.000Z",
      })}`,
      "utf8",
    );
    await expect(readUpdateStatus()).resolves.toMatchObject({
      phase: "available",
      currentVersion: "0.2.6",
      latest: { version: "0.2.7" },
    });
  });

  it("reports manager availability from a fresh heartbeat", async () => {
    await writeFile(
      join(directory, "status.json"),
      JSON.stringify({
        formatVersion: 1,
        currentVersion: "0.2.6",
        phase: "idle",
        managerPid: process.pid,
        managerHeartbeatAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      "utf8",
    );
    await expect(updateManagerAvailable()).resolves.toBe(true);

    await writeFile(
      join(directory, "status.json"),
      JSON.stringify({
        formatVersion: 1,
        currentVersion: "0.2.6",
        phase: "idle",
        managerPid: process.pid,
        managerHeartbeatAt: new Date(Date.now() - 180_000).toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      "utf8",
    );
    await expect(updateManagerAvailable()).resolves.toBe(false);
  });

  it("normalizes untrusted manager status and release notes", () => {
    const status = normalizeUpdateStatus({
      currentVersion: "0.1.0",
      phase: "available",
      latest: {
        version: "0.2.0",
        tag: "v0.2.0",
        notes: "<script>alert(1)</script>",
        htmlUrl: "javascript:alert(1)",
      },
      progress: { downloadedBytes: 12.8, totalBytes: -2 },
    });
    expect(status.phase).toBe("available");
    expect(status.latest?.notes).toBe("<script>alert(1)</script>");
    expect(status.latest?.htmlUrl).toBeUndefined();
    expect(status.progress).toEqual({ downloadedBytes: 12 });
  });

  it("writes a single atomic command envelope", async () => {
    const command = await writeUpdateCommand("download", "0.2.0");
    const stored = JSON.parse(await readFile(join(directory, "command.json"), "utf8"));
    expect(stored).toMatchObject({
      id: command.id,
      action: "download",
      version: "0.2.0",
    });
  });

  it("compares SemVer releases and validates the signed manifest shape", () => {
    expect(isValidAppVersion("0.2.0")).toBe(true);
    expect(isValidAppVersion("v0.2.0")).toBe(false);
    expect(compareAppVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareAppVersions("1.0.0-beta", "1.0.0")).toBe(-1);
    expect(
      validateReleaseManifest(
        {
          formatVersion: 1,
          app: "super-canvas",
          version: "0.2.0",
          tag: "v0.2.0",
          assetName: "super-canvas-v0.2.0-windows-x64.zip",
          assetSha256: "a".repeat(64),
        },
        {
          version: "0.2.0",
          tag: "v0.2.0",
          assetName: "super-canvas-v0.2.0-windows-x64.zip",
        },
      ),
    ).toBe(true);
    expect(
      validateReleaseManifest({
        formatVersion: 1,
        app: "other-app",
        version: "0.2.0",
        tag: "v0.2.0",
      }),
    ).toBe(false);
  });
});
