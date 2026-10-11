import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { supplierImageMenuContract } from "./supplier-image-menu-contract";
import { effectiveImageCapabilities } from "./supplier-capabilities";
import { normalizedParametersForModel } from "./model-parameters";

const fixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/b6-r6-whole-connections.json.gz", import.meta.url))).toString("utf8")) as { suppliers: SupplierRecord[]; connections: ProviderConnectionRecord[] };
const supplier = fixture.suppliers.find(row => row.name === "We-AI")!;
const connections = fixture.connections.filter(row => row.config.supplierId === supplier.id);
const rows = connections.flatMap(connection => (connection.config.modelCatalogModels as unknown as ModelDescriptor[]).filter(model => model.operations.some(operation => operation.startsWith("image."))).map(model => ({ connection, model })));
const commonRatios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

describe("all current WeAI transports keep exact document parameters", () => {
  it("covers all 10 actual connections and 32 image bindings without a new scan", () => {
    expect(connections).toHaveLength(10);
    expect(rows).toHaveLength(32);
    expect(connections.filter(row => row.provider === "weai")).toHaveLength(6);
  });
  it.each(rows)("restores $connection.provider/$connection.config.accountKeyGroupId/$model.id from its own source", ({ connection, model }) => {
    const original = structuredClone(model);
    const current = supplierImageMenuContract(connection, model);
    expect(current.id).toBe(model.id);
    expect(current.pricing).toEqual(model.pricing);
    expect(current.operations).toEqual(model.operations);
    expect(model).toEqual(original);
    const controls = current.parameters ?? [], size = controls.find(parameter => parameter.key === "size"), nativeSize = controls.find(parameter => parameter.key === "image_size");
    if (model.id.startsWith("gemini-")) {
      const broad = connection.config.accountKeyGroupId === "12" || model.id === "gemini-nano-banana-2.1";
      expect(nativeSize?.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
      expect(controls.find(parameter => parameter.key === "aspect_ratio")?.options?.map(option => option.value)).toEqual(["auto", ...commonRatios, ...(broad ? ["1:4", "4:1", "1:8", "8:1"] : [])]);
      expect(size).toBeUndefined();
      expect(nativeSize?.options?.some(option => option.value === "512")).toBe(false);
      expect(current.limits?.maxInputImages).toBe(14);
      expect(current.metadata?.imageInputMaxBytes).toBe(20 * 1024 * 1024);
      expect(current.metadata?.imageOutputEncodingContract).toBe("inlineData.mimeType-original");
      expect(controls.find(parameter => parameter.key === "quality")).toBeUndefined();
      expect(controls.find(parameter => parameter.key === "n")).toMatchObject({ min: 1, max: 1 });
      expect(current.metadata?.documentationUrl).toBe("https://docs.we-ai.cc/guides/gemini-banana-image.html");
      expect(controls.find(parameter => parameter.key === "thinking_level")).toEqual(model.parameters?.find(parameter => parameter.key === "thinking_level"));
    } else {
      const gpt2 = /^gpt-image-2(?:-(?:low|medium|high))?$/u.test(model.id);
      expect(size?.options).toHaveLength(gpt2 ? 8 : 1);
      expect(size?.step).toBe(gpt2 ? 16 : 1);
      expect(size?.min).toBe(gpt2 ? 16 : undefined);
      expect(size?.max).toBe(gpt2 ? 3840 : undefined);
      expect(size?.options?.map(option => option.value)).not.toContain("2160x2160");
      expect(current.metadata?.documentationUrl).toBe("https://docs.we-ai.cc/guides/image-generation.html");
      for (const field of ["n", "output_format", "output_compression", "response_format"])
        expect(controls.find(parameter => parameter.key === field)).toEqual(model.parameters?.find(parameter => parameter.key === field));
      const quality = controls.find(parameter => parameter.key === "quality");
      if (model.id.includes("2.5")) expect(quality).toMatchObject({ control: "text", allowCustomValue: true, default: "max" });
      else if (connection.config.accountKeyGroupId === "6") {
        expect(quality?.options?.map(option => option.value)).toEqual(["auto", "low", "medium", "high"]);
        expect(quality?.default).toBe("high");
      }
      else expect(quality).toEqual(model.parameters?.find(parameter => parameter.key === "quality"));
      expect(current.limits).toEqual(model.limits);
    }
    const enriched = effectiveImageCapabilities({ supplier, connection, model: current, fingerprint: "exact-saved-fixture" }).model;
    expect(enriched.parameters).toEqual(controls);
    const saved = { size: "2051x2049", image_size: "4K", size_tier: "4K", aspect_ratio: "16:9", quality: "max", n: 1 };
    expect(normalizedParametersForModel("image-generation", connection.provider, enriched, saved)).toMatchObject(saved);
    expect(enriched.pricing).toEqual(model.pricing);
  });
  it("does not transfer native fields to another origin, stable group, full ID or explicit manual/paid contract", () => {
    const { connection, model } = rows.find(row => row.connection.provider === "weai" && row.model.id.includes("2.5"))!;
    for (const config of [{ ...connection.config, baseUrl: "https://other.invalid/v1" }, { ...connection.config, accountKeyGroupId: "999" }, { ...connection.config, manualProtocol: true }])
      expect(supplierImageMenuContract({ ...connection, config }, model)).toBe(model);
    const sibling = { ...model, id: `${model.id}-other` };
    expect(supplierImageMenuContract(connection, sibling)).toBe(sibling);
    for (const metadata of [{ source: "manual" }, { source: "paid-test" }, { protocolEvidence: "paid-test" }]) {
      const protectedModel = { ...model, metadata: { ...model.metadata, ...metadata } };
      expect(supplierImageMenuContract(connection, protectedModel)).toBe(protectedModel);
      expect(effectiveImageCapabilities({ supplier, connection, model: protectedModel, fingerprint: "f" }).model).toBe(protectedModel);
    }
  });
});
