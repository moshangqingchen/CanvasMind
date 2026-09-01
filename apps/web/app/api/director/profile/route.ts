import {
  publicDirectorProfile,
  saveDirectorProfileConfiguration,
} from "../../../../lib/director-connections";
import {
  MAX_SMALL_JSON_BODY_BYTES,
  parseJsonRequest,
} from "../../../../lib/api-validation";
import { DirectorProfilePatchSchema } from "../_schemas";
import { directorProfileErrorResponse } from "../_shared";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ profile: await publicDirectorProfile() });
  } catch (error) {
    return directorProfileErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const parsed = await parseJsonRequest(
    request,
    DirectorProfilePatchSchema,
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!parsed.success) return parsed.response;

  try {
    const profile = await saveDirectorProfileConfiguration(parsed.data);
    return Response.json({ profile: await publicDirectorProfile(profile) });
  } catch (error) {
    return directorProfileErrorResponse(error);
  }
}
