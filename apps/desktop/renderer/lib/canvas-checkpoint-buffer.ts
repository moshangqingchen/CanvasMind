/** Keep the newest immutable graph references; materialize at most once per interval. */
export class CanvasCheckpointBuffer<T> {
  private pending: T | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private checkpoint: ((value: T) => void) | undefined;

  constructor(private readonly intervalMs = 400) {}

  queue(value: T, checkpoint: (value: T) => void) {
    this.pending = value;
    this.checkpoint = checkpoint;
    // Do not reset this deadline: a continuous drag still gets crash-recovery
    // checkpoints rather than waiting indefinitely for the user to stop.
    this.timer ??= setTimeout(() => {
      const callback = this.checkpoint;
      const latest = this.take();
      if (latest !== undefined) callback?.(latest);
    }, this.intervalMs);
  }

  /** Transfer the latest snapshot to a final save/pagehide without a later stale write. */
  take(): T | undefined {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const latest = this.pending;
    this.pending = undefined;
    this.checkpoint = undefined;
    return latest;
  }
}
