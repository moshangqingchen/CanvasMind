import { mockCliTemplate } from "../../../../lib/cli-connections-server";
import { jsonError } from "../../../../lib/server";

export const runtime = "nodejs";
export async function GET() {
  try { return Response.json(await mockCliTemplate(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return jsonError("模拟 CLI 文件缺失，请重新构建桌面运行资源", 503); }
}
