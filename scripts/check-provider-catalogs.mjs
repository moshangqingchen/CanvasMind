#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const DEFAULT_CATALOGS = [
  {
    id: "cangyuan",
    url: "https://ai.cangyuansuanli.cn/api/pricing",
  },
  {
    id: "cyberafei",
    url: "https://api.3365api.cn/api/pricing",
  },
  {
    id: "chentu",
    url: "https://tu.988236.xyz/api/pricing",
  },
  {
    id: "miaowu",
    url: "https://api.miaowuai.store/api/pricing",
  },
];

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REASONABLE_MODEL_COUNT = 10_000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelIdFromRecord(record) {
  if (!isRecord(record)) return null;
  for (const key of ["model_name", "id", "model"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function keysPresent(records) {
  const keys = new Set();
  for (const record of records) {
    if (!isRecord(record)) continue;
    for (const key of Object.keys(record)) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * Validate the stable portion of a pricing response without importing the
 * application parser. This keeps the monitor useful even when a parser is
 * being refactored and makes schema drift visible before it becomes a silent
 * fallback catalog.
 */
export function inspectCatalogPayload(payload, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isRecord(payload)) {
    return {
      status: "error",
      modelCount: 0,
      uniqueModelCount: 0,
      duplicateCount: 0,
      keys: [],
      errors: ["response JSON must be an object"],
      warnings,
    };
  }

  if (!Array.isArray(payload.data)) {
    errors.push("missing top-level data array");
  }
  const records = Array.isArray(payload.data) ? payload.data : [];
  const modelIds = records.map(modelIdFromRecord).filter(Boolean);
  const uniqueModelIds = new Set(modelIds);
  const duplicateCount = modelIds.length - uniqueModelIds.size;
  const keys = keysPresent(records);

  if (records.length === 0) errors.push("pricing data array is empty");
  if (records.length > 0 && modelIds.length === 0)
    errors.push("no records contain a recognized model identifier");
  if (records.length > 0 && modelIds.length < records.length * 0.5)
    warnings.push("more than half of pricing records lack a model identifier");

  const hasGroupMetadata =
    isRecord(payload.group_ratio) || isRecord(payload.usable_group);
  if (!hasGroupMetadata)
    warnings.push("group_ratio and usable_group are both missing");
  if (duplicateCount > 0)
    warnings.push(`${duplicateCount} duplicate model identifier(s) returned`);

  const previousCount = options.previousModelCount;
  if (
    typeof previousCount === "number" &&
    previousCount > 0 &&
    modelIds.length > 0 &&
    (modelIds.length < previousCount * 0.25 ||
      modelIds.length > previousCount * 4)
  ) {
    warnings.push(
      `model count changed from ${previousCount} to ${modelIds.length}`,
    );
  }
  if (modelIds.length > MAX_REASONABLE_MODEL_COUNT)
    warnings.push(`model count exceeds ${MAX_REASONABLE_MODEL_COUNT}`);

  return {
    status: errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ok",
    modelCount: modelIds.length,
    uniqueModelCount: uniqueModelIds.size,
    duplicateCount,
    keys,
    errors,
    warnings,
  };
}

async function fetchCatalog(catalog, fetchImpl, timeoutMs, previousModelCount) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(catalog.url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        id: catalog.id,
        url: catalog.url,
        status: "error",
        httpStatus: response.status,
        modelCount: 0,
        uniqueModelCount: 0,
        duplicateCount: 0,
        keys: [],
        errors: [`HTTP ${response.status}`],
        warnings: [],
        elapsedMs: Date.now() - startedAt,
      };
    }
    return {
      id: catalog.id,
      url: catalog.url,
      httpStatus: response.status,
      ...inspectCatalogPayload(body, { previousModelCount }),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: catalog.id,
      url: catalog.url,
      status: "error",
      modelCount: 0,
      uniqueModelCount: 0,
      duplicateCount: 0,
      keys: [],
      errors: [error?.name === "AbortError" ? "request timed out" : "request failed"],
      warnings: [],
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkCatalogs({
  catalogs = DEFAULT_CATALOGS,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  previousReport,
} = {}) {
  const previousById = new Map(
    (Array.isArray(previousReport?.catalogs) ? previousReport.catalogs : []).map(
      (item) => [item.id, item.modelCount],
    ),
  );
  const results = await Promise.all(
    catalogs.map((catalog) =>
      fetchCatalog(
        catalog,
        fetchImpl,
        timeoutMs,
        previousById.get(catalog.id),
      ),
    ),
  );
  return {
    checkedAt: new Date().toISOString(),
    ok: results.every((result) => result.status === "ok"),
    catalogs: results,
  };
}

function parseArgs(argv) {
  const args = { output: null, previous: null, timeoutMs: DEFAULT_TIMEOUT_MS, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") args.output = argv[++index] ?? null;
    else if (value === "--previous-report") args.previous = argv[++index] ?? null;
    else if (value === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else if (value === "--strict") args.strict = true;
    else if (value === "--help") args.help = true;
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/check-provider-catalogs.mjs [--output report.json] [--previous-report report.json] [--timeout-ms 15000] [--strict]",
    );
    process.exit(0);
  }
  let previousReport;
  if (args.previous) {
    try {
      previousReport = JSON.parse(await readFile(args.previous, "utf8"));
    } catch {
      console.error(`Unable to read previous report: ${args.previous}`);
      process.exit(2);
    }
  }
  const report = await checkCatalogs({
    timeoutMs: Number.isFinite(args.timeoutMs) ? args.timeoutMs : DEFAULT_TIMEOUT_MS,
    previousReport,
  });
  if (args.output) await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  const hasWarnings = report.catalogs.some((catalog) => catalog.status === "warning");
  process.exit(report.ok && (!args.strict || !hasWarnings) ? 0 : 1);
}
