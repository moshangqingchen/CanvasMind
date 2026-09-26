import type { ProviderConnectionRecord } from "@super-canvas/db";
import { parseProviderModelFacts, type ModelDescriptor } from "@super-canvas/providers";
import { agentModelEvidenceFingerprint, agentRecord, isAgentTextModel, officialAgentReasoning } from "./agent-model-capabilities";
import { readSupplierDocument } from "./supplier-document";

type Facts = ReturnType<typeof parseProviderModelFacts>;
const emptyFacts = (): Facts => ({ metadata: {} });
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** A shared page can describe many models. Only exact model records/sections apply. */
export function agentDocumentFacts(model: ModelDescriptor, document: string | undefined, sourceUrl: string): Facts {
  if (!document) return emptyFacts();
  const records: Record<string, unknown>[] = [];
  let visited = 0;
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8 || ++visited > 2000) return;
    if (Array.isArray(value)) { value.slice(0, 200).forEach(item => visit(item, depth + 1)); return; }
    const record = agentRecord(value);
    if (record.id === model.id || record.model === model.id || record.model_name === model.id) records.push(record);
    for (const [key, child] of Object.entries(record)) {
      if (key === model.id && child && typeof child === "object") records.push(agentRecord(child));
      else if (child && typeof child === "object") visit(child, depth + 1);
    }
  };
  try { visit(JSON.parse(document)); } catch { /* Plain documentation is data too. */ }
  const escaped = model.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const exact = new RegExp(`(?<![a-z0-9_.-])${escaped}(?![a-z0-9_.-])`, "iu");
  const lines = document.split(/\r?\n/u);
  const scoped: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!exact.test(line)) continue;
    scoped.push(line);
    const heading = /^(#{1,6})\s/u.exec(line.trim());
    if (heading) for (let j = i + 1; j < lines.length; j++) {
      const nextHeading = /^(#{1,6})\s/u.exec(lines[j]!.trim());
      if (nextHeading && nextHeading[1]!.length <= heading[1]!.length) break;
      scoped.push(lines[j]!);
    }
  }
  if (!scoped.length) {
    try {
      if (decodeURIComponent(new URL(sourceUrl).pathname).split("/").some(segment => segment === model.id)) scoped.push(document);
    } catch { /* A malformed URL cannot establish model scope. */ }
  }
  const prose = scoped.join("\n");
  const mapped = [...prose.matchAll(/(?:官方型号|官方模型|原厂型号|上游型号|实际型号|对应(?:的)?(?:官方)?(?:模型|型号)|official[_ ]model(?:[_ ]id)?|upstream[_ ]model(?:[_ ]id)?|base_model|actual_model|alias_for)\s*[:：=]\s*[`"']?([a-z][a-z0-9./_-]{1,127})/giu)].map(match => match[1]!);
  const facts = records.map(record => parseProviderModelFacts(record));
  facts.push(parseProviderModelFacts({ description: prose, officialModelCandidates: mapped }));
  return mergeFacts(facts);
}

/** Earlier, more specific declarations win; identities remain conflict-aware. */
function mergeFacts(facts: Facts[]): Facts {
  const metadata = Object.assign({}, ...[...facts].reverse().map(fact => fact.metadata));
  const candidates = [...new Set(facts.flatMap(fact => strings(fact.metadata.officialModelCandidates)))];
  const options = facts.find(fact => Array.isArray(fact.metadata.reasoningOptions) && fact.metadata.reasoningOptions.length)?.metadata;
  return {
    limits: Object.assign({}, ...[...facts].reverse().map(fact => fact.limits)),
    metadata: { ...metadata,
      agentCapabilities: Object.assign({}, ...[...facts].reverse().map(fact => agentRecord(fact.metadata.agentCapabilities))),
      ...(options ? { reasoningOptions: options.reasoningOptions, reasoningOptionsSource: options.reasoningOptionsSource } : {}),
      ...(candidates.length ? { officialModelCandidates: candidates } : {}),
    },
  };
}

/** Free supplier/linked-document reads only. Never invoke a chat or image model. */
export async function discoverAgentModelCapabilities(connection: ProviderConnectionRecord, models: readonly ModelDescriptor[],
  read = readSupplierDocument): Promise<ModelDescriptor[]> {
  if (connection.config.usage === "disabled" || connection.config.supplierArchived === true) return [...models];
  const siteUrl = String(connection.config.supplierWebsiteUrl ?? connection.config.baseUrl ?? "");
  const result: ModelDescriptor[] = [];
  // Sequential model reads bound concurrency; the shared reader caches URLs.
  for (const model of models) {
    if (!isAgentTextModel(model)) { result.push(model); continue; }
    const api = parseProviderModelFacts(model as unknown as Record<string, unknown>);
    const catalogRaw = agentRecord(model.metadata?.supplierAgentFacts);
    const catalog: Facts = { metadata: agentRecord(catalogRaw.metadata), limits: catalogRaw.limits as Facts["limits"] };
    const localDescription = [model.description, model.metadata?.supplierChannelDescription, model.metadata?.supplierAgentDescription]
      .filter(value => typeof value === "string").map(value => `${model.id}: ${value}`).join("\n");
    const local = agentDocumentFacts(model, localDescription, siteUrl);
    const sourceUrl = String(model.metadata?.documentationUrl ?? model.metadata?.docsUrl ?? siteUrl);
    const linkedModel = { ...model, metadata: { ...model.metadata, documentationUrl: sourceUrl } };
    const document = await read(siteUrl, linkedModel);
    const documented = agentDocumentFacts(model, document, sourceUrl);
    const facts = mergeFacts([api, catalog, local, documented]);
    const candidates = strings(facts.metadata.officialModelCandidates);
    const officialModelId = candidates.length ?
      (candidates.length === 1 && officialAgentReasoning(candidates[0]!) ? candidates[0] : undefined) :
      officialAgentReasoning(model.id) ? model.id : undefined;
    const declared = Array.isArray(facts.metadata.reasoningOptions) && facts.metadata.reasoningOptions.length > 0;
    const denied = agentRecord(facts.metadata.agentCapabilities).reasoning === false;
    const reason = declared || denied || officialModelId ? undefined : candidates.length > 1
      ? "渠道对应多个官方型号，尚无明确的共同思考档位"
      : candidates.length === 1 ? `已确认上游型号 ${candidates[0]}，尚未取得该型号的官方思考档位`
      : document === undefined ? "渠道未提供思考档位；文档未能读取，尚未确认官方型号"
      : "已查渠道资料，仍缺少思考档位及明确的官方型号映射";
    result.push({ ...model, limits: { ...model.limits, ...facts.limits }, metadata: { ...model.metadata, ...facts.metadata,
      agentDiscovery: {
        fingerprint: agentModelEvidenceFingerprint(connection), checkedAt: new Date().toISOString(),
        status: reason ? "incomplete" : "complete", ...(reason ? { reason } : {}),
        ...(officialModelId ? { officialModelId } : {}), sourceUrl,
        mappingSource: officialModelId === model.id ? "exact-model-id" : api.metadata.officialModelCandidates ? "model-api"
          : catalog.metadata.officialModelCandidates ? "supplier-catalog" : "supplier-document",
        mappingCandidates: candidates,
      },
    } });
  }
  return result;
}
