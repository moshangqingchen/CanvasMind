/** Legacy live/empty records have a confirmed timestamp; failed records do not. */
export function modelInventoryLastSuccessAt(config: Record<string, unknown>): string | undefined {
  if ("modelScanLastSuccessAt" in config)
    return typeof config.modelScanLastSuccessAt === "string" ? config.modelScanLastSuccessAt : undefined;
  if (["live", "empty"].includes(String(config.modelScanStatus)) &&
      typeof config.modelScanCheckedAt === "string") return config.modelScanCheckedAt;
  return undefined;
}

/** Empty remains an availability guard even if the latest read failed. */
export function modelInventoryScanStatus(config: Record<string, unknown>): string {
  const status = typeof config.modelScanStatus === "string" ? config.modelScanStatus : "unscanned";
  if (status === "failed") return "stale";
  if (status === "empty") {
    if (config.modelScanAttemptStatus === "failed") return "stale";
    // Records written before attemptStatus was added can still prove that the
    // latest attempt did not produce their saved, confirmed empty directory.
    if (config.modelScanAttemptStatus === undefined &&
        typeof config.modelScanLastSuccessAt === "string" &&
        typeof config.modelScanCheckedAt === "string" &&
        config.modelScanLastSuccessAt !== config.modelScanCheckedAt) return "stale";
  }
  return status;
}

export function withModelInventoryMetadata(
  response: Response,
  config: Record<string, unknown>,
  source?: string,
): Response {
  const headers = new Headers(response.headers);
  if (typeof config.modelScanCheckedAt === "string")
    headers.set("X-Model-Scan-Checked-At", config.modelScanCheckedAt);
  const lastSuccess = modelInventoryLastSuccessAt(config);
  if (lastSuccess) headers.set("X-Model-Scan-Last-Success-At", lastSuccess);
  else headers.delete("X-Model-Scan-Last-Success-At");
  if (source) headers.set("X-Model-Scan-Source", source);
  else if (!headers.has("X-Model-Scan-Source") &&
      (!response.ok || ["stale", "failed", "unauthorized"].includes(headers.get("X-Model-Scan-Status") ?? "")))
    headers.set("X-Model-Scan-Source", "saved");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
