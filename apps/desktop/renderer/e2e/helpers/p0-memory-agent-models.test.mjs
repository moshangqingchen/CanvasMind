import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "../../node_modules/typescript/lib/typescript.js";

const source = await readFile(new URL("./p0-memory-agent-models.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { readAgentModelsMemoryBytes, createAgentModelsMemoryPayload } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("Agent model payload byte option is explicit and bounded", () => {
  assert.equal(readAgentModelsMemoryBytes(""), 0);
  assert.equal(readAgentModelsMemoryBytes("0"), 0);
  assert.equal(readAgentModelsMemoryBytes("524288"), 524288);
  for (const value of ["NaN", "-1", "1", "4096.5", "4194305"])
    assert.throws(() => readAgentModelsMemoryBytes(value));
});

test("256/512 KiB synthetic Agent responses are exact, equal-valued and parse to fresh object graphs", () => {
  for (const bytes of [4096, 256 * 1024, 512 * 1024]) {
    const first = createAgentModelsMemoryPayload(bytes, "isolated-fake");
    const second = createAgentModelsMemoryPayload(bytes, "isolated-fake");
    assert.equal(Buffer.byteLength(first.body), bytes);
    assert.equal(first.body, second.body);
    assert.equal(first.sha256, second.sha256);
    const a = JSON.parse(first.body), b = JSON.parse(second.body);
    assert.deepEqual(a, b); assert.notEqual(a, b); assert.notEqual(a[0], b[0]);
    assert.equal(a.length, first.modelCount);
    for (const item of a) {
      assert.equal(item.connectionId, "isolated-fake");
      assert.equal(item.available, false);
      assert.ok(item.metadata.p0RepeatedPayload.startsWith("P0_AGENT_MODEL_PAYLOAD_"));
      assert.equal(item.pricing.kind, "token");
      assert.equal(item.capabilities.text, true);
    }
    assert.doesNotMatch(first.body, /https?:\/\//u);
    assert.equal(first.credentials, 0);
  }
});
