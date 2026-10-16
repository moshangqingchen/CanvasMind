import type { Page } from "@playwright/test";

export type EdgeGlowMode = "original" | "paused" | "hidden";

// These direct-child relationships are the installed HEAD's SVG feedback tree.
// Never target .studio-edge, its BaseEdge path, or the newer dash overlay itself.
const selectors = {
  legacyMask: ".canvas-editor .studio-edge > defs > mask",
  legacyLight: ".canvas-editor .studio-edge > defs > mask > .studio-edge-light",
  legacyBeam: ".canvas-editor .studio-edge > .studio-edge-beam",
  modernOverlay: ".canvas-editor .studio-edge-motion",
  modernDash: ".canvas-editor .studio-edge-motion > svg > .studio-edge-dash",
  normalPath: ".canvas-editor .studio-edge > .react-flow__edge-path",
} as const;
const styleId = "p0-memory-legacy-edge-glow";
const installedModes = new WeakMap<Page, EdgeGlowMode>();

export function readEdgeGlowMode(value = process.env.P0_MEMORY_EDGE_GLOW): EdgeGlowMode {
  if (value === undefined || value === "original") return "original";
  if (value === "paused" || value === "hidden") return value;
  throw new Error(`Unknown P0_MEMORY_EDGE_GLOW: ${value}`);
}

/** Call before the first navigation; use a fresh Page for each A/B arm. */
export async function installEdgeGlowMode(page: Page, mode = readEdgeGlowMode()): Promise<void> {
  const previous = installedModes.get(page);
  if (previous !== undefined) {
    if (previous !== mode) throw new Error("Use a fresh Page when changing the P0 edge glow arm");
    return;
  }
  const declaration = mode === "paused" ? "animation-play-state: paused !important;"
    : mode === "hidden" ? "display: none !important;" : "";
  const config = { mode, styleId, css: declaration
    ? `${selectors.legacyLight},\n${selectors.legacyBeam} { ${declaration} }` : "" };
  // This callback is serializable and only retains scalar configuration. The
  // original arm inserts no stylesheet and changes no application classes.
  function configureDocument({ mode, styleId, css }: typeof config) {
    (window as typeof window & { __p0EdgeGlowMode?: EdgeGlowMode }).__p0EdgeGlowMode = mode;
    const apply = () => {
      if (!css) return;
      const existing = document.getElementById(styleId);
      if (existing) {
        if (!(existing instanceof HTMLStyleElement) || existing.dataset.p0Owner !== styleId)
          throw new Error("P0 edge glow style ID is already owned by another element");
        existing.textContent = css;
        return;
      }
      const host = document.head ?? document.documentElement;
      if (!host) return;
      const style = document.createElement("style");
      style.id = styleId;
      style.dataset.p0Owner = styleId;
      style.textContent = css;
      host.append(style);
    };
    if (document.documentElement) apply();
    else document.addEventListener("DOMContentLoaded", apply, { once: true });
  }
  await page.addInitScript(configureDocument, config);
  await page.evaluate(configureDocument, config);
  installedModes.set(page, mode);
}

/** No DOM, Animation, effect, JSHandle, or response object leaves this call. */
export async function sampleEdgeEffects(page: Page) {
  return page.evaluate(({ selectors, styleId }) => {
    const mode = (window as typeof window & { __p0EdgeGlowMode?: EdgeGlowMode }).__p0EdgeGlowMode ?? "original";
    const census = (selector: string) => {
      let count = 0, ownDisplayNone = 0, ownVisibilityHidden = 0, ownAnimationPaused = 0;
      for (const element of document.querySelectorAll(selector)) {
        count++;
        const style = getComputedStyle(element);
        if (style.display === "none") ownDisplayNone++;
        if (style.visibility === "hidden") ownVisibilityHidden++;
        if (style.animationPlayState.split(",").every(value => value.trim() === "paused")) ownAnimationPaused++;
      }
      return { selector, count, ownDisplayNone, ownVisibilityHidden, ownAnimationPaused };
    };
    const legacy = { masks: census(selectors.legacyMask), lights: census(selectors.legacyLight), beams: census(selectors.legacyBeam) };
    const modern = { overlays: census(selectors.modernOverlay), dashes: census(selectors.modernDash) };
    const emptyAnimations = () => ({ count: 0, running: 0, paused: 0, finished: 0, idle: 0, pending: 0 });
    const animations = { document: emptyAnimations(), legacy: emptyAnimations(), modern: emptyAnimations() };
    const record = (summary: ReturnType<typeof emptyAnimations>, animation: Animation) => {
      summary.count++;
      if (animation.playState === "running") summary.running++;
      else if (animation.playState === "paused") summary.paused++;
      else if (animation.playState === "finished") summary.finished++;
      else if (animation.playState === "idle") summary.idle++;
      if (animation.pending) summary.pending++;
    };
    // The document list is created and released within this evaluation. No
    // mutation observer, animation listener, global collection or object group.
    for (const animation of document.getAnimations()) {
      record(animations.document, animation);
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      if (!(target instanceof Element)) continue;
      if (target.matches(`${selectors.legacyLight}, ${selectors.legacyBeam}`)) record(animations.legacy, animation);
      if (target.matches(`${selectors.modernOverlay}, ${selectors.modernDash}`)) record(animations.modern, animation);
    }
    const legacyFeedbackCount = legacy.lights.count + legacy.beams.count;
    const modernFeedbackCount = modern.overlays.count + modern.dashes.count;
    return {
      mode,
      policy: "legacy-svg-feedback-only; modern-dash-unchanged",
      feedbackFamily: legacyFeedbackCount > 0 ? modernFeedbackCount > 0 ? "mixed" : "legacy"
        : modernFeedbackCount > 0 ? "modern" : "none",
      // Empty matches mean the requested arm did not affect any active feedback.
      // Do not interpret a modern-only result as an old-mask A/B measurement.
      requestedSelectors: mode === "original" ? [] : [selectors.legacyLight, selectors.legacyBeam],
      matchedSelectors: mode === "original" ? [] : [legacy.lights, legacy.beams]
        .filter(entry => entry.count > 0).map(entry => entry.selector),
      styleInstalled: document.getElementById(styleId)?.getAttribute("data-p0-owner") === styleId,
      legacy,
      modern,
      normalPaths: { selector: selectors.normalPath, count: document.querySelectorAll(selectors.normalPath).length },
      animations,
    };
  }, { selectors, styleId });
}
