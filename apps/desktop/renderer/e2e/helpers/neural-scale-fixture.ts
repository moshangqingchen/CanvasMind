import type { ProviderConnectionView, ProjectSummaryView } from "../../lib/client-api";
import type { SupplierRecord } from "../../lib/client-suppliers";
import { neuralConnections } from "./neural-fixture";

/** Synthetic acceptance data only. No source profile, live connection or persisted session is read. */
export function neuralScaleFixture(extreme = false) {
  const supplierCount = extreme ? 50 : 18, modelCount = extreme ? 10000 : 2646;
  const connectionCount = extreme ? 200 : 180, projectCount = extreme ? 200 : 4;
  const timestamp = "2026-10-16T09:00:00.000Z";
  const suppliers: SupplierRecord[] = [], connections: ProviderConnectionView[] = [];
  let modelSerial = 0;
  for (let supplierIndex = 0; supplierIndex < supplierCount; supplierIndex++) {
    const id = `scale-supplier-${supplierIndex}`, name = `创作渠道 ${String(supplierIndex + 1).padStart(2, "0")}`;
    const ownedModels = Math.floor(modelCount / supplierCount) + (supplierIndex < modelCount % supplierCount ? 1 : 0);
    const ownedConnections = Math.floor((connectionCount - 2) / supplierCount) + (supplierIndex < (connectionCount - 2) % supplierCount ? 1 : 0);
    const supplier: SupplierRecord = { ...structuredClone(neuralSupplierTemplate()), id, name, supplierKey: id, siteUrl: `https://${id}.invalid`, apiUrl: `https://${id}.invalid/v1`, catalog: { groups: [] } };
    for (let groupIndex = 0; groupIndex < ownedConnections; groupIndex++) {
      const groupId = `group-${groupIndex}`, count = Math.floor(ownedModels / ownedConnections) + (groupIndex < ownedModels % ownedConnections ? 1 : 0);
      const models = Array.from({ length: count }, () => ({ id: `scale-image-${++modelSerial}`, name: `图片型号 ${modelSerial}`, capability: "image" as const, protocol: "openai-images" as const }));
      supplier.catalog.groups.push({ id: groupId, label: `分组 ${groupIndex + 1}`, supplierGroupId: groupId, source: "catalog", models });
      connections.push({ id: `${id}-${groupId}`, name: `${name} ${groupId}`, provider: "openai", apiKey: "", apiKeySet: true, config: { supplierId: id, supplierKey: id, baseUrl: supplier.apiUrl, modelGroup: groupId, accountKeyGroupId: groupId, usage: "canvas", modelScanStatus: "live", modelScanLastSuccessAt: timestamp, modelCatalogModels: models.map(model => ({ id: model.id, name: model.name, operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"] })) } });
    }
    suppliers.push(supplier);
  }
  connections.push(...structuredClone(neuralConnections.filter(connection => connection.provider === "cli")));
  const projects: ProjectSummaryView[] = Array.from({ length: projectCount }, (_, i) => ({ id: `scale-canvas-${i}`, title: `视觉工作 ${String(i + 1).padStart(3, "0")}`, nodeCount: extreme ? i % 14 : [12, 9, 8, 8][i], createdAt: timestamp, updatedAt: timestamp }));
  return { projects, suppliers, connections, counts: { suppliers: supplierCount, models: modelCount, connections: connectionCount, projects: projectCount, nodes: extreme ? projects.reduce((n, project) => n + (project.nodeCount ?? 0), 0) : 37 } };
}

function neuralSupplierTemplate(): SupplierRecord {
  const timestamp = "2026-10-16T09:00:00.000Z";
  return { id: "", name: "", supplierKey: "", kind: "openai-compatible", siteUrl: "", apiUrl: "", catalog: { groups: [] }, scanStatus: "live", scannedAt: timestamp, scanLastSuccessAt: timestamp, createdAt: timestamp, updatedAt: timestamp };
}
