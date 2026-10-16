import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { Route } from "@playwright/test";
import type { AgentModelOption } from "../../lib/agent-models";

/** Explicit opt-in only; the ordinary soak keeps its existing small response. */
export function readAgentModelsMemoryBytes(value = process.env.P0_MEMORY_AGENT_MODELS_BYTES) {
  if (value === undefined || value === "" || value === "0") return 0;
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 4096 || bytes > 4 * 1024 * 1024)
    throw new Error("P0_MEMORY_AGENT_MODELS_BYTES must be 0 or an integer from 4096 to 4194304");
  return bytes;
}

/** Stable value + fresh browser JSON.parse on each ordinary five-second read. */
export function createAgentModelsMemoryPayload(bytes: number, connectionId: string) {
  if (readAgentModelsMemoryBytes(String(bytes)) !== bytes || bytes === 0) throw new Error("Agent model fixture requires nonzero bytes");
  const modelCount = Math.min(32, Math.max(1, Math.floor(bytes / 4096)));
  const items: AgentModelOption[] = Array.from({ length: modelCount }, (_, index) => ({
    supplierId: "p0-memory-synthetic-agent", supplierName: "隔离内存样本", supplierKey: "p0-memory-synthetic-agent",
    group: "offline-fake", connectionId, connectionName: "隔离 Fake", modelId: `p0-agent-model-${index}`,
    modelName: `隔离模型 ${index + 1}`, protocol: "openai-chat-completions", available: false,
    reason: "隔离样本只测目录显示", source: "catalog",
    description: "Synthetic stable model facts for local memory retention evidence; no remote endpoint or credential.",
    capabilities: { text: true, imageInput: false, audioInput: false, videoInput: false,
      structuredOutput: false, toolCalling: false, nativeWebSearch: false, reasoning: false },
    pricing: { kind: "token", currency: "USD", inputPerMillion: 0, outputPerMillion: 0,
      checkedAt: "2000-01-01T00:00:00.000Z", confidence: "snapshot" },
    metadata: {
      p0Synthetic: true, p0PayloadMarker: `P0_AGENT_MODEL_PAYLOAD_${String(index).padStart(4, "0")}_`,
      modalities: { input: ["text"], output: ["text"] }, limits: { contextWindow: 8192, maximumOutput: 1024 },
      conditions: [{ parameter: "mode", values: ["offline"], price: 0 }], p0RepeatedPayload: "",
    },
  }));
  const baseBytes = Buffer.byteLength(JSON.stringify(items));
  if (baseBytes > bytes) throw new Error("Agent fixture fixed structure exceeds requested byte budget");
  const remaining = bytes - baseBytes;
  const each = Math.floor(remaining / modelCount);
  for (const [index, item] of items.entries()) {
    // Per-model stable ASCII content avoids Unicode byte ambiguity, while each
    // HTTP JSON parse still constructs fresh response objects in the renderer.
    const length = each + (index === modelCount - 1 ? remaining % modelCount : 0);
    const token = `P0_AGENT_MODEL_PAYLOAD_${String(index).padStart(4, "0")}_`;
    item.metadata = { ...item.metadata, p0RepeatedPayload: token.repeat(Math.ceil(length / token.length)).slice(0, length) };
  }
  const body = JSON.stringify(items);
  if (Buffer.byteLength(body) !== bytes) throw new Error("Agent fixture payload size is not exact");
  // Do not return the items array. The worker retains one stable response string,
  // not a fresh copy per poll; the browser's ordinary fetch owns parsing.
  return { body, bytes, modelCount, sha256: createHash("sha256").update(body).digest("hex"),
    identity: "synthetic equal-valued AgentModelOption[]; metadata padding is deliberate and is not a real supplier contract",
    marker: "P0_AGENT_MODEL_PAYLOAD_", available: false, externalUrls: 0, credentials: 0 };
}

export function createAgentModelsMemoryResponder(bytes: number, connectionId: string, output: string) {
  const payload = createAgentModelsMemoryPayload(bytes, connectionId);
  const { body, ...manifest } = payload;
  const started = Date.now();
  const counters = { requests: 0, responses: 0, failed: 0, responseBytes: 0, firstAt: "", lastAt: "" };
  let writes = Promise.resolve();
  return {
    manifest,
    snapshot: () => ({ ...counters, payloadBytes: manifest.bytes, bodySha256: manifest.sha256 }),
    async handle(route: Route) {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname !== "/api/agent/models" || request.method() !== "GET") return false;
      const start = Date.now(); const timestamp = new Date(start).toISOString();
      const sequence = counters.requests++;
      if (!counters.firstAt) counters.firstAt = timestamp;
      counters.lastAt = timestamp;
      let success = false;
      try {
        await route.fulfill({ status: 200, body, contentType: "application/json; charset=utf-8", headers: { "Cache-Control": "no-store" } });
        counters.responses++; counters.responseBytes += manifest.bytes; success = true;
      } catch (error) { counters.failed++; throw error; }
      finally {
        const line = `${JSON.stringify({ sequence, timestamp, elapsedMs: start - started, category: "agentModels", success,
          responseBytes: success ? manifest.bytes : 0, bodySha256: manifest.sha256, fulfillmentDurationMs: Date.now() - start })}\n`;
        // Only this short scalar line is queued; no request/route/response object.
        writes = writes.then(() => appendFile(join(output, "agent-model-responses.jsonl"), line));
        await writes;
      }
      return true;
    },
    async flush() { await writes; },
  };
}
