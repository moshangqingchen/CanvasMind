import { describe, expect, it, vi } from "vitest";
import { createGenerationNodeRunAction } from "./generation-node-actions";

const ready = {
  connectionAvailable: true,
  maskProblem: null,
  running: false,
  nodeType: "image-generation",
};

describe("shared generation node run action", () => {
  it.each([
    { connectionAvailable: false, maskProblem: null, title: "当前 API 连接不可用" },
    { connectionAvailable: true, maskProblem: "请连接蒙版对应的原图", title: "请连接蒙版对应的原图" },
    { connectionAvailable: false, maskProblem: "原图已改变，请重新绘制蒙版", title: "原图已改变，请重新绘制蒙版" },
  ])("blocks both scopes without committing drafts when unavailable: $title", scenario => {
    const beforeRun = vi.fn(), onRun = vi.fn(), onRunDownstream = vi.fn();
    const action = createGenerationNodeRunAction({ ...ready, ...scenario, onRun, onRunDownstream });
    expect(action.disabled).toBe(true);
    expect(action.title).toBe(scenario.title);
    action.run("node", beforeRun); action.run("downstream", beforeRun);
    expect(beforeRun).not.toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
    expect(onRunDownstream).not.toHaveBeenCalled();
  });

  it("commits drafts before dispatching the existing owner callback for each scope", () => {
    const calls: string[] = [];
    const beforeRun = () => { calls.push("commit"); };
    const action = createGenerationNodeRunAction({ ...ready,
      onRun: () => { calls.push("node"); },
      onRunDownstream: () => { calls.push("downstream"); },
    });
    action.run("node", beforeRun); action.run("downstream", beforeRun);
    expect(calls).toEqual(["commit", "node", "commit", "downstream"]);
    expect(action.label).toBe("运行");
    expect(action.title).toBe("运行节点（Ctrl+Enter）");
  });

  it.each([
    ["image-generation", "再生成一张"],
    ["video-generation", "再生成一个"],
    ["music-generation", "再生成一个"],
  ])("keeps a running %s available for another independent task", (nodeType, label) => {
    const onRun = vi.fn();
    const action = createGenerationNodeRunAction({ ...ready, running: true, nodeType, onRun });
    expect(action.disabled).toBe(false);
    expect(action.label).toBe(label);
    expect(action.title).toBe("创建新的独立任务，当前任务继续生成（Ctrl+Enter）");
    action.run();
    expect(onRun).toHaveBeenCalledOnce();
  });
});
