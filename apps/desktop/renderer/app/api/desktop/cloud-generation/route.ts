import { z } from "zod";
import { publicCloudGenerationConfig, readCloudGenerationConfig, saveCloudGenerationConfig, testCloudGeneration } from "@super-canvas/runtime";
import { parseJsonRequest } from "../../../../lib/api-validation";
import { jsonError } from "../../../../lib/server";

export async function GET() {
  try { return Response.json(publicCloudGenerationConfig(await readCloudGenerationConfig()), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return jsonError(error instanceof Error ? error.message : "配置读取失败", 400); }
}
export async function PATCH(request: Request) {
  const parsed = await parseJsonRequest(request, z.object({ endpoint: z.string().max(2048), token: z.string().max(4096).optional() }).strict());
  if (!parsed.success) return parsed.response;
  try { return Response.json(await saveCloudGenerationConfig(parsed.data)); }
  catch (error) { return jsonError(error instanceof Error ? error.message : "配置保存失败", 400); }
}
export async function POST() {
  try { return Response.json(await testCloudGeneration()); }
  catch (error) { return jsonError(error instanceof Error ? error.message : "连接测试失败", 400); }
}
