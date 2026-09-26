import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), save: vi.fn(), plan: vi.fn(), kick: vi.fn() }));
vi.mock("./server", () => ({ repository: { listConnections: mocks.list, getConnection: mocks.get, saveConnection: mocks.save }, storage: {}, runService: {} }));
vi.mock("./master-key", () => ({ requireServerMasterKey: () => "test-key" }));
import { resumeSupplierVerification, scheduleSupplierVerification } from "./supplier-verification";

let connection: ProviderConnectionRecord;
const scope = globalThis as typeof globalThis & { __superCanvasSupplierVerification?: unknown };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VITEST", ""); vi.stubEnv("NEXT_PHASE", ""); vi.stubEnv("SUPPLIER_AUTO_VERIFY", "on");
  connection = { id: "connection", provider: "openai", name: "Image", encryptedSecret: "cipher", createdAt: "now", updatedAt: "now",
    config: { supplierId: "supplier", usage: "canvas", supplierVerificationRequestId: "saved-request" } };
  mocks.list.mockImplementation(async () => [structuredClone(connection)]);
  mocks.get.mockImplementation(async () => structuredClone(connection));
  mocks.save.mockImplementation(async value => { connection = value; return value; });
  mocks.plan.mockResolvedValue({ skipped: [] }); mocks.kick.mockResolvedValue(undefined);
  scope.__superCanvasSupplierVerification = { plan: mocks.plan, kick: mocks.kick };
});
afterEach(() => { delete scope.__superCanvasSupplierVerification; vi.unstubAllEnvs(); });

describe("durable automatic supplier onboarding", () => {
  it.each(["canvas", "agent"])("resumes a saved %s Key on startup and clears its marker only after the plan exists", async usage => {
    connection.config.usage = usage;
    mocks.save.mockImplementation(async value => { expect(mocks.plan).toHaveBeenCalledWith("supplier", false, { onboarding: true }); connection = value; return value; });
    await resumeSupplierVerification();
    expect(mocks.plan).toHaveBeenCalledExactlyOnceWith("supplier", false, { onboarding: true });
    expect(connection.config.supplierVerificationRequestId).toBeUndefined();
    mocks.plan.mockClear();
    await resumeSupplierVerification();
    expect(mocks.plan).not.toHaveBeenCalled();
  });
  it("keeps failed free scans pending without resubmitting an image on every read", async () => {
    mocks.plan.mockResolvedValue({ skipped: [{ connectionId: connection.id, modelId: "", reason: "offline" }] });
    await scheduleSupplierVerification("supplier");
    expect(connection.config.supplierVerificationRequestId).toBe("saved-request");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not turn a normal directory refresh into permission to release a preparation hold", async () => {
    delete connection.config.supplierVerificationRequestId;
    await scheduleSupplierVerification("supplier");
    expect(mocks.plan).toHaveBeenCalledExactlyOnceWith("supplier");
  });
  it("coalesces simultaneous saves while retaining a newer request during the first scan", async () => {
    let finish!: () => void;
    mocks.plan.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ skipped: [] }); }));
    const first = scheduleSupplierVerification("supplier");
    await vi.waitFor(() => expect(mocks.plan).toHaveBeenCalledOnce());
    connection.config.supplierVerificationRequestId = "new-request";
    const second = scheduleSupplierVerification("supplier");
    finish();
    await Promise.all([first, second]);
    expect(mocks.plan).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(connection.config.supplierVerificationRequestId).toBeUndefined();
    expect(mocks.kick).toHaveBeenCalledOnce();
  });
  it("leaves smoke tests, builds and disabled automation unable to start paid work", async () => {
    vi.stubEnv("SUPPLIER_AUTO_VERIFY", "off");
    await scheduleSupplierVerification("supplier"); await resumeSupplierVerification();
    expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.kick).not.toHaveBeenCalled();
  });
});
