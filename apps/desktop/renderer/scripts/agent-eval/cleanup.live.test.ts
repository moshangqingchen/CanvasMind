import { it } from "vitest";
import { writeExclusiveJson } from "./budget";
import { removeIsolatedCredentials } from "./cleanup";
import { EVALUATION_TEMP, EVALUATION_LOG } from "./paths";
import { join } from "node:path";

it.skipIf(process.env.AGENT_EVAL_CLEANUP !== "confirmed-stage-three-finished")("remove all isolated credentials after the final evaluation", () => {
  const removed = removeIsolatedCredentials(EVALUATION_TEMP);
  writeExclusiveJson(join(EVALUATION_LOG, `credential-cleanup-${Date.now()}.json`),
    { at: new Date().toISOString(), removed, remaining: removeIsolatedCredentials(EVALUATION_TEMP), officialProfileModified: false });
});
