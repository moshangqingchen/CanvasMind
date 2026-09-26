/** Stable supplier namespace used by both API routes and the settings UI. */
export function supplierKeyForConnection(input: {
  provider: string;
  config?: Readonly<Record<string, unknown>>;
}): string {
  const config = input.config ?? {};
  const preset = typeof config.preset === "string" ? config.preset : "";
  const presetSuppliers: Readonly<Record<string, string>> = {
    "cangyuan-gpt-image-2": "cangyuan",
    "cangyuan-gpt-image-2-4k": "cangyuan",
    "cyberafei-api": "cyberafei",
    "chentu-openai-images": "chentu",
    "frimodel-openai-images": "frimodel",
    "mikoto-pro": "mikoto",
    "miaowu-openai-videos": "miaowu",
  };
  if (presetSuppliers[preset]) return presetSuppliers[preset]!;
  const configured = config.supplierKey;
  return typeof configured === "string" && configured.trim()
    ? configured.trim()
    : input.provider.trim();
}
