import { describe, expect, it } from "vitest";
import { taskConnectionLabel, taskOutcomeLabel, taskOutcomeNote } from "./task-evidence";

describe("supplier task evidence", () => {
  it("shows the saved connection and group, never infers an official supplier from the adapter", () => {
    expect(taskConnectionLabel({ provider: "openai" })).toBe("供应商未记录");
    expect(taskConnectionLabel({ provider: "openai", supplier: "custom:123", connectionName: "secure-skill", modelGroup: "image2.5特价" })).toBe("secure-skill · image2.5特价");
    expect(taskConnectionLabel({ supplier: "chentu", modelGroup: "Sunburst" })).toBe("辰途 API · Sunburst");
    expect(taskConnectionLabel({ connectionName: "辰途 · Sunburst", modelGroup: "Sunburst" })).toBe("辰途 · Sunburst");
  });

  it("distinguishes unknown submission, interrupted polling, remote failure and unsaved success", () => {
    expect(taskOutcomeLabel("needs_attention")).toBe("提交结果未知");
    expect(taskOutcomeLabel("needs_attention", { taskId: "img-1", status: "running" })).toBe("已接单，查询需处理");
    expect(taskOutcomeLabel("needs_attention", { taskId: "img-1", status: "failed" })).toBe("已接单，生成失败");
    expect(taskOutcomeLabel("failed", { taskId: "img-1", status: "succeeded" })).toBe("生成成功，结果保存失败");
    expect(taskOutcomeLabel("needs_attention", undefined, "resume_archive")).toBe("生成成功，结果待取回");
    expect(taskOutcomeNote("needs_attention")).toContain("提交和费用尚未确认");
    expect(taskOutcomeNote("failed", { taskId: "img-1", status: "failed" })).toContain("费用请到供应商核对");
    expect(taskOutcomeLabel("running", { taskId: "img-1", status: "running" })).toBeUndefined();
  });
});
