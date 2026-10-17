"use client";

import { memo, useEffect, useRef } from "react";
import { useStoreApi } from "@xyflow/react";
import { canvasAmbientDetail, createCanvasEffectGestureGate, createCanvasEffectScheduler } from "../lib/canvas-effect-scheduler";
import styles from "./canvas-ambient-effects.module.css";

type TrailPoint = { x: number; y: number; time: number };
type Burst = { x: number; y: number; time: number; kind: "ripple" | "spark"; angle: number };

/** One event-driven, bounded canvas; no React updates or frame loop when idle. */
export const CanvasAmbientEffects = memo(function CanvasAmbientEffects({ enabled, ready, interactive }: {
  enabled: boolean; ready: boolean; interactive: boolean;
}) {
  const flow = useStoreApi();
  const layer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const surface = canvas.current, container = layer.current, dots = grid.current;
    const root = container?.closest<HTMLElement>(".react-flow");
    if (!surface || !container || !root || !dots) return;
    // The off arm owns no context, store subscription or pointer listeners.
    if (!enabled || !ready || !interactive) {
      root.dataset.ambientDetail = "off"; container.dataset.detail = "off";
      container.dataset.frameActive = "false"; container.dataset.pointer = "false";
      surface.width = 0; surface.height = 0;
      return () => { delete root.dataset.ambientDetail; };
    }
    const context = surface.getContext("2d", { alpha: true });
    if (!context) return;
    root.dataset.ambientDetail = "off"; container.dataset.detail = "off";
    let width = 0, height = 0, dpr = 1, paused = false;
    let detail = "off", color = "", previousNodes = new Set<string>(), previousEdges = new Set<string>();
    let previousStatuses = new Map<string, unknown>(), previousGraph: unknown, previousEdgeGraph: unknown, previousTransform = "";
    let initialized = false, hideSpot = 0;
    let trail: TrailPoint[] = [], bursts: Burst[] = [];
    const deferred = new Set<number>(), pulsePaths = new Set<SVGPathElement>();
    const setActive = (active: boolean) => { container.dataset.frameActive = String(active); };
    const clear = () => {
      trail = []; bursts = []; scheduler.stop(); setActive(false);
      context.clearRect(0, 0, width, height);
      container.dataset.pointer = "false";
      window.clearTimeout(hideSpot);
      for (const timer of deferred) window.clearTimeout(timer);
      deferred.clear();
      for (const path of pulsePaths) { path.getAnimations().forEach(animation => animation.cancel()); path.remove(); }
      pulsePaths.clear();
    };
    const scheduler = createCanvasEffectScheduler(time => {
      context.clearRect(0, 0, width, height);
      if (paused || document.hidden || detail === "off") { setActive(false); return false; }
      trail = trail.filter(point => time - point.time < 210);
      bursts = bursts.filter(burst => time - burst.time < (burst.kind === "ripple" ? 280 : 360));
      context.strokeStyle = color; context.fillStyle = color;
      // Twenty short segments, no shadowBlur or fullscreen blending pass.
      context.lineCap = "round";
      for (let index = 1; index < trail.length; index++) {
        const point = trail[index], before = trail[index - 1];
        const fade = Math.exp(-(time - point.time) / 65) * index / trail.length;
        context.globalAlpha = fade * .28; context.lineWidth = .55 + fade * .65;
        context.beginPath(); context.moveTo(before.x, before.y); context.lineTo(point.x, point.y); context.stroke();
      }
      for (const burst of bursts) {
        const progress = (time - burst.time) / (burst.kind === "ripple" ? 280 : 360);
        context.globalAlpha = (1 - progress) ** 2 * .35;
        if (burst.kind === "ripple") {
          context.lineWidth = .8; context.beginPath(); context.ellipse(burst.x, burst.y, 12 + progress * 34, 8 + progress * 22, 0, 0, Math.PI * 2); context.stroke();
        } else {
          const travel = 6 + progress * 22;
          context.beginPath(); context.arc(burst.x + Math.cos(burst.angle) * travel, burst.y + Math.sin(burst.angle) * travel, 1 - progress * .65, 0, Math.PI * 2); context.fill();
        }
      }
      context.globalAlpha = 1;
      const alive = Boolean(trail.length || bursts.length);
      if (!alive) setActive(false);
      return alive;
    }, callback => requestAnimationFrame(callback), handle => cancelAnimationFrame(handle));
    const gesture = createCanvasEffectGestureGate(() => { container.dataset.gesturePaused = "true"; clear(); }, () => update(),
      (callback, delay) => window.setTimeout(callback, delay), handle => window.clearTimeout(handle));
    const wake = () => { if (detail === "full" && !document.hidden) { setActive(true); scheduler.wake(); } };
    const resize = () => {
      width = container.clientWidth; height = container.clientHeight;
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      color = getComputedStyle(root).getPropertyValue("--accent").trim();
    };
    const pulseEdge = (id: string) => {
      const timer = window.setTimeout(() => {
        deferred.delete(timer);
        if (detail === "off" || document.hidden) return;
        const path = root.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(id)}"] .react-flow__edge-path`);
        if (!path) return;
        const pulse = path.cloneNode(false) as SVGPathElement;
        pulse.removeAttribute("id"); pulse.removeAttribute("style"); pulse.removeAttribute("marker-end"); pulse.removeAttribute("marker-start");
        pulse.setAttribute("class", "canvas-new-edge-pulse"); pulse.setAttribute("pathLength", "1");
        pulse.setAttribute("aria-hidden", "true"); path.parentNode?.appendChild(pulse); pulsePaths.add(pulse);
        const animation = pulse.animate([{ strokeDashoffset: ".045", opacity: 0 }, { opacity: .8, offset: .15 }, { strokeDashoffset: "-1", opacity: 0 }], { duration: 720, easing: "ease-in-out" });
        animation.onfinish = () => { pulse.remove(); pulsePaths.delete(pulse); };
      }, 24);
      deferred.add(timer);
    };
    const update = () => {
      // A stopped paint loop alone is insufficient: each transform otherwise
      // scans all nodes, allocates graph/status maps and projects a hidden mask.
      // Reconcile once with the latest store state when the gesture ends.
      if (gesture.paused || paused || document.hidden) return;
      delete container.dataset.gesturePaused;
      const state = flow.getState();
      const [x, y, zoom] = state.transform;
      const transformKey = `${x},${y},${zoom},${state.width},${state.height}`;
      if (previousGraph === state.nodes && previousEdgeGraph === state.edges && transformKey === previousTransform) return;
      previousGraph = state.nodes; previousEdgeGraph = state.edges; previousTransform = transformKey;
      let visible = 0;
      for (const node of state.nodeLookup.values()) {
        if (node.hidden) continue;
        const position = node.internals.positionAbsolute;
        const left = position.x * zoom + x, top = position.y * zoom + y;
        if (left < state.width && top < state.height && left + (node.measured.width ?? 300) * zoom > 0 && top + (node.measured.height ?? 180) * zoom > 0) visible++;
      }
      const nextDetail = canvasAmbientDetail(enabled && interactive && ready, zoom, visible);
      if (detail !== nextDetail) {
        detail = nextDetail; root.dataset.ambientDetail = detail; container.dataset.detail = detail;
        if (detail === "off") clear();
      }
      container.dataset.visibleNodes = String(visible);
      const gap = zoom * 20;
      dots.style.backgroundSize = `${gap}px ${gap}px`;
      dots.style.setProperty("--canvas-dot-radius", `${zoom * .5}px`);
      dots.style.setProperty("--canvas-dot-center", `${gap / 2 - 1 + zoom * .4}px`);
      dots.style.transform = `translate3d(${x % gap - gap}px,${y % gap - gap}px,0)`;
      dots.style.width = `calc(100% + ${2 * gap}px)`; dots.style.height = `calc(100% + ${2 * gap}px)`;
      const ids = new Set(state.nodes.map(node => node.id)), edges = new Set(state.edges.map(edge => edge.id));
      const statuses = new Map(state.nodes.map(node => [node.id, node.data.generatedStatus ?? node.data.status]));
      if (initialized && detail === "full" && !paused) {
        const added = state.nodes.filter(node => !previousNodes.has(node.id));
        if (added.length <= 8) for (const node of added) {
          const position = state.nodeLookup.get(node.id)?.internals.positionAbsolute ?? node.position;
          bursts.push({ x: position.x * zoom + x + (node.measured?.width ?? 280) * zoom / 2, y: position.y * zoom + y, time: performance.now(), kind: "ripple", angle: 0 });
        }
        for (const node of state.nodes) {
          const before = previousStatuses.get(node.id), after = statuses.get(node.id);
          if (after !== "succeeded" || !["queued", "submitting", "running", "polling", "archiving", "downloading"].includes(String(before))) continue;
          const position = state.nodeLookup.get(node.id)?.internals.positionAbsolute ?? node.position;
          for (let index = 0; index < 4; index++) bursts.push({ x: position.x * zoom + x + (node.measured?.width ?? 280) * zoom / 2, y: position.y * zoom + y, time: performance.now(), kind: "spark", angle: Math.PI * (1.15 + index * .23) });
        }
        const newEdges = state.edges.filter(edge => !previousEdges.has(edge.id));
        if (newEdges.length <= 12) for (const edge of newEdges) pulseEdge(edge.id);
        bursts = bursts.slice(-40);
        if (bursts.length) wake();
      }
      previousNodes = ids; previousEdges = edges; previousStatuses = statuses; initialized = ready;
    };
    const pointer = (event: PointerEvent) => {
      const editing = document.activeElement?.closest("input,textarea,[contenteditable='true'],[contenteditable='plaintext-only']");
      if (detail === "off" || paused || gesture.paused || event.buttons || editing || !(event.target instanceof Element) || !event.target.classList.contains("react-flow__pane")) {
        if (container.dataset.pointer === "true") { container.dataset.pointer = "false"; trail = []; }
        return;
      }
      const bounds = root.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      container.style.setProperty("--cursor-x", `${x}px`); container.style.setProperty("--cursor-y", `${y}px`);
      container.dataset.pointer = "true";
      window.clearTimeout(hideSpot); hideSpot = window.setTimeout(() => { container.dataset.pointer = "false"; }, 700);
      const before = trail.at(-1);
      if (!before || Math.hypot(before.x - x, before.y - y) >= 1.5) { trail.push({ x, y, time: performance.now() }); trail = trail.slice(-20); wake(); }
    };
    const down = () => { gesture.beginPointer(); };
    const up = () => { gesture.endPointer(); };
    const wheel = () => { gesture.wheel(); };
    const suspend = () => { gesture.reset(); clear(); };
    const cancelPointer = () => { suspend(); update(); };
    const blur = () => { paused = true; suspend(); };
    const focus = () => { paused = document.hidden; if (!paused) update(); };
    const focusEditing = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable='true'],[contenteditable='plaintext-only']")) clear();
    };
    const visibility = () => { paused = document.hidden; if (paused) suspend(); else update(); };
    resize(); update();
    const observer = new ResizeObserver(() => { resize(); previousTransform = ""; update(); }); observer.observe(root);
    const themeObserver = new MutationObserver(() => { color = getComputedStyle(root).getPropertyValue("--accent").trim(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const unsubscribe = flow.subscribe(update);
    root.addEventListener("pointermove", pointer, { passive: true });
    root.addEventListener("pointerdown", down, true); root.addEventListener("pointerleave", clear);
    root.addEventListener("wheel", wheel, { passive: true, capture: true });
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancelPointer); window.addEventListener("blur", blur); window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("focusin", focusEditing);
    return () => {
      unsubscribe(); observer.disconnect(); themeObserver.disconnect(); gesture.dispose(); scheduler.dispose(); window.clearTimeout(hideSpot);
      for (const timer of deferred) window.clearTimeout(timer);
      for (const path of pulsePaths) { path.getAnimations().forEach(animation => animation.cancel()); path.remove(); }
      root.removeEventListener("pointermove", pointer); root.removeEventListener("pointerdown", down, true); root.removeEventListener("pointerleave", clear); root.removeEventListener("wheel", wheel, true);
      window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancelPointer); window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("focusin", focusEditing);
      delete root.dataset.ambientDetail;
      delete container.dataset.gesturePaused;
      container.style.removeProperty("--cursor-x"); container.style.removeProperty("--cursor-y");
      surface.width = 0; surface.height = 0;
    };
  }, [enabled, ready, interactive, flow]);

  return <div ref={layer} className={styles.layer} data-testid="canvas-ambient-effects" data-frame-active="false" data-pointer="false" aria-hidden="true">
    <div className={styles.spotlight}><div ref={grid} className={styles.dots} /></div>
    <canvas ref={canvas} className={styles.canvas} />
  </div>;
});
