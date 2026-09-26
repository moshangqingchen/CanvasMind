import { describe, expect, it, vi } from "vitest";
import { compileDocumentedInterface } from "./documented-interface.js";
import { scanProviderModelCatalog } from "./model-catalog.js";
import { StaticConnectionResolver } from "./credentials.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import type { ModelDescriptor, ProviderAdapter, ProviderTask } from "./contracts.js";

const model: ModelDescriptor = { id: "new-image", name: "New image", operations: ["image.generate"], metadata: { endpointTypes: ["/v1/render"] } };
const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const text = { type: "string" };
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
function document(async = false) {
  return {
    openapi: "3.0.3", servers: [{ url: "/v1" }], security: [{ bearer: [] }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } }, schemas: {
      Image: object({ url: { type: "string", format: "uri" }, b64_json: text }),
    } },
    paths: {
      "/render": { post: {
        requestBody: json(object({ model: { ...text, enum: [model.id] }, prompt: text, n: { type: "integer", default: 1 },
          size: text, quality: { ...text, enum: ["low", "max"], default: "max" } }, ["model", "prompt"])),
        responses: { "200": { ...json(async ? object({ data: object({ task_id: text }) }) : object({ data: { type: "array", items: { $ref: "#/components/schemas/Image" } } })),
          ...(async ? { links: { Poll: { operationId: "getTask", parameters: { job: "$response.body#/data/task_id" } } } } : {}) } },
      } },
      ...(async ? { "/tasks/{job}": { get: { operationId: "getTask", responses: { "200": json(object({
        data: object({ status: { ...text, enum: ["PENDING", "RUNNING", "SUCCESS", "FAILED"] }, result: { $ref: "#/components/schemas/Image" } }),
      })) } } } } : {}),
    },
  };
}
const compile = (value: unknown, selected = model) => compileDocumentedInterface(value, selected, "https://supplier.test/v1", "https://supplier.test/openapi.json");

describe("documented interface compiler and execution", () => {
  it("preserves bounded endpoint and documentation evidence from authenticated catalogs", () => {
    const scan = scanProviderModelCatalog({ data: [{ id: "new-image", endpoints: ["/v1/render"], openapi_url: "/openapi.json", malicious: { submit: "/steal" } }] });
    expect(scan.models[0]?.metadata).toMatchObject({ endpointTypes: ["/v1/render"], documentationUrl: "/openapi.json" });
    expect(scan.models[0]?.metadata).not.toHaveProperty("malicious");
  });

  it("compiles sync JSON request, parameters and referenced result schema", async () => {
    const binding = compile(document())?.binding;
    expect(binding?.connector.submit.path).toBe("/v1/render");
    expect(binding?.connector.output).toMatchObject({ path: "$.data[*]", urlPath: "$.url", base64Path: "$.b64_json" });
    expect(binding?.model.operations).toEqual(["image.generate"]);
    const fetcher = vi.fn<typeof fetch>(async () => response({ data: [{ url: "https://supplier.test/image.png" }] }));
    const fallback = { submit: vi.fn(), validate: vi.fn() } as unknown as ProviderAdapter;
    const resolver = new StaticConnectionResolver([{ id: "key-a", provider: "openai", apiKey: "key-of-this-group", baseUrl: "https://supplier.test/v1",
      settings: { autoModelInterfaces: { [model.id]: binding } } }]);
    const adapter = new AutoInterfaceAdapter(resolver, fallback, { fetch: fetcher });
    const request = { connectionId: "key-a", model: model.id, operation: "image.generate" as const, prompt: "a vase", idempotencyKey: "one-submit", parameters: { size: "3840x2160", quality: "max", n: 1 } };
    expect((await adapter.validate(request)).valid).toBe(true);
    const task = await adapter.submit(request);
    expect(task.status).toBe("succeeded");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://supplier.test/v1/render");
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer key-of-this-group");
    expect(JSON.parse(String(init.body))).toEqual({ model: model.id, prompt: "a vase", size: "3840x2160", quality: "max", n: 1 });
    expect((await adapter.extractOutputs(task.result))[0]?.url).toBe("https://supplier.test/image.png");
    expect(fallback.submit).not.toHaveBeenCalled();
  });

  it("recovers async polling and output extraction from a persisted task after the saved route changes", async () => {
    const binding = compile(document(true))!.binding!;
    expect(binding.connector.poll?.path).toBe("/v1/tasks/{taskId}");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ data: { task_id: "task-1" } }))
      .mockResolvedValueOnce(response({ data: { status: "SUCCESS", result: { url: "https://supplier.test/result.png" } } }));
    const resolver = new StaticConnectionResolver([{ id: "key-a", provider: "openai", apiKey: "a", baseUrl: "https://supplier.test/v1", settings: { autoModelInterfaces: { [model.id]: binding } } }]);
    const adapter = new AutoInterfaceAdapter(resolver, {} as ProviderAdapter, { fetch: fetcher });
    const task = await adapter.submit({ connectionId: "key-a", model: model.id, operation: "image.generate", prompt: "vase", idempotencyKey: "one" });
    expect(task.status).toBe("running");
    const restarted = new AutoInterfaceAdapter(new StaticConnectionResolver([{ id: "key-a", provider: "openai", apiKey: "a", baseUrl: "https://supplier.test/v1", settings: {} }]), {} as ProviderAdapter, { fetch: fetcher });
    const result = await restarted.poll(JSON.parse(JSON.stringify(task)) as ProviderTask);
    expect(result.status).toBe("succeeded");
    expect(String(fetcher.mock.calls[1]?.[0])).toBe("https://supplier.test/v1/tasks/task-1");
    expect(fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
    expect((await restarted.extractOutputs(result.result))[0]?.url).toBe("https://supplier.test/result.png");
  });

  it("does not reuse another model or another group's route", async () => {
    expect(compile(document(), { ...model, id: "other-image" })).toBeUndefined();
    const fallback = { validate: vi.fn(async () => ({ valid: true, issues: [] })) } as unknown as ProviderAdapter;
    const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ id: "other-group", provider: "openai", apiKey: "b", settings: {} }]), fallback);
    await adapter.validate({ connectionId: "other-group", model: model.id, prompt: "x", operation: "image.generate", idempotencyKey: "x" });
    expect(fallback.validate).toHaveBeenCalledOnce();
  });

  it("rejects incomplete polling rather than assuming submission succeeded", () => {
    const doc = document(true);
    delete doc.paths["/tasks/{job}"];
    expect(compile(doc)?.reason).toContain("查询地址");
  });
  it("rejects custom required fields without guessing values", () => {
    const doc = document();
    doc.paths["/render"].post.requestBody.content["application/json"].schema.required.push("workspace");
    Object.assign(doc.paths["/render"].post.requestBody.content["application/json"].schema.properties, { workspace: text });
    expect(compile(doc)?.reason).toContain("workspace");
  });
  it("rejects cross-origin submit servers, unsupported auth, ambiguous paths and external references", () => {
    const cross = document(); cross.servers[0]!.url = "https://other.test";
    expect(compile(cross)?.reason).toContain("供应商不一致");
    const noAuth = document(); noAuth.security = [];
    expect(compile(noAuth)?.binding?.connector.auth).toEqual({ type: "none" });
    const unsupported = document(); unsupported.components.securitySchemes.bearer.scheme = "basic";
    expect(compile(unsupported)?.reason).toContain("鉴权");
    const ambiguous = document(); Object.assign(ambiguous.paths, { "/another": ambiguous.paths["/render"] });
    expect(compile(ambiguous)?.reason).toContain("多个提交接口");
    const external = document(); Object.assign(external.components.schemas.Image, { $ref: "https://other.test/schema.json" });
    expect(compile(external)?.reason).toContain("外部字段引用");
  });
  it("does not try a second protocol after a possibly accepted POST", async () => {
    const binding = compile(document())!.binding!;
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network lost"));
    const fallback = { submit: vi.fn() } as unknown as ProviderAdapter;
    const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ id: "a", provider: "openai", apiKey: "a", baseUrl: "https://supplier.test/v1", settings: { autoModelInterfaces: { [model.id]: binding } } }]), fallback, { fetch: fetcher });
    await expect(adapter.submit({ connectionId: "a", operation: "image.generate", model: model.id, prompt: "x", idempotencyKey: "x" })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce(); expect(fallback.submit).not.toHaveBeenCalled();
  });
  it("blocks fallback submission when the supplier's documentation is incomplete", async () => {
    const fallback = { submit: vi.fn(), validate: vi.fn() } as unknown as ProviderAdapter;
    const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ id: "a", provider: "openai", apiKey: "a", settings: {
      modelCatalogModels: [{ ...model, metadata: { autoInterfaceStatus: "incomplete", canvasUnavailableReason: "缺少任务查询地址" } }],
    } }]), fallback);
    const request = { connectionId: "a", operation: "image.generate" as const, model: model.id, prompt: "x", idempotencyKey: "x" };
    expect(await adapter.validate(request)).toMatchObject({valid:false,issues:[{code:"interface_unavailable"}]});
    await expect(adapter.submit(request)).rejects.toThrow("缺少任务查询地址");
    expect(fallback.submit).not.toHaveBeenCalled();
  });
  it("uses a documented generation binding only for the operation it describes", async () => {
    const binding = compile(document())!.binding!;
    const fallback = { validate: vi.fn(async () => ({valid:true,issues:[]})) } as unknown as ProviderAdapter;
    const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{id:"a",provider:"openai",apiKey:"a",settings:{autoModelInterfaces:{[model.id]:binding}}}]), fallback);
    await adapter.validate({connectionId:"a",operation:"image.edit",model:model.id,prompt:"x",idempotencyKey:"x"});
    expect(fallback.validate).toHaveBeenCalledOnce();
  });
});
