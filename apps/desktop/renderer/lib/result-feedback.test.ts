import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isUnsubmittedReferenceFailure, resultFailureFeedback } from "./result-failure-feedback";
import { placeResultToolbar, resultToolbarUsableArea } from "./result-toolbar-placement";
import { localizeRunError } from "./error-localization";
import { ResultFailureFeedback } from "../components/result-failure-feedback";
import { canReverseResultPrompt, ResultActions } from "../components/result-actions";
import { ReactFlowProvider } from "@xyflow/react";
import type { CanvasNodeData } from "../components/types";

afterEach(() => vi.unstubAllGlobals());

describe("result failure feedback", () => {
  const referenceFailure = (message = "本机素材通道原文件检查失败（第 2 项素材：公网读取中断或连接失败）；当前生成尚未提交。") => ({
    message, code: "LOCAL_REFERENCE_ASSET_PREFLIGHT_FAILED", type: "本机素材通道检查失败",
    source: "local_validation" as const, failureCategory: "local_network" as const, phase: "submit" as const,
    submissionMayHaveOccurred: false, charge: { status: "not_charged" as const, source: "not_submitted" as const },
  });

  it.each(["公网读取中断或连接失败", "公网读取超时", "HTTP 403，当前生成尚未提交"])(
    "explains confirmed unsubmitted references before generic network classification: %s", message => {
      const raw = referenceFailure(message), saved = structuredClone(raw);
      const feedback = resultFailureFeedback(localizeRunError(raw), raw);
      expect(feedback).toMatchObject({ kind: "references", raw: message });
      expect(feedback.cause).toContain("参考素材准备失败");
      expect(feedback.cause).toContain("尚未提交生成");
      expect(feedback.action).toContain("未产生生成费用");
      expect(feedback.action).toContain("程序会先重新检查素材链接");
      expect(`${feedback.cause}${feedback.action}`).not.toMatch(/核对原任务|无法确认|账单|可能扣费/u);
      expect(raw).toEqual(saved);
    },
  );

  it("does not infer non-submission from a reference code or absent task ID without complete evidence", () => {
    const original = referenceFailure();
    for (const error of [
      { ...original, source: undefined },
      { ...original, submissionMayHaveOccurred: undefined },
      { ...original, submissionMayHaveOccurred: true },
      { ...original, charge: { status: "unknown" as const, source: "unconfirmed" as const } },
      { ...original, charge: { status: "charged" as const, source: "provider_response" as const } },
      { ...original, charge: { status: "not_charged" as const, source: "not_submitted" as const, amount: 0.2 } },
      { ...original, charge: undefined },
    ]) {
      expect(isUnsubmittedReferenceFailure(error)).toBe(false);
      const feedback = resultFailureFeedback(error);
      expect(feedback.kind).toBe("network");
      expect(feedback.cause).toContain("暂时无法确认原任务状态");
      expect(feedback.action).toContain("核对原任务");
      expect(feedback.action).not.toContain("未产生生成费用");
    }
  });

  it("renders both summary and expanded diagnosis for unsubmitted references without unknown-task guidance", () => {
    vi.stubGlobal("React", React);
    const raw = referenceFailure();
    const markup = renderToStaticMarkup(React.createElement(ResultFailureFeedback, {
      error: localizeRunError(raw), rawError: raw, runId: "local-preflight-only", status: "failed",
    }));
    for (const text of ["参考素材准备失败", "尚未提交生成", "未产生生成费用", "本地校验原文", raw.message,
      "请求尚未发送（本地确认）", "未扣费", "local-preflight-only"])
      expect(markup).toContain(text);
    expect(markup).not.toMatch(/暂时无法确认原任务状态|核对原任务|扣费待确认|可能扣费/u);
    expect(markup).toContain("供应商任务编号");
    expect(markup).toContain("未取得");
  });

  it("preserves uncertain submitted network failures and their billing warning", () => {
    vi.stubGlobal("React", React);
    const raw = { message: "网络连接中断", failureCategory: "network" as const, source: "provider_response" as const,
      phase: "poll" as const, submissionMayHaveOccurred: true,
      charge: { status: "unknown" as const, source: "unconfirmed" as const } };
    const markup = renderToStaticMarkup(React.createElement(ResultFailureFeedback, {
      error: localizeRunError(raw), rawError: raw, taskId: "accepted-provider-task", status: "failed",
    }));
    expect(markup).toContain("暂时无法确认原任务状态");
    expect(markup).toContain("核对原任务");
    expect(markup).toContain("扣费待确认");
    expect(markup).not.toContain("本次未产生生成费用");
  });

  it.each([
    ["content_policy_violation", "moderation", "审核"],
    ["content_blocked_24h", "moderation", "审核"],
    ["insufficient_quota", "quota", "额度"],
    ["insufficient_balance", "balance", "余额"],
    ["invalid_api_key", "authentication", "密钥"],
    ["permission_denied", "authentication", "权限"],
    ["ETIMEDOUT", "timeout", "超时"],
    ["provider_overloaded", "busy", "繁忙"],
    ["rate_limit_exceeded", "busy", "并发"],
  ])("explains %s using a plain cause and action", (code, kind, cause) => {
    const result = resultFailureFeedback({ message: "生成失败", code });
    expect(result.kind).toBe(kind);
    expect(result.cause).toContain(cause);
    expect(result.action.length).toBeGreaterThan(10);
  });

  it("uses provider raw messages when a saved category is generic", () => {
    expect(resultFailureFeedback({ message: "生成失败", failureCategory: "unknown", providerMessage: "Your account has insufficient_quota" }).kind).toBe("quota");
    expect(resultFailureFeedback({ message: "请求参数错误", failureCategory: "invalid_request" }, { message: "The request was rejected by our safety system" }).kind).toBe("moderation");
    expect(resultFailureFeedback({ message: "Payment required", code: "insufficient_quota", statusCode: 402 }).kind).toBe("quota");
  });

  it("recognizes the supplier's exact Chinese content-policy rejection without changing its text", () => {
    const providerMessage = "非常抱歉，该提示可能违反了我们的内容政策。如果您认为此判断有误，请重试或修改提示语。";
    const result = resultFailureFeedback({ message: "生成失败", code: "generation_failed", providerMessage });
    expect(result).toMatchObject({ kind: "moderation", raw: providerMessage });
    expect(result.cause).toContain("未通过内容审核");
    expect(result.action).toContain("调整提示词或素材");
  });

  it("keeps upstream account balance failures attributed to confirmed supplier capacity", () => {
    const providerMessage = "upstream account insufficient_balance";
    const result = resultFailureFeedback({ message: "供应商暂无可用账号", providerMessage,
      code: "provider_no_compatible_accounts", failureCategory: "supplier_capacity" });
    expect(result).toMatchObject({ kind: "capacity", cause: "供应商当前没有可用的上游资源。", raw: providerMessage });
    expect(result.action).toContain("先核对原任务");
    expect(result.action).toContain("稍后重试或更换供应商");
    expect(`${result.cause}${result.action}`).not.toMatch(/当前渠道.*余额|充值|补足/u);
  });

  it.each(["unknown", "supplier_error"] as const)("still interprets raw account errors for generic %s categories", failureCategory => {
    expect(resultFailureFeedback({ message: "生成失败", providerMessage: "insufficient_balance", failureCategory }).kind).toBe("balance");
  });

  it.each(["insufficient_quota", "unknown_provider_code"])("prioritizes original quota evidence over translated balance labels: %s", code => {
    const providerMessage = "current account monthly usage quota exceeded";
    const rawError = { code, message: providerMessage, providerMessage };
    const result = resultFailureFeedback({ code, type: "余额不足", message: "账户余额不足", providerMessage,
      failureCategory: "insufficient_balance" }, rawError);
    expect(result).toMatchObject({ kind: "quota", raw: providerMessage });
    expect(result.cause).toContain("额度");
    expect(`${result.cause}${result.action}`).not.toContain("余额");
  });

  it("keeps unknown original errors visible after localization", () => {
    const raw = "UNRECOGNIZED_VENDOR_FAILURE_42";
    const result = resultFailureFeedback(localizeRunError(raw), raw);
    expect(result).toMatchObject({ kind: "unknown", cause: raw, raw });
    expect(result.action).toContain("完整错误详情");
  });

  it("does not describe a safety-service timeout as a moderation rejection", () => {
    expect(resultFailureFeedback({ message: "Safety service timed out" }).kind).toBe("timeout");
  });

  it("retains full error evidence and accessible copy controls under expandable details", () => {
    vi.stubGlobal("React", React);
    const raw = `provider_raw_${"x".repeat(180)}`;
    const taskId = `task_${"9".repeat(150)}`;
    const markup = renderToStaticMarkup(React.createElement(ResultFailureFeedback, {
      error: { message: "生成失败", code: "insufficient_quota", providerMessage: raw }, taskId, runId: "run-123", status: "failed",
    }));
    expect(markup).toContain("<details");
    expect(markup).toContain("查看完整错误详情");
    for (const label of ["错误代码", "供应商原始错误", "供应商任务编号", "本地运行编号", "复制供应商任务编号", "复制错误详情", "扣费待确认"])
      expect(markup).toContain(label);
    expect(markup).toContain(`<code>${taskId}</code>`);
    expect(markup).toContain(raw);
    expect(markup).toContain("当前渠道的可用额度已用完");
  });

  it("shows the original technical type instead of a translated balance label", () => {
    vi.stubGlobal("React", React);
    const providerMessage = "current account monthly usage quota exceeded";
    const markup = renderToStaticMarkup(React.createElement(ResultFailureFeedback, {
      error: { message: "账户余额不足", type: "余额不足", code: "insufficient_quota", providerMessage },
      rawError: { message: providerMessage, type: "insufficient_quota", code: "insufficient_quota", providerMessage },
    }));
    const technicalType = markup.match(/<dt>错误类型<\/dt><dd>(.*?)<\/dd>/u)?.[1];
    expect(technicalType).toBe("<code>insufficient_quota</code>");
    expect(technicalType).not.toContain("余额不足");
    expect(markup).toContain(providerMessage);
    expect(markup).toContain("当前渠道的可用额度已用完");
  });

  it("corrects a historically normalized balance type only in the quota presentation", () => {
    vi.stubGlobal("React", React);
    const providerMessage = "current account monthly usage quota exceeded";
    const rawError = { message: "账户余额不足", type: "余额不足", code: "insufficient_quota", providerMessage };
    const original = structuredClone(rawError);
    const markup = renderToStaticMarkup(React.createElement(ResultFailureFeedback, { error: rawError, rawError }));
    const technicalType = markup.match(/<dt>错误类型<\/dt><dd>(.*?)<\/dd>/u)?.[1];
    expect(technicalType).toBe("<code>额度不足</code>");
    expect(technicalType).not.toContain("余额不足");
    expect(markup).toContain("<dt>错误代码</dt><dd><code>insufficient_quota</code></dd>");
    expect(markup).toContain(providerMessage);
    expect(rawError).toEqual(original);
  });

  it("puts the primary retry after readable feedback and before collapsed source metadata", async () => {
    vi.stubGlobal("React", React);
    const { WorkflowNode } = await import("../components/workflow-node");
    const regenerate = vi.fn();
    const markup = renderToStaticMarkup(React.createElement(ReactFlowProvider, null, React.createElement(WorkflowNode, {
      id: "failed", type: "workflow", selected: false, draggable: true, dragging: false,
      selectable: true, deletable: true, zIndex: 0, isConnectable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
      data: {
        nodeType: "asset-input", label: "失败结果", assetKind: "image", generatedResult: true, generatedStatus: "failed",
        generatedError: { message: "供应商拒绝了生成", providerMessage: "insufficient_quota", code: "insufficient_quota" },
        generatedDetails: { taskEvidence: { taskId: `task_${"9".repeat(180)}`, status: "failed" } },
        onRegenerate: regenerate, inputs: [], outputs: [],
      },
    } satisfies React.ComponentProps<typeof WorkflowNode>)));
    const heading = markup.indexOf("生成失败</strong>");
    const feedback = markup.indexOf("result-error-summary");
    const disclosure = markup.indexOf("查看完整错误详情");
    const retry = markup.indexOf('aria-label="再次运行 失败结果，原地替换失败结果"');
    const source = markup.indexOf("来源与任务</summary>");
    expect(heading).toBeGreaterThan(-1);
    expect(feedback).toBeGreaterThan(heading);
    expect(disclosure).toBeGreaterThan(feedback);
    expect(retry).toBeGreaterThan(disclosure);
    expect(source).toBeGreaterThan(retry);
    expect(markup).toContain('aria-label="查看 失败结果 来源"');
    expect(markup).toContain(`task_${"9".repeat(180)}`);
    expect(markup).not.toContain("可先查看详情排查原因，再重新生成");
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("reserves room for the absolute status and close controls, preserving selected error paint and gesture degradation", () => {
    const css = readFileSync(new URL("../components/result-feedback.module.css", import.meta.url), "utf8");
    const heading = css.match(/\.failureHeading\s*\{([^}]+)\}/u)?.[1] ?? "";
    expect(heading).toContain("padding-left:52px");
    expect(heading).toContain("padding-right:28px");
    expect(heading).toContain("position:sticky");
    // Cancel the scroll container's 12px padding so raw text cannot pass above it.
    expect(heading).toContain("top:-12px");
    expect(heading).toContain("min-height:42px");
    expect(heading).toContain("margin-top:-12px");
    expect(heading).toContain("background:var(--surface-node)");
    // The solid header reaches both absolute controls while staying under their
    // z-index:3 paint; scrolling raw text remains under this z-index:2 surface.
    expect(heading).toContain("z-index:2");
    const headerFill = css.match(/\.failureHeading::before\s*\{([^}]+)\}/u)?.[1] ?? "";
    expect(headerFill).toContain("inset:0 -12px");
    expect(headerFill).toContain("background:var(--surface-node)");
    const selectedRule = '.failureCard:global(.node-card):global(.selected)[data-result-problem]';
    expect(css).toContain(`${selectedRule} { box-shadow:inset 3px 0 0 var(--status-fail), 0 0 0 1px`);
    expect(css).toContain(`:global(.is-interacting) ${selectedRule},`);
    expect(css).toContain(`:global(.canvas-lod-compact) ${selectedRule} { box-shadow:none; }`);
  });
});

describe("compact result toolbar", () => {
  it("only enables reverse prompting when both archived media and its action are available", () => {
    const action = vi.fn();
    expect(canReverseResultPrompt({}, false)).toBe(false);
    expect(canReverseResultPrompt({}, true)).toBe(false);
    expect(canReverseResultPrompt({ onPrepareReversePrompt: action }, false)).toBe(false);
    expect(canReverseResultPrompt({ onPrepareReversePrompt: action }, true)).toBe(true);
    expect(action).not.toHaveBeenCalled();
  });
  it("keeps main image actions accessible and prompt actions behind More", () => {
    vi.stubGlobal("React", React);
    const markup = renderToStaticMarkup(React.createElement(ResultActions, {
      data: { label: "图片结果", assetId: "image-1", assetKind: "image" } as CanvasNodeData,
      hasMedia: true, prompt: "原始内容", zoom: 1, onZoom: () => {},
    }));
    for (const label of ["生成结果操作", "改版", "缩小图片", "还原图片缩放", "放大图片", "下载 图片结果", "更多结果操作"])
      expect(markup).toContain(label);
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).not.toContain("复用提示词");
    expect(markup).not.toContain("反推提示词");
    expect(markup).not.toContain("原始内容");
  });

  it("places the whole toolbar below a result when space is available", () => {
    expect(placeResultToolbar({ x: 200, y: 150, width: 320, height: 240 }, { width: 220, height: 38 }, { width: 1200, height: 800 })).toEqual({ x: 250, y: 402 });
  });

  it("moves an expanded menu above a result near the Dock", () => {
    expect(placeResultToolbar({ x: 200, y: 430, width: 320, height: 260 }, { width: 226, height: 250 }, { width: 1200, height: 800 })).toEqual({ x: 247, y: 168 });
  });

  it("keeps controls at a reachable edge when an oversized result fills the viewport", () => {
    const node = { x: 20, y: 20, width: 1160, height: 760 };
    const surface = { width: 226, height: 200 };
    const position = placeResultToolbar(node, surface, { width: 1200, height: 800 });
    expect(position.x).toBe(966);
    expect(position.y).toBe(528);
    expect(position.x + surface.width).toBeLessThanOrEqual(1200);
    expect(position.y + surface.height).toBeLessThanOrEqual(728);
  });

  it.each([320, 360])("keeps toolbar and expanded menu in a %ipx viewport", width => {
    for (const height of [38, 250, 420]) {
      const surface = { width: 226, height };
      const position = placeResultToolbar({ x: -80, y: -120, width: width + 160, height: 1000 }, surface, { width, height: 640 });
      expect(position.x).toBeGreaterThanOrEqual(8);
      expect(position.y).toBeGreaterThanOrEqual(72);
      expect(position.x + surface.width).toBeLessThanOrEqual(width - 8);
      expect(position.y + surface.height).toBeLessThanOrEqual(568);
    }
  });

  it.each([false, true])("excludes the resized Agent, parameter deck and Dock from toolbar placement: deck=%s", withDeck => {
    const inspector = { left: 768, top: 72, right: 1268, bottom: 708 };
    const deck = { left: 376, top: 72, right: 756, bottom: 708 };
    const dock = { left: 90, top: 660, right: 740, bottom: 708 };
    const usable = resultToolbarUsableArea({ left: 0, top: 0, right: 1280, bottom: 720 }, [
      { left: 12, top: 88, right: 68, bottom: 608 }, inspector,
      ...(withDeck ? [deck] : []),
    ], [dock]);
    for (const height of [38, 250]) {
      const surface = { width: 226, height };
      const position = placeResultToolbar({ x: 560, y: 180, width: 320, height: 320 }, surface, usable);
      expect(position.x).toBeGreaterThanOrEqual(usable.x);
      expect(position.y).toBeGreaterThanOrEqual(usable.y);
      expect(position.x + surface.width).toBeLessThanOrEqual(usable.x + usable.width);
      expect(position.y + surface.height).toBeLessThanOrEqual(usable.y + usable.height);
      for (const obstacle of [inspector, dock, ...(withDeck ? [deck] : [])]) {
        expect(position.x < obstacle.right && position.x + surface.width > obstacle.left &&
          position.y < obstacle.bottom && position.y + surface.height > obstacle.top).toBe(false);
      }
    }
  });

  it("reclaims right-side space when a previously open Agent closes", () => {
    const canvas = { left: 0, top: 0, right: 1280, bottom: 720 };
    const node = { x: 900, y: 360, width: 300, height: 180 };
    const surface = { width: 226, height: 38 };
    const open = resultToolbarUsableArea(canvas, [{ left: 768, top: 72, right: 1268, bottom: 708 }]);
    const closed = resultToolbarUsableArea(canvas, []);
    const restricted = placeResultToolbar(node, surface, open);
    const restored = placeResultToolbar(node, surface, closed);
    expect(restricted.x + surface.width).toBeLessThanOrEqual(open.x + open.width);
    expect(restored.x).toBeGreaterThan(restricted.x);
    expect(restored.x + surface.width).toBeLessThanOrEqual(closed.x + closed.width);
  });

  it("keeps result actions above the responsive Dock floating 68px from the window bottom", () => {
    const canvas = { left: 0, top: 0, right: 1280, bottom: 720 };
    const inspector = { left: 768, top: 72, right: 1268, bottom: 708 };
    const dock = { left: 200, top: 600, right: 700, bottom: 652 };
    const usable = resultToolbarUsableArea(canvas, [inspector], [dock]);
    expect(usable.y + usable.height).toBe(584);
    for (const height of [38, 250]) {
      const surface = { width: 226, height };
      const position = placeResultToolbar({ x: 550, y: 308, width: 320, height: 320 }, surface, usable);
      expect(position.y + height).toBeLessThanOrEqual(dock.top - 16);
      expect(position.x + surface.width).toBeLessThanOrEqual(inspector.left - 16);
    }
  });
});
