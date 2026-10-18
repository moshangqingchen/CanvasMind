export const canvasChangedBeforeRunMessage =
  "提交前画布已修改（模型或参数有变化），本次未提交、未产生费用，请确认后重新运行";

/** A coalesced save may finish successfully without persisting this click's graph. */
export async function saveCanvasForRun(
  save: (onSavedRevision: (revision: number) => void) => Promise<void>,
): Promise<number> {
  let savedRevision: number | undefined;
  await save((revision) => { savedRevision = revision; });
  if (savedRevision === undefined) throw new Error(canvasChangedBeforeRunMessage);
  return savedRevision;
}
