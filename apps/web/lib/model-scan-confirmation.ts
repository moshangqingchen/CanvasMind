import type { JsonObject } from "@super-canvas/db";

/**
 * A successful empty /models response is suspicious enough to require a
 * second confirmation before replacing a previously callable connector.
 * These fields are intentionally kept in the connection config so the
 * confirmation survives separate requests and server restarts.
 */
const EMPTY_SCAN_CONFIRMATIONS = "emptyScanConfirmations";
const EMPTY_SCAN_SCOPE = "emptyScanScope";

function confirmationCount(config: JsonObject, scope: string): number {
  return config.modelScanStatus === "empty" &&
    config[EMPTY_SCAN_SCOPE] === scope &&
    config[EMPTY_SCAN_CONFIRMATIONS] === 1
    ? 1
    : 0;
}
export function shouldConfirmEmptyScan(
  config: JsonObject,
  scope: string,
): boolean {
  return confirmationCount(config, scope) === 1;
}

export function pendingEmptyScanConfig(
  config: JsonObject,
  checkedAt: string,
  scope: string,
): JsonObject {
  return {
    ...config,
    modelScanStatus: "empty",
    modelScanCheckedAt: checkedAt,
    scannedModelIds: [],
    [EMPTY_SCAN_CONFIRMATIONS]: 1,
    [EMPTY_SCAN_SCOPE]: scope,
  };
}

export function clearEmptyScanConfirmation(config: JsonObject): void {
  delete config[EMPTY_SCAN_CONFIRMATIONS];
  delete config[EMPTY_SCAN_SCOPE];
}
