export interface ImageTransparencyPresentation {
  status: "verified" | "inferred" | "declared" | "rejected" | "unverified";
  note: string;
}

/** The provider owns exact supplier/group/model/operation evidence and restrictions. */
export function imageTransparencyEvidenceNote(evidence?: ImageTransparencyPresentation): string | undefined {
  if (!evidence?.note.trim()) return undefined;
  const labels = {
    verified: "透明已实测",
    inferred: "透明推定可用",
    declared: "透明接口声明",
    rejected: "透明限制",
    unverified: "透明资料未证实",
  };
  return `${labels[evidence.status]}：${evidence.note}`;
}
