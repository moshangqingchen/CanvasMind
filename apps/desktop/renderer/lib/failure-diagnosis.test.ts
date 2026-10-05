import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { failureDiagnosis } from "./failure-diagnosis";
import { localizeRunError } from "./error-localization";
import { FailureDiagnosis } from "../components/failure-diagnosis";

afterEach(() => vi.unstubAllGlobals());

describe("generation failure diagnosis", () => {
  it("explains the provider cooldown on saved 24-hour content blocks", () => {
    const error = localizeRunError({ message: "请求参数错误", code: "content_blocked_24h", failureCategory: "invalid_request" });
    expect(failureDiagnosis(error)).toMatchObject({ category: "content_policy", chargeStatus: "unknown",
      nextStep: expect.stringContaining("等待限制结束") });
  });
  it("presents cancellation as cancellation while preserving a confirmed charge", () => {
    vi.stubGlobal("React", React);
    const error = localizeRunError({ message: "运行已取消", charge: { status: "charged", amount: 0.1, currency: "USD", source: "provider_response" } });
    const markup = renderToStaticMarkup(React.createElement(FailureDiagnosis, { error, status: "cancelled" }));
    expect(markup).toContain('aria-label="取消信息"');
    expect(markup).toContain("取消原因");
    expect(markup).toContain("已扣费");
    expect(markup).toContain("取消不等于退款");
    expect(markup).not.toContain("失败原因");
    expect(markup).not.toContain("失败诊断");
  });

  it("keeps legacy HTTP failures and missing task IDs financially unconfirmed", () => {
    for (const error of [null, localizeRunError("HTTP 500"), localizeRunError({ message: "生成失败", code: "generation_failed", statusCode: 400 })]) {
      expect(failureDiagnosis(error)).toMatchObject({
        chargeStatus: "unknown", chargeLabel: "扣费待确认", amountLabel: "未提供",
        chargeSource: expect.stringContaining("失败不代表未扣费"),
        nextStep: expect.stringContaining("核对原任务和账单"),
      });
    }
  });

  it("displays explicit charge evidence with all decimal places and an explicit unit", () => {
    expect(failureDiagnosis(localizeRunError({ message: "生成失败", failureCategory: "supplier_error",
      charge: { status: "charged", amount: 0.0000000345, currency: "USD", source: "provider_response" },
    }))).toMatchObject({ chargeLabel: "已扣费", amountLabel: "3.45e-8 USD", chargeSource: "供应商本次响应" });
    expect(failureDiagnosis(localizeRunError({ message: "生成失败",
      charge: { status: "charged", amount: 0.036, source: "provider_response" },
    })).amountLabel).toBe("0.036 （币种 / 单位未提供）");
  });

  it("labels a refund amount separately from the original charge", () => {
    expect(failureDiagnosis(localizeRunError({ message: "生成失败后退费",
      charge: { status: "refunded", amount: 0.12, currency: "CNY", source: "provider_response" },
    }))).toMatchObject({ chargeLabel: "已退款", amountLabel: "退款金额 0.12 CNY" });
  });

  it("shows not charged only with explicit supplier evidence or confirmed non-submission", () => {
    expect(failureDiagnosis(localizeRunError({ message: "连接失败", failureCategory: "local_network",
      charge: { status: "not_charged", source: "not_submitted" },
    }))).toMatchObject({ chargeLabel: "未扣费", chargeSource: "请求尚未发送（本地确认）" });
    expect(failureDiagnosis(localizeRunError({ message: "生成失败",
      charge: { status: "not_charged", amount: 0, currency: "credits", source: "provider_response" },
    })).amountLabel).toBe("0 credits");
    expect(failureDiagnosis(localizeRunError({ message: "HTTP 400", submissionMayHaveOccurred: false })).chargeLabel)
      .toBe("扣费待确认");
  });

  it("does not blame an ambiguous connection failure on the local network", () => {
    const diagnosis = failureDiagnosis(localizeRunError({ message: "网络连接中断", code: "ECONNRESET" }));
    expect(diagnosis.category).toBe("network");
    expect(diagnosis.categoryLabel).toBe("网络链路异常");
    expect(diagnosis.nextStep).toContain("不能确认故障发生在哪一侧");
    expect(diagnosis.categoryLabel).not.toContain("本机");
  });

  it("distinguishes account balance, supplier capacity and local archive recovery", () => {
    expect(failureDiagnosis(localizeRunError({ message: "余额不足" })).categoryLabel).toBe("余额或额度不足");
    expect(failureDiagnosis(localizeRunError("No available compatible accounts")).categoryLabel).toBe("供应商暂无可用账号或容量");
    const diagnosis = failureDiagnosis(localizeRunError({ message: "磁盘空间不足", failureCategory: "local_storage" }), { providerTaskStatus: "succeeded" });
    expect(diagnosis.categoryLabel).toBe("本地保存异常");
    expect(diagnosis.nextStep).toContain("取回已有结果，无需重新生成");
    expect(diagnosis.chargeLabel).toBe("扣费待确认");
  });

  it("renders the four diagnosis fields in an accessible shared region", () => {
    vi.stubGlobal("React", React);
    const markup = renderToStaticMarkup(React.createElement(FailureDiagnosis, {
      error: localizeRunError({ message: "余额不足", failureCategory: "insufficient_balance",
        charge: { status: "not_charged", source: "provider_response" } }),
    }));
    expect(markup).toContain('aria-label="失败诊断"');
    for (const label of ["失败原因", "扣费状态", "金额", "下一步", "未扣费", "余额或额度不足"])
      expect(markup).toContain(label);
  });
});
