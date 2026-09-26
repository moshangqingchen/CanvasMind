import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
const mocks = vi.hoisted(() => ({ bytes: vi.fn() }));
vi.mock("@super-canvas/providers", async importOriginal => ({ ...await importOriginal<object>(), fetchProviderBytes: mocks.bytes }));
import { readSupplierInterfaceDocuments } from "./supplier-interface-documents";
const model: ModelDescriptor = { id: "image", name: "Image", operations: ["image.generate"] };
const doc = { openapi: "3.1.0", paths: {} };
const bytes = (body: string) => ({ data: new TextEncoder().encode(body) });
beforeEach(() => { mocks.bytes.mockReset(); });
describe("supplier documentation sources", () => {
  it("reads supplier-linked docs first, follows literal schema links, then reads only that supplier's fallback locations", async () => {
    const calls: string[] = [];
    mocks.bytes.mockImplementation(async (_fetch, url: string) => {
      calls.push(url);
      if (url === "https://docs.supplier.test/images") return bytes('<script>throw Error("must not run")</script><a href="/spec.json">OpenAPI</a>');
      if (url === "https://docs.supplier.test/spec.json") return bytes(JSON.stringify(doc));
      throw Error("not found");
    });
    const result = await readSupplierInterfaceDocuments("https://api.supplier.test/v1", [{ ...model, metadata: { documentationUrl: "https://docs.supplier.test/images" } }], "https://supplier.test");
    expect(calls.slice(0, 2)).toEqual(["https://docs.supplier.test/images", "https://docs.supplier.test/spec.json"]);
    expect(result).toEqual([{ url: "https://docs.supplier.test/spec.json", body: doc, priority: 0 }]);
    expect(calls).toContain("https://supplier.test/openapi.json");
    expect(calls).toContain("https://api.supplier.test/openapi.json");
    for (const call of mocks.bytes.mock.calls) expect(call[2]).toEqual({phase:"connect",timeoutMs:8000,maxResponseBytes:1024*1024});
  });
  it("extracts embedded JSON without treating arbitrary JavaScript as configuration and caches document reads", async () => {
    mocks.bytes.mockImplementation(async (_fetch, url: string) => url.endsWith("/manual")
      ? bytes('<script>window.attack = true</script><pre>' + JSON.stringify(doc).replaceAll('"', '&quot;') + '</pre>') : Promise.reject(Error("missing")));
    const models = [{ ...model, metadata: { documentationUrl: "/manual" } }];
    const result = await readSupplierInterfaceDocuments("https://embedded.test/v1", models, "https://embedded.test");
    expect(result[0]).toMatchObject({url:"https://embedded.test/manual",body:doc,priority:0});
    const count = mocks.bytes.mock.calls.length;
    await readSupplierInterfaceDocuments("https://embedded.test/v1", models, "https://embedded.test");
    expect(mocks.bytes).toHaveBeenCalledTimes(count);
  });
});
