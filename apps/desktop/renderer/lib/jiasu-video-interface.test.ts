import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { jiasuVideoModelIds, scanProviderModelCatalog } from "@super-canvas/providers";
import { applySavedModelInterfaces, discoverSupplierModelInterfaces } from "./supplier-interface-discovery";
import { guardNativeVideoRunnableContract } from "./native-video-runnable-contract";

const connection = { provider: "openai", config: { baseUrl: "https://ai.jiasuapi.com/v1", accountKeyGroup: "vip", supplierGroupId: "24", usage: "canvas", modelScanStatus: "live", scannedModelIds: jiasuVideoModelIds() } };

describe("Jiasu video directory and interface binding", () => {
  it("keeps the video menu unavailable for mismatched Key groups and disabled canvas usage", () => {
    const model: ModelDescriptor = { id: "sd-2.0-J2", name: "Jiasu video", operations: ["video.generate"],
      outputKinds: ["video"], metadata: { canvasRunnable: true } };
    expect(guardNativeVideoRunnableContract(connection, model).metadata?.canvasRunnable).toBe(true);
    for (const changes of [{ modelGroup: "another-group" }, { usage: "agent" }, { usage: "disabled" }]) {
      const result = guardNativeVideoRunnableContract({ ...connection, config: { ...connection.config, ...changes } }, model);
      expect(result.metadata?.canvasRunnable).toBe(false);
      expect(result.metadata?.parameterControlsUnavailable).toBe(true);
    }
    expect(model.metadata?.canvasRunnable).toBe(true);
  });
  it("applies the same exact native contract to every Key-visible published video ID", async () => {
    const scan = scanProviderModelCatalog({ data: jiasuVideoModelIds().map(id => ({ id })) }, { baseUrl: connection.config.baseUrl, modelGroup: "vip" });
    const read = vi.fn(async () => []);
    const result = await discoverSupplierModelInterfaces(connection, scan.models, connection, read);
    expect(result.bindings).toEqual({});
    expect(read).not.toHaveBeenCalled();
    expect(result.models.every(model => model.metadata?.canvasRunnable === true && model.metadata?.endpointPath === "/v1/video/generations" && model.outputKinds?.includes("video"))).toBe(true);
    expect(result.models.find(model => model.id === "sd-2.0-mini-J1")?.parameters?.find(parameter => parameter.key === "duration")?.constraints).toEqual(expect.arrayContaining([expect.objectContaining({ max: 12 })]));
  });

  it("shows exact vip observed generation resolutions while preserving published price evidence", () => {
    const ids = ["sd-2.5-J2", "doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628"];
    const scan = scanProviderModelCatalog({ data: ids.map(id => ({ id })) }, { baseUrl: connection.config.baseUrl, modelGroup: "vip" });
    const officialPrice = { resolution: "480p", unitAmount: 0.4, unit: "second", sourceUrl: "https://ai.jiasuapi.com/api/pricing" };
    const originals = scan.models.map(model => ({ ...model, metadata: { ...model.metadata, officialCatalogPricing: officialPrice } }));
    const result = applySavedModelInterfaces(connection, originals);
    for (const model of result) {
      expect(model.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(model.id === "sd-2.5-J2" ? ["720p", "1080p"] : ["720p"]);
      expect(model.metadata?.jiasuResolutionEvidence).toMatchObject({ sourceUrl: "https://ai.jiasuapi.com", group: "vip", modelId: model.id });
      expect(model.metadata?.officialCatalogPricing).toEqual(officialPrice);
    }
    expect(connection.config.accountKeyGroup).toBe("vip");
    const another = applySavedModelInterfaces({ ...connection, config: { ...connection.config, accountKeyGroup: "another-group", modelGroup: "another-group" } }, originals);
    expect(another.find(model => model.id === "sd-2.5-J2")?.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toContain("480p");
    expect(another.every(model => model.metadata?.jiasuResolutionEvidence === undefined)).toBe(true);
  });

  it("restores missing-protocol metadata without discarding saved prices and rejects another Key's missing IDs", () => {
    const old: ModelDescriptor = { id: "sd-2.0-J2", name: "saved full ID", operations: ["video.generate"], outputKinds: ["video"], pricing: { kind: "per-request", currency: "USD", unitAmount: 0.25, confidence: "exact", checkedAt: "2026-10-09", sourceUrl: "https://ai.jiasuapi.com/api/pricing" },
      metadata: { canvasRunnable: false, autoInterfaceStatus: "incomplete", canvasUnavailableReason: "视频调用协议待供应商文档确认", operationsSource: "declared", outputKindsSource: "declared" } };
    const restored = applySavedModelInterfaces(connection, [old])[0]!;
    expect(restored.metadata?.canvasRunnable).toBe(true);
    expect(restored.pricing).toEqual(old.pricing);
    expect(restored.id).toBe(old.id);
    const unavailable = applySavedModelInterfaces({ ...connection, config: { ...connection.config, scannedModelIds: ["grok-1.5"] } }, [old])[0]!;
    expect(unavailable.metadata?.canvasRunnable).toBe(false);
    const mismatch = applySavedModelInterfaces({ ...connection, config: { ...connection.config, modelGroup: "different-group" } }, [old])[0]!;
    expect(mismatch.metadata?.canvasRunnable).toBe(false);
  });

  it("preserves authentication and explicit output exclusions while refreshing matching group interfaces", () => {
    const denied: ModelDescriptor = { id: "sd-2.0-J2", name: "denied", operations: ["video.generate"], outputKinds: ["video"], metadata: { canvasRunnable: false, canvasUnavailableReason: "403 当前分组无权限" } };
    expect(applySavedModelInterfaces(connection, [denied])[0]?.metadata?.canvasRunnable).toBe(false);
    const chat: ModelDescriptor = { id: "sd-2.0-J2", name: "explicit text", operations: [], outputKinds: ["text"], metadata: { canvasRunnable: false, catalogCapability: "text", outputKindsSource: "declared", operationsSource: "declared", canvasUnavailableReason: "尚未验证该模型的画布调用协议" } };
    expect(applySavedModelInterfaces(connection, [chat])[0]?.outputKinds).toEqual(["text"]);
    for (const usage of ["disabled", "agent"]) {
      expect(applySavedModelInterfaces({ ...connection, config: { ...connection.config, usage } }, [chat])[0]?.metadata?.canvasRunnable).toBe(false);
    }
    const manual = { ...chat, metadata: { ...chat.metadata, source: "manual" } };
    expect(applySavedModelInterfaces(connection, [manual])[0]).toEqual(manual);
  });
});
