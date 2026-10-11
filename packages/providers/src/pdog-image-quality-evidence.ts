export interface PdogAcceptedImageQualityEvidence {
  readonly value: "max";
  readonly source: "historical-accepted-request";
  readonly checkedAt: "2026-10-05";
  readonly reviewedAt: "2026-10-11";
  readonly hostname: "ai.whyshy.cn";
  readonly group: string;
  readonly supplierGroupId: "14";
  readonly fullModelId: string;
  readonly operation: "image.generate";
  readonly transport: {
    readonly kind: "pdog-async";
    readonly path: "/v1/images/generations/async";
    readonly method: "POST";
    readonly bodyMode: "json";
  };
  readonly request: {
    readonly quality: "max";
    readonly size: "3840x2160";
    readonly n: 1;
    readonly background: "transparent";
    readonly output_format: "png";
  };
  readonly output: {
    readonly width: 3840;
    readonly height: 2160 | 2161;
    readonly format: "png";
    readonly hasAlpha: false;
    readonly transparentPixels: 0;
    readonly requestedDimensionsMatched: boolean;
    readonly sha256: string;
  };
  readonly caseId: string;
  readonly billingMatch: "exact-model-group-time-window-and-balance-delta;no-task-id-join";
}

const UPSCALING_GROUP = "【生图】image2/2.5-1K2K4K(超分组)";
const SAMPLES = [
  { model: "gpt-image-2.5", caseId: "082", height: 2160,
    sha256: "defcf1fe86c600291154d1fd7e842e9f4fe632d62d521e96fed2b351a08284bb" },
  { model: "gpt-image-2.5-flare", caseId: "083", height: 2161,
    sha256: "a11b99ab68e12422b59c4a5c4b732c782bf988058327e180993710b430fcd07b" },
  { model: "gpt-image-2.5-sunburst", caseId: "084", height: 2161,
    sha256: "e7e9ef6935a98fb3bd540125d7631964cdd17f9286a72948d81bda6067ab5590" },
] as const;

/** Accepted generation quality is independent of transparency and exact output dimensions.
 * Sources: docs/image-presets-quality-2026-10-11.md and the original cases 082–084.
 * This never promotes application presets, another group, or an edit into measured support.
 */
export function pdogAcceptedImageQualityEvidence(config: Readonly<Record<string, unknown>>,
  model: string | undefined): PdogAcceptedImageQualityEvidence | undefined {
  if (config.manualProtocol === true || config.supplierArchived === true ||
    ["agent", "disabled"].includes(String(config.usage))) return;
  let url: URL;
  try { url = new URL(String(config.baseUrl ?? "")); } catch { return; }
  if (url.protocol !== "https:" || url.hostname !== "ai.whyshy.cn" || url.port ||
    url.username || url.password || url.search || url.hash || !/^(?:\/v1)?\/?$/u.test(url.pathname)) return;
  if (config.accountKeyGroup !== undefined && config.modelGroup !== undefined &&
    config.accountKeyGroup !== config.modelGroup) return;
  // Stable group identity survives renames; a different explicit ID cannot fall back to a label.
  const matchesGroup = config.accountKeyGroupId !== undefined
    ? String(config.accountKeyGroupId) === "14"
    : String(config.accountKeyGroup ?? config.modelGroup ?? "") === UPSCALING_GROUP;
  if (!matchesGroup) return;
  const sample = SAMPLES.find(row => row.model === model);
  if (!sample) return;
  return {
    value: "max", source: "historical-accepted-request", checkedAt: "2026-10-05", reviewedAt: "2026-10-11",
    hostname: "ai.whyshy.cn", group: UPSCALING_GROUP, supplierGroupId: "14", fullModelId: sample.model,
    operation: "image.generate",
    transport: { kind: "pdog-async", path: "/v1/images/generations/async", method: "POST", bodyMode: "json" },
    request: { quality: "max", size: "3840x2160", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: sample.height, format: "png", hasAlpha: false, transparentPixels: 0,
      requestedDimensionsMatched: sample.height === 2160, sha256: sample.sha256 },
    caseId: sample.caseId,
    billingMatch: "exact-model-group-time-window-and-balance-delta;no-task-id-join",
  };
}
