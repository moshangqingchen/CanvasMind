import { describe, expect, it, vi } from "vitest";
import { createSharedRequest } from "./shared-request";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

describe("shared pending reads", () => {
  it("coalesces concurrent reads without caching settled data", async () => {
    const load = vi.fn().mockResolvedValue(["item"]);
    const request = createSharedRequest(load);
    await expect(Promise.all([request.read(), request.read(), request.read()]))
      .resolves.toEqual([["item"], ["item"], ["item"]]);
    expect(load).toHaveBeenCalledOnce();
    await request.read();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("releases a rejected request so subsequent reads can recover", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("fresh");
    const request = createSharedRequest(load);
    await expect(request.read()).rejects.toThrow("offline");
    await expect(request.read()).resolves.toBe("fresh");
  });

  it("replaces a stale response after mutation with the fresh pending read", async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const request = createSharedRequest(load);
    const first = request.read();
    request.invalidate();
    const second = request.read();
    old.resolve("deleted item");
    fresh.resolve("current items");
    await expect(Promise.all([first, second])).resolves.toEqual(["current items", "current items"]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refreshes a stale response when the mutation has no other reader", async () => {
    const old = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce("current items");
    const request = createSharedRequest(load);
    const first = request.read();
    request.invalidate();
    old.resolve("deleted item");
    await expect(first).resolves.toBe("current items");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
