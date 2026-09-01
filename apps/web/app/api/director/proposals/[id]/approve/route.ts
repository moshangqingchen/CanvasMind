import {
  MAX_SMALL_JSON_BODY_BYTES,
  parseJsonRequest,
  parseRouteIdentifier,
} from "../../../../../../lib/api-validation";
import { approveDirectorProposal } from "../../../../../../lib/director-service";
import { DirectorProposalApprovalSchema } from "../../../_schemas";
import { directorErrorResponse } from "../../../_shared";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const proposalId = parseRouteIdentifier(params.id, "导演方案 ID");
  if (!proposalId.success) return proposalId.response;
  const parsed = await parseJsonRequest(
    request,
    DirectorProposalApprovalSchema,
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!parsed.success) return parsed.response;

  try {
    return Response.json(
      await approveDirectorProposal({
        proposalId: proposalId.data,
        version: parsed.data.version,
        canvasRevision: parsed.data.canvasRevision,
      }),
    );
  } catch (error) {
    return directorErrorResponse(error);
  }
}
