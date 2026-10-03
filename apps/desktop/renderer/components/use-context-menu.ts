"use client";

import { useEffect, useRef } from "react";

/** Keep canvas menus reachable by keyboard and inside the current window. */
export function useContextMenu(opening: unknown, onClose: () => void, originNodeId?: string) {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!opening) return;
    const menu = menuRef.current;
    if (!menu) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = originNodeId
      ? menu.closest(".canvas-wrap")?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(originNodeId)}"]`) ?? active
      : active;
    const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ));
    const fit = () => {
      const bounds = menu.getBoundingClientRect();
      const minimumTop = (menu.closest(".canvas-wrap")?.getBoundingClientRect().top ?? 0) + 8;
      const dx = Math.max(8 - bounds.left, Math.min(0, window.innerWidth - 8 - bounds.right));
      const dy = Math.max(minimumTop - bounds.top, Math.min(0, window.innerHeight - 8 - bounds.bottom));
      menu.style.left = `${Number.parseFloat(menu.style.left) + dx}px`;
      menu.style.top = `${Number.parseFloat(menu.style.top) + dy}px`;
    };
    fit();
    (items()[0] ?? menu).focus({ preventScroll: true });
    let restoreFocus = true;

    const keydown = (event: KeyboardEvent) => {
      if (!menu.contains(event.target as Node)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        if (previous?.isConnected) previous.focus({ preventScroll: true });
      } else if (event.key === "Tab") {
        restoreFocus = false;
        closeRef.current();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const buttons = items();
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0
          : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
      }
    };
    const pointerdown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.contains(event.target)) {
        restoreFocus = false;
        closeRef.current();
      }
    };
    menu.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", pointerdown, true);
    window.addEventListener("resize", fit);
    return () => {
      menu.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", pointerdown, true);
      window.removeEventListener("resize", fit);
      if (restoreFocus && (menu.contains(document.activeElement) || document.activeElement === document.body) && previous?.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [opening, originNodeId]);

  return menuRef;
}
