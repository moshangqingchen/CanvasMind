import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret } from "@super-canvas/providers";
import { readCloudGenerationConfig, saveCloudGenerationConfig } from "../src/cloud-generation.js";

const endpoint = "https://cloud.example.com";
const masterKey = "cloud-config-recovery-test";
const token = "replacement-cloud-token-".repeat(3);
let directory: string;
const configFile = () => join(directory, "cloud-generation.json");

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "canvas-cloud-config-"));
  vi.stubEnv("LOCAL_DATABASE_PATH", join(directory, "db.json"));
  vi.stubEnv("MASTER_KEY", masterKey);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("cloud configuration recovery", () => {
  it.each(["{truncated", "null", JSON.stringify({ endpoint, encryptedToken: 123 })])(
    "replaces damaged configuration when a complete new credential is provided: %s", async damaged => {
      await writeFile(configFile(), damaged);
      await expect(readCloudGenerationConfig()).rejects.toThrow("请重新保存");
      await expect(saveCloudGenerationConfig({ endpoint, token })).resolves.toEqual({ endpoint, tokenConfigured: true });
      const saved = await readCloudGenerationConfig();
      expect(decryptSecret(saved!.encryptedToken, masterKey)).toBe(token);
      expect(await readFile(configFile(), "utf8")).not.toContain(token);
    },
  );

  it("preserves a valid credential on same-endpoint saves and requires a new one for another endpoint", async () => {
    await saveCloudGenerationConfig({ endpoint, token });
    const before = await readFile(configFile(), "utf8");
    await expect(saveCloudGenerationConfig({ endpoint, token: " " })).resolves.toEqual({ endpoint, tokenConfigured: true });
    expect(await readFile(configFile(), "utf8")).toBe(before);
    await expect(saveCloudGenerationConfig({ endpoint: "https://other.example.com" })).rejects.toThrow("访问密钥");
    expect(await readFile(configFile(), "utf8")).toBe(before);
  });

  it("does not overwrite damaged configuration without a usable replacement credential", async () => {
    await writeFile(configFile(), "{truncated");
    await expect(saveCloudGenerationConfig({ endpoint })).rejects.toThrow("请重新保存");
    await expect(saveCloudGenerationConfig({ endpoint, token: "short" })).rejects.toThrow("访问密钥");
    expect(await readFile(configFile(), "utf8")).toBe("{truncated");
  });
});
