"use client";

import { Keyboard, Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { useDialogFocus } from "./use-dialog-focus";
import styles from "./shortcuts-modal.module.css";

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
    title: "快速查找",
    rows: [{ label: "搜索操作与节点", keys: ["Ctrl", "K"] }],
  },
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
      { keys: ["V"], label: "节点选择模式" },
      { keys: ["L"], label: "定位所选节点" },
      { keys: ["O"], label: "整理所选或画布" },
      { keys: ["F"], label: "缩放到适合全部节点" },
      { keys: ["Ctrl", "单击"], label: "加选或取消选择节点" },
      { keys: ["Ctrl", "拖动"], label: "框选多个节点" },
      { keys: ["Esc"], label: "逐层关闭菜单、面板或返回抓手模式" },
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
  const dialogRef = useDialogFocus(open, onClose);
  // Lazy initialiser rather than an effect: the label must be right on the
  // first paint, and this component only mounts content after a user action.
  const [mac] = useState(isMacPlatform);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const renderKey = (key: string) => (mac && key === "Ctrl" ? "Cmd" : key);
  const term = query.trim().toLocaleLowerCase();
  const groups = SHORTCUT_GROUPS.map(group => ({ ...group, rows: group.rows.filter(row => !term || `${group.title} ${row.label} ${row.keys.map(renderKey).join("+")}`.toLocaleLowerCase().includes(term)) })).filter(group => group.rows.length);

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
        className={`modal-window shortcuts-modal ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-label="键盘快捷键"
        aria-describedby="shortcuts-help-note"
        tabIndex={-1}
        onKeyDown={event => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" || (event.key === "/" && event.target !== searchRef.current)) {
            event.preventDefault(); event.stopPropagation(); searchRef.current?.focus();
          }
        }}
      >
        <header className={`modal-head ${styles.header}`}>
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
            title="关闭（Esc）"
          >
            <X size={17} />
          </button>
        </header>
        <div className={`library-search ${styles.search}`} role="search" aria-label="查找快捷键"><Search size={16} aria-hidden="true" /><input ref={searchRef} aria-label="搜索快捷键" placeholder="搜索操作、分类或按键…" value={query} onChange={event => setQuery(event.target.value)} />{query ? <button type="button" aria-label="清除快捷键搜索" title="清除搜索" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={14} /></button> : null}</div>
        <p className={styles.count} role="status">{groups.reduce((count, group) => count + group.rows.length, 0)} 项操作</p>
        <div className={`shortcuts-grid ${styles.groups}`}>
          {!groups.length ? <p className="empty-state">没有匹配的快捷键，请换个关键词。</p> : null}
          {groups.map((group) => (
            <section className={`shortcuts-group ${styles.group}`} key={group.title}>
              <h3>{group.title}</h3>
              <ul>
                {group.rows.map((row) => (
                  <li key={`${group.title}-${row.label}-${row.keys.join("+")}`}>
                    <span className="shortcuts-label" title={row.label}>{row.label}</span>
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
        <footer className={`shortcuts-foot ${styles.footer}`} id="shortcuts-help-note">
          输入时可用 Ctrl+S 保存；提示词中 Ctrl+Enter 运行当前节点，Ctrl+Shift+Enter 运行下游。中文组词期间不会触发生成。
        </footer>
      </section>
    </div>
  );
}
