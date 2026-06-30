import type { GuardianEvent } from "@frontend-guardian/types";

export type FlushHandler = (events: GuardianEvent[]) => Promise<void>;

/**
 * A size-bounded, timer-driven event queue.
 *
 * Flushes automatically when:
 *   1. The queue reaches `maxSize` events, or
 *   2. The `interval` timer fires.
 *
 * Call `flush()` manually to drain immediately (e.g. on page unload).
 */
export class EventQueue {
  private queue: GuardianEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly maxSize: number;
  private readonly interval: number;
  private readonly onFlush: FlushHandler;

  constructor(maxSize: number, interval: number, onFlush: FlushHandler) {
    this.maxSize = maxSize;
    this.interval = interval;
    this.onFlush = onFlush;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.flush(), this.interval);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  push(event: GuardianEvent): void {
    this.queue.push(event);
    if (this.queue.length >= this.maxSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0);
    await this.onFlush(batch);
  }

  /** Synchronous drain for use with `sendBeacon` on pagehide. */
  drain(): GuardianEvent[] {
    return this.queue.splice(0);
  }

  get size(): number {
    return this.queue.length;
  }
}
