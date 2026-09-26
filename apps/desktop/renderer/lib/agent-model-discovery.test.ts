import { describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { scanProviderModelCatalog } from "@super-canvas/providers";
import { agentDocumentFacts, discoverAgentModelCapabilities } from "./agent-model-discovery";
import { agentModelEvidenceFingerprint, resolveAgentCapabilities } from "./agent-model-capabilities";

const connection: ProviderConnectionRecord = {
  id: "key", provider: "openai", name: "Agent", encryptedSecret: "cipher", createdAt: "now", updatedAt: "now",
  config: { supplierId: "s", supplierSourceId: "source", baseUrl: "https://supplier.example/v1", modelGroup: "A", usage: "agent" },
};
const alias = "gpt-pro-[稳定优先]";
const model = (fields: Record<string, unknown> = {}) => scanProviderModelCatalog([{ id: alias, ...fields }]).models[0]!;

describe("automatic free agent model discovery", () => {
  it("fills officially documented Opus 5.5 effort levels and recognizes budget-only Claude models", async () => {
    const [opus, haiku] = await discoverAgentModelCapabilities(connection, [
      model({ id: "claude-opus-5-5" }), model({ id: "claude-haiku-4-5-20251001" }),
    ], async () => undefined);
    const resolved = resolveAgentCapabilities(connection, opus!.id, opus);
    expect(resolved.reasoningOptions.map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(resolved.reasoningFallback?.checkedAt).toBe("2026-09-24");
    expect(haiku?.metadata?.agentDiscovery).toMatchObject({ status: "complete" });
    expect(resolveAgentCapabilities(connection, haiku!.id, haiku).reasoningOptions.map(option => option.value)).toEqual(["auto"]);
  });

  it("excludes old Midjourney snapshots from free agent capability discovery", async () => {
    const read = vi.fn(async () => undefined);
    const image = { ...model({ id: "midjourney-2k" }), operations: [], outputKinds: ["text"] as const, metadata: { outputKindsSource: "inferred" } };
    const [unchanged] = await discoverAgentModelCapabilities(connection, [image], read);
    expect(read).not.toHaveBeenCalled();
    expect(unchanged).toEqual(image);
  });
  it("investigates the exact alias and fills official levels while retaining the request ID", async () => {
    const read = vi.fn(async () => `# ${alias}\n官方型号：gpt-5.4\n# other-model\nreasoning_effort: low\n官方型号：gpt-5.2-pro`);
    const [found] = await discoverAgentModelCapabilities(connection, [model()], read);
    expect(read).toHaveBeenCalledOnce();
    expect(found!.id).toBe(alias);
    expect(found!.metadata?.agentDiscovery).toMatchObject({ status: "complete", officialModelId: "gpt-5.4", mappingSource: "supplier-document" });
    const resolved = resolveAgentCapabilities(connection, alias, found);
    expect(resolved.reasoningOptions.map(option => option.value)).toEqual(["auto", "none", "low", "medium", "high", "xhigh"]);
    expect(resolved.reasoningSource).toBe("official-model");
    expect(resolved.protocol).toBe("openai-responses");
    expect(resolved.reasoningFallback).toMatchObject({ sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.4", officialModelId: "gpt-5.4" });
    expect(resolveAgentCapabilities({ ...connection, encryptedSecret: "new-key" }, alias, found).reasoningOptions).toHaveLength(1);
  });

  it("preserves API mappings and channel limits ahead of documentation, then applies only exact-Key rejections", async () => {
    const [found] = await discoverAgentModelCapabilities(connection, [model({ upstream_model: "gpt-5.4", reasoning_efforts: ["low", "high"] })],
      async () => `${alias}: reasoning_effort: low, medium, high, xhigh`);
    expect(found!.metadata?.agentDiscovery).toMatchObject({ officialModelId: "gpt-5.4", mappingSource: "model-api" });
    const rejected = { ...connection, config: { ...connection.config, agentRuntimeProfiles: {
      [alias]: { fingerprint: agentModelEvidenceFingerprint(connection), unsupportedReasoningEfforts: ["high"] },
    } } };
    expect(resolveAgentCapabilities(rejected, alias, found).reasoningOptions.map(option => option.value)).toEqual(["auto", "low"]);
  });

  it("reads exact group catalog facts before official fallback", async () => {
    const primary = model();
    const catalog = model({ official_model: "gpt-5.4", reasoning_efforts: ["high"], supports_vision: false });
    primary.metadata = { ...primary.metadata, supplierAgentFacts: { metadata: catalog.metadata } };
    const [found] = await discoverAgentModelCapabilities(connection, [primary], async () => undefined);
    const result = resolveAgentCapabilities(connection, alias, found);
    expect(result.reasoningOptions.map(option => option.value)).toEqual(["auto", "high"]);
    expect(result.imageInputStatus).toBe("unsupported");
  });

  it("honors explicit routing even when the public ID looks like an official model", async () => {
    const [routed, dynamic] = await discoverAgentModelCapabilities(connection, [
      model({ id: "gpt-5.4", upstream_model: "gpt-5.2-pro" }),
      model({ id: "gpt-5.5", upstream_model: "gpt-5.4", base_model: "gpt-5.2-pro" }),
    ], async () => undefined);
    expect(resolveAgentCapabilities(connection, routed!.id, routed).reasoningOptions.map(option => option.value))
      .toEqual(["auto", "medium", "high", "xhigh"]);
    expect(resolveAgentCapabilities(connection, dynamic!.id, dynamic).reasoningOptions).toHaveLength(1);
  });

  it("does not guess aliases or silently choose one dynamic routing target", async () => {
    const [unknown, conflict, future] = await discoverAgentModelCapabilities(connection, [model(),
      model({ id: "dynamic", upstream_model: "gpt-5.4", official_model: "gpt-5.2-pro" }),
      model({ id: "future", upstream_model: "unknown-official-version" })], async () => "High quality GPT Pro, low latency.");
    for (const found of [unknown!, conflict!, future!]) {
      expect(found.metadata?.agentDiscovery).toMatchObject({ status: "incomplete" });
      expect(resolveAgentCapabilities(connection, found.id, found).reasoningOptions).toHaveLength(1);
      expect(resolveAgentCapabilities(connection, found.id, found).reasoningNotice).toEqual(expect.any(String));
    }
    expect(resolveAgentCapabilities(connection, conflict!.id, conflict).reasoningNotice).toContain("多个官方型号");
  });

  it("scopes shared JSON documents to the exact model, and never borrows a prefix match", () => {
    const found = agentDocumentFacts(model(), JSON.stringify({ models: [
      { id: alias + "-other", reasoning_efforts: ["ultra"], upstream_model: "gpt-5.2-pro" },
      { id: alias, upstream_model: "gpt-5.4", reasoning_efforts: ["high"] },
    ] }), "https://supplier.example/docs");
    expect(found.metadata).toMatchObject({ officialModelCandidates: ["gpt-5.4"], reasoningOptions: [{ value: "high" }] });
    const other = agentDocumentFacts(model(), `${alias}-other: 官方型号：gpt-5.4`, "https://supplier.example/docs");
    expect(other.metadata.officialModelCandidates).toBeUndefined();
  });

  it("shows a concrete missing-document result and never reads image/video docs on the agent path", async () => {
    const image = scanProviderModelCatalog([{ id: "gpt-image-2" }]).models[0]!;
    const read = vi.fn(async () => undefined);
    const [agent, unchanged] = await discoverAgentModelCapabilities(connection, [model(), image], read);
    expect(read).toHaveBeenCalledOnce();
    expect(unchanged).toEqual(image);
    expect(resolveAgentCapabilities(connection, alias, agent).reasoningNotice).toContain("文档未能读取");
  });
});
