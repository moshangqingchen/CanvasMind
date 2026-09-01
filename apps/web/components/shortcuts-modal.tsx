"use client";

import { Keyboard, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ShortcutRow {
  readonly keys: readonly string[];
  readonly label: string;
}

interface ShortcutGroup {
  readonly title: string;
  readonly rows: readonly ShortcutRow[];
}

/** `Ctrl` is rewritten to `Cmd` on macOS when the modal opens. */
const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "运行",
    rows: [
      { keys: ["Ctrl", "Enter"], label: "运行当前节点" },
      { keys: ["Ctrl", "Shift", "Enter"], label: "从当前节点运行下游" },
    ],
  },
  {
    title: "编辑",
    rows: [
      { keys: ["Ctrl", "Z"], label: "撤销" },
      { keys: ["Ctrl", "Y"], label: "重做" },
      { keys: ["Ctrl", "C"], label: "复制选中节点" },
      { keys: ["Ctrl", "V"], label: "粘贴节点或外部图片" },
      { keys: ["Ctrl", "D"], label: "紧邻复制选中节点" },
      { keys: ["Ctrl", "A"], label: "选中全部节点" },
      { keys: ["Ctrl", "G"], label: "将选中节点打组" },
      { keys: ["Ctrl", "Shift", "G"], label: "解组" },
      { keys: ["Delete"], label: "删除选中的节点、连线或涂鸦" },
      { keys: ["Ctrl", "S"], label: "立即保存画布" },
    ],
  },
  {
    title: "画布",
    rows: [
      { keys: ["1"], label: "抓手模式" },
      { keys: ["2"], label: "画笔模式" },
      { keys: ["3"], label: "涂鸦选择模式" },
      { keys: ["F"], label: "缩放到适合全部节点" },
      { keys: ["Ctrl", "单击"], label: "加选或取消选择节点" },
      { keys: ["Ctrl", "拖动"], label: "框选多个节点" },
      { keys: ["Esc"], label: "关闭菜单并回到抓手模式" },
    ],
  },
  {
    title: "帮助",
    rows: [
      { keys: ["?"], label: "打开／关闭这张快捷键表" },
      { keys: ["Ctrl", "/"], label: "打开／关闭这张快捷键表" },
    ],
  },
];

function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad/iu.test(navigator.platform || navigator.userAgent);
}

export function ShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  // Lazy initialiser rather than an effect: the label must be right on the
  // first paint, and this component only mounts content after a user action.
  const [mac] = useState(isMacPlatform);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;

  const renderKey = (key: string) => (mac && key === "Ctrl" ? "Cmd" : key);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal-window shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-label="键盘快捷键"
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">效率</span>
            <h2>
              <Keyboard aria-hidden="true" size={18} /> 键盘快捷键
            </h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={17} />
          </button>
        </header>
        <div className="shortcuts-grid">
          {SHORTCUT_GROUPS.map((group) => (
            <section className="shortcuts-group" key={group.title}>
              <h3>{group.title}</h3>
              <ul>
                {group.rows.map((row) => (
                  <li key={`${group.title}-${row.label}-${row.keys.join("+")}`}>
                    <span className="shortcuts-label">{row.label}</span>
                    <span className="shortcuts-keys">
                      {row.keys.map((key, index) => (
                        <kbd key={`${key}-${index}`}>{renderKey(key)}</kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="shortcuts-foot">
          输入框和 Prompt 编辑器内不会触发画布快捷键。
        </footer>
      </section>
    </div>
  );
}
