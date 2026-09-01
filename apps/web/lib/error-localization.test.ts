import { describe, expect, it } from "vitest";

import { localizeRunError } from "./error-localization";

describe("localizeRunError", () => {
  it("distinguishes completed generation from a failed local archive", () => {
    expect(
      localizeRunError({
        message:
          "供应商任务已完成，但输出归档失败：Provider output download timed out",
        code: "artifact_archive_failed",
      }),
    ).toEqual({
      message: "图片已经生成完成，但下载到素材库时中断，可以直接取回现有结果。",
      type: "结果归档错误",
      code: "artifact_archive_failed",
    });
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
      message: "上游 API 暂时不可用（HTTP 502），请稍后重试。",
      type: "网关或上游服务错误",
      code: "HTTP 502",
    });
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
