import { describe, expect, it } from "vitest";
import {
  clearEmptyScanConfirmation,
  pendingEmptyScanConfig,
  shouldConfirmEmptyScan,
} from "./model-scan-confirmation";

describe("model scan empty confirmation", () => {
  it("requires a second empty result for the same scope", () => {
    const first = pendingEmptyScanConfig(
      { connector: { models: [{ id: "old-model" }] } },
      "2026-08-28T00:00:00.000Z",
      "group-a",
    );
    expect(shouldConfirmEmptyScan(first, "group-a")).toBe(true);
    expect(shouldConfirmEmptyScan(first, "group-b")).toBe(false);
  });

  it("does not treat unrelated or repeated markers as confirmation", () => {
    expect(
      shouldConfirmEmptyScan(
        {
          modelScanStatus: "live",
          emptyScanConfirmations: 1,
          emptyScanScope: "group-a",
        },
        "group-a",
      ),
    ).toBe(false);
    expect(
      shouldConfirmEmptyScan(
        {
          modelScanStatus: "empty",
          emptyScanConfirmations: 2,
          emptyScanScope: "group-a",
        },
        "group-a",
      ),
    ).toBe(false);
  });

  it("clears confirmation metadata after a live reconciliation", () => {
    const config = pendingEmptyScanConfig({}, "checked", "group-a");
    clearEmptyScanConfirmation(config);
    expect(config).toEqual({
      modelScanStatus: "empty",
      modelScanCheckedAt: "checked",
      scannedModelIds: [],
    });
  });
});
