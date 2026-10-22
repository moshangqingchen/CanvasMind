import { test } from "node:test";
import assert from "node:assert/strict";
import { createExitProgressReporter, exitProgressPresentation, exitWaitPresentation, makeExitProgress } from "../src/exit-policy.mjs";

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

test("idle and unknown stages never claim they are waiting for tasks", () => {
  const idle = { activeRuns: 0, activeVerifications: 0, activeWrites: 0 };
  for (const phase of ["saving", "checking", "waiting", "closing"]) {
    const unknown = makeExitProgress(phase);
    assert.equal(unknown.activeRuns, null);
    for (const progress of [unknown, makeExitProgress(phase, false, idle)]) {
      const view = exitProgressPresentation(progress);
      assert.doesNotMatch(`${view.title} ${view.message}`, /等待任务|等待生成|安装/u);
      assert.deepEqual(view.details, []);
    }
  }
  assert.equal(exitProgressPresentation().title, "正在准备退出");
});

test("progress separates generation, verification and writes using the lifecycle total", () => {
  for (const [activity, title, details] of [
    [{ activeRuns: 2, activeVerifications: 0, activeWrites: 0 }, "正在等待生成任务完成", ["生成任务：2 个"]],
    [{ activeRuns: 2, activeVerifications: 2, activeWrites: 0 }, "正在等待供应商核验完成", ["供应商核验：2 项"]],
    [{ activeRuns: 0, activeVerifications: 0, activeWrites: 2 }, "正在完成保存与后台写入", ["保存与后台写入：2 项"]],
    [{ activeRuns: 3, activeVerifications: 1, activeWrites: 2 }, "正在等待当前操作完成", ["生成任务：2 个", "供应商核验：1 项", "保存与后台写入：2 项"]],
  ]) {
    const view = exitProgressPresentation(makeExitProgress("waiting", false, activity));
    assert.equal(view.title, title); assert.deepEqual(view.details, details);
    assert.equal(view.canCancel, true);
  }
});

test("install and close have distinct wording and cancellation availability", () => {
  const saving = exitProgressPresentation(makeExitProgress("saving", true));
  assert.equal(saving.title, "正在保存，准备安装更新");
  assert.match(saving.message, /安装已下载的更新/u);
  assert.equal(saving.canCancel, true);
  const closing = exitProgressPresentation(makeExitProgress("closing", true));
  assert.equal(closing.title, "正在关闭软件并启动更新安装");
  assert.equal(closing.canCancel, false);
});

test("diagnostics record stage/count changes once without tasks, credentials, URLs or error bodies", () => {
  const sent = [], logs = [];
  const reporter = createExitProgressReporter({ send: value => sent.push(value), log: value => logs.push(value) });
  const activity = { activeRuns: 2, activeVerifications: 1, activeWrites: 0,
    task: "PRIVATE_TASK", apiKey: "PRIVATE_KEY", url: "https://private.invalid" };
  reporter.progress("saving", true, undefined, 3);
  reporter.event("renderer-acknowledged");
  reporter.progress("checking", true, undefined, 3);
  reporter.progress("waiting", true, activity, 3);
  for (let index = 0; index < 5; index++) reporter.progress("waiting", true, activity, 3);
  reporter.progress("waiting", true, { ...activity, activeWrites: 1 }, 3);
  reporter.error("PRIVATE_ERROR https://private.invalid");
  reporter.event("cancelled");
  assert.equal(sent.length, 5);
  assert.equal(logs.length, 7);
  assert.doesNotMatch(logs.join("\n"), /PRIVATE|https:|task|apiKey/u);
  assert.doesNotMatch(JSON.stringify(sent.slice(0, -1)), /PRIVATE|https:|task|apiKey/u);
  assert.equal(sent.at(-1).error, "PRIVATE_ERROR https://private.invalid");
  reporter.progress("saving", false, undefined, 4);
  assert.equal(sent.at(-1).install, false);
});
