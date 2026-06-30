import { generateId, now, currentUrl, byteLength, peekResponseSize } from "./utils.js";

// ─── Public event types ───────────────────────────────────────────────────────

/**
 * Every kind of structured event the ApiTracker can emit.
 *
 *  api_call          – baseline record for every completed request
 *  slow_response     – duration exceeded the warn threshold (default 1 s)
 *  critical_response – duration exceeded the critical threshold (default 3 s)
 *  large_payload     – response body > warn size (default 256 KB)
 *  critical_payload  – response body > critical size (default 1 MB)
 *  over_fetching     – same endpoint called ≥ N times inside a sliding window
 *  missing_cache     – GET with no caching headers, called more than once
 *  cache_bypass      – GET re-called before its Cache-Control max-age expired
 *  fetch_error       – network failure (no HTTP response at all)
 *  client_error      – HTTP 4xx
 *  server_error      – HTTP 5xx
 */
export type ApiEventKind =
  | "api_call"
  | "slow_response"
  | "critical_response"
  | "large_payload"
  | "critical_payload"
  | "over_fetching"
  | "missing_cache"
  | "cache_bypass"
  | "fetch_error"
  | "client_error"
  | "server_error";

export type ApiEventSeverity = "info" | "warning" | "error" | "critical";

export interface CacheHeaders {
  cacheControl: string | null;
  etag: string | null;
  lastModified: string | null;
  expires: string | null;
  age: string | null;
  vary: string | null;
}

export interface ApiTrackerEvent {
  /** Unique event id */
  id: string;
  kind: ApiEventKind;
  severity: ApiEventSeverity;
  /** ISO-8601 timestamp of the request */
  timestamp: string;
  /** Current page URL */
  pageUrl: string;

  // ── Request ────────────────────────────────────────────────────────────────
  method: string;
  /** URL stripped of query parameters — used as the grouping key */
  url: string;
  /** Original URL including query string */
  rawUrl: string;

  // ── Response ───────────────────────────────────────────────────────────────
  status: number | null;
  /** Round-trip duration in milliseconds */
  duration: number;
  requestBodySize: number;
  responseBodySize: number;

  // ── Caching ────────────────────────────────────────────────────────────────
  cacheHeaders: CacheHeaders;
  /** Parsed max-age value in seconds, null when not present */
  maxAgeSeconds: number | null;

  // ── Pattern signals ────────────────────────────────────────────────────────
  /** How many times this endpoint has been called in the current window */
  callCount: number;

  // ── Human-readable context ─────────────────────────────────────────────────
  message: string;
  /** Extra key/value pairs attached by the tracker */
  data: Record<string, unknown>;
}

// ─── Logger interface ─────────────────────────────────────────────────────────

/**
 * Anything that implements `log(event)` can be used as an ApiTracker logger.
 * Pass your SDK queue, a custom analytics sink, or just `consoleLogger`.
 */
export interface ApiTrackerLogger {
  log(event: ApiTrackerEvent): void;
}

/** Built-in logger that pretty-prints events to the browser console. */
export const consoleLogger: ApiTrackerLogger = {
  log(event: ApiTrackerEvent): void {
    const style = SEVERITY_STYLE[event.severity];
    console.groupCollapsed(
      `%c[ApiTracker] ${event.kind} — ${event.method} ${event.url}`,
      style
    );
    console.table({
      severity: event.severity,
      status: event.status,
      duration: `${event.duration.toFixed(1)} ms`,
      responseSize: formatBytes(event.responseBodySize),
      callCount: event.callCount,
      cacheControl: event.cacheHeaders.cacheControl ?? "(none)",
    });
    if (Object.keys(event.data).length > 0) console.log("data:", event.data);
    console.groupEnd();
  },
};

const SEVERITY_STYLE: Record<ApiEventSeverity, string> = {
  info:     "color:#60a5fa;font-weight:600",
  warning:  "color:#fbbf24;font-weight:600",
  error:    "color:#f87171;font-weight:600",
  critical: "color:#fca5a5;background:#450a0a;font-weight:700",
};

// ─── Tracker configuration ────────────────────────────────────────────────────

export interface ApiTrackerConfig {
  /**
   * Logger that receives every structured event.
   * Defaults to `consoleLogger`.
   */
  logger?: ApiTrackerLogger;

  // ── Response time ──────────────────────────────────────────────────────────
  /** Duration that triggers a `slow_response` event (ms). Default: 1 000 */
  slowThresholdMs?: number;
  /** Duration that triggers a `critical_response` event (ms). Default: 3 000 */
  criticalThresholdMs?: number;

  // ── Payload size ───────────────────────────────────────────────────────────
  /** Payload size that triggers a `large_payload` event (bytes). Default: 256 KB */
  largePayloadBytes?: number;
  /** Payload size that triggers a `critical_payload` event (bytes). Default: 1 MB */
  criticalPayloadBytes?: number;

  // ── Over-fetching ──────────────────────────────────────────────────────────
  /**
   * Number of calls to the same endpoint within `overFetchWindowMs`
   * before an `over_fetching` event is emitted. Default: 3
   */
  overFetchThreshold?: number;
  /** Sliding window for over-fetch counting (ms). Default: 5 000 */
  overFetchWindowMs?: number;

  // ── Cache analysis ─────────────────────────────────────────────────────────
  /**
   * Emit `missing_cache` when a GET endpoint with no caching headers
   * is called more than this many times. Default: 2
   */
  missingCacheCallThreshold?: number;

  // ── Filtering ──────────────────────────────────────────────────────────────
  /**
   * URL patterns to ignore entirely. Supports strings (substring match)
   * and RegExp objects.
   */
  ignoreUrls?: Array<string | RegExp>;

  /**
   * By default the tracker emits an `api_call` event for every request.
   * Set to `false` to suppress baseline events and only emit anomalies.
   * Default: true
   */
  emitBaselineEvents?: boolean;

  /** Enable verbose console logs from the tracker itself. Default: false */
  debug?: boolean;
}

// ─── Internal bookkeeping types ───────────────────────────────────────────────

interface CallRecord {
  /** performance.now() timestamp */
  ts: number;
  /** rounded duration for burst detection */
  duration: number;
}

interface EndpointHistory {
  calls: CallRecord[];
  /** When was cacheability last flagged to avoid flooding */
  lastCacheFlaggedAt: number;
  /** Extracted max-age from the most recent response (seconds) */
  maxAgeSeconds: number | null;
  /** performance.now() of the most recent response */
  lastResponseAt: number | null;
  /** Whether the last response had actionable caching headers */
  hasCacheHeaders: boolean;
}

// ─── ApiTracker class ─────────────────────────────────────────────────────────

export class ApiTracker {
  private readonly cfg: Required<ApiTrackerConfig>;
  private originalFetch: typeof fetch | null = null;
  private readonly history = new Map<string, EndpointHistory>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private attached = false;

  constructor(config: ApiTrackerConfig = {}) {
    this.cfg = {
      logger:                   config.logger                   ?? consoleLogger,
      slowThresholdMs:          config.slowThresholdMs          ?? 1_000,
      criticalThresholdMs:      config.criticalThresholdMs      ?? 3_000,
      largePayloadBytes:        config.largePayloadBytes        ?? 256 * 1_024,
      criticalPayloadBytes:     config.criticalPayloadBytes     ?? 1_024 * 1_024,
      overFetchThreshold:       config.overFetchThreshold       ?? 3,
      overFetchWindowMs:        config.overFetchWindowMs        ?? 5_000,
      missingCacheCallThreshold: config.missingCacheCallThreshold ?? 2,
      ignoreUrls:               config.ignoreUrls               ?? [],
      emitBaselineEvents:       config.emitBaselineEvents       ?? true,
      debug:                    config.debug                    ?? false,
    };
  }

  /**
   * Wraps `window.fetch` and begins tracking.
   * Safe to call multiple times – subsequent calls are no-ops.
   */
  attach(): this {
    if (this.attached || typeof window === "undefined" || !window.fetch) return this;

    this.originalFetch = window.fetch.bind(window);
    const original = this.originalFetch;
    const tracker = this;

    window.fetch = async function apiTrackerFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      return tracker.interceptedFetch(original, input, init);
    };

    // Prune stale history entries every 30 s
    this.cleanupTimer = setInterval(() => this.pruneHistory(), 30_000);
    this.attached = true;
    this.debug("ApiTracker attached");
    return this;
  }

  /** Restore the original fetch and stop all timers. */
  detach(): void {
    if (!this.attached || typeof window === "undefined") return;
    if (this.originalFetch) window.fetch = this.originalFetch;
    this.originalFetch = null;
    if (this.cleanupTimer !== null) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    this.attached = false;
    this.debug("ApiTracker detached");
  }

  /** Read-only snapshot of the current call history (useful in tests / devtools). */
  getHistory(): ReadonlyMap<string, Readonly<EndpointHistory>> {
    return this.history;
  }

  /** Reset all accumulated call history. */
  clearHistory(): void {
    this.history.clear();
  }

  // ─── Core interception ────────────────────────────────────────────────────

  private async interceptedFetch(
    original: typeof fetch,
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const rawUrl = resolveRawUrl(input);
    const url    = normalizeUrl(rawUrl);
    const timestamp = now();
    const pageUrl   = currentUrl();
    const startMs   = performance.now();

    if (this.isIgnored(rawUrl)) return original(input, init);

    // ── Request body size ──────────────────────────────────────────────────
    const requestBodySize = measureRequestSize(init?.body ?? (input instanceof Request ? input.body : null));

    // ── Execute the real fetch ─────────────────────────────────────────────
    let response: Response;
    let status: number | null = null;
    let responseBodySize = 0;
    let cacheHeaders: CacheHeaders = emptyCacheHeaders();
    let maxAgeSeconds: number | null = null;

    try {
      response = await original(input, init);
    } catch (err) {
      const duration = performance.now() - startMs;
      const history  = this.recordCall(url, duration);

      this.emit({
        id: generateId(),
        kind: "fetch_error",
        severity: "error",
        timestamp,
        pageUrl,
        method,
        url,
        rawUrl,
        status: null,
        duration,
        requestBodySize,
        responseBodySize: 0,
        cacheHeaders: emptyCacheHeaders(),
        maxAgeSeconds: null,
        callCount: history.calls.length,
        message: `Network error: ${method} ${url} — ${String(err)}`,
        data: { error: String(err) },
      });
      throw err;
    }

    const duration = performance.now() - startMs;
    status = response.status;
    cacheHeaders = extractCacheHeaders(response.headers);
    maxAgeSeconds = parseMaxAge(cacheHeaders.cacheControl);
    responseBodySize = await peekResponseSize(response);

    // ── Update endpoint history ────────────────────────────────────────────
    const history = this.recordCall(url, duration, {
      maxAgeSeconds,
      hasCacheHeaders: hasMeaningfulCacheHeaders(cacheHeaders),
      lastResponseAt: startMs,
    });
    const callCount = history.calls.length;

    // ── Emit all applicable events ─────────────────────────────────────────
    const base = {
      timestamp,
      pageUrl,
      method,
      url,
      rawUrl,
      status,
      duration,
      requestBodySize,
      responseBodySize,
      cacheHeaders,
      maxAgeSeconds,
      callCount,
    } as const;

    // 1. HTTP-level errors
    if (status >= 500) {
      this.emit({ ...base, id: generateId(), kind: "server_error", severity: "error",
        message: `Server error: ${method} ${url} → ${status}`,
        data: { status, duration_ms: duration } });
    } else if (status >= 400) {
      this.emit({ ...base, id: generateId(), kind: "client_error", severity: "warning",
        message: `Client error: ${method} ${url} → ${status}`,
        data: { status, duration_ms: duration } });
    }

    // 2. Response time
    if (duration > this.cfg.criticalThresholdMs) {
      this.emit({ ...base, id: generateId(), kind: "critical_response", severity: "critical",
        message: `Critical latency: ${method} ${url} took ${duration.toFixed(0)} ms (threshold: ${this.cfg.criticalThresholdMs} ms)`,
        data: { duration_ms: duration, threshold_ms: this.cfg.criticalThresholdMs } });
    } else if (duration > this.cfg.slowThresholdMs) {
      this.emit({ ...base, id: generateId(), kind: "slow_response", severity: "warning",
        message: `Slow response: ${method} ${url} took ${duration.toFixed(0)} ms (threshold: ${this.cfg.slowThresholdMs} ms)`,
        data: { duration_ms: duration, threshold_ms: this.cfg.slowThresholdMs } });
    }

    // 3. Payload size
    if (responseBodySize > this.cfg.criticalPayloadBytes) {
      this.emit({ ...base, id: generateId(), kind: "critical_payload", severity: "critical",
        message: `Critical payload: ${method} ${url} returned ${formatBytes(responseBodySize)} (limit: ${formatBytes(this.cfg.criticalPayloadBytes)})`,
        data: { bytes: responseBodySize, limit_bytes: this.cfg.criticalPayloadBytes } });
    } else if (responseBodySize > this.cfg.largePayloadBytes) {
      this.emit({ ...base, id: generateId(), kind: "large_payload", severity: "warning",
        message: `Large payload: ${method} ${url} returned ${formatBytes(responseBodySize)} (limit: ${formatBytes(this.cfg.largePayloadBytes)})`,
        data: { bytes: responseBodySize, limit_bytes: this.cfg.largePayloadBytes } });
    }

    // 4. Over-fetching (sliding-window count check)
    const windowCalls = this.countCallsInWindow(url);
    if (windowCalls >= this.cfg.overFetchThreshold) {
      this.emit({ ...base, id: generateId(), kind: "over_fetching", severity: "warning",
        message: `Over-fetching: ${method} ${url} called ${windowCalls}× in the last ${this.cfg.overFetchWindowMs} ms`,
        data: {
          callsInWindow: windowCalls,
          windowMs: this.cfg.overFetchWindowMs,
          threshold: this.cfg.overFetchThreshold,
        } });
    }

    // 5. Cache analysis (only for GET requests)
    if (method === "GET" && status >= 200 && status < 300) {
      this.analyzeCaching(base, history);
    }

    // 6. Baseline event (emitted last, only when no anomaly was emitted above
    //    OR when emitBaselineEvents = true)
    if (this.cfg.emitBaselineEvents && status < 400 && duration <= this.cfg.slowThresholdMs) {
      this.emit({ ...base, id: generateId(), kind: "api_call", severity: "info",
        message: `${method} ${url} → ${status} (${duration.toFixed(0)} ms, ${formatBytes(responseBodySize)})`,
        data: {} });
    }

    return response;
  }

  // ─── Cache analysis ────────────────────────────────────────────────────────

  private analyzeCaching(
    base: Omit<ApiTrackerEvent, "id" | "kind" | "severity" | "message" | "data">,
    history: EndpointHistory
  ): void {
    const { url, method } = base;
    const { cacheHeaders, maxAgeSeconds } = base;
    const nowMs = performance.now();

    // ── Cache bypass: re-call within the known max-age TTL ─────────────────
    if (
      maxAgeSeconds !== null &&
      maxAgeSeconds > 0 &&
      history.lastResponseAt !== null
    ) {
      const ageMs = nowMs - history.lastResponseAt;
      const ttlMs = maxAgeSeconds * 1_000;
      if (ageMs < ttlMs) {
        this.emit({ ...base, id: generateId(), kind: "cache_bypass", severity: "warning",
          message: `Cache bypass: ${method} ${url} re-fetched ${(ageMs / 1_000).toFixed(1)} s after a ${maxAgeSeconds} s TTL response`,
          data: {
            ageMs,
            ttlMs,
            maxAgeSeconds,
            cacheControl: cacheHeaders.cacheControl,
          } });
        return;
      }
    }

    // ── Missing cache: GET repeated with no actionable caching headers ──────
    if (
      !history.hasCacheHeaders &&
      history.calls.length >= this.cfg.missingCacheCallThreshold
    ) {
      // Throttle: don't flood if the same URL keeps repeating
      const suppressWindowMs = 30_000;
      if (nowMs - history.lastCacheFlaggedAt > suppressWindowMs) {
        history.lastCacheFlaggedAt = nowMs;
        this.emit({ ...base, id: generateId(), kind: "missing_cache", severity: "warning",
          message: `Missing cache headers: GET ${url} has been called ${history.calls.length}× but the server sends no caching directives`,
          data: {
            callCount: history.calls.length,
            cacheControl: cacheHeaders.cacheControl,
            etag: cacheHeaders.etag,
            lastModified: cacheHeaders.lastModified,
            expires: cacheHeaders.expires,
            recommendation: "Add Cache-Control, ETag or Expires headers to enable client-side caching",
          } });
      }
    }
  }

  // ─── History management ────────────────────────────────────────────────────

  private recordCall(
    url: string,
    duration: number,
    updates?: Partial<Pick<EndpointHistory, "maxAgeSeconds" | "hasCacheHeaders" | "lastResponseAt">>
  ): EndpointHistory {
    let entry = this.history.get(url);
    if (!entry) {
      entry = {
        calls: [],
        lastCacheFlaggedAt: 0,
        maxAgeSeconds: null,
        lastResponseAt: null,
        hasCacheHeaders: false,
      };
      this.history.set(url, entry);
    }

    entry.calls.push({ ts: performance.now(), duration });
    if (updates) Object.assign(entry, updates);

    return entry;
  }

  /** Returns the number of calls to `url` within the over-fetch window. */
  private countCallsInWindow(url: string): number {
    const entry = this.history.get(url);
    if (!entry) return 0;
    const cutoff = performance.now() - this.cfg.overFetchWindowMs;
    return entry.calls.filter((c) => c.ts >= cutoff).length;
  }

  /** Remove call records older than 2× the over-fetch window. */
  private pruneHistory(): void {
    const cutoff = performance.now() - this.cfg.overFetchWindowMs * 2;
    for (const [key, entry] of this.history) {
      entry.calls = entry.calls.filter((c) => c.ts >= cutoff);
      if (entry.calls.length === 0) this.history.delete(key);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private emit(event: ApiTrackerEvent): void {
    this.cfg.logger.log(event);
  }

  private isIgnored(url: string): boolean {
    return this.cfg.ignoreUrls.some((pattern) =>
      typeof pattern === "string" ? url.includes(pattern) : pattern.test(url)
    );
  }

  private debug(...args: unknown[]): void {
    if (this.cfg.debug) console.debug("[ApiTracker]", ...args);
  }
}

// ─── Pure helper functions ────────────────────────────────────────────────────

/** Strip query string and fragment — used as the grouping key. */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw, typeof location !== "undefined" ? location.href : undefined);
    return `${u.origin}${u.pathname}`;
  } catch {
    return raw.split("?")[0] ?? raw;
  }
}

function resolveRawUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

function measureRequestSize(body: BodyInit | null | undefined | ReadableStream): number {
  if (!body) return 0;
  if (typeof body === "string") return byteLength(body);
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (body instanceof FormData) return 0; // non-trivial to measure without reading
  return 0;
}

function extractCacheHeaders(headers: Headers): CacheHeaders {
  return {
    cacheControl: headers.get("cache-control"),
    etag:         headers.get("etag"),
    lastModified: headers.get("last-modified"),
    expires:      headers.get("expires"),
    age:          headers.get("age"),
    vary:         headers.get("vary"),
  };
}

function emptyCacheHeaders(): CacheHeaders {
  return { cacheControl: null, etag: null, lastModified: null, expires: null, age: null, vary: null };
}

/**
 * Determines whether a response has caching directives that the browser
 * can actually act on (i.e. it's not explicitly prevented from caching).
 */
function hasMeaningfulCacheHeaders(h: CacheHeaders): boolean {
  if (h.etag || h.lastModified || h.expires) return true;
  if (!h.cacheControl) return false;
  const cc = h.cacheControl.toLowerCase();
  // These directives actively prevent caching – not "meaningful" for our purposes
  if (cc.includes("no-store")) return false;
  // max-age=0 with must-revalidate is effectively no-cache
  if (cc.includes("max-age=0") && cc.includes("must-revalidate")) return false;
  // Any positive max-age, s-maxage, public, or private counts
  return cc.includes("max-age") || cc.includes("s-maxage") || cc.includes("public") || cc.includes("private");
}

/**
 * Parse the `max-age` directive from a Cache-Control header.
 * Returns the value in seconds, or null if not present / zero.
 */
function parseMaxAge(cacheControl: string | null): number | null {
  if (!cacheControl) return null;
  const match = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(cacheControl);
  if (!match) return null;
  const seconds = parseInt(match[1] ?? "0", 10);
  return seconds > 0 ? seconds : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024)        return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(2)} MB`;
}

// ─── Module-level singleton helpers ───────────────────────────────────────────

let _tracker: ApiTracker | null = null;

/**
 * Create and attach a global `ApiTracker` instance.
 * Subsequent calls return the existing instance (pass `force: true` to replace).
 *
 * @example
 * ```ts
 * import { attachApiTracker } from "@frontend-guardian/sdk";
 *
 * attachApiTracker({
 *   slowThresholdMs:    800,
 *   overFetchThreshold: 3,
 *   overFetchWindowMs:  5_000,
 *   logger: {
 *     log: (event) => mySDK.captureApiEvent(event),
 *   },
 * });
 * ```
 */
export function attachApiTracker(
  config: ApiTrackerConfig = {},
  opts: { force?: boolean } = {}
): ApiTracker {
  if (_tracker && !opts.force) return _tracker;
  _tracker?.detach();
  _tracker = new ApiTracker(config).attach();
  return _tracker;
}

/** Returns the current singleton, or null if never initialised. */
export function getApiTracker(): ApiTracker | null {
  return _tracker;
}

/** Detach and destroy the singleton. */
export function detachApiTracker(): void {
  _tracker?.detach();
  _tracker = null;
}
