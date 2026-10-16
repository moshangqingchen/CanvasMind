"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FolderInput, Image, Music, Plus, ScanEye, Type, Video, X } from "lucide-react";
import { canvasMenuViewport } from "./use-context-menu";
import styles from "./canvas-chrome.module.css";

export const NODE_CARD_DRAG_TYPE = "application/x-supercanvas-node-type";
const nodeCards = [
  { type: "prompt", label: "Prompt", description: "写下想法，连接创作", Icon: Type, color: "text" },
  { type: "image-generation", label: "图片生成", description: "让文字与参考图变成作品", Icon: Image, color: "image" },
  { type: "video-generation", label: "视频生成", description: "让画面动起来", Icon: Video, color: "video" },
  { type: "music-generation", label: "音乐生成", description: "创作旋律、歌曲与声音", Icon: Music, color: "audio" },
  { type: "preview", label: "结果预览", description: "集中查看工作流输出", Icon: ScanEye, color: "result" },
  { type: "asset", label: "添加素材", description: "导入图片、视频或音频", Icon: FolderInput, color: "asset" },
] as const;
export function isDraggableNodeType(value: string) {
  return nodeCards.some(card => card.type !== "asset" && card.type === value);
}

/** The spaces between islands remain part of the canvas interaction surface. */
export function CanvasChrome({ project, command, actions }: { project: ReactNode; command: ReactNode; actions: ReactNode }) {
  return <header className={styles.chrome} aria-label="画布工作台">
    <div className={`${styles.island} ${styles.project}`} data-canvas-island="project">{project}</div>
    <div className={styles.command}>{command}</div>
    <div className={`${styles.island} ${styles.actions}`} data-canvas-island="actions">{actions}</div>
  </header>;
}

export function AddNodeMenu({ onAdd, onAssets, disabled, generationDisabled }: {
  onAdd: (type: string) => void; onAssets: () => void; disabled: boolean; generationDisabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const popup = menu.current, anchor = root.current;
    if (!popup || !anchor) return;
    const fit = () => {
      const viewport = canvasMenuViewport(popup);
      popup.style.maxHeight = `${Math.max(0, viewport.bottom - viewport.top)}px`;
      const origin = anchor.getBoundingClientRect();
      const left = Math.max(viewport.left, Math.min(origin.right + 20, viewport.right - popup.offsetWidth));
      const top = Math.max(viewport.top, Math.min(origin.top, viewport.bottom - popup.offsetHeight));
      popup.style.left = `${left - origin.left}px`;
      popup.style.top = `${top - origin.top}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      // Tab can move focus outside this non-modal menu. A modal opened above
      // it still owns Escape, regardless of document listener registration order.
      if ([...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]')]
        .some(dialog => dialog.getClientRects().length > 0)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <div className={styles.addRoot} ref={root}>
    <button ref={trigger} className={styles.add} type="button" disabled={disabled} aria-label="添加节点" title="添加节点" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Plus size={24} strokeWidth={1.75} />
    </button>
    {open ? <section ref={menu} className={styles.nodeMenu} data-canvas-add-node-menu role="menu" aria-label="添加创作节点" onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
      const grid = event.currentTarget.querySelector<HTMLElement>(`.${styles.nodeGrid}`);
      const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(/\s+/u).length : 2;
      const offset = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns } as Record<string, number>)[event.key];
      if (!offset && event.key !== "Home" && event.key !== "End") return;
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (Math.max(current, 0) + offset + items.length) % items.length;
      items[index]?.focus();
      items[index]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }}>
      <header><div><strong>从一个想法开始</strong><span>点击添加，也可以拖到画布</span></div><button type="button" title="关闭添加节点（Esc）" aria-label="关闭添加节点" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button></header>
      <div className={styles.nodeGrid}>{nodeCards.map(({ type, label, description, Icon, color }) => <button key={type} type="button" role="menuitem"
        disabled={disabled || (type.endsWith("-generation") && generationDisabled)} draggable={type !== "asset"}
        data-node-color={color} onDragStart={event => { event.dataTransfer.setData(NODE_CARD_DRAG_TYPE, type); event.dataTransfer.effectAllowed = "copy"; }}
        onDragEnd={() => setOpen(false)} onClick={() => { setOpen(false); trigger.current?.focus(); if (type === "asset") onAssets(); else onAdd(type); }}>
        <span className={styles.typeIcon}><Icon size={20} strokeWidth={1.75} /></span><strong>{label}</strong><small>{description}</small>
      </button>)}</div>
    </section> : null}
  </div>;
}
