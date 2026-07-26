import { describe, expect, it } from "vitest";

import { presentProviderError } from "./error-presentation";
import { ProviderHttpError } from "./http";

describe("provider error presentation", () => {
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

    expect(
      presentProviderError(error, { provider: "rest" }),
    ).toMatchObject({
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

  it("keeps Runway task failure codes and links their official guide", () => {
    expect(
      presentProviderError(
        "Input was rejected [SAFETY.INPUT.TEXT]",
        { provider: "runway", operation: "video.generate" },
      ),
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
