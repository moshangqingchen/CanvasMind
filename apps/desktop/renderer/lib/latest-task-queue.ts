interface Waiter<TResult> {
  resolve: (result: TResult) => void;
  reject: (error: unknown) => void;
}

interface PendingTask<T, TResult> {
  value: T;
  waiters: Waiter<TResult>[];
}

/** Serializes work while coalescing queued values to the newest snapshot. */
export class LatestTaskQueue<T, TResult = void> {
  private running = false;
  private pending: PendingTask<T, TResult> | null = null;

  constructor(private readonly worker: (value: T) => Promise<TResult>) {}

  enqueue(value: T): Promise<TResult> {
    const completion = new Promise<TResult>((resolve, reject) => {
      if (this.pending) {
        this.pending.value = value;
        this.pending.waiters.push({ resolve, reject });
      } else {
        this.pending = { value, waiters: [{ resolve, reject }] };
      }
    });
    void this.drain();
    return completion;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const task = this.pending;
        this.pending = null;
        try {
          const result = await this.worker(task.value);
          task.waiters.forEach(({ resolve }) => resolve(result));
        } catch (error) {
          task.waiters.forEach(({ reject }) => reject(error));
        }
      }
    } finally {
      this.running = false;
      if (this.pending) void this.drain();
    }
  }
}
