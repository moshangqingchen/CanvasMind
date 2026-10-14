/** Keep the user's mask when choosing a different supplier or model. */
export function preserveImageMaskParameters(
  next: Readonly<Record<string, unknown>>,
  previous: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result = { ...next };
  for (const key of ["maskAssetId", "maskSourceAssetId", "mask"])
    if (typeof previous[key] === "string" && previous[key]) result[key] = previous[key];
  return result;
}

/** Keep saved modes during ordinary edits; only an explicit mode change clears them. */
export function imageModeParameters(
  parameters: Readonly<Record<string, unknown>>,
  transparentSupported: boolean,
  mode?: "normal" | "transparent",
): Record<string, unknown> {
  const result = { ...parameters };
  if (transparentSupported) {
    const selectedMode = mode ?? (parameters.background === "transparent" ? "transparent" : "normal");
    // The supplier's optional auto background remains the user's own choice.
    if (mode !== undefined || result.background !== "auto")
      result.background = selectedMode === "transparent" ? "transparent" : "opaque";
    if (selectedMode === "transparent") {
      result.output_format = "png";
      delete result.output_compression;
    }
  } else if (mode === "normal") {
    delete result.background;
  }
  return result;
}
