import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeRemoteArtifact, downloadRemoteArtifact, isPublicNetworkAddress } from "../src/remote-download.js";

const resolvePublic = async () => [{ address: "93.184.216.34", family: 4 }];
const shortWait = () => new Promise<"still pending">((resolve) => setTimeout(() => resolve("still pending"), 60));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("remote artifact lifecycle edge cases", () => {
  it.each(["::ffff:808:808", "0:0:0:0:0:ffff:0808:0808"])("accepts equivalent public IPv4-mapped form %s", address => {
    expect(isPublicNetworkAddress(address)).toBe(true);
  });

  it.each(["::ffff:7f00:1", "0:0:0:0:0:ffff:c0a8:1", "::ffff:a9fe:a9fe", "::ffff:c612:1", "fe80::1%eth0"])(
    "keeps private and fake-IP IPv6 variants blocked: %s", address => {
      expect(isPublicNetworkAddress(address)).toBe(false);
    },
  );

  it("downloads a public IPv4-mapped literal after URL normalization", async () => {
    const transport = vi.fn(async () => ({ status: 200, bytes: Uint8Array.of(1, 2) }));
    await expect(downloadRemoteArtifact("https://[::ffff:8.8.8.8]/asset.png", { transport }))
      .resolves.toMatchObject({ bytes: Uint8Array.of(1, 2) });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("does not hide a storage failure behind stalled proxy stream cancellation", async () => {
    vi.stubEnv("PROVIDER_HTTP_PROXY", "http://127.0.0.1:18791");
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel,
    }))));
    const result = consumeRemoteArtifact("https://cdn.example/output", async chunks => {
      for await (const _chunk of chunks) throw new Error("disk full");
    }, { resolve: resolvePublic, timeoutMs: 20 }).catch(error => error);
    expect(await Promise.race([result, shortWait()])).toMatchObject({ message: "disk full" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("finishes the timeout even when a proxy body cancellation never resolves", async () => {
    vi.stubEnv("PROVIDER_HTTP_PROXY", "http://127.0.0.1:18791");
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }))));
    const result = downloadRemoteArtifact("https://cdn.example/output", { resolve: resolvePublic, timeoutMs: 10 }).catch(error => error);
    expect(await Promise.race([result, shortWait()])).toMatchObject({ message: "Provider output download timed out" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("closes a proxy response that arrives after the download deadline", async () => {
    vi.stubEnv("PROVIDER_HTTP_PROXY", "http://127.0.0.1:18791");
    let deliver!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; }));
    vi.stubGlobal("fetch", fetch);
    await expect(downloadRemoteArtifact("https://cdn.example/output", { resolve: resolvePublic, timeoutMs: 10 }))
      .rejects.toThrow("Provider output download timed out");
    expect(fetch).toHaveBeenCalledOnce();
    const cancel = vi.fn();
    deliver(new Response(new ReadableStream({ cancel })));
    await new Promise(resolve => setImmediate(resolve));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
