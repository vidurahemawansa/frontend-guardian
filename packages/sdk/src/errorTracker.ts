import { generateId, now, currentUrl } from "./utils.js";

// ─── Stack frame ──────────────────────────────────────────────────────────────

export interface ParsedFrame {
  /** Original raw line from Error.stack */
  raw: string;
  /** Function name or "<anonymous>" */
  function: string;
  /** Source filename or URL */
  filename: string;
  lineno: number | null;
  colno: number | null;
  /** Not inside node_modules – likely application code */
  inApp: boolean;
  /** Native V8 / browser runtime frame (e.g. "Array.forEach") */
  isNative: boolean;
}

// ─── Cause chain ──────────────────────────────────────────────────────────────

export interface CauseChain {
  name: string;
  message: string;
  stack: ParsedFrame[];
}

// ─── Component context ────────────────────────────────────────────────────────

/**
 * Optional framework context that can be attached when calling
 * `tracker.capture(err, { component: { ... } })`.
 *
 * Works with any framework:
 *   React – pass `componentStack` from an ErrorBoundary's `componentDidCatch`
 *   Vue   – pass `info` from `app.config.errorHandler`
 *   Angular – pass the component class name
 */
export interface ComponentContext {
  /** Nearest component name (e.g. "UserProfile") */
  name: string | null;
  /** Full component stack string from React / Vue */
  componentStack: string | null;
  /** Additional framework-specific metadata */
  props: Record<string, unknown>;
}

// ─── Browser context ──────────────────────────────────────────────────────────

export interface ViewportSize {
  width: number;
  height: number;
}

export interface NetworkInfo {
  /** navigator.connection.type */
  type: string;
  /** e.g. "4g" */
  effectiveType: string;
  /** Mbps */
  downlink: number;
  rtt: number;
}

export interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface BrowserContext {
  userAgent: string;
  language: string;
  online: boolean;
  viewport: ViewportSize | null;
  network: NetworkInfo | null;
  memory: MemoryInfo | null;
}

// ─── Breadcrumbs ──────────────────────────────────────────────────────────────

export type BreadcrumbType =
  | "navigation"
  | "click"
  | "keypress"
  | "console.error"
  | "console.warn"
  | "console.log"
  | "xhr"
  | "custom";

export interface TrackerBreadcrumb {
  timestamp: string;
  type: BreadcrumbType;
  message: string;
  data: Record<string, unknown>;
}

// ─── Error event ──────────────────────────────────────────────────────────────

export type ErrorTrackerKind =
  | "uncaught_error"      // window.onerror / window.addEventListener("error")
  | "unhandled_rejection" // window.addEventListener("unhandledrejection")
  | "manual"              // tracker.capture() / tracker.captureMessage()
  | "console_error";      // optional console.error interception

export type ErrorSeverity = "fatal" | "error" | "warning" | "info";

/** Normalised JS error category based on Error.name */
export type ErrorType =
  | "TypeError"
  | "ReferenceError"
  | "SyntaxError"
  | "RangeError"
  | "URIError"
  | "EvalError"
  | "NetworkError"
  | "AbortError"
  | "TimeoutError"
  | "ChunkLoadError"   // dynamic import / webpack chunk failures
  | "PromiseRejection"
  | "SecurityError"
  | "CustomError"
  | "UnknownError";

export interface ErrorTrackerEvent {
  id: string;
  kind: ErrorTrackerKind;
  severity: ErrorSeverity;
  timestamp: string;
  /** URL of the page where the error occurred */
  pageUrl: string;
  /** Session-scoped id (set by caller or auto-generated) */
  sessionId: string;

  // ── Error details ────────────────────────────────────────────────────────
  /** Error.name (e.g. "TypeError") */
  name: string;
  message: string;
  /** Classified error type */
  errorType: ErrorType;
  /** Normalised stack frames — in-app frames first */
  stack: ParsedFrame[];
  /** The "most likely origin" in-app frame */
  originFrame: ParsedFrame | null;

  // ── Cause chain (error.cause unwinding) ──────────────────────────────────
  /** Chained errors from `error.cause` — index 0 = direct cause */
  causes: CauseChain[];

  // ── Deduplication ────────────────────────────────────────────────────────
  /**
   * Stable fingerprint for grouping identical errors.
   * Computed from: errorName + ':' + message + ':' + originFrame filename:lineno
   */
  fingerprint: string;

  // ── Context ───────────────────────────────────────────────────────────────
  component: ComponentContext | null;
  browser: BrowserContext;

  // ── Breadcrumbs ───────────────────────────────────────────────────────────
  /** Recent user/system actions leading up to this error */
  breadcrumbs: TrackerBreadcrumb[];

  // ── Extra metadata ────────────────────────────────────────────────────────
  tags: Record<string, string>;
  extras: Record<string, unknown>;
}

// ─── Logger interface ─────────────────────────────────────────────────────────

export interface ErrorTrackerLogger {
  log(event: ErrorTrackerEvent): void;
}

export const consoleErrorLogger: ErrorTrackerLogger = {
  log(event: ErrorTrackerEvent): void {
    const badge =
      event.severity === "fatal"   ? "%c FATAL "   :
      event.severity === "error"   ? "%c ERROR "   :
      event.severity === "warning" ? "%c WARN "    : "%c INFO ";
    const badgeStyle =
      event.severity === "fatal"   ? "background:#7f1d1d;color:#fca5a5;font-weight:700;border-radius:3px" :
      event.severity === "error"   ? "background:#450a0a;color:#f87171;font-weight:700;border-radius:3px" :
      event.severity === "warning" ? "background:#3b2200;color:#fbbf24;font-weight:700;border-radius:3px" :
                                     "background:#0c2340;color:#60a5fa;font-weight:700;border-radius:3px";

    console.groupCollapsed(
      `${badge}[ErrorTracker] ${event.name}: ${event.message}`,
      badgeStyle
    );
    console.log("kind      :", event.kind);
    console.log("type      :", event.errorType);
    console.log("fingerprint:", event.fingerprint);
    console.log("page      :", event.pageUrl);

    if (event.originFrame) {
      const f = event.originFrame;
      console.log("origin    :", `${f.function} @ ${f.filename}:${f.lineno ?? "?"}`);
    }

    if (event.stack.length) {
      console.groupCollapsed("Stack trace");
      for (const f of event.stack) {
        const label = f.inApp ? "%c" : "%c";
        const style = f.inApp ? "color:#a78bfa" : "color:#6b7280";
        console.log(`${label}  at ${f.function} (${f.filename}:${f.lineno}:${f.colno})`, style);
      }
      console.groupEnd();
    }

    if (event.causes.length) {
      console.groupCollapsed(`Caused by (${event.causes.length})`);
      for (const c of event.causes) console.log(`  ${c.name}: ${c.message}`);
      console.groupEnd();
    }

    if (event.component) {
      console.log("component :", event.component.name ?? "(anonymous)");
      if (event.component.componentStack) {
        console.groupCollapsed("Component stack");
        console.log(event.component.componentStack);
        console.groupEnd();
      }
    }

    if (event.breadcrumbs.length) {
      console.groupCollapsed(`Breadcrumbs (${event.breadcrumbs.length})`);
      for (const b of event.breadcrumbs) {
        console.log(`  [${b.type}] ${b.message}`);
      }
      console.groupEnd();
    }

    console.log("browser   :", {
      online: event.browser.online,
      viewport: event.browser.viewport,
      memory: event.browser.memory,
    });
    console.groupEnd();
  },
};

// ─── Breadcrumb buffer ────────────────────────────────────────────────────────

class BreadcrumbBuffer {
  private buffer: TrackerBreadcrumb[] = [];
  private readonly maxSize: number;
  private readonly listeners: Array<{ target: EventTarget; type: string; fn: EventListener }> = [];
  private originalConsoleError: typeof console.error | null = null;
  private originalConsoleWarn: typeof console.warn  | null = null;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  attach(patchConsole: boolean): void {
    if (typeof window === "undefined") return;

    // Navigation
    this.on(window, "popstate", () => this.push("navigation", `Navigated to ${location.href}`, { href: location.href }));
    this.on(window, "hashchange", (e) => {
      const ne = e as HashChangeEvent;
      this.push("navigation", `Hash changed → ${ne.newURL}`, { from: ne.oldURL, to: ne.newURL });
    });

    // Click (record element identity, not content)
    this.on(document, "click", (e) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      const label = el.getAttribute("aria-label")
        ?? el.getAttribute("data-testid")
        ?? el.innerText?.slice(0, 40)
        ?? el.tagName.toLowerCase();
      this.push("click", `Click: ${label}`, {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: el.className || null,
      });
    }, { passive: true });

    // Console patching
    if (patchConsole) {
      this.originalConsoleError = console.error;
      this.originalConsoleWarn  = console.warn;

      const self = this;
      console.error = function patchedError(...args: unknown[]) {
        self.push("console.error", args.map(String).join(" "), {});
        self.originalConsoleError?.apply(console, args);
      };
      console.warn = function patchedWarn(...args: unknown[]) {
        self.push("console.warn", args.map(String).join(" "), {});
        self.originalConsoleWarn?.apply(console, args);
      };
    }
  }

  detach(): void {
    for (const { target, type, fn } of this.listeners) {
      target.removeEventListener(type, fn);
    }
    this.listeners.length = 0;

    if (this.originalConsoleError) {
      console.error = this.originalConsoleError;
      this.originalConsoleError = null;
    }
    if (this.originalConsoleWarn) {
      console.warn = this.originalConsoleWarn;
      this.originalConsoleWarn = null;
    }
  }

  add(crumb: TrackerBreadcrumb): void {
    this.buffer.push(crumb);
    if (this.buffer.length > this.maxSize) this.buffer.shift();
  }

  snapshot(): TrackerBreadcrumb[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer = [];
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private push(type: BreadcrumbType, message: string, data: Record<string, unknown>): void {
    this.add({ timestamp: now(), type, message, data });
  }

  private on(
    target: EventTarget,
    type: string,
    fn: EventListener,
    opts?: AddEventListenerOptions
  ): void {
    target.addEventListener(type, fn, opts);
    this.listeners.push({ target, type, fn });
  }
}

// ─── Deduplication window ─────────────────────────────────────────────────────

interface DedupEntry {
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

// ─── ErrorTracker config ──────────────────────────────────────────────────────

export interface ErrorTrackerConfig {
  /**
   * Receives every structured `ErrorTrackerEvent`.
   * Defaults to `consoleErrorLogger`.
   */
  logger?: ErrorTrackerLogger;

  /** Intercept `console.error` / `console.warn` as breadcrumbs. Default: true */
  patchConsole?: boolean;

  /** Number of breadcrumbs to retain. Default: 30 */
  maxBreadcrumbs?: number;

  /**
   * Suppress an error after it has been reported this many times
   * within `dedupeWindowMs`. Default: 5
   */
  maxSameError?: number;

  /** Sliding window for deduplication (ms). Default: 60 000 */
  dedupeWindowMs?: number;

  /**
   * Errors whose message matches any of these patterns are silently dropped.
   * Useful for third-party noise (ad-blockers, browser extensions, etc.).
   */
  ignoreErrors?: Array<string | RegExp>;

  /**
   * Override the computed severity for specific error types.
   * e.g. `{ TypeError: "fatal" }`
   */
  severityOverrides?: Partial<Record<ErrorType, ErrorSeverity>>;

  /**
   * Additional static tags attached to every event.
   * e.g. `{ release: "1.2.3", team: "platform" }`
   */
  tags?: Record<string, string>;

  /** Session id propagated onto every event. Auto-generated when omitted. */
  sessionId?: string;

  /** Enable verbose tracker logs. Default: false */
  debug?: boolean;
}

// ─── ErrorTracker class ───────────────────────────────────────────────────────

export class ErrorTracker {
  private readonly cfg: Required<ErrorTrackerConfig>;
  private readonly sessionId: string;
  private readonly breadcrumbs: BreadcrumbBuffer;
  private readonly dedupe = new Map<string, DedupEntry>();
  private attached = false;

  private readonly windowErrorListener: (e: ErrorEvent) => void;
  private readonly rejectionListener: (e: PromiseRejectionEvent) => void;
  private dedupeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ErrorTrackerConfig = {}) {
    this.cfg = {
      logger:             config.logger             ?? consoleErrorLogger,
      patchConsole:       config.patchConsole       ?? true,
      maxBreadcrumbs:     config.maxBreadcrumbs     ?? 30,
      maxSameError:       config.maxSameError       ?? 5,
      dedupeWindowMs:     config.dedupeWindowMs     ?? 60_000,
      ignoreErrors:       config.ignoreErrors       ?? [],
      severityOverrides:  config.severityOverrides  ?? {},
      tags:               config.tags               ?? {},
      sessionId:          config.sessionId          ?? generateId(),
      debug:              config.debug              ?? false,
    };

    this.sessionId    = this.cfg.sessionId;
    this.breadcrumbs  = new BreadcrumbBuffer(this.cfg.maxBreadcrumbs);

    // Pre-bind so we can remove exact same references later
    this.windowErrorListener = (e: ErrorEvent) => {
      const err = e.error instanceof Error ? e.error : new Error(e.message);
      this.handleError(err, "uncaught_error", {
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
      });
    };

    this.rejectionListener = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const err = reason instanceof Error
        ? reason
        : new Error(typeof reason === "string" ? reason : JSON.stringify(reason));
      if (!(reason instanceof Error)) err.name = "PromiseRejection";
      this.handleError(err, "unhandled_rejection", { reason: String(reason) });
    };
  }

  /**
   * Attach global listeners and start the breadcrumb recorder.
   * Idempotent — safe to call multiple times.
   */
  attach(): this {
    if (this.attached || typeof window === "undefined") return this;

    window.addEventListener("error", this.windowErrorListener);
    window.addEventListener("unhandledrejection", this.rejectionListener);
    this.breadcrumbs.attach(this.cfg.patchConsole);

    // Prune dedupe map every minute to avoid memory leaks
    this.dedupeTimer = setInterval(() => this.pruneDedupe(), 60_000);

    this.attached = true;
    this.log("ErrorTracker attached | session:", this.sessionId);
    return this;
  }

  /** Remove all listeners and restore patched globals. */
  detach(): void {
    if (!this.attached || typeof window === "undefined") return;
    window.removeEventListener("error", this.windowErrorListener);
    window.removeEventListener("unhandledrejection", this.rejectionListener);
    this.breadcrumbs.detach();
    if (this.dedupeTimer !== null) clearInterval(this.dedupeTimer);
    this.dedupeTimer = null;
    this.attached = false;
  }

  /**
   * Manually capture an Error (e.g. from a `try/catch` or framework hook).
   *
   * @param err     The Error instance
   * @param context Optional component / tag / extras context
   *
   * @example – React ErrorBoundary
   * ```tsx
   * componentDidCatch(error: Error, info: React.ErrorInfo) {
   *   tracker.capture(error, {
   *     component: {
   *       name: "UserProfile",
   *       componentStack: info.componentStack,
   *       props: {},
   *     },
   *   });
   * }
   * ```
   *
   * @example – Vue error handler
   * ```ts
   * app.config.errorHandler = (err, instance, info) => {
   *   tracker.capture(err as Error, {
   *     component: { name: instance?.$options.name ?? null, componentStack: null, props: { vueInfo: info } },
   *   });
   * };
   * ```
   */
  capture(
    err: Error,
    context: {
      component?: ComponentContext;
      severity?: ErrorSeverity;
      tags?: Record<string, string>;
      extras?: Record<string, unknown>;
    } = {}
  ): string {
    return this.handleError(err, "manual", context.extras ?? {}, context);
  }

  /** Capture a plain string message as an error event. */
  captureMessage(
    message: string,
    severity: ErrorSeverity = "info",
    extras: Record<string, unknown> = {}
  ): string {
    const err = new Error(message);
    err.name = "CapturedMessage";
    return this.handleError(err, "manual", extras, { severity });
  }

  /**
   * Manually add a breadcrumb (e.g. user action, API call, state change).
   */
  addBreadcrumb(
    type: BreadcrumbType,
    message: string,
    data: Record<string, unknown> = {}
  ): void {
    this.breadcrumbs.add({ timestamp: now(), type, message, data });
  }

  // ─── Core error handling ──────────────────────────────────────────────────

  private handleError(
    err: Error,
    kind: ErrorTrackerKind,
    rawExtras: Record<string, unknown> = {},
    context: {
      component?: ComponentContext;
      severity?: ErrorSeverity;
      tags?: Record<string, string>;
      extras?: Record<string, unknown>;
    } = {}
  ): string {
    if (this.shouldIgnore(err.message)) {
      this.log("Ignored error:", err.message);
      return "";
    }

    const stack      = parseDetailedStack(err.stack);
    const originFrame = pickOriginFrame(stack);
    const fingerprint = buildFingerprint(err.name, err.message, originFrame);
    const errorType   = classifyError(err);
    const severity    = context.severity
      ?? this.cfg.severityOverrides[errorType]
      ?? defaultSeverity(errorType, kind);
    const causes      = unwrapCauses(err);
    const id          = generateId();

    if (this.isDuplicate(fingerprint)) {
      this.log("Suppressed duplicate:", fingerprint);
      return id;
    }

    const event: ErrorTrackerEvent = {
      id,
      kind,
      severity,
      timestamp: now(),
      pageUrl: currentUrl(),
      sessionId: this.sessionId,

      name: err.name || "Error",
      message: err.message,
      errorType,
      stack,
      originFrame,
      causes,
      fingerprint,

      component: context.component ?? extractReactContext(err),
      browser: captureBrowserContext(),

      breadcrumbs: this.breadcrumbs.snapshot(),

      tags:   { ...this.cfg.tags, ...(context.tags ?? {}) },
      extras: { ...rawExtras, ...(context.extras ?? {}) },
    };

    this.cfg.logger.log(event);
    this.log("Captured", event.kind, event.fingerprint);
    return id;
  }

  // ─── Deduplication ────────────────────────────────────────────────────────

  private isDuplicate(fingerprint: string): boolean {
    const now = Date.now();
    const entry = this.dedupe.get(fingerprint);

    if (!entry) {
      this.dedupe.set(fingerprint, { count: 1, firstSeenAt: now, lastSeenAt: now });
      return false;
    }

    // Sliding window: reset if last occurrence was outside the window
    if (now - entry.lastSeenAt > this.cfg.dedupeWindowMs) {
      entry.count = 1;
      entry.firstSeenAt = now;
    } else {
      entry.count += 1;
    }
    entry.lastSeenAt = now;

    return entry.count > this.cfg.maxSameError;
  }

  private pruneDedupe(): void {
    const cutoff = Date.now() - this.cfg.dedupeWindowMs;
    for (const [key, entry] of this.dedupe) {
      if (entry.lastSeenAt < cutoff) this.dedupe.delete(key);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private shouldIgnore(message: string): boolean {
    return this.cfg.ignoreErrors.some((p) =>
      typeof p === "string" ? message.includes(p) : p.test(message)
    );
  }

  private log(...args: unknown[]): void {
    if (this.cfg.debug) console.debug("[ErrorTracker]", ...args);
  }
}

// ─── Pure helper functions ────────────────────────────────────────────────────

/**
 * Parses `Error.stack` into rich `ParsedFrame` objects.
 * Handles V8, Firefox (SpiderMonkey), and Safari (JavaScriptCore) formats.
 */
function parseDetailedStack(rawStack: string | undefined): ParsedFrame[] {
  if (!rawStack) return [];

  return rawStack
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => !line.trim().startsWith("Error:")) // drop the "Error: message" header
    .map((line): ParsedFrame => {
      const raw = line.trim();

      // V8: "    at FunctionName (filename:line:col)"
      const v8Named = /^at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)$/.exec(raw);
      if (v8Named) {
        const filename = v8Named[2] ?? "";
        return {
          raw,
          function: v8Named[1] ?? "<anonymous>",
          filename,
          lineno: parseInt(v8Named[3] ?? "0", 10),
          colno:  parseInt(v8Named[4] ?? "0", 10),
          inApp:  isInApp(filename),
          isNative: isNativeFrame(filename),
        };
      }

      // V8 anonymous: "    at filename:line:col"
      const v8Anon = /^at\s+(.*?):(\d+):(\d+)$/.exec(raw);
      if (v8Anon) {
        const filename = v8Anon[1] ?? "";
        return {
          raw,
          function: "<anonymous>",
          filename,
          lineno: parseInt(v8Anon[2] ?? "0", 10),
          colno:  parseInt(v8Anon[3] ?? "0", 10),
          inApp:  isInApp(filename),
          isNative: isNativeFrame(filename),
        };
      }

      // Firefox / Safari: "functionName@filename:line:col"
      const gecko = /^(.*?)@(.*?):(\d+):(\d+)$/.exec(raw);
      if (gecko) {
        const filename = gecko[2] ?? "";
        return {
          raw,
          function: gecko[1] || "<anonymous>",
          filename,
          lineno: parseInt(gecko[3] ?? "0", 10),
          colno:  parseInt(gecko[4] ?? "0", 10),
          inApp:  isInApp(filename),
          isNative: isNativeFrame(filename),
        };
      }

      return { raw, function: "<unknown>", filename: "", lineno: null, colno: null, inApp: false, isNative: false };
    });
}

function isInApp(filename: string): boolean {
  return (
    filename.length > 0 &&
    !filename.includes("node_modules") &&
    !filename.startsWith("native ") &&
    !filename.includes("webpack/runtime") &&
    !filename.includes("(webpack)") &&
    !filename.includes("<anonymous>")
  );
}

function isNativeFrame(filename: string): boolean {
  return filename.startsWith("native ") || filename === "" || filename === "native code";
}

/** Pick the top in-app frame as the most likely error origin. */
function pickOriginFrame(frames: ParsedFrame[]): ParsedFrame | null {
  return frames.find((f) => f.inApp && !f.isNative) ?? frames[0] ?? null;
}

/**
 * Build a stable fingerprint for grouping identical errors.
 * Format: `{errorName}:{message_hash}:{origin_location}`
 */
function buildFingerprint(name: string, message: string, origin: ParsedFrame | null): string {
  const loc = origin ? `${origin.filename}:${origin.lineno ?? 0}` : "unknown";
  // Simple djb2-style hash of message to keep fingerprint short
  const msgHash = djb2Hash(message).toString(16);
  return `${name}:${msgHash}:${loc}`;
}

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep as uint32
  }
  return hash;
}

/**
 * Classify an error into a named `ErrorType` bucket.
 * Recognises all standard JS error names plus common framework / bundler errors.
 */
function classifyError(err: Error): ErrorType {
  const name = err.name ?? "";
  if (name === "PromiseRejection") return "PromiseRejection";

  const knownTypes: ErrorType[] = [
    "TypeError", "ReferenceError", "SyntaxError", "RangeError",
    "URIError", "EvalError", "NetworkError", "AbortError",
    "TimeoutError", "SecurityError",
  ];
  for (const t of knownTypes) {
    if (name === t || err instanceof (globalThis[t as keyof typeof globalThis] as typeof Error ?? Error)) return t;
  }

  // Bundler-specific chunk load errors
  if (
    name === "ChunkLoadError" ||
    err.message.includes("Loading chunk") ||
    err.message.includes("Failed to fetch dynamically imported module")
  ) return "ChunkLoadError";

  if (name === "Error") return "CustomError";
  if (name.endsWith("Error")) return "CustomError";
  return "UnknownError";
}

/** Map error type + kind to a default severity level. */
function defaultSeverity(type: ErrorType, kind: ErrorTrackerKind): ErrorSeverity {
  if (kind === "unhandled_rejection") {
    if (type === "NetworkError" || type === "AbortError") return "warning";
    return "error";
  }
  if (type === "ChunkLoadError") return "fatal";
  if (type === "SecurityError")  return "fatal";
  if (type === "TypeError" || type === "ReferenceError") return "error";
  if (kind === "uncaught_error") return "error";
  return "info";
}

/**
 * Recursively unwrap `error.cause` chains into a flat array.
 * Stops at 10 levels to prevent infinite loops.
 */
function unwrapCauses(err: Error, depth = 0): CauseChain[] {
  const cause = (err as Error & { cause?: unknown }).cause;
  if (!cause || depth > 9) return [];

  const causeErr = cause instanceof Error ? cause : new Error(String(cause));
  const chain: CauseChain = {
    name:    causeErr.name ?? "Error",
    message: causeErr.message,
    stack:   parseDetailedStack(causeErr.stack),
  };
  return [chain, ...unwrapCauses(causeErr, depth + 1)];
}

/**
 * Attempt to extract React component context from an error's internal fiber
 * metadata. Only works in React 16+ development builds or when React attaches
 * the `__reactFiber$` key to an element. This is best-effort.
 */
function extractReactContext(err: Error): ComponentContext | null {
  // React 18+ attaches `_debugOwner` or `__reactFiber` to DOM nodes at the
  // throw site, but we can't reliably access that from the error object alone.
  // Instead, check for the `componentStack` property that ErrorBoundaries attach.
  const anyErr = err as unknown as Record<string, unknown>;
  if (typeof anyErr["componentStack"] === "string") {
    return {
      name: typeof anyErr["componentName"] === "string" ? anyErr["componentName"] : null,
      componentStack: anyErr["componentStack"] as string,
      props: {},
    };
  }
  return null;
}

/** Snapshot the current browser environment. */
function captureBrowserContext(): BrowserContext {
  if (typeof window === "undefined") {
    return { userAgent: "", language: "", online: true, viewport: null, network: null, memory: null };
  }

  let viewport: ViewportSize | null = null;
  if (typeof window.innerWidth === "number") {
    viewport = { width: window.innerWidth, height: window.innerHeight };
  }

  let network: NetworkInfo | null = null;
  const conn = (navigator as Navigator & { connection?: Record<string, unknown> }).connection;
  if (conn) {
    network = {
      type:          String(conn["type"]          ?? "unknown"),
      effectiveType: String(conn["effectiveType"] ?? "unknown"),
      downlink:      Number(conn["downlink"]      ?? 0),
      rtt:           Number(conn["rtt"]           ?? 0),
    };
  }

  let memory: MemoryInfo | null = null;
  const perf = performance as Performance & { memory?: Record<string, number> };
  if (perf.memory) {
    memory = {
      usedJSHeapSize:  perf.memory["usedJSHeapSize"]  ?? 0,
      totalJSHeapSize: perf.memory["totalJSHeapSize"] ?? 0,
      jsHeapSizeLimit: perf.memory["jsHeapSizeLimit"] ?? 0,
    };
  }

  return {
    userAgent: navigator.userAgent,
    language:  navigator.language,
    online:    navigator.onLine,
    viewport,
    network,
    memory,
  };
}

// ─── Module-level singleton helpers ───────────────────────────────────────────

let _tracker: ErrorTracker | null = null;

/**
 * Create and attach a global `ErrorTracker` singleton.
 *
 * @example
 * ```ts
 * import { attachErrorTracker } from "@frontend-guardian/sdk";
 *
 * attachErrorTracker({
 *   tags: { release: "2.1.0" },
 *   ignoreErrors: ["ResizeObserver loop", /extension/i],
 *   logger: {
 *     log: (event) => guardian.captureErrorEvent(event),
 *   },
 * });
 * ```
 */
export function attachErrorTracker(
  config: ErrorTrackerConfig = {},
  opts: { force?: boolean } = {}
): ErrorTracker {
  if (_tracker && !opts.force) return _tracker;
  _tracker?.detach();
  _tracker = new ErrorTracker(config).attach();
  return _tracker;
}

/** Returns the current singleton, or null if never initialised. */
export function getErrorTracker(): ErrorTracker | null {
  return _tracker;
}

/** Detach and destroy the singleton. */
export function detachErrorTracker(): void {
  _tracker?.detach();
  _tracker = null;
}
