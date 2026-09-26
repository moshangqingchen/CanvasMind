import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP, type Socket, type TcpNetConnectOpts } from "node:net";
import { networkInterfaces } from "node:os";
import { connect as connectTls, type ConnectionOptions } from "node:tls";
import { promisify } from "node:util";

import { buildConnector } from "undici";

type Address = { address: string; family: number };
export type AutoNetworkConnectOptions = buildConnector.Options & { signal?: AbortSignal };
export type DirectTlsOptions = { address: string; hostname: string; port: number; localAddress: string };
export const PROVIDER_ROUTE = Symbol.for("super-canvas.provider-route");
export const PROVIDER_FALLBACK_REASON = Symbol.for("super-canvas.provider-fallback-reason");
export type ProviderRoute = "physical-direct" | "system" | "system-fake-ip";
export interface AutoNetworkConnectorOptions {
  systemConnector?: buildConnector.connector;
  lookup?: (hostname: string) => Promise<Address[]>;
  resolvePublicAddresses?: (hostname: string, signal: AbortSignal) => Promise<string[]>;
  discoverLocalAddresses?: () => Promise<string[]>;
  connectTls?: (options: DirectTlsOptions, signal: AbortSignal) => Promise<Socket>;
  /** Total budget for direct TLS handshakes, before the system-route fallback. */
  connectTimeoutMs?: number;
  discoveryTimeoutMs?: number;
  cacheTtlMs?: number;
  staleCacheTtlMs?: number;
}

const execFileAsync = promisify(execFile);
const MAX_CACHE_ENTRIES = 128;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_STALE_CACHE_TTL_MS = 30 * 60_000;

export class ProviderNetworkDiscoveryError extends Error {
  public readonly code = "PROVIDER_NETWORK_DISCOVERY_FAILED";
  constructor() {
    super("Cannot determine a safe provider connection before submission; no provider request was sent");
  }
}

export function isFakeIpAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split(".").map(Number);
  return first === 198 && (second === 18 || second === 19);
}

/** Only globally routable IPv4 answers can be used to bypass a fake-IP route. */
export function isPublicDirectAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return a !== undefined && b !== undefined && c !== undefined && !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function usableLocalAddress(address: string): boolean {
  if (isIP(address) !== 4 || isFakeIpAddress(address)) return false;
  const [first, second] = address.split(".").map(Number);
  return first !== undefined && first > 0 && first < 224 && first !== 127 &&
    !(first === 169 && second === 254);
}

/** Read the native interface table first; starting PowerShell is not required on the normal path. */
export function nativePhysicalIpv4Addresses(interfaces = networkInterfaces()): string[] {
  const virtual = /(?:loopback|virtual|vethernet|vmware|virtualbox|hyper-v|wsl|docker|tailscale|zerotier|wireguard|\btun\b|\btap\b|clash|^meta$|vpn|utun|bridge|bluetooth|蓝牙)/iu;
  return [...new Set(Object.entries(interfaces).flatMap(([name, addresses]) => {
    if (virtual.test(name)) return [];
    return (addresses ?? []).filter(entry => !entry.internal && entry.family === "IPv4" &&
      entry.mac !== "00:00:00:00:00:00" && usableLocalAddress(entry.address)).map(entry => entry.address);
  }))];
}

/** Physical adapters exclude the TUN interface that owns the fake-IP route. */
export async function discoverPhysicalIpv4Addresses(): Promise<string[]> {
  const native = nativePhysicalIpv4Addresses();
  if (native.length) return native;
  if (process.platform !== "win32") return [];
  const script = "$ErrorActionPreference='Stop'; @((Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object { Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty IPAddress -Unique)) | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024,
  });
  const parsed: unknown = JSON.parse(stdout.replace(/^\uFEFF/u, "").trim() || "[]");
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((value): value is string =>
    typeof value === "string" && usableLocalAddress(value));
}

async function queryPublicIpv4Addresses(base: string, hostname: string, signal: AbortSignal): Promise<string[]> {
  const endpoint = new URL(base);
  endpoint.searchParams.set("name", hostname);
  endpoint.searchParams.set("type", "A");
  const response = await globalThis.fetch(endpoint, {
    method: "GET", headers: { accept: "application/dns-json" }, redirect: "error", cache: "no-store", signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Public DNS lookup failed");
  }
  const reader = response.body?.getReader();
  if (!reader) return [];
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw new Error("Public DNS response is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const decoded: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!decoded || typeof decoded !== "object" || !("Status" in decoded) || decoded.Status !== 0 ||
    !("Answer" in decoded) || !Array.isArray(decoded.Answer)) return [];
  return decoded.Answer.flatMap((answer: unknown) => {
    if (!answer || typeof answer !== "object" || !("type" in answer) || answer.type !== 1 ||
      !("data" in answer) || typeof answer.data !== "string") return [];
    return isPublicDirectAddress(answer.data) ? [answer.data] : [];
  });
}

/** Independent unauthenticated DNS sources tolerate a brief resolver failure. */
export async function resolvePublicIpv4Addresses(hostname: string, signal: AbortSignal): Promise<string[]> {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  try {
    return await Promise.any(["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"].map(async base => {
      const addresses = await queryPublicIpv4Addresses(base, hostname, combined);
      if (!addresses.length) throw new ProviderNetworkDiscoveryError();
      return addresses;
    }));
  } finally {
    controller.abort();
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Connection cancelled", "AbortError");
}

function waitWithSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    // Even an already-aborted wait must observe the in-flight promise's
    // rejection: DNS can finish after its caller has cancelled.
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function openDirectTls(options: DirectTlsOptions, signal: AbortSignal): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError(signal)); return; }
    // Connect to the validated real address, but verify the provider hostname.
    const connectOptions: ConnectionOptions & TcpNetConnectOpts = {
      host: options.address, port: options.port, localAddress: options.localAddress,
      servername: options.hostname, rejectUnauthorized: true, ALPNProtocols: ["http/1.1"],
    };
    const socket = connectTls(connectOptions);
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", abort);
    const failed = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const abort = () => failed(abortError(signal));
    signal.addEventListener("abort", abort, { once: true });
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    socket.once("error", failed);
    socket.once("close", () => failed(new Error("TLS connection closed before handshake")));
    socket.once("secureConnect", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(socket);
    });
  });
}

/**
 * Select a working local connection before Undici can send any HTTP bytes.
 * A successful TLS socket is handed directly to Undici, not discarded for a
 * second connection. Once handed over, this function never retries a request.
 * Explicit proxy dispatchers must bypass this connector at the caller.
 */
export function createAutoNetworkConnector(options: AutoNetworkConnectorOptions = {}):
  (request: AutoNetworkConnectOptions, callback: buildConnector.Callback) => void {
  const systemConnector = options.systemConnector ?? buildConnector({
    keepAlive: true, keepAliveInitialDelay: 30_000, timeout: 10_000,
  });
  const systemLookup = options.lookup ?? (hostname => lookup(hostname, { all: true, verbatim: true }));
  const publicLookup = options.resolvePublicAddresses ?? resolvePublicIpv4Addresses;
  const localLookup = options.discoverLocalAddresses ?? discoverPhysicalIpv4Addresses;
  const dial = options.connectTls ?? openDirectTls;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const staleTtl = options.staleCacheTtlMs ?? DEFAULT_STALE_CACHE_TTL_MS;
  const cache = new Map<string, { expires: number; staleUntil: number; addresses: string[] }>();
  const pending = new Map<string, Promise<string[]>>();
  const cached = (key: string, load: () => Promise<string[]>, valid: (address: string) => boolean): Promise<string[]> => {
    const found = cache.get(key);
    if (found && found.expires > Date.now()) return Promise.resolve(found.addresses);
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const value = (async () => {
      try {
        // These retries only perform discovery, never a supplier HTTP request.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const addresses = [...new Set(await Promise.resolve().then(load))].filter(valid);
            if (!addresses.length) throw new ProviderNetworkDiscoveryError();
            if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
            cache.set(key, { expires: Date.now() + ttl, staleUntil: Date.now() + staleTtl, addresses });
            return addresses;
          } catch (error) { if (attempt === 1) throw error; }
        }
        throw new ProviderNetworkDiscoveryError();
      } catch {
        // DNS is only a candidate hint. Every reused address still receives a
        // fresh, hostname-verified TLS handshake before any HTTP bytes.
        if (found && found.staleUntil > Date.now()) return found.addresses;
        throw new ProviderNetworkDiscoveryError();
      } finally { pending.delete(key); }
    })();
    pending.set(key, value);
    return value;
  };

  return (request, callback) => {
    let completed = false;
    const finish: buildConnector.Callback = (...args) => {
      if (completed) { args[1]?.destroy(); return; }
      if (request.signal?.aborted && args[1]) {
        args[1].destroy();
        completed = true;
        callback(abortError(request.signal), null);
        return;
      }
      completed = true;
      callback(...args);
    };
    const fallback = (reason: "normal_dns" | "transport_constraints" | "physical_tls_unreachable") => {
      if (completed) return;
      if (request.signal?.aborted) { finish(abortError(request.signal), null); return; }
      try { systemConnector(request, (error, socket) => {
        if (error) { finish(error, null); return; }
        const route: ProviderRoute = isFakeIpAddress(socket.remoteAddress ?? "") || isFakeIpAddress(socket.localAddress ?? "") ? "system-fake-ip" : "system";
        Object.defineProperty(socket, PROVIDER_ROUTE, { value: route, configurable: true });
        Object.defineProperty(socket, PROVIDER_FALLBACK_REASON, { value: reason, configurable: true });
        finish(null, socket);
      }); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error)), null); }
    };
    if (request.signal?.aborted) { finish(abortError(request.signal), null); return; }
    if (request.protocol !== "https:" || isIP(request.hostname) || request.httpSocket || request.socketPath || request.localAddress) {
      fallback("transport_constraints"); return;
    }
    void (async () => {
      try {
        const discovery = AbortSignal.timeout(options.discoveryTimeoutMs ?? 15_000);
        const discoverySignal = request.signal ? AbortSignal.any([discovery, request.signal]) : discovery;
        const addresses = await waitWithSignal(systemLookup(request.hostname), discoverySignal);
        discoverySignal.throwIfAborted();
        if (!addresses.length) throw new ProviderNetworkDiscoveryError();
        if (!addresses.every(entry => isFakeIpAddress(entry.address))) { fallback("normal_dns"); return; }
        const [publicAddresses, localAddresses] = await waitWithSignal(Promise.all([
          cached(`dns:${request.hostname}`, () => publicLookup(request.hostname, AbortSignal.timeout(6_000)), isPublicDirectAddress),
          cached("local", localLookup, usableLocalAddress),
        ]), discoverySignal);
        const publicCandidates = [...new Set(publicAddresses)].filter(isPublicDirectAddress).slice(0, 2);
        const localCandidates = [...new Set(localAddresses)].filter(usableLocalAddress).slice(0, 2);
        if (!publicCandidates.length || !localCandidates.length) throw new ProviderNetworkDiscoveryError();
        const budget = AbortSignal.timeout(options.connectTimeoutMs ?? 8_000);
        const signal = request.signal ? AbortSignal.any([budget, request.signal]) : budget;
        let attempted = false;
        let localBindingFailed = false;
        for (const localAddress of localCandidates) {
          for (const address of publicCandidates) {
            if (signal.aborted) break;
            try {
              attempted = true;
              const socket = await dial({ address, hostname: request.hostname, port: Number(request.port || 443), localAddress }, signal);
              if (signal.aborted) { socket.destroy(); break; }
              Object.defineProperty(socket, PROVIDER_ROUTE, { value: "physical-direct", configurable: true });
              finish(null, socket);
              return;
            } catch (error) {
              // An obsolete local address is failed discovery, not evidence
              // that the supplier requires the TUN route.
              if (error && typeof error === "object" && "code" in error && error.code === "EADDRNOTAVAIL") localBindingFailed = true;
            }
          }
        }
        if (!attempted || localBindingFailed) {
          cache.delete("local");
          throw new ProviderNetworkDiscoveryError();
        }
        fallback("physical_tls_unreachable");
      } catch {
        finish(request.signal?.aborted ? abortError(request.signal) : new ProviderNetworkDiscoveryError(), null);
      }
    })();
  };
}
