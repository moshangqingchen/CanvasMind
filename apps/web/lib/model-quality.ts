import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
} from "@super-canvas/providers";

function qualityRank(option: ModelParameterOption): number | undefined {
  const value = String(option.value).trim().toLowerCase();
  const ranks: Record<string, number> = {
    auto: 0,
    low: 1,
    standard: 2,
    medium: 3,
    high: 4,
    hd: 4,
    xhigh: 5,
    ultra: 6,
    max: 7,
    maximum: 7,
    highest: 7,
  };
  if (Object.hasOwn(ranks, value)) return ranks[value];
  // Some image APIs call the resolution tier "quality".
  const resolution = /^(\d+(?:\.\d+)?)(k|p)$/u.exec(value);
  if (resolution)
    return Number(resolution[1]) * (resolution[2] === "k" ? 1000 : 1);
  const label = `${value} ${option.label}`;
  if (/最高|极高|極高/u.test(label)) return 7;
  if (/超高/u.test(label)) return 5;
  if (/高/u.test(label)) return 4;
  if (/中/u.test(label)) return 3;
  if (/标准|標準/u.test(label)) return 2;
  if (/低/u.test(label)) return 1;
  if (/自动|自動/u.test(label)) return 0;
  return undefined;
}

/** Choose only from this model's declared quality options, never invent a tier. */
export function withHighestQualityDefault(
  descriptor: ModelParameterDescriptor,
): ModelParameterDescriptor {
  if (
    descriptor.control !== "select" ||
    !/^(?:quality|image_quality|output_quality)$/iu.test(descriptor.key) ||
    !descriptor.options?.length
  )
    return descriptor;
  let selected: ModelParameterOption | undefined;
  let highest = -1;
  for (const option of descriptor.options) {
    const rank = qualityRank(option);
    if (rank !== undefined && rank > highest) {
      selected = option;
      highest = rank;
    }
  }
  if (!selected) return descriptor;
  const options = descriptor.options.map((option) => {
    if (option.value === selected.value) return option;
    const label = option.label.replace(/\s*[（(]默认[）)]/gu, "");
    return label === option.label ? option : { ...option, label };
  });
  if (
    descriptor.default === selected.value &&
    options.every((o, i) => o === descriptor.options![i])
  )
    return descriptor;
  return { ...descriptor, default: selected.value, options };
}

export function withHighestModelQualityDefault(
  model: ModelDescriptor,
): ModelDescriptor {
  if (!model.parameters) return model;
  const parameters = model.parameters.map(withHighestQualityDefault);
  return parameters.every((p, i) => p === model.parameters![i])
    ? model
    : { ...model, parameters };
}
