// ─── Legacy Guardian Configuration (server / dashboard compat) ───────────────

export interface GuardianConfig {
  /** Public API key for the Frontend Guardian server */
  apiKey: string;
  /** Server endpoint to report events to */
  endpoint: string;
  /** Application name shown in the dashboard */
  appName: string;
  /** Application version / release tag */
  appVersion?: string;
  /** Sampling rate 0–1. Defaults to 1 (100%) */
  sampleRate?: number;
  /** Max breadcrumbs to retain per session */
  maxBreadcrumbs?: number;
  /** Enable verbose SDK console logging */
  debug?: boolean;
}

// ─── SDK v2 Configuration ─────────────────────────────────────────────────────

export type Environment = "dev" | "prod";

export interface FrontendGuardianConfig {
  /** Master switch – when false the SDK is completely silent */
  enabled: boolean;
  /** Full URL of the ingest endpoint (e.g. "https://api.example.com") */
  apiUrl: string;
  /** Runtime environment label attached to every event */
  environment: Environment;
  /** Capture render timing, API latency and Web Vitals */
  enablePerformanceTracking: boolean;

  // ── Optional tuning ──────────────────────────────────────────────────────
  /** Flush the queue when it reaches this many events. Default: 10 */
  batchSize?: number;
  /** Flush the queue every N milliseconds. Default: 5000 */
  flushInterval?: number;
  /** 0–1 fraction of events to keep. Default: 1 (100 %) */
  sampleRate?: number;
  /** Print debug logs to the console. Default: false */
  debug?: boolean;
  /** API key sent as X-Guardian-Key header */
  apiKey?: string;
}

// ─── Event Classification ─────────────────────────────────────────────────────

export type EventCategory = "error" | "performance" | "scalability";

// ─── Base Event ───────────────────────────────────────────────────────────────

interface BaseGuardianEvent {
  id: string;
  category: EventCategory;
  timestamp: string; // ISO-8601
  environment: Environment;
  url: string;
  sessionId: string;
  sdkVersion: string;
}

// ─── Error Event ──────────────────────────────────────────────────────────────

export type ErrorKind = "uncaught_error" | "unhandled_rejection" | "manual";

export interface ErrorGuardianEvent extends BaseGuardianEvent {
  category: "error";
  kind: ErrorKind;
  message: string;
  stack: StackFrame[];
  extras: Record<string, unknown>;
}

// ─── Performance Event ────────────────────────────────────────────────────────

export type PerformanceKind =
  | "api_latency"
  | "render_timing"
  | "lcp"
  | "fid"
  | "cls"
  | "fcp"
  | "ttfb"
  | "navigation";

export type MetricUnit = "ms" | "bytes" | "score" | "count";

export interface PerformanceGuardianEvent extends BaseGuardianEvent {
  category: "performance";
  kind: PerformanceKind;
  /** Human-readable metric name */
  name: string;
  /** Measured value */
  value: number;
  unit: MetricUnit;
  /** Threshold at which the metric is considered poor */
  threshold: number | null;
  /** true when value exceeds the threshold */
  exceeded: boolean;
  /** Extra context (fetch URL, component name, etc.) */
  context: Record<string, unknown>;
}

// ─── Scalability Event ────────────────────────────────────────────────────────

export type ScalabilityKind =
  | "slow_api"
  | "high_error_rate"
  | "large_payload"
  | "memory_pressure"
  | "long_task";

export interface ScalabilityGuardianEvent extends BaseGuardianEvent {
  category: "scalability";
  kind: ScalabilityKind;
  message: string;
  data: Record<string, unknown>;
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type GuardianEvent =
  | ErrorGuardianEvent
  | PerformanceGuardianEvent
  | ScalabilityGuardianEvent;

// ─── Fetch Span ───────────────────────────────────────────────────────────────

export interface FetchSpan {
  id: string;
  url: string;
  method: string;
  status: number | null;
  /** Round-trip duration in ms */
  duration: number;
  requestBodySize: number;
  responseBodySize: number;
  timestamp: string;
  failed: boolean;
}

// ─── Batch API ────────────────────────────────────────────────────────────────

export interface BatchPayload {
  events: GuardianEvent[];
  sessionId: string;
  environment: Environment;
  sdkVersion: string;
  sentAt: string;
}

export interface BatchResponse {
  accepted: number;
  rejected: number;
}

// ─── Legacy event types (kept for server / dashboard backward compat) ─────────

export type EventSeverity = "fatal" | "error" | "warning" | "info" | "debug";

export interface StackFrame {
  filename: string;
  function: string;
  lineno: number | null;
  colno: number | null;
  inApp: boolean;
}

export interface ErrorEvent {
  id: string;
  type: "error";
  severity: EventSeverity;
  message: string;
  stack: StackFrame[];
  timestamp: string;
  sessionId: string;
  appName: string;
  appVersion: string;
  url: string;
  userAgent: string;
  tags: Record<string, string>;
  extras: Record<string, unknown>;
}

export type BreadcrumbCategory =
  | "navigation"
  | "http"
  | "ui.click"
  | "ui.input"
  | "console"
  | "custom";

export interface Breadcrumb {
  timestamp: string;
  category: BreadcrumbCategory;
  message: string;
  level: EventSeverity;
  data?: Record<string, unknown>;
}

export interface SessionData {
  id: string;
  startedAt: string;
  lastSeenAt: string;
  appName: string;
  appVersion: string;
  url: string;
  userAgent: string;
  errorCount: number;
}

export type AnalysisStatus = "pending" | "processing" | "completed" | "failed";

export interface AiAnalysis {
  id: string;
  eventId: string;
  status: AnalysisStatus;
  summary: string | null;
  rootCause: string | null;
  suggestedFix: string | null;
  affectedFiles: string[];
  confidence: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface IngestRequest {
  event: ErrorEvent;
  breadcrumbs: Breadcrumb[];
  session: SessionData;
}

export interface IngestResponse {
  eventId: string;
  received: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EventSummary {
  id: string;
  message: string;
  severity: EventSeverity;
  appName: string;
  url: string;
  timestamp: string;
  occurrences: number;
  hasAiAnalysis: boolean;
}
