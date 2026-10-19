import { normalizeProjectName } from "@super-canvas/storage/project-name";

export { normalizeProjectName };

/** Browser-safe identity key; the same pure normalizer also names directories. */
export function projectTitleKey(title: string): string {
  return normalizeProjectName(title).normalize("NFC").toLocaleLowerCase();
}
