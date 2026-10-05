import { describe, expect, it } from "vitest";
import type { RunSnapshot } from "../components/types";
import { reconcileRunSnapshot } from "./run-snapshot-version";

function snapshot(status: RunSnapshot["run"]["status"], version: number): RunSnapshot {
  const at = `2026-10-05T12:00:0${version}.000Z`;
  return {
    run: { id: "run", canvasId: "canvas", scope: "node", status, createdAt: "2026-10-05T12:00:00.000Z", updatedAt: at },
    nodes: [{ id: "node-run", nodeId: "source", status, outputAssetIds: status === "succeeded" ? ["output"] : [], updatedAt: at }],
  };
}

describe("run snapshot ordering", () => {
  it("keeps completed output and terminal subscription state when an older running read arrives last", () => {
    const completed = snapshot("succeeded", 2);
    expect(reconcileRunSnapshot(completed, snapshot("running", 1))).toEqual(completed);
  });

  it("allows a newer resume of the same cancelled run and ignores its delayed cancellation response", () => {
    const cancelled = snapshot("cancelled", 1);
    const resumed = snapshot("running", 2);
    expect(reconcileRunSnapshot(cancelled, resumed)).toEqual(resumed);
    expect(reconcileRunSnapshot(resumed, cancelled)).toEqual(resumed);
  });

  it("orders node progress separately when the run timestamp has not changed", () => {
    const newer = snapshot("running", 2);
    newer.nodes[0]!.status = "archiving";
    const older = snapshot("running", 1);
    older.run.updatedAt = newer.run.updatedAt;
    expect(reconcileRunSnapshot(newer, older).nodes[0]!.status).toBe("archiving");
  });

  it("retains newer billing evidence while accepting missing static details from an older detailed read", () => {
    const newer = snapshot("failed", 2);
    newer.nodes[0]!.errorJson = { message: "已退款", charge: { status: "refunded", amount: 0.25, currency: "USD", source: "provider_response" } };
    newer.nodes[0]!.request = { model: "model", parameters: { size: "1024x1024" } };
    const older = snapshot("failed", 1);
    older.nodes[0]!.errorJson = { message: "已扣费", charge: { status: "charged", amount: 0.25, currency: "USD", source: "provider_response" } };
    older.nodes[0]!.request = { model: "model", prompt: "Saved original prompt", inputAssetIds: ["original"] };
    const result = reconcileRunSnapshot(newer, older);
    expect(result.nodes[0]!.errorJson).toEqual(newer.nodes[0]!.errorJson);
    expect(result.nodes[0]!.request).toMatchObject({ prompt: "Saved original prompt", inputAssetIds: ["original"], parameters: { size: "1024x1024" } });
  });

  it("retains detailed prompts when a later compact poll omits them", () => {
    const detailed = snapshot("running", 1);
    detailed.nodes[0]!.request = { prompt: "Original", inputAssetIds: ["reference"] };
    const newer = snapshot("succeeded", 2);
    newer.nodes[0]!.request = { model: "model" };
    expect(reconcileRunSnapshot(detailed, newer).nodes[0]!.request).toMatchObject({ model: "model", prompt: "Original", inputAssetIds: ["reference"] });
  });

  it("accepts legacy snapshots with missing or invalid timestamps and never mixes distinct runs", () => {
    const previous = snapshot("failed", 1);
    const legacy = snapshot("running", 2);
    delete legacy.run.updatedAt;
    legacy.nodes[0]!.updatedAt = "invalid";
    expect(reconcileRunSnapshot(previous, legacy)).toEqual(legacy);
    const different = snapshot("running", 0);
    different.run.id = "other-run";
    expect(reconcileRunSnapshot(previous, different)).toBe(different);
  });
});
