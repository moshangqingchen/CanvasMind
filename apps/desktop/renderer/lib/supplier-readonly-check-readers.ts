import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { catalogPipelineReaders } from "./catalog-pipeline-readers";
import type { SupplierReadOnlyCheckDependencies } from "./supplier-readonly-check";

/** Deduplicate only within one explicit request. No process/model cache is
 * changed, and source keys include account/credential identities. */
export function createSupplierReadOnlyReaders(): SupplierReadOnlyCheckDependencies["readers"] {
  const responses = new Map<string, Promise<Response>>();
  return async (connection: ProviderConnectionRecord, supplier: SupplierRecord) => {
    const readers = await catalogPipelineReaders(connection, supplier);
    return { apiKey: readers.apiKey, fetchFor: spec => {
      const transport = readers.fetchFor(spec);
      if (!transport) return undefined;
      const authenticated = readers.wrapTransport?.(spec, transport) ?? transport;
      return async (input, init) => {
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (method !== "GET") throw new Error("Read-only catalog source requires GET");
        const key = JSON.stringify([spec.sourceKey, input instanceof Request ? input.url : String(input)]);
        let pending = responses.get(key);
        if (!pending) { pending = authenticated(input, { ...init, cache: "no-store" }); responses.set(key, pending); }
        return (await pending).clone();
      };
    } };
  };
}
