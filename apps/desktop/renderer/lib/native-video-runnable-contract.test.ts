import { describe, expect, it, vi } from "vitest";
import {
  AutoInterfaceAdapter, OpenAIImageAdapter, StaticConnectionResolver, remainingVideoModel, remainingVideoTransport,
  type DocumentedModelInterface, type ModelDescriptor, type ProviderAdapter, type ProviderOperation,
} from "@super-canvas/providers";
import { guardNativeVideoRunnableContract } from "./native-video-runnable-contract";

const video = (id = "future-video-without-contract"): ModelDescriptor => ({
  id, name: id, operations: ["video.generate", "video.image-to-video"], outputKinds: ["video"],
  metadata: { canvasRunnable: true, operationsSource: "inferred", priceLabel: "¥0.2/请求" },
});
const mikoto = { provider: "openai", config: { baseUrl: "https://api.mikoto.vip", modelGroup: "grok heavy" } };
const binding = (model: ModelDescriptor): DocumentedModelInterface => ({ model,
  sourceUrl: "https://api.mikoto.vip/docs/video", connector: { submit: { path: "/v1/videos", method: "POST", bodyMode: "json",
    mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/prompt", source: { kind: "request", path: "$.prompt" } }] },
  output: { kind: "video", path: "$.video_url" } },
});

async function runtimeValidation(config: Record<string, unknown>, model: ModelDescriptor, operation: ProviderOperation = "video.generate") {
  const fallback = { validate: vi.fn(async () => ({ valid: true, issues: [] })), submit: vi.fn(),
    extractOutputs: vi.fn(async () => []), testConnection: vi.fn(), listModels: vi.fn() } as unknown as ProviderAdapter;
  const fetcher = vi.fn<typeof fetch>();
  const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ id: "fixture", provider: "openai", baseUrl: String(config.baseUrl),
    apiKey: "unit-test-key", settings: { ...config, modelCatalogModels: [model] } }]), fallback, { fetch: fetcher });
  const result = await adapter.validate({ connectionId: "fixture", operation, model: model.id, prompt: "test", parameters: {}, idempotencyKey: "unit-native-video-contract" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(fallback.validate).not.toHaveBeenCalled();
  return result;
}

describe("native video executable contract guard", () => {
  it.each(["grok-imagine-video", "grok-imagine-video-1.5"])("keeps Mikoto %s runnable through its documented native multipart contract", async id => {
    const model = video(id), result = guardNativeVideoRunnableContract(mikoto, model);
    expect(result).toBe(model);
    expect(result.metadata).toMatchObject({ canvasRunnable: true, priceLabel: "¥0.2/请求" });
    expect(remainingVideoTransport("mikoto", id)?.submit).toMatchObject({ path: "/v1/videos", method: "POST", bodyMode: "multipart" });
    expect((await runtimeValidation(mikoto.config, model)).valid).toBe(true);
    expect(model.metadata?.canvasRunnable).toBe(true);
  });

  it("keeps an unknown Mikoto video visible and priced while refusing its missing executable contract", async () => {
    const model = video(), result = guardNativeVideoRunnableContract(mikoto, model);
    expect(result).toMatchObject({ id: model.id, outputKinds: ["video"], operations: model.operations, parameters: [], metadata: {
      canvasRunnable: false, parameterControlsUnavailable: true, priceLabel: "¥0.2/请求", canvasUnavailableReason: expect.stringContaining("协议") } });
    expect((await runtimeValidation(mikoto.config, model)).valid).toBe(false);
    expect(model.metadata?.canvasRunnable).toBe(true);
  });

  it("does not accept declared parameters, endpoint labels or manual metadata without an executable exact binding", async () => {
    const model = { ...video(), parameters: [{ key: "duration", label: "时长", control: "number" as const, default: 6 }],
      metadata: { canvasRunnable: true, operationsSource: "declared", source: "manual", protocol: "openai-videos", endpointTypes: ["video"] } };
    expect(guardNativeVideoRunnableContract(mikoto, model).metadata?.canvasRunnable).toBe(false);
    expect((await runtimeValidation(mikoto.config, model)).valid).toBe(false);
  });

  it("keeps an exact saved video connector runnable only for its supported operation", async () => {
    const current = video(), model = { ...current, metadata: { ...current.metadata, parameterControlsUnavailable: true } };
    const exact = binding({ ...model, operations: ["video.generate"] });
    const config = { ...mikoto.config, autoModelInterfaces: { [model.id]: exact } };
    const result = guardNativeVideoRunnableContract({ provider: "openai", config }, model);
    expect(result.metadata?.canvasRunnable).toBe(true);
    expect(result.metadata?.parameterControlsUnavailable).toBeUndefined();
    expect(result.operations).toEqual(["video.generate"]);
    expect((await runtimeValidation(config, result)).valid).toBe(true);
    expect((await runtimeValidation(config, result, "video.image-to-video")).valid).toBe(false);
    for (const invalid of [binding({ ...model, id: `${model.id}-sibling` }),
      { ...exact, connector: { ...exact.connector, output: { kind: "image" as const, path: "$.data" } } },
      binding({ ...model, operations: ["image.generate"] })]) {
      const wrong = { ...mikoto.config, autoModelInterfaces: { [model.id]: invalid } };
      expect(guardNativeVideoRunnableContract({ provider: "openai", config: wrong }, model).metadata?.canvasRunnable).toBe(false);
      expect((await runtimeValidation(wrong, model)).valid).toBe(false);
    }
    const incomplete = { ...model, metadata: { ...model.metadata, autoInterfaceStatus: "incomplete" } };
    expect(guardNativeVideoRunnableContract({ provider: "openai", config }, incomplete).metadata?.canvasRunnable).toBe(false);
    expect((await runtimeValidation(config, incomplete)).valid).toBe(false);
  });

  it("recognizes only the exact same supplier/group remaining contract and preserves all existing suppliers", () => {
    const cases = [
      { supplier: "secure" as const, baseUrl: "https://token.secure-skill.com/v1", id: "seedance2.0", group: "sd2视频" },
      { supplier: "chentu" as const, baseUrl: "https://tu.988236.xyz/v1", id: "seedance-2.0-720p", group: "视频" },
      { supplier: "frimodel" as const, baseUrl: "https://api.frimodel.com/v1", id: "videos-standard", group: "视频" },
      { supplier: "cyberafei" as const, baseUrl: "https://api.3365api.cn/v1", id: "grok-imagine-video-1.5-1080p", group: "视频" },
      { supplier: "weai" as const, baseUrl: "https://video.we-token.cc/v1", id: "omni-flash-components-1080p", group: "视频" },
    ];
    for (const entry of cases) {
      const model = remainingVideoModel(entry.supplier, entry.id, video(entry.id), { group: entry.group })!;
      expect(model).toBeDefined();
      expect(guardNativeVideoRunnableContract({ provider: "openai", config: { baseUrl: entry.baseUrl, modelGroup: entry.group } }, model)).toBe(model);
      expect(guardNativeVideoRunnableContract(mikoto, model).metadata?.canvasRunnable).toBe(false);
    }
    const flow = { ...video("veo_quan"), metadata: { canvasRunnable: true, modelGroup: "Flow" } };
    expect(guardNativeVideoRunnableContract({ provider: "openai", config: { baseUrl: "https://token.secure-skill.com/v1", accountKeyGroup: "default", modelGroup: "Flow" } }, flow).metadata?.canvasRunnable).toBe(false);
    expect(guardNativeVideoRunnableContract({ provider: "openai", config: { baseUrl: "https://token.secure-skill.com/v1", accountKeyGroup: "Flow" } }, flow).metadata?.canvasRunnable).toBe(true);
  });

  it("preserves exact native Cangyuan and Chuangxiang contracts without granting sibling IDs or foreign hosts", () => {
    for (const id of ["doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-5-260628"]) {
      const model = video(id), connection = { provider: "openai", config: { baseUrl: "https://ai.cangyuansuanli.cn/v1" } };
      expect(guardNativeVideoRunnableContract(connection, model)).toBe(model);
      expect(guardNativeVideoRunnableContract(connection, video(`${id}-alias`)).metadata?.canvasRunnable).toBe(false);
      expect(guardNativeVideoRunnableContract(mikoto, model).metadata?.canvasRunnable).toBe(false);
    }
    const model = video("sd10-seedance-2.5"), connection = { provider: "openai", config: { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "视频" } };
    expect(guardNativeVideoRunnableContract(connection, model)).toBe(model);
    expect(guardNativeVideoRunnableContract({ ...connection, config: { ...connection.config, accountKeyGroup: "其它组" } }, model).metadata?.canvasRunnable).toBe(false);
    expect(guardNativeVideoRunnableContract(connection, video(`${model.id}-alias`)).metadata?.canvasRunnable).toBe(false);
    expect(guardNativeVideoRunnableContract(mikoto, model).metadata?.canvasRunnable).toBe(false);
  });

  it("never re-enables permissions, empty scans, archived suppliers or an existing failure", () => {
    const model = video(), exact = binding(model), config = { ...mikoto.config, autoModelInterfaces: { [model.id]: exact } };
    for (const evidence of [{ supplierArchived: true }, { modelScanStatus: "unauthorized" }, { modelScanStatus: "empty" }, { scannedModelIds: [`${model.id}-sibling`] }]) {
      expect(guardNativeVideoRunnableContract({ provider: "openai", config: { ...config, ...evidence } }, model).metadata?.canvasRunnable).toBe(false);
    }
    for (const canvasUnavailableReason of ["403 权限拒绝", "当前分组未开通", "model not returned", "disabled"]) {
      const denied = { ...model, metadata: { canvasRunnable: false, canvasUnavailableReason } };
      expect(guardNativeVideoRunnableContract({ provider: "openai", config }, denied)).toBe(denied);
      const inconsistent = { ...denied, metadata: { ...denied.metadata, canvasRunnable: true } };
      expect(guardNativeVideoRunnableContract({ provider: "openai", config }, inconsistent).metadata).toMatchObject({ canvasRunnable: false, canvasUnavailableReason });
    }
  });

  it("keeps REST connectors and image-only models outside the native-video guard and respects declared non-video output", () => {
    const model = video();
    expect(guardNativeVideoRunnableContract({ ...mikoto, provider: "rest" }, model)).toBe(model);
    const image: ModelDescriptor = { ...model, operations: ["image.generate"], outputKinds: ["image"] };
    expect(guardNativeVideoRunnableContract(mikoto, image)).toBe(image);
    const understanding: ModelDescriptor = { ...model, outputKinds: ["text"], metadata: { canvasRunnable: true, outputKindsSource: "declared" } };
    expect(guardNativeVideoRunnableContract(mikoto, understanding)).toMatchObject({ outputKinds: ["text"], metadata: { canvasRunnable: false } });
  });

  it("leaves declared mixed outputs intact so a missing video contract cannot disable a valid native image route", async () => {
    const mixed: ModelDescriptor = { id: "gpt-image-2", name: "Declared mixed output", operations: ["image.generate", "video.generate"],
      outputKinds: ["image", "video"], metadata: { canvasRunnable: true, operationsSource: "declared", outputKindsSource: "declared" } };
    const result = guardNativeVideoRunnableContract(mikoto, mixed);
    expect(result).toBe(mixed);
    const fetcher = vi.fn<typeof fetch>();
    const resolver = new StaticConnectionResolver([{ id: "fixture", provider: "openai", baseUrl: mikoto.config.baseUrl, apiKey: "unit-test-key",
      settings: { modelScanStatus: "live", scannedModelIds: [result.id], modelCatalogModels: [result] } }]);
    const adapter = new AutoInterfaceAdapter(resolver, new OpenAIImageAdapter(resolver, { fetch: fetcher }), { fetch: fetcher });
    const request = { connectionId: "fixture", model: result.id, prompt: "test", parameters: {}, idempotencyKey: "unit-mixed-output" };
    expect((await adapter.validate({ ...request, operation: "image.generate" })).valid).toBe(true);
    // This minimal guard does not grant the mixed model's missing video route.
    expect((await adapter.validate({ ...request, operation: "video.generate" })).valid).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    const denied = { ...mixed, metadata: { ...mixed.metadata, canvasRunnable: false, canvasUnavailableReason: "403 权限拒绝" } };
    expect(guardNativeVideoRunnableContract(mikoto, denied)).toBe(denied);
  });
});
