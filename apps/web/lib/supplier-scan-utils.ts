import { getRepository, type ProviderConnectionRecord } from "@super-canvas/db";
import {
  decryptSecret,
  providerFetch,
  fetchProviderJson,
  supplierModelUrls,
  scanProviderModelCatalog,
  ProviderHttpError,
} from "@super-canvas/providers";
import { requireServerMasterKey } from "./master-key";
/** Bound the response while reading, before allocating a full JSON payload. */
export async function readBoundedModelJson(
  response: Response,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Model response exceeds size limit");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
/** A branded instance pointed elsewhere gets only that instance's inventory, never template prices or transports. */
export async function scanAlternateSupplier(
  connection: ProviderConnectionRecord,
  options?: { fetch?: typeof fetch; persist?: boolean },
) {
  const checkedAt = new Date().toISOString();
  let status: "live" | "empty" | "unauthorized" | "failed" | "unconfigured" =
    "unconfigured";
  let models: ReturnType<typeof scanProviderModelCatalog>["models"] = [];
  let error: string | undefined;
  if (connection.encryptedSecret) {
    try {
      const key = decryptSecret(
        connection.encryptedSecret,
        requireServerMasterKey(),
      );
      let payload: unknown;
      for (const url of supplierModelUrls(
        String(connection.config.baseUrl ?? ""),
      )) {
        try {
          payload = await fetchProviderJson(
            options?.fetch ?? providerFetch,
            url,
            { headers: { authorization: `Bearer ${key}` }, cache: "no-store" },
            {
              phase: "connect",
              timeoutMs: 20000,
              maxResponseBytes: 4 * 1024 * 1024,
            },
          );
          break;
        } catch (e) {
          if (
            e instanceof ProviderHttpError &&
            [401, 403].includes(e.details.status ?? 0)
          )
            throw e;
        }
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        !["data", "models"].some((k) =>
          Array.isArray((payload as Record<string, unknown>)[k]),
        )
      )
        throw new Error("Invalid inventory");
      models = scanProviderModelCatalog(payload).models.map((m) => ({
        ...m,
        metadata: {
          ...m.metadata,
          canvasRunnable: false,
          canvasUnavailableReason:
            "此地址的生成协议尚未验证，请通过当前供应商分组配置受支持协议",
        },
      }));
      status = models.length ? "live" : "empty";
    } catch (e) {
      status =
        e instanceof ProviderHttpError &&
        [401, 403].includes(e.details.status ?? 0)
          ? "unauthorized"
          : "failed";
      error =
        status === "unauthorized"
          ? "当前地址 Key 鉴权失败"
          : "当前地址扫描失败，保留同一来源的历史缓存";
    }
  }
  const modelIds = models.map((m) => m.id);
  if (options?.persist !== false)
    connection = await getRepository().saveConnection(
      {
        ...connection,
        config: {
          ...connection.config,
          modelScanStatus: status,
          modelScanCheckedAt: checkedAt,
          ...(status === "live" || status === "empty"
            ? { modelCatalogModels: models, scannedModelIds: modelIds }
            : {}),
        },
      },
      { expected: connection },
    );
  return {
    connection,
    status,
    checkedAt,
    modelIds,
    error,
    marketplaceGroup: null,
    canvasModels: [],
    canvasDisplayModels: models,
    catalogSource: "live" as const,
  };
}
