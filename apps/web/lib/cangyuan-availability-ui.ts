import type { ModelDescriptor } from "@super-canvas/providers";
import type { CangyuanAvailabilityView } from "./client-api";

function canonicalModelName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(][^()（）]*(?:[)）]|$)/gu, "")
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

/** Matches the availability API's model names to canvas descriptors. */
export function cangyuanAvailabilityForModel(
  model: Pick<ModelDescriptor, "id" | "name">,
  items: readonly CangyuanAvailabilityView[],
): CangyuanAvailabilityView | undefined {
  const exactId = model.id.trim().toLowerCase();
  const exactMatch = items.find(
    (item) => item.name.trim().toLowerCase() === exactId,
  );
  if (exactMatch) return exactMatch;

  const candidates = new Set([
    canonicalModelName(model.id),
    canonicalModelName(model.name),
  ]);
  return items.find((item) => candidates.has(canonicalModelName(item.name)));
}
