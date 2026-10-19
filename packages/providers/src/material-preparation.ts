import { ProviderHttpError } from "./http.js";

/** Free input preparation, before the adapter can send its generation request. */
export type MaterialPreparationStage = "read" | "initialize" | "sign" | "upload" | "verify";

/**
 * This is deliberately not a ProviderHttpError: an upload request may have been
 * sent, while the generation request has not. Never use HTTP requestNotSent to
 * describe that distinction or make the whole adapter submission retryable.
 */
export class MaterialPreparationError extends Error {
  override readonly name = "MaterialPreparationError";
  readonly code = "MATERIAL_PREPARATION_FAILED";
  constructor(readonly stage: MaterialPreparationStage, options: { cause?: unknown; detail?: string } = {}) {
    // detail is application-owned text, never an upstream response or signed URL.
    const status = options.cause instanceof ProviderHttpError ? options.cause.details.status : undefined;
    super(`素材准备失败，尚未提交生成；当前生成尚未提交。${status === undefined ? "" : ` HTTP ${status}。`}${options.detail ? ` ${options.detail}` : ""}`, { cause: options.cause });
  }
}

/** Call only around a free preparation step, never around adapter.submit(). */
export async function prepareMaterial<T>(stage: MaterialPreparationStage, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (cause) {
    if (cause instanceof MaterialPreparationError) throw cause;
    throw new MaterialPreparationError(stage, { cause });
  }
}

