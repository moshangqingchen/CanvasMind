import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkLoginAllowed,
  clientKey,
  LOGIN_RATE_LIMIT,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginRateLimit,
} from "./login-rate-limit";

beforeEach(() => {
  resetLoginRateLimit();
});

afterEach(() => {
  resetLoginRateLimit();
});

describe("clientKey", () => {
  it("prefers the first x-forwarded-for entry", () => {
    const request = new Request("https://example.com/api/public-auth/login", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    expect(clientKey(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip and then a shared bucket", () => {
    expect(
      clientKey(
        new Request("https://example.com/", {
          headers: { "x-real-ip": "198.51.100.7" },
        }),
      ),
    ).toBe("198.51.100.7");
    expect(clientKey(new Request("https://example.com/"))).toBe("unknown");
  });
});

describe("login throttle", () => {
  it("blocks a client after the failure budget is spent", () => {
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT.MAX_FAILURES_PER_CLIENT; i += 1) {
      expect(checkLoginAllowed("client-a", now).allowed).toBe(true);
      recordLoginFailure("client-a", now);
    }

    const verdict = checkLoginAllowed("client-a", now);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not penalise an unrelated client", () => {
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT.MAX_FAILURES_PER_CLIENT; i += 1) {
      recordLoginFailure("client-a", now);
    }
    expect(checkLoginAllowed("client-b", now).allowed).toBe(true);
  });

  it("releases the block once the window rolls over", () => {
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT.MAX_FAILURES_PER_CLIENT; i += 1) {
      recordLoginFailure("client-a", now);
    }
    expect(checkLoginAllowed("client-a", now).allowed).toBe(false);
    expect(
      checkLoginAllowed("client-a", now + LOGIN_RATE_LIMIT.WINDOW_MS + 1)
        .allowed,
    ).toBe(true);
  });

  it("clears the client budget after a successful login", () => {
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT.MAX_FAILURES_PER_CLIENT; i += 1) {
      recordLoginFailure("client-a", now);
    }
    recordLoginSuccess("client-a");
    expect(checkLoginAllowed("client-a", now).allowed).toBe(true);
  });

  it("still throttles a spray across many distinct clients", () => {
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT.MAX_FAILURES_GLOBAL; i += 1) {
      recordLoginFailure(`client-${i}`, now);
    }
    expect(checkLoginAllowed("brand-new-client", now).allowed).toBe(false);
  });
});
