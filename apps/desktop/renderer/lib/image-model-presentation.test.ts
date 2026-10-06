import { describe, expect, it } from "vitest";
import type { ProviderConnectionView } from "./client-api";
import type { ModelDescriptor } from "@super-canvas/providers";
import { retainedImageModelForDisplay } from "./image-model-presentation";
import { modelImageCapabilities } from "./model-image-capabilities";

const model: ModelDescriptor = { id: "gpt-image-2-1k", name: "Image 2 1K", operations: ["image.generate", "image.edit"] };
const connection: ProviderConnectionView = { id: "image", name: "IMAGE", provider: "rest", apiKey: "", apiKeySet: true,
  config: { baseUrl: "https://ai.cangyuansuanli.cn", modelScanStatus: "live", modelCatalogModels: [model] } };

describe("selected image capability display while checking inventory", () => {
  it("retains only the exact previously confirmed selection during loading or failure", () => {
    for (const state of [{ loading: true }, { failed: true }]) {
      expect(retainedImageModelForDisplay(connection, model.id, { connectionId: "image", items: [], authoritative: true, ...state })).toBe(model);
      expect(modelImageCapabilities(connection, retainedImageModelForDisplay(connection, model.id,
        { connectionId: "image", items: [], authoritative: true, ...state })!).mask).toBe("url");
      expect(retainedImageModelForDisplay(connection, "different", { connectionId: "image", items: [], ...state })).toBeNull();
    }
  });
  it("does not revive a missing model after a completed empty scan or borrow another group's catalog", () => {
    expect(retainedImageModelForDisplay(connection, model.id, { connectionId: "image", items: [], authoritative: true, loading: false })).toBeNull();
    expect(retainedImageModelForDisplay(connection, model.id, { connectionId: "other", items: [], loading: true })).toBeNull();
    expect(retainedImageModelForDisplay({ ...connection, config: { ...connection.config, modelScanStatus: "empty" } }, model.id,
      { connectionId: "image", items: [], failed: true })).toBeNull();
  });
  it("retaining a schema cannot override an unavailable or disabled model's capability gates", () => {
    const disabled = { ...model, metadata: { canvasRunnable: false } };
    const configured = { ...connection, config: { ...connection.config, modelCatalogModels: [disabled] } };
    const display = retainedImageModelForDisplay(configured, model.id, { connectionId: "image", items: [], loading: true });
    expect(modelImageCapabilities(configured, display!)).toEqual({ transparent: false, mask: null });
  });
});
