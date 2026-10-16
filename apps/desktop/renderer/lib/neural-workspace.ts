import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProjectSummaryView, ProviderConnectionView } from "./client-api";
import {
  supplierOwnsConnection,
  type SupplierRecord,
} from "./client-suppliers";
import { cliConnectionReady, cliStatusLabel } from "./cli-connections";
import { modelDescriptorsFromConnectionConfig } from "./model-parameters";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerConnectionSupplierLabel,
  providerConnectionSupplierWebsite,
  providerConnectionUsage,
} from "./provider-connection-options";
import {
  supplierBillingForDisplay,
  billingAmount,
} from "./supplier-billing-display";
import { workspaceProjectStatistics } from "./workspace-home-presentation";
import type { NeuralModule } from "./neural-tokens";

export const WORKSPACE_MODULES = {
  canvases: { label: "画布", english: "CANVASES" },
  suppliers: { label: "供应商", english: "SUPPLIERS" },
  accounts: { label: "个人账号", english: "ACCOUNTS" },
  starts: { label: "快速开始", english: "STARTS" },
} as const;
export const QUICK_STARTS = [
  {
    id: "chat",
    title: "聊聊创作想法",
    description: "从一句灵感开始",
    english: "CREATIVE CHAT",
  },
  {
    id: "event-poster",
    title: "做活动海报",
    description: "从主题到完整视觉",
    english: "EVENT POSTER",
  },
  {
    id: "revise",
    title: "修改客户原图",
    description: "保留原图，精准调整",
    english: "IMAGE REVISION",
  },
  {
    id: "event-material",
    title: "制作多尺寸物料",
    description: "一套设计，多种规格",
    english: "DESIGN SYSTEM",
  },
  {
    id: "blank",
    title: "空白画布",
    description: "让新的想法有个落点",
    english: "BLANK CANVAS",
  },
] as const;
export type WorkspaceState =
  | { level: "hub"; module: null; itemId: null }
  | { level: "module"; module: NeuralModule; itemId: null }
  | { level: "item"; module: NeuralModule; itemId: string };
export type WorkspaceAction =
  | { type: "module"; module: NeuralModule }
  | { type: "item"; module: NeuralModule; id: string }
  | { type: "back" }
  | { type: "home" };
export const INITIAL_WORKSPACE: WorkspaceState = {
  level: "hub",
  module: null,
  itemId: null,
};
export function workspaceTransition(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  if (action.type === "home") return INITIAL_WORKSPACE;
  if (action.type === "module")
    return { level: "module", module: action.module, itemId: null };
  if (action.type === "item")
    return { level: "item", module: action.module, itemId: action.id };
  return state.level === "item"
    ? { level: "module", module: state.module, itemId: null }
    : INITIAL_WORKSPACE;
}
export type WorkspaceSort = "recent" | "created" | "name";
export function sortWorkspaceProjects(
  projects: readonly ProjectSummaryView[],
  query: string,
  order: WorkspaceSort,
) {
  const needle = normalize(query);
  return projects
    .filter((p) => normalize(p.title).includes(needle))
    .sort(
      (a, b) =>
        (order === "name"
          ? a.title.localeCompare(b.title, "zh-CN")
          : order === "created"
            ? b.createdAt.localeCompare(a.createdAt)
            : b.updatedAt.localeCompare(a.updatedAt)) ||
        a.id.localeCompare(b.id),
    );
}
export function nextWorkspaceTitle(
  label: string,
  projects: readonly ProjectSummaryView[],
) {
  const titles = new Set(
    projects.map((p) =>
      p.title
        .trim()
        .replace(/[. ]+$/gu, "")
        .normalize("NFC"),
    ),
  );
  let title = label;
  for (let index = 2; titles.has(title); index++) title = `${label} ${index}`;
  return title;
}
export interface WorkspaceModel {
  id: string;
  descriptor: ModelDescriptor;
  available: boolean;
}
export interface WorkspaceSupplier {
  id: string;
  title: string;
  siteUrl?: string;
  status: string;
  refreshedAt?: string;
  balance: string;
  groups: Array<{
    id: string;
    label: string;
    supplierGroupId?: string;
    models: WorkspaceModel[];
  }>;
}
export interface WorkspaceAccount {
  id: string;
  title: string;
  status: string;
  ready: boolean;
  models: ModelDescriptor[];
}
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : undefined;

function savedGroupIdentity(connection: ProviderConnectionView) {
  const stable = text(connection.config.accountKeyGroupId)?.trim();
  return stable
    ? `id:${stable}`
    : `legacy:${providerConnectionGroup(connection)}`;
}

function mergeWorkspaceModels(
  target: WorkspaceModel[],
  connection: ProviderConnectionView,
) {
  for (const model of modelDescriptorsFromConnectionConfig(connection.config)) {
    const existing = target.find((entry) => entry.id === model.id);
    const available =
      connection.apiKeySet &&
      connection.apiKeyUsable !== false &&
      providerConnectionUsage(connection) !== "disabled" &&
      model.metadata?.publicCatalogOnly !== true;
    const descriptor = existing
      ? {
          ...existing.descriptor,
          ...model,
          pricing: model.pricing ?? existing.descriptor.pricing,
          metadata: {
            ...existing.descriptor.metadata,
            ...model.metadata,
            priceLabel:
              model.metadata?.priceLabel ??
              existing.descriptor.metadata?.priceLabel,
          },
        }
      : model;
    if (existing) {
      existing.descriptor = descriptor;
      existing.available ||= available;
    } else target.push({ id: model.id, descriptor, available });
  }
}
/** A projection of saved records only. No probing, requests, writes or inferred capabilities. */
export function adaptWorkspaceData(
  projects: readonly ProjectSummaryView[] | null,
  suppliers: readonly SupplierRecord[] | null,
  connections: readonly ProviderConnectionView[] | null,
) {
  const providers = (connections ?? []).filter(
    (c) => c.provider !== "cli" && c.config.supplierArchived !== true,
  );
  const used = new Set<string>();
  const cards: WorkspaceSupplier[] = (suppliers ?? [])
    .filter((s) => s.state?.visibility !== "deleted")
    .map((s) => {
      const owned = providers.filter((c) => supplierOwnsConnection(s, c));
      owned.forEach((c) => used.add(c.id));
      const boundGroups = new Map(
        owned.map((connection) => {
          const stable = text(connection.config.accountKeyGroupId)?.trim();
          const legacy = providerConnectionGroup(connection);
          const candidates = s.catalog.groups.filter((group) =>
            stable
              ? (text(group.supplierGroupId)?.trim() ?? group.id) === stable
              : group.id === legacy || group.label === legacy,
          );
          return [
            connection.id,
            candidates.length === 1 ? candidates[0] : undefined,
          ];
        }),
      );
      const billing = supplierBillingForDisplay(
        s,
        s.state?.billing?.sourceId === s.state?.sourceId
          ? s.state?.billing
          : undefined,
      );
      const groups: WorkspaceSupplier["groups"] = s.catalog.groups.map(
        (group) => {
          const bound = owned.filter((c) => boundGroups.get(c.id) === group);
          const models = new Map<string, WorkspaceModel>();
          for (const model of group.models)
            models.set(model.id, {
              id: model.id,
              available: false,
              descriptor: {
                id: model.id,
                name: model.name ?? model.id,
                operations: [],
                inputKinds: model.inputKinds,
                outputKinds: model.outputKinds,
                metadata: {
                  ...model.metadata,
                  priceLabel: model.priceLabel ?? model.metadata?.priceLabel,
                },
              },
            });
          const entries = [...models.values()];
          for (const connection of bound)
            mergeWorkspaceModels(entries, connection);
          return {
            id: group.id,
            label: group.label,
            supplierGroupId: group.supplierGroupId,
            models: entries,
          };
        },
      );
      // Preserve saved connections whose group has not entered the supplier directory yet.
      const savedGroups = new Map<
        string,
        WorkspaceSupplier["groups"][number]
      >();
      for (const c of owned) {
        const label = providerConnectionGroup(c);
        if (boundGroups.get(c.id)) continue;
        const identity = savedGroupIdentity(c);
        let group = savedGroups.get(identity);
        if (!group) {
          const stable = text(c.config.accountKeyGroupId)?.trim();
          const id = stable ?? label;
          group = {
            id: groups.some((entry) => entry.id === id)
              ? `saved:${identity}`
              : id,
            label,
            supplierGroupId: stable,
            models: [],
          };
          savedGroups.set(identity, group);
          groups.push(group);
        }
        mergeWorkspaceModels(group.models, c);
      }
      return {
        id: s.id,
        title: s.name,
        siteUrl: s.siteUrl,
        status:
          s.scanStatus === "live"
            ? "已保存目录"
            : s.scanStatus === "failed" || s.scanStatus === "unauthorized"
              ? "上次读取异常"
              : "待读取目录",
        refreshedAt: s.scanLastSuccessAt ?? s.scannedAt,
        balance:
          billing?.balance !== undefined
            ? billingAmount(
                billing.balance,
                billing.balanceUnit ?? billing.unit,
              )
            : "—",
        groups,
      };
    });
  for (const c of providers.filter((c) => !used.has(c.id))) {
    const savedSupplier = (suppliers ?? []).find(
      (s) => s.id === text(c.config.supplierId),
    );
    // Do not reattach a connection explicitly rejected by the current source identity.
    if (
      savedSupplier &&
      (!supplierOwnsConnection(savedSupplier, c) ||
        savedSupplier.state?.visibility === "deleted")
    )
      continue;
    const key = providerConnectionSupplierKey(c);
    const id = text(c.config.supplierId) ?? `template:${key}`;
    let card = cards.find((s) => s.id === id);
    if (!card) {
      card = {
        id,
        title: providerConnectionSupplierLabel(c),
        siteUrl: providerConnectionSupplierWebsite(c),
        balance: "—",
        status: "已保存连接",
        refreshedAt: text(c.config.modelScanLastSuccessAt),
        groups: [],
      };
      cards.push(card);
    }
    const label = providerConnectionGroup(c);
    const stable = text(c.config.accountKeyGroupId)?.trim();
    const identity = savedGroupIdentity(c);
    let group = card.groups.find((g) =>
      stable
        ? (g.supplierGroupId ?? g.id) === stable
        : !g.supplierGroupId && g.label === label,
    );
    if (!group) {
      group = {
        id: card.groups.some((g) => g.id === (stable ?? label))
          ? `saved:${identity}`
          : (stable ?? label),
        label,
        supplierGroupId: stable,
        models: [],
      };
      card.groups.push(group);
    }
    mergeWorkspaceModels(group.models, c);
  }
  const accounts: WorkspaceAccount[] = (connections ?? [])
    .filter((c) => c.provider === "cli")
    .map((c) => ({
      id: c.id,
      title: c.name,
      status: cliStatusLabel(c),
      ready: cliConnectionReady(c),
      models: modelDescriptorsFromConnectionConfig(c.config),
    }));
  return {
    suppliers: cards,
    accounts,
    counts: {
      canvases: projects?.length,
      nodes: projects ? workspaceProjectStatistics(projects).nodes : undefined,
      suppliers: suppliers && connections ? cards.length : undefined,
      models: connections
        ? cards.reduce(
            (n, s) =>
              n +
              s.groups.reduce(
                (g, v) => g + v.models.filter((m) => m.available).length,
                0,
              ),
            0,
          )
        : undefined,
      accounts: connections ? accounts.length : undefined,
      ready: connections ? accounts.filter((c) => c.ready).length : undefined,
      starts: QUICK_STARTS.length,
    },
  };
}
export interface WorkspaceSearchEntry {
  id: string;
  title: string;
  detail: string;
  module: NeuralModule;
  kind: "module" | "item" | "model";
  itemId?: string;
  terms?: string;
}
function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}
export function buildWorkspaceIndex(
  projects: readonly ProjectSummaryView[],
  data: ReturnType<typeof adaptWorkspaceData>,
): WorkspaceSearchEntry[] {
  const index: WorkspaceSearchEntry[] = Object.entries(WORKSPACE_MODULES).map(
    ([module, label]) => ({
      id: `module:${module}`,
      title: label.label,
      detail: label.english,
      module: module as NeuralModule,
      kind: "module",
    }),
  );
  for (const p of projects)
    index.push({
      id: `canvas:${p.id}`,
      title: p.title,
      detail: "画布 · CANVAS",
      module: "canvases",
      kind: "item",
      itemId: p.id,
    });
  for (const s of data.suppliers) {
    index.push({
      id: `supplier:${s.id}`,
      title: s.title,
      detail: "供应商 · SUPPLIER",
      module: "suppliers",
      kind: "item",
      itemId: s.id,
    });
    for (const g of s.groups)
      for (const m of g.models)
        index.push({
          id: `model:${s.id}:${g.id}:${m.id}`,
          title: m.id,
          detail: `${s.title} · ${g.label}`,
          module: "suppliers",
          kind: "model",
          itemId: s.id,
          terms: `${m.descriptor.name} ${m.descriptor.outputKinds?.join(" ") ?? ""} ${m.descriptor.outputKinds?.includes("image") ? "图片型号" : ""}`,
        });
  }
  for (const a of data.accounts) {
    index.push({
      id: `account:${a.id}`,
      title: a.title,
      detail: `${a.status} · ACCOUNT`,
      module: "accounts",
      kind: "item",
      itemId: a.id,
      terms: a.ready ? "就绪" : "未就绪的账号",
    });
    for (const model of a.models)
      index.push({
        id: `account-model:${a.id}:${model.id}`,
        title: model.id,
        detail: `${a.title} · ACCOUNT MODEL`,
        module: "accounts",
        kind: "model",
        itemId: a.id,
        terms: `${model.name} ${model.outputKinds?.join(" ") ?? ""} ${model.outputKinds?.includes("image") ? "图片型号" : ""}`,
      });
  }
  for (const q of QUICK_STARTS)
    index.push({
      id: `start:${q.id}`,
      title: q.title,
      detail: q.english,
      module: "starts",
      kind: "item",
      itemId: q.id,
    });
  return index;
}
export function searchWorkspace(
  index: readonly WorkspaceSearchEntry[],
  query: string,
  limit = 30,
) {
  const words = normalize(query).split(/\s+/u).filter(Boolean);
  if (!words.length) return [];
  return index
    .map((entry, position) => {
      const title = normalize(entry.title),
        corpus = `${title} ${normalize(entry.detail)} ${normalize(entry.terms ?? "")}`;
      const score = words.every((word) => corpus.includes(word))
        ? words.reduce(
            (n, word) =>
              n +
              (title === word
                ? 100
                : title.startsWith(word)
                  ? 30
                  : title.includes(word)
                    ? 10
                    : 1),
            0,
          )
        : 0;
      return { entry, score, position };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, limit)
    .map((hit) => hit.entry);
}
export function workspaceCount(value: number | undefined) {
  return value === undefined || !Number.isSafeInteger(value) || value < 0
    ? "—"
    : value.toLocaleString("zh-CN");
}
export function umbrellaCurve(
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const span = Math.max(40, end.x - start.x);
  return `M ${start.x} ${start.y} C ${start.x + span * 0.48} ${start.y}, ${end.x - span * 0.45} ${end.y}, ${end.x} ${end.y}`;
}
