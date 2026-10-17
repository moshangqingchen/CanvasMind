const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const boolean = (value: unknown): boolean | undefined =>
  value === true || value === "true" || value === 1 || value === "1" ? true
    : value === false || value === "false" || value === 0 || value === "0" ? false : undefined;
const count = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** A successful list envelope may still contain only one page. Price fields do
 * not participate: a complete list without quotes remains a complete list. */
export function supplierDirectoryPayloadComplete(payload: unknown): boolean {
  if (Array.isArray(payload)) return true;
  const root = record(payload);
  if (!root) return false;
  const data = record(root.data);
  // Match parseSupplierCatalog's grouped-feed precedence. An unrelated data
  // array cannot make an incomplete groups array satisfy the envelope total.
  const rows = [root.groups, data?.groups, root.data, root.models, root.items, root.channels,
    data?.data, data?.models, data?.items, data?.channels].find(Array.isArray);
  const scopes = [root, data, root.pagination, root.meta, data?.pagination, data?.meta]
    .map(record).filter((value): value is Record<string, unknown> => !!value);
  for (const scope of scopes) {
    if (scope.error || boolean(scope.success) === false) return false;
    for (const key of ["complete", "has_more", "hasMore", "truncated"]) {
      if (scope[key] === undefined || scope[key] === null) continue;
      const flag = boolean(scope[key]);
      if (flag === undefined || (key === "complete" ? !flag : flag)) return false;
    }
    if (["nextPageToken", "next_page_token", "nextCursor", "next_cursor", "next"].some(key =>
      typeof scope[key] === "string" && scope[key].trim() || typeof scope[key] === "number" && scope[key] > 0)) return false;
    if (scope.total !== undefined && scope.total !== null) {
      const total = count(scope.total);
      if (total === undefined || rows && total > rows.length) return false;
    }
    const pages = count(scope.total_pages ?? scope.totalPages);
    const page = count(scope.page ?? scope.current_page ?? scope.currentPage);
    // These readers make a single request; receiving the last page does not
    // establish that preceding pages were read or accumulated.
    if (pages !== undefined && pages > 1 || page !== undefined && page > 1) return false;
  }
  // Group feeds can contain independently paginated model lists.
  const groups = Array.isArray(root.groups) ? root.groups : Array.isArray(data?.groups) ? data.groups : [];
  return groups.every(group => !record(group) || supplierDirectoryPayloadComplete(group));
}
