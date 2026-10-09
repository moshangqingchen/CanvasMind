import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import {
  connectionModelItemsForDisplay,
  connectionModelInventoryConfirmed,
  pendingConnectionModelScan,
  settledConnectionModelScan,
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
  it("settles the Key comparison when the same model rows gain complete live provenance", () => {
    const partial = settledConnectionModelScan(ready, ready.connectionId, [model], true, { scanStatus: "live", complete: false });
    expect(connectionModelInventoryConfirmed(partial)).toBe(false);
    const confirmed = settledConnectionModelScan(partial, ready.connectionId, structuredClone([model]), true, { scanStatus: "live", complete: true });
    expect(confirmed).not.toBe(partial);
    expect(connectionModelInventoryConfirmed(confirmed)).toBe(true);
    expect(settledConnectionModelScan(confirmed, ready.connectionId, [model], true, { scanStatus: "live", complete: true })).toBe(confirmed);
  });

  it("returns to confirmed after repeated focus or timed refreshes with unchanged rows", () => {
    let snapshot = settledConnectionModelScan(ready, ready.connectionId, [model], true, { scanStatus: "live", complete: true });
    for (let refresh = 0; refresh < 3; refresh++) {
      const pending = pendingConnectionModelScan(snapshot, ready.connectionId);
      expect(connectionModelInventoryConfirmed(pending)).toBe(false);
      expect(connectionModelItemsForDisplay(pending)).toEqual([model]);
      snapshot = settledConnectionModelScan(pending, ready.connectionId, structuredClone([model]), true, { scanStatus: "live", complete: true });
      expect(connectionModelInventoryConfirmed(snapshot)).toBe(true);
      expect(snapshot.items).toEqual([model]);
    }
  });

  it.each(["stale", "failed", "unauthorized", "unscanned", "partial"])("does not confirm a retained model list whose provenance is %s", scanStatus => {
    const snapshot = settledConnectionModelScan(ready, ready.connectionId, [model], true, { scanStatus, complete: true });
    expect(connectionModelInventoryConfirmed(snapshot)).toBe(false);
  });

  it("clears a prior failure only after a new response and accepts a confirmed empty directory", () => {
    const failed = { ...ready, failed: true, scanStatus: "live", complete: true };
    expect(connectionModelInventoryConfirmed(failed)).toBe(false);
    const restored = settledConnectionModelScan(failed, ready.connectionId, [model], true, { scanStatus: "live", complete: true });
    expect(restored).not.toBe(failed);
    expect(connectionModelInventoryConfirmed(restored)).toBe(true);
    expect(connectionModelInventoryConfirmed(settledConnectionModelScan(restored, ready.connectionId, [], true, { scanStatus: "empty", complete: true }))).toBe(true);
    expect(connectionModelInventoryConfirmed({ ...restored, authoritative: false })).toBe(false);
  });

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
