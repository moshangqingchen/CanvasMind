import { createHash } from "node:crypto";
import type { ResolvedDirectorConnection } from "@super-canvas/director";
import { countHttpAttempts, recordHttpResult, reserveHttpAttempt, type AttemptIdentity } from "./budget";
import { assertTextModelRequest, makeSecretRedactor } from "./guard";

export type EvaluationSender = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface EvaluationTransport {
  fetch: EvaluationSender;
  stopped: () => string | undefined;
  calls: () => number;
  halt: (reason: string) => void;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** Keep only actually returned usage/cost fields; never infer charges from prices. */
export function returnedAccounting(payload: unknown): Record<string, unknown> {
  const body = record(payload);
  return Object.fromEntries(["usage", "usageMetadata", "cost", "total_cost", "fee", "billing", "cost_details"]
    .filter(key => body[key] !== undefined).map(key => [key, body[key]]));
}

export function accountingFromResponse(raw: string): Record<string, unknown> {
  try { return returnedAccounting(JSON.parse(raw)); } catch { /* SSE is handled below. */ }
  const accounting: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.startsWith("data:")) continue;
    try {
      const event = JSON.parse(line.slice(5).trim()) as unknown;
      Object.assign(accounting, returnedAccounting(event), returnedAccounting(record(event).response));
    } catch { /* Non-JSON terminal markers are not accounting evidence. */ }
  }
  return accounting;
}

function isCompatibilityRejection(status: number, text: string): boolean {
  if (![400, 404, 405, 415, 422].includes(status) || /余额|额度|欠费|鉴权|权限|quota|credit|balance|billing|payment|unauthori|forbidden|api.?key/iu.test(text)) return false;
  return /unsupported|not supported|not support|unknown parameter|unrecognized|not allowed|不支持|未知参数|不允许|endpoint|route|path|method|接口|路径/iu.test(text);
}

export function createEvaluationTransport(options: {
  connection: ResolvedDirectorConnection;
  identity: () => AttemptIdentity;
  inputSummary: () => string;
  ledgerDirectory: string;
  send: EvaluationSender;
  secrets: readonly string[];
  /** Protect enough of the global budget for the later comparison. Defaults to 20. */
  phaseLimit?: number;
}): EvaluationTransport {
  const redact = makeSecretRedactor(options.secrets);
  const phaseLimit = Math.min(40, Math.max(1, options.phaseLimit ?? 20));
  let count = 0;
  let stopReason: string | undefined;
  return {
    stopped: () => stopReason,
    calls: () => count,
    halt: reason => { stopReason ??= redact(reason); },
    fetch: async (input, init) => {
      if (stopReason) throw new Error(`真实评测已停止：${stopReason}`);
      if (count >= phaseLimit) { stopReason = "本阶段预算保留线"; throw new Error(stopReason); }
      const manual = { ...init, redirect: "manual" as const };
      const request = assertTextModelRequest(options.connection, input, manual);
      // Durable reservation MUST happen before the first network instruction.
      const reservation = reserveHttpAttempt(options.ledgerDirectory, options.identity());
      count++;
      const started = performance.now();
      const common = { ...reservation, inputSummary: redact(options.inputSummary()),
        requestCharacters: typeof manual.body === "string" ? manual.body.length : 0,
        requestSha256: createHash("sha256").update(JSON.stringify(request.body)).digest("hex"),
        endpointPath: new URL(request.url).pathname };
      try {
        const response = await options.send(input, manual);
        const raw = await response.text();
        let payload: unknown;
        try { payload = JSON.parse(raw); } catch { payload = undefined; }
        const payloadError = record(payload).error;
        if ((!response.ok && !isCompatibilityRejection(response.status, raw)) || (response.ok && payloadError))
          stopReason = `上游失败 HTTP ${response.status}，不更换模型、不自动重发`;
        recordHttpResult(options.ledgerDirectory, reservation.sequence, JSON.parse(redact(JSON.stringify({ ...common,
          completedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started),
          status: response.status, response: raw, accounting: accountingFromResponse(raw),
          globalReserved: countHttpAttempts(options.ledgerDirectory), ...(stopReason ? { stopReason } : {}),
        }))));
        // Adapters retain their actual parsing/error/fallback behavior. Only headers needed by parsing are preserved.
        return new Response(raw, { status: response.status, statusText: response.statusText,
          headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
      } catch (error) {
        stopReason ??= "网络、超时或结果存档失败；不自动重试";
        // If result persistence itself failed, do not overwrite its immutable evidence.
        try { recordHttpResult(options.ledgerDirectory, reservation.sequence, { ...common,
          completedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started),
          error: redact(error instanceof Error ? error.message : String(error)), stopReason }); }
        catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError; }
        throw new Error(redact(error instanceof Error ? error.message : String(error)));
      }
    },
  };
}
