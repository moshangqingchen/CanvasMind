/** Share overlapping reads without retaining a stale result between refreshes. */
export function createSharedRequest<T>(load: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  let revision = 0;

  const read = (): Promise<T> => {
    if (pending) return pending;
    const startedAt = revision;
    const request = load().then(
      (value) => {
        // A completed mutation makes any older read non-authoritative. Join
        // the fresh read instead of restoring deleted settings from a slow read.
        return startedAt === revision ? value : read();
      },
      (error: unknown) => {
        if (startedAt !== revision) return read();
        throw error;
      },
    );
    pending = request;
    const settled = () => {
      if (pending === request) pending = undefined;
    };
    void request.then(settled, settled);
    return request;
  };

  return {
    read,
    invalidate() {
      revision += 1;
      pending = undefined;
    },
  };
}
