import { parseJsonRequest } from "../../../../lib/api-validation";
import {
  extractGraphicDesignBrief,
  GraphicDesignExtractionError,
  GraphicDesignExtractionRequestSchema,
} from "../../../../lib/graphic-design-extraction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(
    request,
    GraphicDesignExtractionRequestSchema,
    512 * 1024,
  );
  if (!parsed.success) return parsed.response;
  try {
    return Response.json(
      await extractGraphicDesignBrief(parsed.data, request.signal),
      {
        headers: { "cache-control": "private, no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof GraphicDesignExtractionError
            ? error.message
            : "客户资料提取失败，请重试；原文未改动",
      },
      {
        status:
          error instanceof GraphicDesignExtractionError ? error.status : 500,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }
}
