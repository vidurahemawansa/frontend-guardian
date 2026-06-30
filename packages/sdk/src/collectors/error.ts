import type { ErrorGuardianEvent } from "@frontend-guardian/types";
import type { ResolvedConfig } from "../config.js";
import { SDK_VERSION } from "../config.js";
import { generateId, now, currentUrl, parseStack } from "../utils.js";

export type ErrorEventHandler = (event: ErrorGuardianEvent) => void;

export class ErrorCollector {
  private readonly onEvent: ErrorEventHandler;
  private readonly config: ResolvedConfig;
  private readonly errorListener: (e: ErrorEvent) => void;
  private readonly rejectionListener: (e: PromiseRejectionEvent) => void;
  private attached = false;

  constructor(config: ResolvedConfig, onEvent: ErrorEventHandler) {
    this.config = config;
    this.onEvent = onEvent;

    this.errorListener = (e: ErrorEvent) => {
      const err = e.error instanceof Error ? e.error : new Error(e.message);
      this.emit(err, "uncaught_error");
    };

    this.rejectionListener = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const err = reason instanceof Error ? reason : new Error(String(reason));
      this.emit(err, "unhandled_rejection");
    };
  }

  attach(): void {
    if (this.attached || typeof window === "undefined") return;
    window.addEventListener("error", this.errorListener);
    window.addEventListener("unhandledrejection", this.rejectionListener);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached || typeof window === "undefined") return;
    window.removeEventListener("error", this.errorListener);
    window.removeEventListener("unhandledrejection", this.rejectionListener);
    this.attached = false;
  }

  /** Manually capture an Error (e.g. from a try/catch). */
  capture(err: Error, extras: Record<string, unknown> = {}): void {
    this.emit(err, "manual", extras);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private emit(
    err: Error,
    kind: ErrorGuardianEvent["kind"],
    extras: Record<string, unknown> = {}
  ): void {
    if (!this.config.enabled) return;
    if (Math.random() > (this.config.sampleRate)) return;

    const event: ErrorGuardianEvent = {
      id: generateId(),
      category: "error",
      kind,
      timestamp: now(),
      environment: this.config.environment,
      url: currentUrl(),
      sessionId: "",   // filled in by the SDK
      sdkVersion: SDK_VERSION,
      message: err.message,
      stack: parseStack(err.stack),
      extras,
    };

    this.onEvent(event);
  }
}
