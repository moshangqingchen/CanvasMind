import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DirectorProfileRecord,
  ProviderConnectionRecord,
} from "@super-canvas/db";

const mocks = vi.hoisted(() => ({
  repository: {
    getConnection: vi.fn(),
    saveConnection: vi.fn(),
  },
}));

vi.mock("./server", () => ({ repository: mocks.repository }));

vi.mock("@super-canvas/providers", () => ({
  decryptSecret: vi.fn(),
}));

import {
  resolveDirectorConnection,
} from "./director-connections";

const connection: ProviderConnectionRecord = {
  id: "director-brain",
  name: "Director Brain",
  provider: "openai",
  encryptedSecret: "encrypted-secret",
  config: {
    usage: "agent",
    baseUrl: "https://api.openai.com/v1",
    unrelatedSupplierSetting: "must-stay-unchanged",
  },
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

const currentProfile: DirectorProfileRecord = {
  id: "default",
  brainConnectionId: "old-brain",
  brainModelId: "old-model",
  researchConnectionId: null,
  config: { existingDirectorSetting: "keep" },
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.repository.getConnection.mockResolvedValue(structuredClone(connection));
});

describe("resolveDirectorConnection", () => {
  it.each([
    { protocol: "anthropic-messages" },
    { directorProtocol: "anthropic-messages" },
    { baseUrl: "https://api.anthropic.com/v1" },
  ])("rejects legacy native configuration without rewriting stored settings: %o", async config => {
    const saved = { ...structuredClone(connection), config: { ...connection.config, ...config } };
    mocks.repository.getConnection.mockResolvedValue(saved);
    await expect(resolveDirectorConnection(currentProfile)).rejects.toThrow("支持已移除");
    expect(mocks.repository.saveConnection).not.toHaveBeenCalled();
  });

  it("rejects a saved Claude model even on a compatible endpoint", async () => {
    const profile = { ...currentProfile, brainModelId: "claude-sonnet-4-6" };
    await expect(resolveDirectorConnection(profile)).rejects.toThrow("支持已移除");
  });
  it("resolves a reused canvas group as the director brain", async () => {
    const { decryptSecret } = await import("@super-canvas/providers");
    vi.mocked(decryptSecret).mockReturnValue("plain-secret");
    mocks.repository.getConnection.mockResolvedValue({
      ...structuredClone(connection),
      id: "cangyuan-existing-group",
      config: {
        usage: "canvas",
        preset: "cangyuan-gpt-image-2",
        supplierKey: "cangyuan",
        modelGroup: "LLM-GPT-plus",
        baseUrl: "https://ai.cangyuansuanli.cn",
      },
    });

    await expect(
      resolveDirectorConnection({
        ...currentProfile,
        brainConnectionId: "cangyuan-existing-group",
        brainModelId: "gpt-5.4",
      }),
    ).resolves.toMatchObject({
      id: "cangyuan-existing-group",
      model: "gpt-5.4",
      baseUrl: "https://ai.cangyuansuanli.cn/v1",
    });
  });

  it("still rejects a disabled supplier group", async () => {
    mocks.repository.getConnection.mockResolvedValue({
      ...structuredClone(connection),
      config: { ...connection.config, usage: "disabled" },
    });
    await expect(
      resolveDirectorConnection(currentProfile),
    ).rejects.toThrow("已停用");
  });
});
