import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { SupplierConflictError, type JsonObject, type ProviderConnectionRecord } from "@super-canvas/db";
import type { CliProviderAdapter } from "@super-canvas/providers";
import { configFingerprint, parseCliConnectorConfig } from "@super-canvas/providers/cli-contracts";
import { getRunService } from "@super-canvas/runtime";
import { jsonError, maskConnection, redactPublicText, repository } from "./server";

/** Persist only local settings. Probe state and model catalogs are server-owned. */
export async function saveCliConnection(input: {
  id?: string; name: string; apiKey?: string; config?: JsonObject;
}): Promise<Response> {
  try {
    if (input.apiKey) return jsonError("个人网站使用 CLI 登录状态，请勿填写 API Key", 400);
    const cli = parseCliConnectorConfig(input.config?.cli);
    const previous = input.id ? await repository.getConnection(input.id) : null;
    if (input.id && !previous) return jsonError("个人网站连接不存在，请重新创建", 404);
    if (previous && previous.provider !== "cli") return jsonError("不能更改已有连接的接入类型", 409);
    const unchanged = previous && configFingerprint(parseCliConnectorConfig(previous.config.cli)) === configFingerprint(cli);
    const config: JsonObject = {
      cli: cli as unknown as JsonObject,
      usage: "canvas",
      supplierKey: `cli-${cli.siteId}`,
      supplierName: cli.siteName,
      modelGroup: cli.accountLabel || "默认账号",
      cliStatus: unchanged ? previous.config.cliStatus ?? { state: "unconfigured" } : { state: "unconfigured" },
      modelScanStatus: unchanged ? previous.config.modelScanStatus ?? "unscanned" : "unscanned",
      modelCatalogModels: unchanged ? previous.config.modelCatalogModels ?? [] : [],
      modelScanRequestId: randomUUID(),
    };
    if (unchanged) {
      for (const key of ["modelScanCheckedAt", "modelScanLastSuccessAt", "modelCatalogSource", "defaultModel"])
        if (previous.config[key] !== undefined) config[key] = previous.config[key];
    }
    const saved = await repository.saveConnection({
      id: input.id ?? randomUUID(), name: input.name, provider: "cli", encryptedSecret: null, config,
    }, { expected: previous ?? undefined });
    return Response.json(maskConnection(saved), { status: previous ? 200 : 201 });
  } catch (error) {
    return jsonError(redactPublicText(error instanceof Error ? error.message : "个人网站连接保存失败"), error instanceof SupplierConflictError ? 409 : 400);
  }
}

function cliAdapter(connection: ProviderConnectionRecord): CliProviderAdapter {
  // Freeze the configuration selected by this explicit click. A concurrent edit
  // must not make the second command in a probe execute a different program.
  const snapshot = structuredClone(connection.config);
  const adapter = getRunService().adapters({ resolve: async id => {
    if (id !== connection.id) throw new Error("CLI 检测连接不匹配");
    return { id, provider: "cli", settings: snapshot };
  } }).get("cli");
  if (!adapter || !("checkConnection" in adapter) || !("describe" in adapter)) throw new Error("CLI 适配器不可用");
  return adapter as CliProviderAdapter;
}

export async function probeCliConnection(id: string, action: "test" | "describe"): Promise<Response> {
  let original: ProviderConnectionRecord | null = null;
  let requestId: string | undefined;
  try {
    original = await repository.getConnection(id);
    if (!original || original.provider !== "cli") return jsonError("个人网站连接不存在", 404);
    const config = parseCliConnectorConfig(original.config.cli);
    if (!config.enabled || !config.executable) return jsonError("请填写程序路径并启用连接后再检测", 400);
    requestId = randomUUID();
    original = await repository.saveConnection({ ...original, config: { ...original.config, modelScanRequestId: requestId } }, { expected: original });
    const adapter = cliAdapter(original);
    const check = await adapter.checkConnection(id);
    const described = action === "describe" && check.ready ? await adapter.describe(id) : undefined;
    const latest = await repository.getConnection(id);
    if (!latest || latest.config.modelScanRequestId !== requestId)
      return jsonError("检测期间连接已改变，旧结果已丢弃，请重新检测", 409);
    const checkedAt = new Date().toISOString();
    const nextConfig: JsonObject = {
      ...latest.config,
      cliStatus: {
        state: check.ready ? "ready" : check.loginRequired ? "login_required" : "error",
        checkedAt,
        configFingerprint: configFingerprint(config),
        message: redactPublicText(check.message || (check.ready ? "连接可用" : "请先按 CLI 说明登录账号")),
        supportsCancel: described?.supportsCancel ?? check.supportsCancel,
      },
    };
    if (described) {
      const models = described.models;
      nextConfig.modelCatalogModels = models as unknown as JsonObject[];
      nextConfig.modelScanStatus = models.length ? "live" : "empty";
      nextConfig.modelCatalogSource = "cli";
      nextConfig.modelScanCheckedAt = checkedAt;
      nextConfig.modelScanLastSuccessAt = checkedAt;
      const selected = models.find(m => m.id === latest.config.defaultModel) ?? models.find(m => m.isDefault) ?? models[0];
      if (selected) nextConfig.defaultModel = selected.id;
      else delete nextConfig.defaultModel;
    } else if (!check.ready) nextConfig.modelScanStatus = check.loginRequired ? "unauthorized" : "failed";
    const saved = await repository.saveConnection({ ...latest, config: nextConfig }, { expected: latest });
    return Response.json({ connection: maskConnection(saved), ...(described ? { models: described.models } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupplierConflictError) return jsonError(error.message, 409);
    const message = redactPublicText(error instanceof Error ? error.message : "CLI 检测失败").slice(0, 4096);
    const loginRequired = error instanceof Error && "code" in error && error.code === "LOGIN_REQUIRED";
    const latest = requestId ? await repository.getConnection(id) : null;
    if (latest && latest.config.modelScanRequestId === requestId) {
      try {
        const saved = await repository.saveConnection({ ...latest, config: { ...latest.config,
          cliStatus: { state: loginRequired ? "login_required" : "error", checkedAt: new Date().toISOString(), message },
          modelScanStatus: loginRequired ? "unauthorized" : "failed",
        } }, { expected: latest });
        return Response.json({ error: message, connection: maskConnection(saved) }, { status: loginRequired ? 401 : 502 });
      } catch { return jsonError("检测期间连接已改变，请重新检测", 409); }
    }
    return jsonError(message, 502);
  }
}

/** The desktop sets this path to its bundled, fixed example; no user code runs. */
export async function mockCliTemplate(): Promise<{ executable: string; args: string[] }> {
  const roots = [process.env.SUPERCANVAS_CLI_EXAMPLES_ROOT];
  // Runtime-only lookup. Desktop staging explicitly copies the fixed example.
  let ancestor = resolve(/* turbopackIgnore: true */ process.cwd());
  for (let i = 0; i < 5; i++) { roots.push(join(ancestor, "packages/providers/examples")); ancestor = dirname(ancestor); }
  for (const root of roots) {
    if (!root) continue;
    const script = resolve(root, "mock-cli.mjs");
    try { await access(script); return { executable: process.execPath, args: [script] }; } catch { /* Try the development layout. */ }
  }
  throw new Error("模拟 CLI 文件缺失，请重新构建桌面运行资源");
}
