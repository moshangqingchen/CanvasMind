import { describe, expect, it, vi } from "vitest";
import { OpenAIImageAdapter } from "./openai.js";
import { StaticConnectionResolver } from "./credentials.js";
import type { NormalizedRequest } from "./contracts.js";

describe("FriModel current official Image 2.5 edit contract", () => {
  it.each([
    ["openai_official", "gpt-image-2.5-flare"],
    ["openai_official", "gpt-image-2.5-sunburst"],
    ["openai_official_外接", "gpt-image-2.5-flare"],
    ["openai_official_外接", "gpt-image-2.5-sunburst"],
  ])("keeps %s / %s on the documented multipart route", async (group, model) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).endsWith("/models")) return Response.json({ data: [{ id: model }] });
      if (String(url).endsWith("/images/edits")) return Response.json({ data: [{ b64_json: "ZWRpdGVkLWltYWdl" }] });
      throw new Error(`Unexpected endpoint ${String(url)}`);
    });
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{
      id: "official", provider: "openai", apiKey: "fixture-key", baseUrl: "https://api.frimodel.com/v1",
      settings: { supplierKey: "frimodel", modelGroup: group, scannedModelIds: [model], modelScanStatus: "live" },
    }]), { fetch });
    const descriptor = (await adapter.listModels("official")).find(item => item.id === model);
    expect(descriptor).toMatchObject({ id: model, operations: ["image.generate", "image.edit"], metadata: { modelGroup: group, supportsImageEdit: true } });
    expect(descriptor?.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).not.toContain("max");
    const request: NormalizedRequest = {
      connectionId: "official", operation: "image.edit", model, prompt: "Keep the subject and replace the background.",
      idempotencyKey: `fixture-${encodeURIComponent(group)}-${model}`,
      assets: [{ id: "reference", kind: "image", mimeType: "image/png", filename: "reference.png", data: new Uint8Array([137, 80, 78, 71]) }],
    };
    expect(await adapter.validate(request)).toEqual({ valid: true, issues: [] });
    const task = await adapter.submit(request);
    const submissions = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(submissions).toHaveLength(1);
    const [url, init] = submissions[0]!;
    expect(String(url)).toBe("https://api.frimodel.com/v1/images/edits");
    expect(init?.body).toBeInstanceOf(FormData);
    const body = init?.body as FormData;
    expect(body.get("model")).toBe(model);
    expect(body.get("prompt")).toBe(request.prompt);
    expect(body.get("image")).toBeInstanceOf(File);
    expect(new Headers(init?.headers).get("content-type")).toBeNull();
    expect(body.get("quality")).not.toBe("max");
    expect(Buffer.from((await adapter.extractOutputs(task.result))[0]!.data!).toString()).toBe("edited-image");
  });
});
