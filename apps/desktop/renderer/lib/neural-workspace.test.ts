import { describe, expect, it } from "vitest";
import {
  adaptWorkspaceData,
  buildWorkspaceIndex,
  INITIAL_WORKSPACE,
  nextWorkspaceTitle,
  searchWorkspace,
  sortWorkspaceProjects,
  umbrellaCurve,
  workspaceCount,
  workspaceTransition,
} from "./neural-workspace";
import {
  saveWorkspaceAgentDraft,
  takeWorkspaceAgentDraft,
} from "./workspace-agent-draft";
import type { ProviderConnectionView } from "./client-api";
import type { SupplierRecord } from "./client-suppliers";

const projects = [
  {
    id: "a",
    title: "秋日",
    createdAt: "2026-09-01",
    updatedAt: "2026-10-01",
    nodeCount: 12,
  },
  { id: "b", title: "春光", createdAt: "2026-09-02", updatedAt: "2026-09-20" },
];
const model = {
  id: "full-image-2.5-4K",
  name: "完整图像型号",
  operations: ["image.generate" as const],
  outputKinds: ["image" as const],
};
const connection: ProviderConnectionView = {
  id: "key1",
  name: "绘图",
  provider: "openai",
  config: {
    supplierId: "s1",
    modelGroup: "gold",
    modelCatalogModels: [model],
    modelScanStatus: "live",
  },
  apiKeySet: true,
  apiKeyUsable: true,
  apiKey: "",
};
const supplier: SupplierRecord = {
  id: "s1",
  name: "星光",
  supplierKey: "custom-light",
  kind: "auto",
  siteUrl: "https://example.invalid",
  apiUrl: "",
  scanStatus: "live",
  catalog: {
    groups: [
      {
        id: "gold",
        label: "金色组",
        models: [{ id: model.id, capability: "image" }],
      },
    ],
  },
  createdAt: "2026-09-01",
  updatedAt: "2026-10-01",
};

describe("workspace navigation", () => {
  it("returns item → module → hub without carrying stale selection", () => {
    const selected = workspaceTransition(INITIAL_WORKSPACE, {
      type: "item",
      module: "canvases",
      id: "a",
    });
    expect(workspaceTransition(selected, { type: "back" })).toEqual({
      level: "module",
      module: "canvases",
      itemId: null,
    });
    expect(
      workspaceTransition(workspaceTransition(selected, { type: "back" }), {
        type: "back",
      }),
    ).toEqual(INITIAL_WORKSPACE);
    expect(
      workspaceTransition(selected, { type: "module", module: "suppliers" }),
    ).toEqual({ level: "module", module: "suppliers", itemId: null });
  });
  it("sorts deterministically without mutating persisted data", () => {
    expect(
      sortWorkspaceProjects(projects, "", "recent").map((p) => p.id),
    ).toEqual(["a", "b"]);
    expect(
      sortWorkspaceProjects(projects, "", "created").map((p) => p.id),
    ).toEqual(["b", "a"]);
    expect(sortWorkspaceProjects(projects, " 秋日 ", "name")).toHaveLength(1);
    expect(projects[0].id).toBe("a");
    expect(
      nextWorkspaceTitle("创作对话", [{ ...projects[0], title: "创作对话. " }]),
    ).toBe("创作对话 2");
  });
});
describe("read-only projections and search", () => {
  it("does not fabricate missing totals, balance or prices", () => {
    const result = adaptWorkspaceData(projects, [supplier], [connection]);
    expect(result.counts.nodes).toBeUndefined();
    expect(result.counts.models).toBe(1);
    expect(result.suppliers[0].balance).toBe("—");
    expect(
      result.suppliers[0].groups[0].models[0].descriptor.pricing,
    ).toBeUndefined();
    expect(workspaceCount(undefined)).toBe("—");
    expect(workspaceCount(-1)).toBe("—");
    expect(adaptWorkspaceData(null, null, null).counts.models).toBeUndefined();
  });
  it("never counts a public-only catalogue as Key availability or borrows between groups", () => {
    const publicConnection = {
      ...connection,
      config: {
        ...connection.config,
        modelGroup: "silver",
        modelCatalogModels: [
          { ...model, metadata: { publicCatalogOnly: true } },
        ],
      },
    };
    const result = adaptWorkspaceData([], [supplier], [publicConnection]);
    expect(result.counts.models).toBe(0);
    expect(
      result.suppliers[0].groups.find((g) => g.id === "gold")?.models[0]
        .available,
    ).toBe(false);
    expect(result.suppliers[0].groups).toHaveLength(2);
  });
  it("indexes complete model IDs and ranks titles above metadata", () => {
    const data = adaptWorkspaceData(projects, [supplier], [connection]);
    const index = buildWorkspaceIndex(projects, data);
    expect(searchWorkspace(index, "full-image-2.5-4K")[0]).toMatchObject({
      module: "suppliers",
      itemId: "s1",
      title: model.id,
    });
    expect(searchWorkspace(index, "图片型号")).toHaveLength(1);
    expect(searchWorkspace(index, "  ")).toEqual([]);
    expect(searchWorkspace(index, "秋日")[0].itemId).toBe("a");
    expect(searchWorkspace(index, "星光 金色组")[0].kind).toBe("model");
  });
  it("projects personal account state from saved CLI evidence", () => {
    const account = {
      ...connection,
      provider: "cli",
      config: {
        cli: { enabled: true, executable: "tool" },
        cliStatus: { state: "ready" },
        modelCatalogModels: [model],
      },
    };
    expect(adaptWorkspaceData([], [], [account]).accounts[0]).toMatchObject({
      ready: true,
      status: "已就绪",
    });
  });
  it("uses stable group identity before a stale label, without duplicating bound groups", () => {
    const directory = {
      ...supplier,
      catalog: {
        groups: [
          {
            id: "gold",
            label: "旧组",
            supplierGroupId: "001",
            models: [
              {
                id: model.id,
                capability: "image" as const,
                priceLabel: "旧组价格",
              },
            ],
          },
          {
            id: "silver",
            label: "新组",
            supplierGroupId: "002",
            models: [
              {
                id: model.id,
                capability: "image" as const,
                priceLabel: "新组价格",
              },
            ],
          },
        ],
      },
    };
    const key = {
      ...connection,
      config: {
        ...connection.config,
        modelGroup: "gold",
        accountKeyGroupId: "002",
      },
    };
    const result = adaptWorkspaceData([], [directory], [key]);
    expect(result.suppliers[0].groups).toHaveLength(2);
    expect(result.suppliers[0].groups[0].models[0].available).toBe(false);
    expect(result.suppliers[0].groups[1].models[0].available).toBe(true);
    expect(
      result.suppliers[0].groups[1].models[0].descriptor.metadata?.priceLabel,
    ).toBe("新组价格");
    expect(result.counts.models).toBe(1);
  });
  it("keeps an unmatched stable ID separate from a matching display name", () => {
    const key = {
      ...connection,
      config: { ...connection.config, accountKeyGroupId: "another-stable-id" },
    };
    const result = adaptWorkspaceData([], [supplier], [key]);
    expect(result.suppliers[0].groups).toHaveLength(2);
    expect(result.suppliers[0].groups[0].models[0].available).toBe(false);
    expect(result.suppliers[0].groups[1]).toMatchObject({
      id: "another-stable-id",
      supplierGroupId: "another-stable-id",
    });
  });
  it("does not use a catalogue UI ID when a different official stable ID exists", () => {
    const directory = {
      ...supplier,
      catalog: {
        groups: [
          { ...supplier.catalog.groups[0], supplierGroupId: "official-gold" },
        ],
      },
    };
    const key = {
      ...connection,
      config: { ...connection.config, accountKeyGroupId: "gold" },
    };
    const result = adaptWorkspaceData([], [directory], [key]);
    expect(result.suppliers[0].groups[0].models[0].available).toBe(false);
    expect(result.suppliers[0].groups[1].id).toBe("saved:id:gold");
  });
  it("only binds a legacy label when it resolves to exactly one catalogue group", () => {
    const directory = {
      ...supplier,
      catalog: {
        groups: [
          { id: "a", label: "重复名称", supplierGroupId: "001", models: [] },
          { id: "b", label: "重复名称", supplierGroupId: "002", models: [] },
        ],
      },
    };
    const key = {
      ...connection,
      config: { ...connection.config, modelGroup: "重复名称" },
    };
    const result = adaptWorkspaceData([], [directory], [key]);
    expect(result.suppliers[0].groups[0].models).toEqual([]);
    expect(result.suppliers[0].groups[1].models).toEqual([]);
    expect(result.suppliers[0].groups[2].models[0].available).toBe(true);
  });
  it("does not reattach models rejected by supplier source identity", () => {
    const directory = {
      ...supplier,
      state: { sourceId: "current-source" },
    } as SupplierRecord;
    const key = {
      ...connection,
      config: { ...connection.config, supplierSourceId: "old-source" },
    };
    const result = adaptWorkspaceData([], [directory], [key]);
    expect(result.suppliers).toHaveLength(1);
    expect(result.suppliers[0].groups).toHaveLength(1);
    expect(result.suppliers[0].groups[0].models[0].available).toBe(false);
    expect(result.counts.models).toBe(0);
  });
  it("keeps same-label orphan groups with different stable IDs separate", () => {
    const keys = ["001", "002"].map((accountKeyGroupId, i) => ({
      ...connection,
      id: `key-${i}`,
      config: {
        ...connection.config,
        supplierId: "orphan",
        accountKeyGroupId,
        modelGroup: "同名",
      },
    }));
    const result = adaptWorkspaceData([], [], keys);
    expect(result.suppliers[0].groups.map((g) => g.supplierGroupId)).toEqual([
      "001",
      "002",
    ]);
    expect(result.counts.models).toBe(2);
  });
  it("indexes every saved personal model by full ID and opens its owning account", () => {
    const account = {
      ...connection,
      id: "personal-1",
      provider: "cli",
      config: { modelCatalogModels: [model] },
    };
    const result = searchWorkspace(
      buildWorkspaceIndex([], adaptWorkspaceData([], [], [account])),
      model.id,
    );
    expect(result[0]).toMatchObject({
      id: `account-model:personal-1:${model.id}`,
      module: "accounts",
      kind: "model",
      itemId: "personal-1",
    });
  });
});
it("generates finite umbrella geometry", () => {
  expect(umbrellaCurve({ x: 20, y: 50 }, { x: 400, y: 10 })).toMatch(
    /^M 20 50 C /,
  );
  expect(umbrellaCurve({ x: 20, y: 50 }, { x: 0, y: 0 })).not.toContain("NaN");
});
it("transfers a draft once and keeps project identity isolated", () => {
  const data = new Map<string, string>();
  const storage = {
    setItem: (key: string, value: string) => data.set(key, value),
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  saveWorkspaceAgentDraft("a", "先聊想法", storage);
  expect(takeWorkspaceAgentDraft("b", storage)).toBe("");
  expect(takeWorkspaceAgentDraft("a", storage)).toBe("先聊想法");
  expect(takeWorkspaceAgentDraft("a", storage)).toBe("");
});
