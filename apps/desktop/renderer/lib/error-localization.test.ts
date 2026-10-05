import { describe, expect, it } from "vitest";

import { localizeRunError } from "./error-localization";
import { presentProviderError } from "../../../../packages/providers/src/error-presentation";
import { ProviderHttpError } from "../../../../packages/providers/src/http";

describe("localizeRunError", () => {
  it("corrects legacy 24-hour content blocks while preserving the recorded charge", () => {
    const charge = { status: "charged", amount: 0.2, currency: "USD", source: "provider_response" };
    const error = localizeRunError({ message: "API 拒绝了当前请求，请检查模型、参数、提示词和素材格式。",
      type: "请求参数错误", code: "content_blocked_24h", statusCode: 451, failureCategory: "invalid_request", charge });
    expect(error).toMatchObject({ type: "内容被临时拦截", failureCategory: "content_policy", charge,
      message: expect.stringContaining("24 小时拦截期") });
    expect(localizeRunError({ message: "Restricted", statusCode: 451 })?.message).not.toContain("24 小时");
  });
  it("does not reinterpret a supplier account-pool balance failure as the user's empty balance", () => {
    const error = {
      message: "供应商当前没有适用于所选模型或线路的可用账号，请核对原任务。",
      type: "供应商无可用兼容账号", failureCategory: "supplier_capacity", code: "upstream_balance_exhausted",
      providerMessage: "Upstream account insufficient balance",
      charge: { status: "unknown", source: "unconfirmed" },
    };
    expect(localizeRunError(error, { provider: "rest", supplier: "cyberafei" })).toEqual(error);
    const legacy = localizeRunError({ message: "Upstream account insufficient balance" });
    expect(legacy?.type).toBe("供应商无可用兼容账号");
    expect(legacy?.message).not.toContain("请充值");
  });

  it("uses explicit network classification even if upstream diagnostics mention billing", () => {
    const error = localizeRunError({ message: "Connection reset after submission", failureCategory: "network",
      providerMessage: "Request failed while checking insufficient balance", charge: { status: "unknown", source: "unconfirmed" } });
    expect(error?.message).toContain("网络");
    expect(error?.message).not.toMatch(/充值|供应商返回了生成错误|稍后重试/);
  });
  it("explains saved socket submission errors without changing their evidence", () => {
    const error = {
      message: "API 提交时网络连接失败，请检查网络和接口地址。",
      type: "网络连接错误", code: "UND_ERR_SOCKET", api: "OpenAI Images API",
      providerMessage: "other side closed",
    };
    expect(localizeRunError(error)).toEqual({
      ...error,
      message: "API 提交过程中连接中断，未收到完整响应。供应商可能仍在生成或已扣费，请先核对原任务和账单，不要重复提交。",
      type: "连接中断",
    });
    expect(localizeRunError({ ...error, message: "API 查询时网络连接失败，请检查网络和接口地址。" })?.message)
      .not.toMatch(/仍在生成|已扣费|重复提交/);
    expect(localizeRunError({ ...error, code: "ECONNREFUSED" })).toEqual({ ...error, code: "ECONNREFUSED" });
  });

  it("distinguishes completed generation from a failed local archive", () => {
    expect(
      localizeRunError({
        message:
          "供应商任务已完成，但输出归档失败：Provider output download timed out",
        code: "artifact_archive_failed",
      }),
    ).toEqual({
      message: "图片已生成，但保存到素材库失败，可尝试取回现有结果。",
      type: "结果归档错误",
      code: "artifact_archive_failed",
    });
  });

  it("explains archive address blocks and retains only the known safe diagnostic", () => {
    const reason = "Provider output URL resolves to a private address";
    const localized = localizeRunError({
      message: `供应商任务已完成，但输出归档失败：${reason}: https://example.com/image.png?token=secret`,
      code: "artifact_archive_failed",
    });
    expect(localized).toEqual({
      message: "图片已生成，但原图链接解析到了内网或保留地址，下载被安全检查拦截。请检查代理或 DNS 设置，修复后取回现有结果。",
      type: "结果归档错误",
      code: "artifact_archive_failed",
      providerMessage: reason,
    });
    expect(JSON.stringify(localized)).not.toMatch(/secret|example\.com/);
    expect(localized?.message).not.toMatch(/中断|可以直接/);
  });

  it("uses preserved archive causes without replacing existing provider evidence", () => {
    const providerMessage = "Provider output URL resolves to a private address";
    const error = {
      message: "供应商任务已完成，但输出归档失败",
      code: "artifact_archive_failed",
      providerMessage,
    };
    expect(localizeRunError(error)).toMatchObject({
      message: expect.stringContaining("下载被安全检查拦截"),
      providerMessage,
    });
    expect(localizeRunError({
      ...error,
      message: `供应商任务已完成，但输出归档失败：${providerMessage}`,
      providerMessage: "Previously preserved diagnostic",
    })?.providerMessage).toBe("Previously preserved diagnostic");
    expect(localizeRunError({
      message: "供应商任务已完成，但输出归档失败：Download failed for https://example.com/?token=secret",
      code: "artifact_archive_failed",
    })).not.toHaveProperty("providerMessage");
  });

  it("translates legacy moderation messages from a REST connector", () => {
    expect(
      localizeRunError(
        {
          message:
            "Your prompt or reference material was rejected by content moderation. Please revise it and submit again.",
        },
        { provider: "rest" },
      ),
    ).toEqual({
      message:
        "内容审核未通过：提示词或参考素材被内容安全系统拒绝，请修改后重新提交。",
      type: "内容审核错误",
      code: "content_moderation",
      api: "自定义 REST API",
    });
  });

  it("classifies legacy gateway errors", () => {
    expect(
      localizeRunError("Gateway error (502). Please retry later."),
    ).toEqual({
      message: "上游 API 暂时不可用（HTTP 502）。请核对供应商状态和原任务记录，再决定是否重新生成。",
      type: "网关或上游服务错误",
      code: "HTTP 502",
    });
  });

  it("corrects historical structured account-pool failures using the preserved upstream reason", () => {
    const history = {
      message: "供应商未能完成生成任务，请根据错误代码和对应 API 文档检查请求内容或服务状态。",
      type: "供应商生成错误", code: "generation_failed", api: "OpenAI Images API",
      providerMessage: "No available compatible accounts",
    };
    const localized = localizeRunError(history, { status: "failed", providerTaskStatus: "failed" });
    expect(localized).toMatchObject({
      message: "供应商当前没有适用于所选模型或线路的可用账号，未能完成本次生成。请等待供应商恢复或核对该线路状态；本次费用仍需核对。",
      type: "供应商无可用兼容账号", code: "provider_no_compatible_accounts",
      providerMessage: history.providerMessage,
    });
    expect(localized?.message).not.toMatch(/提示词|检查请求内容|未扣费/);
    expect(history.code).toBe("generation_failed");
  });

  it("uses an accepted remote failure separately from an unknown HTTP submission", () => {
    const history = {
      message: "上游 API 暂时不可用（HTTP 502），请稍后重试。",
      type: "网关或上游服务错误", code: "HTTP 502", statusCode: 502,
      providerMessage: "<html><title>502 Bad Gateway</title></html>",
    };
    const unknown = localizeRunError(history, { status: "needs_attention" });
    expect(unknown?.message).toContain("提交结果未知");
    expect(unknown?.message).not.toContain("请稍后重试");
    const failed = localizeRunError(history, { status: "failed", providerTaskStatus: "failed" });
    expect(failed?.message).toContain("供应商已将原任务标记为生成失败");
    expect(failed?.message).not.toContain("提交结果未知");
    expect(failed?.providerMessage).toBe(history.providerMessage);
    expect(failed?.message).not.toContain("<html>");
    expect(localizeRunError(history, { status: "failed" })?.message).not.toContain("已将原任务");
  });

  it("retains phase, retry and only safe transport fields for historical structured errors", () => {
    const safe = { elapsedMs: 1900, stage: "reading_body" as const, responseBytes: 161,
      remoteAddress: "104.156.154.225", remotePort: 443, route: "physical-direct" as const };
    const value = {
      message: "Provider returned HTTP 502", code: "HTTP 502", phase: "submit",
      retryable: false, submissionMayHaveOccurred: true,
      transport: { ...safe, headers: { authorization: "secret" }, url: "https://user:secret@example.com/?token=secret" },
    };
    const localized = localizeRunError(value);
    expect(localized).toMatchObject({
      phase: "submit", retryable: false, submissionMayHaveOccurred: true, transport: safe,
    });
    expect(localized?.message).toContain("不要重复提交");
    expect(JSON.stringify(localized)).not.toContain("secret");
    expect(localizeRunError({ ...value, transport: { ...safe, responseBytes: -1 }, retryable: "true", phase: "secret" }))
      .not.toHaveProperty("transport");
  });

  it("does not relabel query interruptions as unknown submissions even when the run needs attention", () => {
    const localized = localizeRunError({
      message: "上游 API 暂时不可用（HTTP 502），请稍后重试。",
      code: "HTTP 502", phase: "poll", retryable: true, submissionMayHaveOccurred: false,
    }, { status: "needs_attention" });
    expect(localized?.message).toContain("原任务查询暂时中断");
    expect(localized?.message).not.toMatch(/提交结果未知|已扣费|请稍后重试/);
  });

  it("corrects a historical overload reason stored beside generation_failed", () => {
    expect(localizeRunError({
      message: "供应商未能完成生成任务，请检查请求内容。", code: "generation_failed",
      providerMessage: "model is overloaded",
    })).toMatchObject({ type: "供应商繁忙", code: "provider_overloaded", providerMessage: "model is overloaded" });
  });

  it("keeps overload resubmission warnings aligned with uncertain server evidence", () => {
    const server = presentProviderError(new ProviderHttpError("Provider returned HTTP 503", {
      kind: "provider", phase: "submit", status: 503, retryable: false, submissionMayHaveOccurred: true,
      responseBody: { message: "adobe throttled: system under load" },
    }), { provider: "rest" });
    expect(localizeRunError(server, { provider: "rest", status: "needs_attention" })).toEqual(server);
  });

  it.each(["No available compatible accounts", "No_available_compatible_accounts"])("keeps server and legacy client account-pool explanations aligned: %s", raw => {
    const server = presentProviderError(new Error(raw), { provider: "openai", operation: "image.generate" });
    const legacy = { ...server };
    delete legacy.failureCategory;
    delete legacy.charge;
    expect(localizeRunError(raw, { provider: "openai" })).toEqual(legacy);
    expect(localizeRunError(server, { provider: "openai", status: "failed", providerTaskStatus: "failed" })).toEqual(server);
  });

  it.each(["authentication failed", "rate limit", "request timed out", "Unknown provider error"])("preserves explicit billing evidence while translating %s", message => {
    const charge = { status: "charged", amount: 0.034, currency: "USD", source: "provider_response" };
    expect(localizeRunError({ message, charge, failureCategory: "network" })).toMatchObject({ charge, failureCategory: "network" });
  });

  it("keeps confirmed supplier failures focused on the original task instead of blaming user parameters", () => {
    const charge = { status: "charged", amount: 0.036, currency: "USD", source: "provider_response" };
    const error = localizeRunError({ message: "Provider failed after billing", failureCategory: "supplier_error", charge });
    expect(error).toMatchObject({
      message: "供应商未能完成本次生成。请核对供应商状态、原任务和账单，再决定是否重新生成。",
      failureCategory: "supplier_error", charge,
    });
    expect(error?.message).not.toMatch(/检查接入参数|稍后重试/);
  });

  it("whitelists billing evidence from historical canvas drafts", () => {
    expect(localizeRunError({ message: "生成失败", failureCategory: "not-real",
      charge: { status: "charged", amount: -3, currency: "\nsecret\n", source: "provider_response", authorization: "secret" },
    })).toEqual({ message: "生成失败", charge: { status: "charged", source: "provider_response" } });
    const unknown = localizeRunError({ message: "生成失败", charge: { status: "unknown", amount: 12, currency: "USD", source: "provider_response" } });
    expect(unknown?.charge).toEqual({ status: "unknown", source: "unconfirmed" });
    expect(localizeRunError({ message: "生成失败", charge: { status: "not_charged", source: "unconfirmed" } })?.charge)
      .toEqual({ status: "unknown", source: "unconfirmed" });
    expect(localizeRunError({ message: "生成失败", charge: { status: "charged", source: "not_submitted" } })?.charge)
      .toEqual({ status: "unknown", source: "unconfirmed" });
    for (const charge of [{ status: "charged", amount: 0 }, { status: "not_charged", amount: 1 }])
      expect(localizeRunError({ message: "生成失败", charge: { ...charge, source: "provider_response" } })?.charge)
        .toEqual({ status: "unknown", source: "unconfirmed" });
  });

  it.each(["submit", "poll"] as const)("keeps server and client gateway evidence aligned during %s", phase => {
    const server = presentProviderError(new ProviderHttpError("Provider returned HTTP 502", {
      kind: "provider", phase, status: 502, retryable: phase === "poll", submissionMayHaveOccurred: phase === "submit",
      transport: { elapsedMs: 1700, stage: "reading_body", responseBytes: 100 },
    }), { provider: "rest" });
    expect(localizeRunError(server, { provider: "rest", status: "needs_attention" })).toEqual(server);
  });

  it("keeps already structured Chinese errors", () => {
    const error = {
      message: "内容审核未通过。",
      type: "内容审核错误",
      code: "content_moderation",
      api: "OpenAI Images API",
      statusCode: 400,
      providerMessage: "Prompt rejected by upstream",
    };
    expect(localizeRunError(error)).toEqual(error);
  });

  it("relabels legacy MikotoPro Gemini errors that used the shared adapter name", () => {
    expect(
      localizeRunError(
        {
          message: "API 返回的数据格式不符合接入约定，请检查响应映射。",
          type: "响应格式错误",
          code: "HTTP 200",
          api: "We-AI Images API",
        },
        { provider: "weai", supplier: "mikoto" },
      ),
    ).toMatchObject({
      api: "MikotoPro Gemini API",
      docsUrl: "https://api.mikoto.vip/custom/0dcbf4f93685de2d",
    });
  });

  it("adds a supplier website action to legacy balance errors", () => {
    expect(
      localizeRunError(
        {
          message: "insufficient user quota",
          code: "insufficient_user_quota",
        },
        { provider: "rest", supplier: "cyberafei" },
      ),
    ).toEqual({
      message:
        "赛博阿飞 API：账户余额或可用额度不足，请充值或检查计费状态后重试。",
      type: "余额不足",
      code: "insufficient_user_quota",
      api: "赛博阿飞 API",
      actionUrl: "https://api.3365api.cn/",
      actionLabel: "前往赛博阿飞 API官网查看余额",
    });
  });

  it.each(["账户余额不足，请检查计费状态。", "Insufficient user balance"])("restores the balance website action for classified public errors: %s", message => {
    // Public run errors retain the category and billing evidence, but omit action URLs.
    const error = {
      message, failureCategory: "insufficient_balance", code: "INSUFFICIENT_BALANCE",
      charge: { status: "unknown", source: "unconfirmed" },
    };
    const localized = localizeRunError(error, { provider: "rest", supplier: "cyberafei" });
    expect(localized).toMatchObject({
      failureCategory: "insufficient_balance", code: "INSUFFICIENT_BALANCE", charge: error.charge,
      actionUrl: "https://api.3365api.cn/", actionLabel: "前往赛博阿飞 API官网查看余额",
    });
    if (message.includes("余额")) expect(localized?.message).toBe(message);
    expect(localizeRunError({ ...error, actionUrl: "https://billing.example.com/", actionLabel: "核对账单" },
      { provider: "rest", supplier: "cyberafei" })).toMatchObject({ actionUrl: "https://billing.example.com/", actionLabel: "核对账单" });
  });

  it("corrects legacy structured balance and safety classifications", () => {
    expect(
      localizeRunError(
        {
          message: "API 身份验证失败",
          type: "身份验证错误",
          code: "INSUFFICIENT_BALANCE",
          api: "沧元算力 API",
        },
        { provider: "rest", supplier: "cangyuan" },
      ),
    ).toMatchObject({ type: "余额不足", code: "INSUFFICIENT_BALANCE" });
    expect(
      localizeRunError(
        {
          message: "API 拒绝了当前请求",
          type: "请求参数错误",
          code: "image_safety",
          api: "沧元算力 API",
        },
        { provider: "rest", supplier: "cangyuan" },
      ),
    ).toMatchObject({ type: "内容审核错误", code: "image_safety" });
  });

  it("rejects non-HTTPS action links from stored run errors", () => {
    expect(
      localizeRunError({
        message: "余额不足",
        actionUrl: "javascript:alert(1)",
        actionLabel: "充值",
      }),
    ).toEqual({
      message: "供应商：账户余额或可用额度不足，请充值或检查计费状态后重试。",
      type: "余额不足",
      code: "insufficient_quota",
    });
  });
});
