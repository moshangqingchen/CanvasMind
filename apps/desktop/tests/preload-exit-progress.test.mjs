import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("preload forwards exit progress and keeps the legacy draining listener independently removable", () => {
  let bridge;
  const listeners = new Map();
  runInNewContext(readFileSync(new URL("../src/preload.cjs", import.meta.url), "utf8"), {
    require: name => {
      assert.equal(name, "electron");
      return { contextBridge: { exposeInMainWorld: (_name, api) => { bridge = api; } }, ipcRenderer: {
        on: (channel, callback) => listeners.set(channel, callback),
        removeListener: (channel, callback) => { if (listeners.get(channel) === callback) listeners.delete(channel); },
      } };
    },
  });
  const events = [];
  const removeLegacy = bridge.onDraining(value => events.push(["legacy", value]));
  const removeProgress = bridge.onExitProgress(value => events.push(["progress", value]));
  const progress = { phase: "waiting", install: false, activeRuns: 3, activeVerifications: 1, activeWrites: 2 };
  listeners.get("desktop:draining")({}, true);
  listeners.get("desktop:exit-progress")({}, progress);
  assert.deepEqual(events, [["legacy", true], ["progress", progress]]);
  removeProgress(); assert.equal(listeners.has("desktop:exit-progress"), false);
  assert.equal(listeners.has("desktop:draining"), true);
  removeLegacy(); assert.equal(listeners.size, 0);
});
