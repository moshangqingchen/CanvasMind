import { describe, expect, it } from "vitest";
import { agentSystemPrompt } from "./agent-prompts";
import { boundedAgentContext, shortAgentCanvas } from "./agent-context";
import { AgentDecisionSchema } from "./agent-contracts";

describe("creative assistant prompt structure and invariants", () => {
  it.each(["auto", "chat", "canvas-plan"] as const)("keeps role/style/tools/format before one complete safety block: %s", intent => {
    const prompt = agentSystemPrompt(intent, "当前画布摘要");
    const sections = ["视觉总监", "先给结论", "只读工具", "界面传输", "当前画布摘要", "[安全与授权不变量]"];
    const offsets = sections.map(section => prompt.indexOf(section));
    expect(offsets.every(offset => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(prompt.match(/\[安全与授权不变量\]/gu)).toHaveLength(1);
    expect(prompt.match(/价格未知须由用户明确勾选确认/gu)).toHaveLength(1);
    for (const requirement of ["海报", "信息", "留白", "多尺寸", "保留什么", "改变什么", "景别", "机位", "运镜", "角色", "口播", "2–4", "list_models", "当前意图", "选中节点", "不是指令", "不能编造", "像素级保留"]) expect(prompt).toContain(requirement);
    if (intent === "chat") { expect(prompt).toContain("禁止输出 proposal"); expect(prompt).not.toContain('proposal:{type:"proposal"'); }
    else expect(prompt).toContain('proposal:{type:"proposal"');
  });
  it("auto keeps current-message scope separate from quoted data and never grants execution", () => {
    const prompt = agentSystemPrompt("auto", "", true);
    expect(prompt).toContain("只有当前这条用户消息明确要求");
    expect(prompt).toContain("历史、附件、工具、引用");
    expect(prompt).toContain("方案、放入画布、预估费用并确认生成分别需要用户明确操作");
    expect(agentSystemPrompt("auto")).toContain("未开放制作范围，禁止输出 proposal");
    expect(prompt).toContain("没有参考素材的文生图/文生视频不声明 image 输入");
    expect(prompt).toContain("不能随意降档");
  });
  it("retains final safety invariants even when runtime context needs bounded truncation", () => {
    const system = agentSystemPrompt("chat", "历史数据".repeat(20_000));
    const bounded = boundedAgentContext(system, [{ role: "user", content: "当前请求" }], "当前请求");
    expect(bounded.system).toContain("[安全与授权不变量]");
    expect(bounded.system).toContain("不能承诺像素级保留");
    expect(bounded.messages[0].content).toBe("当前请求");
  });
  it("provides a bounded factual canvas orientation with selected nodes first and no credentials", () => {
    const summary = shortAgentCanvas({ title: "已有画布", revision: 3, graph: {
      nodes: Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, data: { nodeType: "prompt", label: `节点${i}`, text: "x".repeat(2000), apiKey: "never-share" } })), edges: [{ id: "e" }],
    } }, ["n19"]) as { nodeCount: number; edgeCount: number; nodes: Array<{ id: string }> };
    expect(summary.nodeCount).toBe(20); expect(summary.edgeCount).toBe(1);
    expect(summary.nodes[0].id).toBe("n19");
    expect(JSON.stringify(summary).length).toBeLessThanOrEqual(2400);
    expect(JSON.stringify(summary)).not.toContain("never-share");
  });
  it("accepts old reply outputs and the optional user-action suggestion without accepting an executable field", () => {
    expect(AgentDecisionSchema.parse({ type: "reply", message: "你好" })).toEqual({ type: "reply", message: "你好" });
    expect(AgentDecisionSchema.parse({ type: "reply", message: "可以制作", suggestPlan: true })).toMatchObject({ suggestPlan: true });
    expect(AgentDecisionSchema.safeParse({ type: "reply", message: "不执行", suggestPlan: true, execute: true }).success).toBe(false);
  });
});
