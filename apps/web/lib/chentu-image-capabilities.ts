import type {
  ModelDescriptor,
  ModelParameterOption,
} from "@super-canvas/providers";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** The Images capability endpoint is keyed and does not describe native Gemini.
 * Free-size and verified 2.5 routes have a broader, separately documented contract;
 * the endpoint currently returns generic 1K samples for those routes.
 */
export function applyChentuImageCapabilities(
  models: readonly ModelDescriptor[],
  payload: unknown,
  checkedAt: string,
): ModelDescriptor[] {
  const entries =
    record(payload) && payload.success !== false && Array.isArray(payload.data)
      ? payload.data.filter(record)
      : [];
  return models.map((model) => {
    if (
      model.metadata?.canvasRunnable === false ||
      model.metadata?.protocol !== "openai-images"
    )
      return model;
    const fixed = /^gpt-image-2(?:-(1k|2k|4k))?$/iu.exec(model.id);
    const gemini = /^gemini-3(?:\.1-flash|-pro)-image-(1k|2k|4k)$/iu.exec(
      model.id,
    );
    const tier = (fixed ? (fixed[1] ?? "1k") : gemini?.[1])?.toUpperCase();
    if (!tier) return model;
    const entry = entries.find((entry) => entry.model === model.id);
    if (!Array.isArray(entry?.sizes)) return model;
    const options: ModelParameterOption[] = entry.sizes.flatMap((size) => {
      if (!record(size) || typeof size.value !== "string") return [];
      const value = size.value;
      if (value === "auto")
        return [{ label: "自动（提示词优先，其次参考图）", value }];
      const match = /^(\d+)x(\d+)$/u.exec(value);
      if (!match || Number(match[1]) < 16 || Number(match[2]) < 16) return [];
      const ratio = typeof size.ratio === "string" ? size.ratio : "";
      return [
        { label: `${tier} · ${ratio} · ${value.replace("x", " × ")}`, value },
      ];
    });
    if (!options.some((option) => option.value !== "auto")) return model;
    return {
      ...model,
      parameters: model.parameters?.map((parameter) =>
        parameter.key === "size"
          ? {
              ...parameter,
              control: "select" as const,
              default: options.some((o) => o.value === parameter.default)
                ? parameter.default
                : options[0]?.value,
              options,
              description:
                "当前分组 Key 的实时尺寸列表；使用所选模型返回的原始像素值。",
            }
          : parameter,
      ),
      metadata: {
        ...model.metadata,
        imageSizeCapabilitiesSource: "/v1/image/model-capabilities",
        imageSizeCapabilitiesCheckedAt: checkedAt,
      },
    };
  });
}
