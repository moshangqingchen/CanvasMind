import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Dropdown } from "../components/ui/Dropdown";
import { Segmented } from "../components/ui/Segmented";
import { anchoredSurfacePlacement, appendTypeahead, nextEnabledIndex, typeaheadIndex } from "../components/ui/interactions";

const options = [{ label: "自动" }, { label: "Low", disabled: true }, { label: "High" }, { label: "Highest" }, { label: "Medium" }];

describe("opt-in single-choice parameter presentation", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  const png = [{ value: "png", label: "PNG" }];

  it("keeps both defaults interactive even with only one option", () => {
    const onChange = vi.fn();
    const dropdown = renderToStaticMarkup(React.createElement(Dropdown, { label: "输出格式", value: "png", options: png, onChange }));
    const segmented = renderToStaticMarkup(React.createElement(Segmented, { label: "生成模式", value: "png", options: png, onChange }));
    expect(dropdown).toContain('role="combobox"');
    expect(segmented).toContain("<button");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a valid sole dropdown value as readable text with its raw identity and restrictions", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(React.createElement(Dropdown, {
      id: "fixed-quality", label: "质量", value: "high", required: true, singleOptionDisplay: "static", onChange,
      describedBy: "field-source", description: "当前型号固定质量", options: [
        { value: "high", label: "高", detail: "high" },
        { value: "max", label: "最高", disabled: true, disabledReason: "当前渠道固定质量" },
      ],
    }));
    expect(html).toContain('id="fixed-quality" role="textbox" aria-readonly="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('data-value="high"');
    expect(html).toContain('aria-label="质量" aria-required="true"');
    expect(html).toContain("field-source");
    expect(html).toContain("当前型号固定质量");
    expect(html).toContain("当前渠道固定质量");
    expect(html).toContain(">高</span>");
    expect(html).not.toContain("<button");
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain('aria-haspopup');
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps empty, unknown, disabled, invalid and multiple-choice dropdown values correctable", () => {
    const onChange = vi.fn();
    const cases = [
      { value: "", options: png },
      { value: "old-format", options: png },
      { value: "jpeg", options: [...png, { value: "jpeg", label: "JPEG", disabled: true }] },
      { value: "png", options: png, ariaInvalid: true },
      { value: "png", options: [...png, { value: "jpeg", label: "JPEG" }] },
    ];
    for (const props of cases) {
      const html = renderToStaticMarkup(React.createElement(Dropdown, { label: "输出格式", singleOptionDisplay: "static", onChange, ...props }));
      expect(html).toContain('role="combobox"');
      expect(html).toContain(`data-value="${props.value}"`);
      expect(html).not.toContain('data-display="static"');
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows an already valid globally locked PNG and its explanation without changing it", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(React.createElement(Dropdown, {
      label: "输出格式", value: "png", options: png, disabled: true, singleOptionDisplay: "static", onChange,
      title: "透明模式使用 PNG，保留透明通道", singleOptionDescription: "透明模式使用 PNG，保留透明通道",
    }));
    expect(html).toContain('role="textbox" aria-readonly="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('data-value="png"');
    expect(html).toContain("透明模式使用 PNG，保留透明通道");
    expect(html).not.toContain("<button");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the segmented group identity and disabled reasons while replacing only a valid sole choice", () => {
    const onChange = vi.fn();
    const props = { label: "生成模式", value: "normal", singleOptionDisplay: "static" as const, onChange, options: [
      { value: "normal", label: "普通模式" },
      { value: "transparent", label: "透明模式", disabled: true, title: "当前型号没有透明选项" },
    ] };
    const html = renderToStaticMarkup(React.createElement(Segmented, props));
    expect(html).toContain('role="group" aria-label="生成模式"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('data-value="normal"');
    expect(html).toContain("普通模式");
    expect(html).toContain("当前型号没有透明选项");
    expect(html).not.toContain("<button");
    for (const value of ["", "unknown", "transparent"]) {
      const correction = renderToStaticMarkup(React.createElement(Segmented, { ...props, value }));
      expect(correction).toContain("<button");
      expect(correction).not.toContain('data-display="static"');
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("retains every disabled option label even when their reasons are identical", () => {
    const onChange = vi.fn();
    const choices = [
      { value: "4K", label: "4K" },
      { value: "1K", label: "1K", disabled: true, disabledReason: "固定档位", title: "固定档位" },
      { value: "2K", label: "2K", disabled: true, disabledReason: "固定档位", title: "固定档位" },
    ];
    const props = { label: "分辨率", value: "4K", options: choices, singleOptionDisplay: "static" as const, onChange };
    for (const html of [renderToStaticMarkup(React.createElement(Dropdown, props)), renderToStaticMarkup(React.createElement(Segmented, props))]) {
      expect(html).toContain("<summary>选项限制</summary>");
      expect(html).toContain(">1K</span>");
      expect(html).toContain(">2K</span>");
      expect(html.match(/固定档位/gu)).toHaveLength(2);
      expect(html).not.toContain("<button");
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("parameter UI keyboard navigation", () => {
  it("cycles selectable rows, skips disabled rows, and reaches Home/End without dropping options", () => {
    expect(nextEnabledIndex(options, 0, "ArrowDown")).toBe(2);
    expect(nextEnabledIndex(options, 2, "ArrowLeft")).toBe(0);
    expect(nextEnabledIndex(options, 0, "ArrowUp")).toBe(4);
    expect(nextEnabledIndex(options, 4, "ArrowRight")).toBe(0);
    expect(nextEnabledIndex(options, 3, "Home")).toBe(0);
    expect(nextEnabledIndex(options, 0, "End")).toBe(4);
    expect(nextEnabledIndex([{ disabled: true }], 0, "ArrowDown")).toBe(-1);
    expect(nextEnabledIndex([], -1, "Home")).toBe(-1);
  });

  it("matches prefixes, cycles repeated letters, and never selects a disabled matching row", () => {
    expect(typeaheadIndex(options, 0, "h")).toBe(2);
    expect(typeaheadIndex(options, 2, "hi")).toBe(2);
    expect(typeaheadIndex(options, 2, "hh")).toBe(3);
    expect(typeaheadIndex(options, 0, "l")).toBe(0);
    expect(typeaheadIndex(options, 3, "m")).toBe(4);
    expect(typeaheadIndex(options, 4, "自动")).toBe(0);
    expect(typeaheadIndex([{ label: "高", value: "high" }, { label: "最高", value: "max" }], 0, "m")).toBe(1);
    expect(typeaheadIndex([], -1, "h")).toBe(-1);
  });

  it("expires incomplete typeahead instead of retaining it across later interactions", () => {
    const first = appendTypeahead({ text: "", at: 0 }, "h", 1000);
    expect(appendTypeahead(first, "i", 1200)).toEqual({ text: "hi", at: 1200 });
    expect(appendTypeahead(first, "m", 2000)).toEqual({ text: "m", at: 2000 });
  });
});

describe("parameter UI anchored surface bounds", () => {
  const bounds = { left: 8, right: 412, top: 8, bottom: 712, width: 404 };
  it("places a menu below the anchor and constrains a wide menu to the viewport", () => {
    const placement = anchoredSurfacePlacement({ bounds,
      anchor: { left: 60, right: 420, top: 80, bottom: 118, width: 360 },
      naturalHeight: 260, minWidth: 240, maxWidth: 480 });
    expect(placement).toEqual({ left: 52, top: 124, width: 360, maxHeight: 588 });
    const narrow = anchoredSurfacePlacement({ bounds: { ...bounds, right: 212, width: 204 },
      anchor: { left: 20, right: 200, top: 80, bottom: 118, width: 180 },
      naturalHeight: 260, minWidth: 320, maxWidth: 480 });
    expect(narrow.width).toBe(204);
    expect(narrow.left + narrow.width).toBeLessThanOrEqual(212);
  });

  it("flips a near-bottom anchor upward and gives tall catalogs an internal scroll budget", () => {
    const placement = anchoredSurfacePlacement({ bounds,
      anchor: { left: 20, right: 300, top: 640, bottom: 678, width: 280 },
      naturalHeight: 1200, minWidth: 240, maxWidth: 420 });
    expect(placement.top).toBe(8);
    expect(placement.maxHeight).toBe(626);
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(712);
  });

  it("uses the optional side only when it fits the requested minimum and keeps the full viewport height", () => {
    const largeBounds = { ...bounds, right: 1200, width: 1192 };
    const owner = { left: 800, right: 1180, top: 80, bottom: 700, width: 380 };
    const anchor = { left: 1100, right: 1140, top: 600, bottom: 638, width: 40 };
    const placement = anchoredSurfacePlacement({ bounds: largeBounds, anchor, owner,
      naturalHeight: 900, minWidth: 320, maxWidth: 480, preferSidePlacement: true });
    expect(placement).toEqual({ left: 474, top: 8, width: 320, maxHeight: 704 });
    const fallback = anchoredSurfacePlacement({ bounds, anchor: { ...anchor, left: 300, right: 340 },
      owner: { ...owner, left: 20, right: 400, width: 380 }, naturalHeight: 200,
      minWidth: 320, maxWidth: 480, preferSidePlacement: true });
    expect(fallback.left).toBe(92);
    expect(fallback.width).toBe(320);
  });
});
