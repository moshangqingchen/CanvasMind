import { jsonError } from "../../../../../lib/server";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { GET } = await import("../models/route");
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/test$/u, "/models");
  url.search = "?refresh=1";
  const response = await GET(new Request(url), context);
  if (!response.ok) return response;
  if (response.headers.get("X-Model-Scan-Status") === "stale")
    return jsonError("历史缓存，本次连接测试失败，请检查地址和 Key", 502);
  const models = (await response.json()) as unknown[];
  return Response.json({
    ok: true,
    message: `连接测试成功，当前 Key 返回 ${models.length} 个模型`,
    modelCount: models.length,
  });
}
