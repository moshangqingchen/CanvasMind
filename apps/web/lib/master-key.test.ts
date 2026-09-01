import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("server master key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("loads the configured local env file in a production server", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-master-key-"));
    const envFile = join(directory, ".local-public.env");
    await writeFile(envFile, "MASTER_KEY=production-local-test-key\n", "utf8");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MASTER_KEY", "");
    vi.stubEnv("SUPERCANVAS_ENV_FILE", envFile);
    vi.resetModules();

    const { serverMasterKey } = await import("./master-key");
    expect(serverMasterKey()).toBe("production-local-test-key");

    await rm(directory, { recursive: true, force: true });
  });

  it("loads local proxy settings when the launcher did not pre-load them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-proxy-env-"));
    const envFile = join(directory, ".local-public.env");
    await writeFile(
      envFile,
      "MASTER_KEY=proxy-test-key\nPUBLIC_BASE_URL=https://815rongai.com\nHTTP_PROXY=http://127.0.0.1:10090\nNODE_USE_ENV_PROXY=1\n",
      "utf8",
    );
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MASTER_KEY", "proxy-test-key");
    vi.stubEnv("HTTP_PROXY", "");
    vi.stubEnv("HTTPS_PROXY", "");
    vi.stubEnv("PROVIDER_HTTP_PROXY", "");
    vi.stubEnv("SUPERCANVAS_ENV_FILE", envFile);
    vi.resetModules();

    const { serverMasterKey } = await import("./master-key");
    expect(serverMasterKey()).toBe("proxy-test-key");
    expect(process.env.HTTP_PROXY).toBe("http://127.0.0.1:10090");
    expect(process.env.NODE_USE_ENV_PROXY).toBe("1");
    expect(process.env.PUBLIC_BASE_URL).toBe("https://815rongai.com");

    await rm(directory, { recursive: true, force: true });
  });
});
