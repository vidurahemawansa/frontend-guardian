import type { PerformanceGuardianEvent, ScalabilityGuardianEvent } from "@frontend-guardian/types";
import type { ResolvedConfig } from "../config.js";
import { SDK_VERSION, THRESHOLDS } from "../config.js";
import { generateId, now, currentUrl } from "../utils.js";

export type PerfEventHandler = (
  event: PerformanceGuardianEvent | ScalabilityGuardianEvent
) => void;

type VitalEntry = PerformanceEntry & { value?: number; hadRecentInput?: boolean };

/**
 * Observes Web Vitals (LCP, FID, CLS, FCP) via PerformanceObserver,
 * reads Navigation Timing for TTFB and page load, and reports Long Tasks.
 */
export class PerformanceCollector {
  private readonly onEvent: PerfEventHandler;
  private readonly config: ResolvedConfig;
  private observers: PerformanceObserver[] = [];
  private attached = false;

  constructor(config: ResolvedConfig, onEvent: PerfEventHandler) {
    this.config = config;
    this.onEvent = onEvent;
  }

  attach(): void {
    if (
      this.attached ||
      !this.config.enablePerformanceTracking ||
      typeof PerformanceObserver === "undefined"
    ) return;

    this.observeVital("largest-contentful-paint", this.handleLCP.bind(this));
    this.observeVital("first-input", this.handleFID.bind(this));
    this.observeVital("layout-shift", this.handleCLS.bind(this));
    this.observeVital("paint", this.handlePaint.bind(this));
    this.observeVital("longtask", this.handleLongTask.bind(this));

    // Navigation timing – run after the load event so values are final
    if (typeof window !== "undefined") {
      if (document.readyState === "complete") {
        this.reportNavigationTiming();
      } else {
        window.addEventListener("load", () => this.reportNavigationTiming(), { once: true });
      }
    }

    this.attached = true;
  }

  detach(): void {
    for (const obs of this.observers) {
      try { obs.disconnect(); } catch { /* ignore */ }
    }
    this.observers = [];
    this.attached = false;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private observeVital(type: string, handler: (entries: PerformanceEntryList) => void): void {
    try {
      const obs = new PerformanceObserver((list) => handler(list.getEntries()));
      obs.observe({ type, buffered: true });
      this.observers.push(obs);
    } catch {
      // Browser may not support this entry type; silently skip.
    }
  }

  private handleLCP(entries: PerformanceEntryList): void {
    // Use the last entry (most recent LCP candidate)
    const entry = entries[entries.length - 1] as VitalEntry | undefined;
    if (!entry) return;
    const value = (entry as PerformanceEntry & { renderTime?: number; loadTime?: number }).renderTime
      ?? (entry as PerformanceEntry & { renderTime?: number; loadTime?: number }).loadTime
      ?? entry.startTime;

    this.emit("lcp", "Largest Contentful Paint", value, "ms", THRESHOLDS.lcp_needs_improvement_ms, {
      element: (entry as PerformanceEntry & { element?: Element }).element?.tagName ?? null,
    });
  }

  private handleFID(entries: PerformanceEntryList): void {
    const entry = entries[0] as PerformanceEntry & { processingStart?: number } | undefined;
    if (!entry) return;
    const value = (entry.processingStart ?? 0) - entry.startTime;
    this.emit("fid", "First Input Delay", value, "ms", THRESHOLDS.fid_needs_improvement_ms, {});
  }

  private handleCLS(entries: PerformanceEntryList): void {
    // CLS accumulates – sum all non-input shifts
    let score = 0;
    for (const raw of entries) {
      const entry = raw as VitalEntry;
      if (!entry.hadRecentInput) score += entry.value ?? 0;
    }
    if (score === 0) return;
    this.emit("cls", "Cumulative Layout Shift", score, "score", THRESHOLDS.cls_needs_improvement_score, {});
  }

  private handlePaint(entries: PerformanceEntryList): void {
    for (const entry of entries) {
      if (entry.name === "first-contentful-paint") {
        this.emit("fcp", "First Contentful Paint", entry.startTime, "ms", THRESHOLDS.fcp_needs_improvement_ms, {});
      }
    }
  }

  private handleLongTask(entries: PerformanceEntryList): void {
    for (const entry of entries) {
      if (entry.duration < THRESHOLDS.long_task_ms) continue;

      const event: ScalabilityGuardianEvent = {
        id: generateId(),
        category: "scalability",
        kind: "long_task",
        timestamp: now(),
        environment: this.config.environment,
        url: currentUrl(),
        sessionId: "",
        sdkVersion: SDK_VERSION,
        message: `Long task detected: ${entry.duration.toFixed(0)} ms`,
        data: { duration: entry.duration, startTime: entry.startTime },
      };
      this.onEvent(event);
    }
  }

  private reportNavigationTiming(): void {
    if (typeof performance === "undefined") return;
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (!nav) return;

    const ttfb = nav.responseStart - nav.requestStart;
    const domLoad = nav.domContentLoadedEventEnd - nav.fetchStart;
    const fullLoad = nav.loadEventEnd - nav.fetchStart;

    this.emit("ttfb", "Time to First Byte", ttfb, "ms", THRESHOLDS.ttfb_needs_improvement_ms, {
      initiatorType: nav.initiatorType,
    });
    this.emit("navigation", "DOM Content Loaded", domLoad, "ms", null, {});
    this.emit("navigation", "Page Load", fullLoad, "ms", null, {});
  }

  /** Builds and dispatches a PerformanceGuardianEvent (or ScalabilityGuardianEvent when thresholds are exceeded badly). */
  private emit(
    kind: PerformanceGuardianEvent["kind"],
    name: string,
    value: number,
    unit: PerformanceGuardianEvent["unit"],
    threshold: number | null,
    context: Record<string, unknown>
  ): void {
    if (!this.config.enabled) return;

    const exceeded = threshold !== null && value > threshold;

    // Escalate to scalability when the "poor" threshold is crossed
    if (exceeded) {
      const poor = this.poorThreshold(kind);
      if (poor !== null && value > poor) {
        const scalEvent: ScalabilityGuardianEvent = {
          id: generateId(),
          category: "scalability",
          kind: "slow_api",
          timestamp: now(),
          environment: this.config.environment,
          url: currentUrl(),
          sessionId: "",
          sdkVersion: SDK_VERSION,
          message: `Poor ${name}: ${value.toFixed(2)} ${unit} (threshold: ${poor} ${unit})`,
          data: { kind, value, unit, threshold: poor, ...context },
        };
        this.onEvent(scalEvent);
        return;
      }
    }

    const event: PerformanceGuardianEvent = {
      id: generateId(),
      category: "performance",
      kind,
      timestamp: now(),
      environment: this.config.environment,
      url: currentUrl(),
      sessionId: "",
      sdkVersion: SDK_VERSION,
      name,
      value,
      unit,
      threshold,
      exceeded,
      context,
    };
    this.onEvent(event);
  }

  private poorThreshold(kind: PerformanceGuardianEvent["kind"]): number | null {
    switch (kind) {
      case "lcp": return THRESHOLDS.lcp_poor_ms;
      case "fid": return THRESHOLDS.fid_poor_ms;
      case "cls": return THRESHOLDS.cls_poor_score;
      case "fcp": return THRESHOLDS.fcp_poor_ms;
      case "ttfb": return THRESHOLDS.ttfb_poor_ms;
      default: return null;
    }
  }
}
