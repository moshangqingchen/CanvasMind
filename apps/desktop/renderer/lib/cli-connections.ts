import type { ModelDescriptor } from "@super-canvas/providers";
import { CLI_DEFAULTS, type CliConnectorConfig } from "@super-canvas/providers/cli-contracts";
import { fetchConnections, invalidateModelCache, type ProviderConnectionView } from "./client-api";

export type CliSettings = CliConnectorConfig;
export const CLI_DEFAULT_TIMEOUTS = CLI_DEFAULTS;

export function cliSettings(connection: Pick<ProviderConnectionView, "config">): Partial<CliSettings> {
  const value = connection.config.cli;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<CliSettings> : {};
}

export function cliConnectionReady(connection: ProviderConnectionView): boolean {
  const config = cliSettings(connection);
  const status = connection.config.cliStatus as { state?: string } | undefined;
  return connection.provider === "cli" && config.enabled === true && Boolean(config.executable?.trim()) && status?.state === "ready" && Array.isArray(connection.config.modelCatalogModels) && connection.config.modelCatalogModels.length > 0;
}

export function cliStatusLabel(connection?: ProviderConnectionView): string {
  if (!connection) return "待接入";
  if (!cliSettings(connection).enabled) return "已停用";
  const status = connection.config.cliStatus as { state?: string } | undefined;
  if (status?.state === "login_required") return "请先在 CLI 中登录";
  if (status?.state === "error") return "连接待检查";
  if (status?.state === "ready") return cliConnectionReady(connection) ? "已就绪" : "等待同步模型与参数";
  return "待接入";
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "个人 AI 网站连接操作失败");
  if (!body) throw new Error("个人 AI 网站返回了无效响应");
  return body as T;
}

export async function runCliConnectionAction(id: string, action: "test" | "describe"): Promise<{ connection: ProviderConnectionView; models?: ModelDescriptor[] }> {
  const result = await readResponse<{ connection: ProviderConnectionView; models?: ModelDescriptor[] }>(await fetch(`/api/providers/${encodeURIComponent(id)}/cli`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }));
  invalidateModelCache(id);
  return result;
}

export async function fetchCliDemoTemplate(): Promise<Pick<CliSettings, "executable" | "args" | "cwd">> {
  return readResponse(await fetch("/api/providers/cli-template", { cache: "no-store" }));
}

export async function deleteCliConnection(id: string): Promise<ProviderConnectionView[]> {
  const response = await fetch(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) await readResponse(response);
  invalidateModelCache(id);
  return fetchConnections();
}
