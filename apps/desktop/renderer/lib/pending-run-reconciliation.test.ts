import { describe, expect, it } from "vitest";
import {
  PENDING_RUN_CREATION_GRACE_MS,
  isPendingGeneratedResultStatus,
  pendingGeneratedResultLabel,
  shouldMarkPendingRunMissing,
} from "./pending-run-reconciliation";

const requestId = "request-1";
const createdAt = "2026-08-24T09:29:16.000Z";
const empty = new Set<string>();

describe("pending run reconciliation", () => {
  it("shows supplier acknowledgement separately from cloud acceptance without hiding failures", () => {
    expect(pendingGeneratedResultLabel("running", "cloud_queued")).toBe("云端已接收，等待派发");
    expect(pendingGeneratedResultLabel("running", "waiting_provider")).toBe("等待供应商响应");
    expect(pendingGeneratedResultLabel("running", "generating")).toBe("正在生成");
    expect(pendingGeneratedResultLabel("submitting", "receiving")).toBe("正在接收供应商结果");
    expect(pendingGeneratedResultLabel("running", "cloud_saving")).toBe("云端正在保存结果");
    expect(pendingGeneratedResultLabel("failed", "generating")).toBe("需要处理");
    expect(pendingGeneratedResultLabel("cancelled", "generating")).toBe("已取消");
  });
  it("distinguishes saving a finished result from a generation still running", () => {
    expect(pendingGeneratedResultLabel("archiving")).toBe("已生成，正在下载保存");
    expect(pendingGeneratedResultLabel("running")).toBe("正在生成");
    expect(pendingGeneratedResultLabel("queued")).toBe("等待开始");
    expect(pendingGeneratedResultLabel("cancel_requested")).toBe("正在取消");
    expect(pendingGeneratedResultLabel("cancelled")).toBe("已取消");
    expect(pendingGeneratedResultLabel("succeeded")).toBe("已完成");
    expect(pendingGeneratedResultLabel("needs_attention")).toBe("需要处理");
  });
  it("only polls statuses that can still transition", () => {
    expect(isPendingGeneratedResultStatus("queued")).toBe(true);
    expect(isPendingGeneratedResultStatus("running")).toBe(true);
    expect(isPendingGeneratedResultStatus("failed")).toBe(false);
    expect(isPendingGeneratedResultStatus("needs_attention")).toBe(false);
    expect(isPendingGeneratedResultStatus("succeeded")).toBe(false);
  });

  it("does not trust a stale lookup that started during submission", () => {
    expect(
      shouldMarkPendingRunMissing({
        requestId,
        generatedCreatedAt: createdAt,
        matchedRequestIds: empty,
        submittingAtFetchStart: new Set([requestId]),
        submittingNow: empty,
        now: Date.parse(createdAt) + PENDING_RUN_CREATION_GRACE_MS + 1,
      }),
    ).toBe(false);
  });

  it("allows slow local run creation to finish during the grace period", () => {
    expect(
      shouldMarkPendingRunMissing({
        requestId,
        generatedCreatedAt: createdAt,
        matchedRequestIds: empty,
        submittingAtFetchStart: empty,
        submittingNow: empty,
        now: Date.parse(createdAt) + 6_000,
      }),
    ).toBe(false);
  });

  it("marks a genuinely missing persisted placeholder after the grace period", () => {
    expect(
      shouldMarkPendingRunMissing({
        requestId,
        generatedCreatedAt: createdAt,
        matchedRequestIds: empty,
        submittingAtFetchStart: empty,
        submittingNow: empty,
        now: Date.parse(createdAt) + PENDING_RUN_CREATION_GRACE_MS,
      }),
    ).toBe(true);
  });

  it("never marks a request that has a matching local run", () => {
    expect(
      shouldMarkPendingRunMissing({
        requestId,
        generatedCreatedAt: createdAt,
        matchedRequestIds: new Set([requestId]),
        submittingAtFetchStart: empty,
        submittingNow: empty,
        now: Date.parse(createdAt) + PENDING_RUN_CREATION_GRACE_MS,
      }),
    ).toBe(false);
  });
});
