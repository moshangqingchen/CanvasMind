export interface GraphicDesignExtractionModel {
  connectionId: string;
  modelId: string;
  modelName: string;
  connectionName: string;
  supplierName: string;
  available: boolean;
  reason?: string;
  capabilities: { imageInput: boolean };
}

export interface GraphicDesignExtractionInput {
  text: string;
  imageAssetIds: string[];
  connectionId: string;
  modelId: string;
}

export interface GraphicDesignExtractionResult {
  sourceText: string;
  images: Array<{ assetId: string; text: string; warnings: string[] }>;
  fields: {
    headline: string;
    subheadline: string;
    body: string;
    eventDate: string;
    location: string;
    callToAction: string;
    brandName: string;
    constraints: string;
  };
  warnings: string[];
}

export async function loadGraphicDesignExtractionModels(): Promise<
  GraphicDesignExtractionModel[]
> {
  const response = await fetch("/api/agent/models", {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data))
    throw new Error(data?.error || "读取内容提取模型失败，请重试");
  return data as GraphicDesignExtractionModel[];
}

export async function extractGraphicDesignContent(
  input: GraphicDesignExtractionInput,
  signal?: AbortSignal,
): Promise<GraphicDesignExtractionResult> {
  const timeout = AbortSignal.timeout(125_000);
  const response = await fetch("/api/graphic-design/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new Error(data?.error || "内容提取失败，原始内容已保留，请重试");
  if (
    data.sourceText !== input.text ||
    !Array.isArray(data.images) ||
    data.images.length !== input.imageAssetIds.length ||
    input.imageAssetIds.some(
      (id) =>
        data.images.filter(
          (image: { assetId?: unknown }) => image.assetId === id,
        ).length !== 1,
    ) ||
    !data.fields ||
    !Array.isArray(data.warnings)
  )
    throw new Error("提取结果与原始内容不一致，原始内容已保留，请重试");
  return data as GraphicDesignExtractionResult;
}
