import type { ModelDescriptor } from "./contracts.js";
import type { ImageEditingConnection } from "./image-editing-capabilities.js";
import { applyVerifiedImageEditingCapabilities } from "./image-editing-capabilities.js";
import { applyCOpenImageCapabilities } from "./c-open-image-contract.js";
import { applyBananaImageCapabilities } from "./banana-image-contract.js";
import { applyChuangxiangCurrentImageCapabilities } from "./chuangxiang-image-contract.js";
import { applyPdogImageCapabilities } from "./pdog-image-contract.js";
import { applyJiasuImageCapabilities } from "./jiasu-image-contract.js";
import { secureSeedreamImageContract } from "./secure-seedream-image-contract.js";
import { applySecureSkillImageCapabilities } from "./secure-skill-image-contract.js";
import { applyJijiuImageCapabilities } from "./jijiu-image-contract.js";
import { applySupplierImageConstraints } from "./supplier-image-constraints.js";
import { applyUserImageSizePresets } from "./image-size-presets.js";

/**
 * Rebuild the shared image contract from an already-read, exact model record.
 * Each supplier projection retains its own origin/group/model guard. This is
 * pure: it neither discovers models nor changes a connection or saved choice.
 * Keep transport-specific enrichment upstream and application presets last.
 */
export function resolveImageModelContract(
  connection: ImageEditingConnection,
  model: ModelDescriptor,
): ModelDescriptor {
  if (connection.config.manualProtocol === true || model.metadata?.source === "manual" ||
      model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test") return model;
  let current = applyCOpenImageCapabilities(connection, model);
  current = applyBananaImageCapabilities(connection, current);
  current = applyChuangxiangCurrentImageCapabilities(connection, current);
  current = applyPdogImageCapabilities(connection, current);
  current = applyJiasuImageCapabilities(connection, current);
  current = secureSeedreamImageContract(connection, current);
  current = applySecureSkillImageCapabilities(connection, current);
  current = applyJijiuImageCapabilities(connection, current);
  current = applySupplierImageConstraints(connection, current);
  current = applyVerifiedImageEditingCapabilities(connection, current);
  return applyUserImageSizePresets(current);
}

export { secureSeedreamImageContract } from "./secure-seedream-image-contract.js";
