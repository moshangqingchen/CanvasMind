import {
  getUpdateConfig,
  updateManagerAvailable,
  readUpdateStatus,
} from "../../../lib/app-update";
import { releaseNotesForVersion } from "../../../lib/release-notes";
import { handleAppUpdatePost } from "./handler";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getUpdateConfig();
  const storedStatus = await readUpdateStatus();
  const status = config.enabled
    ? storedStatus
    : { ...storedStatus, phase: "disabled" as const, error: undefined };
  return Response.json(
    {
      ...status,
      enabled: config.enabled,
      repository: config.repository,
      intervalSeconds: config.intervalSeconds,
      managerAvailable: await updateManagerAvailable(),
      currentNotes: releaseNotesForVersion(status.currentVersion),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  return handleAppUpdatePost(request);
}
