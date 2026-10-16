import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "../../node_modules/typescript/lib/typescript.js";

const source = await readFile(new URL("./p0-edge-effects.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const moduleContext = { exports: {}, process: { env: {} } };
runInNewContext(compiled, moduleContext);
const { installEdgeGlowMode, sampleEdgeEffects } = moduleContext.exports;

class FakeElement {
  constructor(tag, classes = "") { this.tag = tag; this.classes = classes.split(" "); this.children = []; this.dataset = {}; }
  append(child) { child.parent = this; this.children.push(child); }
  getAttribute(name) { return name === "data-p0-owner" ? this.dataset.p0Owner : null; }
  matches(selector) {
    return selector.split(",").some(arm => {
      const parts = arm.trim().replaceAll(">", " > ").split(/\s+/u);
      const simple = (node, token) => node && token.split(".").every((part, index) =>
        index === 0 ? !part || node.tag === part : node.classes.includes(part));
      const match = (node, index) => {
        if (!simple(node, parts[index])) return false;
        if (index === 0) return true;
        if (parts[index - 1] === ">") return match(node.parent, index - 2);
        for (let parent = node.parent; parent; parent = parent.parent)
          if (match(parent, index - 1)) return true;
        return false;
      };
      return match(this, parts.length - 1);
    });
  }
}
class FakeStyle extends FakeElement { constructor() { super("style"); this.textContent = ""; } }
class FakeEffect { constructor(target) { this.target = target; } }

function browser({ legacy = false, portalDash = false } = {}) {
  const root = new FakeElement("html"), head = new FakeElement("head"); root.append(head);
  const add = (parent, tag, classes) => { const node = new FakeElement(tag, classes); parent.append(node); return node; };
  const canvas = add(root, "div", "canvas-editor"), edge = add(canvas, "svg", "studio-edge");
  const normal = add(edge, "path", "react-flow__edge-path"), targets = [normal];
  let mask;
  if (legacy) {
    mask = add(add(edge, "defs"), "mask");
    targets.push(add(mask, "path", "studio-edge-light"), add(edge, "path", "studio-edge-beam"));
  }
  const overlay = add(canvas, "div", "studio-edge-motion"), svg = add(overlay, "svg");
  if (portalDash) targets.push(add(svg, "path", "studio-edge-dash"));
  else {
    const beam = add(svg, "g", "studio-edge-beam");
    targets.push(add(beam, "g", "studio-edge-light"), beam);
  }
  const all = () => { const visit = node => [node, ...node.children.flatMap(visit)]; return visit(root); };
  const computed = node => {
    const result = { display: "block", visibility: "visible", animationPlayState: "running" };
    for (const style of head.children) {
      for (const match of style.textContent.matchAll(/([^{}]+)\{([^{}]+)\}/gu)) {
        if (!node.matches(match[1])) continue;
        if (match[2].includes("display: none")) result.display = "none";
        if (match[2].includes("animation-play-state: paused")) result.animationPlayState = "paused";
      }
    }
    return result;
  };
  const animations = targets.map(target => ({ effect: new FakeEffect(target), pending: false,
    get playState() { return computed(target).animationPlayState === "paused" ? "paused" : "running"; } }));
  const document = { documentElement: root, head,
    createElement: tag => { assert.equal(tag, "style"); return new FakeStyle(); },
    getElementById: id => all().find(node => node.id === id) ?? null,
    querySelectorAll: selector => all().filter(node => node.matches(selector)),
    getAnimations: () => animations,
  };
  const context = { window: {}, document, Element: FakeElement, HTMLStyleElement: FakeStyle,
    KeyframeEffect: FakeEffect, getComputedStyle: computed };
  const page = { addInitScript: async () => {}, evaluate: async (callback, argument) =>
    runInNewContext(`(${callback.toString()})(argument)`, { ...context, argument }) };
  return { page, computed, normal, mask };
}

function scalarSnapshot(value) {
  const check = item => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number") { assert.ok(Number.isFinite(item)); return; }
    assert.equal(typeof item, "object", "snapshot contains a non-JSON scalar");
    assert.ok(Array.isArray(item) || Object.getPrototypeOf(item)?.constructor?.name === "Object",
      "snapshot must not retain DOM, Animation, effect or handle objects");
    for (const child of Object.values(item)) check(child);
  };
  check(value);
  return JSON.parse(JSON.stringify(value));
}

test("modern light/beam census attributes both animations and excludes the ordinary main path", async () => {
  const { page } = browser();
  const result = scalarSnapshot(await sampleEdgeEffects(page));
  assert.equal(result.feedbackFamily, "modern");
  assert.equal(result.modern.overlays.count, 1); assert.equal(result.modern.dashes.count, 0);
  assert.equal(result.modern.lights.count, 1); assert.equal(result.modern.beams.count, 1);
  assert.equal(result.animations.document.count, 3); assert.equal(result.animations.modern.count, 2);
  assert.equal(result.animations.modern.running, 2); assert.equal(result.animations.legacy.count, 0);
  assert.equal(result.normalPaths.count, 1);
  assert.equal(result.policy, "legacy-svg-feedback-only; modern-feedback-unchanged");
});

test("the earlier portal dash remains included in modern census and animation ownership", async () => {
  const { page } = browser({ portalDash: true });
  const result = scalarSnapshot(await sampleEdgeEffects(page));
  assert.equal(result.feedbackFamily, "modern");
  assert.equal(result.modern.dashes.count, 1);
  assert.equal(result.modern.lights.count, 0); assert.equal(result.modern.beams.count, 0);
  assert.equal(result.animations.document.count, 2); assert.equal(result.animations.modern.count, 1);
});

test("original/paused/hidden interventions affect legacy feedback only and return scalar evidence", async () => {
  for (const mode of ["original", "paused", "hidden"]) {
    const { page, computed, normal, mask } = browser({ legacy: true });
    const before = scalarSnapshot(await sampleEdgeEffects(page));
    await installEdgeGlowMode(page, mode);
    const result = scalarSnapshot(await sampleEdgeEffects(page));
    assert.equal(result.mode, mode); assert.equal(result.feedbackFamily, "mixed");
    assert.equal(result.legacy.masks.count, 1); assert.equal(result.legacy.lights.count, 1);
    assert.equal(result.legacy.beams.count, 1); assert.equal(result.animations.legacy.count, 2);
    assert.deepEqual(result.modern, before.modern); assert.deepEqual(result.animations.modern, before.animations.modern);
    assert.equal(result.styleInstalled, mode !== "original");
    assert.equal(result.requestedSelectors.length, mode === "original" ? 0 : 2);
    assert.deepEqual(result.matchedSelectors, result.requestedSelectors);
    for (const field of ["lights", "beams"]) {
      assert.equal(result.legacy[field].ownAnimationPaused, mode === "paused" ? 1 : 0);
      assert.equal(result.legacy[field].ownDisplayNone, mode === "hidden" ? 1 : 0);
    }
    assert.equal(computed(mask).display, "block"); assert.equal(computed(mask).animationPlayState, "running");
    assert.equal(computed(normal).display, "block"); assert.equal(computed(normal).animationPlayState, "running");
    if (mode === "paused") assert.equal(result.animations.legacy.paused, 2);
  }
});
