"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useStoreApi } from "@xyflow/react";

const PREFERENCE = "super-canvas:gentle-motion";
export function canvasMotionPreference() {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(PREFERENCE) !== "off"; }
  catch { return true; }
}
export function canvasMotionEnabled() {
  return typeof window !== "undefined" && canvasMotionPreference() &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    const visibility = () => {
      document.documentElement.dataset.pageHidden = String(document.hidden);
    };
    refresh();
    visibility();
    media.addEventListener("change", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("canvas-motion-preference", refresh);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("canvas-motion-preference", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const toggle = useCallback(() => {
    try { localStorage.setItem(PREFERENCE, canvasMotionPreference() ? "off" : "on"); }
    catch { return; }
    window.dispatchEvent(new Event("canvas-motion-preference"));
  }, []);
  return [enabled, toggle] as const;
}

/** Cheap gesture feedback; deliberately has no decorative canvas or React frames. */
export const CanvasInteractionFeedback = memo(function CanvasInteractionFeedback() {
  const flow = useStoreApi();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    let pressed = false, wheeling = false, timer = 0;
    let zoom = flow.getState().transform[2];
    let compact = zoom < .55;
    // Only focused edge overlays inherit this value. A canvas-root variable
    // would invalidate every node's inherited style on every zoom frame.
    const edgeLayer = parent.querySelector<HTMLElement>(".react-flow__edgelabel-renderer");
    const updateEdgeScale = () => edgeLayer?.style.setProperty("--canvas-edge-scale", String(Math.min(2.5, Math.max(.125, 1 / zoom))));
    updateEdgeScale();
    const refresh = () => {
      // Compact LOD already removes expensive effects. Repeatedly toggling a
      // root class there would invalidate every mounted node's style again.
      const active = !compact && (pressed || wheeling);
      if (parent.classList.contains("is-interacting") !== active) parent.classList.toggle("is-interacting", active);
      const gesture = String(pressed || wheeling);
      if (edgeLayer && edgeLayer.dataset.gestureActive !== gesture) edgeLayer.dataset.gestureActive = gesture;
    };
    const unsubscribe = flow.subscribe(() => {
      const nextZoom = flow.getState().transform[2];
      if (nextZoom === zoom) return;
      zoom = nextZoom;
      updateEdgeScale();
      const nextCompact = zoom < .55;
      if (nextCompact === compact) return;
      compact = nextCompact;
      refresh();
    });
    const down = () => { pressed = true; refresh(); };
    const up = () => { pressed = false; refresh(); };
    const wheel = () => {
      wheeling = true;
      refresh();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { wheeling = false; refresh(); }, 160);
    };
    const reset = () => {
      window.clearTimeout(timer);
      pressed = false;
      wheeling = false;
      refresh();
    };
    const hidden = () => { if (document.hidden) reset(); };
    parent.addEventListener("pointerdown", down, true);
    // React Flow/D3 stops wheel bubbling; observe the gesture before it does.
    parent.addEventListener("wheel", wheel, { passive: true, capture: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", reset);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      unsubscribe();
      reset();
      edgeLayer?.style.removeProperty("--canvas-edge-scale");
      if (edgeLayer) delete edgeLayer.dataset.gestureActive;
      parent.removeEventListener("pointerdown", down, true);
      parent.removeEventListener("wheel", wheel, true);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", reset);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [flow]);
  return <span ref={ref} className="canvas-interaction-state" hidden aria-hidden="true" />;
});

export function MotionPreferenceBridge() {
  useCanvasMotion();
  return null;
}
