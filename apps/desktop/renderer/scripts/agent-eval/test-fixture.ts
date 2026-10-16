import type { SelectionSnapshot } from "./fixture";
export function testSelection(): SelectionSnapshot {
  const capabilities = { text: true, imageInput: false, audioInput: false, videoInput: false,
    structuredOutput: true, toolCalling: false, nativeWebSearch: false, reasoning: false };
  return { schemaVersion: 1, selectedAt: "2026-10-16T00:00:00.000Z", selectionSource: "offline-unit-fixture",
    connection: { id: "eval-test-text", name: "虚构测试连接", provider: "openai", supplier: "offline fixture",
      baseUrl: "https://eval-text.invalid/v1", model: "eval-test-model", protocol: "openai-chat-completions",
      enabled: true, apiKey: "eval-only-placeholder-secret", capabilities },
    record: { id: "eval-test-text", name: "虚构测试连接", provider: "openai", encryptedSecret: "eval-encrypted-placeholder",
      createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z",
      config: { baseUrl: "https://eval-text.invalid/v1", usage: "agent", modelScanStatus: "live", scannedModelIds: ["eval-test-model"] } },
    option: { supplierId: "eval-test-supplier", supplierName: "虚构测试供应商", group: "fixture", connectionId: "eval-test-text",
      connectionName: "虚构测试连接", modelId: "eval-test-model", modelName: "虚构对话模型", protocol: "openai-chat-completions",
      available: true, source: "key", capabilities },
  };
}
