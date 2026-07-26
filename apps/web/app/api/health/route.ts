import { repository, storage } from "../../../lib/server";

export async function GET() {
  try {
    const [canvas] = await Promise.all([
      repository.ensureDefaultCanvas(),
      storage.healthCheck?.(),
    ]);
    return Response.json({
      ok: true,
      canvasId: canvas.id,
      components: {
        database: "ready",
        storage: "ready",
        queue: process.env.REDIS_URL ? "configured" : "in-process",
      },
      time: new Date().toISOString(),
    });
  } catch {
    return Response.json(
      {
        ok: false,
        error: "健康检查失败",
        time: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
