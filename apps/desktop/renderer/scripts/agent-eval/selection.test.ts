import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { encryptSecret } from "@super-canvas/providers/credentials";
import { EVALUATION_TEMP, RENDERER_ROOT } from "./paths";
import { finalizeSelectionSnapshot, resolveIsolatedSelection, type ReadonlyConnectionSource } from "./selection";
import { writeExclusiveJson } from "./budget";
import { testSelection } from "./test-fixture";
afterEach(() => { vi.unstubAllGlobals(); });
function source(): ReadonlyConnectionSource {
  const snapshot = testSelection();
  return { record: { ...snapshot.record, encryptedSecret: encryptSecret(snapshot.connection.apiKey, "offline-master-key"), config: {
    ...snapshot.record.config, usage: "agent", modelScanStatus: "live", scannedModelIds: [snapshot.connection.model],
    modelCatalogModels: [{ id: snapshot.connection.model, name: "纯离线测试模型", operations: [], inputKinds: ["text"], outputKinds: ["text"],
      metadata: { inputKindsSource: "declared", outputKindsSource: "declared", agentProtocol: "chat-completions" } }],
  } }, modelId: snapshot.connection.model, masterKey: "offline-master-key", capturedAt: snapshot.selectedAt, selectionSource: "offline-test" };
}
it("resolves the exact saved choice with existing model logic without network", async () => {
  const snapshot = await resolveIsolatedSelection(source(), join(RENDERER_ROOT, "lib"));
  expect(snapshot.connection.model).toBe(testSelection().connection.model);
  expect(snapshot.connection.apiKey).toBe(testSelection().connection.apiKey);
  await expect(resolveIsolatedSelection({ ...source(), modelId: "not-in-saved-directory" }, join(RENDERER_ROOT, "lib"))).rejects.toThrow("停止");
});
it("writes the isolated snapshot once and refuses overwrite before any second source read", async () => {
  mkdirSync(EVALUATION_TEMP, { recursive: true });
  const directory = mkdtempSync(join(EVALUATION_TEMP, "selection-test-"));
  writeExclusiveJson(join(directory, "source.secret.json"), source());
  await finalizeSelectionSnapshot(directory, join(RENDERER_ROOT, "lib"));
  await expect(finalizeSelectionSnapshot(directory, join(RENDERER_ROOT, "lib"))).rejects.toThrow("已存在");
});
