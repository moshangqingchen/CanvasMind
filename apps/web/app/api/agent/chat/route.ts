import { decryptSecret } from "@super-canvas/providers";
import {
  AgentChatRequestSchema,
  parseJsonRequest,
} from "../../../../lib/api-validation";
import { loadCangyuanCatalog } from "../../../../lib/cangyuan-catalog";
import {
  CANGYUAN_IMAGE_BASE_URL,
  CANGYUAN_IMAGE_PRESET_ID,
} from "../../../../lib/provider-presets";
import { requireServerMasterKey } from "../../../../lib/master-key";
import { jsonError, repository } from "../../../../lib/server";

const CHAT_ENDPOINT = `${CANGYUAN_IMAGE_BASE_URL}/v1/chat/completions`;
const RESPONSES_ENDPOINT = `${CANGYUAN_IMAGE_BASE_URL}/v1/responses`;
const CHAT_TIMEOUT_MS = 120_000;
const MAX_UPSTREAM_ERROR_LENGTH = 600;

interface UpstreamMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | {
            type: "image_url";
            image_url: { url: string; detail?: "auto" | "low" | "high" };
          }
        | {
            type: "input_audio";
            input_audio: {
              data: string;
              format: "wav" | "mp3" | "m4a" | "webm";
            };
          }
      >;
}

type ResponsesInputPart =
  | { type: "input_text"; text: string }
  | {
      type: "input_image";
      image_url: string;
      detail?: "auto" | "low" | "high";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assistantContent(payload: unknown): string | null {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    const outputText = payload.output_text.trim();
    if (outputText) return outputText;
  }
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return null;
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  const content = choice.message.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (!Array.isArray(content)) return null;
  const text = content
    .flatMap((part) =>
      isRecord(part) &&
      (part.type === "text" || part.type === "output_text") &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("\n")
    .trim();
  return text || null;
}

function responsesAssistantContent(payload: unknown): string | null {
  const direct = assistantContent(payload);
  if (direct) return direct;
  if (!isRecord(payload) || !Array.isArray(payload.output)) return null;
  const text = payload.output
    .flatMap((item) => {
      if (!isRecord(item) || !Array.isArray(item.content)) return [];
      return item.content.flatMap((part) =>
        isRecord(part) &&
        (part.type === "output_text" || part.type === "text") &&
        typeof part.text === "string"
          ? [part.text]
          : [],
      );
    })
    .join("\n")
    .trim();
  return text || null;
}

function tokenUsage(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined;
  const usage = payload.usage;
  const number = (key: string) =>
    typeof usage[key] === "number" && Number.isFinite(usage[key])
      ? usage[key]
      : undefined;
  const promptTokens = number("prompt_tokens");
  const completionTokens = number("completion_tokens");
  const totalTokens = number("total_tokens");
  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  )
    return undefined;
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function contextMessage(context: {
  label: string;
  prompt?: string;
  assetKind?: "image" | "video" | "audio";
}): UpstreamMessage {
  const kind =
    context.assetKind === "video"
      ? "视频"
      : context.assetKind === "audio"
        ? "音频"
        : "图片";
  return {
    role: "system",
    content: [
      `当前画布选中了一个${kind}生成结果，名称为“${context.label}”。`,
      context.prompt
        ? `该结果的生成提示词是：${context.prompt}`
        : "当前没有可用的生成提示词。",
      "请把这些信息作为当前画布上下文；不要声称已经直接看到了未随请求发送的媒体像素或画面。",
    ].join("\n"),
  };
}

function redactUpstreamDetail(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/giu, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]{8,}/giu, "sk-***")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=_-]+/giu, "data:…")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_UPSTREAM_ERROR_LENGTH);
}

function upstreamDetail(payload: unknown): string | null {
  if (typeof payload === "string") {
    const detail = redactUpstreamDetail(payload);
    return detail || null;
  }
  if (!isRecord(payload)) return null;
  if (typeof payload.message === "string")
    return redactUpstreamDetail(payload.message) || null;
  if (typeof payload.detail === "string")
    return redactUpstreamDetail(payload.detail) || null;
  if (typeof payload.error === "string")
    return redactUpstreamDetail(payload.error) || null;
  if (isRecord(payload.error)) return upstreamDetail(payload.error);
  return null;
}

async function readUpstreamDetail(response: Response): Promise<string | null> {
  const raw = await response.text().catch(() => "");
  if (!raw) return null;
  try {
    return upstreamDetail(JSON.parse(raw) as unknown);
  } catch {
    return upstreamDetail(raw);
  }
}

function upstreamError(
  status: number,
  detail?: string | null,
): { message: string; status: number } {
  const suffix = detail ? ` 上游原因：${detail}` : "";
  if (status === 401 || status === 403)
    return {
      message: `导演台 API 身份验证失败，请检查当前对话群组自己的 API Key 和模型权限。${suffix}`,
      status: 401,
    };
  if (status === 429)
    return {
      message: `导演台对话请求过于频繁或已达到当前 Key 的用量限制，请稍后重试。${suffix}`,
      status: 429,
    };
  if (status >= 500)
    return {
      message: `沧元对话上游暂时不可用（HTTP ${status}），请稍后重试。${suffix}`,
      status: 502,
    };
  return {
    message: `沧元拒绝了当前对话请求（HTTP ${status}）。${suffix || " 请检查模型参数或输入格式。"}`,
    status: 422,
  };
}

function responseRequestBody(
  model: string,
  messages: UpstreamMessage[],
  reasoningEffort?:
    "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .flatMap((message) =>
      typeof message.content === "string"
        ? [message.content]
        : message.content.flatMap((part) =>
            part.type === "text" ? [part.text] : [],
          ),
    )
    .join("\n\n");
  const input = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map((part): ResponsesInputPart => {
              if (part.type === "text")
                return { type: "input_text", text: part.text };
              if (part.type === "image_url")
                return {
                  type: "input_image",
                  image_url: part.image_url.url,
                  ...(part.image_url.detail
                    ? { detail: part.image_url.detail }
                    : {}),
                };
              return {
                type: "input_text",
                text: "当前消息附带了音频，但此兼容接口无法安全转换该音频输入。请明确告知用户改用支持音频输入的模型。",
              };
            }),
    }));
  return {
    model,
    input,
    ...(instructions ? { instructions } : {}),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
  };
}

function shouldTryResponses(status: number, model: string): boolean {
  return /^gpt-/iu.test(model) && [400, 404, 405, 415, 422].includes(status);
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(request, AgentChatRequestSchema);
  if (!parsed.success) return parsed.response;

  const connection = await repository.getConnection(parsed.data.connectionId);
  if (!connection) return jsonError("导演台 API 连接不存在", 404);
  if (
    connection.config.preset !== CANGYUAN_IMAGE_PRESET_ID ||
    connection.config.usage !== "agent"
  )
    return jsonError("所选连接不是右侧导演台的独立对话连接", 422);

  const groupId =
    typeof connection.config.modelGroup === "string"
      ? connection.config.modelGroup.trim()
      : "";
  if (!groupId) return jsonError("导演台连接缺少模型群组", 422);

  const catalog = await loadCangyuanCatalog();
  const group = catalog.marketplaceGroups.find((item) => item.id === groupId);
  if (!group && catalog.source === "fallback")
    return jsonError("沧元实时模型目录暂不可用，无法安全校验导演台模型", 503);
  const model = group?.models.find(
    (item) => item.id === parsed.data.model && item.capability === "chat",
  );
  if (!model)
    return jsonError(
      "所选模型不是当前导演台群组中的对话模型，请刷新后重选",
      422,
    );

  if (!connection.encryptedSecret)
    return jsonError("当前导演台群组尚未配置 API Key", 409);
  let apiKey: string;
  try {
    apiKey = decryptSecret(
      connection.encryptedSecret,
      requireServerMasterKey(),
    );
  } catch {
    return jsonError(
      "当前导演台群组的旧密文无法解密，请在 API 设置中重新填写该群组自己的 Key。",
      409,
    );
  }

  const messages: UpstreamMessage[] = [
    {
      role: "system",
      content:
        "你是超级画布右侧导演台的创作智能体。请用中文清晰回答，协助分析创作意图、改写提示词、规划镜头和完善视觉方案。",
    },
    ...(parsed.data.context ? [contextMessage(parsed.data.context)] : []),
    ...parsed.data.messages,
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    let response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model.id,
        messages,
        stream: false,
        ...(parsed.data.reasoningEffort
          ? { reasoning_effort: parsed.data.reasoningEffort }
          : {}),
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const chatStatus = response.status;
      const chatDetail = await readUpstreamDetail(response);
      if (!shouldTryResponses(chatStatus, model.id)) {
        const error = upstreamError(chatStatus, chatDetail);
        return jsonError(error.message, error.status);
      }
      response = await fetch(RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          responseRequestBody(model.id, messages, parsed.data.reasoningEffort),
        ),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        const responsesDetail = await readUpstreamDetail(response);
        const combinedDetail = [
          chatDetail ? `Chat Completions：${chatDetail}` : "",
          responsesDetail ? `Responses：${responsesDetail}` : "",
        ]
          .filter(Boolean)
          .join("；");
        const error = upstreamError(
          response.status,
          combinedDetail || responsesDetail || chatDetail,
        );
        return jsonError(error.message, error.status);
      }
    }
    const payload = (await response.json()) as unknown;
    const content = responsesAssistantContent(payload);
    if (!content) return jsonError("沧元对话接口没有返回可显示的助手文本", 502);
    const usage = tokenUsage(payload);
    return Response.json({
      message: { role: "assistant", content },
      model: model.id,
      group: groupId,
      ...(usage ? { usage } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      return jsonError("导演台对话请求超时，请稍后重试", 504);
    return jsonError("无法连接沧元对话接口，请检查网络后重试", 502);
  } finally {
    clearTimeout(timeout);
  }
}
