import { describe, expect, it } from "vitest";
import { modelInventoryStatusLabel } from "./model-inventory-status-label";

describe("model inventory status summary", () => {
  it.each([
    { code: "GROUP_DELETED", label: "分组已删除" },
    { code: "GROUP_DISABLED", label: "分组已停用" },
    { code: "GROUP_NOT_ALLOWED", label: "当前账号无此分组权限" },
  ])("shows $code instead of claiming the Key is invalid", ({ code, label }) => {
    const config = Object.freeze({ modelScanUpstreamErrorCode: code, modelScanHttpStatus: 403,
      modelScanErrorCode: "permission_denied", modelScanError: "private-upstream-message",
      modelGroup: "retained-group", scannedModelIds: ["retained-model"] });
    const before = JSON.stringify(config);
    expect(modelInventoryStatusLabel("unauthorized", config)).toBe(label);
    expect(JSON.stringify(config)).toBe(before);
  });

  it.each([
    { config: { modelScanHttpStatus: 403 }, label: "Key 无目录权限" },
    { config: { modelScanHttpStatus: 401 }, label: "Key 鉴权失败" },
    { config: { modelScanHttpStatus: 403, modelScanErrorCode: "invalid_credentials" }, label: "Key 无目录权限" },
    { config: { modelScanHttpStatus: 401, modelScanErrorCode: "permission_denied" }, label: "Key 鉴权失败" },
    { config: { modelScanErrorCode: "permission_denied" }, label: "Key 无目录权限" },
    { config: { modelScanErrorCode: "invalid_credentials" }, label: "Key 鉴权失败" },
    { config: {}, label: "Key 鉴权或权限待确认" },
    { config: { modelScanUpstreamErrorCode: "private-token", modelScanError: "private-upstream-message" }, label: "Key 鉴权或权限待确认" },
    { config: { modelScanUpstreamErrorCode: "toString" }, label: "Key 鉴权或权限待确认" },
  ])("distinguishes HTTP authentication and permission evidence: $config", ({ config, label }) => {
    expect(modelInventoryStatusLabel("unauthorized", config)).toBe(label);
  });

  it.each([
    { status: "live", label: "模型列表已确认" },
    { status: "empty", label: "本次未返回模型" },
    { status: "failed", label: "模型可用性待确认" },
    { status: "stale", label: "模型可用性待确认" },
    { status: "unscanned", label: "模型可用性待确认" },
  ])("keeps $status independent of a previous denied scan", ({ status, label }) => {
    expect(modelInventoryStatusLabel(status, { modelScanUpstreamErrorCode: "GROUP_DELETED", modelScanHttpStatus: 403 })).toBe(label);
  });
});
