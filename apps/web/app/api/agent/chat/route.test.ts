import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({
  repository: { getConnection: vi.fn() },
  loadCangyuanCatalog: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("../../../../lib/server", () => ({
  repository: mocks.repository,
  jsonError(message: string, status = 400) {
    return Response.json({ error: message }, { status });
  },
}));

vi.mock("../../../../lib/cangyuan-catalog", () => ({
  loadCangyuanCatalog: mocks.loadCangyuanCatalog,
}));

import { POST } from "./route";

const masterKey = "agent-chat-route-test-master-key";

const connection = {
  id: "director-pro",
  name: "沧元算力 · LLM-GPT-pro · 导演台",
  provider: "rest",
  encryptedSecret: encryptSecret("sk-director-test", masterKey),
  config: {
    preset: "cangyuan-gpt-image-2",
    usage: "agent",
    modelGroup: "LLM-GPT-pro",
  },
};

const personalConnection = {
  id: "personal-gpt-chat",
  name: "个人Gpt · 导演台对话",
  provider: "openai",
  encryptedSecret: encryptSecret("agt-personal-test", masterKey),
  config: {
    supplierKey: "个人Gpt",
    usage: "agent",
    modelGroup: "导演台对话",
    baseUrl: "http://localhost:18082/v1",
    defaultModel: "gpt-5.6-sol",
    allowedModels: ["gpt-5.6-sol", "gpt-5.4"],
    protocol: "responses",
  },
};

function request(model = "gpt-5.6-sol") {
  return new Request("http://localhost/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      connectionId: connection.id,
      model,
      messages: [{ role: "user", content: "优化这个画面" }],
      context: {
        label: "生成图片 1",
        prompt: "夜景电影感",
        assetKind: "image",
      },
    }),
  });
}

function requestWithImage() {
  return new Request("http://localhost/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      connectionId: connection.id,
      model: "gpt-5.6-sol",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "反推这张图的提示词" },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,aGVsbG8=",
                detail: "auto",
              },
            },
          ],
        },
      ],
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MASTER_KEY = masterKey;
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.repository.getConnection.mockResolvedValue(connection);
  mocks.loadCangyuanCatalog.mockResolvedValue({
    source: "live",
    marketplaceGroups: [
      {
        id: "LLM-GPT-pro",
        models: [
          {
            id: "gpt-5.6-sol",
            capability: "chat",
            name: "gpt-5.6-sol",
          },
        ],
      },
    ],
  });
});

describe("agent chat route", () => {
  it("uses a custom OpenAI-compatible Responses connection", async () => {
    mocks.repository.getConnection.mockResolvedValue(personalConnection);
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "个人 GPT 已连接。" }],
            },
          ],
          usage: { input_tokens: 7, output_tokens: 5, total_tokens: 12 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: { role: "assistant", content: "个人 GPT 已连接。" },
      model: "gpt-5.6-sol",
      group: "导演台对话",
      usage: { promptTokens: 7, completionTokens: 5, totalTokens: 12 },
    });
    const [url, init] = mocks.fetch.mock.calls[0]!;
    expect(url).toBe("http://localhost:18082/v1/responses");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer agt-personal-test",
    });
    const body = JSON.parse(String((init as RequestInit).body)) as {
      model: string;
      input: Array<{ role: string }>;
    };
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.input.at(-1)?.role).toBe("user");
  });

  it("rejects models outside a custom connection allowlist", async () => {
    mocks.repository.getConnection.mockResolvedValue(personalConnection);
    const response = await POST(request("gpt-image-2"));
    expect(response.status).toBe(422);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("uses only the selected director group key and returns assistant text", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { role: "assistant", content: "可以加强前景层次。" } },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: { role: "assistant", content: "可以加强前景层次。" },
      model: "gpt-5.6-sol",
      group: "LLM-GPT-pro",
      usage: { totalTokens: 20 },
    });
    const [url, init] = mocks.fetch.mock.calls[0]!;
    expect(url).toBe("https://ai.cangyuansuanli.cn/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer sk-director-test",
    });
    const body = JSON.parse(String((init as RequestInit).body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.messages.some((item) => item.role === "system")).toBe(true);
    expect(body.messages.at(-1)).toEqual({
      role: "user",
      content: "优化这个画面",
    });
  });

  it("does not allow a canvas connection in the director route", async () => {
    mocks.repository.getConnection.mockResolvedValue({
      ...connection,
      config: { ...connection.config, usage: "canvas" },
    });
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects a model outside the selected group before upstream billing", async () => {
    const response = await POST(request("gpt-image-2"));
    expect(response.status).toBe(422);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("falls back to the Responses API and converts image input for GPT models", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "chat payload is not supported" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [
                  { type: "output_text", text: "这是一张电影感打斗画面。" },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const response = await POST(requestWithImage());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: { role: "assistant", content: "这是一张电影感打斗画面。" },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1]?.[0]).toBe(
      "https://ai.cangyuansuanli.cn/v1/responses",
    );
    const responsesBody = JSON.parse(
      String((mocks.fetch.mock.calls[1]?.[1] as RequestInit).body),
    ) as {
      input: Array<{
        content: Array<{ type: string; image_url?: string }>;
      }>;
    };
    expect(responsesBody.input[0]?.content).toEqual([
      { type: "input_text", text: "反推这张图的提示词" },
      {
        type: "input_image",
        image_url: "data:image/png;base64,aGVsbG8=",
        detail: "auto",
      },
    ]);
  });

  it("returns sanitized upstream details instead of a misleading group error", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "unsupported messages; token sk-secret-value" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "input_image format rejected" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      );

    const response = await POST(requestWithImage());
    expect(response.status).toBe(422);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("Chat Completions：unsupported messages");
    expect(payload.error).toContain("Responses：input_image format rejected");
    expect(payload.error).not.toContain("sk-secret-value");
    expect(payload.error).not.toContain("模型属于所选群组");
  });
});
