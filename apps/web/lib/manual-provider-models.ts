import type { ModelDescriptor } from "@super-canvas/providers";
import { z } from "zod";

export const ManualProviderModelSchema = z
  .object({
    id: z.string().trim().min(1).max(256),
    name: z.string().trim().max(256).optional(),
    capability: z.enum(["image", "video", "chat"]),
    protocol: z.enum([
      "openai-images",
      "openai-videos",
      "chat-completions",
      "responses",
      "gemini",
      "rest",
      "anthropic-messages",
      "google-generate-content",
      "xai-responses",
      "generic-openai-compatible",
    ]),
  })
  .strict();
export const ManualProviderModelsSchema = z
  .array(ManualProviderModelSchema)
  .max(500);
export class ManualModelValidationError extends Error {}

export function validateManualProviderModels(
  provider: string,
  config: Record<string, unknown>,
): void {
  if (config.manualModels === undefined) return;
  const parsed = ManualProviderModelsSchema.safeParse(config.manualModels);
  if (!parsed.success)
    throw new ManualModelValidationError(
      "手动模型需要有效的 ID、能力和调用协议",
    );
  const models = parsed.data;
  if (new Set(models.map((model) => model.id)).size !== models.length)
    throw new ManualModelValidationError("手动模型 ID 不能重复");
  for (const model of models) {
    if (config.usage === "agent") {
      if (
        model.capability !== "chat" ||
        ![
          "chat-completions",
          "responses",
          "anthropic-messages",
          "google-generate-content",
          "xai-responses",
          "generic-openai-compatible",
        ].includes(model.protocol)
      )
        throw new ManualModelValidationError(
          "智能体连接只能添加匹配其协议的对话模型",
        );
      const protocol =
        typeof config.protocol === "string"
          ? config.protocol
          : "chat-completions";
      if (model.protocol !== protocol)
        throw new ManualModelValidationError(
          "模型协议必须与智能体连接的协议相同",
        );
    } else if (provider === "openai") {
      if (model.capability !== "image" || model.protocol !== "openai-images")
        throw new ManualModelValidationError(
          "OpenAI 图片连接只能添加图片模型；视频请使用已配置协议的 REST 连接",
        );
    } else if (provider === "weai") {
      const gemini =
        String(config.protocol ?? "").startsWith("gemini") ||
        config.modelGroup === "gemini香蕉";
      if (
        model.capability !== "image" ||
        model.protocol !== (gemini ? "gemini" : "openai-images")
      )
        throw new ManualModelValidationError(
          "手动图片模型的协议必须与当前 We-AI 分组协议一致",
        );
      const allowed = Array.isArray(config.allowedModels)
        ? config.allowedModels
        : undefined;
      if (allowed?.length && !allowed.includes(model.id))
        throw new ManualModelValidationError(
          "该模型不在当前分组已配置的协议目录中，请先在高级连接配置中确认支持",
        );
    } else if (provider === "rest") {
      const connector = config.connector as
        { models?: ModelDescriptor[] } | undefined;
      const descriptor = connector?.models?.find(
        (entry) => entry.id === model.id,
      );
      const required =
        model.capability === "video" ? "video.generate" : "image.generate";
      if (
        model.protocol !== "rest" ||
        model.capability === "chat" ||
        !descriptor?.operations?.includes(required)
      )
        throw new ManualModelValidationError(
          "请先在 REST 连接器中为该模型配置图片或视频调用协议",
        );
    } else
      throw new ManualModelValidationError("此连接类型暂不支持添加手动模型");
  }
  config.manualModels = models;
}

export function manualProviderModelDescriptors(connection: {
  provider: string;
  config: Record<string, unknown>;
}): ModelDescriptor[] {
  const config = { ...connection.config };
  try {
    validateManualProviderModels(connection.provider, config);
  } catch {
    return [];
  }
  const models = ManualProviderModelsSchema.safeParse(
    config.manualModels ?? [],
  );
  if (
    config.supplierArchived === true ||
    !models.success ||
    ["unauthorized", "empty"].includes(String(config.modelScanStatus))
  )
    return [];
  return models.data.map((model) => ({
    id: model.id,
    name: model.name || model.id,
    provider: connection.provider,
    operations:
      model.capability === "image"
        ? ["image.generate", "image.edit"]
        : model.capability === "video"
          ? ["video.generate", "video.image-to-video"]
          : [],
    inputKinds: model.capability === "image" ? ["text", "image"] : ["text"],
    outputKinds: [model.capability === "chat" ? "text" : model.capability],
    metadata: {
      source: "manual",
      protocol: model.protocol,
      canvasRunnable: model.capability !== "chat",
      catalogGroup: config.modelGroup || "默认群组",
    },
    isDefault: model.id === config.defaultModel,
  }));
}

/** A nonempty authenticated inventory is authoritative; manual entries cannot expand it. */
export function mergeManualProviderModels(
  connection: { provider: string; config: Record<string, unknown> },
  scanned: ModelDescriptor[],
  authoritative = false,
): ModelDescriptor[] {
  const byId = new Map(scanned.map((model) => [model.id, model]));
  for (const model of manualProviderModelDescriptors(connection)) {
    if (
      (authoritative || Array.isArray(connection.config.scannedModelIds)) &&
      !byId.has(model.id)
    )
      continue;
    const previous = byId.get(model.id);
    if (
      previous?.metadata?.canvasRunnable === false &&
      /无权|权限|下架|停用|实时扫描未返回/iu.test(
        String(previous.metadata?.canvasUnavailableReason ?? ""),
      )
    )
      continue;
    byId.set(model.id, {
      ...previous,
      ...model,
      ...(previous?.operations.length
        ? { operations: previous.operations }
        : {}),
      metadata: { ...previous?.metadata, ...model.metadata },
    });
  }
  return [...byId.values()];
}
