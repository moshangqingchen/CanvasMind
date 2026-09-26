import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DirectorAdapterInput,
  ResolvedDirectorConnection,
} from "@super-canvas/director";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  getAsset: vi.fn(),
  head: vi.fn(),
  getObject: vi.fn(),
  complete: vi.fn(),
}));
vi.mock("../../../../lib/agent-models", () => ({
  resolveAgentModel: mocks.resolve,
}));
vi.mock("../../../../lib/server", () => ({
  repository: { getAsset: mocks.getAsset },
  storage: { head: mocks.head, get: mocks.getObject },
}));
vi.mock("../../../../lib/director-adapters", () => ({
  directorAdapterRegistry: { get: () => ({ complete: mocks.complete }) },
  DirectorAdapterError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly options?: { status?: number },
    ) {
      super(message);
    }
    get status() {
      return this.options?.status;
    }
  },
}));

import { POST } from "./route";
import { DirectorAdapterError } from "../../../../lib/director-adapters";

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);
const fields = {
  headline: "新店活动",
  subheadline: "",
  body: "",
  eventDate: "9月20日",
  location: "",
  callToAction: "",
  brandName: "",
  constraints: "",
};
const connection: ResolvedDirectorConnection = {
  id: "chosen-connection",
  name: "提取模型",
  provider: "rest",
  supplier: "example",
  baseUrl: "https://private.example.invalid/v1",
  protocol: "openai-chat-completions",
  model: "chosen-model",
  enabled: true,
  apiKey: "private-api-key",
  capabilities: {
    text: true,
    imageInput: true,
    audioInput: false,
    videoInput: false,
    structuredOutput: true,
    toolCalling: true,
    nativeWebSearch: true,
    reasoning: false,
  },
};
function output(
  images: Array<{ assetId: string; text: string; warnings: string[] }> = [],
) {
  return {
    type: "graphic-design-extraction",
    images,
    fields,
    warnings: [],
    complete: true,
  };
}
const baseRequest = {
  text: "新店活动 9月20日",
  imageAssetIds: [],
  connectionId: "chosen-connection",
  modelId: "chosen-model",
};
function post(body: unknown, signal?: AbortSignal) {
  return POST(
    new Request("http://localhost/api/graphic-design/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue(connection);
  mocks.getAsset.mockImplementation(async (id: string) => ({
    id,
    name: "客户资料.png",
    kind: "image",
    mimeType: "image/png",
    size: png.byteLength,
    storageKey: `assets/${id}/original.png`,
    deleted: false,
  }));
  mocks.head.mockResolvedValue({
    size: png.byteLength,
    contentType: "image/png",
  });
  mocks.getObject.mockResolvedValue({ bytes: png, contentType: "image/png" });
  mocks.complete.mockResolvedValue({ output: output(), sources: [] });
});

describe("POST /api/graphic-design/extract", () => {
  it("preserves every source character through transport and response, including repeated lines", async () => {
    const text =
      "  客户要求\r\n报名：010-12345678\n报名：010-12345678\n票价 99.00 元\t\n";
    const response = await post({ ...baseRequest, text });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.sourceText).toBe(text);
    expect(result.fields).toEqual(fields);
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
      "chosen-connection",
      "chosen-model",
    );
    const [usedConnection, input] = mocks.complete.mock.calls[0] as [
      ResolvedDirectorConnection,
      DirectorAdapterInput,
    ];
    expect(JSON.parse(input.messages[0]!.content)).toEqual({
      sourceText: text,
      imageAssetIds: [],
    });
    expect(usedConnection.capabilities.toolCalling).toBe(false);
    expect(usedConnection.capabilities.nativeWebSearch).toBe(false);
    expect(input.useNativeSearch).toBe(false);
    expect(input.system).toContain("不得精简、删减、润色、去重");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("reads actual stored bytes for each image and returns complete OCR in requested order", async () => {
    const firstText = "99.00 元\n热线 010-12345678\n热线 010-12345678";
    mocks.complete.mockResolvedValue({
      output: output([
        { assetId: "image-b", text: "地址：虹桥路 101 号", warnings: [] },
        { assetId: "image-a", text: firstText, warnings: [] },
      ]),
      sources: [],
    });
    const response = await post({
      ...baseRequest,
      text: "",
      imageAssetIds: ["image-a", "image-b"],
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.sourceText).toBe("");
    expect(result.images).toEqual([
      { assetId: "image-a", text: firstText, warnings: [] },
      { assetId: "image-b", text: "地址：虹桥路 101 号", warnings: [] },
    ]);
    expect(result.warnings.join(" ")).toContain("逐张对照原图核对");
    const input = mocks.complete.mock.calls[0]![1] as DirectorAdapterInput;
    expect(input.attachments).toHaveLength(2);
    expect(input.attachments?.[0]?.url).toBe(
      `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    );
    expect(input.attachments?.[0]?.name).toContain("image-a");
    expect(mocks.getObject).toHaveBeenNthCalledWith(
      1,
      "assets/image-a/original.png",
    );
  });

  it.each([
    { ...baseRequest, text: "字".repeat(60_001) },
    { ...baseRequest, text: "   " },
    { ...baseRequest, imageAssetIds: ["same", "same"] },
    { ...baseRequest, imageAssetIds: ["1", "2", "3", "4", "5"] },
    { ...baseRequest, imageUrls: ["https://private.invalid/secret"] },
    { ...baseRequest, modelId: "" },
  ])(
    "rejects invalid input without truncating or calling a model: %#",
    async (body) => {
      expect((await post(body)).status).toBe(400);
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.complete).not.toHaveBeenCalled();
    },
  );

  it("rejects a request exceeding the transport limit before parsing it", async () => {
    const request = new Request("http://localhost/api/graphic-design/extract", {
      method: "POST",
      body: " ".repeat(512 * 1024 + 1),
    });
    expect((await POST(request)).status).toBe(413);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("requires the explicitly selected configured model without fallback or private error details", async () => {
    mocks.resolve.mockRejectedValue(
      new Error("private-api-key private.example.invalid decrypt failure"),
    );
    const response = await post(baseRequest);
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("不会自动切换模型");
    expect(body).not.toContain("private");
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("blocks images on a model without configured vision before reading or sending them", async () => {
    mocks.resolve.mockResolvedValue({
      ...connection,
      capabilities: { ...connection.capabilities, imageInput: false },
    });
    const response = await post({ ...baseRequest, imageAssetIds: ["image-a"] });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("未配置识图能力");
    expect(mocks.getAsset).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each([null, { id: "image-a", deleted: true }])(
    "rejects missing/deleted images before a model call",
    async (asset) => {
      mocks.getAsset.mockResolvedValue(asset);
      expect(
        (await post({ ...baseRequest, imageAssetIds: ["image-a"] })).status,
      ).toBe(404);
      expect(mocks.complete).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized storage objects before loading their bytes", async () => {
    mocks.head.mockResolvedValue({
      size: 10 * 1024 * 1024 + 1,
      contentType: "image/png",
    });
    expect(
      (await post({ ...baseRequest, imageAssetIds: ["image-a"] })).status,
    ).toBe(413);
    expect(mocks.getObject).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("rejects changed or truncated image data rather than silently omitting the image", async () => {
    mocks.getObject.mockResolvedValue({
      bytes: png.slice(0, 8),
      contentType: "image/png",
    });
    expect(
      (await post({ ...baseRequest, imageAssetIds: ["image-a"] })).status,
    ).toBe(422);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each([
    {
      type: "reply",
      message: '{"type":"graphic-design-extraction","images":[',
    },
    { ...output(), complete: false },
    { ...output(), complete: undefined },
    { ...output(), fields: { headline: "short summary only" } },
    { ...output(), extra: "ignored content" },
  ])(
    "rejects incomplete or invalid model JSON rather than accepting a partial extraction: %#",
    async (value) => {
      mocks.complete.mockResolvedValue({ output: value, sources: [] });
      const response = await post(baseRequest);
      expect(response.status).toBe(502);
      expect(await response.text()).toContain("完整有效");
    },
  );

  it.each([
    { images: [] },
    { images: [{ assetId: "image-other", text: "错误对应", warnings: [] }] },
    {
      images: [
        { assetId: "image-a", text: "一", warnings: [] },
        { assetId: "image-a", text: "二", warnings: [] },
      ],
    },
    { images: [{ assetId: "image-a", text: "", warnings: [] }] },
  ])(
    "rejects missing, duplicate, unknown or unexplained empty OCR: %#",
    async ({ images }) => {
      mocks.complete.mockResolvedValue({ output: output(images), sources: [] });
      expect(
        (await post({ ...baseRequest, imageAssetIds: ["image-a"] })).status,
      ).toBe(502);
    },
  );

  it("keeps uncertainty visible instead of inventing illegible characters", async () => {
    mocks.complete.mockResolvedValue({
      output: output([
        {
          assetId: "image-a",
          text: "电话：【无法辨认：右下角号码】",
          warnings: ["右下角电话号码太小，需核对"],
        },
      ]),
      sources: [],
    });
    const response = await post({ ...baseRequest, imageAssetIds: ["image-a"] });
    expect(response.status).toBe(200);
    expect((await response.json()).images[0].warnings).toEqual([
      "右下角电话号码太小，需核对",
    ]);
  });

  it("returns a safe provider failure without leaking upstream messages or credentials", async () => {
    mocks.complete.mockRejectedValue(
      new DirectorAdapterError(
        "upstream",
        "secret private-api-key customer-text https://private.invalid",
        { status: 401 },
      ),
    );
    const response = await post(baseRequest);
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("鉴权失败");
    expect(body).not.toMatch(/private|secret|customer-text/u);
  });

  it("propagates cancellation and never applies the model result after cancellation", async () => {
    const controller = new AbortController();
    mocks.complete.mockImplementation(
      async (_connection, input: DirectorAdapterInput) => {
        controller.abort();
        expect(input.signal?.aborted).toBe(true);
        return { output: output(), sources: [] };
      },
    );
    const response = await post(baseRequest, controller.signal);
    expect(response.status).toBe(499);
    expect(await response.text()).toContain("已取消");
  });
});
