import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, schedule: vi.fn() }));
vi.mock("../../../lib/server", () => ({
  get repository() { return mocks.repository; },
  maskConnection: (connection: ProviderConnectionRecord) => ({ id: connection.id, config: connection.config }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  saveProviderConnection: async (input: { expected?: ProviderConnectionRecord; id: string; name: string; provider: string; config: ProviderConnectionRecord["config"] }) => {
    const current = await mocks.repository.getConnection(input.id);
    return mocks.repository.saveConnection({ id: input.id, name: input.name, provider: input.provider,
      config: input.config, encryptedSecret: current?.encryptedSecret }, { expected: input.expected });
  },
}));
vi.mock("../../../lib/supplier-verification", () => ({ scheduleSupplierVerification: mocks.schedule }));
import { GET, POST } from "./route";
import { legacySupplierId } from "../../../lib/supplier-service";

beforeEach(() => { mocks.repository = new MemoryRepository(); mocks.schedule.mockReset(); });
async function fixture() {
  await mocks.repository.saveSupplier({ id: "legacy-supplier", name: "Legacy account", supplierKey: "custom-account",
    siteUrl: "https://legacy.example.test", apiUrl: "https://legacy.example.test/v1", kind: "auto",
    catalog: { groups: [] }, scanStatus: "unscanned" });
  return mocks.repository.saveConnection({ id: "legacy-key", name: "Images", provider: "openai",
    encryptedSecret: "existing-encrypted-key", config: { supplierId: "legacy-supplier", supplierKey: "custom-account",
      baseUrl: "https://legacy.example.test/v1", modelGroup: "images", usage: "canvas", defaultModel: "before" } });
}
const save = (connection: ProviderConnectionRecord) => POST(new Request("http://localhost/api/providers", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    id: connection.id, name: connection.name, provider: connection.provider,
    config: { ...connection.config, defaultModel: "user-selected-model" },
  }),
}));

describe("first explicit legacy connection save", () => {
  it("projects the precise legacy account ID without assigning its Key to a same-site personal account", async () => {
    await fixture();
    const old = await mocks.repository.saveConnection({ id: "unbound-key", name: "Unbound", provider: "openai",
      encryptedSecret: "old-encrypted-key", config: { supplierKey: "custom-account", baseUrl: "https://legacy.example.test/v1", usage: "canvas" } });
    const before = mocks.repository.exportSnapshot();
    const rows = await (await GET()).json() as { id: string; config: ProviderConnectionRecord["config"] }[];
    expect(rows.find(row => row.id === old.id)?.config.supplierId).toBe(legacySupplierId(old));
    expect(rows.find(row => row.id === "legacy-key")?.config.supplierId).toBe("legacy-supplier");
    expect(mocks.repository.exportSnapshot()).toEqual(before);
    const projected = rows.find(row => row.id === old.id)!;
    expect((await save({ ...old, config: projected.config })).status).toBe(200);
    expect((await mocks.repository.getConnection(old.id))?.config.supplierId).toBe(legacySupplierId(old));
    expect((await mocks.repository.getConnection("legacy-key"))?.config.supplierId).toBe("legacy-supplier");
  });
  it("keeps GET read-only and saves successfully on the first attempt after atomic migration", async () => {
    const connection = await fixture(), before = mocks.repository.exportSnapshot();
    expect((await GET()).status).toBe(200);
    expect(mocks.repository.exportSnapshot()).toEqual(before);
    expect((await save(connection)).status).toBe(200);
    const supplier = await mocks.repository.getSupplier("legacy-supplier");
    expect(await mocks.repository.getConnection(connection.id)).toMatchObject({
      id: connection.id, encryptedSecret: connection.encryptedSecret, config: { ...connection.config,
        supplierSourceId: supplier!.state!.sourceId, defaultModel: "user-selected-model" },
    });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("does not absorb a concurrent edit into the migrated compare-and-swap baseline", async () => {
    const connection = await fixture();
    const commit = mocks.repository.commitSupplier.bind(mocks.repository);
    vi.spyOn(mocks.repository, "commitSupplier").mockImplementationOnce(async input => {
      const result = await commit(input);
      const migrated = (await mocks.repository.getConnection(connection.id))!;
      await mocks.repository.saveConnection({ ...migrated, config: { ...migrated.config, defaultModel: "concurrent-user-choice" } });
      return result;
    });
    expect((await save(connection)).status).toBe(409);
    expect((await mocks.repository.getConnection(connection.id))!.config.defaultModel).toBe("concurrent-user-choice");
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
