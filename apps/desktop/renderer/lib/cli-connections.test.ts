import { describe, expect, it } from "vitest";
import type { ProviderConnectionView } from "./client-api";
import { cliConnectionReady, cliStatusLabel, CLI_DEFAULT_TIMEOUTS } from "./cli-connections";
import { providerConnectionGroup, providerConnectionSupplierKey, providerConnectionSupplierLabel } from "./provider-connection-options";
import { connectionSupportsNodeType } from "./graph-ui";

function fixture(): ProviderConnectionView {
  return { id: "local-jimeng", name: "我的即梦", provider: "cli", apiKey: "", apiKeySet: false, apiKeyUsable: false,
    config: { cli: { version: 1, siteId: "jimeng", siteName: "即梦", accountLabel: "我的主账号", executable: "node", args: ["bridge.mjs"], enabled: true, ...CLI_DEFAULT_TIMEOUTS }, cliStatus: { state: "ready" }, modelCatalogModels: [{ id: "video-live", name: "动态视频", operations: ["video.generate"] }] } };
}
describe("personal website connections", () => {
  it("uses local CLI readiness without requiring an API Key", () => {
    const connection = fixture();
    expect(cliConnectionReady(connection)).toBe(true);
    expect(cliStatusLabel(connection)).toBe("已就绪");
    expect(providerConnectionSupplierKey(connection)).toBe("cli-jimeng");
    expect(providerConnectionSupplierLabel(connection)).toBe("即梦");
    expect(providerConnectionGroup(connection)).toBe("我的主账号");
    connection.config.cliStatus = { state: "login_required" };
    expect(cliConnectionReady(connection)).toBe(false);
    expect(cliStatusLabel(connection)).toContain("登录");
  });
  it("does not invent media support while an empty CLI is awaiting setup", () => {
    const connection = fixture();
    connection.config.modelCatalogModels = [];
    expect(cliConnectionReady(connection)).toBe(false);
    expect(connectionSupportsNodeType(connection, "video-generation", [])).toBe(false);
    expect(connectionSupportsNodeType(connection, "image-generation", [])).toBe(false);
    (connection.config.cli as { enabled: boolean }).enabled = false;
    expect(cliStatusLabel(connection)).toBe("已停用");
  });
});
