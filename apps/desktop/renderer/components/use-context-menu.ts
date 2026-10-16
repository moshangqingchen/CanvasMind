"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/** Canvas content is full bleed; menus still reserve the visible top islands. */
export function canvasMenuViewport(menu: HTMLElement) {
  const editor = menu.closest(".canvas-editor");
  const islands = editor?.querySelectorAll<HTMLElement>("[data-canvas-island]") ?? [];
  let top = (menu.closest(".canvas-wrap")?.getBoundingClientRect().top ?? 0) + 8;
  for (const island of islands) {
    const box = island.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) top = Math.max(top, box.bottom + 8);
  }
  return { left: 8, top, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
}

/** Keep canvas menus reachable by keyboard and inside the current window. */
export function useContextMenu(opening: unknown, onClose: () => void, originNodeId?: string) {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
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
      const viewport = canvasMenuViewport(menu);
      menu.style.maxWidth = `${Math.max(0, viewport.right - viewport.left)}px`;
      menu.style.maxHeight = `${Math.max(0, viewport.bottom - viewport.top)}px`;
      menu.style.overflowY = "auto";
      menu.style.overscrollBehavior = "contain";
      menu.style.scrollPaddingBlock = "4px";
      const bounds = menu.getBoundingClientRect();
      const dx = Math.max(viewport.left - bounds.left, Math.min(0, viewport.right - bounds.right));
      const dy = Math.max(viewport.top - bounds.top, Math.min(0, viewport.bottom - bounds.bottom));
      menu.style.left = `${Number.parseFloat(menu.style.left) + dx}px`;
      menu.style.top = `${Number.parseFloat(menu.style.top) + dy}px`;
    };
    fit();
    (items()[0] ?? menu).focus({ preventScroll: true });
    let restoreFocus = true;

    const keydown = (event: KeyboardEvent) => {
      if (!menu.contains(event.target as Node)) return;
      if (event.key === "Escape") {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
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
        buttons[next]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
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
