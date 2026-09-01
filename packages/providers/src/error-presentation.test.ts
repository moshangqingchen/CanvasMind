import { describe, expect, it } from "vitest";

import { presentProviderError } from "./error-presentation";
import { ProviderHttpError } from "./http";

describe("provider error presentation", () => {
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
      message: "上游 API 暂时不可用（HTTP 502），请稍后重试。",
      type: "网关或上游服务错误",
      code: "HTTP 502",
      api: "自定义 REST API",
    });
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
      message: "API 提交时网络连接失败，请检查网络和接口地址。",
      type: "网络连接错误",
      code: "UND_ERR_SOCKET",
      api: "自定义 REST API",
    });
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

  it("explains Cyber Afei long-running socket disconnects without blaming local configuration", () => {
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
        "赛博阿飞或其上游在生成过程中断开了长连接；鉴权和接口地址正常。请求可能已经被受理，请先核对供应商日志与扣费记录，不要立即重复提交。",
      type: "供应商连接中断",
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
      docsUrl: "https://docs.dev.runwayml.com/errors/task-failures/",
    });
  });
});
