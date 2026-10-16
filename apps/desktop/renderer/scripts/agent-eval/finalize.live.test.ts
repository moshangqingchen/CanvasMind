import { it } from "vitest";
import { join } from "node:path";
import { finalizeSelectionSnapshot } from "./selection";
import { EVALUATION_TEMP, RENDERER_ROOT } from "./paths";
it.skipIf(process.env.AGENT_EVAL_FINALIZE !== "confirmed-isolated-source")("finalize previously captured model selection without source reread", async () => {
  const snapshot = await finalizeSelectionSnapshot(EVALUATION_TEMP, join(RENDERER_ROOT, "lib"));
  console.log(JSON.stringify({ connectionId: snapshot.connection.id, modelId: snapshot.connection.model,
    supplier: snapshot.option.supplierName, group: snapshot.option.group, protocol: snapshot.connection.protocol }));
});
