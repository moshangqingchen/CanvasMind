export const PUBLIC_AUTH_COOKIE = "super_canvas_session";

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

/** Non-short-circuiting AND so a wrong username costs the same as a wrong password. */
export function credentialsMatch(
  candidate: { username: string; password: string },
  expected: { username: string; password: string },
): boolean {
  const userOk = constantTimeEqual(candidate.username, expected.username);
  const passOk = constantTimeEqual(candidate.password, expected.password);
  return userOk && passOk;
}

function parseHostList(value: string | undefined): readonly string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function getPublicAuthConfig() {
  return {
    username: process.env.SUPERCANVAS_PUBLIC_AUTH_USER ?? "",
    password: process.env.SUPERCANVAS_PUBLIC_AUTH_PASSWORD ?? "",
    sessionToken: process.env.SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN ?? "",
    /**
     * Extra hostnames that may skip the login prompt. Loopback is covered by
     * `isLoopbackHost`; this exists for trusted LAN development machines only.
     */
    trustedHosts: parseHostList(
      process.env.SUPERCANVAS_PUBLIC_AUTH_TRUSTED_HOSTS,
    ),
    /** Set to "false" to require login even from localhost. */
    allowLoopback:
      process.env.SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK !== "false",
  };
}

export function isPublicAuthConfigured() {
  const config = getPublicAuthConfig();
  return Boolean(config.username && config.password && config.sessionToken);
}

/** `host` must already be stripped of its port and lowercased. */
export function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "[::1]") return true;
  // 127.0.0.0/8
  const ipv4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (!ipv4) return false;
  return ipv4
    .slice(1)
    .every((part) => Number(part) >= 0 && Number(part) <= 255);
}

export function normalizeHostHeader(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "";
  // Keep bracketed IPv6 literals intact; strip the ":port" suffix otherwise.
  if (raw.startsWith("[")) return raw.slice(0, raw.indexOf("]") + 1) || raw;
  return raw.split(":", 1)[0] ?? "";
}

/**
 * Whether a request arriving on `host` is exempt from the login prompt.
 * Defaults to "protect everything" — the previous behaviour only protected one
 * hard-coded domain, so any other hostname or bare IP reached the app unchecked.
 */
export function isTrustedHost(
  host: string,
  config = getPublicAuthConfig(),
): boolean {
  if (config.trustedHosts.includes(host)) return true;
  return config.allowLoopback && isLoopbackHost(host);
}
