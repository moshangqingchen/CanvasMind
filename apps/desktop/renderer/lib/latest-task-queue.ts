interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface PendingTask<T> {
  value: T;
  waiters: Waiter[];
}

/** Serializes work while coalescing queued values to the newest snapshot. */
export class LatestTaskQueue<T> {
  private running = false;
  private pending: PendingTask<T> | null = null;

  constructor(private readonly worker: (value: T) => Promise<void>) {}

  enqueue(value: T): Promise<void> {
    const completion = new Promise<void>((resolve, reject) => {
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
          await this.worker(task.value);
          task.waiters.forEach(({ resolve }) => resolve());
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
