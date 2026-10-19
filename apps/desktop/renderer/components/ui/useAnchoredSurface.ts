"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { nodeConfigOwnerElement } from "../../lib/node-config-interaction";
import { anchoredSurfacePlacement, type SurfaceRect } from "./interactions";

export interface AnchoredSurfaceOptions {
  open: boolean;
  onClose: (restoreFocus: boolean) => void;
  hostRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<HTMLElement | null>;
  active?: boolean;
  minWidth?: number;
  maxWidth?: number;
  preferSidePlacement?: boolean;
}

/** Geometry stays in the DOM layer; closed controls own no global listeners. */
export function useAnchoredSurface({ open, onClose, hostRef, triggerRef, surfaceRef,
  active = true, minWidth = 240, maxWidth = 420, preferSidePlacement = false }: AnchoredSurfaceOptions) {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    const host = hostRef.current, trigger = triggerRef.current, surface = surfaceRef.current;
    if (!open || !active || !host || !trigger || !surface) return;
    const owner = nodeConfigOwnerElement(host);
    let frame = 0;
    let live = true;
    const eligible = () => !host.closest('[hidden], [inert], [data-config-active="false"], .canvas-parameter-dock[data-active="false"]');
    const close = (restoreFocus: boolean) => {
      if (!live) return;
      closeRef.current(restoreFocus);
      if (restoreFocus && trigger.isConnected && eligible()) trigger.focus({ preventScroll: true });
    };
    const position = () => {
      if (!live) return;
      if (!eligible() || !trigger.getClientRects().length) { close(false); return; }
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 8, top = (viewport?.offsetTop ?? 0) + 8;
      const right = left + (viewport?.width ?? window.innerWidth) - 16;
      const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
      const bounds: SurfaceRect = { left, top, right, bottom, width: Math.max(0, right - left) };
      const anchor = trigger.getBoundingClientRect();
      const width = Math.min(Math.max(minWidth, anchor.width), maxWidth, bounds.width);
      surface.style.width = `${width}px`;
      surface.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      const placement = anchoredSurfacePlacement({ anchor, bounds, minWidth, maxWidth,
        naturalHeight: Math.max(surface.offsetHeight, surface.scrollHeight),
        owner: owner?.getBoundingClientRect(), preferSidePlacement });
      for (const [name, value] of Object.entries(placement)) {
        const property = name as "width" | "left" | "top" | "maxHeight";
        const pixels = `${value}px`;
        if (surface.style[property] !== pixels) surface.style[property] = pixels;
      }
    };
    const schedule = () => {
      if (frame || !live) return;
      frame = requestAnimationFrame(() => { frame = 0; position(); });
    };
    if (!surface.matches(":popover-open")) surface.showPopover();
    position();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.contains(event.target)) close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target instanceof HTMLSelectElement && target.matches(":open")) return;
      const child = target?.closest('[data-node-config-layer-open="true"], .node-model-select[data-open]');
      if (child && child !== host) return;
      if (!target || !host.contains(target) && (!owner || nodeConfigOwnerElement(target) !== owner)) return;
      event.preventDefault(); event.stopPropagation(); close(true);
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && surface.contains(event.target)) return;
      schedule();
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(trigger); resize.observe(surface);
    const mutation = new MutationObserver(() => { if (!eligible()) close(false); });
    for (let element: HTMLElement | null = host; element; element = element.parentElement) {
      mutation.observe(element, { attributes: true, attributeFilter: ["hidden", "inert", "data-active", "data-config-active"] });
    }
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    owner?.addEventListener("canvas-node-config-position", schedule);
    owner?.addEventListener("animationend", schedule);
    return () => {
      live = false; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      owner?.removeEventListener("canvas-node-config-position", schedule);
      owner?.removeEventListener("animationend", schedule);
      if (surface.matches(":popover-open")) surface.hidePopover();
    };
  }, [open, active, hostRef, triggerRef, surfaceRef, minWidth, maxWidth, preferSidePlacement]);
}
