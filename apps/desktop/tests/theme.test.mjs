import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { applyThemeSource, readThemeSource, saveThemeSource, themeBackground } from "../src/theme.mjs";

async function removeThemeTestRoot(root) {
  const target = resolve(root);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^supercanvas-theme-test-/);
  await rm(target, { recursive: true, force: true });
}

test("native appearance accepts only the public theme enum without coercion", () => {
  const theme = { themeSource: "system" };
  for (const source of ["light", "dark", "system"]) {
    applyThemeSource(theme, source);
    assert.equal(theme.themeSource, source);
  }
  for (const source of [undefined, null, true, "auto", "DARK", {}, "system "])
    assert.throws(() => applyThemeSource(theme, source), TypeError);
  assert.equal(theme.themeSource, "system");
});

test("window backing color follows native resolved appearance", () => {
  assert.equal(themeBackground({ shouldUseDarkColors: true }), "#0E0F12");
  assert.equal(themeBackground({ shouldUseDarkColors: false }), "#F3F5F7");
});

test("preload exposes a narrow theme IPC method with the unchanged source value", async () => {
  let bridge;
  const calls = [];
  const source = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  vm.runInNewContext(source, { require: () => ({ contextBridge: {
    exposeInMainWorld: (_name, value) => { bridge = value; },
  }, ipcRenderer: { invoke: async (...args) => { calls.push(args); } } }) });
  assert.equal(Object.isFrozen(bridge), true);
  await bridge.setThemeSource("light");
  assert.deepEqual(calls[0], ["desktop:theme-source", "light"]);
});

test("native startup mirror persists only appearance atomically in an isolated profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "supercanvas-theme-test-"));
  try {
    assert.equal(await readThemeSource(root), "system");
    await saveThemeSource(root, "dark");
    assert.equal(await readThemeSource(root), "dark");
    await saveThemeSource(root, "light");
    assert.equal(await readThemeSource(root), "light");
    assert.deepEqual(JSON.parse(await readFile(join(root, "appearance.json"), "utf8")), { source: "light" });
    assert.deepEqual(await readdir(root), ["appearance.json"]);
    await assert.rejects(saveThemeSource(root, "bad"), TypeError);
    assert.equal(await readThemeSource(root), "light");
  } finally { await removeThemeTestRoot(root); }
});

test("native startup mirror rejects malformed, oversized, or invalid enums safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "supercanvas-theme-test-"));
  try {
    for (const content of ["{", "null", '{"source":"auto"}', '{"source":true}', " ".repeat(4096)]) {
      await writeFile(join(root, "appearance.json"), content);
      assert.equal(await readThemeSource(root), "system");
    }
  } finally { await removeThemeTestRoot(root); }
});
