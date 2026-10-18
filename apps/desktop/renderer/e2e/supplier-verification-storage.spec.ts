import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";
import { FileRepository, type SupplierVerificationRecord } from "@super-canvas/db";
import sharp from "sharp";

const temporaryRoot = fileURLToPath(new URL("../../../../.codex-temp/verification-storage-e2e/", import.meta.url));
function canonicalHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`).join(",")}}`;
  };
  return createHash("sha256").update(canonical(JSON.parse(JSON.stringify(value)) as unknown)).digest("hex");
}

test("核验证据独立落盘后冷开完整读回，分组、原图和实扣仍可查看且不提交生成", async ({ page, request }, testInfo) => {
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "cold-open-"));
  const path = join(directory, "super-canvas.json");
  const errors: string[] = [];
  let writes = 0, submissions = 0, reads = 0, readFailures = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/runs", route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  await page.route(/\/api\/(?:agent|director)\//u, route => {
    if (route.request().method() !== "GET") { submissions++; return route.abort(); }
    return route.continue();
  });
  try {
    const uploaded = await request.post("/api/assets/upload", { multipart: { file: {
      name: "external-verification-fixture.png", mimeType: "image/png",
      buffer: await sharp({ create: { width: 96, height: 64, channels: 3, background: "#a89ce7" } }).png().toBuffer(),
    } } });
    expect(uploaded.ok()).toBeTruthy();
    const asset = await uploaded.json() as { id: string };
    const name = `独立核验证据-${Date.now()}`;
    const response = await request.post("/api/suppliers", { data: {
      name, supplierKey: "openai", siteUrl: "https://fixture.invalid", apiUrl: "https://fixture.invalid/v1", catalog: { groups: [] },
    } });
    expect(response.ok()).toBeTruthy();
    const supplier = await response.json() as { id: string };
    const record: SupplierVerificationRecord = {
      id: supplier.id, schemaVersion: 1, revision: 0, sourceId: "fixture-source", policyVersion: 2,
      used: 2, limit: 2, round: 1, paused: true, pauseReason: "manual",
      createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z",
      cases: ["普通图片组", "高质量图片组"].map((group, index) => ({
        id: `case-${index}`, requestId: `original-request-${index}`, supplierId: supplier.id, sourceId: "fixture-source", connectionId: `fixture-connection-${index}`,
        group, supplierGroupId: `official-group-${index}`, modelId: `fixture-image-model-${index}`, provider: "fixture", fingerprint: `fixture-fingerprint-${index}`, dedupeKey: `fixture-dedupe-${index}`,
        resolution: "4K", quality: "max", ratio: "3:2", expectedWidth: 96, expectedHeight: 64, actualWidth: 96, actualHeight: 64,
        parameters: { n: 1, quality: "max", size: "96x64" }, status: "succeeded", assetId: asset.id,
        createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z",
        task: { providerTaskId: `original-task-${index}`, result: { requestId: `original-request-${index}`, response: { raw: "原始响应未截断".repeat(4000) } } },
        expectedCharge: { amount: index ? 0.234 : 0.123, currency: "CNY", unit: "image", checkedAt: "2026-10-17T00:00:00.000Z" },
        actualCharge: { amount: index ? 0.234 : 0.123, currency: "CNY", unit: "image", checkedAt: "2026-10-17T00:00:00.000Z", requestId: `original-request-${index}`, taskId: `original-task-${index}` },
        chargeStatus: "matched",
      })),
      evidence: [{ id: "original-evidence", supplierId: supplier.id, sourceId: "fixture-source", connectionId: "fixture-connection-0", group: "普通图片组", modelId: "fixture-image-model-0",
        operation: "image.generate", kind: "test", checkedAt: "2026-10-17T00:00:00.000Z", excerpt: "原请求、原任务和实扣同身份对应", fingerprint: "fixture-fingerprint-0", status: "verified" }],
      skipped: [], coverage: ["普通图片组", "高质量图片组"].map((group, index) => ({ group, modelId: `fixture-image-model-${index}`, connectionId: `fixture-connection-${index}` })),
    };
    const repository = new FileRepository(path);
    const saved = await repository.saveSupplierVerification(record, 0);
    await repository.flush();
    const stored = JSON.parse(await readFile(path, "utf8")) as { supplierVerifications: Array<{ cases: unknown[] }>; applicationSettings: Record<string, unknown> };
    expect(stored.supplierVerifications[0]!.cases).toEqual([]);
    expect(stored.applicationSettings["supplierVerificationEvidenceStorage:v1"]).toBeTruthy();
    const cold = new FileRepository(path);
    expect(await cold.getSupplierVerificationStatus(supplier.id)).toMatchObject({ id: supplier.id, revision: saved.revision });
    const full = (await cold.getSupplierVerification(supplier.id))!;
    expect(full).toEqual(saved);
    expect(canonicalHash(full)).toBe(canonicalHash(saved));
    expect(full.cases[0]!.task!.providerTaskId).toBe("original-task-0");
    expect(full.cases[0]!.actualCharge!.requestId).toBe("original-request-0");
    await page.route(`**/api/suppliers/${supplier.id}/verification**`, async route => {
      if (route.request().method() !== "GET") { writes++; return route.abort(); }
      reads++;
      // Use complete cold-loaded repository values, with the existing public
      // API's task/fingerprint redaction. No hand-written evidence response.
      try {
        const loaded = (await cold.getSupplierVerification(supplier.id))!;
        await route.fulfill({ json: {
          ...loaded,
          cases: loaded.cases.map(({ task, ...item }) => ({
            ...Object.fromEntries(Object.entries(item).filter(([key]) => key !== "fingerprint")), taskId: task?.providerTaskId,
          })),
          evidence: loaded.evidence.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== "fingerprint"))),
        } });
      } catch {
        readFailures++;
        await route.fulfill({ status: 500, json: { error: "隔离核验证据无法读取" } });
      }
    });
    await page.goto("/");
    await page.getByTestId("workspace-settings").or(page.getByRole("button", { name: "供应商与模型", exact: true })).click();
    await page.locator(".sm-supplier-item").filter({ hasText: name }).click();
    await page.getByRole("tab", { name: "核验记录", exact: true }).click();
    const panel = page.getByRole("region", { name: "供应商自动核验" });
    await expect(panel.locator(".sm-verification-case")).toHaveCount(2);
    const firstCase = panel.locator(".sm-verification-case").filter({ hasText: "fixture-image-model-0" });
    await expect(firstCase).toHaveCount(1);
    const firstCharge = firstCase.getByRole("term").filter({ hasText: /^实际扣费$/u });
    await expect(firstCharge).toHaveCount(1);
    await expect(firstCharge.locator("..").getByRole("definition")).toHaveText("0.123 CNY");
    await panel.getByLabel("核验分组").selectOption("高质量图片组");
    await expect(panel.locator(".sm-verification-case")).toHaveCount(1);
    await expect(panel).toContainText("fixture-image-model-1");
    const selectedCase = panel.locator(".sm-verification-case").filter({ hasText: "fixture-image-model-1" });
    await expect(selectedCase).toHaveCount(1);
    const selectedCharge = selectedCase.getByRole("term").filter({ hasText: /^实际扣费$/u });
    await expect(selectedCharge).toHaveCount(1);
    await expect(selectedCharge.locator("..").getByRole("definition")).toHaveText("0.234 CNY");
    await panel.getByText("请求详情", { exact: true }).click();
    await expect(panel.getByText("original-request-1", { exact: true })).toBeVisible();
    const selectedTask = selectedCase.getByRole("term").filter({ hasText: /^任务编号$/u });
    await expect(selectedTask).toHaveCount(1);
    await expect(selectedTask.locator("..").getByRole("definition").locator("code")).toHaveText("original-task-1");
    await panel.getByRole("img", { name: "4K 核验结果", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "素材预览", exact: true });
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.locator(".asset-stage img").evaluate(element => {
      const image = element as HTMLImageElement;
      return image.complete && image.naturalWidth;
    })).toBe(96);
    await preview.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(preview).toBeHidden();
    await panel.getByLabel("核验分组").selectOption("");
    await expect(panel.locator(".sm-verification-case")).toHaveCount(2);
    await selectedCase.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("external-verification-cold-open.png"), animations: "disabled" });
    expect(reads).toBeGreaterThan(0);
    expect({ writes, submissions, errors }).toEqual({ writes: 0, submissions: 0, errors: [] });
    expect(await cold.getSupplierVerification(supplier.id)).toEqual(saved);
    // A cached activity projection cannot hide corruption of its immutable
    // source, and the evidence panel reports failure rather than an empty ledger.
    const manifest = stored.applicationSettings["supplierVerificationEvidenceStorage:v1"] as { entries: Record<string, { sha256: string }> };
    await writeFile(join(directory, "supplier-verification-evidence", `${manifest.entries[supplier.id]!.sha256}.json`), "{\"corrupt\":true}");
    await expect(cold.getSupplierVerificationStatus(supplier.id)).rejects.toThrow();
    await expect(cold.getSupplierVerification(supplier.id)).rejects.toThrow();
    await page.getByRole("tab", { name: "连接配置", exact: true }).click();
    await page.getByRole("tab", { name: "核验记录", exact: true }).click();
    await expect(panel.getByText("核验记录暂时无法读取", { exact: true })).toBeVisible();
    expect(readFailures).toBeGreaterThan(0);
    expect({ writes, submissions, errors }).toEqual({ writes: 0, submissions: 0, errors: [] });
    await testInfo.attach("external-evidence-round-trip", { body: JSON.stringify({ canonicalHash: canonicalHash(saved), sameRecord: canonicalHash(full) === canonicalHash(saved), caseCount: full.cases.length, evidenceCount: full.evidence.length, reads, readFailures, writes, submissions }), contentType: "application/json" });
  } finally {
    if (!resolve(directory).startsWith(resolve(temporaryRoot) + sep)) throw new Error("Unsafe fixture cleanup");
    await rm(directory, { recursive: true, force: true });
  }
});
