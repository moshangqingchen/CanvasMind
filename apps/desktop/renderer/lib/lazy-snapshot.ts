/** One dependency snapshot, evaluated on first use and retained only by its
 * getter. Replacing the getter replaces the cache; no global data is retained. */
export function createLazySnapshot<T>(compute: () => T): () => T {
  let cached: { value: T } | undefined;
  return () => {
    cached ??= { value: compute() };
    return cached.value;
  };
}
