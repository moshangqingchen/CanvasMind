import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One task-wide ledger, shared by baseline, after, repair and compatibility calls. */
export const REAL_HTTP_LIMIT = 40;
export interface AttemptIdentity {
  phase: "baseline" | "after" | "retest";
  caseId: string;
  connectionId: string;
  modelId: string;
  intent: "auto" | "chat" | "canvas-plan";
}
export interface Reservation extends AttemptIdentity { sequence: number; reservedAt: string }
export class EvaluationBudgetExhausted extends Error {
  constructor() { super("真实模型 HTTP 调用总上限 40 已到，停止调用（失败和中断也计入）。"); }
}

function durableExclusiveJson(path: string, value: unknown): void {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fsyncSync(fd); }
  finally { closeSync(fd); }
}

/**
 * Exclusive slot creation is the counter. It needs no read/modify/write lock,
 * survives crashes and cannot overspend when independent processes race.
 * A partial/crashed reservation still consumes its slot; slots are never freed.
 */
export function reserveHttpAttempt(directory: string, identity: AttemptIdentity): Reservation {
  mkdirSync(directory, { recursive: true });
  for (let sequence = 1; sequence <= REAL_HTTP_LIMIT; sequence++) {
    const reservation = { ...identity, sequence, reservedAt: new Date().toISOString() };
    try {
      durableExclusiveJson(join(directory, `${String(sequence).padStart(4, "0")}.reserve.json`), reservation);
      return reservation;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new EvaluationBudgetExhausted();
}

export function countHttpAttempts(directory: string): number {
  try { return readdirSync(directory).filter(name => /^00(?:0[1-9]|[12]\d|3\d|40)\.reserve\.json$/u.test(name)).length; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
}

export function recordHttpResult(directory: string, sequence: number, value: unknown): void {
  durableExclusiveJson(join(directory, `${String(sequence).padStart(4, "0")}.result.json`), value);
}

export function writeExclusiveJson(path: string, value: unknown): void { durableExclusiveJson(path, value); }
