export interface AgentToolContext {
  canvasId: string;
  allowedAssetIds: readonly string[];
  signal?: AbortSignal;
}
export interface AgentReadTool {
  name: string;
  description: string;
  execute(
    input: { assetIds: string[]; runId?: string },
    context: AgentToolContext,
  ): Promise<unknown>;
}
/** Only observation tools are available to model decisions. Canvas mutations
 * and generation remain separate, user-confirmed API operations. */
export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentReadTool>();
  register(tool: AgentReadTool): this {
    if (this.tools.has(tool.name))
      throw new Error(`工具名称重复：${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }
  descriptions() {
    return [...this.tools.values()].map(({ name, description }) => ({
      name,
      description,
    }));
  }
  async execute(
    name: string,
    input: { assetIds: string[]; runId?: string },
    context: AgentToolContext,
  ) {
    if (context.signal?.aborted) throw new Error("分析已停止");
    const tool = this.tools.get(name);
    if (!tool) throw new Error("智能体请求了未接入的工具");
    return tool.execute(input, context);
  }
}
