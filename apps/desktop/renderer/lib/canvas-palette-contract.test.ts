import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../app/theme-tokens.css", import.meta.url), "utf8");
const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1]!.replace(/\/\*[\s\S]*?\*\//g, "").trim(), declarations: match[2]! }));
const declarations = (selector: string) => rules.find(rule => rule.selector.split(",").some(value => value.trim() === selector))?.declarations ?? "";
const tokens = (selector: string) => Object.fromEntries([...declarations(selector).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
  .map(match => [match[1], match[2]!.trim()]));

describe("canvas palette and detail regression", () => {
  it("restores the final ae06355 workbench palette inside the dark canvas only", () => {
    const dark = tokens(':root[data-theme="dark"] .canvas-editor');
    expect(dark).toMatchObject({
      "--surface-canvas": "#0C0D13", "--node-surface": "#1B1C28", "--surface-floating": "#14151E",
      "--panel-3": "#242536", "--canvas-dot-color": "#303235", "--accent": "#A998FF",
      "--selection-border": "#BDA8F1", "--prompt-node-surface": "#211E2B", "--node-editor-background": "#171A2B",
      "--node-title-ink": "#F0EAFF", "--primary-fill": "linear-gradient(125deg,#D5C1FF,#9FAEFF)",
    });
    // The shared pages retain their current palettes in both themes.
    expect(tokens(':root[data-theme="dark"]')["--surface-canvas"]).toBe("#0E0F12");
    expect(source).toContain("--surface-canvas:#F3F5F7; --node-surface:#FFFFFF");
    const canvas = declarations(".canvas-editor");
    expect(canvas).toContain("--surface-node:var(--node-surface)");
    expect(canvas).toContain("--panel:var(--surface-floating)");
  });

  it("keeps compact media and measured bodies painted, clipping text instead of hiding the body", () => {
    const compactRules = rules.filter(rule => rule.selector.includes(".canvas-lod-compact"));
    for (const { selector, declarations: body } of compactRules) {
      if (!/visibility\s*:\s*hidden|display\s*:\s*none/.test(body)) continue;
      expect(selector).not.toMatch(/\.node-body\b|\.node-preview\b|\.generated-result-viewport\b|\bimg\b|\bvideo\b/);
    }
    for (const type of ["prompt-overview", "tiptap-prompt"]) {
      const text = declarations(`.canvas-editor .canvas-lod-compact .node-card .${type}`);
      expect(text).toContain("max-height:1lh");
      expect(text).toContain("min-height:0");
      expect(text).toContain("overflow:hidden");
      expect(text).not.toContain("clip-path");
    }
    expect(source).not.toMatch(/\.react-flow__node(?:\.selected|\.dragging)[^{]*\{[^}]*will-change/);
  });

  it("places transient labels entirely outside the card beside each handle", () => {
    expect(declarations(".canvas-editor .port-label.left")).toContain("transform:translate(-100%,-50%)");
    expect(declarations(".canvas-editor .port-label.right")).toContain("transform:translate(100%,-50%)");
    expect(source).not.toContain(".node-card:focus-within .port-label");
    expect(source).toContain('.node-card[data-connection-active="true"] .port-label');
    expect(source).toContain("background:var(--surface-floating)");
  });
});
