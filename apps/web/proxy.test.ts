import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const SESSION_TOKEN = "session-token-value";

beforeEach(() => {
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_USER", "");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_PASSWORD", "");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN", "");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_TRUSTED_HOSTS", "");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK", "");
  vi.stubEnv("PUBLIC_BASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function configureAuth() {
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_USER", "creator");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_PASSWORD", "correct horse");
  vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN", SESSION_TOKEN);
}

function request(
  path: string,
  options: {
    host?: string;
    method?: string;
    origin?: string;
    session?: string;
  } = {},
) {
  const host = options.host ?? "canvas.example.com";
  const headers = new Headers({ host });
  if (options.origin) headers.set("origin", options.origin);
  if (options.session)
    headers.set("cookie", `super_canvas_session=${options.session}`);
  return new NextRequest(`http://${host}${path}`, {
    method: options.method ?? "GET",
    headers,
  });
}

/** `NextResponse.next()` is the "let it through" signal. */
function passedThrough(response: Response) {
  return response.headers.get("x-middleware-next") === "1";
}

describe("proxy auth gate", () => {
  it("lets everything through when no credentials are configured", () => {
    expect(passedThrough(proxy(request("/")))).toBe(true);
    expect(passedThrough(proxy(request("/api/canvas")))).toBe(true);
  });

  it("protects an arbitrary public hostname, not just one hard-coded domain", () => {
    configureAuth();

    const page = proxy(request("/", { host: "some-other-domain.com" }));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");

    const api = proxy(request("/api/canvas", { host: "203.0.113.9" }));
    expect(api.status).toBe(401);
  });

  it("still allows loopback access without a login", () => {
    configureAuth();
    expect(passedThrough(proxy(request("/", { host: "localhost" })))).toBe(
      true,
    );
    expect(passedThrough(proxy(request("/", { host: "127.0.0.1" })))).toBe(
      true,
    );
  });

  it("can require login from loopback as well", () => {
    configureAuth();
    vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK", "false");
    expect(proxy(request("/", { host: "localhost" })).status).toBe(307);
  });

  it("lets an authenticated health probe through when loopback login is required", () => {
    configureAuth();
    vi.stubEnv("SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK", "false");

    expect(proxy(request("/api/health", { host: "127.0.0.1" })).status).toBe(
      401,
    );
    expect(
      passedThrough(
        proxy(
          request("/api/health", {
            host: "127.0.0.1",
            session: SESSION_TOKEN,
          }),
        ),
      ),
    ).toBe(true);
  });

  it("accepts a valid session cookie on a protected host", () => {
    configureAuth();
    expect(passedThrough(proxy(request("/", { session: SESSION_TOKEN })))).toBe(
      true,
    );
  });

  it("rejects a wrong session cookie", () => {
    configureAuth();
    expect(proxy(request("/", { session: "not-the-token" })).status).toBe(307);
  });

  it("keeps login, signed provider assets, and webhooks reachable", () => {
    configureAuth();
    expect(passedThrough(proxy(request("/login")))).toBe(true);
    expect(
      passedThrough(
        proxy(request("/api/public-auth/login", { method: "POST" })),
      ),
    ).toBe(true);
    expect(
      passedThrough(
        proxy(request("/api/webhooks/rest/connection-1", { method: "POST" })),
      ),
    ).toBe(true);
    expect(
      passedThrough(
        proxy(request("/api/provider-assets/asset-1?token=signed")),
      ),
    ).toBe(true);
  });
});

describe("proxy cross-site write protection", () => {
  it("blocks a state-changing API call from a foreign origin", () => {
    configureAuth();
    const response = proxy(
      request("/api/canvas", {
        method: "POST",
        origin: "https://evil.example",
        session: SESSION_TOKEN,
      }),
    );
    expect(response.status).toBe(403);
  });

  it("allows same-origin writes", () => {
    configureAuth();
    expect(
      passedThrough(
        proxy(
          request("/api/canvas", {
            method: "POST",
            origin: "http://canvas.example.com",
            session: SESSION_TOKEN,
          }),
        ),
      ),
    ).toBe(true);
  });

  it("allows only the configured public app to bridge asset imports to loopback", () => {
    configureAuth();
    vi.stubEnv("PUBLIC_BASE_URL", "https://815rongai.com");

    expect(
      passedThrough(
        proxy(
          request("/api/assets/upload?name=image.png", {
            host: "127.0.0.1:3210",
            method: "POST",
            origin: "https://815rongai.com",
          }),
        ),
      ),
    ).toBe(true);
    expect(
      proxy(
        request("/api/assets/upload?name=image.png", {
          host: "127.0.0.1:3210",
          method: "POST",
          origin: "https://evil.example",
        }),
      ).status,
    ).toBe(403);

    expect(
      passedThrough(
        proxy(
          request("/api/assets/import-source", {
            host: "127.0.0.1:3210",
            method: "POST",
            origin: "https://815rongai.com",
          }),
        ),
      ),
    ).toBe(true);
    expect(
      proxy(
        request("/api/assets/import-source", {
          host: "127.0.0.1:3210",
          method: "POST",
          origin: "https://evil.example",
        }),
      ).status,
    ).toBe(403);

    expect(
      passedThrough(
        proxy(
          request("/api/assets/presign", {
            host: "127.0.0.1:3210",
            method: "POST",
            origin: "https://815rongai.com",
          }),
        ),
      ),
    ).toBe(true);
    expect(
      proxy(
        request("/api/assets/presign", {
          host: "127.0.0.1:3210",
          method: "POST",
          origin: "https://evil.example",
        }),
      ).status,
    ).toBe(403);
  });

  it("allows the configured public app to request updates through loopback", () => {
    configureAuth();
    vi.stubEnv("PUBLIC_BASE_URL", "https://815rongai.com");

    expect(
      passedThrough(
        proxy(
          request("/api/app-update", {
            host: "127.0.0.1:3210",
            method: "POST",
            origin: "https://815rongai.com",
          }),
        ),
      ),
    ).toBe(true);
    expect(
      proxy(
        request("/api/app-update", {
          host: "127.0.0.1:3210",
          method: "POST",
          origin: "https://evil.example",
        }),
      ).status,
    ).toBe(403);
  });

  it("does not block reads from another origin", () => {
    configureAuth();
    expect(
      passedThrough(
        proxy(
          request("/api/assets", {
            origin: "https://evil.example",
            session: SESSION_TOKEN,
          }),
        ),
      ),
    ).toBe(true);
  });

  it("leaves webhook callbacks alone", () => {
    configureAuth();
    expect(
      passedThrough(
        proxy(
          request("/api/webhooks/rest/connection-1", {
            method: "POST",
            origin: "https://provider.example",
          }),
        ),
      ),
    ).toBe(true);
  });
});

describe("proxy security headers", () => {
  it("sets hardening headers on every response", () => {
    const response = proxy(request("/"));
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
  });
});
