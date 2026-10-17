import type { CatalogObservationCommit, CatalogPipelineState, Repository } from "@super-canvas/db";

/** Policy is supplied by the future validated reducer, never by an HTTP body. */
export type CatalogPublicationPolicy = (commit: Readonly<CatalogObservationCommit>) => boolean;
const queues = new WeakMap<Repository, Map<string, Promise<void>>>();
export class CatalogPublicationDisabledError extends Error {
  constructor() { super("目录观察发布尚未启用或未通过策略校验"); this.name = "CatalogPublicationDisabledError"; }
}

/** Only short validation/commit work is serialized; no collection or cooldowns. */
export function createCatalogPublisher(repository: Repository, policy?: CatalogPublicationPolicy) {
  return {
    async publish(input: CatalogObservationCommit): Promise<CatalogPipelineState> {
      const candidate = structuredClone(input);
      const supplierId = candidate.reservation.identity.supplierId;
      const bySupplier = queues.get(repository) ?? new Map<string, Promise<void>>();
      queues.set(repository, bySupplier);
      const previous = bySupplier.get(supplierId) ?? Promise.resolve();
      const work = previous.then(() => {
        // The policy sees an isolated copy and cannot alter the submitted patch.
        if (!policy || policy(structuredClone(candidate)) !== true) throw new CatalogPublicationDisabledError();
        return repository.commitCatalogObservation(candidate);
      });
      const tail = work.then(() => undefined, () => undefined);
      bySupplier.set(supplierId, tail);
      void tail.then(() => { if (bySupplier.get(supplierId) === tail) bySupplier.delete(supplierId); });
      return work;
    },
  };
}
