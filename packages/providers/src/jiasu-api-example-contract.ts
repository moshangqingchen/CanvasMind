const JIASU_ORIGIN = "https://ai.jiasuapi.com";
export interface JiasuVideoApiExampleTemplate {
  sourceUrl: string;
  checkedAt: string;
  sourceSha256: string;
  sourceStatus: "live" | "snapshot";
  templateKind: "model-plaza-openai-video";
  pollPath: string;
  values: { duration: number; ratio: string; resolution: string };
  fields: readonly string[];
}
export interface JiasuVideoApiExampleContract extends JiasuVideoApiExampleTemplate {
  modelId: string;
  submitPath: string;
  submitMethod: "POST";
  pollMethod: "GET";
  authentication: "bearer";
  bodyMode: "json";
  exhaustiveValues: false;
}

/** Browser-safe evidence: examples never become closed capability enums/defaults. */
export const JIASU_VIDEO_API_EXAMPLE_SNAPSHOT: JiasuVideoApiExampleTemplate = {
  sourceUrl: `${JIASU_ORIGIN}/static/js/index.723048e8ea.js`,
  checkedAt: "2026-10-11T01:26:30.512Z",
  sourceSha256: "8834f058ca4c354cc01f2356800571465b4ab79fbee582e143d5d6934a5e54de",
  sourceStatus: "snapshot", templateKind: "model-plaza-openai-video",
  pollPath: "/v1/videos/tasks/{task_id}", values: { duration: 5, ratio: "16:9", resolution: "720p" },
  fields: ["model", "prompt", "duration", "ratio", "resolution", "images", "audios"],
};

/** The plaza renders this template with each row's complete model_name. */
export function jiasuVideoApiExampleContract(modelId: string, template = JIASU_VIDEO_API_EXAMPLE_SNAPSHOT,
  endpoint: { path: string; method: string } = { path: "/v1/video/generations", method: "POST" }): JiasuVideoApiExampleContract | undefined {
  if (!modelId.trim() || modelId.length > 512 || endpoint.method !== "POST" ||
      !/^\/v1\/[a-zA-Z0-9_/-]+$/u.test(endpoint.path)) return undefined;
  return { ...template, values: { ...template.values }, fields: [...template.fields], modelId,
    submitPath: endpoint.path, submitMethod: "POST", pollMethod: "GET", authentication: "bearer", bodyMode: "json", exhaustiveValues: false };
}

/** Compare public evidence for one exact ID. A snapshot never supersedes live. */
export function latestJiasuVideoApiExampleContract(modelId: string, ...values: unknown[]): JiasuVideoApiExampleContract | undefined {
  let best: JiasuVideoApiExampleContract | undefined;
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const candidate = value as JiasuVideoApiExampleContract;
    if (candidate.modelId !== modelId || candidate.templateKind !== "model-plaza-openai-video" ||
      !["live", "snapshot"].includes(candidate.sourceStatus) || typeof candidate.sourceSha256 !== "string" || !/^[a-f\d]{64}$/u.test(candidate.sourceSha256) ||
      typeof candidate.checkedAt !== "string" || !Number.isFinite(Date.parse(candidate.checkedAt)) || candidate.submitMethod !== "POST" || candidate.pollMethod !== "GET" ||
      candidate.authentication !== "bearer" || candidate.bodyMode !== "json" || candidate.exhaustiveValues !== false ||
      typeof candidate.submitPath !== "string" || !/^\/v1\/[a-zA-Z0-9_/-]+$/u.test(candidate.submitPath) || candidate.pollPath !== "/v1/videos/tasks/{task_id}") continue;
    if (!candidate.values || typeof candidate.values !== "object" || Array.isArray(candidate.values) || !Number.isSafeInteger(candidate.values.duration) || candidate.values.duration <= 0 ||
      typeof candidate.values.ratio !== "string" || !candidate.values.ratio.trim() || typeof candidate.values.resolution !== "string" || !candidate.values.resolution.trim() ||
      !Array.isArray(candidate.fields) || !candidate.fields.length || !candidate.fields.every(field => typeof field === "string" && /^[a-zA-Z][a-zA-Z\d_]{0,63}$/u.test(field))) continue;
    try {
      const url = new URL(candidate.sourceUrl);
      if (url.origin !== JIASU_ORIGIN || !/^\/static\/js\/index\.[\da-f]+\.js$/u.test(url.pathname) ||
        url.username || url.password || url.search || url.hash) continue;
    } catch { continue; }
    if (!best || candidate.sourceStatus === "live" && best.sourceStatus !== "live" ||
      candidate.sourceStatus === best.sourceStatus && Date.parse(candidate.checkedAt) > Date.parse(best.checkedAt)) best = candidate;
  }
  return best;
}
