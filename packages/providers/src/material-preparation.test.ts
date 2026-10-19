import { describe, expect, it, vi } from "vitest";
import { MaterialPreparationError, prepareMaterial } from "./material-preparation.js";
import { ProviderHttpError } from "./http.js";
import { presentProviderError } from "./error-presentation.js";
import { uploadJiasuMedia } from "./jiasu-media.js";
import { uploadCangyuanMedia } from "./cangyuan-media-upload.server.js";
import { uploadTemporaryReferenceImages } from "./reference-image-hosting.js";
import type { FetchImplementation } from "./contracts.js";

// Even endpoint safety checks must not resolve actual supplier hosts in this fixture.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.1", family: 4 }]) }));

const asset = { id: "original", kind: "image" as const, mimeType: "image/png", data: new Uint8Array([1, 2, 3, 255]) };
const context = { provider: "rest", operation: "image.edit" as const };

describe("free material preparation errors", () => {
  it("retains sanitized HTTP diagnostics without granting paid-request retries", async () => {
    const cause = new ProviderHttpError("fetch failed https://cdn.test/a?token=private-token", {
      kind: "network", phase: "prepare", retryable: true, submissionMayHaveOccurred: false,
      status: 503, responseBody: { error: { message: "Bearer private-token https://cdn.test/a?signature=private-signature" } },
      transport: { elapsedMs: 10, stage: "awaiting_headers", responseBytes: 0 },
    });
    const error = await prepareMaterial("upload", async () => { throw cause; }).catch(value => value);
    expect(error).toBeInstanceOf(MaterialPreparationError);
    expect(error).not.toBeInstanceOf(ProviderHttpError);
    expect(error.cause).toBe(cause);
    expect(error).not.toHaveProperty("requestNotSent");
    const presentation = presentProviderError(error, context);
    expect(presentation).toMatchObject({ message: expect.stringContaining("素材准备失败，尚未提交生成"),
      code: "MATERIAL_PREPARATION_FAILED", materialPreparationStage: "upload", phase: "prepare", statusCode: 503,
      retryable: false, submissionMayHaveOccurred: false, charge: { status: "not_charged", source: "not_submitted" },
      transport: { elapsedMs: 10 } });
    expect(JSON.stringify(presentation)).not.toMatch(/private-token|private-signature/);
  });

  it.each(["initialize", "upload"] as const)("does not generate after a Jiasu %s timeout", async stage => {
    const fetch = vi.fn<FetchImplementation>(async (_url, init) => {
      if (stage === "initialize" || init?.method === "PUT") throw new DOMException("private signed URL must stay private", "TimeoutError");
      return Response.json({ success: true, data: { items: [{ url: "https://cdn.test/original.png", put: { url: "https://storage.test/put", method: "PUT" } }] } });
    });
    const error = await uploadJiasuMedia({ id: "fixture", provider: "rest", baseUrl: "https://ai.jiasuapi.com/v1", apiKey: "fixture-key" }, [asset], { fetch }).catch(value => value);
    expect(error).toBeInstanceOf(MaterialPreparationError);
    expect(error.stage).toBe(stage);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/images/create"))).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(stage === "initialize" ? 1 : 2);
    expect(presentProviderError(error, context)).toMatchObject({ charge: { source: "not_submitted" }, retryable: false });
  });

  it.each(["sign", "upload"] as const)("does not generate after a Cangyuan %s failure", async stage => {
    const fetch = vi.fn<FetchImplementation>(async (_url, init) => {
      if (stage === "sign" || init?.method === "PUT") return new Response("unavailable", { status: 503 });
      return Response.json({ upload_url: "https://storage.test/put", url: "https://cdn.test/original.png", expires_in: 900, headers: {} });
    });
    const error = await uploadCangyuanMedia({ id: "fixture", provider: "rest", baseUrl: "https://ai.cangyuansuanli.cn/v1", apiKey: "fixture-key" }, [asset], { fetch }).catch(value => value);
    expect(error).toBeInstanceOf(MaterialPreparationError);
    expect(error.stage).toBe(stage);
    expect(fetch.mock.calls.filter(([url]) => /\/images\/(?:edits|generations)$/u.test(String(url)))).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(stage === "sign" ? 1 : 2);
    expect(presentProviderError(error, context)).toMatchObject({ phase: "prepare", statusCode: 503, charge: { source: "not_submitted" } });
  });

  it("preserves a hosting failure's HTTP status without leaking its response", async () => {
    const fetch = vi.fn<FetchImplementation>(async () => Response.json({ error: { message: "Bearer private-token" } }, { status: 503 }));
    const error = await uploadTemporaryReferenceImages([asset], fetch).catch(value => value);
    expect(error).toBeInstanceOf(MaterialPreparationError);
    expect(fetch).toHaveBeenCalledOnce();
    expect(presentProviderError(error, context)).toMatchObject({ statusCode: 503, phase: "prepare", charge: { source: "not_submitted" } });
    expect(JSON.stringify(presentProviderError(error, context))).not.toContain("private-token");
  });
  it.each(["jiasu", "cangyuan"] as const)("keeps a null %s upload receipt inside the unpaid preparation boundary", async supplier => {
    const fetch = vi.fn<FetchImplementation>(async () => Response.json(null));
    const connection = { id: "fixture", provider: "rest", apiKey: "synthetic-key", baseUrl: supplier === "jiasu" ? "https://ai.jiasuapi.com/v1" : "https://ai.cangyuansuanli.cn/v1" };
    const error = await (supplier === "jiasu" ? uploadJiasuMedia(connection, [asset], { fetch }) : uploadCangyuanMedia(connection, [asset], { fetch })).catch(value => value);
    expect(error).toBeInstanceOf(MaterialPreparationError);
    expect(fetch).toHaveBeenCalledOnce();
    expect(presentProviderError(error, context)).toMatchObject({ code: "MATERIAL_PREPARATION_FAILED", charge: { source: "not_submitted" } });
  });
});
