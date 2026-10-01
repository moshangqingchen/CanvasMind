import { test } from "node:test";
import assert from "node:assert/strict";
import { exitWaitPresentation } from "../src/exit-policy.mjs";

test("writes-only exit describes saving without claiming generation is running", () => {
  const activity = { activeRuns: 0, activeVerifications: 0, activeWrites: 1, draining: true };
  const before = { ...activity };
  const result = exitWaitPresentation(activity);
  assert.equal(result.title, "正在完成保存与后台写入");
  assert.equal(result.message, "保存与后台写入完成后退出超级画布？");
  assert.match(result.detail, /保存与后台写入：1 项/u);
  assert.doesNotMatch(Object.values(result).join("\n"), /生成|任务/u);
  assert.deepEqual(activity, before);
});

test("generation-only exit names the pending generations", () => {
  const result = exitWaitPresentation({ activeRuns: 2, activeVerifications: 0, activeWrites: 0 });
  assert.equal(result.title, "仍有生成任务正在运行");
  assert.equal(result.message, "生成完成后退出超级画布？");
  assert.match(result.detail, /生成任务：2 个/u);
  assert.doesNotMatch(result.detail, /供应商核验：|保存与后台写入：/u);
});

test("verification-only exit does not double-count verifications as generation", () => {
  const result = exitWaitPresentation({ activeRuns: 3, activeVerifications: 3, activeWrites: 0 });
  assert.equal(result.title, "仍有供应商核验正在进行");
  assert.equal(result.message, "供应商核验完成后退出超级画布？");
  assert.match(result.detail, /供应商核验：3 项/u);
  assert.doesNotMatch(Object.values(result).join("\n"), /生成|任务/u);
});

test("mixed exit shows each existing activity count separately", () => {
  const result = exitWaitPresentation({ activeRuns: 3, activeVerifications: 1, activeWrites: 2 });
  assert.equal(result.title, "仍有操作尚未完成");
  assert.equal(result.message, "这些操作完成后退出超级画布？");
  assert.match(result.detail, /^生成任务：2 个。\n供应商核验：1 项。\n保存与后台写入：2 项。/u);
  assert.match(result.detail, /你可以随时返回软件/u);
});

test("update waiting describes the pending work before restarting", () => {
  for (const [activity, expected] of [
    [{ activeRuns: 0, activeVerifications: 0, activeWrites: 1 }, "保存与后台写入完成后重启并更新？"],
    [{ activeRuns: 1, activeVerifications: 0, activeWrites: 0 }, "生成完成后重启并更新？"],
    [{ activeRuns: 1, activeVerifications: 1, activeWrites: 0 }, "供应商核验完成后重启并更新？"],
    [{ activeRuns: 2, activeVerifications: 1, activeWrites: 1 }, "这些操作完成后重启并更新？"],
  ]) assert.equal(exitWaitPresentation(activity, true).message, expected);
});
