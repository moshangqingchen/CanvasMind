export interface SettingsDraftState {
  label: string;
  dirty: boolean;
  busy?: boolean;
  onDiscard: () => void;
}

export interface SettingsLeaveOptions {
  /** Omit to protect every mounted form in this settings dialog. */
  ids?: readonly string[];
  action?: string;
}

export interface SettingsGuardDialogs {
  confirm: (message: string) => boolean;
  notify: (message: string) => void;
}

/** Keeps only form status and reset callbacks in memory. Draft fields, especially keys, stay in their forms. */
export class SettingsDraftRegistry {
  private readonly drafts = new Map<
    string,
    { getState: () => SettingsDraftState }
  >();

  constructor(private readonly dialogs: SettingsGuardDialogs) {}

  register(id: string, getState: () => SettingsDraftState): () => void {
    const registration = { getState };
    this.drafts.set(id, registration);
    return () => {
      if (this.drafts.get(id) === registration) this.drafts.delete(id);
    };
  }

  confirmDiscard(options: SettingsLeaveOptions = {}): boolean {
    const selected = options.ids ? new Set(options.ids) : undefined;
    const states = [...this.drafts.entries()]
      .filter(([id]) => !selected || selected.has(id))
      .map(([, entry]) => entry.getState());
    const busy = states.filter((state) => state.busy);
    if (busy.length) {
      const labels = [...new Set(busy.map((state) => state.label))].join("、");
      this.dialogs.notify(`${labels}正在处理，请等待完成后再离开。`);
      return false;
    }
    const changed = states.filter((state) => state.dirty);
    if (!changed.length) return true;
    const labels = [...new Set(changed.map((state) => state.label))].join("、");
    const action = options.action ?? "离开当前设置";
    if (
      !this.dialogs.confirm(
        `${labels}有未保存的修改。\n${action}会放弃这些修改，是否继续？\n选择“取消”可继续编辑。`,
      )
    )
      return false;
    // Reset even forms that remain mounted but become hidden after navigation.
    for (const state of changed) state.onDiscard();
    return true;
  }

  requestLeave(action: () => void, options?: SettingsLeaveOptions): boolean {
    if (!this.confirmDiscard(options)) return false;
    action();
    return true;
  }
}
