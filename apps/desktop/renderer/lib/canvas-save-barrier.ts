const savesByCanvas = new Map<string, Set<Promise<unknown>>>();

/** Track the complete save (including its draft acknowledgement) without changing its result. */
export function trackCanvasSave<T>(canvasId: string, promise: Promise<T>): Promise<T> {
  const saves = savesByCanvas.get(canvasId) ?? new Set<Promise<unknown>>();
  saves.add(promise);
  savesByCanvas.set(canvasId, saves);
  const settled = () => {
    saves.delete(promise);
    if (saves.size === 0 && savesByCanvas.get(canvasId) === saves) savesByCanvas.delete(canvasId);
  };
  // Both branches fulfill: the cleanup continuation must not create an unhandled rejection.
  void promise.then(settled, settled);
  return promise;
}

/** Wait through newly registered work too; failed saves still allow recovery from server/draft. */
export async function waitForCanvasSaves(canvasId: string): Promise<void> {
  for (;;) {
    const saves = savesByCanvas.get(canvasId);
    if (!saves?.size) return;
    await Promise.allSettled([...saves]);
  }
}
