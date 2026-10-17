import "server-only";
import { decryptSecret, providerFetch, SupplierLoginError } from "@super-canvas/providers";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import type { CatalogPipelineDependencies } from "./catalog-pipeline-service";
import { requireServerMasterKey } from "./master-key";
import { currentSupplierSiteLogin, openSupplierSiteSession } from "./supplier-site-session";
import { ModelInventoryReadError } from "./model-inventory-failure";

/** Request-local secrets never enter tasks, facts, diagnostics or queue state. */
export const catalogPipelineReaders: CatalogPipelineDependencies["readers"] = async (
  connection: ProviderConnectionRecord, supplier?: SupplierRecord,
) => {
  let apiKey = "";
  try { if (connection.encryptedSecret) apiKey = decryptSecret(connection.encryptedSecret, requireServerMasterKey()); }
  catch { /* Missing credentials leave a source unread; they are not an empty inventory. */ }
  return {
    apiKey,
    fetchFor: spec => spec.authScope.kind === "connection-key" && !apiKey ||
      spec.authScope.kind === "site-account" && (!supplier || !currentSupplierSiteLogin(supplier)) ? undefined : providerFetch,
    wrapTransport: (spec, scheduled) => {
      if (spec.authScope.kind !== "site-account" || !supplier) return scheduled;
      // Each logical source owns the authentication traffic and its lease. A
      // session bound to one completed job must never be reused by another job.
      let session: ReturnType<typeof openSupplierSiteSession> | undefined;
      return async (input, init) => {
        try {
          session ??= openSupplierSiteSession(supplier, scheduled);
          const authenticated = await session;
          if (!authenticated) throw new ModelInventoryReadError("invalid_credentials", 401);
          return await authenticated.fetch(input, init);
        } catch (error) {
          if (error instanceof SupplierLoginError) throw new ModelInventoryReadError(
            error.code === "unsupported_platform" ? "invalid_configuration" : error.status === 429 ? "rate_limited"
              : error.status >= 500 ? "network" : "invalid_credentials", error.status);
          throw error;
        }
      };
    },
  };
};
