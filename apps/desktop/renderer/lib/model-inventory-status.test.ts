import { describe, expect, it } from "vitest";
import { modelInventoryLastSuccessAt, modelInventoryScanStatus, withModelInventoryMetadata } from "./model-inventory-status";

describe("inventory freshness", () => {
  it("keeps empty availability while showing a failed attempt, even when both timestamps are equal", () => {
    const config = { modelScanStatus: "empty", modelScanAttemptStatus: "failed",
      modelScanCheckedAt: "same-tick", modelScanLastSuccessAt: "same-tick" };
    expect(modelInventoryScanStatus(config)).toBe("stale");
    expect(config.modelScanStatus).toBe("empty");
    expect(modelInventoryScanStatus({ ...config, modelScanAttemptStatus: "empty" })).toBe("empty");
  });
  it("recognizes older failed-empty records without inventing failure for an old confirmed empty record", () => {
    expect(modelInventoryScanStatus({ modelScanStatus: "empty", modelScanLastSuccessAt: "old", modelScanCheckedAt: "new" })).toBe("stale");
    expect(modelInventoryScanStatus({ modelScanStatus: "empty", modelScanCheckedAt: "old" })).toBe("empty");
  });
  it("only derives legacy success from a confirmed state", () => {
    const time = "2026-09-20T00:00:00Z";
    expect(modelInventoryLastSuccessAt({ modelScanStatus: "live", modelScanCheckedAt: time })).toBe(time);
    expect(modelInventoryLastSuccessAt({ modelScanStatus: "failed", modelScanCheckedAt: time })).toBeUndefined();
    expect(modelInventoryLastSuccessAt({ modelScanStatus: "empty", modelScanCheckedAt: time,
      modelScanLastSuccessAt: null })).toBeUndefined();
  });
  it("reports old confirmed data separately from the current failed attempt", async () => {
    const response = withModelInventoryMetadata(Response.json([{ id: "old" }], {
      headers: { "X-Model-Scan-Status": "stale" },
    }), { modelScanStatus: "failed", modelScanCheckedAt: "2026-09-22T00:00:00Z",
      modelScanLastSuccessAt: "2026-09-20T00:00:00Z" });
    expect(response.headers.get("X-Model-Scan-Checked-At")).toBe("2026-09-22T00:00:00Z");
    expect(response.headers.get("X-Model-Scan-Last-Success-At")).toBe("2026-09-20T00:00:00Z");
    expect(response.headers.get("X-Model-Scan-Source")).toBe("saved");
    expect(await response.json()).toEqual([{ id: "old" }]);
  });
});
