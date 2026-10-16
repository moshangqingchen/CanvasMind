"use client";

import { memo, useEffect, useRef } from "react";
import { portLabelObscuresCard } from "../lib/port-label-clearance";

/** One event delegate, no per-node observers, timers, or geometry subscriptions. */
export const CanvasPortLabels = memo(function CanvasPortLabels() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const canvas = ref.current?.parentElement;
    if (!canvas) return;
    let frame = 0;
    const refresh = () => {
      frame = 0;
      if (canvas.classList.contains("is-layout-animating") || canvas.querySelector(".canvas-lod-compact")) return;
      const cards = Array.from(canvas.querySelectorAll<HTMLElement>(".node-card"));
      const active = cards.filter(card => card.matches(':hover, .selected, [data-connection-active="true"]'));
      if (!active.length) return;
      const dragging = Boolean(canvas.querySelector(".react-flow__node.dragging"));
      // Batch every layout read before writing the few active label attributes.
      const bounds = cards.map(card => card.getBoundingClientRect());
      const changes = active.flatMap(card => {
        const others = bounds.filter((_, index) => cards[index] !== card);
        return Array.from(card.querySelectorAll<HTMLElement>(".port-label")).map(label => ({
          label, obscured: dragging || portLabelObscuresCard(label.getBoundingClientRect(), others),
        }));
      });
      for (const { label, obscured } of changes) {
        if (obscured) label.dataset.labelObscured = "true";
        else delete label.dataset.labelObscured;
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
    const hover = (event: PointerEvent) => {
      const card = event.target instanceof Element ? event.target.closest(".node-card") : null;
      if (!card || (event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) return;
      // Resolve before the hover fade paints, rather than briefly obscuring text.
      cancelAnimationFrame(frame);
      refresh();
    };
    const afterGesture = (event: Event) => { if (event.target instanceof Node && canvas.contains(event.target)) schedule(); };
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target instanceof Element && (record.type === "childList"
        ? record.target.matches(".react-flow__nodes")
        : record.target.matches(".node-card, .react-flow__node, .react-flow__viewport, .canvas-wrap")))) schedule();
    });
    observer.observe(canvas, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-connection-active"] });
    canvas.addEventListener("pointerover", hover, true);
    window.addEventListener("pointerup", afterGesture);
    window.addEventListener("keyup", afterGesture);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerover", hover, true);
      window.removeEventListener("pointerup", afterGesture);
      window.removeEventListener("keyup", afterGesture);
      for (const label of canvas.querySelectorAll<HTMLElement>("[data-label-obscured]")) delete label.dataset.labelObscured;
    };
  }, []);
  return <span ref={ref} hidden aria-hidden="true" />;
});
