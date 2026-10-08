import { describe, expect, it } from "vitest";

import { presentProviderError } from "./error-presentation";
import { ProviderHttpError } from "./http";

describe("provider error presentation", () => {
  it.each([
    ['JSON API key', '{"api_key":"synthetic-qa-marker"}'],
    ['quoted password with spaces', '{"password":"synthetic-qa-marker with spaces"}'],
    ['bare field with quoted password', 'password="first part synthetic-qa-marker"'],
    ['YAML quoted API key', 'api_key: "first part synthetic-qa-marker"'],
    ['escaped quoted secret', '{"secret":"synthetic-qa-marker\\\" suffix"}'],
    ['single quoted token', "{'access_token':'synthetic-qa-marker'}"],
    ['URL userinfo', 'request https://qa-user:synthetic-qa-marker@provider.example/task?id=42'],
    ['encoded URL token', 'request https://provider.example/task?access_token=synthetic%2Dqa%2Dmarker&id=42'],
  ])("redacts %s echoed in a provider error before exposing diagnostics", (_label, message) => {
    const error = new ProviderHttpError("Provider returned HTTP 500", {
      kind: "provider", phase: "submit", status: 500, retryable: false,
      submissionMayHaveOccurred: true, responseBody: { error: { message } },
    });
    const presentation = presentProviderError(error, { provider: "rest" });
    expect(presentation.providerMessage).toContain("redacted");
    expect(JSON.stringify(presentation)).not.toMatch(/synthetic(?:-|%2D)qa(?:-|%2D)marker/iu);
    expect(presentation).toMatchObject({ statusCode: 500, retryable: false, submissionMayHaveOccurred: true });
  });

  it("redacts credential assignments in provider error codes", () => {
    const error = new ProviderHttpError("Provider returned HTTP 500", {
      kind: "provider", phase: "submit", status: 500, retryable: false,
      submissionMayHaveOccurred: true, responseBody: { error: { code: 'token=synthetic-qa-marker', message: 'Provider failed' } },
    });
    const presentation = presentProviderError(error, { provider: "rest" });
    expect(presentation.code).toContain("redacted");
    expect(JSON.stringify(presentation)).not.toContain("synthetic-qa-marker");
  });

  it("keeps public URLs and ordinary provider codes useful after diagnostic sanitization", () => {
    const error = new ProviderHttpError("Provider returned HTTP 400", {
      kind: "invalid_request", phase: "submit", status: 400, retryable: false,
      submissionMayHaveOccurred: false, responseBody: { error: { code: 'unsupported_parameter',
        message: 'See https://provider.example/docs/model?id=42 for supported resolution' } },
    });
    expect(presentProviderError(error, { provider: "rest" })).toMatchObject({ code: 'unsupported_parameter',
      providerMessage: 'See https://provider.example/docs/model?id=42 for supported resolution' });
  });

  it("explains a repeated-content 24-hour rejection without inventing billing evidence", () => {
    const error = new ProviderHttpError("Provider returned HTTP 451", {
      kind: "invalid_request", phase: "submit", status: 451, retryable: false, submissionMayHaveOccurred: false,
      responseBody: { error: { code: "content_blocked_24h", message: "The same content was rejected by the upstream provider with HTTP 451 within the last 24 hours. Please try again later." } },
    });
    expect(presentProviderError(error, { provider: "openai" })).toMatchObject({
      code: "content_blocked_24h", statusCode: 451, type: "内容被临时拦截", failureCategory: "content_policy",
      message: expect.stringContaining("24 小时拦截期"), charge: { status: "unknown", source: "unconfirmed" },
    });
  });
  it("states that failed route discovery did not submit a paid request", () => {
    const cause = Object.assign(new Error("discovery failed"), { code: "PROVIDER_NETWORK_DISCOVERY_FAILED" });
    const error = new ProviderHttpError("Provider network request failed", {
      kind: "network", phase: "submit", retryable: true, submissionMayHaveOccurred: false, requestNotSent: true, cause,
    });
    const presentation = presentProviderError(error, { provider: "openai" });
    expect(presentation.type).toBe("连接准备失败");
    expect(presentation.message).toContain("尚未向供应商提交请求");
  });

  it("preserves safe transport evidence for durable diagnostics without exposing the raw cause", () => {
    const transport = { elapsedMs: 99_123, stage: "awaiting_headers" as const, responseBytes: 0,
      errorCode: "UND_ERR_SOCKET", socketBytesRead: 0, socketBytesWritten: 500,
      localAddress: "192.168.1.20", remoteAddress: "104.156.154.225", localPort: 50001, remotePort: 443, route: "physical-direct" as const };
    const error = new ProviderHttpError("Provider network request failed", {
      kind: "network", phase: "submit", retryable: false, submissionMayHaveOccurred: true,
      transport, cause: new Error("authorization: secret"),
    });
    const presentation = presentProviderError(error, { provider: "openai" });
    expect(presentation.transport).toEqual(transport);
    expect(JSON.stringify(presentation)).not.toContain("secret");
  });

  it("explains oversized successful image responses", () => {
    const error = new ProviderHttpError("Unable to read provider response", {
      kind: "invalid_response",
      phase: "submit",
      retryable: false,
      submissionMayHaveOccurred: true,
      status: 200,
      responseBody: {
        code: "response_too_large",
        message: "Provider response exceeds the 52428800 byte limit",
      },
    });

    expect(presentProviderError(error, { provider: "rest" })).toMatchObject({
      message: expect.stringContaining("超过了本地安全读取上限"),
      type: "响应过大",
      code: "response_too_large",
      statusCode: 200,
    });
  });

  it("warns before retrying an empty successful submission", () => {
    const error = new ProviderHttpError("Provider returned an empty response", {
      kind: "invalid_response",
      phase: "submit",
      retryable: false,
      submissionMayHaveOccurred: true,
      status: 200,
      responseBody: {
        code: "empty_response",
        message: "Provider returned an empty response",
      },
    });

    expect(presentProviderError(error, { provider: "rest" })).toMatchObject({
      message: expect.stringContaining("供应商可能已收到任务"),
      type: "空响应错误",
      code: "empty_response",
      statusCode: 200,
    });
  });

  it("translates content moderation failures and identifies the API", () => {
    expect(
      presentProviderError(
        "Your prompt or reference material was rejected by content moderation. Please revise it and submit again.",
        { provider: "openai", operation: "image.edit" },
      ),
    ).toEqual({
      message:
        "内容审核未通过：提示词或参考素材被内容安全系统拒绝，请修改后重新提交。",
      type: "内容审核错误",
      code: "content_moderation",
      api: "OpenAI Images API",
      failureCategory: "content_policy",
      charge: { status: "unknown", source: "unconfirmed" },
      docsUrl: "https://platform.openai.com/docs/guides/error-codes/api-errors",
    });
  });

  it("uses structured provider response codes for HTTP failures", () => {
    const error = new ProviderHttpError("Provider returned HTTP 400", {
      kind: "invalid_request",
      phase: "submit",
      status: 400,
      retryable: false,
      submissionMayHaveOccurred: false,
      responseBody: {
        error: {
          message: "Unsupported parameter: quality",
          type: "invalid_request_error",
          code: "unsupported_parameter",
        },
      },
    });

    expect(
      presentProviderError(error, {
        provider: "openai",
        operation: "image.generate",
      }),
    ).toMatchObject({
      message: "API 拒绝了当前请求，请检查模型、参数、提示词和素材格式。",
      type: "请求参数错误",
      code: "unsupported_parameter",
      api: "OpenAI Images API",
      statusCode: 400,
      providerMessage: "Unsupported parameter: quality",
    });
  });

  it("shows the original provider reason when a polled generation times out", () => {
    expect(
      presentProviderError("Generation timed out, please retry later.", {
        provider: "rest",
        operation: "image.generate",
      }),
    ).toEqual({
      message: "供应商生成任务超时，未能返回结果，请稍后重试。",
      type: "供应商任务超时",
      code: "generation_timeout",
      api: "自定义 REST API",
      failureCategory: "supplier_error",
      charge: { status: "unknown", source: "unconfirmed" },
      providerMessage: "Generation timed out, please retry later.",
    });
  });

  it("identifies supplier-specific insufficient balance responses", () => {
    const error = new ProviderHttpError("Provider returned HTTP 403", {
      kind: "authentication",
      phase: "submit",
      status: 403,
      responseBody: {
        error: {
          code: "insufficient_user_quota",
          message: "当前账户余额不足，请充值后重试",
        },
      },
    });

    expect(
      presentProviderError(error, {
        provider: "rest",
        supplier: "cangyuan",
      }),
    ).toMatchObject({
      message: "沧元算力：账户余额或可用额度不足，请充值或检查计费状态后重试。",
      type: "余额不足",
      code: "insufficient_user_quota",
      api: "沧元算力 API",
      actionUrl: "https://ai.cangyuansuanli.cn/",
      actionLabel: "前往沧元算力官网查看余额",
    });
  });

  it("recognizes underscore balance and image safety codes", () => {
    expect(
      presentProviderError(
        new ProviderHttpError("Provider returned HTTP 403", {
          kind: "authentication",
          phase: "submit",
          status: 403,
          responseBody: {
            code: "INSUFFICIENT_BALANCE",
            message: "account unavailable",
          },
        }),
        { provider: "rest", supplier: "cangyuan" },
      ),
    ).toMatchObject({
      type: "余额不足",
      code: "INSUFFICIENT_BALANCE",
    });
    expect(
      presentProviderError(
        new ProviderHttpError("Provider returned HTTP 400", {
          kind: "invalid_request",
          phase: "submit",
          status: 400,
          responseBody: {
            code: "image_safety",
            message: "request rejected",
          },
        }),
        { provider: "rest", supplier: "cangyuan" },
      ),
    ).toMatchObject({
      type: "内容审核错误",
      code: "image_safety",
    });
  });

  it("treats HTTP 402 as a billing failure", () => {
    const error = new ProviderHttpError("Payment required", {
      kind: "invalid_request",
      phase: "submit",
      status: 402,
    });

    expect(presentProviderError(error, { provider: "openai" })).toMatchObject({
      type: "余额不足",
      code: "HTTP 402",
      actionUrl: "https://platform.openai.com/",
    });
  });

  it("classifies gateway errors by HTTP status", () => {
    const error = new ProviderHttpError("Provider returned HTTP 502", {
      kind: "provider",
      phase: "submit",
      status: 502,
      retryable: false,
      submissionMayHaveOccurred: true,
    });

    expect(presentProviderError(error, { provider: "rest" })).toMatchObject({
      message: "上游 API 暂时不可用（HTTP 502），本次提交结果未知。请先核对原任务和扣费记录，不要重复提交。",
      type: "网关或上游服务错误",
      code: "HTTP 502",
      api: "自定义 REST API",
      phase: "submit", retryable: false, submissionMayHaveOccurred: true,
    });
  });

  it("explains an accepted task's unavailable account pool without blaming the prompt or guessing billing", () => {
    expect(presentProviderError(new Error("No available compatible accounts"), {
      provider: "openai", operation: "image.edit",
    })).toMatchObject({
      message: "供应商当前没有适用于所选模型或线路的可用账号，未能完成本次生成。请等待供应商恢复或核对该线路状态；本次费用仍需核对。",
      type: "供应商无可用兼容账号", code: "provider_no_compatible_accounts",
      providerMessage: "No available compatible accounts",
    });
  });

  it("keeps account-pool HTTP rejection codes and ambiguous submission evidence", () => {
    const transport = { elapsedMs: 1532, stage: "reading_body" as const, responseBytes: 91 };
    const error = new ProviderHttpError("Provider returned HTTP 502", {
      kind: "provider", phase: "submit", status: 502, retryable: false, submissionMayHaveOccurred: true,
      transport, responseBody: { error: { code: "pool_unavailable", message: "No available compatible accounts" } },
    });
    const presentation = presentProviderError(error, { provider: "openai" });
    expect(presentation).toMatchObject({
      type: "供应商无可用兼容账号", code: "pool_unavailable", statusCode: 502,
      phase: "submit", retryable: false, submissionMayHaveOccurred: true, transport,
      providerMessage: "No available compatible accounts",
    });
    expect(presentation.message).toContain("提交结果未知");
    expect(presentation.message).not.toMatch(/提示词|请稍后重试/);
    expect(error.details.retryable).toBe(false);
  });

  it.each([502, 503, 504])("treats HTTP %i while querying as an interruption of the original task", status => {
    const presentation = presentProviderError(new ProviderHttpError(`Provider returned HTTP ${status}`, {
      kind: "provider", phase: "poll", status, retryable: true, submissionMayHaveOccurred: false,
    }), { provider: "rest" });
    expect(presentation).toMatchObject({ phase: "poll", retryable: true, submissionMayHaveOccurred: false });
    expect(presentation.message).toContain("原任务查询暂时中断");
    expect(presentation.message).not.toMatch(/提交结果未知|请稍后重试|已扣费/);
  });

  it("does not invent a submission phase for a plain gateway diagnostic", () => {
    const presentation = presentProviderError(new Error("HTTP 502 Bad Gateway"), { provider: "rest" });
    expect(presentation.message).toContain("核对供应商状态和原任务记录");
    expect(presentation).not.toHaveProperty("phase");
    expect(presentation.message).not.toMatch(/提交结果未知|请稍后重试/);
  });

  it("preserves explicit evidence that a gateway failure did not accept a task", () => {
    const presentation = presentProviderError(new ProviderHttpError("Provider returned HTTP 502", {
      kind: "provider", phase: "submit", status: 502, retryable: true, submissionMayHaveOccurred: false,
    }), { provider: "rest" });
    expect(presentation).toMatchObject({ phase: "submit", retryable: true, submissionMayHaveOccurred: false });
    expect(presentation.message).not.toContain("提交结果未知");
  });

  it("does not encourage another paid submission when overload is returned with an ambiguous HTTP error", () => {
    const presentation = presentProviderError(new ProviderHttpError("Provider returned HTTP 503", {
      kind: "provider", phase: "submit", status: 503, retryable: false, submissionMayHaveOccurred: true,
      responseBody: { message: "model is overloaded" },
    }), { provider: "rest" });
    expect(presentation).toMatchObject({ type: "供应商繁忙", phase: "submit", retryable: false });
    expect(presentation.message).toContain("提交结果未知");
    expect(presentation.message).not.toContain("请稍后重试");
  });

  it("explains confirmed asynchronous overload failures and retains the provider evidence", () => {
    const raw = 'adobe throttled: status 408 retry-after=none envoy=false {"error_code":"timeout_error","message":"system under load"}';
    expect(presentProviderError(new Error(raw), { provider: "openai", operation: "image.edit" })).toMatchObject({
      message: "供应商模型当前繁忙，未能完成本次生成，请稍后重试。",
      type: "供应商繁忙", code: "provider_overloaded", providerMessage: raw,
    });
  });

  it("distinguishes an upstream HTTP 524 from a local timeout without encouraging resubmission", () => {
    const error = new ProviderHttpError("Provider returned HTTP 524", {
      kind: "provider",
      phase: "submit",
      status: 524,
      retryable: false,
      submissionMayHaveOccurred: true,
      responseBody: "<html>Cloudflare: generation timed out after 125 seconds</html>",
    });

    const presentation = presentProviderError(error, { provider: "openai" });
    expect(presentation).toMatchObject({
      type: "请求链路网关超时",
      code: "HTTP 524",
      statusCode: 524,
    });
    expect(presentation.message).toContain("请求可能仍在生成或已扣费");
    expect(presentation.message).toContain("不要重复提交");
    expect(presentation.message).toContain("延长本地等待时间无法解除此网关限制");
    expect(presentation.message).not.toContain("请稍后重试");
  });

  it.each(["connect", "poll", "archive", "cancel"] as const)(
    "does not imply a new paid generation for HTTP 524 during %s",
    (phase) => {
      const error = new ProviderHttpError("Provider returned HTTP 524", {
        kind: "provider",
        phase,
        status: 524,
        retryable: true,
        submissionMayHaveOccurred: false,
      });
      const presentation = presentProviderError(error, { provider: "openai" });
      expect(presentation).toMatchObject({
        type: "请求链路网关超时", code: "HTTP 524", statusCode: 524,
      });
      expect(presentation.message).toContain("核对供应商服务或原任务状态");
      expect(presentation.message).not.toMatch(/已扣费|仍在生成|重复提交/);
    },
  );

  it("keeps a plain HTTP 524 diagnostic without guessing a paid submission", () => {
    const presentation = presentProviderError(new Error("Gateway error HTTP 524"), { provider: "rest" });
    expect(presentation).toMatchObject({ type: "请求链路网关超时", code: "HTTP 524" });
    expect(presentation.message).not.toMatch(/已扣费|仍在生成/);
  });

  it("shows the underlying transport code for network failures", () => {
    const error = new ProviderHttpError("Provider network request failed", {
      kind: "network",
      phase: "submit",
      retryable: false,
      submissionMayHaveOccurred: true,
      cause: new TypeError("fetch failed", {
        cause: Object.assign(new Error("socket closed"), {
          code: "UND_ERR_SOCKET",
        }),
      }),
    });

    expect(presentProviderError(error, { provider: "rest" })).toMatchObject({
      message: "API 提交过程中连接中断，未收到完整响应。供应商可能仍在生成或已扣费，请先核对原任务和账单，不要重复提交。",
      type: "连接中断",
      code: "UND_ERR_SOCKET",
      api: "自定义 REST API",
    });
  });

  it.each(["connect", "poll", "archive", "cancel"] as const)("keeps socket failures during %s separate from uncertain submission", (phase) => {
    const error = new ProviderHttpError("Provider network request failed", {
      kind: "network", phase, retryable: true, submissionMayHaveOccurred: false,
      cause: Object.assign(new Error("socket closed"), { code: "UND_ERR_SOCKET" }),
    });
    const presentation = presentProviderError(error, { provider: "openai" });
    expect(presentation).toMatchObject({ type: "连接中断", code: "UND_ERR_SOCKET" });
    expect(presentation.message).toContain("未收到完整响应");
    expect(presentation.message).not.toMatch(/仍在生成|已扣费|重复提交/);
  });

  it("explains EACCES as a local proxy or TUN/Fake-IP routing problem", () => {
    const error = new ProviderHttpError("Provider network request failed", {
      kind: "network",
      phase: "submit",
      retryable: true,
      submissionMayHaveOccurred: false,
      cause: new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect EACCES"), {
          code: "EACCES",
        }),
      }),
    });

    expect(presentProviderError(error, { provider: "openai" })).toMatchObject({
      message: expect.stringContaining("HTTP_PROXY/HTTPS_PROXY"),
      type: "本机网络权限错误",
      code: "EACCES",
    });
  });

  it("keeps supplier socket disconnects unattributed without claiming authentication was verified", () => {
    const error = new ProviderHttpError("Provider network request failed", {
      kind: "network",
      phase: "submit",
      retryable: false,
      submissionMayHaveOccurred: true,
      cause: new TypeError("fetch failed", {
        cause: Object.assign(new Error("socket closed"), {
          code: "UND_ERR_SOCKET",
        }),
      }),
    });

    expect(
      presentProviderError(error, {
        provider: "rest",
        supplier: "cyberafei",
        operation: "image.generate",
      }),
    ).toMatchObject({
      message:
        "API 提交过程中连接中断，未收到完整响应。供应商可能仍在生成或已扣费，请先核对原任务和账单，不要重复提交。",
      type: "连接中断",
      failureCategory: "network",
      charge: { status: "unknown", source: "unconfirmed" },
      code: "UND_ERR_SOCKET",
      api: "赛博阿飞 API",
    });
  });

  it("labels MikotoPro Gemini errors by supplier instead of the shared adapter", () => {
    const error = new ProviderHttpError("Unable to read provider response", {
      kind: "invalid_response",
      phase: "submit",
      status: 200,
      retryable: false,
      submissionMayHaveOccurred: true,
    });

    expect(
      presentProviderError(error, {
        provider: "weai",
        supplier: "mikoto",
        operation: "image.generate",
      }),
    ).toMatchObject({
      type: "响应格式错误",
      code: "HTTP 200",
      api: "MikotoPro Gemini API",
      docsUrl: "https://api.mikoto.vip/custom/0dcbf4f93685de2d",
    });
  });

  it("keeps Runway task failure codes and links their official guide", () => {
    expect(
      presentProviderError("Input was rejected [SAFETY.INPUT.TEXT]", {
        provider: "runway",
        operation: "video.generate",
      }),
    ).toEqual({
      message:
        "内容审核未通过：提示词或参考素材被内容安全系统拒绝，请修改后重新提交。",
      type: "内容审核错误",
      code: "SAFETY.INPUT.TEXT",
      api: "Runway 视频生成 API",
      failureCategory: "content_policy",
      charge: { status: "unknown", source: "unconfirmed" },
      docsUrl: "https://docs.dev.runwayml.com/errors/task-failures/",
    });
  });
});
