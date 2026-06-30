// ─── Primary API ──────────────────────────────────────────────────────────────
export { initFrontendGuardian, getGuardianInstance, destroyGuardian } from "./factory.js";

// ─── Error Tracker ────────────────────────────────────────────────────────────
export { ErrorTracker, attachErrorTracker, getErrorTracker, detachErrorTracker, consoleErrorLogger } from "./errorTracker.js";
export type {
  ErrorTrackerConfig,
  ErrorTrackerLogger,
  ErrorTrackerEvent,
  ErrorTrackerKind,
  ErrorSeverity,
  ErrorType,
  ParsedFrame,
  CauseChain,
  ComponentContext,
  BrowserContext,
  TrackerBreadcrumb,
  BreadcrumbType,
} from "./errorTracker.js";

// ─── API Tracker ──────────────────────────────────────────────────────────────
export { ApiTracker, attachApiTracker, getApiTracker, detachApiTracker, consoleLogger } from "./apiTracker.js";
export type {
  ApiTrackerConfig,
  ApiTrackerLogger,
  ApiTrackerEvent,
  ApiEventKind,
  ApiEventSeverity,
  CacheHeaders,
} from "./apiTracker.js";

// ─── Performance Tracker ──────────────────────────────────────────────────────
export {
  PerformanceTracker,
  attachPerformanceTracker,
  getPerformanceTracker,
  detachPerformanceTracker,
  consolePerfLogger,
} from "./performanceTracker.js";
export type {
  PerformanceTrackerConfig,
  PerfTrackerLogger,
  PerfTrackerEvent,
  PerfTrackerEventKind,
  PerfSeverity,
  RenderPhase,
  LatencyStats,
  RenderStats,
  MemorySnapshot,
} from "./performanceTracker.js";

// ─── Scalability Analyzer ─────────────────────────────────────────────────────
export {
  ScalabilityAnalyzer,
  attachScalabilityAnalyzer,
  getScalabilityAnalyzer,
  detachScalabilityAnalyzer,
  consoleScalabilityLogger,
} from "./scalabilityAnalyzer.js";
export type {
  ScalabilityAnalyzerConfig,
  ScalabilityLogger,
  ScalabilityFinding,
  ScalabilityIssueType,
  ScalabilitySeverity,
  ScalabilityEvidence,
} from "./scalabilityAnalyzer.js";

// ─── SDK Class (for advanced / framework integrations) ────────────────────────
export { FrontendGuardianSDK } from "./sdk.js";

// ─── Public Types ─────────────────────────────────────────────────────────────
export type {
  // Config
  FrontendGuardianConfig,
  Environment,

  // Events
  EventCategory,
  GuardianEvent,
  ErrorGuardianEvent,
  PerformanceGuardianEvent,
  ScalabilityGuardianEvent,
  ErrorKind,
  PerformanceKind,
  ScalabilityKind,
  MetricUnit,

  // Fetch
  FetchSpan,

  // Batch
  BatchPayload,
  BatchResponse,
} from "@frontend-guardian/types";
