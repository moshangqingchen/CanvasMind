import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  SupplierVerificationConflictError,
  type Repository,
  type SupplierRecord,
  type ProviderConnectionRecord,
  type SupplierVerificationRecord,
  type SupplierVerificationCase,
  type VerificationCharge,
} from "@super-canvas/db";
import { qualityRank } from "./model-quality";
import { confirmedFreeCharge, verificationFailure, verificationChargeForComparison } from "./supplier-verification-failure";
import { modelSupportsNodeType } from "./graph-ui";
import type { ModelDescriptor, ProviderTask } from "@super-canvas/providers";
import { savedModelInterfaces } from "@super-canvas/providers";
import {
  declaredImageCharge,
  effectiveImageCapabilities,
  classifyActualResolution,
  currentResolutionEvidence,
  inferred2KFrom4K,
  reconcileVerificationCharge,
  verificationParameters,
} from "./supplier-capabilities";

export interface VerificationDependencies {
  repository: Repository;
  fingerprintKey: string;
  models(connection: ProviderConnectionRecord): Promise<ModelDescriptor[]>;
  validate?(test: SupplierVerificationCase): Promise<string | undefined>;
  submit(test: SupplierVerificationCase, checkpoint?: (task: ProviderTask) => Promise<void>): Promise<ProviderTask>;
  poll(
    test: SupplierVerificationCase,
    task: ProviderTask,
  ): Promise<ProviderTask>;
  archive(
    test: SupplierVerificationCase,
    task: ProviderTask,
  ): Promise<{ assetId: string; width: number; height: number }>;
  charge?(
    supplier: SupplierRecord,
    test: SupplierVerificationCase,
  ): Promise<VerificationCharge | undefined>;
  document?(
    supplier: SupplierRecord,
    model: ModelDescriptor,
  ): Promise<string | undefined>;
  canSubmit?(): boolean;
  sleep?(ms: number): Promise<void>;
}

const timestamp = () => new Date().toISOString();
const active = new Set(["submitting", "running", "archiving"]);
const PREVIEW_PAUSE_REASON = "计划已准备，等待开始核验";

function preparationOnlyPause(record: SupplierVerificationRecord) {
  const preview = record.pauseReason === "preview" || (!record.pauseReason
    && record.reason === PREVIEW_PAUSE_REASON && record.used === 0
    && record.cases.every(test => !test.submittedAt));
  return record.paused && preview && !record.cases.some(test =>
    active.has(test.status) || test.status === "needs_attention" || test.chargeStatus === "mismatch"
    || (test.submittedAt && test.status !== "succeeded" && !confirmedFreeCharge(test.actualCharge, test)));
}
const isAuthenticationFailure = (test: SupplierVerificationCase) => test.failureKind === "authentication" ||
  /^鉴权失败，请检查当前分组 Key(?: 后恢复队列)?$/u.test(test.reason ?? "");

/** Upgrade only the old automatic Key hold; manual and uncertain-payment holds stay intact. */
function migrateAuthenticationPause(record: SupplierVerificationRecord,
  connections: ReadonlyMap<string, ProviderConnectionRecord>, key: string) {
  if (!record.paused || record.pauseReason === "manual" || record.pauseReason === "preview" ||
    !/^鉴权失败，请检查当前分组 Key(?: 后恢复队列)?$/u.test(record.reason ?? "")) return;
  const failures = record.cases.filter(isAuthenticationFailure);
  if (!failures.length || record.cases.some(test => active.has(test.status) || test.status === "needs_attention" ||
    test.chargeStatus === "mismatch" || (isAuthenticationFailure(test) && (test.actualCharge?.amount ?? 0) > 0) ||
    (test.submittedAt && ["unsupported", "inconclusive"].includes(test.status) && !isAuthenticationFailure(test) && !confirmedFreeCharge(test.actualCharge, test)))) return;
  for (const test of failures) {
    test.failureKind = "authentication";
    const connection = connections.get(test.connectionId);
    if (!connection || verificationFingerprint(connection, key, test.modelId) !== test.fingerprint) continue;
    record.connectionBlocks = [...(record.connectionBlocks ?? []).filter(block => block.connectionId !== connection.id), {
      connectionId: connection.id, fingerprint: verificationFingerprint(connection, key), kind: "authentication",
      reason: "当前分组 Key 鉴权失败，仅暂停此连接的自动核验",
    }];
  }
  record.paused = false;
  record.pauseReason = undefined;
  record.reason = undefined;
}

function connectionBlocked(record: SupplierVerificationRecord, connection: ProviderConnectionRecord | undefined, key: string) {
  return Boolean(connection && record.connectionBlocks?.some(block => block.connectionId === connection.id &&
    block.fingerprint === verificationFingerprint(connection, key)));
}
function nextQualityAfterFailure(test: SupplierVerificationCase, allowed?: readonly string[]) {
  const currentRank = qualityRank({ label: test.quality ?? "", value: test.quality ?? "" });
  const candidates = allowed?.length ? allowed : test.qualityCandidates ?? test.legalQualities ?? [];
  return [...new Set(candidates)].filter(value => value !== test.quality)
    .map(value => ({ value, rank: qualityRank({ label: value, value }) }))
    .filter((item): item is { value: string; rank: number } => item.rank !== undefined &&
      (allowed?.length ? true : item.rank < (currentRank ?? Infinity)))
    .sort((a, b) => b.rank - a.rank)[0]?.value;
}

export class EmptyVerificationImageError extends Error {
  constructor() { super("供应商已返回，但没有提供图片；请核对供应商任务或账单。未重新生成，也未判定参数不支持。"); }
}
const groupName = (connection: ProviderConnectionRecord) => String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "默认群组");
const officialGroupId = (connection: ProviderConnectionRecord): string | undefined => {
  const raw = connection.config.accountKeyGroupId;
  const id = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/u.test(raw.trim()) ? Number(raw) : NaN;
  return Number.isSafeInteger(id) && id >= 0 ? String(id) : undefined;
};
const modelScope = (sourceId: string, group: string, modelId: string) => JSON.stringify([sourceId, group, modelId, "image.generate"]);

function applyLowerResolutionInferences(record: SupplierVerificationRecord) {
  // Migrate old multi-size queues to one active case for each group/model.
  const pending = record.cases.filter(test => test.status === "queued" && !test.retestOf)
    .sort((a, b) => Number.parseInt(b.resolution) - Number.parseInt(a.resolution));
  const scopes = new Set<string>();
  for (const test of pending) {
    const key = test.fingerprint + ":" + test.modelId;
    const done = record.cases.some(item => item.fingerprint === test.fingerprint && item.modelId === test.modelId &&
      (item.status === "succeeded" || item.provisional));
    if (done || scopes.has(key)) {
      test.status = done ? "superseded" : "cancelled";
      test.reason = done ? "已有成功结果或暂定最高档位，无需重复测试" : "先完成最高档位的单尺寸测试";
    } else scopes.add(key);
  }
  for (const test of record.cases) {
    const evidence = inferred2KFrom4K(test);
    if (!evidence) continue;
    if (!record.evidence.some(item => item.connectionId === test.connectionId && item.modelId === test.modelId
      && item.fingerprint === test.fingerprint && item.resolution === "4K" && ["verified", "approximate"].includes(item.status))) continue;
    const lower = record.cases.filter(item => item.connectionId === test.connectionId && item.modelId === test.modelId
      && item.fingerprint === test.fingerprint && item.resolution === "2K");
    if (lower.some(item => item.status === "succeeded" || (item.status === "unsupported" && item.rejectedParameter === "resolution"))) continue;
    for (const queued of lower.filter(item => item.status === "queued" && !item.retestOf)) {
      queued.status = "superseded";
      queued.reason = "同一分组型号 4K 已通过，直接开放 2K，免去重复付费测试";
      queued.updatedAt = timestamp();
    }
    record.evidence = [...record.evidence.filter(item => item.id !== evidence.id), evidence];
  }
}
export function verificationFingerprint(
  connection: ProviderConnectionRecord,
  key: string,
  modelId?: string,
): string {
  // Public evidence cannot reveal an API key, including by a plain unsalted hash.
  const config = connection.config;
  const autoInterface = modelId ? savedModelInterfaces(config)[modelId] : undefined;
  const rawConnector = config.connector as Record<string, unknown> | undefined;
  const connector = rawConnector
    ? Object.fromEntries(
        Object.entries(rawConnector).filter(([name]) => name !== "models"),
      )
    : undefined;
  return createHmac("sha256", key)
    .update(
      JSON.stringify({
        id: connection.id,
        provider: connection.provider,
        secret: connection.encryptedSecret,
        baseUrl: config.baseUrl,
        source: config.supplierSourceId,
        group: config.modelGroup,
        accountGroup: config.accountKeyGroup !== config.modelGroup ? config.accountKeyGroup : undefined,
        accountGroupId: officialGroupId(connection),
        headers: config.headers && typeof config.headers === "object" && Object.keys(config.headers).length ? config.headers : undefined,
        connector,
        protocol: config.protocol,
        usage: config.usage,
        ...(autoInterface ? { autoInterface: { ...autoInterface.connector, models: undefined } } : {}),
      }),
    )
    .digest("hex");
}

function withoutFingerprint<T extends { fingerprint: string }>(value: T): Omit<T, "fingerprint"> {
  const result: Omit<T, "fingerprint"> & { fingerprint?: string } = { ...value };
  delete result.fingerprint;
  return result;
}

export function shouldAutomaticallyVerifyConnection(previous: ProviderConnectionRecord | null, next: ProviderConnectionRecord): boolean {
  if (!next.encryptedSecret || typeof next.config.supplierId !== "string" || next.config.supplierArchived === true
    || next.provider === "cli" || next.provider === "fake" || next.config.usage === "disabled") return false;
  return !previous || previous.config.supplierArchived === true
    || verificationFingerprint(previous, "onboarding") !== verificationFingerprint(next, "onboarding")
    || previous.config.directorProtocol !== next.config.directorProtocol
    || JSON.stringify(previous.config.directorHeaders) !== JSON.stringify(next.config.directorHeaders)
    || JSON.stringify(previous.config.manualModels ?? []) !== JSON.stringify(next.config.manualModels ?? []);
}

export function publicVerification(record: SupplierVerificationRecord | null) {
  if (!record) return null;
  record = structuredClone(record);
  applyLowerResolutionInferences(record);
  return {
    ...record,
    connectionBlocks: record.connectionBlocks?.map(withoutFingerprint),
    cases: record.cases.map(currentResolutionEvidence).map(({ task, ...test }) => ({
      ...withoutFingerprint(test),
      taskId:
        typeof task?.providerTaskId === "string"
          ? task.providerTaskId
          : undefined,
    })),
    evidence: record.evidence.map(withoutFingerprint),
  };
}

/** No API endpoint that merely reads models calls plan() or submits a request. */
export class SupplierVerificationService {
  private working: Promise<void> | null = null;
  private wakeAgain = false;
  private recover = true;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly deps: VerificationDependencies) {}

  private async mutate(
    id: string,
    change: (record: SupplierVerificationRecord) => void,
  ) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const record = await this.deps.repository.getSupplierVerification(id);
      if (!record) throw new Error("核验记录不存在");
      change(record);
      applyLowerResolutionInferences(record);
      // Every queued case is one explicit allowance. Cancelling a case cannot leave
      // an unbound credit that a scan could spend on a repeated test.
      if (record.policyVersion === 2)
        record.limit = record.used + record.cases.filter(test => test.status === "queued").length;
      try {
        return await this.deps.repository.saveSupplierVerification(
          record,
          record.revision,
        );
      } catch (error) {
        if (!(error instanceof SupplierVerificationConflictError)) throw error;
      }
    }
    throw new Error("核验记录正在更新，请重试");
  }

  async plan(supplierId: string, prepareOnly = false, options: { onboarding?: boolean } = {}) {
    const supplier = await this.deps.repository.getSupplier(supplierId);
    if (!supplier) throw new Error("供应商不存在");
    const sourceId = supplier.state?.sourceId ?? "legacy";
    let current =
      await this.deps.repository.getSupplierVerification(supplierId);
    if (!current) {
      const date = timestamp();
      const initial: SupplierVerificationRecord = {
        id: supplierId,
        schemaVersion: 1,
        revision: 0,
        sourceId,
        policyVersion: 2,
        limit: 0,
        used: 0,
        round: 1,
        paused: prepareOnly,
        ...(prepareOnly ? { pauseReason: "preview" as const } : {}),
        createdAt: date,
        updatedAt: date,
        cases: [],
        evidence: [],
        skipped: [],
      };
      // Preserve the known uncertain paid request from the previous manual audit.
      if ((await this.deps.repository.getConnection("ff52083f-e2bb-4563-9323-1c3e05971e9d"))?.config.supplierId === supplierId) {
        initial.used = 1;
        initial.limit = 1;
        initial.paused = true;
        initial.pauseReason = "safety";
        initial.reason =
          "历史测试提交结果不明，请先核对 0ddc7ea3-f7cc-4d13-bfc2-8767dda1193f";
        initial.cases.push({
          id: "0ddc7ea3-f7cc-4d13-bfc2-8767dda1193f",
          requestId: "0ddc7ea3-f7cc-4d13-bfc2-8767dda1193f",
          supplierId,
          sourceId,
          connectionId: "legacy-unresolved",
          group: "gpt  pro 0.12",
          modelId: "gpt-image-2",
          provider: "openai",
          fingerprint: "legacy-unresolved",
          dedupeKey: "legacy-unresolved",
          resolution: "2K",
          ratio: "1:1",
          quality: "high",
          parameters: { size: "2048x2048", quality: "high", n: 1 },
          expectedWidth: 2048,
          expectedHeight: 2048,
          status: "needs_attention",
          submittedAt: "2026-09-21T08:12:55.343Z",
          createdAt: "2026-09-21T08:12:55.343Z",
          updatedAt: "2026-09-21T08:13:45.551Z",
          reason: "提交时断网，无远端任务编号；禁止自动重发",
          chargeStatus: "unknown",
        });
      }
      try {
        current = await this.deps.repository.saveSupplierVerification(
          initial,
          0,
        );
      } catch (error) {
        if (!(error instanceof SupplierVerificationConflictError)) throw error;
        current =
          (await this.deps.repository.getSupplierVerification(supplierId))!;
      }
    }
    const connections = (await this.deps.repository.listConnections()).filter(
      (c) =>
        c.config.supplierId === supplierId &&
        c.encryptedSecret &&
        c.config.usage !== "disabled" &&
        !["cli", "fake"].includes(c.provider) &&
        c.config.supplierArchived !== true &&
        (!c.config.supplierSourceId || c.config.supplierSourceId === sourceId),
    );
    const nodes = (await this.deps.repository.listCanvases()).flatMap(
      (canvas) =>
        Array.isArray(canvas.graph.nodes)
          ? (canvas.graph.nodes as Array<{
              data?: { connectionId?: string; model?: string };
            }>)
          : [],
    );
    const usedModels = new Set(
      nodes.map((n) => `${n.data?.connectionId}:${n.data?.model}`),
    );
    const prepared: Array<{
      connection: ProviderConnectionRecord;
      model: ModelDescriptor;
      documentation?: string;
    }> = [];
    const skipped: SupplierVerificationRecord["skipped"] = [];
    for (const group of supplier.catalog.groups) {
      if (connections.some(connection => groupName(connection) === group.id)) continue;
      const images = group.models.filter(model => model.capability === "image");
      if (images.length) for (const model of images)
        skipped.push({ connectionId: "", group: group.id, modelId: model.id, reason: "该分组尚无可用连接或 Key，配置后自动纳入核验" });
      else if (/生图|图片|图像|image|香蕉/iu.test(`${group.id} ${group.label}`))
        skipped.push({ connectionId: "", group: group.id, modelId: "", reason: "该分组尚无可用连接或 Key，无法读取实际可用型号" });
    }
    for (const connection of connections.sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      try {
        const models = await this.deps.models(connection);
        const latestConnection =
          (await this.deps.repository.getConnection(connection.id)) ??
          connection;
        // Agent-only Keys participate in free discovery, never image probes.
        if (latestConnection.config.usage === "agent") continue;
        for (const model of models.filter((m) =>
          modelSupportsNodeType(m, "image-generation") && !modelSupportsNodeType(m, "video-generation"),
        ))
          prepared.push({
            connection: latestConnection,
            model,
            documentation: await this.deps.document?.(supplier, model),
          });
      } catch {
        skipped.push({
          connectionId: connection.id,
          group: groupName(connection),
          modelId: "",
          reason: "免费模型读取失败，未创建付费请求",
        });
      }
    }
    prepared.sort(
      (a, b) =>
        Number(current!.cases.some(test => test.connectionId === b.connection.id && test.modelId === b.model.id && test.fingerprint === verificationFingerprint(b.connection, this.deps.fingerprintKey, b.model.id) && test.status !== "superseded")) -
          Number(current!.cases.some(test => test.connectionId === a.connection.id && test.modelId === a.model.id && test.fingerprint === verificationFingerprint(a.connection, this.deps.fingerprintKey, a.model.id) && test.status !== "superseded")) ||
        Number(usedModels.has(`${b.connection.id}:${b.model.id}`)) -
          Number(usedModels.has(`${a.connection.id}:${a.model.id}`)) ||
        a.connection.id.localeCompare(b.connection.id) ||
        a.model.id.localeCompare(b.model.id),
    );
    const latestSupplier = await this.deps.repository.getSupplier(supplierId);
    if (
      !latestSupplier ||
      (latestSupplier.state?.sourceId ?? "legacy") !== sourceId
    )
      return this.deps.repository.getSupplierVerification(supplierId);
    const latestConnections = await this.deps.repository.listConnections();
    const connectionsById = new Map(latestConnections.map(connection => [connection.id, connection]));
    const currentFingerprint = (id: string, modelId: string) => {
      const connection = connectionsById.get(id);
      return connection ? verificationFingerprint(connection, this.deps.fingerprintKey, modelId) : undefined;
    };
    return this.mutate(supplierId, (record) => {
      // Keep all previous request IDs, charges and reservations when expanding
      // the old supplier-wide policy to every group/model.
      record.policyVersion = 2;
      record.sourceId = sourceId;
      if (options.onboarding) migrateAuthenticationPause(record, connectionsById, this.deps.fingerprintKey);
      record.connectionBlocks = record.connectionBlocks?.filter(block => {
        const connection = connectionsById.get(block.connectionId);
        return connection && block.fingerprint === verificationFingerprint(connection, this.deps.fingerprintKey);
      });
      if (prepareOnly) {
        if (!record.paused) record.pauseReason = "preview";
        record.paused = true;
        record.reason ??= PREVIEW_PAUSE_REASON;
      } else if (options.onboarding && preparationOnlyPause(record)) {
        record.paused = false;
        record.pauseReason = undefined;
        record.reason = undefined;
      }
      for (const test of record.cases)
        if (
          test.status === "queued" &&
          currentFingerprint(test.connectionId, test.modelId) !== test.fingerprint
        ) {
          test.status = "superseded";
          test.reason = "连接配置已变更";
        }
      record.skipped = skipped;
      record.coverage = [];
      const plannedScopes = new Set<string>();
      const preparedKeys = new Set(
        prepared.map((item) => `${item.connection.id}:${item.model.id}`),
      );
      const evidence: SupplierVerificationRecord["evidence"] =
        record.evidence.filter(
          (item) =>
            !preparedKeys.has(`${item.connectionId}:${item.modelId}`) &&
            currentFingerprint(item.connectionId, item.modelId) === item.fingerprint,
        );
      for (const { connection, model, documentation } of prepared) {
        const fingerprint = verificationFingerprint(connection, this.deps.fingerprintKey, model.id);
        const supplierGroupId = officialGroupId(connection);
        if (fingerprint !== currentFingerprint(connection.id, model.id)) continue;
        const scope = modelScope(sourceId, groupName(connection), model.id);
        if (!record.coverage.some(item => modelScope(sourceId, item.group, item.modelId) === scope))
          record.coverage.push({ connectionId: connection.id, group: groupName(connection), modelId: model.id });
        const resolveCapabilities = () => effectiveImageCapabilities({
          supplier,
          connection,
          model,
          fingerprint,
          tests: record.cases,
          priorEvidence: record.evidence,
          documentation,
        });
        let capabilities = resolveCapabilities();
        let corrected = false;
        for (const queued of record.cases) {
          if (queued.status !== "queued" || queued.submittedAt || queued.connectionId !== connection.id || queued.modelId !== model.id)
            continue;
          const rejectedFixedQuality = capabilities.reason && capabilities.qualityKey && !capabilities.quality;
          if (rejectedFixedQuality || capabilities.evidence.some(entry => entry.resolution === queued.resolution &&
              (["unsupported", "conflict"].includes(entry.status) || (entry.status === "declared" && !capabilities.needsQualityProbe)))) {
            queued.status = "cancelled";
            queued.reason = rejectedFixedQuality ? capabilities.reason : "最新分组或文档已明确此档位，已取消未提交测试";
            queued.updatedAt = timestamp();
            corrected = true;
            continue;
          }
          // A cached plan may contain a generic group quality that this exact
          // SKU does not accept. Correct only unsubmitted, no-longer-legal
          // values; an allowed lower-quality retry retains its selected value.
          if (capabilities.qualityKey && capabilities.quality && capabilities.qualityOptions?.length) {
            const selected = queued.quality ?? String(queued.parameters[capabilities.qualityKey] ?? "");
            if (selected && !capabilities.qualityOptions.includes(selected)) {
              queued.quality = capabilities.quality;
              queued.parameters = { ...queued.parameters, [capabilities.qualityKey]: capabilities.quality };
              queued.dedupeKey = createHash("sha256").update(`${fingerprint}:${model.id}:${queued.resolution}:${capabilities.quality}`).digest("hex");
              queued.expectedCharge = declaredImageCharge(model, queued.resolution, capabilities.quality, queued.parameters);
              queued.reason = "最新型号参数已排除原质量值，已校准尚未提交的请求";
              queued.updatedAt = timestamp();
              corrected = true;
            }
            if (queued.qualityCandidates?.some(value => !capabilities.qualityOptions!.includes(value)))
              queued.qualityCandidates = [...capabilities.qualityOptions];
          }
        }
        if (corrected) capabilities = resolveCapabilities();
        evidence.push(...capabilities.evidence);
        if (capabilities.reason) {
          record.skipped.push({
            connectionId: connection.id,
            group: groupName(connection),
            modelId: model.id,
            reason: capabilities.reason,
          });
          continue;
        }
        // Multiple keys for the same group do not multiply paid probes.
        if (plannedScopes.has(scope)) {
          for (const duplicate of record.cases.filter(test => test.status === "queued" && test.connectionId === connection.id && test.modelId === model.id)) {
            duplicate.status = "cancelled";
            duplicate.reason = "同一分组型号已有核验计划，未重复提交";
          }
          continue;
        }
        plannedScopes.add(scope);
        for (const tier of capabilities.probeTiers.slice(0, 1)) {
          const dedupeKey = createHash("sha256")
            .update(
              `${fingerprint}:${model.id}:${tier}:${capabilities.quality ?? ""}`,
            )
            .digest("hex");
          if (
            record.cases.some(
              (test) =>
                test.dedupeKey === dedupeKey && test.status !== "cancelled",
            )
          )
            continue;
          const { parameters, width, height } = verificationParameters(
            capabilities,
            tier,
          );
          const date = timestamp();
          record.cases.push({
            id: randomUUID(),
            requestId: randomUUID(),
            supplierId,
            sourceId,
            connectionId: connection.id,
            group: groupName(connection),
            ...(supplierGroupId !== undefined ? { supplierGroupId } : {}),
            modelId: model.id,
            provider: connection.provider,
            fingerprint,
            dedupeKey,
            resolution: tier,
            quality: capabilities.quality,
            // Preserve the adapter's legal quality values on the durable case.
            // A retry can then choose a lower value after a restart without
            // another model-list request or inventing an unsupported value.
            qualityCandidates: capabilities.qualityOptions?.length
              ? [...capabilities.qualityOptions]
              : undefined,
            ratio: capabilities.ratio,
            parameters,
            expectedWidth: width,
            expectedHeight: height,
            status: "queued",
            createdAt: date,
            updatedAt: date,
            expectedCharge: declaredImageCharge(
              model,
              tier,
              capabilities.quality,
              parameters,
            ),
            chargeStatus: "unknown",
          });
        }
      }
      record.evidence = evidence;
    });
  }

  async action(
    id: string,
    action: "pause" | "resume" | "reconcile" | "cancel" | "new-round",
  ) {
    await this.mutate(id, (record) => {
      if (action === "pause") {
        record.paused = true;
        record.pauseReason = "manual";
        record.reason = "已暂停自动核验";
      }
      if (action === "cancel") {
        for (const test of record.cases)
          if (test.status === "queued") test.status = "cancelled";
        record.paused = true;
        record.pauseReason = "manual";
        record.reason = "已取消未提交的测试";
      }
      if (action === "resume" || action === "new-round") {
        if (
          record.cases.some(
            (test) =>
              test.status === "needs_attention" ||
              test.chargeStatus === "mismatch" || (test.rejectedParameter && test.submittedAt && !confirmedFreeCharge(test.actualCharge, test)),
          )
        )
          throw new Error("请先核对结果不明或扣费不符的任务，恢复不会重新生图");
        record.paused = false;
        record.pauseReason = undefined;
        record.reason = undefined;
      }
      if (action === "new-round") {
        if (record.policyVersion === 2) throw new Error("已覆盖所有分组型号；请补齐核验计划，或对指定结果显式重测");
        record.round++;
        record.limit += 6;
      }
    });
    if (action === "new-round") await this.plan(id);
    if (action === "reconcile") {
      const record = (await this.deps.repository.getSupplierVerification(id))!;
      for (const test of record.cases.filter(
        (test) =>
          test.status === "needs_attention" && test.task?.providerTaskId,
      ))
        await this.execute(test, true);
      const supplier = await this.deps.repository.getSupplier(id);
      if (supplier && this.deps.charge)
        for (const test of record.cases.filter((test) => test.submittedAt)) {
          const charge = await this.deps
            .charge(supplier, test)
            .catch(() => undefined);
          if (charge) {
            if (["needs_attention", "inconclusive", "unsupported"].includes(test.status) && !test.provisional && !isAuthenticationFailure(test) && confirmedFreeCharge(charge, test)) {
              const error = test.rejectedParameter
                ? Object.assign(new Error("unsupported " + (test.rejectedParameter === "quality" ? "quality" : "size")), {
                  details: { status: 400, responseBody: { error: { allowed_values: test.legalQualities } } },
                }) : new Error("已有失败请求已确认未扣费");
              await this.fail({ ...test, actualCharge: charge }, supplier, error, true);
              continue;
            }
            await this.patchCase(test, {
              actualCharge: charge,
              chargeStatus: reconcileVerificationCharge(
                test.expectedCharge,
                verificationChargeForComparison(test, charge),
                test.requestId,
                String(test.task?.providerTaskId ?? ""),
              ),
            });
          }
        }
    }
    if (action === "resume" || action === "new-round") this.kick();
    return this.deps.repository.getSupplierVerification(id);
  }

  /** Run the selected unsubmitted case once, retaining every other queued case. */
  async runQueuedCase(id: string, caseId: string, waitForCompletion = true) {
    if (this.deps.canSubmit && !this.deps.canSubmit()) throw new Error("应用正在退出，核验任务尚未提交");
    const connections = new Map((await this.deps.repository.listConnections()).map(connection => [connection.id, connection]));
    const record = await this.mutate(id, current => {
      migrateAuthenticationPause(current, connections, this.deps.fingerprintKey);
      const test = current.cases.find(item => item.id === caseId);
      if (!test || test.status !== "queued" || test.submittedAt) throw new Error("仅可执行尚未提交的核验任务");
      if (current.paused || connectionBlocked(current, connections.get(test.connectionId), this.deps.fingerprintKey))
        throw new Error("该任务仍被暂停，请检查当前连接或核验记录");
    });
    const test = record.cases.find(item => item.id === caseId)!;
    if (!waitForCompletion) {
      void this.execute(test, false).catch(() => console.error("[supplier-verification] 指定核验需要查看记录"));
      return record;
    }
    await this.execute(test, false);
    return this.deps.repository.getSupplierVerification(id);
  }

  async retest(id: string, caseId: string) {
    await this.mutate(id, (record) => {
      if (
        record.paused ||
        record.cases.some(
          (test) =>
            test.status === "needs_attention" ||
            test.chargeStatus === "mismatch" || (test.rejectedParameter && test.submittedAt && !confirmedFreeCharge(test.actualCharge, test)),
        )
      )
        throw new Error("请先核对并恢复队列，结果不明的请求不能重新提交");
      const original = record.cases.find((test) => test.id === caseId);
      if (!original || !["succeeded", "inconclusive"].includes(original.status))
        throw new Error("仅可显式重测已有确定结果的请求");
      if (
        record.policyVersion === 1 &&
        record.used +
          record.cases.filter((test) => test.status === "queued").length >=
        record.limit
      )
        throw new Error("核验额度已用完，请手动开启新一轮");
      if (record.cases.some(test => test.retestOf === caseId && (test.status === "queued" || active.has(test.status))))
        throw new Error("该结果已安排重测，请等待现有请求完成");
      const now = timestamp();
      const requestId = randomUUID();
      record.cases.push({
        ...original,
        id: requestId,
        requestId,
        dedupeKey: `${original.dedupeKey}:retest:${requestId}`,
        retestOf: caseId,
        retryOf: undefined,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        submittedAt: undefined,
        task: undefined,
        actualWidth: undefined,
        actualHeight: undefined,
        assetId: undefined,
        approximate: undefined,
        actualCharge: undefined,
        chargeStatus: "unknown",
        reason: "手动重新生成核验，将发起新的付费请求",
      });
    });
    void this.kick().catch(() => {});
    return this.deps.repository.getSupplierVerification(id);
  }

  kick(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.wakeAgain = true;
    if (!this.working)
      this.working = this.drain().finally(() => {
        this.working = null;
      });
    return this.working;
  }
  private async patchCase(
    test: SupplierVerificationCase,
    patch: Partial<SupplierVerificationCase>,
    pause?: string,
  ) {
    return this.mutate(test.supplierId, (record) => {
      const existing = record.cases.find((item) => item.id === test.id);
      if (!existing) throw new Error("核验请求不存在");
      Object.assign(existing, patch, { updatedAt: timestamp() });
      if (patch.status === "succeeded") {
        const key = `${test.connectionId}:${test.modelId}:${test.resolution}`;
        const entry = {
          id: key,
          supplierId: test.supplierId,
          sourceId: test.sourceId,
          connectionId: test.connectionId,
          group: test.group,
          modelId: test.modelId,
          operation: "image.generate" as const,
          kind: "test" as const,
          checkedAt: timestamp(),
          excerpt: `请求 ${test.expectedWidth}×${test.expectedHeight}，实际 ${patch.actualWidth}×${patch.actualHeight}；仅核验 ${test.ratio}`,
          fingerprint: test.fingerprint,
          status: patch.approximate
            ? ("approximate" as const)
            : ("verified" as const),
          resolution: test.resolution,
          actualWidth: patch.actualWidth,
          actualHeight: patch.actualHeight,
        };
        record.evidence = [
          ...record.evidence.filter((item) => item.id !== key),
          entry,
        ];
        if (test.quality)
          record.evidence = [
            ...record.evidence.filter(
              (item) =>
                item.id !== `${test.connectionId}:${test.modelId}:quality`,
            ),
            {
              ...entry,
              id: `${test.connectionId}:${test.modelId}:quality`,
              resolution: undefined,
              status: "verified",
              quality: test.quality,
              excerpt: String(test.quality) + " 档请求已接受，画质差异未验证",
            },
          ];
      }
      if (pause) {
        record.paused = true;
        record.pauseReason = "safety";
        record.reason = pause;
      }
    });
  }

  /** Persist the child before any next POST; historical requests remain intact. */
  private async queueQualityRetry(test: SupplierVerificationCase, nextQuality: string | undefined, reason: string, delayed = false, allowed?: string[]) {
    await this.mutate(test.supplierId, record => {
      if (!record.cases.some(item => item.id === test.id)) return;
      if (record.cases.some(item => item.retryOf === test.id && item.status !== "cancelled")) return;
      if (!delayed && record.cases.some(item => item.fingerprint === test.fingerprint && item.modelId === test.modelId &&
        item.resolution === test.resolution && item.quality === nextQuality && !["cancelled", "superseded"].includes(item.status))) return;
      if (record.policyVersion === 1 && record.used + record.cases.filter(item => item.status === "queued").length >= record.limit) return;
      const parameters = { ...test.parameters };
      const key = Object.keys(parameters).find(key => /quality/iu.test(key));
      if (key && nextQuality) parameters[key] = nextQuality;
      const now = timestamp();
      const retries = record.cases.filter(item => item.fingerprint === test.fingerprint && item.modelId === test.modelId && item.retryOf).length;
      const wait = Math.min(300000, 5000 * 2 ** Math.min(retries, 6));
      const id = randomUUID();
      record.cases.push({ ...test, id, requestId: id, retryOf: test.id, retestOf: undefined,
        quality: nextQuality, parameters, qualityCandidates: allowed?.length ? allowed : test.qualityCandidates,
        legalQualities: allowed ?? test.legalQualities,
        dedupeKey: test.dedupeKey + ":retry:" + id, status: "queued", createdAt: now, updatedAt: now,
        nextAttemptAt: delayed ? new Date(Date.now() + wait).toISOString() : undefined,
        submittedAt: undefined, task: undefined, actualWidth: undefined, actualHeight: undefined, assetId: undefined,
        approximate: undefined, actualCharge: undefined, expectedCharge: undefined, chargeStatus: "unknown",
        rejectedParameter: undefined, provisional: undefined, resolutionMismatch: undefined, reason });
    });
  }

  private async fail(test: SupplierVerificationCase, supplier: SupplierRecord, error: unknown, terminal = false) {
    const failure = verificationFailure(error);
    const charge = await this.deps.charge?.(supplier, test).catch(() => undefined) ?? test.actualCharge;
    const noCharge = confirmedFreeCharge(charge, test) || (failure.free && !charge?.amount);
    const knownFailure = terminal || failure.terminal || failure.unavailable || Boolean(failure.rejectedParameter) || noCharge;
    const actualCharge = charge ?? (failure.free ? { amount: 0, currency: "credits", unit: "image" as const,
      checkedAt: timestamp(), requestId: test.requestId } : undefined);
    if (failure.authentication && !(actualCharge?.amount)) {
      const connection = await this.deps.repository.getConnection(test.connectionId);
      await this.mutate(test.supplierId, record => {
        const current = record.cases.find(item => item.id === test.id);
        if (!current) throw new Error("核验请求不存在");
        Object.assign(current, { status: "inconclusive", failureKind: "authentication", actualCharge,
          chargeStatus: "unknown", updatedAt: timestamp(), reason: "当前分组 Key 鉴权失败，仅暂停此连接的自动核验" });
        if (connection && verificationFingerprint(connection, this.deps.fingerprintKey, test.modelId) === test.fingerprint)
          record.connectionBlocks = [...(record.connectionBlocks ?? []).filter(block => block.connectionId !== connection.id), {
            connectionId: connection.id, fingerprint: verificationFingerprint(connection, this.deps.fingerprintKey),
            kind: "authentication", reason: current.reason!,
          }];
      });
      return;
    }
    await this.patchCase(test, { status: failure.rejectedParameter ? "unsupported" : knownFailure ? "inconclusive" : "needs_attention",
      rejectedParameter: failure.rejectedParameter, legalQualities: failure.allowed,
      provisional: failure.unavailable || undefined, actualCharge,
      chargeStatus: actualCharge?.amount ? reconcileVerificationCharge(test.expectedCharge, verificationChargeForComparison(test, actualCharge), test.requestId, String(test.task?.providerTaskId ?? "")) : "unknown",
      reason: failure.unavailable ? "供应商暂无可用账号，保留最高请求档位，等待核验"
        : failure.rejectedParameter ? "供应商明确拒绝此参数组合"
        : noCharge && knownFailure ? "生成失败，已确认未扣费，继续测试"
        : error instanceof EmptyVerificationImageError ? "供应商没有提供图片，扣费尚未确认，保留请求等待核对"
        : failure.definiteReason ?? "生成结果或扣费尚未确认，保留请求等待核对",
    }, failure.unavailable || (noCharge && knownFailure && !failure.definiteReason)
      ? undefined : failure.definiteReason ?? "核验结果或扣费需要核对");
    if (failure.unavailable) {
      await this.mutate(test.supplierId, record => {
        for (const item of record.cases.filter(item => item.status === "queued" && item.fingerprint === test.fingerprint && item.modelId === test.modelId)) {
          item.status = "superseded"; item.reason = "上游缺少账号，已暂存最高档位";
        }
      });
      await this.plan(test.supplierId);
      return;
    }
    if (actualCharge && actualCharge.amount > 0) {
      await this.patchCase(test, {}, "失败请求已有扣费，停止自动重试"); return;
    }
    if (!noCharge) return;
    if (failure.rejectedParameter === "resolution") { await this.plan(test.supplierId); return; }
    if (failure.definiteReason) return;
    if (failure.rejectedParameter === "quality" || (knownFailure && noCharge)) {
      const nextQuality = nextQualityAfterFailure(test, failure.allowed);
      if (nextQuality) await this.queueQualityRetry(test, nextQuality, "继续测试下一质量档位", false, failure.allowed);
      else if (!failure.rejectedParameter) await this.queueQualityRetry(test, test.quality, "未扣费失败，稍后继续测试", true);
    }
  }

  private async drain() {
    if (this.recover) {
      this.recover = false;
      for (const record of await this.deps.repository.listSupplierVerifications())
        for (const test of record.cases.filter((test) =>
          active.has(test.status),
        )) {
          if (test.status === "submitting" && !test.task)
            await this.patchCase(
              test,
              {
                status: "needs_attention",
                reason: "应用在提交期间中断，请核对任务；不会自动重发",
              },
              "存在结果不明的提交",
            );
          else await this.execute(test, true);
        }
      // Finish a persisted free failure whose child had not yet been saved.
      for (const record of await this.deps.repository.listSupplierVerifications()) {
        if (record.paused) continue;
        for (const test of record.cases) {
          if (!test.submittedAt || test.provisional || isAuthenticationFailure(test) || !["unsupported", "inconclusive"].includes(test.status)) continue;
          if (test.rejectedParameter && !confirmedFreeCharge(test.actualCharge, test)) {
            await this.patchCase(test, {}, "参数拒绝请求尚未确认未扣费，等待核对");
            continue;
          }
          if (record.cases.some(item => item.retryOf === test.id || (item.fingerprint === test.fingerprint && item.modelId === test.modelId &&
            (item.status === "succeeded" || item.status === "queued" || item.status === "cancelled" || active.has(item.status))))) continue;
          const free = confirmedFreeCharge(test.actualCharge, test);
          if (!free) {
            if (test.rejectedParameter) await this.patchCase(test, {}, "参数拒绝请求尚未确认未扣费，等待核对");
            continue;
          }
          if (test.rejectedParameter === "resolution") { await this.plan(record.id); continue; }
          const next = nextQualityAfterFailure(test, test.legalQualities);
          if (next || free) await this.queueQualityRetry(test, next ?? test.quality, "继续已保存的未扣费测试", !next, test.legalQualities);
        }
      }
    }
    do {
      this.wakeAgain = false;
      for (;;) {
        if (this.deps.canSubmit && !this.deps.canSubmit()) break;
        const connections = new Map((await this.deps.repository.listConnections()).map(connection => [connection.id, connection]));
        const eligible = (record: SupplierVerificationRecord, test: SupplierVerificationCase) =>
          test.status === "queued" && (!test.nextAttemptAt || Date.parse(test.nextAttemptAt) <= Date.now()) &&
          !connectionBlocked(record, connections.get(test.connectionId), this.deps.fingerprintKey);
        const record = (
          await this.deps.repository.listSupplierVerifications()
        ).find(
          (item) =>
            !item.paused &&
            item.used < item.limit &&
            item.cases.some(test => eligible(item, test)),
        );
        if (!record) break;
        // Also upgrades an old queue and puts a corrected 4K quality ahead of 2K.
        const candidate = record.cases.filter(test => eligible(record, test))
          .sort((a, b) => Number.parseInt(b.resolution) - Number.parseInt(a.resolution))[0]!;
        await this.execute(candidate, false);
      }
    } while (this.wakeAgain);
    const latestConnections = new Map((await this.deps.repository.listConnections()).map(connection => [connection.id, connection]));
    const next = (await this.deps.repository.listSupplierVerifications()).filter(record => !record.paused)
      .flatMap(record => record.cases.filter(test => !connectionBlocked(record, latestConnections.get(test.connectionId), this.deps.fingerprintKey)))
      .filter(test => test.status === "queued" && test.nextAttemptAt)
      .map(test => Date.parse(test.nextAttemptAt!)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    if (next !== undefined) {
      this.retryTimer = setTimeout(() => { void this.kick().catch(() => {}); }, Math.max(1000, next - Date.now()));
      this.retryTimer.unref?.();
    }
  }
  private async execute(test: SupplierVerificationCase, recovery: boolean) {
    const connection = await this.deps.repository.getConnection(
      test.connectionId,
    );
    const supplier = await this.deps.repository.getSupplier(test.supplierId);
    if (
      !connection ||
      !supplier ||
      verificationFingerprint(connection, this.deps.fingerprintKey, test.modelId) !==
        test.fingerprint ||
      (supplier.state?.sourceId ?? "legacy") !== test.sourceId
    ) {
      await this.patchCase(test, {
        status: "superseded",
        reason: "原连接已变更，保留历史请求，未再次提交",
      });
      return;
    }
    let task = test.task as unknown as ProviderTask | undefined;
    if (!recovery) {
      if (connection.config.supplierArchived === true || ["agent", "disabled"].includes(String(connection.config.usage))) {
        await this.patchCase(test, { status: "cancelled", reason: "当前连接未启用图片生成，未提交测试" });
        return;
      }
      // A persisted 4K result can predate this version or be imported while paused.
      await this.mutate(test.supplierId, () => {});
      if (this.deps.validate) {
        const issue = await this.deps.validate(test);
        if (issue) {
          await this.patchCase(test, { status: "cancelled", reason: `未提交：${issue}` });
          return;
        }
      }
      let claimed = false;
      await this.mutate(test.supplierId, (record) => {
        claimed = false;
        const candidate = record.cases.find((item) => item.id === test.id);
        if (
          !candidate ||
          candidate.status !== "queued" ||
          record.paused ||
          connectionBlocked(record, connection, this.deps.fingerprintKey) ||
          record.used >= record.limit
        )
          return;
        candidate.status = "submitting";
        candidate.submittedAt = timestamp();
        candidate.updatedAt = timestamp();
        record.used++;
        claimed = true;
      });
      if (!claimed) return;
      try {
        task = await this.deps.submit(test, async partial => {
          test.task = JSON.parse(JSON.stringify(partial));
          await this.patchCase(test, { task: test.task });
        });
        // This durability barrier must finish before any polling or archiving.
        await this.patchCase(test, {
          task: JSON.parse(JSON.stringify(task)),
          status: task.status === "succeeded" ? "archiving" : "running",
        });
      } catch (error) {
        await this.fail(test, supplier, error);
        return;
      }
    }
    if (!task?.providerTaskId) {
      await this.patchCase(
        test,
        { status: "needs_attention", reason: "没有可查询的远端任务编号" },
        "需要核对供应商任务",
      );
      return;
    }
    try {
      const started = Date.now();
      while (task.status === "running" || task.status === "queued") {
        if (Date.now() - started > 10 * 60_000)
          throw new Error("任务等待超过十分钟");
        await (
          this.deps.sleep ??
          ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
        )(Math.max(1000, Math.min(task.pollAfterMs ?? 3000, 15000)));
        task = await this.deps.poll(test, task);
        await this.patchCase(test, {
          task: JSON.parse(JSON.stringify(task)),
          status: task.status === "succeeded" ? "archiving" : "running",
        });
      }
      if (task.status !== "succeeded") {
        await this.fail({ ...test, task: task as unknown as Record<string, unknown> }, supplier,
          Object.assign(new Error(task.error ?? "供应商任务失败"), { details: { responseBody: task.result } }), true);
        return;
      }
      const result = await this.deps.archive(test, task);
      const status = classifyActualResolution(
        result.width,
        result.height,
        test.expectedWidth,
        test.expectedHeight,
        test.resolution,
      );
      const actualCharge = await this.deps
        .charge?.(supplier, {
          ...test,
          task: task as unknown as Record<string, unknown>,
        })
        .catch(() => undefined);
      const chargeStatus = reconcileVerificationCharge(
        test.expectedCharge,
        verificationChargeForComparison(test, actualCharge),
        test.requestId,
        task.providerTaskId,
      );
      const latest = await this.deps.repository.getConnection(
        test.connectionId,
      );
      const stillCurrent =
        latest &&
        verificationFingerprint(latest, this.deps.fingerprintKey, test.modelId) ===
          test.fingerprint;
      await this.patchCase(
        test,
        {
          status: !stillCurrent
            ? "superseded"
            : status === "unsupported"
              ? "inconclusive"
              : "succeeded",
          rejectedParameter: undefined,
          resolutionMismatch: status === "unsupported" || undefined,
          assetId: result.assetId,
          actualWidth: result.width,
          actualHeight: result.height,
          approximate: status === "approximate",
          actualCharge,
          chargeStatus,
          reason:
            status === "unsupported"
              ? "返回图片尺寸或比例未达到此档位要求"
              : status === "approximate"
                ? `按长边计为近似 ${test.resolution}；实际 ${result.width}×${result.height}`
                : test.quality
                ? "最高档请求已接受，画质差异未验证"
                : "尺寸已核验",
        },
        chargeStatus === "mismatch" ? "实际扣费与说明价格不一致" : undefined,
      );
      // Update evidence without network reads or creating new paid cases.
    } catch (error) {
      const empty = error instanceof EmptyVerificationImageError;
      if (empty) {
        await this.fail({ ...test, task: task as unknown as Record<string, unknown> }, supplier, error, true);
        return;
      }
      await this.patchCase(
        test,
        {
          status: empty ? "inconclusive" : "needs_attention",
          reason: empty ? error.message : "查询或下载未完成，可核对并取回已有结果",
        },
        empty ? "供应商返回空图片结果，请查看核验记录" : "已有任务需要处理，未重新生成",
      );
    }
  }
}
