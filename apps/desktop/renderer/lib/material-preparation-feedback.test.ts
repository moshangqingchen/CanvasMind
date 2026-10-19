import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ResultFailureFeedback } from "../components/result-failure-feedback";
import { localizeRunError } from "./error-localization";
import { failureDiagnosis } from "./failure-diagnosis";
import { isUnsubmittedReferenceFailure, resultFailureFeedback } from "./result-failure-feedback";

afterEach(() => vi.unstubAllGlobals());

const preparationFailure = {
  message: "素材准备失败，尚未提交生成；当前生成尚未提交。原文件读取超时。", code: "MATERIAL_PREPARATION_FAILED",
  source: "local_validation" as const, phase: "prepare" as const, failureCategory: "local_network" as const,
  submissionMayHaveOccurred: false, charge: { status: "not_charged" as const, source: "not_submitted" as const },
};

it("keeps exact preparation summary and confirmed no-charge guidance through localization and details", () => {
  vi.stubGlobal("React", React);
  const localized = localizeRunError(preparationFailure);
  expect(localized?.phase).toBe("prepare");
  expect(isUnsubmittedReferenceFailure(preparationFailure)).toBe(true);
  expect(resultFailureFeedback(localized, preparationFailure)).toMatchObject({ kind: "references", cause: "素材准备失败，尚未提交生成。" });
  expect(failureDiagnosis(localized, { rawError: preparationFailure }).nextStep).toContain("本次未产生生成费用");
  const html = renderToStaticMarkup(React.createElement(ResultFailureFeedback, { error: localized, rawError: preparationFailure, status: "failed" }));
  for (const text of ["素材准备失败，尚未提交生成", "未产生生成费用", "未扣费", "请求尚未发送（本地确认）"]) expect(html).toContain(text);
  expect(html).not.toMatch(/核对原任务|账单|扣费待确认|暂时无法确认/u);
});

it("never infers no-charge from the material code alone or from accepted-task evidence", () => {
  const accepted = { ...preparationFailure, message: "原任务已提交，恢复素材失败", submissionMayHaveOccurred: true,
    charge: { status: "unknown" as const, source: "unconfirmed" as const } };
  for (const raw of [accepted, { ...preparationFailure, submissionMayHaveOccurred: undefined },
    { ...preparationFailure, charge: undefined }, { ...preparationFailure, charge: { status: "unknown", source: "unconfirmed" } },
    { ...preparationFailure, cloudTaskEvidence: { jobId: "a".repeat(64) } }, { ...preparationFailure, providerTaskId: "original-task" }]) {
    expect(isUnsubmittedReferenceFailure(raw)).toBe(false);
    expect(resultFailureFeedback(localizeRunError(raw), raw).action).not.toContain("未产生生成费用");
  }
  expect(isUnsubmittedReferenceFailure(preparationFailure, "original-task")).toBe(false);
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(React.createElement(ResultFailureFeedback, { error: localizeRunError(accepted), rawError: accepted, taskId: "original-task", status: "needs_attention" }));
  expect(html).toContain("扣费待确认"); expect(html).toContain("核对原任务和账单"); expect(html).toContain("original-task");
  expect(html).not.toContain("未产生生成费用");
  const contradictory = failureDiagnosis(localizeRunError(preparationFailure), { rawError: preparationFailure, providerTaskId: "original-task" });
  expect(contradictory.chargeStatus).toBe("unknown"); expect(contradictory.nextStep).toContain("核对原任务和账单");
  expect(contradictory.chargeSource).not.toContain("请求尚未发送");
});
