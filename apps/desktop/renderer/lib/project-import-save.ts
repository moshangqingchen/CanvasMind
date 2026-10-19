import { CanvasSaveConflictError, CanvasSaveRejectedError, type CanvasResponse } from "./client-api";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

export class ImportSaveUncertainError extends Error {
  constructor(cause: unknown) {
    super("导入结果未知，素材已保留；请重新读取画布确认，勿重复导入", { cause });
    this.name = "ImportSaveUncertainError";
  }
}

export function importSaveDefinitelyRejected(error: unknown): boolean {
  return error instanceof CanvasSaveRejectedError ||
    (error instanceof CanvasSaveConflictError && error.definitelyRejected);
}

/** Only a matching, durable save acknowledgement authorizes applying the imported graph. */
export async function confirmImportedCanvasSave(options: {
  expected: Pick<CanvasResponse, "id" | "title" | "graph">;
  save: () => Promise<CanvasResponse | undefined>;
  read: () => Promise<CanvasResponse>;
}): Promise<CanvasResponse> {
  const matches = (saved: CanvasResponse | undefined): saved is CanvasResponse => Boolean(saved &&
    saved.id === options.expected.id && saved.title === options.expected.title &&
    Number.isSafeInteger(saved.revision) && saved.revision > 0 &&
    JSON.stringify(canonical(saved.graph)) === JSON.stringify(canonical(options.expected.graph)));
  let firstError: unknown;
  try {
    const saved = await options.save();
    if (matches(saved)) return saved;
    throw new ImportSaveUncertainError(new Error("保存队列未确认导入快照"));
  } catch (error) {
    if (importSaveDefinitelyRejected(error)) throw error;
    firstError = error;
  }
  try {
    // A negative read never proves an in-flight PUT will not commit later.
    if (matches(await options.read())) {
      // Reuse the existing same-graph save + flush path, not an in-memory GET acknowledgement.
      const saved = await options.save();
      if (matches(saved)) return saved;
    }
  } catch { /* Preserve originals after any ambiguous attempt, including a later 409. */ }
  throw new ImportSaveUncertainError(firstError);
}
