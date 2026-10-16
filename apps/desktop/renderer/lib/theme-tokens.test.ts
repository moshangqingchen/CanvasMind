import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const renderer = new URL("../", import.meta.url);
const source = readFileSync(new URL("app/theme-tokens.css", renderer), "utf8");
function theme(name: "light" | "dark") {
  const block = source.match(new RegExp(`:root\\[data-theme="${name}"\\]\\s*\\{([^}]+)`))?.[1];
  if (!block) throw new Error(`Missing ${name} theme`);
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2]!.trim()]));
}
function luminance(hex: string) {
  const channels = [1, 3, 5].map(offset => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}
function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (values[1]! + .05) / (values[0]! + .05);
}

describe("shared light and dark theme contracts", () => {
  it("keeps neural studio text, module accents and pill actions readable in both themes", () => {
    const neural = readFileSync(new URL("components/neural-tokens.css", renderer), "utf8");
    for (const name of ["dark", "light"]) {
      const block = neural.match(new RegExp(`\\[data-theme="${name}"\\]\\s*\\{([^}]+)`))?.[1];
      expect(block).toBeTruthy();
      const tokens = Object.fromEntries([...block!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2]!.trim()]));
      const background = tokens["--neural-glass-solid"];
      const composite = (foreground: string) => {
        if (foreground.startsWith("#")) return foreground;
        const [r, g, b, alpha] = foreground.match(/[\d.]+/g)!.map(Number);
        return `#${[r, g, b].map((channel, i) => Math.round(channel * alpha + Number.parseInt(background.slice(1 + i * 2, 3 + i * 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
      };
      for (const token of ["--neural-text", "--neural-text-secondary"])
        expect(contrast(composite(tokens[token]), background), `${name} ${token}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(composite(tokens["--neural-text-muted"]), background), `${name} micro label`).toBeGreaterThanOrEqual(3);
      for (const token of ["canvases", "suppliers", "accounts", "starts"])
        expect(contrast(tokens[`--neural-${token}`], background), `${name} ${token}`).toBeGreaterThanOrEqual(3);
      expect(contrast(tokens["--neural-button-text"], tokens["--neural-button"])).toBeGreaterThanOrEqual(4.5);
      // Module dimming also affects text alpha. Stronger ink preserves the
      // same visual opacity while retaining AA on the exposed studio field.
      const dimInk = tokens["--neural-dim-text"];
      const dimBackground = tokens["--neural-bg"];
      const dimComposite = `#${[1, 3, 5].map(offset => Math.round(Number.parseInt(dimInk.slice(offset, offset + 2), 16) * .55 + Number.parseInt(dimBackground.slice(offset, offset + 2), 16) * .45).toString(16).padStart(2, "0")).join("")}`;
      expect(contrast(dimComposite, dimBackground), `${name} dimmed module label`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it.each(["light", "dark"] as const)("keeps %s body text and primary actions above WCAG AA", name => {
    const tokens = theme(name);
    for (const text of ["--text", "--body"]) {
      for (const background of ["--node-surface", "--surface-canvas", "--panel-2", "--panel-3"]) {
        expect(contrast(tokens[text]!, tokens[background]!), `${name} ${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(tokens["--on-accent"]!, tokens["--accent"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps blocking feedback error text readable on both themed status surfaces", () => {
    const light = theme("light"), dark = theme("dark");
    expect(contrast(light["--status-fail"]!, light["--danger-wash"]!)).toBeGreaterThanOrEqual(4.5);
    const red = [248, 113, 113], card = [23, 24, 28];
    const blended = red.map((channel, index) => Math.round(channel * .12 + card[index]! * .88));
    const background = `#${blended.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
    expect(contrast(dark["--status-fail"]!, background)).toBeGreaterThanOrEqual(4.5);
    expect(readFileSync(new URL("components/blocking-feedback.module.css", renderer), "utf8")).toContain("background:var(--danger-wash)");
  });

  it("centralizes interface colors and removes the retired colored node strip", () => {
    for (const folder of ["app", "components"]) {
      const directory = new URL(`${folder}/`, renderer);
      for (const filename of readdirSync(directory).filter(value => value.endsWith(".css"))) {
        if (["theme-tokens.css", "neural-tokens.css", "dynamic-island.module.css"].includes(filename)) continue;
        const css = readFileSync(new URL(filename, directory), "utf8");
        expect(css, fileURLToPath(new URL(filename, directory))).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
        expect(css).not.toContain("--aurora-");
      }
    }
    expect(source).not.toMatch(/\.node-card::before\s*\{/);
    expect(readFileSync(new URL("app/globals.css", renderer), "utf8")).not.toMatch(/\.node-card::before\s*\{/);
  });

  it.each(["light", "dark"] as const)("keeps %s result badges opaque and readable over white artwork", name => {
    const tokens = theme(name);
    for (const status of ["running", "success", "fail", "warn"]) {
      const foreground = tokens[`--status-${status}`]!;
      const surface = tokens["--surface-floating"]!;
      const channels = [1, 3, 5].map(offset => Math.round(
        Number.parseInt(foreground.slice(offset, offset + 2), 16) * .12 +
        Number.parseInt(surface.slice(offset, offset + 2), 16) * .88,
      ));
      const badge = `#${channels.map(value => value.toString(16).padStart(2, "0")).join("")}`;
      expect(contrast(foreground, badge), `${name} ${status} overlay`).toBeGreaterThanOrEqual(4.5);
      expect(source).toContain(`--result-status-${status}-surface:color-mix(in srgb,var(--status-${status}) 12%,var(--surface-floating))`);
    }
    // Opaque sources sum to 100%; the underlying white image cannot leak in.
    expect(source).toContain('.node-card[data-node-status="succeeded"] .generated-result-status { background:var(--result-status-success-surface); }');
    expect(source).toContain('.node-card[data-node-status="succeeded"] .node-status-label { color:var(--status-success); background:var(--success-wash); }');
    expect(contrast(tokens["--text-secondary"]!, tokens["--surface-floating"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses foreground tones for task status and material filters in either theme", () => {
    const tasks = readFileSync(new URL("components/task-center.css", renderer), "utf8");
    const materials = readFileSync(new URL("components/image-library.css", renderer), "utf8");
    expect(tasks).not.toMatch(/--task-tone:\s*var\(--(?:info|danger|warning|success)-wash\)/);
    expect(materials).not.toMatch(/--media-tone:\s*var\(--(?:surface-floating|info-wash|danger-wash|warning-wash|success-wash)\)/);
    expect(tasks).toContain("--task-tone:var(--status-running)");
    expect(materials).toContain("--media-tone:var(--text-secondary)");
  });

  it("limits canvas blur to small chrome islands and scopes studio glass to its own surfaces", () => {
    for (const folder of ["app", "components"]) {
      const directory = new URL(`${folder}/`, renderer);
      for (const filename of readdirSync(directory).filter(value => value.endsWith(".css"))) {
        const css = readFileSync(new URL(filename, directory), "utf8");
        for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          if (!/(?:-webkit-)?backdrop-filter\s*:\s*(?!none)[^;]+;/.test(rule[2]!)) continue;
          // The new studio explicitly uses glass, including settings shared by
          // canvas. Keep its exceptions local; never relax the canvas node gate.
          if (filename === "neural-workspace.module.css") {
            expect(rule[1]).toMatch(/\.(?:navigation|satelliteCard|inspector|dock|searchPanel|legend|dialog)\b/);
            continue;
          }
          if (filename === "settings-neural.css") {
            expect(rule[1]).toMatch(/\.neural-settings/);
            continue;
          }
          if (["app-update-modal.module.css", "supplier-refresh-details.module.css"].includes(filename)) {
            expect(rule[1]).toMatch(/\.(?:backdrop|modal)\b/);
            continue;
          }
          expect(["theme-tokens.css", "canvas-chrome.module.css"], `${filename} ${rule[1]}`).toContain(filename);
          expect(rule[1]).toMatch(/editor-rail|canvas-toolbar|react-flow__controls|\.island/);
        }
      }
    }
  });
});
