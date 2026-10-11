import type { ModelDescriptor } from "@super-canvas/providers";
import { applyUserImageSizePresets } from "@super-canvas/providers/image-size-presets";
import { applyBananaImageCapabilities } from "@super-canvas/providers/banana-image-contract";
import { applyChuangxiangCurrentImageCapabilities } from "@super-canvas/providers/chuangxiang-image-contract";
import { applyPdogImageCapabilities } from "@super-canvas/providers/pdog-image-contract";
import { applyJiasuImageCapabilities } from "@super-canvas/providers/jiasu-image-contract";
import { applyJijiuImageCapabilities } from "@super-canvas/providers/jijiu-image-contract";
import { applySupplierImageConstraints } from "@super-canvas/providers/supplier-image-constraints";
import type { ProviderConnectionView } from "./client-api";
import { withWeAiImage25RequestParameters } from "./new-image-generation-default";
import { secureSeedreamImageContract } from "./secure-seedream-image-contract";

/** Saved catalogs and live scans must use the same exact request contracts. */
export function withCurrentImageRequestParameters(
  connection: ProviderConnectionView,
  models: readonly ModelDescriptor[],
): ModelDescriptor[] {
  return withWeAiImage25RequestParameters(connection, models).map(model => {
    const current = applyJijiuImageCapabilities(connection, secureSeedreamImageContract(connection, applyJiasuImageCapabilities(connection, applyPdogImageCapabilities(connection, applyChuangxiangCurrentImageCapabilities(connection,
      applyBananaImageCapabilities(connection, model))))));
    try {
      return applyUserImageSizePresets(new URL(String(connection.config.baseUrl ?? "")).hostname === "api.mikoto.vip"
        ? applySupplierImageConstraints(connection, current) : current);
    } catch { return applyUserImageSizePresets(current); }
  });
}
