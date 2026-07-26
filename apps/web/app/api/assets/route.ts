import { publicAsset, repository } from "../../../lib/server";

export async function GET() {
  return Response.json((await repository.listAssets()).map(publicAsset));
}
