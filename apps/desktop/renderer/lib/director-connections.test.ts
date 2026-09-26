import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DirectorProfileRecord,
  ProviderConnectionRecord,
} from "@super-canvas/db";

const mocks = vi.hoisted(() => ({
  repository: {
    getConnection: vi.fn(),
    getDirectorProfile: vi.fn(),
    saveDirectorProfile: vi.fn(),
    saveConnection: vi.fn(),
  },
}));

vi.mock("./server", () => ({ repository: mocks.repository }));

vi.mock("@super-canvas/providers", () => ({
  decryptSecret: vi.fn(),
}));

import {
  resolveDirectorConnection,
  saveDirectorProfileConfiguration,
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
  mocks.repository.getDirectorProfile.mockResolvedValue(
    structuredClone(currentProfile),
  );
  mocks.repository.saveDirectorProfile.mockImplementation(async (input) => ({
    ...input,
    createdAt: currentProfile.createdAt,
    updatedAt: "2026-08-30T01:00:00.000Z",
  }));
});

describe("saveDirectorProfileConfiguration", () => {
  it("persists only the director profile and never rewrites its supplier connection", async () => {
    const connectionUnderTest = structuredClone(connection);
    const originalConnection = structuredClone(connectionUnderTest);
    mocks.repository.getConnection.mockResolvedValue(connectionUnderTest);

    await expect(
      saveDirectorProfileConfiguration({
        brainConnectionId: connection.id,
        brainModelId: "  gpt-5.2  ",
        protocol: "openai-responses",
        reasoningEffort: "high",
        manualRates: { USD: 7.2 },
      }),
    ).resolves.toMatchObject({
      id: "default",
      brainConnectionId: connection.id,
      brainModelId: "gpt-5.2",
    });

    expect(mocks.repository.saveDirectorProfile).toHaveBeenCalledTimes(1);
    expect(mocks.repository.saveDirectorProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "default",
        brainConnectionId: connection.id,
        brainModelId: "gpt-5.2",
        config: expect.objectContaining({
          existingDirectorSetting: "keep",
          protocol: "openai-responses",
          reasoningEffort: "high",
          manualRates: { USD: 7.2 },
        }),
      }),
    );
    expect(mocks.repository.saveConnection).not.toHaveBeenCalled();
    expect(connectionUnderTest).toEqual(originalConnection);
  });

  it("reuses an existing keyed canvas group without rewriting or duplicating it", async () => {
    const canvasConnection = {
      ...structuredClone(connection),
      id: "existing-supplier-group",
      config: {
        ...connection.config,
        usage: "canvas",
        supplierKey: "cangyuan",
        modelGroup: "LLM-GPT-plus",
      },
    };
    mocks.repository.getConnection.mockResolvedValue(canvasConnection);

    await expect(
      saveDirectorProfileConfiguration({
        brainConnectionId: canvasConnection.id,
        brainModelId: "gpt-5.4",
      }),
    ).resolves.toMatchObject({
      brainConnectionId: canvasConnection.id,
      brainModelId: "gpt-5.4",
    });
    expect(mocks.repository.saveConnection).not.toHaveBeenCalled();
  });

  it("clears a previously saved reasoning override when automatic is selected", async () => {
    mocks.repository.getDirectorProfile.mockResolvedValue({
      ...structuredClone(currentProfile),
      config: { reasoningEffort: "high", keep: true },
    });

    await saveDirectorProfileConfiguration({
      brainConnectionId: connection.id,
      brainModelId: "gpt-5.6",
      reasoningEffort: null,
    });

    expect(mocks.repository.saveDirectorProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.not.objectContaining({ reasoningEffort: expect.anything() }),
      }),
    );
    expect(mocks.repository.saveDirectorProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ keep: true }),
      }),
    );
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
      saveDirectorProfileConfiguration({
        brainConnectionId: connection.id,
        brainModelId: "gpt-5.4",
      }),
    ).rejects.toThrow("未停用");
  });
});
