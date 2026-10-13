import type { ModelDescriptor } from "@super-canvas/providers";
import { resolveImageModelContract } from "@super-canvas/providers/image-model-contract";
import type { ProviderConnectionView } from "./client-api";
import { withWeAiImage25RequestParameters } from "./new-image-generation-default";

/** Saved catalogs and live scans must use the same exact request contracts. */
export function withCurrentImageRequestParameters(
  connection: ProviderConnectionView,
  models: readonly ModelDescriptor[],
): ModelDescriptor[] {
  return withWeAiImage25RequestParameters(connection, models)
    .map(model => resolveImageModelContract(connection, model));
}
