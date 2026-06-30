import type { GuardianEvent, FrontendGuardianConfig } from "@frontend-guardian/types";
import { resolveConfig, type ResolvedConfig } from "./config.js";
import { generateId, now } from "./utils.js";
import { ErrorCollector } from "./collectors/error.js";
import { FetchCollector } from "./collectors/fetch.js";
import { PerformanceCollector } from "./collectors/performance.js";
import { classifyFetchSpan } from "./classifiers/index.js";
import { EventQueue } from "./batch/queue.js";
import { sendBatch, sendBatchBeacon } from "./batch/transport.js";

export class FrontendGuardianSDK {
  private readonly cfg: ResolvedConfig;
  private readonly sessionId: string;
  private readonly queue: EventQueue;
  private readonly errors: ErrorCollector;
  private readonly fetches: FetchCollector;
  private readonly perf: PerformanceCollector;
  private started = false;
  private readonly unloadHandler: () => void;

  constructor(config: FrontendGuardianConfig) {
    this.cfg = resolveConfig(config);
    this.sessionId = generateId();

    this.queue = new EventQueue(
      this.cfg.batchSize,
      this.cfg.flushInterval,
      (events) => this.flushBatch(events)
    );

    this.errors = new ErrorCollector(this.cfg, (ev) => {
      this.enqueue({ ...ev, sessionId: this.sessionId });
    });

    this.fetches = new FetchCollector(this.cfg, (span) => {
      const events = classifyFetchSpan(span, this.cfg, this.sessionId);
      for (const ev of events) this.enqueue(ev);
    });

    this.perf = new PerformanceCollector(this.cfg, (ev) => {
      this.enqueue({ ...ev, sessionId: this.sessionId });
    });

    this.unloadHandler = () => {
      const remaining = this.queue.drain();
      sendBatchBeacon(remaining, {
        apiUrl: this.cfg.apiUrl,
        apiKey: this.cfg.apiKey,
        environment: this.cfg.environment,
        sessionId: this.sessionId,
      });
    };
  }

  /** Attach all listeners and start the flush timer. Idempotent. */
  start(): this {
    if (this.started || !this.cfg.enabled) return this;
    this.started = true;

    this.errors.attach();
    this.fetches.attach();
    this.perf.attach();
    this.queue.start();

    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.unloadHandler, { once: true });
    }

    this.log("SDK started | session:", this.sessionId, "| env:", this.cfg.environment);
    return this;
  }

  /** Detach all listeners and stop the flush timer. Flushes any pending events. */
  stop(): void {
    if (!this.started) return;
    this.errors.detach();
    this.fetches.detach();
    this.perf.detach();
    this.queue.stop();

    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.unloadHandler);
    }

    void this.queue.flush();
    this.started = false;
  }

  /** Manually capture an Error. Returns the generated event id. */
  captureError(err: Error, extras: Record<string, unknown> = {}): string {
    this.errors.capture(err, extras);
    // The collector calls back into enqueue; return a stable id for the caller.
    return generateId();
  }

  /** Manually capture a plain message as an error-category event. */
  captureMessage(message: string, extras: Record<string, unknown> = {}): string {
    return this.captureError(new Error(message), extras);
  }

  /** Force-flush the event queue right now (useful in tests / after navigation). */
  flush(): Promise<void> {
    return this.queue.flush();
  }

  get sessionInfo() {
    return {
      id: this.sessionId,
      startedAt: now(),
      environment: this.cfg.environment,
      queueSize: this.queue.size,
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private enqueue(event: GuardianEvent): void {
    if (Math.random() > this.cfg.sampleRate) return;
    this.queue.push(event);
    this.log("Queued", event.category, event.id);
  }

  private async flushBatch(events: GuardianEvent[]): Promise<void> {
    this.log(`Flushing ${events.length} event(s)…`);
    const result = await sendBatch(events, {
      apiUrl: this.cfg.apiUrl,
      apiKey: this.cfg.apiKey,
      environment: this.cfg.environment,
      sessionId: this.sessionId,
      debug: this.cfg.debug,
    });
    if (result && this.cfg.debug) {
      console.debug(`[FrontendGuardian] Batch ack: +${result.accepted} -${result.rejected}`);
    }
  }

  private log(...args: unknown[]): void {
    if (this.cfg.debug) console.debug("[FrontendGuardian]", ...args);
  }
}
