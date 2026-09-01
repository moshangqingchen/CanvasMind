import { verifyProviderAssetToken } from "@super-canvas/providers";
import { jsonError } from "../../../../lib/server";
import { requireServerMasterKey } from "../../../../lib/master-key";
import { GET as getAssetContent } from "../../assets/[id]/content/route";

async function serve(
  request: Request,
  context: { params: Promise<{ id: string }> },
  headOnly: boolean,
) {
  const params = await context.params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (
    !verifyProviderAssetToken({
      assetId: params.id,
      secret: requireServerMasterKey(),
      token,
    })
  )
    return jsonError("Provider asset link is invalid or expired", 403);
  const response = await getAssetContent(request, {
    params: Promise.resolve(params),
  });
  const headers = new Headers(response.headers);
  // The signed URL is a short-lived bearer capability. Never let an
  // intermediary cache it beyond the token validation performed above.
  headers.set("cache-control", "private, no-store");
  return new Response(headOnly ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return serve(request, context, false);
}

export function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return serve(request, context, true);
}
