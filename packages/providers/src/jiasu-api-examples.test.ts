import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseJiasuVideoApiExampleTemplate, readJiasuVideoApiExampleTemplate, jiasuVideoApiExampleContract } from "./jiasu-api-examples.js";
import { jiasuCatalogRecord } from "./jiasu-catalog-pricing.js";
import { discoverSupplierCatalog } from "./supplier-catalog.js";
import { jiasuVideoModel, jiasuVideoRequestIssues, normalizeJiasuVideoParameters } from "./jiasu-video-contract.js";
import type { ModelDescriptor, NormalizedRequest } from "./contracts.js";

const checkedAt = "2026-10-11T01:26:30.512Z";
const sourceUrl = "https://ai.jiasuapi.com/static/js/index.723048e8ea.js";
// Literal template captured from the supplier's model-details API tab. It is
// rendered with each row's model_name, rather than being a model enum/schema.
const source = 'if("openai-video"===t){n=`${a.baseUrl}/v1/videos/tasks`;l=JSON.stringify({model:a.modelName,prompt:s,duration:5,ratio:"16:9",resolution:"720p",images:o,audios:r},null,2);return`Authorization: Bearer $KEY Content-Type: application/json`}';
const captured = JSON.parse(readFileSync(new URL("./fixtures/jiasu-api-examples-20261010.json", import.meta.url), "utf8")) as {
  checkedAt: string; templateExcerpt: string; sourceReceipt: { sourceUrl: string; bodySha256: string; bodyBytes: number }; data: Record<string, unknown>[];
};
const row = (model_name: string) => ({ model_name, supported_endpoint_types: ["openai-video"], enable_groups: ["vip"], quota_type: 1, model_price: 1 });
const input = (model: string, parameters: Record<string, unknown>): NormalizedRequest => ({ connectionId: "isolated-jiasu", operation: "video.generate", model, prompt: "Isolated contract", parameters, idempotencyKey: "never-charge" });

describe("Jiasu model plaza API examples", () => {
  it("covers all 28 current full video IDs with their own schema and the actual published renderer excerpt", () => {
    const template = parseJiasuVideoApiExampleTemplate(captured.templateExcerpt, captured.sourceReceipt.sourceUrl, captured.checkedAt)!;
    expect(template.values).toEqual({ duration: 5, ratio: "16:9", resolution: "720p" });
    expect(captured.sourceReceipt.bodySha256).toBe("8834f058ca4c354cc01f2356800571465b4ab79fbee582e143d5d6934a5e54de");
    expect(captured.data).toHaveLength(28);
    for (const row of captured.data) {
      const id = String(row.model_name), record = jiasuCatalogRecord(row);
      const model = jiasuVideoModel(id, { id, name: id, operations: [], metadata: { jiasuCatalogRecord: record } }, "vip")!;
      expect(model?.id).toBe(id);
      expect(model.outputKinds).toEqual(["video"]);
      expect(model.metadata?.jiasuApiExampleContract).toMatchObject({ modelId: id, exhaustiveValues: false, values: { resolution: "720p" } });
      const schema = record.apiParameters.find(parameter => parameter.name === "resolution");
      if (!schema?.range && !schema?.enum && !/\b(?:480|720|1080|1440|2160)p\b/iu.test(record.description))
        expect(model.parameters?.find(parameter => parameter.key === "resolution")).toMatchObject({ control: "text", allowCustomValue: true });
    }
    const dola = captured.data.find(row => row.model_name === "dola-sd-2.5")!;
    expect(dola.api_parameters).toBeNull();
    expect(jiasuCatalogRecord(dola).apiExampleContract?.values.resolution).toBe("720p");
  });
  it("reads literal example values and endpoints without treating them as an exhaustive enum", () => {
    const template = parseJiasuVideoApiExampleTemplate(source, sourceUrl, checkedAt)!;
    expect(template).toMatchObject({ sourceStatus: "live", sourceUrl, checkedAt, values: { duration: 5, ratio: "16:9", resolution: "720p" } });
    expect(template.sourceSha256).toMatch(/^[a-f\d]{64}$/u);
    expect(jiasuVideoApiExampleContract("dola-sd-2.5", template)).toMatchObject({ modelId: "dola-sd-2.5", exhaustiveValues: false,
      submitMethod: "POST", submitPath: "/v1/video/generations", pollMethod: "GET", pollPath: "/v1/videos/tasks/{task_id}",
      authentication: "bearer", bodyMode: "json", fields: ["model", "prompt", "duration", "ratio", "resolution", "images", "audios"] });
    expect(parseJiasuVideoApiExampleTemplate(source, "https://other.invalid/static/js/index.1.js", checkedAt)).toBeUndefined();
    expect(parseJiasuVideoApiExampleTemplate(source.replace('duration:5', 'duration:runCode()'), sourceUrl, checkedAt)).toBeUndefined();
    expect(jiasuVideoApiExampleContract("test", template, { path: "/v1/tasks", method: "DELETE" })).toBeUndefined();
  });

  it("finishes the captured 5 MB official template body when a valid transfer takes longer than eight seconds", async () => {
    vi.useFakeTimers();
    let jsStarted!: () => void;
    const started = new Promise<void>(resolve => { jsStarted = resolve; });
    const encoder = new TextEncoder();
    const bytes = encoder.encode(captured.templateExcerpt + " ".repeat(captured.sourceReceipt.bodyBytes - encoder.encode(captured.templateExcerpt).length));
    expect(bytes.length).toBe(5_015_629);
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (new URL(String(url)).pathname === "/") return new Response('<script defer src="/static/js/index.723048e8ea.js"></script>');
      const body = new ReadableStream<Uint8Array>({
        start(controller) { bodyTimer = setTimeout(() => { controller.enqueue(bytes); controller.close(); }, 9_000); },
        cancel() { clearTimeout(bodyTimer); },
      });
      jsStarted();
      return new Response(body, { headers: { "Content-Length": String(bytes.length), "Content-Type": "text/javascript" } });
    });
    try {
      const result = readJiasuVideoApiExampleTemplate(fetcher, checkedAt);
      await started;
      await vi.advanceTimersByTimeAsync(9_000);
      expect(await result).toMatchObject({ sourceStatus: "live", sourceUrl, checkedAt,
        fields: ["model", "prompt", "duration", "ratio", "resolution", "images", "audios"],
        values: { duration: 5, ratio: "16:9", resolution: "720p" } });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.every(([, init]) => init?.headers === undefined && init?.cache === "no-store")).toBe(true);
    } finally { clearTimeout(bodyTimer); vi.useRealTimers(); }
  });

  it("retains the eight MiB JS response bound despite the longer body budget", async () => {
    const fetcher = vi.fn<typeof fetch>(async url => new URL(String(url)).pathname === "/"
      ? new Response('<script src="/static/js/index.723048e8ea.js"></script>')
      : new Response(captured.templateExcerpt, { headers: { "Content-Length": String(8 * 1024 * 1024 + 1) } }));
    expect(await readJiasuVideoApiExampleTemplate(fetcher, checkedAt)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retains exact full IDs and examples for a row missing api_parameters, without sharing another model's enum", () => {
    const id = "dola-sd-2.5", metadata = { jiasuCatalogRecord: jiasuCatalogRecord({ ...row(id), description: "30图 0视频 10音频" }) };
    const model = jiasuVideoModel(id, { id, name: id, operations: [], metadata }, "vip")!;
    expect(model.metadata).toMatchObject({ videoResolutionAllowsCustom: true, videoResolutionExampleValues: ["720p"],
      jiasuApiExampleContract: { modelId: id, exhaustiveValues: false, values: { resolution: "720p", duration: 5 } },
      durationRangeSource: "user-fallback", videoMinDuration: 1, videoMaxDuration: 30 });
    expect(model.parameters?.find(parameter => parameter.key === "resolution")).toMatchObject({ control: "text", allowCustomValue: true });
    expect(model.parameters?.find(parameter => parameter.key === "resolution")?.default).toBeUndefined();
    for (const resolution of ["720p", "1080p", "supplier-custom-value"]) {
      const request = input(id, { duration: 21, resolution, aspect_ratio: "9:16" });
      expect(jiasuVideoRequestIssues(request, model, "vip")).toEqual([]);
      expect(normalizeJiasuVideoParameters(request, model, "vip")).toEqual({ duration: 21, ratio: "9:16", resolution });
      expect(request.parameters).toEqual({ duration: 21, resolution, aspect_ratio: "9:16" });
    }
    expect(model.limits).toMatchObject({ maxInputImages: 30, maxInputVideos: 0, maxInputAudios: 10 });
    expect(jiasuCatalogRecord({ ...row("image"), supported_endpoint_types: ["image-generation"] }).apiExampleContract).toBeUndefined();
  });

  it("uses explicit schema bounds and enums; an API example never overrides them", () => {
    const id = "new-jiasu-video", api_parameters = [{ name: "duration", type: "integer", minimum: 6, maximum: 10 },
      { name: "resolution", type: "enum", enum: ["1080p", "2160p"] }];
    const model = jiasuVideoModel(id, { id, name: id, operations: [], metadata: { jiasuCatalogRecord: jiasuCatalogRecord({ ...row(id), api_parameters }) } })!;
    expect(model.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 6, max: 10 });
    expect(model.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["1080p", "2160p"]);
    expect(model.metadata?.videoResolutionAllowsCustom).toBeUndefined();
    expect(jiasuVideoRequestIssues(input(id, { duration: 5, resolution: "720p" }), model)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "parameters.duration" }), expect.objectContaining({ path: "parameters.resolution" })]));
  });

  it("forwards typed duration for a declared future full ID with no complete range, without making the 5s example a default", () => {
    const id = "jiasu-future-video", current: ModelDescriptor = { id, name: id, operations: [], metadata: { jiasuCatalogRecord: jiasuCatalogRecord(row(id)) } };
    const model = jiasuVideoModel(id, current)!;
    expect(model.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ control: "number", valueType: "integer", allowCustomValue: true });
    expect(model.parameters?.find(parameter => parameter.key === "duration")?.default).toBeUndefined();
    expect(jiasuVideoRequestIssues(input(id, { duration: 41, resolution: "provider-custom" }), model)).toEqual([]);
    expect(normalizeJiasuVideoParameters(input(id, { duration: 41, resolution: "provider-custom" }), model)).toMatchObject({ duration: 41, resolution: "provider-custom" });
    for (const duration of [0, 3.5, "5"]) expect(jiasuVideoRequestIssues(input(id, { duration }), model)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
  });

  it("reads the plaza template once per refresh and persists current evidence for every exact video ID", async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/pricing") return Response.json({ data: [row("dola-sd-2.5"), row("dola-sd-2.0")], group_ratio: { vip: 1 },
        supported_endpoint: { "openai-video": { path: "/v1/video/generations", method: "POST" } } });
      if (path === "/api/status") return Response.json({ data: { quota_display_type: "CUSTOM", custom_currency_symbol: "¥", custom_currency_exchange_rate: 1 } });
      if (path === "/api/user/self/groups") return Response.json({ data: { vip: { desc: "vip", ratio: 1 } } });
      if (path === "/") return new Response('<script defer src="/static/js/index.723048e8ea.js"></script>');
      if (path === "/static/js/index.723048e8ea.js") return new Response(source);
      return Response.json({}, { status: 404 });
    });
    const scan = () => discoverSupplierCatalog({ siteUrl: "https://ai.jiasuapi.com", apiUrl: "https://ai.jiasuapi.com/v1", kind: "newapi", token: "isolated-account:17" }, fetcher);
    const first = await scan();
    expect(first.groups[0]?.models).toHaveLength(2);
    for (const model of first.groups[0]!.models) expect(model.metadata).toMatchObject({ jiasuApiExampleScanStatus: "live",
      jiasuApiExampleContract: { modelId: model.id, sourceStatus: "live", sourceSha256: expect.stringMatching(/^[a-f\d]{64}$/u) },
      jiasuCatalogRecord: { apiExampleContract: { modelId: model.id, sourceStatus: "live" } } });
    expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname.startsWith("/static/js/"))).toHaveLength(1);
    for (const [url, init] of fetcher.mock.calls.filter(([url]) => ["/", "/static/js/index.723048e8ea.js"].includes(new URL(String(url)).pathname))) {
      expect(init?.cache).toBe("no-store");
      expect(init?.headers).toBeUndefined();
      expect(String(url)).toMatch(/^https:\/\/ai\.jiasuapi\.com\//u);
    }
    await scan();
    expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname.startsWith("/static/js/"))).toHaveLength(2);
  });

  it("keeps model and price discovery when the API example read fails and never follows foreign scripts", async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (new URL(String(url)).pathname === "/") return new Response('<script src="https://foreign.invalid/static/js/index.123.js"></script>');
      throw new Error("unexpected read");
    });
    expect(await readJiasuVideoApiExampleTemplate(fetcher, checkedAt)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("marks a failed example attempt partial while retaining that exact model's successful group price", async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/pricing") return Response.json({ data: [row("dola-sd-2.5")], group_ratio: { vip: 1 },
        supported_endpoint: { "openai-video": { path: "/v1/video/generations", method: "POST" } } });
      if (path === "/api/status") return Response.json({ data: { quota_display_type: "CUSTOM", custom_currency_symbol: "¥", custom_currency_exchange_rate: 1 } });
      if (path === "/api/user/self/groups") return Response.json({ data: { vip: { desc: "vip", ratio: 1 } } });
      if (path === "/") return new Response('<script src="/static/js/index.723048e8ea.js"></script>');
      if (path === "/static/js/index.723048e8ea.js") return new Response("invalid-current-template");
      return Response.json({}, { status: 404 });
    });
    const discovered = await discoverSupplierCatalog({ siteUrl: "https://ai.jiasuapi.com", apiUrl: "https://ai.jiasuapi.com/v1", kind: "newapi" }, fetcher);
    const model = discovered.groups[0]!.models.find(model => model.id === "dola-sd-2.5")!;
    expect(discovered.status).toBe("live");
    expect(model.metadata).toMatchObject({ jiasuApiExampleScanStatus: "partial",
      jiasuApiExampleCheckedAt: expect.any(String), jiasuCatalogRecord: { apiExampleContract: { sourceStatus: "snapshot" } },
      officialCatalogPricing: expect.objectContaining({ currency: "CNY" }) });
    expect(model.metadata?.jiasuApiExampleContract).toBeUndefined();
  });
});
