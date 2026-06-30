import type { FrontendGuardianConfig } from "@frontend-guardian/types";

export const SDK_VERSION = "0.1.0";

export const DEFAULTS = {
  batchSize: 10,
  flushInterval: 5_000,
  sampleRate: 1,
  debug: false,
} as const;

// Thresholds used by classifiers (all values in ms unless noted)
export const THRESHOLDS = {
  // Fetch / API
  api_slow_ms: 3_000,       // → scalability: slow_api
  api_warn_ms: 1_000,       // → performance: api_latency exceeded
  payload_large_bytes: 512 * 1024, // 512 KB → scalability: large_payload

  // Web Vitals (Google Core Web Vitals 2024 thresholds)
  lcp_poor_ms: 4_000,       // → scalability
  lcp_needs_improvement_ms: 2_500, // → performance exceeded
  fid_poor_ms: 300,
  fid_needs_improvement_ms: 100,
  cls_poor_score: 0.25,     // unitless score
  cls_needs_improvement_score: 0.1,
  fcp_poor_ms: 3_000,
  fcp_needs_improvement_ms: 1_800,
  ttfb_poor_ms: 1_800,
  ttfb_needs_improvement_ms: 800,

  // Long tasks
  long_task_ms: 50,         // → scalability: long_task
} as const;

export type ResolvedConfig = Required<FrontendGuardianConfig>;

export function resolveConfig(raw: FrontendGuardianConfig): ResolvedConfig {
  if (!raw.apiUrl) throw new Error("[FrontendGuardian] config.apiUrl is required");
  return {
    enabled: raw.enabled,
    apiUrl: raw.apiUrl.replace(/\/$/, ""), // strip trailing slash
    environment: raw.environment,
    enablePerformanceTracking: raw.enablePerformanceTracking,
    batchSize: raw.batchSize ?? DEFAULTS.batchSize,
    flushInterval: raw.flushInterval ?? DEFAULTS.flushInterval,
    sampleRate: raw.sampleRate ?? DEFAULTS.sampleRate,
    debug: raw.debug ?? DEFAULTS.debug,
    apiKey: raw.apiKey ?? "",
  };
}
