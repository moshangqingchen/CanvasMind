import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  credentialsMatch,
  getPublicAuthConfig,
  isLoopbackHost,
  isPublicAuthConfigured,
  isTrustedHost,
  normalizeHostHeader,
} from "./public-auth";

// The developer machine may export real credentials; start every test from a
// known-empty configuration so the assertions describe the code, not the host.
beforeEach(() => {
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_USER", "");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_PASSWORD", "");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN", "");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_TRUSTED_HOSTS", "");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function configureAuth() {
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_USER", "creator");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_PASSWORD", "correct horse");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN", "session-token");
}

describe("normalizeHostHeader", () => {
  it("strips the port and lowercases the hostname", () => {
    expect(normalizeHostHeader("Example.COM:3210")).toBe("example.com");
    expect(normalizeHostHeader("localhost")).toBe("localhost");
  });

  it("keeps bracketed IPv6 literals intact", () => {
    expect(normalizeHostHeader("[::1]:3000")).toBe("[::1]");
  });

  it("returns an empty string for a missing header", () => {
    expect(normalizeHostHeader(null)).toBe("");
    expect(normalizeHostHeader(undefined)).toBe("");
  });
});

describe("isLoopbackHost", () => {
  it("accepts loopback names and the whole 127.0.0.0/8 range", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("app.localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.9.9.9")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("rejects routable hosts that merely look local", () => {
    expect(isLoopbackHost("127.0.0.1.evil.com")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
    expect(isLoopbackHost("notlocalhost")).toBe(false);
  });
});

describe("isTrustedHost", () => {
  it("treats every non-loopback host as untrusted by default", () => {
    configureAuth();
    const config = getPublicAuthConfig();

    expect(isTrustedHost("815rongai.com", config)).toBe(false);
    expect(isTrustedHost("203.0.113.10", config)).toBe(false);
    expect(isTrustedHost("", config)).toBe(false);
    expect(isTrustedHost("localhost", config)).toBe(true);
  });

  it("honours an explicit trusted-host allowlist", () => {
    configureAuth();
    vi.stubEnv(
      "SUPERCANVAS_PUBLIC_AUTH_TRUSTED_HOSTS",
      "studio.lan, 192.168.1.20",
    );
    const config = getPublicAuthConfig();

    expect(isTrustedHost("studio.lan", config)).toBe(true);
    expect(isTrustedHost("192.168.1.20", config)).toBe(true);
    expect(isTrustedHost("192.168.1.21", config)).toBe(false);
  });

  it("can require login from loopback too", () => {
    configureAuth();
    vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK", "false");

    expect(isTrustedHost("localhost", getPublicAuthConfig())).toBe(false);
  });
});

describe("credentialsMatch", () => {
  const expected = { username: "creator", password: "correct horse" };

  it("requires both fields to match", () => {
    expect(credentialsMatch({ ...expected }, expected)).toBe(true);
    expect(
      credentialsMatch({ username: "creator", password: "wrong" }, expected),
    ).toBe(false);
    expect(
      credentialsMatch(
        { username: "someone", password: "correct horse" },
        expected,
      ),
    ).toBe(false);
    expect(credentialsMatch({ username: "", password: "" }, expected)).toBe(
      false,
    );
  });
});

describe("isPublicAuthConfigured", () => {
  it("requires all three values", () => {
    expect(isPublicAuthConfigured()).toBe(false);
    configureAuth();
    expect(isPublicAuthConfigured()).toBe(true);
    vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN", "");
    expect(isPublicAuthConfigured()).toBe(false);
  });
});
