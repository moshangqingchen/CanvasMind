import { describe, expect, it, vi } from "vitest";
import {
  SettingsDraftRegistry,
  type SettingsDraftState,
} from "./settings-draft-guard";

function fixture() {
  const confirm = vi.fn<(message: string) => boolean>(() => false);
  const notify = vi.fn<(message: string) => void>();
  return {
    confirm,
    notify,
    registry: new SettingsDraftRegistry({ confirm, notify }),
  };
}

describe("settings draft navigation guard", () => {
  it("keeps every changed form and its navigation intact when discard is cancelled", () => {
    const { registry, confirm } = fixture();
    const keyReset = vi.fn();
    const modelReset = vi.fn();
    registry.register("key", () => ({
      label: "分组密钥",
      dirty: true,
      onDiscard: keyReset,
    }));
    registry.register("model", () => ({
      label: "默认模型",
      dirty: true,
      onDiscard: modelReset,
    }));
    const navigate = vi.fn();
    expect(registry.requestLeave(navigate, { action: "切换供应商" })).toBe(
      false,
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("分组密钥、默认模型");
    expect(navigate).not.toHaveBeenCalled();
    expect(keyReset).not.toHaveBeenCalled();
    expect(modelReset).not.toHaveBeenCalled();
  });

  it("resets all dirty forms before changing the tab, including a form that remains mounted", () => {
    const { registry, confirm } = fixture();
    confirm.mockReturnValue(true);
    const order: string[] = [];
    let dirty = true;
    registry.register("group", () => ({
      label: "分组",
      dirty,
      onDiscard: () => {
        dirty = false;
        order.push("reset");
      },
    }));
    registry.register("clean", () => ({
      label: "已保存",
      dirty: false,
      onDiscard: () => order.push("unexpected"),
    }));
    expect(registry.requestLeave(() => order.push("navigate"))).toBe(true);
    expect(order).toEqual(["reset", "navigate"]);
    expect(registry.requestLeave(() => order.push("next"))).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("blocks leaving during an async save even when that form currently looks clean", () => {
    const { registry, confirm, notify } = fixture();
    let busy = true;
    let dirty = true;
    const reset = vi.fn();
    registry.register("save", () => ({
      label: "连接配置",
      busy,
      dirty,
      onDiscard: reset,
    }));
    const navigate = vi.fn();
    expect(registry.requestLeave(navigate)).toBe(false);
    dirty = false;
    expect(registry.requestLeave(navigate)).toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(confirm).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    busy = false;
    expect(registry.requestLeave(navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("still protects a failed save, and ignores only an explicitly scoped unrelated form", () => {
    const { registry, confirm } = fixture();
    let state: SettingsDraftState = {
      label: "新供应商",
      dirty: true,
      busy: true,
      onDiscard: vi.fn(),
    };
    registry.register("new", () => state);
    registry.register("group", () => ({
      label: "分组",
      dirty: false,
      onDiscard: vi.fn(),
    }));
    expect(registry.confirmDiscard({ ids: ["group"] })).toBe(true);
    state = { ...state, busy: false };
    expect(registry.confirmDiscard()).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("removes unmounted forms and cannot remove a newer registration with old cleanup", () => {
    const { registry, confirm } = fixture();
    const firstCleanup = registry.register("same", () => ({
      label: "旧表单",
      dirty: true,
      onDiscard: vi.fn(),
    }));
    const secondCleanup = registry.register("same", () => ({
      label: "新表单",
      dirty: true,
      onDiscard: vi.fn(),
    }));
    firstCleanup();
    expect(registry.confirmDiscard()).toBe(false);
    expect(confirm.mock.calls[0][0]).toContain("新表单");
    secondCleanup();
    expect(registry.confirmDiscard()).toBe(true);
  });
});
