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

/** Transparent output is explicit and always lossless; unsupported models stay normal. */
export function imageModeParameters(
  parameters: Readonly<Record<string, unknown>>,
  transparentSupported: boolean,
  mode: "normal" | "transparent" = parameters.background === "transparent" ? "transparent" : "normal",
): Record<string, unknown> {
  const result = { ...parameters };
  if (transparentSupported) {
    result.background = mode === "transparent" ? "transparent" : "opaque";
    if (mode === "transparent") {
      result.output_format = "png";
      delete result.output_compression;
    }
  } else {
    delete result.background;
  }
  return result;
}
