/** Exact IDs whose 2026-10-14 plaza explicitly denies quality control.
 * This is stronger evidence than an omitted field and does not extend to -x,
 * fixed-tier, Azure, or other suppliers' same-name models.
 */
export const CANGYUAN_NO_QUALITY_MODELS: readonly string[] = [
  "gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst",
];
export const cangyuanQualityParameterUnsupported = (id: string): boolean => CANGYUAN_NO_QUALITY_MODELS.includes(id);
export const CANGYUAN_QUALITY_RESTRICTION_SOURCE = {
  sourceUrl: "https://ai.cangyuansuanli.cn/api/pricing", checkedAt: "2026-10-14T23:26:49.630Z",
  sha256: "bab54d0c15649c75168da5bfab07f6ec56064e047cfd30869868d389be0de169",
  statement: "此线路不提供 quality 控制",
} as const;
