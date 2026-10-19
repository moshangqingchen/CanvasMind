import { expect, it, vi } from "vitest";
import { withSubmissionIdentity } from "./submission-identity";

it("shares in-flight rejection and fences delayed copies for the process lifetime", async () => {
  const owner = {};
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const work = vi.fn(async () => { await gate; return Response.json({ code: "RUN_PREFLIGHT_REJECTED", submissionPhase: "not_started" }, { status: 503 }); });
  const first = withSubmissionIdentity(owner, "canvas", "same", work);
  const duplicate = withSubmissionIdentity(owner, "canvas", "same", work);
  release();
  expect((await first).status).toBe(503);
  expect(await (await duplicate).json()).toMatchObject({ submissionPhase: "not_started" });
  const later = vi.fn(async () => Response.json({ paid: true }));
  expect((await withSubmissionIdentity(owner, "canvas", "same", later)).status).toBe(503);
  expect(work).toHaveBeenCalledOnce();
  expect(later).not.toHaveBeenCalled();
  await withSubmissionIdentity(owner, "canvas", "new", later);
  expect(later).toHaveBeenCalledOnce();
});

it("never fences an uncertain response as definite non-submission", async () => {
  const work = vi.fn(async () => Response.json({ error: "unknown" }, { status: 503 }));
  const owner = {};
  await withSubmissionIdentity(owner, "canvas", "same", work);
  await withSubmissionIdentity(owner, "canvas", "same", work);
  expect(work).toHaveBeenCalledTimes(2);
});
