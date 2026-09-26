import {
  MAX_SMALL_JSON_BODY_BYTES,
  parseJsonRequest,
  parseRouteIdentifier,
} from "../../../../../lib/api-validation";
import { reviseDirectorProposal } from "../../../../../lib/director-service";
import { DirectorProposalRevisionSchema } from "../../_schemas";
import { directorErrorResponse } from "../../_shared";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const proposalId = parseRouteIdentifier(params.id, "导演方案 ID");
  if (!proposalId.success) return proposalId.response;
  const parsed = await parseJsonRequest(
    request,
    DirectorProposalRevisionSchema,
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!parsed.success) return parsed.response;

  try {
    const proposal = await reviseDirectorProposal({
      proposalId: proposalId.data,
      ...parsed.data,
    });
    return Response.json({ proposal });
  } catch (error) {
    return directorErrorResponse(error);
  }
}
