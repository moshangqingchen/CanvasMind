"use client";
import { memo, useEffect, useRef, useState } from "react";

const PREFERENCE = "super-canvas:gentle-motion";
export function canvasMotionPreference() {
  if (typeof window === "undefined") return false;
  let enabled = true;
  try {
    enabled = localStorage.getItem(PREFERENCE) !== "off";
  } catch {
    /* Use the system preference. */
  }
  return enabled;
}
export function canvasMotionEnabled() {
  return (
    typeof window !== "undefined" &&
    canvasMotionPreference() &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
export function useCanvasMotion() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const refresh = () => {
      const effective = canvasMotionEnabled();
      setEnabled(effective);
      document.documentElement.dataset.motion = effective ? "on" : "off";
    };
    refresh();
    media.addEventListener("change", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("canvas-motion-preference", refresh);
    return () => {
      media.removeEventListener("change", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("canvas-motion-preference", refresh);
    };
  }, []);
  const toggle = () => {
    try {
      localStorage.setItem(PREFERENCE, canvasMotionPreference() ? "off" : "on");
    } catch {
      return;
    }
    window.dispatchEvent(new Event("canvas-motion-preference"));
  };
  return [enabled, toggle] as const;
}

/** This layer has no pointer-driven React state and never invalidates the node tree. */
export const CanvasPointerTrail = memo(function CanvasPointerTrail({
  enabled,
}: {
  enabled: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current,
      parent = canvas?.parentElement;
    if (!canvas || !parent || !enabled) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let points: Array<{ x: number; y: number; t: number }> = [],
      raf = 0,
      lastPaint = 0,
      lastMove = 0,
      pressed = false;
    let width = 0,
      height = 0,
      ratio = 1,
      interactionTimer = 0;
    const clear = () => {
      // Dragging repeatedly enters this path with an already empty trail.
      // Avoid invalidating the full overlay canvas for every pointer frame.
      if (!raf && points.length === 0 && canvas.dataset.active !== "true") return;
      cancelAnimationFrame(raf);
      raf = 0;
      points = [];
      ctx.clearRect(0, 0, width, height);
      canvas.dataset.active = "false";
    };
    const resize = () => {
      const bounds = parent.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      ratio = Math.min(devicePixelRatio, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      clear();
    };
    const paint = (now: number) => {
      raf = 0;
      if (document.hidden || now - lastMove >= 180 || !points.length) {
        clear();
        return;
      }
      if (now - lastPaint < 15) {
        raf = requestAnimationFrame(paint);
        return;
      }
      lastPaint = now;
      ctx.clearRect(0, 0, width, height);
      const head = points[points.length - 1]!;
      let length = 0,
        start = points.length - 1,
        tail = head;
      for (let i = points.length - 2; i >= 0; i--) {
        const next = points[i + 1]!,
          point = points[i]!,
          segment = Math.hypot(next.x - point.x, next.y - point.y);
        const fraction = segment > 0 ? Math.min(1, (72 - length) / segment) : 1;
        tail = {
          x: next.x + (point.x - next.x) * fraction,
          y: next.y + (point.y - next.y) * fraction,
          t: point.t,
        };
        length += segment;
        start = i;
        if (length >= 72 || head.t - point.t > 130) break;
      }
      if (start < points.length - 1 && length > 1) {
        const gradient = ctx.createLinearGradient(
          tail.x,
          tail.y,
          head.x,
          head.y,
        );
        gradient.addColorStop(0, "rgba(40,183,230,0)");
        gradient.addColorStop(0.55, "rgba(63,206,239,.35)");
        gradient.addColorStop(1, "rgba(151,237,255,.8)");
        ctx.globalAlpha = Math.max(0, 1 - (now - lastMove) / 180);
        ctx.lineWidth = 1.25;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = gradient;
        ctx.shadowColor = "rgba(45,191,234,.5)";
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        for (let i = start + 1; i < points.length - 1; i++) {
          const p = points[i]!,
            next = points[i + 1]!;
          ctx.quadraticCurveTo(
            p.x,
            p.y,
            (p.x + next.x) / 2,
            (p.y + next.y) / 2,
          );
        }
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }
      if (start > 0) points = points.slice(start);
      raf = requestAnimationFrame(paint);
    };
    const move = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        pressed ||
        event.buttons ||
        event.pointerType !== "mouse" ||
        document.hidden ||
        document.activeElement?.matches(
          "input, textarea, select, [contenteditable='true']",
        ) ||
        !target?.matches(".react-flow__pane, .react-flow__background") ||
        document.querySelector(
          '[role="dialog"], .connection-menu, .canvas-create-menu, .project-menu, .node-context-menu, .node-config-popover',
        )
      ) {
        clear();
        return;
      }
      const bounds = parent.getBoundingClientRect(),
        now = performance.now();
      if (now - lastMove > 180) points = [];
      points.push({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        t: now,
      });
      if (points.length > 64) points.shift();
      lastMove = now;
      canvas.dataset.active = "true";
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const down = () => {
      pressed = true;
      parent.classList.add("is-interacting");
      clear();
    };
    const up = () => {
      pressed = false;
      parent.classList.remove("is-interacting");
    };
    const wheel = () => {
      clear();
      parent.classList.add("is-interacting");
      window.clearTimeout(interactionTimer);
      interactionTimer = window.setTimeout(
        () => parent.classList.remove("is-interacting"),
        160,
      );
    };
    const hidden = () => {
      if (document.hidden) {
        clear();
        up();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();
    parent.addEventListener("pointermove", move, { passive: true });
    parent.addEventListener("pointerdown", down, true);
    parent.addEventListener("pointerleave", clear);
    parent.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clear();
      up();
      window.clearTimeout(interactionTimer);
      observer.disconnect();
      parent.removeEventListener("pointermove", move);
      parent.removeEventListener("pointerdown", down, true);
      parent.removeEventListener("pointerleave", clear);
      parent.removeEventListener("wheel", wheel);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [enabled]);
  return (
    <canvas
      ref={ref}
      className="canvas-pointer-trail"
      aria-hidden="true"
      data-active="false"
    />
  );
});

/** A quiet pointer trail for the workspace home. It paints directly to a canvas
 * so pointer motion never causes React renders or layout work. */
export const WorkspacePointerTrail = memo(function WorkspacePointerTrail({
  enabled,
  className,
}: {
  enabled: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host || !enabled) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let width = 0;
    let height = 0;
    let ratio = 1;
    let frame = 0;
    let lastPaint = 0;
    let lastMove = 0;
    let points: Array<{ x: number; y: number; t: number }> = [];

    const clear = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      points = [];
      context.clearRect(0, 0, width, height);
      canvas.dataset.active = "false";
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      clear();
    };
    const paint = (now: number) => {
      frame = 0;
      if (document.hidden || now - lastMove > 220) {
        clear();
        return;
      }
      if (points.length < 2) {
        frame = window.requestAnimationFrame(paint);
        return;
      }
      if (now - lastPaint < 16) {
        frame = window.requestAnimationFrame(paint);
        return;
      }
      lastPaint = now;
      context.clearRect(0, 0, width, height);
      const head = points[points.length - 1]!;
      let length = 0;
      let start = points.length - 1;
      let tail = head;
      for (let index = points.length - 2; index >= 0; index -= 1) {
        const next = points[index + 1]!;
        const point = points[index]!;
        const segment = Math.hypot(next.x - point.x, next.y - point.y);
        const fraction =
          segment > 0 ? Math.min(1, (126 - length) / segment) : 1;
        tail = {
          x: next.x + (point.x - next.x) * fraction,
          y: next.y + (point.y - next.y) * fraction,
          t: point.t,
        };
        length += segment;
        start = index;
        if (length >= 126 || head.t - point.t > 260) break;
      }
      if (start < points.length - 1 && length > 2) {
        const gradient = context.createLinearGradient(
          tail.x,
          tail.y,
          head.x,
          head.y,
        );
        gradient.addColorStop(0, "rgba(93,83,238,0)");
        gradient.addColorStop(0.48, "rgba(130,119,255,.24)");
        gradient.addColorStop(1, "rgba(186,225,255,.95)");
        context.globalAlpha = Math.max(0, 1 - (now - lastMove) / 220);
        context.lineWidth = 1.4;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = gradient;
        context.shadowColor = "rgba(129,111,255,.68)";
        context.shadowBlur = 12;
        context.beginPath();
        context.moveTo(tail.x, tail.y);
        for (let index = start + 1; index < points.length - 1; index += 1) {
          const point = points[index]!;
          const next = points[index + 1]!;
          context.quadraticCurveTo(
            point.x,
            point.y,
            (point.x + next.x) / 2,
            (point.y + next.y) / 2,
          );
        }
        context.lineTo(head.x, head.y);
        context.stroke();
        context.beginPath();
        context.arc(head.x, head.y, 1.5, 0, Math.PI * 2);
        context.fillStyle = "rgba(218,235,255,.85)";
        context.fill();
        context.globalAlpha = 1;
        context.shadowBlur = 0;
      }
      if (start > 0) points = points.slice(start);
      frame = window.requestAnimationFrame(paint);
    };
    const move = (event: PointerEvent) => {
      if (
        event.pointerType !== "mouse" ||
        event.buttons ||
        document.hidden ||
        document.activeElement?.matches(
          "input, textarea, select, [contenteditable='true']",
        )
      ) {
        clear();
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      const now = performance.now();
      if (now - lastMove > 220) points = [];
      points.push({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        t: now,
      });
      if (points.length > 72) points.shift();
      lastMove = now;
      canvas.dataset.active = "true";
      if (!frame) frame = window.requestAnimationFrame(paint);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    host.addEventListener("pointermove", move, { passive: true });
    host.addEventListener("pointerleave", clear);
    host.addEventListener("pointerdown", clear);
    host.addEventListener("focusin", clear);
    host.addEventListener("scroll", clear, { passive: true });
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      clear();
      observer.disconnect();
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", clear);
      host.removeEventListener("pointerdown", clear);
      host.removeEventListener("focusin", clear);
      host.removeEventListener("scroll", clear);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [enabled]);
  return (
    <canvas
      ref={ref}
      className={className}
      aria-hidden="true"
      data-active="false"
    />
  );
});

export function MotionPreferenceBridge() {
  useCanvasMotion();
  return null;
}
