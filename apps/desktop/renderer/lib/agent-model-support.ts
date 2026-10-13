/** Reject removed native connections and model selections before any API call. */
export function unsupportedAgentModelReason(
  config: Record<string, unknown>,
  model?: { id: string; name?: string; metadata?: Readonly<Record<string, unknown>> },
): string | undefined {
  if (
    [config.directorProtocol, config.protocol, model?.metadata?.agentProtocol, model?.metadata?.protocol]
      .includes("anthropic-messages") ||
    /^https?:\/\/api\.anthropic\.com(?:[/:]|$)/iu.test(String(config.baseUrl ?? "")) ||
    [model?.id, model?.name].some(value => typeof value === "string" &&
      /(?:^|[/:\s])claude(?:$|[-_.\s])/iu.test(value))
  ) return "Claude / Anthropic 支持已移除，请重新选择受支持的模型和连接";
  return undefined;
}
