"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./creative-agent-panel.module.css";

export function AgentPopover({ label, onClose, children, position = "bottom" }: {
  label: string; onClose: () => void; children: ReactNode; position?: "top" | "bottom";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>("input,button")?.focus();
    const down = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-agent-popover-trigger]")) return;
      if (event.target instanceof Node && !ref.current?.contains(event.target)) close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key === "Tab") {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"],summary') ?? []).filter(item => item.getClientRects().length);
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (!items.length) return;
        if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === items.length - 1)) {
          event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus();
        }
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button[data-choice]:not(:disabled)') ?? []).filter(item => item.getClientRects().length);
        if (!items.length) return;
        event.preventDefault(); const index = items.indexOf(document.activeElement as HTMLElement);
        items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
      }
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div ref={ref} className={styles.popover} role="dialog" aria-label={label} data-position={position}>
    <div className={styles.popoverHeading}><strong>{label}</strong><button type="button" onClick={onClose} aria-label={`关闭${label}`} title={`关闭${label}`}><X size={15} /></button></div>{children}</div>;
}
