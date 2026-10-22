import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { remainingVideoModel } from "@super-canvas/providers/remaining-video-contracts";
import { NodeParameterFields } from "../components/node-parameter-fields";
import { normalizedParametersForModel } from "./model-parameters";

vi.mock("../components/ui/Dropdown", async () => ({
  Dropdown: (await import("./test-helpers/parameter-dropdown.test-helper")).StaticParameterDropdown,
}));

const model = (id: string) => remainingVideoModel("jijiu", id)!;
const render = (id: string, parameters: Record<string, unknown>) => renderToStaticMarkup(React.createElement(NodeParameterFields, {
  nodeId: "jijiu-current-offline", nodeType: "video-generation", provider: "openai", model: model(id), parameters, onChange: () => {},
}));

describe("October 20 Jijiu source parameter panel (offline)", () => {
  const network = vi.fn(() => { throw Error("No network is allowed"); });
  beforeAll(() => { vi.stubGlobal("React", React); vi.stubGlobal("fetch", network); });
  afterAll(() => { try { expect(network).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });

  it.each(["wan3.0-video", "wan3.0-video-prime"])("renders and preserves the documented -1 choice for %s", id => {
    const current = { duration: -1, resolution: "720p" }, html = render(id, current);
    expect(html).toContain('value="-1" selected="">自动时长（-1）</option>');
    expect(html).toContain("按 30 秒预扣");
    const saved = JSON.parse(JSON.stringify(current));
    expect(normalizedParametersForModel("video-generation", "openai", model(id), saved)).toEqual(current);
    expect(saved).toEqual(current);
  });

  it.each(["wan3.0-video-S", "wan3.0-video-prime-S"])("does not borrow automatic duration for %s", id => {
    const html = render(id, { duration: -1, resolution: "720p" });
    expect(html).not.toContain("自动时长（-1）");
    expect(html).toContain("-1（已保存");
    expect(normalizedParametersForModel("video-generation", "openai", model(id), { duration: -1 })).toEqual({ duration: -1 });
  });

  it("shows A/B watermark and billing descriptions and C's single legal resolution", () => {
    expect(render("满血seedance-2.5全参A", { duration: 5, resolution: "1080p" })).toMatch(/数字水印[^"<]*按次/);
    const second = render("满血seedance-2.5全参B", { duration: 5, resolution: "720p" });
    expect(second).toMatch(/数字水印[^"<]*按秒/);
    expect(second).not.toContain('value="1080p"');
    const fixed = render("满血seedance-2.5全参C", { duration: 30, resolution: "720p" });
    expect(fixed).toContain('value="720p" selected="">720p</option>');
    expect(fixed).not.toContain('value="480p"');
    expect(fixed).not.toContain('value="1080p"');
  });

  it("retains out-of-range fourth-line choices and saved aliases until the user changes them", () => {
    const id = "SD2.0满血稳定933-线路四", current = { duration_seconds: 16, resolution: "1080p", aspect_ratio: "16:9" };
    const before = structuredClone(current), html = render(id, { ...current, duration: 16 });
    expect(html).toContain("16"); expect(html).toContain("1080p");
    expect(normalizedParametersForModel("video-generation", "openai", model(id), current)).toEqual({ ...current, duration: 16 });
    expect(current).toEqual(before);
  });
});
