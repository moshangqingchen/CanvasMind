import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { encryptSecret } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({ getSupplier: vi.fn(), saveConnection: vi.fn(), commitSupplier: vi.fn(), setApplicationSetting: vi.fn(),
  openSession: vi.fn(), providerFetch: vi.fn<typeof fetch>(), siteFetch: vi.fn<typeof fetch>(), unexpectedNetwork: vi.fn() }));
vi.mock("./server", () => ({ repository: { getSupplier: mocks.getSupplier, saveConnection: mocks.saveConnection,
  commitSupplier: mocks.commitSupplier, setApplicationSetting: mocks.setApplicationSetting } }));
vi.mock("./master-key", () => ({ requireServerMasterKey: () => "offline-langframe-inventory-master" }));
vi.mock("./supplier-site-session", () => ({ openSupplierSiteSession: mocks.openSession }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(), providerFetch: mocks.providerFetch }));

import { readLangframeKeyInventory } from "./langframe-inventory";

const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/langframe-catalog-20261018.json", import.meta.url), "utf8"));
const origin = "https://vipprompt.cn", apiKey = "offline-langframe-inventory-key-not-real";
const keyId = "707b2ab1-03f2-46d1-8217-b0b2693d2a71";
const publicNames: string[] = [...new Set<string>(fixture.payload.groups.flatMap((group: { models: Array<{ name: string }> }) => group.models.map(model => model.name)))];
let savedSupplier: SupplierRecord;
let connection: ProviderConnectionRecord;
let keyRows: Array<Record<string, unknown>>;
let keyStatus: number;
let directory: unknown;
let directoryStatus: number;
let publicCatalog: unknown;
let publicStatus: number;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  savedSupplier = { id: "wolf", supplierKey: "custom-wolf", name: "狼帧", siteUrl: origin, apiUrl: origin, kind: "auto",
    catalog: { groups: [] }, scanStatus: "live", createdAt: "before", updatedAt: "before",
    state: { version: 1, revision: 1, sourceId: "wolf-source", visibility: "visible", fingerprint: "wolf", history: [] } };
  connection = { id: "wolf-canvas", provider: "langframe", name: "Saved Key", encryptedSecret: encryptSecret(apiKey, "offline-langframe-inventory-master"),
    config: { supplierId: "wolf", supplierSourceId: "wolf-source", baseUrl: `${origin}/v1`, usage: "canvas", accountKeyId: keyId,
      langframeKeyScope: true, langframeAccountGroups: [], langframeModelIds: [], langframeRouting: "ordered-fallback",
      defaultModel: "old-user-choice", modelScanStatus: "live", modelCatalogModels: [{ id: "saved-before-scan" }],
      scannedModelIds: ["saved-before-scan"], savedUserValues: { resolution: "4K", quality: "max" } }, createdAt: "before", updatedAt: "before" };
  keyRows = [{ id: keyId, name: "saved", revoked: false, groups: [], models: [], token: apiKey }];
  keyStatus = 200; directoryStatus = 200; publicStatus = 200;
  directory = { object: "list", data: publicNames.map(id => ({ id, object: "model", owned_by: "langframe" })) };
  publicCatalog = structuredClone(fixture.payload);
  mocks.getSupplier.mockImplementation(async () => structuredClone(savedSupplier));
  mocks.openSession.mockImplementation(async () => ({ kind: "langframe", fetch: mocks.siteFetch }));
  mocks.siteFetch.mockImplementation(async (url, init) => {
    expect(init?.method).toBe("GET");
    if (String(url) === `${origin}/api/keys`) return Response.json({ ok: true, keys: keyRows }, { status: keyStatus });
    if (String(url) === `${origin}/api/relay/groups?stats=1`) return Response.json(publicCatalog, { status: publicStatus });
    throw Error("Unexpected site endpoint");
  });
  mocks.providerFetch.mockImplementation(async (url, init) => {
    expect(String(url)).toBe(`${origin}/v1/models`);
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
    return Response.json(directory, { status: directoryStatus });
  });
  mocks.unexpectedNetwork.mockRejectedValue(Error("Real HTTP and paid requests are forbidden"));
  vi.stubGlobal("fetch", mocks.unexpectedNetwork);
});
afterEach(() => {
  expect(mocks.saveConnection).not.toHaveBeenCalled();
  expect(mocks.commitSupplier).not.toHaveBeenCalled();
  expect(mocks.setApplicationSetting).not.toHaveBeenCalled();
  expect(mocks.unexpectedNetwork).not.toHaveBeenCalled();
  for (const [, init] of [...mocks.siteFetch.mock.calls, ...mocks.providerFetch.mock.calls]) expect(init?.method).toBe("GET");
  vi.unstubAllGlobals();
});

describe("Langframe current-Key inventory with independent live sources", () => {
  it("reads the real UUID Key, authenticated model directory and public capabilities before intersecting permissions", async () => {
    keyRows[0]!.groups = ["nano-banana-2", "下游分组2"];
    keyRows[0]!.models = ["nano-banana-2", "gpt-5.6-sol", "image-2-1K 0.04"];
    const before = JSON.stringify(connection), beforeSupplier = JSON.stringify(savedSupplier);
    const result = await readLangframeKeyInventory(connection);
    expect(result.models.map(model => model.id)).toEqual(["nano-banana-2"]);
    expect(result.models[0]?.provider).toBe("langframe");
    expect(result.permissionConfig).toEqual({ accountKeyId: keyId, langframeAccountGroups: ["nano-banana-2", "下游分组2"],
      langframeModelIds: ["nano-banana-2", "gpt-5.6-sol", "image-2-1K 0.04"], langframeRouting: "ordered-fallback" });
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mocks.siteFetch.mock.calls.map(([url]) => String(url))).toEqual([`${origin}/api/keys`, `${origin}/api/relay/groups?stats=1`]);
    expect(mocks.providerFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(JSON.stringify(connection)).toBe(before);
    expect(JSON.stringify(savedSupplier)).toBe(beforeSupplier);
  });

  it("retains fallback-order evidence and avoids assigning a single group's chat tariff", async () => {
    connection.config.usage = "agent";
    keyRows[0]!.groups = ["下游分组2", "下游分组1"];
    keyRows[0]!.models = ["gpt-5.6-sol"];
    const result = await readLangframeKeyInventory(connection);
    expect(result.models.map(model => model.id)).toEqual(["gpt-5.6-sol"]);
    expect(result.models[0]?.pricing).toBeUndefined();
    expect(result.models[0]?.metadata?.langframeGroupCatalog).toMatchObject([{ groupName: "下游分组2" }, { groupName: "下游分组1" }]);
  });

  it("uses current account restrictions rather than persisted unrestricted permissions after tightening", async () => {
    keyRows[0]!.groups = ["下游分组1"];
    keyRows[0]!.models = ["gpt-5.6-sol"];
    const result = await readLangframeKeyInventory(connection);
    expect(result.models).toEqual([]);
    expect(result.permissionConfig).toMatchObject({ langframeAccountGroups: ["下游分组1"], langframeModelIds: ["gpt-5.6-sol"] });
    expect(connection.config.scannedModelIds).toEqual(["saved-before-scan"]);
  });

  it("requires membership in the authenticated /v1/models result even when account and public lists advertise a model", async () => {
    directory = { data: [{ id: "gpt-5.6-sol" }] };
    keyRows[0]!.groups = ["nano-banana-2"];
    keyRows[0]!.models = ["nano-banana-2"];
    expect((await readLangframeKeyInventory(connection)).models).toEqual([]);
    directory = { data: [] };
    expect((await readLangframeKeyInventory(connection)).models).toEqual([]);
  });

  it("does not manufacture a protocol from the Key directory when the public source lacks that model", async () => {
    publicCatalog = { ok: true, groups: [{ name: "other", type: "image", models: [{ id: "inner", name: "other-model" }] }] };
    expect((await readLangframeKeyInventory(connection)).models).toEqual([]);
  });

  it("bounds a category connection to its selected public category without granting other Key models", async () => {
    connection.config.langframeKeyScope = false;
    connection.config.modelGroup = "nano-banana-2";
    expect((await readLangframeKeyInventory(connection)).models.map(model => model.id)).toEqual(["nano-banana-2"]);
  });

  it("does not treat a manually chosen category as a forced upstream route for a fallback Key", async () => {
    connection.config.langframeKeyScope = false;
    connection.config.modelGroup = "下游分组1";
    connection.config.usage = "agent";
    keyRows[0]!.groups = ["下游分组2", "下游分组1"];
    keyRows[0]!.models = ["gpt-5.6-sol"];
    const result = await readLangframeKeyInventory(connection);
    expect(result.models.map(model => model.id)).toEqual(["gpt-5.6-sol"]);
    expect(result.models[0]?.pricing).toBeUndefined();
    expect(result.models[0]?.metadata?.langframeGroupCatalog).toMatchObject([{ groupName: "下游分组2" }, { groupName: "下游分组1" }]);
  });

  it.each(["revoked", "different-id", "different-secret", "missing-permissions"])("rejects %s account evidence before consulting public or Key model lists", async reason => {
    if (reason === "revoked") keyRows[0]!.revoked = true;
    if (reason === "different-id") keyRows[0]!.id = "different-uuid";
    if (reason === "different-secret") keyRows[0]!.token = "offline-other-key-not-the-current-key";
    if (reason === "missing-permissions") delete keyRows[0]!.groups;
    const before = JSON.stringify(connection);
    await expect(readLangframeKeyInventory(connection)).rejects.toMatchObject({ code: reason === "missing-permissions" ? "invalid_response" : "invalid_credentials" });
    expect(mocks.providerFetch).not.toHaveBeenCalled();
    expect(mocks.siteFetch.mock.calls.map(([url]) => String(url))).toEqual([`${origin}/api/keys`]);
    expect(JSON.stringify(connection)).toBe(before);
  });

  it.each(["source-id", "deleted", "api-origin", "site-origin", "missing-secret"])("rejects a changed %s source before account authentication", async reason => {
    if (reason === "source-id") savedSupplier.state!.sourceId = "new-source";
    if (reason === "deleted") savedSupplier.state!.visibility = "deleted";
    if (reason === "api-origin") savedSupplier.apiUrl = "https://www.vipprompt.cn";
    if (reason === "site-origin") savedSupplier.siteUrl = "https://other.invalid";
    if (reason === "missing-secret") connection.encryptedSecret = null;
    await expect(readLangframeKeyInventory(connection)).rejects.toMatchObject({ code: reason === "missing-secret" ? "invalid_credentials" : "invalid_response" });
    expect(mocks.openSession).not.toHaveBeenCalled();
    expect(mocks.siteFetch).not.toHaveBeenCalled();
    expect(mocks.providerFetch).not.toHaveBeenCalled();
  });

  it.each(["no-session", "wrong-session", "account-denied"])("does not promote a public directory to Key permissions after %s", async reason => {
    if (reason === "no-session") mocks.openSession.mockResolvedValue(undefined);
    if (reason === "wrong-session") mocks.openSession.mockResolvedValue({ kind: "newapi", fetch: mocks.siteFetch });
    if (reason === "account-denied") keyStatus = 403;
    const before = JSON.stringify(connection);
    await expect(readLangframeKeyInventory(connection)).rejects.toBeInstanceOf(Error);
    expect(mocks.providerFetch).not.toHaveBeenCalled();
    expect(mocks.siteFetch.mock.calls.every(([url]) => String(url).endsWith("/api/keys"))).toBe(true);
    expect(JSON.stringify(connection)).toBe(before);
  });

  it("discards a result when its supplier source changes during the independent directory reads", async () => {
    mocks.providerFetch.mockImplementationOnce(async () => {
      savedSupplier = { ...savedSupplier, state: { ...savedSupplier.state!, sourceId: "source-changed-during-read" } };
      return Response.json(directory);
    });
    const error = await readLangframeKeyInventory(connection).then(() => null, (failure: unknown) => failure);
    expect(error).toMatchObject({ code: "invalid_response" });
    expect(connection.config.supplierSourceId).toBe("wolf-source");
    expect(connection.config.scannedModelIds).toEqual(["saved-before-scan"]);
  });

  it.each(["model-denied", "public-error", "partial-models", "partial-public"])("keeps the original snapshot on %s instead of publishing an empty success", async reason => {
    if (reason === "model-denied") directoryStatus = 403;
    if (reason === "public-error") publicStatus = 503;
    if (reason === "partial-models") directory = { data: [{ id: "nano-banana-2" }], has_more: true };
    if (reason === "partial-public") publicCatalog = { ...fixture.payload, has_more: true };
    const before = JSON.stringify(connection), beforeSupplier = JSON.stringify(savedSupplier);
    await expect(readLangframeKeyInventory(connection)).rejects.toBeInstanceOf(Error);
    expect(JSON.stringify(connection)).toBe(before);
    expect(JSON.stringify(savedSupplier)).toBe(beforeSupplier);
  });

  it.each([
    { models: [{ id: "nano-banana-2" }] }, [{ id: "nano-banana-2" }],
    { data: [{ name: "nano-banana-2" }] }, { data: [{ id: "" }] }, { ok: false, data: [] },
  ])("rejects malformed /v1/models source shape %j with a classified error", async payload => {
    directory = payload;
    await expect(readLangframeKeyInventory(connection)).rejects.toMatchObject({ code: "invalid_response" });
    expect(connection.config.scannedModelIds).toEqual(["saved-before-scan"]);
  });
});
