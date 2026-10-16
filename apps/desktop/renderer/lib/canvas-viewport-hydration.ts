type Viewport = { x: number; y: number; zoom: number };
type Snapshot = {
  projectId: string;
  viewport: Viewport;
  ready: boolean;
  applying?: Promise<boolean>;
};

/** Owns one persisted viewport, independently of temporary canvas/store values. */
export function createCanvasViewportHydration() {
  let target: Snapshot | undefined;

  function reset(): void {
    target = undefined;
  }

  function stage(projectId: string, viewport: Readonly<Viewport>): void {
    // A new read is a new identity, even for the same project and coordinates.
    target = { projectId, viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom }, ready: false };
  }

  function ready(projectId: string): boolean {
    return target?.projectId === projectId && target.ready;
  }

  function apply(projectId: string, applyFn: (viewport: Viewport) => Promise<boolean>): Promise<boolean> {
    const snapshot = target;
    if (!snapshot || snapshot.projectId !== projectId) return Promise.resolve(false);
    if (snapshot.ready) return Promise.resolve(true);
    if (snapshot.applying) return snapshot.applying;

    // Install the shared attempt before invoking application code, including
    // callbacks that throw synchronously. No previous attempts are cached.
    const attempt = Promise.resolve().then(async () => {
      try {
        if (target !== snapshot) return false;
        const applied = await applyFn({ ...snapshot.viewport });
        if (target !== snapshot) return false;
        snapshot.ready = applied;
        return applied;
      } catch {
        // A failed or rejected application remains pending and may be retried.
        return false;
      } finally {
        snapshot.applying = undefined;
      }
    });
    snapshot.applying = attempt;
    return attempt;
  }

  return { reset, stage, apply, ready };
}
