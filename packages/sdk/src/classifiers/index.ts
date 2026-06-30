import type {
  FetchSpan,
  GuardianEvent,
  PerformanceGuardianEvent,
  ScalabilityGuardianEvent,
} from "@frontend-guardian/types";
import type { ResolvedConfig } from "../config.js";
import { SDK_VERSION, THRESHOLDS } from "../config.js";
import { generateId, now, currentUrl } from "../utils.js";

/**
 * Classifies a completed FetchSpan into one or two GuardianEvents.
 *
 * Rules (evaluated top-to-bottom, first match wins per axis):
 *
 *  Scalability
 *    – duration > 3000 ms        → slow_api
 *    – responseBodySize > 512 KB → large_payload
 *    – status >= 500             → (error is handled by window.onerror; here
 *                                   we emit a scalability high_error_rate signal)
 *
 *  Performance
 *    – duration > 1000 ms        → api_latency (exceeded = true)
 *    – any successful call       → api_latency (exceeded = false)
 */
export function classifyFetchSpan(
  span: FetchSpan,
  config: ResolvedConfig,
  sessionId: string
): GuardianEvent[] {
  const events: GuardianEvent[] = [];
  const base = {
    timestamp: span.timestamp,
    environment: config.environment,
    url: currentUrl(),
    sessionId,
    sdkVersion: SDK_VERSION,
  } as const;

  // ── Scalability signals ────────────────────────────────────────────────────

  if (span.duration > THRESHOLDS.api_slow_ms) {
    const e: ScalabilityGuardianEvent = {
      id: generateId(),
      category: "scalability",
      kind: "slow_api",
      ...base,
      message: `Slow API call: ${span.method} ${span.url} took ${span.duration.toFixed(0)} ms`,
      data: {
        fetchUrl: span.url,
        method: span.method,
        status: span.status,
        duration_ms: span.duration,
        threshold_ms: THRESHOLDS.api_slow_ms,
      },
    };
    events.push(e);
    return events; // escalated; skip performance event for this span
  }

  if (span.responseBodySize > THRESHOLDS.payload_large_bytes) {
    const e: ScalabilityGuardianEvent = {
      id: generateId(),
      category: "scalability",
      kind: "large_payload",
      ...base,
      message: `Large API response: ${span.method} ${span.url} returned ${(span.responseBodySize / 1024).toFixed(1)} KB`,
      data: {
        fetchUrl: span.url,
        method: span.method,
        status: span.status,
        responseBodySize_bytes: span.responseBodySize,
        threshold_bytes: THRESHOLDS.payload_large_bytes,
      },
    };
    events.push(e);
    return events;
  }

  if (span.status !== null && span.status >= 500) {
    const e: ScalabilityGuardianEvent = {
      id: generateId(),
      category: "scalability",
      kind: "high_error_rate",
      ...base,
      message: `Server error: ${span.method} ${span.url} responded ${span.status}`,
      data: {
        fetchUrl: span.url,
        method: span.method,
        status: span.status,
        duration_ms: span.duration,
      },
    };
    events.push(e);
    return events;
  }

  // ── Performance signal ─────────────────────────────────────────────────────

  if (!span.failed && config.enablePerformanceTracking) {
    const exceeded = span.duration > THRESHOLDS.api_warn_ms;
    const e: PerformanceGuardianEvent = {
      id: generateId(),
      category: "performance",
      kind: "api_latency",
      ...base,
      name: `${span.method} ${span.url}`,
      value: span.duration,
      unit: "ms",
      threshold: THRESHOLDS.api_warn_ms,
      exceeded,
      context: {
        fetchUrl: span.url,
        method: span.method,
        status: span.status,
        requestBodySize: span.requestBodySize,
        responseBodySize: span.responseBodySize,
      },
    };
    events.push(e);
  }

  return events;
}
