import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { countHttpAttempts, EvaluationBudgetExhausted, REAL_HTTP_LIMIT, reserveHttpAttempt } from "./budget";
import { EVALUATION_TEMP } from "./paths";
const identity = { phase: "baseline" as const, caseId: "test", connectionId: "fake", modelId: "fake", intent: "chat" as const };
function directory() { mkdirSync(EVALUATION_TEMP, { recursive: true }); return mkdtempSync(join(EVALUATION_TEMP, "budget-test-")); }

describe("persistent task-wide HTTP budget", () => {
  it("consumes failed/crashed slots and shares the cap across phases", () => {
    const dir = directory();
    writeFileSync(join(dir, "0001.reserve.json"), "partial reservation");
    for (let index = 2; index <= REAL_HTTP_LIMIT; index++) {
      expect(reserveHttpAttempt(dir, { ...identity, phase: index > 20 ? "after" : "baseline" }).sequence).toBe(index);
    }
    expect(countHttpAttempts(dir)).toBe(40);
    expect(() => reserveHttpAttempt(dir, { ...identity, phase: "retest" })).toThrow(EvaluationBudgetExhausted);
  });

  it("independent processes cannot create a 41st slot", async () => {
    const dir = directory();
    const modulePath = join(dir, "budget.cjs");
    writeFileSync(modulePath, ts.transpileModule(readFileSync(new URL("./budget.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
    const program = `const {reserveHttpAttempt}=require(process.argv[1]);for(let i=0;i<20;i++){try{reserveHttpAttempt(process.argv[2],${JSON.stringify(identity)})}catch(e){if(e.constructor.name!=='EvaluationBudgetExhausted')throw e}}`;
    await Promise.all(Array.from({ length: 5 }, () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", program, modulePath, dir], { stdio: ["ignore", "ignore", "pipe"] });
      let error = ""; child.stderr.on("data", chunk => { error += String(chunk); });
      child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(error)));
    })));
    expect(countHttpAttempts(dir)).toBe(40);
  });
});
