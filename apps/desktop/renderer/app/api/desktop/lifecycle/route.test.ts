import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ runs: [] as unknown[], nodes: [] as unknown[], verifications: [] as unknown[], flush: vi.fn(), lifecycle: { writes: 0, draining: false } }));
vi.mock("../../../../lib/desktop-server", () => ({ desktopAuthorized: () => true, desktopLifecycleState: () => mocks.lifecycle }));
vi.mock("../../../../lib/server", () => ({ repository: { listRecoverableRuns: async () => mocks.runs, listNodeRuns: async () => mocks.nodes, listSupplierVerifications: async () => mocks.verifications, flush: mocks.flush } }));
import { GET } from "./route";
beforeEach(() => { mocks.runs = [{ id: "run" }]; mocks.nodes = []; mocks.verifications = []; mocks.flush.mockReset(); });
const marker = "cloud:" + "a".repeat(64);
const status = async () => (await GET(new Request("http://localhost/api/desktop/lifecycle"))).json();
it("allows normal exit after the cloud task is durably accepted", async () => {
  mocks.nodes = [{ status: "submitting", providerTaskId: marker, inputJson: { cloudAccepted: true } }];
  expect(await status()).toMatchObject({ activeRuns: 0, resumableCloudRuns: 1 }); expect(mocks.flush).toHaveBeenCalledOnce();
});
it.each(["unaccepted", "local", "archiving"])("keeps %s work protected from early exit", async kind => {
  mocks.nodes = [{ status: kind === "archiving" ? "archiving" : "running", providerTaskId: kind === "local" ? "supplier-id" : marker, inputJson: { cloudAccepted: kind !== "unaccepted" } }];
  expect(await status()).toMatchObject({ activeRuns: 1, resumableCloudRuns: 0 }); expect(mocks.flush).not.toHaveBeenCalled();
});
it("does not detach a graph while another local node is running", async () => {
  mocks.nodes = [{ status: "running", providerTaskId: marker, inputJson: { cloudAccepted: true } }, { status: "running", providerTaskId: "local-id", inputJson: {} }];
  expect(await status()).toMatchObject({ activeRuns: 1 });
});
it("applies the same acceptance rule to supplier automatic verification", async () => {
  mocks.runs = []; mocks.verifications = [{ cases: [{ status: "running", task: { providerTaskId: marker, result: { cloudAccepted: true } } }, { status: "submitting", task: { providerTaskId: marker } }] }];
  expect(await status()).toMatchObject({ activeRuns: 1, activeVerifications: 1 });
});
