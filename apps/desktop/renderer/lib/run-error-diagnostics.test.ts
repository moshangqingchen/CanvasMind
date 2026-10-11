import { describe, expect, it } from "vitest";
import { localizeRunError } from "./error-localization";
import { runErrorDiagnostic, runErrorTechnicalTitle } from "./run-error-diagnostics";

describe("run error diagnostic source labels", () => {
  it("labels the saved local validation reason accurately without losing details", () => {
    const error = localizeRunError({ message: "请求未提交：分辨率无效", providerMessage: "分辨率无效" });
    expect(runErrorTechnicalTitle(error)).toBe("技术详情与本地校验");
    expect(runErrorDiagnostic(error)).toBe("本地校验：分辨率无效");
  });

  it("distinguishes a supplier response from an unknown historical diagnostic", () => {
    const error = { message: "供应商拒绝了请求", providerMessage: "Unsupported resolution" };
    expect(runErrorDiagnostic({ ...error, source: "provider_response" })).toBe("供应商原文：Unsupported resolution");
    expect(runErrorTechnicalTitle({ ...error, source: "provider_response" })).toBe("技术详情与供应商原文");
    expect(runErrorDiagnostic(error)).toBe("错误原文：Unsupported resolution");
    expect(runErrorTechnicalTitle(error)).toBe("技术详情与错误原文");
    expect(runErrorDiagnostic(null)).toBeNull();
  });
});
