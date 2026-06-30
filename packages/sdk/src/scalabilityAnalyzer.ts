import { generateId, now, currentUrl, byteLength } from "./utils.js";

// ─── Issue taxonomy ───────────────────────────────────────────────────────────

/**
 * Every issue type the ScalabilityAnalyzer can detect.
 *
 *  Rendering
 *    large_list_no_pagination      – >N DOM items rendered without pagination controls
 *    large_list_no_virtualization  – >N DOM items without virtual-scroll indicators
 *
 *  Data fetching
 *    missing_server_pagination     – API response is a flat array with no pagination envelope
 *    repeated_full_dataset_fetch   – same endpoint re-fetched multiple times, full payload each time
 *    no_delta_fetch                – no cursor/since/after params on repeated requests
 *
 *  Caching
 *    no_client_cache_library       – no React Query / SWR / Apollo signals detected
 *    no_http_cache                 – GET endpoint lacks caching headers, called repeatedly
 *    stale_while_revalidate_absent – server supports ETag/Last-Modified but client refetches fully
 *
 *  Real-time transport
 *    polling_detected              – endpoint called at a suspiciously regular interval
 *    high_frequency_polling        – polling interval < 5 s (WebSocket/SSE strongly advised)
 */
export type ScalabilityIssueType =
  | "large_list_no_pagination"
  | "large_list_no_virtualization"
  | "missing_server_pagination"
  | "repeated_full_dataset_fetch"
  | "no_delta_fetch"
  | "no_client_cache_library"
  | "no_http_cache"
  | "stale_while_revalidate_absent"
  | "polling_detected"
  | "high_frequency_polling";

export type ScalabilitySeverity = "info" | "warning" | "error" | "critical";

// ─── Evidence ─────────────────────────────────────────────────────────────────

export interface ScalabilityEvidence {
  /** API endpoint involved (normalised, no query string) */
  url: string | null;
  /** HTTP method */
  method: string | null;
  /** CSS selector that identified the problem element */
  domSelector: string | null;
  /** Number of rendered DOM items counted */
  renderedItemCount: number | null;
  /** Number of items in the API response array */
  responseItemCount: number | null;
  /** Response payload size in bytes */
  payloadBytes: number | null;
  /** How many times the endpoint was called */
  callCount: number | null;
  /** Estimated polling interval in ms; null when not a polling finding */
  pollingIntervalMs: number | null;
  /** Whether a pagination pattern was detected in the URL or response */
  paginationDetected: boolean;
  /** Whether a known cache library fingerprint was found in the page */
  cacheLibraryDetected: boolean;
  /** Cache-Control header value on the last response */
  cacheControl: string | null;
}

// ─── The finding ──────────────────────────────────────────────────────────────

export interface ScalabilityFinding {
  id: string;
  issueType: ScalabilityIssueType;
  severity: ScalabilitySeverity;

  /** Short human-readable title (≤ 80 chars) */
  title: string;
  /** Full description with measured values */
  description: string;
  /**
   * Concrete, step-by-step fix recommendation.
   * Suitable for display in a dashboard or notification.
   */
  recommendedFix: string;
  /**
   * A ready-to-paste Cursor AI prompt that instructs the AI to fix this issue
   * in the user's codebase. Contextualised with the actual URL, count, etc.
   */
  cursorPrompt: string;

  evidence: ScalabilityEvidence;

  timestamp: string;
  pageUrl: string;

  /** Extra key/value pairs for filtering / dashboard grouping */
  data: Record<string, unknown>;
}

// ─── Logger interface ─────────────────────────────────────────────────────────

export interface ScalabilityLogger {
  onFinding(finding: ScalabilityFinding): void;
}

const SEVERITY_STYLE: Record<ScalabilitySeverity, string> = {
  info:     "color:#60a5fa;font-weight:600",
  warning:  "color:#fbbf24;font-weight:600",
  error:    "color:#f87171;font-weight:600",
  critical: "color:#fca5a5;background:#450a0a;font-weight:700",
};

export const consoleScalabilityLogger: ScalabilityLogger = {
  onFinding(finding: ScalabilityFinding): void {
    console.groupCollapsed(
      `%c[ScalabilityAnalyzer] ${finding.issueType} — ${finding.title}`,
      SEVERITY_STYLE[finding.severity]
    );
    console.log("severity      :", finding.severity);
    console.log("description   :", finding.description);
    console.log("recommended   :", finding.recommendedFix);
    console.log("cursor prompt :\n", finding.cursorPrompt);
    console.log("evidence      :", finding.evidence);
    console.groupEnd();
  },
};

// ─── Analyzer configuration ───────────────────────────────────────────────────

export interface ScalabilityAnalyzerConfig {
  logger?: ScalabilityLogger;

  // ── DOM list detection ─────────────────────────────────────────────────────
  /** Observe the DOM for large lists. Default: true */
  observeDom?: boolean;
  /** List-item count that triggers large_list_no_pagination. Default: 100 */
  largeListThreshold?: number;
  /** How often to scan the DOM for large lists (ms). Default: 5 000 */
  domScanIntervalMs?: number;

  // ── Fetch interception ─────────────────────────────────────────────────────
  /** Intercept window.fetch to analyse payloads. Default: true */
  interceptFetch?: boolean;
  /** Item count in a response array that flags missing_server_pagination. Default: 100 */
  responsePaginationThreshold?: number;
  /** How many times a full-payload endpoint must repeat before flagging. Default: 3 */
  repeatedFetchThreshold?: number;
  /** Payload size (bytes) above which a response is considered "large". Default: 100 KB */
  largePayloadBytes?: number;

  // ── Polling detection ──────────────────────────────────────────────────────
  /**
   * Minimum number of evenly-spaced calls needed to confirm polling.
   * Default: 4
   */
  pollingMinSamples?: number;
  /**
   * Maximum coefficient-of-variation (stddev/mean) allowed while still
   * classifying the call pattern as polling. Default: 0.2 (20 %)
   */
  pollingCvThreshold?: number;
  /** Interval below which polling is flagged as high_frequency (ms). Default: 5 000 */
  highFrequencyPollingMs?: number;

  // ── Caching ────────────────────────────────────────────────────────────────
  /**
   * Number of times a GET endpoint must be called with no caching headers
   * before flagging no_http_cache. Default: 3
   */
  noCacheCallThreshold?: number;
  /** Check for React Query / SWR / Apollo on the window object. Default: true */
  detectCacheLibrary?: boolean;

  // ── Suppress noise ────────────────────────────────────────────────────────
  ignoreUrls?: Array<string | RegExp>;
  /**
   * Do not re-emit the same issueType for the same URL within this window (ms).
   * Default: 120 000 (2 minutes)
   */
  suppressWindowMs?: number;

  debug?: boolean;
}

// ─── Internal bookkeeping ─────────────────────────────────────────────────────

interface FetchRecord {
  /** performance.now() timestamp */
  ts: number;
  responseItemCount: number | null;
  payloadBytes: number;
  hasPaginationParams: boolean;
  hasPaginationEnvelope: boolean;
  cacheControl: string | null;
  etag: string | null;
  status: number;
}

interface EndpointHistory {
  method: string;
  records: FetchRecord[];
}

/** Key: `${issueType}::${url}`, value: timestamp of last emission */
type SuppressionMap = Map<string, number>;

// ─── ScalabilityAnalyzer class ────────────────────────────────────────────────

export class ScalabilityAnalyzer {
  private readonly cfg: Required<ScalabilityAnalyzerConfig>;
  private readonly history  = new Map<string, EndpointHistory>();
  private readonly suppress: SuppressionMap = new Map();
  private readonly findings: ScalabilityFinding[] = [];

  private originalFetch: typeof fetch | null = null;
  private domTimer: ReturnType<typeof setInterval> | null = null;
  private mutationObserver: MutationObserver | null = null;
  private attached = false;

  constructor(config: ScalabilityAnalyzerConfig = {}) {
    this.cfg = {
      logger:                     config.logger                     ?? consoleScalabilityLogger,
      observeDom:                 config.observeDom                 ?? true,
      largeListThreshold:         config.largeListThreshold         ?? 100,
      domScanIntervalMs:          config.domScanIntervalMs          ?? 5_000,
      interceptFetch:             config.interceptFetch             ?? true,
      responsePaginationThreshold: config.responsePaginationThreshold ?? 100,
      repeatedFetchThreshold:     config.repeatedFetchThreshold     ?? 3,
      largePayloadBytes:          config.largePayloadBytes          ?? 100 * 1_024,
      pollingMinSamples:          config.pollingMinSamples          ?? 4,
      pollingCvThreshold:         config.pollingCvThreshold         ?? 0.2,
      highFrequencyPollingMs:     config.highFrequencyPollingMs     ?? 5_000,
      noCacheCallThreshold:       config.noCacheCallThreshold       ?? 3,
      detectCacheLibrary:         config.detectCacheLibrary         ?? true,
      ignoreUrls:                 config.ignoreUrls                 ?? [],
      suppressWindowMs:           config.suppressWindowMs           ?? 120_000,
      debug:                      config.debug                      ?? false,
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  attach(): this {
    if (this.attached) return this;

    if (this.cfg.interceptFetch) this.attachFetchInterceptor();
    if (this.cfg.observeDom)     this.startDomObserver();
    if (this.cfg.detectCacheLibrary) this.checkCacheLibraryOnce();

    this.attached = true;
    this.log("ScalabilityAnalyzer attached");
    return this;
  }

  detach(): void {
    if (!this.attached) return;
    this.detachFetchInterceptor();
    this.stopDomObserver();
    this.attached = false;
  }

  // ─── Public manual-report API ──────────────────────────────────────────────

  /**
   * Report a component render with a known item count.
   * Call this from React/Vue components when you know how many items were rendered.
   *
   * @example – React
   * ```tsx
   * function UserList({ users }: { users: User[] }) {
   *   useEffect(() => {
   *     analyzer.reportListRender("UserList", users.length, false, false);
   *   }, [users.length]);
   *   return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
   * }
   * ```
   */
  reportListRender(
    componentName: string,
    itemCount: number,
    hasPagination: boolean,
    hasVirtualization: boolean
  ): void {
    this.analyzeListRender(componentName, itemCount, hasPagination, hasVirtualization, null);
  }

  /**
   * Report a completed data fetch with known response details.
   * Use this when the fetch interception cannot parse the payload
   * (e.g. gRPC, custom serialisation).
   */
  reportDataFetch(
    url: string,
    method: string,
    responseItemCount: number | null,
    payloadBytes: number,
    hasPaginationParams: boolean,
    hasPaginationEnvelope: boolean,
    cacheControl: string | null = null
  ): void {
    if (this.isIgnored(url)) return;
    const key = endpointKey(url, method);
    this.recordFetch(key, method, {
      ts: performance.now(),
      responseItemCount,
      payloadBytes,
      hasPaginationParams,
      hasPaginationEnvelope,
      cacheControl,
      etag: null,
      status: 200,
    });
    this.runFetchAnalysis(key, url, method);
  }

  /** Read all accumulated findings (sorted newest-first). */
  getFindings(): readonly ScalabilityFinding[] {
    return [...this.findings].reverse();
  }

  /** Read findings filtered by issue type. */
  getFindingsByType(type: ScalabilityIssueType): ScalabilityFinding[] {
    return this.findings.filter((f) => f.issueType === type);
  }

  clearFindings(): void { this.findings.length = 0; }

  // ─── Fetch interception ────────────────────────────────────────────────────

  private attachFetchInterceptor(): void {
    if (typeof window === "undefined" || !window.fetch) return;

    this.originalFetch = window.fetch.bind(window);
    const original  = this.originalFetch;
    const analyzer  = this;

    window.fetch = async function scalabilityFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const rawUrl = resolveUrl(input);

      if (analyzer.isIgnored(rawUrl)) return original(input, init);

      let response: Response;
      try {
        response = await original(input, init);
      } catch (err) {
        throw err;
      }

      // Non-destructively read body for analysis
      void analyzer.analyzeResponse(rawUrl, method, response.clone(), response.headers);
      return response;
    };
  }

  private detachFetchInterceptor(): void {
    if (this.originalFetch && typeof window !== "undefined") {
      window.fetch = this.originalFetch;
      this.originalFetch = null;
    }
  }

  private async analyzeResponse(
    rawUrl: string,
    method: string,
    res: Response,
    headers: Headers
  ): Promise<void> {
    if (method !== "GET" && method !== "POST") return; // only query-style requests
    if (res.status < 200 || res.status >= 300) return;

    const cacheControl = headers.get("cache-control");
    const etag         = headers.get("etag");
    const contentType  = headers.get("content-type") ?? "";

    let payloadBytes = 0;
    let responseItemCount: number | null = null;
    let hasPaginationEnvelope = false;
    let hasPaginationParams   = false;

    // Determine pagination params in URL
    try {
      const u = new URL(rawUrl, typeof location !== "undefined" ? location.href : undefined);
      hasPaginationParams = PAGINATION_PARAMS.some((p) => u.searchParams.has(p));
    } catch { /* relative URL */ }

    // Parse JSON body
    if (contentType.includes("application/json")) {
      try {
        const text = await res.text();
        payloadBytes = byteLength(text);

        const parsed: unknown = JSON.parse(text);

        if (Array.isArray(parsed)) {
          responseItemCount   = parsed.length;
          hasPaginationEnvelope = false;
        } else if (parsed !== null && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          hasPaginationEnvelope = PAGINATION_ENVELOPE_KEYS.some((k) => k in obj);
          // Drill into common envelope shapes: { data: [...], items: [...], results: [...] }
          const dataKey = ARRAY_ENVELOPE_KEYS.find((k) => Array.isArray(obj[k]));
          if (dataKey) {
            responseItemCount = (obj[dataKey] as unknown[]).length;
          }
        }
      } catch { /* binary / non-JSON */ }
    } else {
      // Non-JSON: just measure size
      try {
        const text = await res.text();
        payloadBytes = byteLength(text);
      } catch { /* ignore */ }
    }

    const key = endpointKey(rawUrl, method);
    this.recordFetch(key, method, {
      ts: performance.now(),
      responseItemCount,
      payloadBytes,
      hasPaginationParams,
      hasPaginationEnvelope,
      cacheControl,
      etag,
      status: res.status,
    });

    this.runFetchAnalysis(key, rawUrl, method);
  }

  // ─── Fetch pattern analysis ────────────────────────────────────────────────

  private recordFetch(key: string, method: string, record: FetchRecord): void {
    let entry = this.history.get(key);
    if (!entry) {
      entry = { method: method.toUpperCase(), records: [] };
      this.history.set(key, entry);
    }
    entry.records.push(record);
    // Keep only the last 30 records per endpoint
    if (entry.records.length > 30) entry.records.shift();
  }

  private runFetchAnalysis(key: string, rawUrl: string, method: string): void {
    const entry = this.history.get(key);
    if (!entry) return;
    const { records } = entry;
    const latest = records[records.length - 1];
    if (!latest) return;
    const normUrl = normalizeUrl(rawUrl);

    // 1. Missing server-side pagination
    if (
      method === "GET" &&
      latest.responseItemCount !== null &&
      latest.responseItemCount >= this.cfg.responsePaginationThreshold &&
      !latest.hasPaginationEnvelope &&
      !latest.hasPaginationParams
    ) {
      this.emit(buildFinding({
        issueType: "missing_server_pagination",
        severity: latest.responseItemCount > 500 ? "critical" : "error",
        title: `API returns ${latest.responseItemCount} items without pagination`,
        description:
          `GET ${normUrl} responded with a flat array of ${latest.responseItemCount} items ` +
          `(${formatBytes(latest.payloadBytes)}) and no pagination envelope (page, cursor, total, hasMore). ` +
          `Sending unbounded datasets degrades performance and blocks the render thread.`,
        recommendedFix:
          `1. On the server: wrap the response in a pagination envelope: ` +
          `{ data: [...], total: N, page: 1, pageSize: 20, hasMore: true }.\n` +
          `2. On the client: add "?page=1&pageSize=20" query params and read response.data.\n` +
          `3. Add pagination controls (page numbers or infinite scroll) to the UI.`,
        cursorPrompt: buildPrompt("missing_server_pagination", {
          url: normUrl, itemCount: latest.responseItemCount, payloadBytes: latest.payloadBytes,
        }),
        evidence: buildEvidence({
          url: normUrl, method, responseItemCount: latest.responseItemCount,
          payloadBytes: latest.payloadBytes, cacheControl: latest.cacheControl,
          paginationDetected: false,
        }),
        data: { responseItemCount: latest.responseItemCount, payloadBytes: latest.payloadBytes },
      }));
    }

    // 2. Repeated full-dataset fetching (no pagination params, stable large payload)
    const fullFetchRecords = records.filter(
      (r) => !r.hasPaginationParams && !r.hasPaginationEnvelope && r.payloadBytes >= this.cfg.largePayloadBytes
    );
    if (fullFetchRecords.length >= this.cfg.repeatedFetchThreshold) {
      const avgSize = fullFetchRecords.reduce((s, r) => s + r.payloadBytes, 0) / fullFetchRecords.length;
      this.emit(buildFinding({
        issueType: "repeated_full_dataset_fetch",
        severity: "error",
        title: `Full dataset fetched ${fullFetchRecords.length}× without caching`,
        description:
          `GET ${normUrl} has been called ${fullFetchRecords.length} times, each time returning ` +
          `~${formatBytes(avgSize)} with no pagination or delta params. ` +
          `The client is re-downloading the complete dataset on every request.`,
        recommendedFix:
          `1. Add client-side caching via React Query, SWR, or Apollo.\n` +
          `2. Set Cache-Control: max-age=60 (or higher) on the server response.\n` +
          `3. Use cursor/since-based delta fetching to transfer only new records.\n` +
          `4. Implement optimistic cache updates to avoid refetching after mutations.`,
        cursorPrompt: buildPrompt("repeated_full_dataset_fetch", {
          url: normUrl, callCount: fullFetchRecords.length, payloadBytes: avgSize,
        }),
        evidence: buildEvidence({
          url: normUrl, method, payloadBytes: avgSize,
          callCount: fullFetchRecords.length, cacheControl: latest.cacheControl,
          paginationDetected: false,
        }),
        data: { callCount: fullFetchRecords.length, avgPayloadBytes: avgSize },
      }));
    }

    // 3. No delta fetching (same endpoint called repeatedly, no cursor/since/after param)
    if (
      records.length >= this.cfg.repeatedFetchThreshold &&
      !records.some((r) => r.hasPaginationParams)
    ) {
      this.emit(buildFinding({
        issueType: "no_delta_fetch",
        severity: "warning",
        title: `No cursor/delta params on repeated GET ${normUrl}`,
        description:
          `GET ${normUrl} has been called ${records.length} times with no cursor, since, after, ` +
          `or updatedAfter params. The server cannot know which records the client already has, ` +
          `so it must return the full set every time.`,
        recommendedFix:
          `1. Add a "since" or "cursor" query param: GET ${normUrl}?cursor=<lastId>.\n` +
          `2. The server returns only records newer/after the cursor.\n` +
          `3. The client merges new records into its existing local state.\n` +
          `4. For real-time data, replace polling with WebSocket or SSE.`,
        cursorPrompt: buildPrompt("no_delta_fetch", { url: normUrl, callCount: records.length }),
        evidence: buildEvidence({
          url: normUrl, method, callCount: records.length,
          cacheControl: latest.cacheControl, paginationDetected: false,
        }),
        data: { callCount: records.length },
      }));
    }

    // 4. No HTTP cache (repeated GET, no caching headers)
    const noCacheRecords = records.filter(
      (r) => !hasMeaningfulCache(r.cacheControl, r.etag) && r.status >= 200 && r.status < 300
    );
    if (method === "GET" && noCacheRecords.length >= this.cfg.noCacheCallThreshold) {
      this.emit(buildFinding({
        issueType: "no_http_cache",
        severity: "warning",
        title: `No HTTP caching on GET ${normUrl}`,
        description:
          `GET ${normUrl} has been called ${noCacheRecords.length} times. ` +
          `The server response carries no Cache-Control, ETag, or Expires headers, ` +
          `so every request goes to the network regardless of how recently the data changed.`,
        recommendedFix:
          `1. Add Cache-Control: public, max-age=60, stale-while-revalidate=30 to the server response.\n` +
          `2. Add an ETag or Last-Modified header so the browser can revalidate with 304.\n` +
          `3. On the client, use React Query's staleTime / cacheTime to avoid unnecessary refetches.`,
        cursorPrompt: buildPrompt("no_http_cache", { url: normUrl, callCount: noCacheRecords.length }),
        evidence: buildEvidence({
          url: normUrl, method, callCount: noCacheRecords.length,
          cacheControl: null, paginationDetected: false,
        }),
        data: { callCount: noCacheRecords.length },
      }));
    }

    // 5. stale-while-revalidate absent (ETag present but client isn't using it)
    const revalidatableRecords = records.filter(
      (r) => r.etag && r.cacheControl && !r.cacheControl.includes("stale-while-revalidate")
    );
    if (method === "GET" && revalidatableRecords.length >= this.cfg.noCacheCallThreshold) {
      this.emit(buildFinding({
        issueType: "stale_while_revalidate_absent",
        severity: "info",
        title: `ETag present on ${normUrl} but stale-while-revalidate not set`,
        description:
          `GET ${normUrl} returns an ETag header (the server supports conditional requests) ` +
          `but Cache-Control does not include stale-while-revalidate. ` +
          `Users see stale data while revalidation happens, degrading perceived performance.`,
        recommendedFix:
          `Add stale-while-revalidate=<N> to the Cache-Control header, e.g.:\n` +
          `Cache-Control: public, max-age=60, stale-while-revalidate=120\n` +
          `This lets the browser serve cached content instantly and refresh in the background.`,
        cursorPrompt: buildPrompt("stale_while_revalidate_absent", { url: normUrl }),
        evidence: buildEvidence({
          url: normUrl, method, callCount: revalidatableRecords.length,
          cacheControl: revalidatableRecords[0]?.cacheControl ?? null, paginationDetected: false,
        }),
        data: {},
      }));
    }

    // 6. Polling detection
    this.detectPolling(key, normUrl, method, records);
  }

  // ─── Polling detector ─────────────────────────────────────────────────────

  private detectPolling(
    key: string,
    normUrl: string,
    method: string,
    records: FetchRecord[]
  ): void {
    if (records.length < this.cfg.pollingMinSamples) return;

    const recent = records.slice(-this.cfg.pollingMinSamples);
    const gaps: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      gaps.push((recent[i]?.ts ?? 0) - (recent[i - 1]?.ts ?? 0));
    }

    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const variance = gaps.reduce((s, g) => s + (g - avgGap) ** 2, 0) / gaps.length;
    const stddev = Math.sqrt(variance);
    const cv = avgGap > 0 ? stddev / avgGap : Infinity;

    if (cv > this.cfg.pollingCvThreshold) return; // call pattern is not regular enough

    const isHighFrequency = avgGap < this.cfg.highFrequencyPollingMs;
    const issueType: ScalabilityIssueType = isHighFrequency
      ? "high_frequency_polling"
      : "polling_detected";

    this.emit(buildFinding({
      issueType,
      severity: isHighFrequency ? "error" : "warning",
      title: `${isHighFrequency ? "High-frequency polling" : "Polling"} detected on ${normUrl}`,
      description:
        `GET ${normUrl} is called every ~${Math.round(avgGap / 1_000).toFixed(1)} s ` +
        `(CV=${cv.toFixed(2)}), indicating a setInterval/setTimeout polling pattern. ` +
        (isHighFrequency
          ? `Polling faster than ${this.cfg.highFrequencyPollingMs / 1_000} s creates unnecessary server load and battery drain.`
          : `Consider replacing polling with a push-based transport.`),
      recommendedFix: isHighFrequency
        ? `1. Replace the polling interval with a WebSocket or Server-Sent Events (SSE) connection.\n` +
          `2. If real-time updates are required, use the EventSource API (SSE) for one-way streams\n` +
          `   or the WebSocket API for bidirectional communication.\n` +
          `3. If polling is unavoidable, increase the interval to ≥ 30 s and use ETag revalidation.`
        : `1. Review whether this data truly changes at a ${Math.round(avgGap / 1_000)} s cadence.\n` +
          `2. Replace with SSE (EventSource) or WebSocket for push-based updates.\n` +
          `3. If polling must stay, use conditional GET with If-None-Match to skip unchanged data.`,
      cursorPrompt: buildPrompt(issueType, {
        url: normUrl, pollingIntervalMs: Math.round(avgGap),
      }),
      evidence: buildEvidence({
        url: normUrl, method,
        callCount: records.length, pollingIntervalMs: Math.round(avgGap),
        paginationDetected: false, cacheControl: null,
      }),
      data: { avgGapMs: Math.round(avgGap), cv: Math.round(cv * 100) / 100, isHighFrequency },
    }));
  }

  // ─── DOM list observer ────────────────────────────────────────────────────

  private startDomObserver(): void {
    if (typeof window === "undefined") return;

    // Periodic full scan
    this.domTimer = setInterval(() => this.scanDom(), this.cfg.domScanIntervalMs);

    // Also scan when large DOM mutations happen (lazy rendering, route changes)
    if (typeof MutationObserver !== "undefined") {
      let debounce: ReturnType<typeof setTimeout> | null = null;
      this.mutationObserver = new MutationObserver(() => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => this.scanDom(), 300);
      });
      this.mutationObserver.observe(document.body ?? document.documentElement, {
        childList: true, subtree: true,
      });
    }
  }

  private stopDomObserver(): void {
    if (this.domTimer !== null) { clearInterval(this.domTimer); this.domTimer = null; }
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
  }

  private scanDom(): void {
    for (const { selector, role } of LIST_SELECTORS) {
      const containers = Array.from(document.querySelectorAll<HTMLElement>(selector));
      for (const container of containers) {
        const children = container.children.length;
        if (children < this.cfg.largeListThreshold) continue;

        const hasPagination = domHasPagination(container);
        const hasVirtualization = domHasVirtualization(container);
        const domSelector = buildDomSelector(container);

        this.analyzeListRender(role, children, hasPagination, hasVirtualization, domSelector);
      }
    }
  }

  private analyzeListRender(
    name: string,
    itemCount: number,
    hasPagination: boolean,
    hasVirtualization: boolean,
    domSelector: string | null
  ): void {
    if (itemCount < this.cfg.largeListThreshold) return;

    if (!hasPagination) {
      this.emit(buildFinding({
        issueType: "large_list_no_pagination",
        severity: itemCount > 500 ? "critical" : itemCount > 200 ? "error" : "warning",
        title: `${itemCount} items rendered without pagination (${name})`,
        description:
          `${itemCount} DOM nodes matching "${name}" were found on the page without any ` +
          `detectable pagination controls (page buttons, load-more, or infinite scroll). ` +
          `Rendering all items at once stalls the browser paint and increases Time-to-Interactive.`,
        recommendedFix:
          `1. Implement server-side pagination: fetch only 20–50 items per page.\n` +
          `2. Add page navigation controls (Previous / Next, or page numbers).\n` +
          `3. Alternatively, implement infinite scroll using Intersection­Observer to load ` +
          `   more items when the user approaches the bottom of the list.\n` +
          `4. For very long lists that must stay fully loaded, use virtual scrolling ` +
          `   (react-window, TanStack Virtual) to render only visible rows.`,
        cursorPrompt: buildPrompt("large_list_no_pagination", {
          componentName: name, itemCount, domSelector,
        }),
        evidence: buildEvidence({
          domSelector, renderedItemCount: itemCount, paginationDetected: hasPagination,
          url: null, method: null, cacheControl: null,
        }),
        data: { itemCount, hasPagination, hasVirtualization, selector: domSelector },
      }));
    }

    if (!hasVirtualization && itemCount > 200) {
      this.emit(buildFinding({
        issueType: "large_list_no_virtualization",
        severity: itemCount > 1_000 ? "critical" : "warning",
        title: `${itemCount} items rendered without virtual scrolling`,
        description:
          `${itemCount} items are fully rendered in the DOM, which requires the browser to ` +
          `lay out and paint every node. Beyond ~200 items this measurably degrades scroll ` +
          `performance and increases memory consumption.`,
        recommendedFix:
          `1. Install and configure a virtual-scroll library:\n` +
          `   - TanStack Virtual (framework-agnostic): npm i @tanstack/react-virtual\n` +
          `   - react-window: npm i react-window\n` +
          `2. Replace the list container with the virtualizer and render only visible rows.\n` +
          `3. Ensure each row has a stable key and consistent height for best performance.`,
        cursorPrompt: buildPrompt("large_list_no_virtualization", {
          componentName: name, itemCount, domSelector,
        }),
        evidence: buildEvidence({
          domSelector, renderedItemCount: itemCount, paginationDetected: hasPagination,
          url: null, method: null, cacheControl: null,
        }),
        data: { itemCount, hasVirtualization, selector: domSelector },
      }));
    }
  }

  // ─── Cache library detection ───────────────────────────────────────────────

  private checkCacheLibraryOnce(): void {
    if (typeof window === "undefined") return;

    // Run after a short delay to let frameworks initialise
    setTimeout(() => {
      const detected = CACHE_LIBRARY_SIGNALS.some((signal) => {
        const win = window as unknown as Record<string, unknown>;
        return signal in win || document.querySelector(`[data-rq]`) !== null;
      });

      if (!detected) {
        this.emit(buildFinding({
          issueType: "no_client_cache_library",
          severity: "warning",
          title: "No data-fetching cache library detected",
          description:
            `No global signals for React Query, SWR, Apollo Client, or similar ` +
            `data-fetching libraries were found. Without a cache layer, every component ` +
            `mount triggers a fresh network request, causing redundant fetches and ` +
            `inconsistent UI state across components that display the same data.`,
          recommendedFix:
            `1. Install TanStack Query (React Query v5): npm i @tanstack/react-query\n` +
            `2. Wrap your app in <QueryClientProvider client={new QueryClient()}>\n` +
            `3. Replace useEffect + fetch + useState patterns with:\n` +
            `   const { data } = useQuery({ queryKey: ['users'], queryFn: fetchUsers })\n` +
            `4. Configure staleTime and gcTime to control cache freshness.`,
          cursorPrompt: buildPrompt("no_client_cache_library", {}),
          evidence: buildEvidence({ cacheLibraryDetected: false, url: null, method: null, paginationDetected: false, cacheControl: null }),
          data: { checkedSignals: CACHE_LIBRARY_SIGNALS },
        }));
      } else {
        this.log("Cache library detected — no_client_cache_library check skipped");
      }
    }, 3_000);
  }

  // ─── Emit / suppress ──────────────────────────────────────────────────────

  private emit(finding: ScalabilityFinding): void {
    const key = `${finding.issueType}::${finding.evidence.url ?? finding.evidence.domSelector ?? "global"}`;
    const lastAt = this.suppress.get(key) ?? 0;
    const nowMs  = Date.now();

    if (nowMs - lastAt < this.cfg.suppressWindowMs) {
      this.log("Suppressed (within window):", key);
      return;
    }

    this.suppress.set(key, nowMs);
    this.findings.push(finding);
    this.cfg.logger.onFinding(finding);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private isIgnored(url: string): boolean {
    return this.cfg.ignoreUrls.some((p) =>
      typeof p === "string" ? url.includes(p) : p.test(url)
    );
  }

  private log(...args: unknown[]): void {
    if (this.cfg.debug) console.debug("[ScalabilityAnalyzer]", ...args);
  }
}

// ─── Cursor AI prompt builder ─────────────────────────────────────────────────

function buildPrompt(
  issueType: ScalabilityIssueType,
  ctx: {
    url?: string;
    itemCount?: number;
    callCount?: number;
    payloadBytes?: number;
    pollingIntervalMs?: number;
    componentName?: string;
    domSelector?: string | null;
  }
): string {
  const url         = ctx.url ?? "<endpoint-url>";
  const itemCount   = ctx.itemCount ?? "<N>";
  const callCount   = ctx.callCount ?? "<N>";
  const sizeStr     = ctx.payloadBytes !== undefined ? formatBytes(ctx.payloadBytes) : "<size>";
  const intervalStr = ctx.pollingIntervalMs !== undefined
    ? `${(ctx.pollingIntervalMs / 1_000).toFixed(1)} s`
    : "<interval>";
  const component   = ctx.componentName ?? "the list component";
  const selector    = ctx.domSelector   ?? null;

  switch (issueType) {
    case "large_list_no_pagination":
      return (
        `I have a React component (${component}) that renders ${itemCount} items at once` +
        (selector ? ` (DOM selector: ${selector})` : "") +
        ` without any pagination controls.\n\n` +
        `Please:\n` +
        `1. Add server-side pagination: the component should fetch only 20 items per page using ` +
        `   "?page=1&pageSize=20" query params.\n` +
        `2. Add Previous / Next buttons below the list.\n` +
        `3. Track the current page in a useState hook.\n` +
        `4. Keep the existing component styling and layout.\n` +
        `5. If the data source is ${url}, update that fetch call too.`
      );

    case "large_list_no_virtualization":
      return (
        `I have a React component (${component}) that renders ${itemCount} DOM nodes` +
        (selector ? ` (${selector})` : "") +
        `.\n\nPlease refactor it to use TanStack Virtual for virtual scrolling:\n` +
        `1. Install: npm i @tanstack/react-virtual\n` +
        `2. Replace the list container with useVirtualizer.\n` +
        `3. Render only visible rows via virtualizer.getVirtualItems().\n` +
        `4. Set estimateSize to the approximate row height.\n` +
        `5. Preserve the existing row markup and styling.`
      );

    case "missing_server_pagination":
      return (
        `The API endpoint ${url} returns a flat array of ${itemCount} items with no pagination.\n\n` +
        `Please:\n` +
        `1. On the server: wrap the array response in a pagination envelope:\n` +
        `   { data: [...], total: N, page: 1, pageSize: 20, hasMore: true }\n` +
        `2. Accept "page" and "pageSize" query params and slice the dataset accordingly.\n` +
        `3. On the client: update the fetch call to include "?page=1&pageSize=20".\n` +
        `4. Read response.data instead of the raw array.\n` +
        `5. Add page navigation UI to the component that calls this endpoint.`
      );

    case "repeated_full_dataset_fetch":
      return (
        `The endpoint ${url} is being called ${callCount} times, each time returning ~${sizeStr} ` +
        `with no caching.\n\n` +
        `Please refactor the fetch calls to use React Query (TanStack Query):\n` +
        `1. Install: npm i @tanstack/react-query\n` +
        `2. Wrap the app root in <QueryClientProvider client={queryClient}>.\n` +
        `3. Replace the useEffect + fetch + useState pattern with:\n` +
        `   const { data } = useQuery({ queryKey: ['${url}'], queryFn: () => fetch('${url}').then(r => r.json()), staleTime: 60_000 })\n` +
        `4. Set staleTime: 60_000 so the data is served from cache for 60 s.\n` +
        `5. Remove the manual fetch calls and their loading/error state variables.`
      );

    case "no_delta_fetch":
      return (
        `The endpoint ${url} is called ${callCount} times but always returns the full dataset ` +
        `because no cursor or "since" param is sent.\n\n` +
        `Please implement delta (cursor-based) fetching:\n` +
        `1. On the server: accept a "cursor" or "since" query param (e.g. an ISO timestamp or last ID).\n` +
        `   Return only records newer/after the cursor.\n` +
        `2. On the client:\n` +
        `   a. Store the cursor of the last-seen record in state.\n` +
        `   b. Pass it as: GET ${url}?cursor=<lastCursor>\n` +
        `   c. Merge the returned records into the existing list (don't replace it).\n` +
        `3. For the initial load, omit the cursor param to get the most recent page.`
      );

    case "no_http_cache":
      return (
        `The endpoint ${url} is called ${callCount} times with no Cache-Control or ETag headers, ` +
        `causing every request to hit the network.\n\n` +
        `Please add HTTP caching:\n` +
        `1. On the server response, add:\n` +
        `   Cache-Control: public, max-age=60, stale-while-revalidate=30\n` +
        `2. Also add an ETag header (hash of the response body) to enable 304 revalidation.\n` +
        `3. On the client (if using React Query): set staleTime: 60_000 to match the max-age.\n` +
        `4. If this is a private/user-specific endpoint, use "private" instead of "public":\n` +
        `   Cache-Control: private, max-age=60, stale-while-revalidate=30`
      );

    case "stale_while_revalidate_absent":
      return (
        `The endpoint ${url} returns an ETag header but Cache-Control does not include ` +
        `stale-while-revalidate, so users see stale data while the browser revalidates.\n\n` +
        `Please update the server response header to:\n` +
        `Cache-Control: public, max-age=60, stale-while-revalidate=120\n\n` +
        `This means:\n` +
        `- Serve from cache for up to 60 s without hitting the network.\n` +
        `- For the next 120 s, serve stale content immediately and revalidate in the background.\n` +
        `- After 180 s, treat the cache as expired and revalidate synchronously.`
      );

    case "polling_detected":
    case "high_frequency_polling":
      return (
        `A setInterval / setTimeout polling pattern was detected on ${url} ` +
        `(calls every ~${intervalStr}).\n\n` +
        `Please replace polling with Server-Sent Events (SSE):\n` +
        `1. On the server: create a GET endpoint that returns Content-Type: text/event-stream.\n` +
        `   Push new data using the "data: <json>\\n\\n" format.\n` +
        `2. On the client:\n` +
        `   a. Replace setInterval(() => fetch('${url}'), ...) with:\n` +
        `      const es = new EventSource('${url}/stream')\n` +
        `      es.onmessage = (e) => setData(JSON.parse(e.data))\n` +
        `   b. Clean up with es.close() in the component unmount / cleanup function.\n` +
        `3. If bidirectional communication is needed, use WebSocket instead of SSE.\n` +
        `4. Remove all clearInterval / clearTimeout calls tied to the old polling loop.`
      );

    case "no_client_cache_library":
      return (
        `My React app fetches data with raw fetch() + useEffect + useState patterns and has no ` +
        `data-fetching cache library (React Query, SWR, Apollo, etc.).\n\n` +
        `Please migrate the data fetching to TanStack Query (React Query v5):\n` +
        `1. Install: npm i @tanstack/react-query @tanstack/react-query-devtools\n` +
        `2. Create a queryClient: const queryClient = new QueryClient()\n` +
        `3. Wrap the app root:\n` +
        `   <QueryClientProvider client={queryClient}>\n` +
        `     <App />\n` +
        `     <ReactQueryDevtools />\n` +
        `   </QueryClientProvider>\n` +
        `4. In each data-fetching component, replace:\n` +
        `   const [data, setData] = useState(null)\n` +
        `   useEffect(() => { fetch(url).then(r => r.json()).then(setData) }, [])\n` +
        `   with:\n` +
        `   const { data, isLoading, error } = useQuery({ queryKey: ['key'], queryFn: fetchFn })\n` +
        `5. Set staleTime: 5 * 60 * 1000 for data that changes infrequently.`
      );

    default:
      return `Investigate and fix the scalability issue of type "${issueType}" at ${url}.`;
  }
}

// ─── Finding builder helpers ──────────────────────────────────────────────────

interface FindingInput {
  issueType: ScalabilityIssueType;
  severity: ScalabilitySeverity;
  title: string;
  description: string;
  recommendedFix: string;
  cursorPrompt: string;
  evidence: ScalabilityEvidence;
  data: Record<string, unknown>;
}

function buildFinding(input: FindingInput): ScalabilityFinding {
  return {
    id: generateId(),
    timestamp: now(),
    pageUrl: currentUrl(),
    ...input,
  };
}

function buildEvidence(partial: Partial<ScalabilityEvidence>): ScalabilityEvidence {
  return {
    url: partial.url ?? null,
    method: partial.method ?? null,
    domSelector: partial.domSelector ?? null,
    renderedItemCount: partial.renderedItemCount ?? null,
    responseItemCount: partial.responseItemCount ?? null,
    payloadBytes: partial.payloadBytes ?? null,
    callCount: partial.callCount ?? null,
    pollingIntervalMs: partial.pollingIntervalMs ?? null,
    paginationDetected: partial.paginationDetected ?? false,
    cacheLibraryDetected: partial.cacheLibraryDetected ?? false,
    cacheControl: partial.cacheControl ?? null,
  };
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

const LIST_SELECTORS: Array<{ selector: string; role: string }> = [
  { selector: "ul",                               role: "ul" },
  { selector: "ol",                               role: "ol" },
  { selector: "tbody",                            role: "table" },
  { selector: "[role='list']",                    role: "role=list" },
  { selector: "[role='listbox']",                 role: "role=listbox" },
  { selector: "[role='grid']",                    role: "role=grid" },
  { selector: "[data-testid*='list']",            role: "data-list" },
  { selector: "[data-testid*='row-container']",   role: "row-container" },
];

const PAGINATION_SELECTORS = [
  "[aria-label*='pagination' i]",
  "[role='navigation']",
  "[data-testid*='pagination' i]",
  "button[aria-label*='next' i]",
  "button[aria-label*='previous' i]",
  "button[aria-label*='load more' i]",
  ".pagination",
  "[class*='pagination' i]",
];

const VIRTUAL_SCROLL_SELECTORS = [
  "[data-index]",
  "[style*='transform: translateY']",
  "[style*='position: absolute']",
  "[class*='virtual' i]",
  "[class*='windowed' i]",
];

function domHasPagination(container: Element): boolean {
  const root = container.closest("[data-page]") ?? container.parentElement ?? document;
  return PAGINATION_SELECTORS.some((sel) => root.querySelector(sel) !== null);
}

function domHasVirtualization(container: Element): boolean {
  return VIRTUAL_SCROLL_SELECTORS.some((sel) => container.querySelector(sel) !== null);
}

function buildDomSelector(el: HTMLElement): string {
  const parts: string[] = [];
  if (el.tagName) parts.push(el.tagName.toLowerCase());
  if (el.id) parts.push(`#${el.id}`);
  if (el.className && typeof el.className === "string") {
    parts.push(`.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`);
  }
  return parts.join("") || "element";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGINATION_PARAMS = ["page", "pageSize", "limit", "offset", "cursor", "after", "before", "since", "skip", "from"];
const PAGINATION_ENVELOPE_KEYS = ["total", "hasMore", "nextCursor", "cursor", "meta", "pagination", "pageInfo", "next_page_token"];
const ARRAY_ENVELOPE_KEYS = ["data", "items", "results", "records", "edges", "nodes", "content", "list"];
const CACHE_LIBRARY_SIGNALS = [
  "__reactQueryContext",
  "__SWR_SERIALIZED_VALUES__",
  "__APOLLO_CLIENT__",
  "__tanstackQueryContext",
  "__rtk_query__",
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function endpointKey(url: string, method: string): string {
  try {
    const u = new URL(url, typeof location !== "undefined" ? location.href : undefined);
    return `${method.toUpperCase()} ${u.origin}${u.pathname}`;
  } catch {
    return `${method.toUpperCase()} ${url.split("?")[0] ?? url}`;
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url, typeof location !== "undefined" ? location.href : undefined);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

function hasMeaningfulCache(cc: string | null, etag: string | null): boolean {
  if (etag) return true;
  if (!cc) return false;
  const lower = cc.toLowerCase();
  if (lower.includes("no-store")) return false;
  return lower.includes("max-age") || lower.includes("s-maxage") || lower.includes("public");
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024)          return `${bytes} B`;
  if (bytes < 1_024 * 1_024)  return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(2)} MB`;
}

// ─── Module-level singleton helpers ───────────────────────────────────────────

let _analyzer: ScalabilityAnalyzer | null = null;

/**
 * Create and attach a global `ScalabilityAnalyzer` singleton.
 *
 * @example
 * ```ts
 * import { attachScalabilityAnalyzer } from "@frontend-guardian/sdk";
 *
 * attachScalabilityAnalyzer({
 *   largeListThreshold: 100,
 *   responsePaginationThreshold: 50,
 *   logger: {
 *     onFinding: (f) => console.table({ issue: f.issueType, fix: f.recommendedFix }),
 *   },
 * });
 * ```
 */
export function attachScalabilityAnalyzer(
  config: ScalabilityAnalyzerConfig = {},
  opts: { force?: boolean } = {}
): ScalabilityAnalyzer {
  if (_analyzer && !opts.force) return _analyzer;
  _analyzer?.detach();
  _analyzer = new ScalabilityAnalyzer(config).attach();
  return _analyzer;
}

/** Returns the current singleton, or null if never initialised. */
export function getScalabilityAnalyzer(): ScalabilityAnalyzer | null {
  return _analyzer;
}

/** Detach and destroy the singleton. */
export function detachScalabilityAnalyzer(): void {
  _analyzer?.detach();
  _analyzer = null;
}
