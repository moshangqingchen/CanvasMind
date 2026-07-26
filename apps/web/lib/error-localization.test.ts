import { describe, expect, it } from "vitest";

import { localizeRunError } from "./error-localization";

describe("localizeRunError", () => {
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
    };
    expect(localizeRunError(error)).toEqual(error);
  });
});
