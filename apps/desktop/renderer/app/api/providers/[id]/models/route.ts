import { readProviderModelInventory } from "../../../../../lib/provider-model-inventory";

/** The same inventory service supplies the canvas, director and agent. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return readProviderModelInventory(request, context);
}