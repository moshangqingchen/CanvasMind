/**
 * Memoize a pure presentation projection for one immutable input snapshot.
 * The owner recreates this resolver when its connection/verification snapshot
 * changes. Weak keys prevent it from retaining removed connection records.
 * This never caches network work, credentials, or run validation.
 */
export function createPresentationModelCache<T extends object, R>(project: (input: T) => R): (input: T) => R {
  const values = new WeakMap<T, R>();
  return input => {
    if (values.has(input)) return values.get(input)!;
    const value = project(input);
    values.set(input, value);
    return value;
  };
}
