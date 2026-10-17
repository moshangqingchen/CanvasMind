import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";

const effects = vi.hoisted(() => [] as Array<() => void>);
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useEffect: (effect: () => void) => { effects.push(effect); } };
});
import { NodeParameterFields } from "../components/node-parameter-fields";

beforeAll(() => { vi.stubGlobal("React", React); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => { effects.length = 0; });

const models: Array<{ model: ModelDescriptor; parameters: Record<string, unknown> }> = [
  { model: { id: "clamped-width", name: "clamped-width", operations: ["image.generate"], metadata: { clampNumericParameters: true }, parameters: [
    { key: "width", label: "宽", control: "number", valueType: "integer", min: 256, max: 1024, default: 1024 },
    { key: "height", label: "高", control: "number", valueType: "integer", min: 256, max: 2048, default: 1920 },
  ] }, parameters: { width: 1080, height: 1920 } },
  { model: { id: "linked-resolution", name: "linked-resolution", operations: ["image.generate"], parameters: [
    { key: "mode", label: "模式", control: "select", default: "poster", options: [{ label: "海报", value: "poster" }] },
    { key: "resolution", label: "分辨率", control: "select", default: "4K", options: [{ label: "2K", value: "2K" }, { label: "4K", value: "4K" }], constraints: [{ when: [{ parameter: "mode", values: ["poster"] }], options: [{ label: "4K", value: "4K" }] }] },
  ] }, parameters: { mode: "poster", resolution: "2K" } },
];

it.each(models)("a plan editor mount cannot turn automatic normalization into an output edit: $model.id", ({ model, parameters }) => {
  const onChange = vi.fn();
  const original = { ...parameters };
  renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "plan", nodeType: "image-generation", provider: "rest", model, parameters, onChange, normalizeAutomatically: false }));
  expect(effects).toHaveLength(1);
  effects.forEach(effect => effect());
  expect(onChange).not.toHaveBeenCalled();
  expect(parameters).toEqual(original);
});

it.each(models)("the existing canvas default normalization remains enabled: $model.id", ({ model, parameters }) => {
  const onChange = vi.fn();
  renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "canvas", nodeType: "image-generation", provider: "rest", model, parameters, onChange }));
  effects.forEach(effect => effect());
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0]![0]).not.toEqual(parameters);
});
