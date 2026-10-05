import { Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { buildConnector } from "undici";

import {
  createAutoNetworkConnector,
  nativePhysicalIpv4Addresses,
  PROVIDER_ROUTE,
  PROVIDER_FALLBACK_REASON,
  isFakeIpAddress,
  isPublicDirectAddress,
  resolvePublicIpv4Addresses,
  type AutoNetworkConnectOptions,
  type AutoNetworkConnectorOptions,
} from "./direct-network.js";

vi.mock("node:tls", () => ({ connect: vi.fn() }));

const request = { hostname: "images.provider.example", host: "images.provider.example", protocol: "https:", port: "443" };
const successfulSocket = () => new Socket();

function setup(overrides: AutoNetworkConnectorOptions = {}) {
  const normal = successfulSocket();
  const direct = successfulSocket();
  const systemConnector = vi.fn<buildConnector.connector>((_options, callback) => callback(null, normal));
  const lookup = vi.fn(async () => [{ address: "198.18.1.2", family: 4 }]);
  const resolvePublicAddresses = vi.fn(async () => ["104.156.154.225"]);
  const discoverLocalAddresses = vi.fn(async () => ["192.168.1.20"]);
  const connectTls = vi.fn(async () => direct);
  const connector = createAutoNetworkConnector({ systemConnector, lookup, resolvePublicAddresses, discoverLocalAddresses, connectTls, ...overrides });
  const connect = (options: AutoNetworkConnectOptions = request) => new Promise<Socket>((resolve, reject) => {
    connector(options, (error, socket) => error ? reject(error) : resolve(socket));
  });
  return { connector, connect, normal, direct, systemConnector, lookup, resolvePublicAddresses, discoverLocalAddresses, connectTls };
}

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("automatic local provider connection selection", () => {
  it("uses the successful physical-adapter TLS socket itself for a fake-IP hostname", async () => {
    const test = setup();
    await expect(test.connect()).resolves.toBe(test.direct);
    expect(test.connectTls).toHaveBeenCalledWith({ address: "104.156.154.225", hostname: request.hostname, port: 443, localAddress: "192.168.1.20" }, expect.any(AbortSignal));
    expect(test.systemConnector).not.toHaveBeenCalled();
    expect(test.direct.bytesWritten).toBe(0);
    expect(Reflect.get(test.direct, PROVIDER_ROUTE)).toBe("physical-direct");
  });

  it.each([
    [{ address: "104.156.154.225", family: 4 }],
    [{ address: "198.18.1.2", family: 4 }, { address: "2606:4700::1111", family: 6 }],
  ])("retains the system connector when DNS has a normal route", async (...addresses) => {
    const test = setup({ lookup: async () => addresses });
    await expect(test.connect()).resolves.toBe(test.normal);
    expect(test.resolvePublicAddresses).not.toHaveBeenCalled();
    expect(test.discoverLocalAddresses).not.toHaveBeenCalled();
    expect(test.connectTls).not.toHaveBeenCalled();
  });

  it("falls back before any request bytes after a direct TLS failure", async () => {
    const failedSocket = successfulSocket();
    const test = setup({ connectTls: async () => { failedSocket.destroy(); throw new Error("TLS reset"); } });
    await expect(test.connect()).resolves.toBe(test.normal);
    expect(test.systemConnector).toHaveBeenCalledOnce();
    expect(failedSocket.destroyed).toBe(true);
    expect(failedSocket.bytesWritten).toBe(0);
    expect(Reflect.get(test.normal, PROVIDER_FALLBACK_REASON)).toBe("physical_tls_unreachable");
  });

  it("does not select private, metadata, documentation, multicast or fake DNS answers", async () => {
    const unsafe = ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.2", "169.254.169.254", "100.100.100.200", "198.18.1.2", "192.0.2.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "::1"];
    const test = setup({ resolvePublicAddresses: async () => unsafe });
    await expect(test.connect()).rejects.toMatchObject({ code: "PROVIDER_NETWORK_DISCOVERY_FAILED" });
    expect(test.connectTls).not.toHaveBeenCalled();
    expect(test.systemConnector).not.toHaveBeenCalled();
    expect(unsafe.every(address => !isPublicDirectAddress(address))).toBe(true);
  });

  it("tries another pre-send connection after an immediate handshake rejection", async () => {
    let attempts = 0;
    const socket = successfulSocket();
    const dial = vi.fn(async () => { if (attempts++ === 0) throw new Error("unavailable"); return socket; });
    const test = setup({ resolvePublicAddresses: async () => ["104.156.154.225", "43.154.120.97"], connectTls: dial });
    await expect(test.connect()).resolves.toBe(socket);
    expect(dial).toHaveBeenCalledTimes(2);
    expect(test.systemConnector).not.toHaveBeenCalled();
    expect(socket.bytesWritten).toBe(0);
  });

  it("selects a healthy second address while the first TLS handshake is stalled", async () => {
    const winner = successfulSocket();
    const failed = successfulSocket();
    let stalledSignal: AbortSignal | undefined;
    const dial = vi.fn(async ({ address }: { address: string }, signal: AbortSignal) => {
      if (address === "43.154.120.97") return winner;
      stalledSignal = signal;
      return new Promise<Socket>((_resolve, reject) => signal.addEventListener("abort", () => {
        failed.destroy();
        reject(signal.reason);
      }, { once: true }));
    });
    const test = setup({ resolvePublicAddresses: async () => ["104.156.154.225", "43.154.120.97"], connectTls: dial });
    await expect(test.connect()).resolves.toBe(winner);
    expect(dial).toHaveBeenCalledTimes(2);
    expect(stalledSignal?.aborted).toBe(true);
    expect(failed.destroyed).toBe(true);
    expect(winner.destroyed).toBe(false);
    expect(winner.bytesWritten).toBe(0);
    expect(test.systemConnector).not.toHaveBeenCalled();
    winner.destroy();
  });

  it("hands over only one socket when parallel TLS candidates finish together", async () => {
    const sockets = [successfulSocket(), successfulSocket(), successfulSocket(), successfulSocket()];
    let next = 0;
    const test = setup({
      resolvePublicAddresses: async () => ["104.156.154.225", "43.154.120.97"],
      discoverLocalAddresses: async () => ["192.168.1.20", "192.168.2.20"],
      connectTls: async () => sockets[next++]!,
    });
    const winner = await test.connect();
    expect(sockets.filter(socket => !socket.destroyed)).toEqual([winner]);
    expect(sockets.every(socket => socket.bytesWritten === 0)).toBe(true);
    expect(test.systemConnector).not.toHaveBeenCalled();
    winner.destroy();
  });

  it("closes a cancelled TLS candidate even if its transport returns a socket late", async () => {
    const controller = new AbortController();
    let deliver!: (socket: Socket) => void;
    const dial = vi.fn(() => new Promise<Socket>(resolve => { deliver = resolve; }));
    const test = setup({ connectTls: dial });
    const result = test.connect({ ...request, signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(dial).toHaveBeenCalledOnce());
    controller.abort();
    expect(await result).toMatchObject({ name: "AbortError" });
    const lateSocket = successfulSocket();
    deliver(lateSocket);
    await new Promise(resolve => setImmediate(resolve));
    expect(lateSocket.destroyed).toBe(true);
    expect(test.systemConnector).not.toHaveBeenCalled();
  });

  it("shares bounded DNS and physical discovery between connections", async () => {
    const test = setup();
    await Promise.all([test.connect(), test.connect()]);
    expect(test.resolvePublicAddresses).toHaveBeenCalledTimes(1);
    expect(test.discoverLocalAddresses).toHaveBeenCalledTimes(1);
    expect(test.connectTls).toHaveBeenCalledTimes(2);
  });

  it("retries temporary DNS and interface discovery failures before sending anything", async () => {
    const publicLookup = vi.fn().mockRejectedValueOnce(new Error("temporary DNS error")).mockResolvedValue(["104.156.154.225"]);
    const localLookup = vi.fn().mockRejectedValueOnce(new Error("temporary interface discovery error")).mockResolvedValue(["192.168.1.20"]);
    const test = setup({ resolvePublicAddresses: publicLookup, discoverLocalAddresses: localLookup });
    await expect(test.connect()).resolves.toBe(test.direct);
    expect(publicLookup).toHaveBeenCalledTimes(2);
    expect(localLookup).toHaveBeenCalledTimes(2);
    expect(test.systemConnector).not.toHaveBeenCalled();
    expect(test.direct.bytesWritten).toBe(0);
  });

  it("fails before submission when discovery remains unavailable instead of routing a paid request into TUN", async () => {
    const publicLookup = vi.fn(async () => { throw new Error("DNS unavailable"); });
    const test = setup({ resolvePublicAddresses: publicLookup });
    await expect(test.connect()).rejects.toMatchObject({ code: "PROVIDER_NETWORK_DISCOVERY_FAILED" });
    expect(publicLookup).toHaveBeenCalledTimes(2);
    expect(test.connectTls).not.toHaveBeenCalled();
    expect(test.systemConnector).not.toHaveBeenCalled();
  });

  it("retains previously resolved addresses through a brief refresh outage and verifies TLS again", async () => {
    let unavailable = false;
    const publicLookup = vi.fn(async () => { if (unavailable) throw new Error("DNS unavailable"); return ["104.156.154.225"]; });
    const localLookup = vi.fn(async () => { if (unavailable) throw new Error("interface query unavailable"); return ["192.168.1.20"]; });
    const test = setup({ resolvePublicAddresses: publicLookup, discoverLocalAddresses: localLookup, cacheTtlMs: 0 });
    await expect(test.connect()).resolves.toBe(test.direct);
    unavailable = true;
    await expect(test.connect()).resolves.toBe(test.direct);
    expect(publicLookup).toHaveBeenCalledTimes(3);
    expect(localLookup).toHaveBeenCalledTimes(3);
    expect(test.connectTls).toHaveBeenCalledTimes(2);
    expect(test.systemConnector).not.toHaveBeenCalled();
  });

  it("does not keep old DNS indefinitely after the stale-cache window", async () => {
    let unavailable = false;
    const publicLookup = vi.fn(async () => { if (unavailable) throw new Error("DNS unavailable"); return ["104.156.154.225"]; });
    const test = setup({ resolvePublicAddresses: publicLookup, cacheTtlMs: 0, staleCacheTtlMs: 0 });
    await expect(test.connect()).resolves.toBe(test.direct);
    unavailable = true;
    await expect(test.connect()).rejects.toMatchObject({ code: "PROVIDER_NETWORK_DISCOVERY_FAILED" });
    expect(test.connectTls).toHaveBeenCalledTimes(1);
    expect(test.systemConnector).not.toHaveBeenCalled();
  });

  it("marks a system connection that actually uses a fake-IP route", async () => {
    const socket = successfulSocket();
    Object.defineProperty(socket, "remoteAddress", { value: "198.18.1.2" });
    const test = setup({ connectTls: async () => { throw new Error("direct unreachable"); },
      systemConnector: (_options, callback) => callback(null, socket) });
    await expect(test.connect()).resolves.toBe(socket);
    expect(Reflect.get(socket, PROVIDER_ROUTE)).toBe("system-fake-ip");
    expect(Reflect.get(socket, PROVIDER_FALLBACK_REASON)).toBe("physical_tls_unreachable");
  });

  it("does not confuse a disappeared local adapter with an unreachable supplier", async () => {
    const test = setup({ connectTls: async () => { throw Object.assign(new Error("adapter changed"), { code: "EADDRNOTAVAIL" }); } });
    await expect(test.connect()).rejects.toMatchObject({ code: "PROVIDER_NETWORK_DISCOVERY_FAILED" });
    expect(test.systemConnector).not.toHaveBeenCalled();
  });

  it("keeps public DNS answers isolated between suppliers while sharing physical discovery", async () => {
    const resolvePublicAddresses = vi.fn(async (hostname: string) => hostname === request.hostname ? ["104.156.154.225"] : ["43.154.120.97"]);
    const test = setup({ resolvePublicAddresses });
    await Promise.all([test.connect(), test.connect({ ...request, hostname: "second.provider.example" })]);
    expect(test.connectTls).toHaveBeenCalledWith(expect.objectContaining({ hostname: request.hostname, address: "104.156.154.225" }), expect.any(AbortSignal));
    expect(test.connectTls).toHaveBeenCalledWith(expect.objectContaining({ hostname: "second.provider.example", address: "43.154.120.97" }), expect.any(AbortSignal));
    expect(test.discoverLocalAddresses).toHaveBeenCalledOnce();
  });

  it("does not retry after giving the successful socket to Undici", async () => {
    const test = setup();
    const callback = vi.fn();
    test.connector(request, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    test.direct.destroy();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledOnce();
    expect(test.systemConnector).not.toHaveBeenCalled();
  });

  it("honors pre-connect cancellation without opening either route", async () => {
    const controller = new AbortController();
    controller.abort();
    const test = setup();
    await expect(test.connect({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(test.connectTls).not.toHaveBeenCalled();
    expect(test.systemConnector).not.toHaveBeenCalled();
  });

  it("observes a DNS rejection after cancellation without starting another route", async () => {
    const controller = new AbortController();
    const test = setup({ lookup: async () => { controller.abort(); throw new Error("DNS unavailable"); } });
    await expect(test.connect({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await new Promise(resolve => setImmediate(resolve));
    expect(test.resolvePublicAddresses).not.toHaveBeenCalled();
    expect(test.connectTls).not.toHaveBeenCalled();
    expect(test.systemConnector).not.toHaveBeenCalled();
  });

  it("destroys an unfinished TLS socket on cancellation without falling back", async () => {
    const controller = new AbortController();
    const socket = successfulSocket();
    vi.mocked(tlsConnect).mockReturnValue(socket as never);
    const test = setup({ connectTls: undefined });
    const result = test.connect({ ...request, signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(tlsConnect).toHaveBeenCalled());
    controller.abort();
    await expect(result).resolves.toMatchObject({ name: "AbortError" });
    expect(socket.destroyed).toBe(true);
    expect(test.systemConnector).not.toHaveBeenCalled();
  });

  it("retains hostname SNI, certificate verification and TCP keepalive", async () => {
    const socket = successfulSocket();
    const keepAlive = vi.spyOn(socket, "setKeepAlive");
    vi.mocked(tlsConnect).mockReturnValue(socket as never);
    const test = setup({ connectTls: undefined });
    const result = test.connect();
    await vi.waitFor(() => expect(tlsConnect).toHaveBeenCalled());
    expect(tlsConnect).toHaveBeenCalledWith(expect.objectContaining({ host: "104.156.154.225", servername: request.hostname, rejectUnauthorized: true, localAddress: "192.168.1.20" }));
    expect(keepAlive).toHaveBeenCalledWith(true, 30_000);
    socket.emit("secureConnect");
    await expect(result).resolves.toBe(socket);
    expect(socket.bytesWritten).toBe(0);
    socket.destroy();
  });

  it("falls back after its finite handshake budget and cleans up the failed socket", async () => {
    const socket = successfulSocket();
    vi.mocked(tlsConnect).mockReturnValue(socket as never);
    const test = setup({ connectTls: undefined, connectTimeoutMs: 20 });
    await expect(test.connect()).resolves.toBe(test.normal);
    expect(socket.destroyed).toBe(true);
    expect(test.systemConnector).toHaveBeenCalledOnce();
  });

  it.each([
    { ...request, protocol: "http:" },
    { ...request, hostname: "104.156.154.225" },
    { ...request, localAddress: "192.168.1.20" },
  ])("preserves explicit transport constraints", async options => {
    const test = setup();
    await expect(test.connect(options)).resolves.toBe(test.normal);
    expect(test.lookup).not.toHaveBeenCalled();
    expect(test.systemConnector).toHaveBeenCalledWith(options, expect.any(Function));
  });
});

describe("public DNS for fake-IP connection selection", () => {
  it("uses native physical candidates while excluding TUN and common virtual adapters", () => {
    const make = (address: string, internal = false) => ({ address, family: "IPv4" as const, mac: "aa:bb:cc:dd:ee:ff", netmask: "255.255.255.0", cidr: `${address}/24`, internal });
    expect(nativePhysicalIpv4Addresses({
      "以太网": [make("192.168.1.20")],
      Meta: [make("198.18.0.0")],
      "vEthernet (WSL)": [make("172.17.1.1")],
      "Tailscale": [make("100.64.1.2")],
      "Loopback": [make("127.0.0.1", true)],
      "WLAN": [make("169.254.1.2")],
    })).toEqual(["192.168.1.20"]);
  });

  it("uses another public resolver when the first is temporarily unavailable", async () => {
    const fetch = vi.fn(async (url: URL) => {
      if (url.hostname === "dns.google") throw new Error("temporary resolver failure");
      return Response.json({ Status: 0, Answer: [{ type: 1, data: "104.156.154.225" }] });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(resolvePublicIpv4Addresses(request.hostname, AbortSignal.timeout(1000))).resolves.toEqual(["104.156.154.225"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url.hostname)).toEqual(["dns.google", "cloudflare-dns.com"]);
  });

  it("uses a bounded unauthenticated DNS GET and accepts only public A records", async () => {
    const fetch = vi.fn(async () => Response.json({ Status: 0, Answer: [
      { type: 1, data: "104.156.154.225" }, { type: 1, data: "169.254.169.254" }, { type: 5, data: "alias.example" },
    ] }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await expect(resolvePublicIpv4Addresses(request.hostname, signal)).resolves.toEqual(["104.156.154.225"]);
    const [url, init] = fetch.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(url.origin).toBe("https://dns.google");
    expect(url.searchParams.get("name")).toBe(request.hostname);
    expect(init).toEqual({ method: "GET", headers: { accept: "application/dns-json" }, redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) });
  });

  it("recognizes only the exact benchmarking fake-IP range", () => {
    expect(["198.18.0.1", "198.19.255.254"].every(isFakeIpAddress)).toBe(true);
    expect(["198.17.0.1", "198.20.0.1", "198.18.0.999", "::1"].some(isFakeIpAddress)).toBe(false);
  });
});
