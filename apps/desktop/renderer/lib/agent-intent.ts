export type AgentIntent = "auto" | "chat" | "canvas-plan";

/** Only the current instruction can open a proposal scope. This conservative
 * gate is independent of model judgement and never authorizes execution. */
export function currentMessageRequestsCreation(message: string): boolean {
  const instruction = message
    .replace(/```[\s\S]*?(?:```|$)/gu, " ")
    .replace(/^\s*>.*$/gmu, " ")
    .replace(/(?:“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'|`[^`]*`)/gu, " ")
    .replace(/<(?:attachment|tool|observation|reference|quoted)[^>]*>[\s\S]*?<\/(?:attachment|tool|observation|reference|quoted)>/giu, " ")
    .replace(/(?:附件(?:内容|文字|正文)?|引用(?:内容|文字)?|工具观察|历史消息)\s*[:：][\s\S]*$/u, " ")
    .trim();
  if (!instruction) return false;
  // A request to discuss or summarize reported words cannot promote those words
  // to instructions. Text-only creative work stays available as an artifact.
  if (/(?:只(?:想|要|是)?|先|仅)(?:聊|讨论|解释|分析)|(?:解释|翻译|分析|评价|总结|引用|复述)[^。！？\n]{0,20}(?:这句|这段|下面|引用|文字|文本|附件|资料|消息|指令)|(?:朋友|客户|对方|他|她|文档|资料)(?:说|要求|写道|的消息)[：:]|(?:生成|制作|出图)[^。！？\n]{0,10}(?:是什么意思|的原理|的思路|为什么|能不能|可以吗)|(?:了解|解释)[^。！？\n]{0,8}(?:怎么|如何)(?:生成|制作)|\b(?:only discuss|explain|how to|how can|what does)\b/iu.test(instruction)) return false;
  return instruction.split(/[，,。！？!?；;\n]|(?:并(?:且)?|同时|然后|以及)(?=\s*(?:写|生成|制作|出图|生图|做|画|提供|给出))/u).some(clause => {
    // Bind a negation inside its own clause. “不要让我点确认” is a request to
    // bypass confirmation, not a negation of the earlier creation request; the
    // independent materialize/preflight/execute gates still refuse that bypass.
    if (/(?:不(?=生成|制作|出图|生图|放)|不要|别|不用|不需要|不想|不打算|不准备|不计划|不会|并非|不是要)[^，,;；。！？\n]{0,8}(?:生成|制作|出图|生图|做|画布)|^(?:不制作|不生成|不放)|\b(?:do not|don't|never|not planning to)\b/iu.test(clause)) return false;
    if (/(?:生成|制作|做|写|改写|优化)[^，,;；。！？\n]{0,24}(?:提示词|脚本|分镜|文案|文字|口播)/u.test(clause)) return false;
    return /(?:生成|出图|生图|画一张|做(?:一张|一组|一套|个|一个|成|视频|海报|物料|图片|动画)|制作|放(?:到|进|入)(?:当前)?画布|添加到画布|创建(?:画布|图像|图片|视频)|(?:整理|规划|提出)[^，,;；。！？\n]{0,20}(?:画布方案|制作方案|生成方案))/u.test(clause) ||
      /\b(?:generate|create|render|make)\s+(?:an?\s+|the\s+)?(?:image|poster|video|artwork|illustration|canvas)\b|\b(?:put|add)\b[^.\n]{0,30}\bcanvas\b/iu.test(clause);
  });
}

export function agentProposalAllowed(intent: AgentIntent, currentMessage: string): boolean {
  return intent === "canvas-plan" || (intent === "auto" && currentMessageRequestsCreation(currentMessage));
}
