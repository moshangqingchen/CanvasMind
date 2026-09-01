import { handleAppUpdatePost } from "../handler";

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const params = await context.params;
  return handleAppUpdatePost(request, params.action);
}
