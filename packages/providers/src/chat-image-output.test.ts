import { describe, expect, it, vi } from "vitest";
import { chatImageOutputs, chatMediaOutputs } from "./chat-image-output.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { StaticConnectionResolver } from "./credentials.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";
const uri = `data:image/png;base64,${png}`;
const url = "https://images.example/result.png";
const config: RestConnectorConfig = { auth: { type: "bearer" },
  submit: { path: "/v1/chat/completions", method: "POST", bodyMode: "json", idempotent: false,
    template: { stream: false }, mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } },
      { target: "/messages", source: { kind: "openaiMessages", detail: "auto" } },
    ] },
  output: { path: "$.choices[*].message", kind: "image", format: "openai-chat-images" },
};

describe("image-bearing chat output", () => {
  it.each([
    url, `Here is your image: ![result](${url})`, { content: [{ type: "image_url", image_url: { url } }] },
    { images: [{ type: "image_url", image_url: { url } }] }, { content: { parts: [{ file_data: { file_uri: url } }] } },
  ])("extracts declared image content without treating the whole message as a URL: %j", value => {
    expect(chatImageOutputs(value)).toEqual([{ kind: "image", url }]);
  });
  it.each([uri, `![image](${uri})`, { content: [{ type: "image_url", image_url: { url: uri } }] },
    { parts: [{ inline_data: { mime_type: "image/png", data: png } }] }, { image: { b64_json: png, mime_type: "image/png" } },
  ])("decodes the image bytes and MIME type: %j", value => {
    expect(chatImageOutputs(value)).toEqual([{ kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) }]);
  });
  it.each(["Unable to create an image", "[Documentation](https://docs.example/images)", "Learn more at https://docs.example/images",
    "javascript:alert(1)", { text: "no image", refusal: "content filtered" }, { inline_data: { mime_type: "text/plain", data: png } },
  ])("leaves ordinary or rejected content empty: %j", value => expect(chatImageOutputs(value)).toEqual([]));
  it("deduplicates repeated content parts and image representations", () => {
    expect(chatImageOutputs({ content: `![output](${url})`, images: [{ image_url: { url } }, { image_url: { url: uri } }], parts: [{ inlineData: { mimeType: "image/png", data: png } }] })).toHaveLength(2);
  });
  it("submits a single minimal multimodal request and restores the selected output contract", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: `![result](${uri})` } }] }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "chat", provider: "rest", baseUrl: "https://provider.example", apiKey: "fixture-key" }]), { fetch: fetcher, config });
    const task = await adapter.submit({ connectionId: "chat", model: "gpt-image-2.5-flare", operation: "image.edit", prompt: "blue vase", idempotencyKey: "one",
      parameters: { size: "4K", quality: "max" }, assets: [{ id: "ref", kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) }] });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://provider.example/v1/chat/completions");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: "gpt-image-2.5-flare", stream: false,
      messages: [{ role: "user", content: [{ type: "text", text: "blue vase" }, { type: "image_url", image_url: { url: uri, detail: "auto" } }] }] });
    expect(await adapter.extractOutputs(JSON.parse(JSON.stringify(task.result)))).toHaveLength(1);
  });
  it("treats text-only success as an uncertain submission and never sends a second POST", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: "No image generated" }, finish_reason: "content_filter" }] }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "chat", provider: "rest", baseUrl: "https://provider.example", apiKey: "fixture-key" }]), { fetch: fetcher, config });
    await expect(adapter.submit({ connectionId: "chat", model: "gpt-image-2.5-flare", operation: "image.generate", prompt: "blue vase", idempotencyKey: "one" }))
      .rejects.toMatchObject({ details: { kind: "invalid_response", phase: "submit", submissionMayHaveOccurred: true, retryable: false } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("honors per-model native authentication without leaking it into the request body", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: url } }] }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "chat", provider: "rest", baseUrl: "https://provider.example", apiKey: "fixture-key" }]),
      { fetch: fetcher, config: { ...config, modelOverrides: { native: { auth: { type: "header", headerName: "x-goog-api-key" } } } } });
    await adapter.submit({ connectionId: "chat", model: "native", operation: "image.generate", prompt: "blue vase", idempotencyKey: "one" });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("x-goog-api-key")).toBe("fixture-key");
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization")).toBeNull();
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain("fixture-key");
  });
});

describe("image and video chat outputs remain distinct", () => {
  const video = "https://videos.example/result.mp4";
  it.each([video, { video_url: video }, { content: [{ type: "video_url", video_url: { url: video } }] }, `[video](${video})`, `![视频](https://videos.example/download?id=1)`])(
    "extracts video URLs and explicit video Markdown: %j", value => expect(chatMediaOutputs(value, "video")).toEqual([{ kind: "video", url: value === "![视频](https://videos.example/download?id=1)" ? "https://videos.example/download?id=1" : video }]),
  );
  it("decodes only the declared video MIME and rejects image parts on a video route", () => {
    const data = new Uint8Array([0, 0, 0, 24]);
    expect(chatMediaOutputs(`data:video/mp4;base64,${Buffer.from(data).toString("base64")}`, "video")).toEqual([{ kind: "video", mimeType: "video/mp4", data }]);
    expect(chatMediaOutputs({ content: [{ type: "image_url", image_url: { url: uri } }] }, "video")).toEqual([]);
    expect(chatMediaOutputs({ video_url: uri }, "video")).toEqual([]);
    expect(chatMediaOutputs({ content: [{ type: "image", url }] }, "video")).toEqual([]);
    expect(chatMediaOutputs({ content: [{ type: "image_url", url }] }, "video")).toEqual([]);
    expect(chatMediaOutputs({ url, mime_type: "image/png" }, "video")).toEqual([]);
    expect(chatMediaOutputs({ parts: [{ fileData: { fileUri: url, mimeType: "image/png" } }] }, "video")).toEqual([]);
    expect(chatImageOutputs({ content: [{ type: "video", url: video }] })).toEqual([]);
    expect(chatImageOutputs({ parts: [{ file_data: { file_uri: video, mime_type: "video/mp4" } }] })).toEqual([]);
    expect(chatMediaOutputs({ id: "task-not-a-video", content: "Generating, please wait" }, "video")).toEqual([]);
  });
  it("does not accept ordinary chat prose or documentation links as generated videos", () => {
    expect(chatMediaOutputs("[Documentation](https://docs.example/videos)", "video")).toEqual([]);
    expect(chatMediaOutputs("No video; see https://docs.example/videos", "video")).toEqual([]);
  });
  it("blocks synchronous video success without media using the same uncertain-submission contract", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "chat-response", choices: [{ message: { content: "cannot generate video" } }] }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "chat", provider: "rest", baseUrl: "https://provider.example", apiKey: "fixture-key" }]),
      { fetch: fetcher, config: { ...config, output: { path: "$.choices[*].message", kind: "video", format: "openai-chat-videos", defaultMimeType: "video/mp4" } } });
    await expect(adapter.submit({ connectionId: "chat", model: "kling-3.0", operation: "video.generate", prompt: "blue vase", idempotencyKey: "one" }))
      .rejects.toMatchObject({ details: { kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([[], [{ message: { content: "Video is ready" } }]])("uses an actual media fallback when chat choices contain no media: %j", async choices => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices, video_url: video }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "chat", provider: "rest", baseUrl: "https://provider.example", apiKey: "fixture-key" }]),
      { fetch: fetcher, config: { ...config, output: { path: "$.choices[*].message", fallbackPaths: ["$.video_url"], kind: "video", format: "openai-chat-videos" } } });
    const task = await adapter.submit({ connectionId: "chat", model: "kling-3.0", operation: "video.generate", prompt: "blue vase", idempotencyKey: "one" });
    expect(await adapter.extractOutputs(task.result)).toEqual([{ kind: "video", url: video }]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("keeps primary media precedence and ignores text-only fallback fields", async () => {
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([]), { config });
    const output = { path: "$.choices[*].message", fallbackPaths: ["$.image"], kind: "image" as const, format: "openai-chat-images" as const };
    expect(await adapter.extractOutputs({ config: { ...config, output }, remote: { choices: [{ message: { content: `![result](${url})` } }], image: "https://images.example/fallback.png" } }))
      .toEqual([{ kind: "image", url }]);
    expect(await adapter.extractOutputs({ config: { ...config, output }, remote: { choices: [], image: "An image will be generated" } })).toEqual([]);
  });
});
