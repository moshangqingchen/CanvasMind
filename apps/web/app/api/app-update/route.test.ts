import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { handleAppUpdatePost } from "./handler";

describe("application update route", () => {
  let directory = "";
  const originalStatus = process.env.SUPERCANVAS_UPDATE_STATUS_PATH;
  const originalCommand = process.env.SUPERCANVAS_UPDATE_COMMAND_PATH;
  const originalEnabled = process.env.SUPERCANVAS_UPDATE_ENABLED;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "super-canvas-update-route-"));
    process.env.SUPERCANVAS_UPDATE_STATUS_PATH = join(directory, "status.json");
    process.env.SUPERCANVAS_UPDATE_COMMAND_PATH = join(directory, "command.json");
    delete process.env.SUPERCANVAS_UPDATE_ENABLED;
  });

  afterEach(async () => {
    if (originalStatus === undefined) delete process.env.SUPERCANVAS_UPDATE_STATUS_PATH;
    else process.env.SUPERCANVAS_UPDATE_STATUS_PATH = originalStatus;
    if (originalCommand === undefined) delete process.env.SUPERCANVAS_UPDATE_COMMAND_PATH;
    else process.env.SUPERCANVAS_UPDATE_COMMAND_PATH = originalCommand;
    if (originalEnabled === undefined) delete process.env.SUPERCANVAS_UPDATE_ENABLED;
    else process.env.SUPERCANVAS_UPDATE_ENABLED = originalEnabled;
    await rm(directory, { recursive: true, force: true });
  });

  it("returns a cache-free status envelope", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ enabled: true, phase: "idle" });
  });

  it("does not expose stale update actions while disabled", async () => {
    process.env.SUPERCANVAS_UPDATE_ENABLED = "false";
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: false,
      phase: "disabled",
    });
  });

  it("accepts only supported update actions", async () => {
    const invalid = await POST(
      new Request("http://127.0.0.1:3210/api/app-update", {
        method: "POST",
        body: JSON.stringify({ action: "restart" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(invalid.status).toBe(400);

    const accepted = await POST(
      new Request("http://127.0.0.1:3210/api/app-update", {
        method: "POST",
        body: JSON.stringify({ action: "check" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({ ok: true, action: "check" });
  });

  it("rejects cross-origin writes even when local auth is disabled", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3210/api/app-update", {
        method: "POST",
        body: JSON.stringify({ action: "apply" }),
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects malformed command versions", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3210/api/app-update", {
        method: "POST",
        body: JSON.stringify({ action: "defer", version: "v0.2.0" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("supports action-specific POST endpoints", async () => {
    const response = await handleAppUpdatePost(
      new Request("http://127.0.0.1:3210/api/app-update/check", {
        method: "POST",
      }),
      "check",
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, action: "check" });
  });
});
