import type { NodeConfigRunScope } from "./node-config-interaction";

interface GenerationNodeRunOptions {
  connectionAvailable: boolean;
  maskProblem: string | null;
  running: boolean;
  nodeType: string;
  onRun?: () => void;
  onRunDownstream?: () => void;
}

/** The node toolbar and parameter footer share the same guard and entry point. */
export function createGenerationNodeRunAction({
  connectionAvailable,
  maskProblem,
  running,
  nodeType,
  onRun,
  onRunDownstream,
}: GenerationNodeRunOptions) {
  const disabled = !connectionAvailable || Boolean(maskProblem);
  return {
    disabled,
    title: maskProblem ?? (connectionAvailable
      ? running ? "创建新的独立任务，当前任务继续生成（Ctrl+Enter）" : "运行节点（Ctrl+Enter）"
      : "当前 API 连接不可用"),
    label: running ? nodeType === "image-generation" ? "再生成一张" : "再生成一个" : "运行",
    run(scope: NodeConfigRunScope = "node", beforeRun?: () => void) {
      if (disabled) return;
      beforeRun?.();
      (scope === "downstream" ? onRunDownstream : onRun)?.();
    },
  };
}
