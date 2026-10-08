import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("a fresh supplier directory read supersedes an in-flight old read without clearing or duplicating the new pending request", async () => {
  vi.resetModules();
  let oldResponse!: (response: Response) => void;
  let freshResponse!: (response: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { oldResponse = resolve; }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { freshResponse = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const { fetchSuppliers } = await import("./client-suppliers");
  const old = fetchSuppliers();
  const fresh = fetchSuppliers({ fresh: true });
  oldResponse(Response.json([{ id: "old-directory" }]));
  await new Promise(resolve => setTimeout(resolve, 0));
  const shared = fetchSuppliers();
  expect(shared).toBe(fresh);
  freshResponse(Response.json([{ id: "new-directory" }]));
  expect(await Promise.all([old, fresh, shared])).toEqual([[{ id: "new-directory" }], [{ id: "new-directory" }], [{ id: "new-directory" }]]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.map(call => call[0])).toEqual(["/api/suppliers", "/api/suppliers"]);
});
