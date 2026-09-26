import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import {
  connectionModelItemsForDisplay,
  pendingConnectionModelScan,
  type ConnectionModelSnapshot,
} from "./connection-model-snapshot";
import { parameterDescriptorsFor } from "./model-parameters";

const model: ModelDescriptor = {
  id: "gpt-image-2.5-sunburst",
  name: "GPT Image 2.5 Sunburst",
  operations: ["image.generate"],
  parameters: [
    { key: "size", label: "分辨率", control: "dimensions", default: "auto" },
    {
      key: "quality", label: "质量", control: "select", default: "max",
      options: [{ label: "最高 (max)", value: "max" }],
    },
  ],
};
const ready: ConnectionModelSnapshot = {
  connectionId: "sunburst-key",
  items: [model],
  authoritative: true,
  loading: false,
};

describe("connection model presentation during scans", () => {
  it("keeps the declared parameter schema while the live inventory is pending", () => {
    const pending = pendingConnectionModelScan(ready, ready.connectionId);
    const displayed = connectionModelItemsForDisplay(pending);
    expect(displayed).toEqual([model]);
    expect(parameterDescriptorsFor("image-generation", "openai", displayed[0]))
      .toEqual(parameterDescriptorsFor("image-generation", "openai", model));
    expect(pending.items).toEqual([]);
    expect(pending).toMatchObject({ authoritative: true, loading: true });
  });

  it("keeps the same display snapshot when another refresh interrupts the first", () => {
    const first = pendingConnectionModelScan(ready, ready.connectionId);
    const second = pendingConnectionModelScan(first, ready.connectionId);
    expect(connectionModelItemsForDisplay(second)).toEqual([model]);
    expect(second.items).toEqual([]);
  });

  it("does not carry a model schema into another connection", () => {
    const pending = pendingConnectionModelScan(ready, "other-key");
    expect(connectionModelItemsForDisplay(pending)).toEqual([]);
    expect(pending.items).toEqual([]);
  });

  it("accepts an authoritative empty result or cleared failed scan immediately", () => {
    const pending = pendingConnectionModelScan(ready, ready.connectionId);
    const settled = { ...pending, items: [], loading: false };
    expect(connectionModelItemsForDisplay(settled)).toEqual([]);
    expect(connectionModelItemsForDisplay(pendingConnectionModelScan(settled, ready.connectionId)))
      .toEqual([]);
  });

  it("replaces the previous schema when a new scan completes", () => {
    const pending = pendingConnectionModelScan(ready, ready.connectionId);
    const replacement = { ...model, name: "Updated Sunburst" };
    expect(connectionModelItemsForDisplay({ ...pending, items: [replacement], loading: false }))
      .toEqual([replacement]);
  });
});
