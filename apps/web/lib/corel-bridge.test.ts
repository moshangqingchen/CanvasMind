import { describe, expect, it, vi } from "vitest";
import { corelBridgeAccess, parseCorelBridgeRequest } from "./corel-bridge";

describe("Corel bridge request validation", () => {
  it("accepts a generation request with bounded parameters", async () => {
    const result = await parseCorelBridgeRequest(
      new Request("http://127.0.0.1:3210/api/integrations/corel", {
        method: "POST",
        body: JSON.stringify({
          operation: "image.generate",
          prompt: "  red poster  ",
          parameters: { size: "1024x1024", n: 1, ignored: { secret: true } },
        }),
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompt).toBe("red poster");
      expect(result.data.parameters).toEqual({ size: "1024x1024", n: 1 });
    }
  });

  it("rejects generation without prompt or references", async () => {
    const result = await parseCorelBridgeRequest(
      new Request("http://127.0.0.1:3210/api/integrations/corel", {
        method: "POST",
        body: JSON.stringify({ operation: "image.generate" }),
      }),
    );
    expect(result.success).toBe(false);
  });

  it("requires a reference asset for image editing", async () => {
    const result = await parseCorelBridgeRequest(
      new Request("http://127.0.0.1:3210/api/integrations/corel", {
        method: "POST",
        body: JSON.stringify({ operation: "image.edit", prompt: "change it" }),
      }),
    );
    expect(result.success).toBe(false);
  });

  it("keeps the bridge loopback-only and checks the optional token", () => {
    vi.stubEnv("SUPER_CANVAS_COREL_TOKEN", "bridge-secret");
    expect(
      corelBridgeAccess(
        new Request("http://127.0.0.1:3210/api/integrations/corel"),
      )?.status,
    ).toBe(401);
    expect(
      corelBridgeAccess(
        new Request("http://127.0.0.1:3210/api/integrations/corel", {
          headers: { "x-super-canvas-corel-token": "bridge-secret" },
        }),
      ),
    ).toBeNull();
    expect(
      corelBridgeAccess(
        new Request("http://192.168.1.8:3210/api/integrations/corel", {
          headers: { "x-super-canvas-corel-token": "bridge-secret" },
        }),
      )?.status,
    ).toBe(403);
    vi.unstubAllEnvs();
  });
});
