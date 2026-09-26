import { imageDesignReviewInputSchema } from "@super-canvas/core";
import {
  ImageDesignReviewConflictError,
  ImageDesignReviewValidationError,
} from "@super-canvas/db";
import { repository, jsonError, publicAsset } from "../../../../../lib/server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("请提供有效的图片评审内容", 400);
  }
  const parsed = imageDesignReviewInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "图片评审参数无效：请选择有效状态，备注不超过 2000 字，并提供当前版本",
      400,
    );
  }
  const { id } = await context.params;
  try {
    const asset = await repository.updateImageDesignReview(id, parsed.data);
    return asset
      ? Response.json(publicAsset(asset))
      : jsonError("素材不存在或已删除", 404);
  } catch (error) {
    if (error instanceof ImageDesignReviewConflictError) {
      return Response.json(
        { error: error.message, asset: publicAsset(error.asset) },
        { status: 409 },
      );
    }
    if (error instanceof ImageDesignReviewValidationError) {
      return jsonError(error.message, 400);
    }
    throw error;
  }
}
