import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { discoverSupplierModelInterfaces, applySavedModelInterfaces } from "./supplier-interface-discovery";

const model: ModelDescriptor = { id: "new-image", name: "New", operations: ["image.generate"], metadata: { endpointTypes: ["/draw"] } };
const connection = { provider: "openai", config: { baseUrl: "https://supplier.test/v1", usage: "canvas" } };
const docs = [{ url: "https://supplier.test/openapi.json", body: { openapi: "3.1.0", security: [{ key: [] }],
  components: { securitySchemes: { key: { type: "http", scheme: "bearer" } } },
  paths: { "/draw": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { model: { type: "string" }, prompt: { type: "string" } }, required: ["model", "prompt"] } } } },
    responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { url: { type: "string" } } } } } } },
  } } },
} }];

describe("automatic supplier interface onboarding", () => {
  it("creates one saved route for an authenticated model and repeated scans are idempotent", async () => {
    const read = vi.fn(async () => docs);
    const first = await discoverSupplierModelInterfaces(connection, [model], connection, read);
    expect(Object.keys(first.bindings)).toEqual([model.id]);
    expect(first.models[0]?.metadata?.autoInterfaceStatus).toBe("connected");
    const saved = { ...connection, config: { ...connection.config, autoModelInterfaces: first.bindings, modelCatalogModels: first.models } };
    const second = await discoverSupplierModelInterfaces(saved, [model], saved, read);
    expect(second.bindings).toEqual(first.bindings);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("checks supplier documents for existing models before keeping their compatibility protocol", async () => {
    const existing = { ...model, id: "existing-image" };
    const previous = { ...connection, config: { ...connection.config, modelCatalogModels: [existing] } };
    const result = await discoverSupplierModelInterfaces(connection, [existing, model], previous, async () => docs);
    expect(Object.keys(result.bindings)).toEqual([existing.id, model.id]);
    expect(result.models[0]?.metadata?.autoInterfacePath).toBe("/draw");
  });
  it("prefers a model-linked supplier document over the site's generic schema", async () => {
    const specific = structuredClone(docs[0]!);
    const generic = structuredClone(docs[0]!);
    generic.body.paths["/draw"].post.requestBody.content["application/json"].schema.required.push("unknown_field");
    Object.assign(generic.body.paths["/draw"].post.requestBody.content["application/json"].schema.properties, { unknown_field: { type: "string" } });
    const result = await discoverSupplierModelInterfaces(connection, [model], connection, async () => [
      { ...generic, url: "https://supplier.test/swagger.json", priority: 1 }, { ...specific, priority: 0 },
    ]);
    expect(result.bindings[model.id]?.connector.submit.path).toBe("/draw");
  });
  it("replaces a saved route when supplier docs change, and blocks a documented conflict even with a working fallback", async () => {
    const first = await discoverSupplierModelInterfaces(connection, [model], connection, async () => docs);
    const saved = { ...connection, config: { ...connection.config, autoModelInterfaces: first.bindings, modelCatalogModels: first.models } };
    const changed = structuredClone(docs);
    Object.assign(changed[0]!.body.paths["/draw"].post.requestBody.content["application/json"].schema.properties, { quality: { type: "string", enum: ["high"] } });
    const refreshed = await discoverSupplierModelInterfaces(saved, [model], saved, async () => changed);
    expect(refreshed.models[0]?.parameters?.find(p => p.key === "quality")?.options).toEqual([{value:"high",label:"high"}]);
    const conflict = await discoverSupplierModelInterfaces(saved, first.models, saved, async () => [...docs, ...changed]);
    expect(conflict.bindings).toEqual({});
    expect(conflict.models[0]?.metadata).toMatchObject({ canvasRunnable: false, autoInterfaceStatus: "incomplete" });
    expect(applySavedModelInterfaces(saved, conflict.models)[0]?.metadata?.canvasRunnable).toBe(false);
  });
  it("keeps saved documentation on a read outage and uses compatibility when no document addresses a standard route", async () => {
    const first = await discoverSupplierModelInterfaces(connection, [model], connection, async () => docs);
    const saved = { ...connection, config: { ...connection.config, autoModelInterfaces: first.bindings } };
    expect((await discoverSupplierModelInterfaces(saved, first.models, saved, async () => [])).bindings).toEqual(first.bindings);
    const standard = { ...model, metadata: { endpointTypes: ["/v1/images/generations"] } };
    const result = await discoverSupplierModelInterfaces(connection, [standard], connection, async () => []);
    expect(result.models).toEqual([standard]);
  });
  it("keeps undocumented new paths unavailable and retries when documentation becomes complete", async () => {
    const first = await discoverSupplierModelInterfaces(connection, [model], connection, async () => []);
    expect(first.models[0]?.metadata).toMatchObject({ canvasRunnable: false, autoInterfaceStatus: "incomplete" });
    const previous = { ...connection, config: { ...connection.config, modelCatalogModels: first.models } };
    const second = await discoverSupplierModelInterfaces(connection, first.models, previous, async () => docs);
    expect(second.models[0]?.metadata?.canvasRunnable).toBe(true);
  });
  it("never grants public catalog models or preserves routes for a denied model", async () => {
    expect((await discoverSupplierModelInterfaces(connection, [], connection, async () => docs)).bindings).toEqual({});
    const first = await discoverSupplierModelInterfaces(connection, [model], connection, async () => docs);
    const denied = { ...model, metadata: { canvasRunnable: false, canvasUnavailableReason: "当前 Key 未返回该模型" } };
    const saved = { ...connection, config: { ...connection.config, autoModelInterfaces: first.bindings } };
    expect(applySavedModelInterfaces(saved, [denied])[0]?.metadata?.canvasRunnable).toBe(false);
    expect((await discoverSupplierModelInterfaces(saved, [denied], saved, async () => docs)).bindings).toEqual({});
  });
  it.each(["agent", "disabled"])("does not discover interfaces for %s connections", async usage => {
    const read = vi.fn(async () => docs);
    await discoverSupplierModelInterfaces({ ...connection, config: { ...connection.config, usage } }, [model], connection, read);
    expect(read).not.toHaveBeenCalled();
  });
});
