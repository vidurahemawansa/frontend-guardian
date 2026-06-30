import { generateId, now, currentUrl } from "./utils.js";

// ─── Event kinds ──────────────────────────────────────────────────────────────

/**
 * Every structured event the PerformanceTracker can emit.
 *
 *  API latency
 *    api_latency        – baseline record for every measured call
 *    api_slow           – duration exceeded the slow threshold
 *    api_critical       – duration exceeded the critical threshold
 *    api_degraded       – rolling p95 grew beyond degradation factor vs baseline
 *    api_recovered      – previously degraded endpoint returned to baseline
 *
 *  Component renders
 *    render_measured    – every recorded render (emitted only when emitBaseline = true)
 *    render_slow        – single render exceeded the slow threshold
 *    render_repeated    – component rendered too many times in the sliding window
 *    render_loop        – burst renders in a very short window (likely infinite loop)
 *    render_degraded    – component's rolling mean render time grew significantly
 *    render_recovered   – previously degraded component returned to baseline
 *
 *  Main-thread
 *    long_task          – JS task blocked the main thread beyond the threshold
 *
 *  Memory
 *    memory_pressure    – heap usage exceeded the pressure threshold
 *    memory_growing     – heap is growing consistently across samples
 */
export type PerfTrackerEventKind =
  | "api_latency"
  | "api_slow"
  | "api_critical"
  | "api_degraded"
  | "api_recovered"
  | "render_measured"
  | "render_slow"
  | "render_repeated"
  | "render_loop"
  | "render_degraded"
  | "render_recovered"
  | "long_task"
  | "memory_pressure"
  | "memory_growing";

export type PerfSeverity = "info" | "warning" | "error" | "critical";
export type RenderPhase  = "mount" | "update" | "nested-update";

// ─── Stats snapshots ──────────────────────────────────────────────────────────

export interface LatencyStats {
  endpoint: string;
  method: string;
  sampleCount: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  /** p95 of the first `baselineCount` samples; null until baseline is established */
  baselineP95: number | null;
  /** current.p95 / baseline.p95; null until baseline exists */
  degradationRatio: number | null;
}

export interface RenderStats {
  component: string;
  sampleCount: number;
  meanDuration: number;
  p95Duration: number;
  maxDuration: number;
  /** Renders counted inside the repeated-render window */
  rendersInWindow: number;
  windowMs: number;
  baselineMean: number | null;
  degradationRatio: number | null;
}

export interface MemorySnapshot {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  usageRatio: number;
}

// ─── Structured event ─────────────────────────────────────────────────────────

export interface PerfTrackerEvent {
  id: string;
  kind: PerfTrackerEventKind;
  severity: PerfSeverity;
  timestamp: string;
  pageUrl: string;

  // ── Core metric ──────────────────────────────────────────────────────────
  metricName: string;
  /** Measured value (unit depends on kind) */
  value: number;
  unit: "ms" | "count" | "bytes" | "ratio";
  threshold: number | null;
  /** true when value exceeds threshold */
  exceeded: boolean;

  // ── Context ───────────────────────────────────────────────────────────────
  /** Component name for render events */
  component: string | null;
  /** Normalised endpoint key for API events */
  endpoint: string | null;

  // ── Statistics ────────────────────────────────────────────────────────────
  latencyStats: LatencyStats | null;
  renderStats:  RenderStats  | null;
  memoryStats:  MemorySnapshot | null;

  message: string;
  data: Record<string, unknown>;
}

// ─── Logger interface ─────────────────────────────────────────────────────────

export interface PerfTrackerLogger {
  log(event: PerfTrackerEvent): void;
}

const SEVERITY_COLORS: Record<PerfSeverity, string> = {
  info:     "color:#60a5fa;font-weight:600",
  warning:  "color:#fbbf24;font-weight:600",
  error:    "color:#f87171;font-weight:600",
  critical: "color:#fca5a5;background:#450a0a;font-weight:700",
};

export const consolePerfLogger: PerfTrackerLogger = {
  log(event: PerfTrackerEvent): void {
    const style = SEVERITY_COLORS[event.severity];
    console.groupCollapsed(
      `%c[PerfTracker] ${event.kind} — ${event.metricName}`,
      style
    );
    console.log("value   :", `${event.value.toFixed(2)} ${event.unit}`);
    if (event.threshold !== null) {
      console.log("threshold:", `${event.threshold} ${event.unit}`);
    }
    if (event.component)  console.log("component:", event.component);
    if (event.endpoint)   console.log("endpoint :", event.endpoint);
    if (event.latencyStats) {
      const s = event.latencyStats;
      console.table({ p50: s.p50, p95: s.p95, p99: s.p99, mean: s.mean, samples: s.sampleCount });
    }
    if (event.renderStats) {
      const r = event.renderStats;
      console.table({ mean: r.meanDuration, p95: r.p95Duration, max: r.maxDuration, count: r.sampleCount });
    }
    if (event.memoryStats) {
      const m = event.memoryStats;
      console.log("memory  :", `${formatBytes(m.usedJSHeapSize)} / ${formatBytes(m.totalJSHeapSize)} (${(m.usageRatio * 100).toFixed(1)}%)`);
    }
    console.log("message :", event.message);
    if (Object.keys(event.data).length) console.log("data    :", event.data);
    console.groupEnd();
  },
};

// ─── Tracker configuration ────────────────────────────────────────────────────

export interface PerformanceTrackerConfig {
  logger?: PerfTrackerLogger;

  // ── API latency ───────────────────────────────────────────────────────────
  /** Intercept window.fetch to measure API latency automatically. Default: true */
  interceptFetch?: boolean;
  /** Emit baseline api_latency events for every call. Default: false */
  emitApiBaseline?: boolean;
  /** Duration that triggers api_slow (ms). Default: 800 */
  apiSlowMs?: number;
  /** Duration that triggers api_critical (ms). Default: 3 000 */
  apiCriticalMs?: number;
  /**
   * Number of initial samples used to compute the baseline distribution.
   * Default: 10
   */
  baselineCount?: number;
  /**
   * Ratio of current p95 / baseline p95 at which degradation is flagged.
   * Default: 1.5 (50 % regression)
   */
  degradationFactor?: number;
  /**
   * Ratio at which a previously-degraded endpoint is considered recovered.
   * Default: 1.2
   */
  recoveryFactor?: number;
  /** Maximum number of samples kept per endpoint/component. Default: 50 */
  maxSamples?: number;

  // ── Render tracking ───────────────────────────────────────────────────────
  /** Emit baseline render_measured events. Default: false */
  emitRenderBaseline?: boolean;
  /** Single render duration that triggers render_slow (ms). Default: 16 (1 frame @ 60 fps) */
  slowRenderMs?: number;
  /** Single render duration that triggers an error-level event (ms). Default: 100 */
  criticalRenderMs?: number;
  /**
   * Number of renders in `renderRepeatWindowMs` that triggers render_repeated.
   * Default: 5
   */
  renderRepeatThreshold?: number;
  /** Sliding window for repeated-render counting (ms). Default: 1 000 */
  renderRepeatWindowMs?: number;
  /**
   * Number of renders in `renderLoopWindowMs` that triggers render_loop.
   * Default: 15
   */
  renderLoopThreshold?: number;
  /** Sliding window for loop detection (ms). Default: 500 */
  renderLoopWindowMs?: number;

  // ── Long tasks ────────────────────────────────────────────────────────────
  /** Observe PerformanceObserver "longtask" entries. Default: true */
  observeLongTasks?: boolean;
  /** Minimum long-task duration to report (ms). Default: 50 */
  longTaskMs?: number;

  // ── Memory ────────────────────────────────────────────────────────────────
  /** Sample JS heap usage on an interval. Default: true */
  trackMemory?: boolean;
  /** How often to take a memory snapshot (ms). Default: 30 000 */
  memorySampleIntervalMs?: number;
  /** Heap usage ratio [0–1] that triggers memory_pressure. Default: 0.9 */
  memoryPressureRatio?: number;
  /**
   * Percentage increase in heap from first to last sample
   * that triggers memory_growing. Default: 0.25 (25 %)
   */
  memoryGrowthThreshold?: number;
  /** Number of memory samples to keep. Default: 10 */
  memoryMaxSamples?: number;

  // ── Filtering ─────────────────────────────────────────────────────────────
  ignoreUrls?: Array<string | RegExp>;
  ignoreComponents?: Array<string | RegExp>;

  debug?: boolean;
}

// ─── Rolling statistics ───────────────────────────────────────────────────────

class RollingStats {
  private readonly samples: number[] = [];
  private readonly maxSamples: number;
  private readonly baselineCount: number;
  private baselineP95: number | null = null;
  private baselineMean: number | null = null;
  private degraded = false;

  constructor(maxSamples: number, baselineCount: number) {
    this.maxSamples   = maxSamples;
    this.baselineCount = baselineCount;
  }

  push(value: number): void {
    this.samples.push(value);
    if (this.samples.length > this.maxSamples) this.samples.shift();

    // Establish baseline once we have enough samples
    if (this.baselineP95 === null && this.samples.length >= this.baselineCount) {
      const initial = this.samples.slice(0, this.baselineCount);
      this.baselineP95  = percentile(initial, 95);
      this.baselineMean = mean(initial);
    }
  }

  get count(): number { return this.samples.length; }

  mean():   number { return mean(this.samples); }
  p(p: number): number { return percentile(this.samples, p); }
  min():    number { return this.samples.length ? Math.min(...this.samples) : 0; }
  max():    number { return this.samples.length ? Math.max(...this.samples) : 0; }

  get baseline(): { p95: number; mean: number } | null {
    if (this.baselineP95 === null || this.baselineMean === null) return null;
    return { p95: this.baselineP95, mean: this.baselineMean };
  }

  degradationRatio(): number | null {
    if (!this.baseline || this.samples.length < this.baselineCount) return null;
    return this.p(95) / this.baseline.p95;
  }

  /**
   * Returns "degraded" / "recovered" / null based on whether crossing
   * the degradation / recovery factors occurs on this sample.
   */
  checkDegradation(
    degradationFactor: number,
    recoveryFactor: number
  ): "degraded" | "recovered" | null {
    const ratio = this.degradationRatio();
    if (ratio === null) return null;

    if (!this.degraded && ratio > degradationFactor) {
      this.degraded = true;
      return "degraded";
    }
    if (this.degraded && ratio < recoveryFactor) {
      this.degraded = false;
      return "recovered";
    }
    return null;
  }

  isDegraded(): boolean { return this.degraded; }
}

// ─── Endpoint latency registry ────────────────────────────────────────────────

interface EndpointEntry {
  method: string;
  stats: RollingStats;
}

// ─── Component render registry ────────────────────────────────────────────────

interface RenderEntry {
  stats:     RollingStats;
  /** Raw timestamps (performance.now()) for repeat-render rate detection */
  renderTs:  number[];
}

// ─── PerformanceTracker class ─────────────────────────────────────────────────

export class PerformanceTracker {
  private readonly cfg: Required<PerformanceTrackerConfig>;
  private readonly endpoints = new Map<string, EndpointEntry>();
  private readonly components = new Map<string, RenderEntry>();
  private readonly memorySamples: MemorySnapshot[] = [];

  private originalFetch: typeof fetch | null = null;
  private longTaskObserver: PerformanceObserver | null = null;
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private attached = false;

  constructor(config: PerformanceTrackerConfig = {}) {
    this.cfg = {
      logger:                 config.logger                 ?? consolePerfLogger,
      interceptFetch:         config.interceptFetch         ?? true,
      emitApiBaseline:        config.emitApiBaseline        ?? false,
      apiSlowMs:              config.apiSlowMs              ?? 800,
      apiCriticalMs:          config.apiCriticalMs          ?? 3_000,
      baselineCount:          config.baselineCount          ?? 10,
      degradationFactor:      config.degradationFactor      ?? 1.5,
      recoveryFactor:         config.recoveryFactor         ?? 1.2,
      maxSamples:             config.maxSamples             ?? 50,
      emitRenderBaseline:     config.emitRenderBaseline     ?? false,
      slowRenderMs:           config.slowRenderMs           ?? 16,
      criticalRenderMs:       config.criticalRenderMs       ?? 100,
      renderRepeatThreshold:  config.renderRepeatThreshold  ?? 5,
      renderRepeatWindowMs:   config.renderRepeatWindowMs   ?? 1_000,
      renderLoopThreshold:    config.renderLoopThreshold    ?? 15,
      renderLoopWindowMs:     config.renderLoopWindowMs     ?? 500,
      observeLongTasks:       config.observeLongTasks       ?? true,
      longTaskMs:             config.longTaskMs             ?? 50,
      trackMemory:            config.trackMemory            ?? true,
      memorySampleIntervalMs: config.memorySampleIntervalMs ?? 30_000,
      memoryPressureRatio:    config.memoryPressureRatio    ?? 0.9,
      memoryGrowthThreshold:  config.memoryGrowthThreshold  ?? 0.25,
      memoryMaxSamples:       config.memoryMaxSamples       ?? 10,
      ignoreUrls:             config.ignoreUrls             ?? [],
      ignoreComponents:       config.ignoreComponents       ?? [],
      debug:                  config.debug                  ?? false,
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  attach(): this {
    if (this.attached) return this;

    if (this.cfg.interceptFetch) this.attachFetchInterceptor();
    if (this.cfg.observeLongTasks) this.attachLongTaskObserver();
    if (this.cfg.trackMemory) this.startMemorySampler();

    this.attached = true;
    this.log("PerformanceTracker attached");
    return this;
  }

  detach(): void {
    if (!this.attached) return;

    this.detachFetchInterceptor();
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;

    if (this.memoryTimer !== null) clearInterval(this.memoryTimer);
    this.memoryTimer = null;

    this.attached = false;
  }

  // ─── Public API: API latency ───────────────────────────────────────────────

  /**
   * Record a completed API call. Called automatically when `interceptFetch`
   * is true; call manually when using XHR / GraphQL clients / service workers.
   */
  trackApiCall(
    url: string,
    method: string,
    durationMs: number,
    status: number | null = null
  ): void {
    const key = endpointKey(url, method);
    if (this.isIgnoredUrl(url)) return;

    let entry = this.endpoints.get(key);
    if (!entry) {
      entry = {
        method: method.toUpperCase(),
        stats: new RollingStats(this.cfg.maxSamples, this.cfg.baselineCount),
      };
      this.endpoints.set(key, entry);
    }

    entry.stats.push(durationMs);

    const baseLatencyEvent = (): PerfTrackerEvent => ({
      id: generateId(),
      kind: "api_latency",
      severity: "info",
      timestamp: now(),
      pageUrl: currentUrl(),
      metricName: `${method.toUpperCase()} ${url}`,
      value: durationMs,
      unit: "ms",
      threshold: this.cfg.apiSlowMs,
      exceeded: durationMs > this.cfg.apiSlowMs,
      component: null,
      endpoint: key,
      latencyStats: this.buildLatencyStats(key, url, entry),
      renderStats: null,
      memoryStats: null,
      message: `${method.toUpperCase()} ${url} completed in ${durationMs.toFixed(0)} ms`,
      data: { status, durationMs },
    });

    // ── Threshold violations ─────────────────────────────────────────────
    if (durationMs > this.cfg.apiCriticalMs) {
      this.emit({
        ...baseLatencyEvent(),
        kind: "api_critical",
        severity: "critical",
        message: `Critical API latency: ${method.toUpperCase()} ${url} took ${durationMs.toFixed(0)} ms (limit: ${this.cfg.apiCriticalMs} ms)`,
        data: { status, durationMs, threshold: this.cfg.apiCriticalMs },
      });
      return;
    }

    if (durationMs > this.cfg.apiSlowMs) {
      this.emit({
        ...baseLatencyEvent(),
        kind: "api_slow",
        severity: "warning",
        message: `Slow API: ${method.toUpperCase()} ${url} took ${durationMs.toFixed(0)} ms (limit: ${this.cfg.apiSlowMs} ms)`,
        data: { status, durationMs, threshold: this.cfg.apiSlowMs },
      });
      return;
    }

    // ── Degradation check ────────────────────────────────────────────────
    const trend = entry.stats.checkDegradation(this.cfg.degradationFactor, this.cfg.recoveryFactor);
    if (trend === "degraded") {
      const stats  = this.buildLatencyStats(key, url, entry);
      this.emit({
        ...baseLatencyEvent(),
        kind: "api_degraded",
        severity: "error",
        latencyStats: stats,
        message: `API performance degraded: ${method.toUpperCase()} ${url} — p95 is ${stats?.degradationRatio !== null ? (stats.degradationRatio! * 100 - 100).toFixed(0) + "% slower" : "worse"} than baseline`,
        data: { p95: stats?.p95, baselineP95: stats?.baselineP95, ratio: stats?.degradationRatio },
      });
      return;
    }

    if (trend === "recovered") {
      const stats = this.buildLatencyStats(key, url, entry);
      this.emit({
        ...baseLatencyEvent(),
        kind: "api_recovered",
        severity: "info",
        latencyStats: stats,
        message: `API performance recovered: ${method.toUpperCase()} ${url} — p95 back to normal`,
        data: { p95: stats?.p95, baselineP95: stats?.baselineP95 },
      });
      return;
    }

    if (this.cfg.emitApiBaseline) {
      this.emit(baseLatencyEvent());
    }
  }

  /** Returns a read-only snapshot of stats for a given endpoint. */
  getLatencyStats(url: string, method = "GET"): LatencyStats | null {
    const key   = endpointKey(url, method);
    const entry = this.endpoints.get(key);
    return entry ? this.buildLatencyStats(key, url, entry) : null;
  }

  // ─── Public API: component render timing ──────────────────────────────────

  /**
   * Record a single component render duration.
   *
   * @param componentName  Display name of the component
   * @param durationMs     How long the render took in milliseconds
   * @param phase          "mount" | "update" | "nested-update"
   *
   * @example – React Profiler
   * ```tsx
   * <Profiler id="UserCard" onRender={tracker.createReactProfilerCallback()}>
   *   <UserCard />
   * </Profiler>
   * ```
   *
   * @example – manual
   * ```ts
   * const t = performance.now();
   * renderSomething();
   * tracker.trackRender("MyComponent", performance.now() - t);
   * ```
   */
  trackRender(
    componentName: string,
    durationMs: number,
    phase: RenderPhase = "update"
  ): void {
    if (this.isIgnoredComponent(componentName)) return;

    let entry = this.components.get(componentName);
    if (!entry) {
      entry = {
        stats: new RollingStats(this.cfg.maxSamples, this.cfg.baselineCount),
        renderTs: [],
      };
      this.components.set(componentName, entry);
    }

    entry.stats.push(durationMs);
    const tsNow = performance.now();
    entry.renderTs.push(tsNow);
    // prune timestamps older than the wider of the two windows
    const pruneMs = Math.max(this.cfg.renderRepeatWindowMs, this.cfg.renderLoopWindowMs) * 2;
    entry.renderTs = entry.renderTs.filter((t) => tsNow - t <= pruneMs);

    const baseRenderEvent = (): PerfTrackerEvent => ({
      id: generateId(),
      kind: "render_measured",
      severity: "info",
      timestamp: now(),
      pageUrl: currentUrl(),
      metricName: `${componentName} render`,
      value: durationMs,
      unit: "ms",
      threshold: this.cfg.slowRenderMs,
      exceeded: durationMs > this.cfg.slowRenderMs,
      component: componentName,
      endpoint: null,
      latencyStats: null,
      renderStats: this.buildRenderStats(componentName, entry),
      memoryStats: null,
      message: `${componentName} rendered in ${durationMs.toFixed(2)} ms (${phase})`,
      data: { phase, durationMs },
    });

    // ── Render loop detection (highest priority) ──────────────────────────
    const loopCount = countInWindow(entry.renderTs, tsNow, this.cfg.renderLoopWindowMs);
    if (loopCount >= this.cfg.renderLoopThreshold) {
      this.emit({
        ...baseRenderEvent(),
        kind: "render_loop",
        severity: "critical",
        metricName: `${componentName} render loop`,
        value: loopCount,
        unit: "count",
        threshold: this.cfg.renderLoopThreshold,
        message: `Possible infinite render loop: ${componentName} rendered ${loopCount}× in ${this.cfg.renderLoopWindowMs} ms`,
        data: { loopCount, windowMs: this.cfg.renderLoopWindowMs, phase, threshold: this.cfg.renderLoopThreshold },
      });
      return;
    }

    // ── Repeated-render detection ─────────────────────────────────────────
    const repeatCount = countInWindow(entry.renderTs, tsNow, this.cfg.renderRepeatWindowMs);
    if (repeatCount >= this.cfg.renderRepeatThreshold) {
      this.emit({
        ...baseRenderEvent(),
        kind: "render_repeated",
        severity: "warning",
        metricName: `${componentName} repeated renders`,
        value: repeatCount,
        unit: "count",
        threshold: this.cfg.renderRepeatThreshold,
        message: `Repeated renders: ${componentName} rendered ${repeatCount}× in ${this.cfg.renderRepeatWindowMs} ms`,
        data: { repeatCount, windowMs: this.cfg.renderRepeatWindowMs, phase, threshold: this.cfg.renderRepeatThreshold },
      });
      return;
    }

    // ── Single-render threshold ───────────────────────────────────────────
    if (durationMs > this.cfg.criticalRenderMs) {
      this.emit({
        ...baseRenderEvent(),
        kind: "render_slow",
        severity: "error",
        message: `Very slow render: ${componentName} took ${durationMs.toFixed(2)} ms (limit: ${this.cfg.criticalRenderMs} ms)`,
        data: { phase, durationMs, threshold: this.cfg.criticalRenderMs },
      });
      return;
    }

    if (durationMs > this.cfg.slowRenderMs) {
      this.emit({
        ...baseRenderEvent(),
        kind: "render_slow",
        severity: "warning",
        message: `Slow render: ${componentName} took ${durationMs.toFixed(2)} ms (limit: ${this.cfg.slowRenderMs} ms)`,
        data: { phase, durationMs, threshold: this.cfg.slowRenderMs },
      });
      return;
    }

    // ── Degradation check ─────────────────────────────────────────────────
    const trend = entry.stats.checkDegradation(this.cfg.degradationFactor, this.cfg.recoveryFactor);
    if (trend === "degraded") {
      const stats = this.buildRenderStats(componentName, entry);
      this.emit({
        ...baseRenderEvent(),
        kind: "render_degraded",
        severity: "warning",
        renderStats: stats,
        message: `Render degraded: ${componentName} mean render time ${stats?.degradationRatio !== null ? (stats!.degradationRatio! * 100 - 100).toFixed(0) + "% slower" : "worse"} than baseline`,
        data: { mean: stats?.meanDuration, baselineMean: stats?.baselineMean, ratio: stats?.degradationRatio },
      });
      return;
    }

    if (trend === "recovered") {
      this.emit({
        ...baseRenderEvent(),
        kind: "render_recovered",
        severity: "info",
        message: `Render recovered: ${componentName} render time back to baseline`,
        data: {},
      });
      return;
    }

    if (this.cfg.emitRenderBaseline) {
      this.emit(baseRenderEvent());
    }
  }

  /**
   * Returns a ready-to-use `onRender` callback for React's `<Profiler>` component.
   *
   * @example
   * ```tsx
   * import { Profiler } from "react";
   *
   * <Profiler id="Dashboard" onRender={tracker.createReactProfilerCallback()}>
   *   <Dashboard />
   * </Profiler>
   * ```
   */
  createReactProfilerCallback(): (
    id: string,
    phase: "mount" | "update" | "nested-update",
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => void {
    return (id, phase, actualDuration) => {
      this.trackRender(id, actualDuration, phase);
    };
  }

  /**
   * Returns a Vue `app.config.performance` hook pair.
   * Set `app.config.performance = true`, then wrap components like this:
   *
   * @example
   * ```ts
   * const { markStart, markEnd } = tracker.createVueRenderHooks();
   * app.config.performance = true;
   * // In your component lifecycle:
   * markStart("MyComponent");
   * // ... render ...
   * markEnd("MyComponent");
   * ```
   */
  createVueRenderHooks(): { markStart(name: string): void; markEnd(name: string): void } {
    const starts = new Map<string, number>();
    return {
      markStart: (name: string) => { starts.set(name, performance.now()); },
      markEnd:   (name: string) => {
        const t = starts.get(name);
        if (t !== undefined) {
          this.trackRender(name, performance.now() - t, "update");
          starts.delete(name);
        }
      },
    };
  }

  /** Returns a read-only snapshot of render stats for a component. */
  getRenderStats(componentName: string): RenderStats | null {
    const entry = this.components.get(componentName);
    return entry ? this.buildRenderStats(componentName, entry) : null;
  }

  // ─── Internal: fetch interception ─────────────────────────────────────────

  private attachFetchInterceptor(): void {
    if (typeof window === "undefined" || !window.fetch) return;

    this.originalFetch = window.fetch.bind(window);
    const original = this.originalFetch;
    const tracker  = this;

    window.fetch = async function perfTrackerFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const start  = performance.now();

      let response: Response;
      let status: number | null = null;

      try {
        response = await original(input, init);
        status = response.status;
      } catch (err) {
        tracker.trackApiCall(rawUrl, method, performance.now() - start, null);
        throw err;
      }

      tracker.trackApiCall(rawUrl, method, performance.now() - start, status);
      return response;
    };
  }

  private detachFetchInterceptor(): void {
    if (this.originalFetch && typeof window !== "undefined") {
      window.fetch = this.originalFetch;
      this.originalFetch = null;
    }
  }

  // ─── Internal: long-task observer ─────────────────────────────────────────

  private attachLongTaskObserver(): void {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < this.cfg.longTaskMs) continue;
          this.emit({
            id: generateId(),
            kind: "long_task",
            severity: entry.duration > 200 ? "error" : "warning",
            timestamp: now(),
            pageUrl: currentUrl(),
            metricName: "Long Task",
            value: entry.duration,
            unit: "ms",
            threshold: this.cfg.longTaskMs,
            exceeded: true,
            component: null,
            endpoint: null,
            latencyStats: null,
            renderStats: null,
            memoryStats: null,
            message: `Long task blocked main thread for ${entry.duration.toFixed(0)} ms`,
            data: {
              duration: entry.duration,
              startTime: entry.startTime,
              name: entry.name,
            },
          });
        }
      });
      this.longTaskObserver.observe({ type: "longtask", buffered: false });
    } catch { /* browser doesn't support longtask */ }
  }

  // ─── Internal: memory sampler ─────────────────────────────────────────────

  private startMemorySampler(): void {
    const perf = performance as Performance & { memory?: Record<string, number> };
    if (!perf.memory) return; // Only available in Chromium

    const takeSample = () => {
      const m = perf.memory!;
      const used  = m["usedJSHeapSize"]  ?? 0;
      const total = m["totalJSHeapSize"] ?? 1;
      const limit = m["jsHeapSizeLimit"] ?? 1;
      const snap: MemorySnapshot = {
        usedJSHeapSize:  used,
        totalJSHeapSize: total,
        jsHeapSizeLimit: limit,
        usageRatio: used / limit,
      };

      this.memorySamples.push(snap);
      if (this.memorySamples.length > this.cfg.memoryMaxSamples) this.memorySamples.shift();

      this.analyzeMemory(snap);
    };

    takeSample(); // immediate first sample
    this.memoryTimer = setInterval(takeSample, this.cfg.memorySampleIntervalMs);
  }

  private analyzeMemory(latest: MemorySnapshot): void {
    // ── Pressure: heap close to limit ─────────────────────────────────────
    if (latest.usageRatio > this.cfg.memoryPressureRatio) {
      this.emit({
        id: generateId(),
        kind: "memory_pressure",
        severity: latest.usageRatio > 0.95 ? "critical" : "error",
        timestamp: now(),
        pageUrl: currentUrl(),
        metricName: "JS Heap Usage",
        value: latest.usageRatio,
        unit: "ratio",
        threshold: this.cfg.memoryPressureRatio,
        exceeded: true,
        component: null,
        endpoint: null,
        latencyStats: null,
        renderStats: null,
        memoryStats: latest,
        message: `Memory pressure: JS heap at ${(latest.usageRatio * 100).toFixed(1)}% of limit (${formatBytes(latest.usedJSHeapSize)} / ${formatBytes(latest.jsHeapSizeLimit)})`,
        data: { usageRatio: latest.usageRatio, usedBytes: latest.usedJSHeapSize, limitBytes: latest.jsHeapSizeLimit },
      });
      return;
    }

    // ── Growth: heap monotonically increasing ─────────────────────────────
    if (this.memorySamples.length < 3) return;
    const first = this.memorySamples[0]!;
    const growthRatio = (latest.usedJSHeapSize - first.usedJSHeapSize) / first.usedJSHeapSize;

    if (growthRatio > this.cfg.memoryGrowthThreshold && isMonotonicallyGrowing(this.memorySamples)) {
      this.emit({
        id: generateId(),
        kind: "memory_growing",
        severity: "warning",
        timestamp: now(),
        pageUrl: currentUrl(),
        metricName: "JS Heap Growth",
        value: growthRatio,
        unit: "ratio",
        threshold: this.cfg.memoryGrowthThreshold,
        exceeded: true,
        component: null,
        endpoint: null,
        latencyStats: null,
        renderStats: null,
        memoryStats: latest,
        message: `Memory growing: JS heap grew ${(growthRatio * 100).toFixed(1)}% over ${this.memorySamples.length} samples — possible leak`,
        data: {
          growthRatio,
          growthBytes: latest.usedJSHeapSize - first.usedJSHeapSize,
          samples: this.memorySamples.length,
        },
      });
    }
  }

  // ─── Stats builders ────────────────────────────────────────────────────────

  private buildLatencyStats(
    key: string,
    url: string,
    entry: EndpointEntry
  ): LatencyStats {
    const s = entry.stats;
    const baseline = s.baseline;
    return {
      endpoint: key,
      method: entry.method,
      sampleCount: s.count,
      mean: round(s.mean()),
      p50:  round(s.p(50)),
      p95:  round(s.p(95)),
      p99:  round(s.p(99)),
      min:  round(s.min()),
      max:  round(s.max()),
      baselineP95: baseline ? round(baseline.p95) : null,
      degradationRatio: s.degradationRatio() !== null ? round(s.degradationRatio()!) : null,
    };
  }

  private buildRenderStats(
    componentName: string,
    entry: RenderEntry
  ): RenderStats {
    const s = entry.stats;
    const tsNow = performance.now();
    const baseline = s.baseline;
    return {
      component: componentName,
      sampleCount: s.count,
      meanDuration: round(s.mean()),
      p95Duration:  round(s.p(95)),
      maxDuration:  round(s.max()),
      rendersInWindow: countInWindow(entry.renderTs, tsNow, this.cfg.renderRepeatWindowMs),
      windowMs: this.cfg.renderRepeatWindowMs,
      baselineMean: baseline ? round(baseline.mean) : null,
      degradationRatio: s.degradationRatio() !== null ? round(s.degradationRatio()!) : null,
    };
  }

  // ─── Filtering ─────────────────────────────────────────────────────────────

  private isIgnoredUrl(url: string): boolean {
    return this.cfg.ignoreUrls.some((p) => typeof p === "string" ? url.includes(p) : p.test(url));
  }

  private isIgnoredComponent(name: string): boolean {
    return this.cfg.ignoreComponents.some((p) => typeof p === "string" ? name.includes(p) : p.test(name));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private emit(event: PerfTrackerEvent): void {
    this.cfg.logger.log(event);
  }

  private log(...args: unknown[]): void {
    if (this.cfg.debug) console.debug("[PerfTracker]", ...args);
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function endpointKey(url: string, method: string): string {
  // Normalize: strip query string + fragment, keep origin+path
  try {
    const u = new URL(url, typeof location !== "undefined" ? location.href : undefined);
    return `${method.toUpperCase()} ${u.origin}${u.pathname}`;
  } catch {
    return `${method.toUpperCase()} ${url.split("?")[0] ?? url}`;
  }
}

/** Compute the Nth percentile of an array of numbers. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx    = Math.min(Math.floor((p / 100) * (sorted.length - 1)), sorted.length - 1);
  return sorted[idx] ?? 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function round(n: number, decimals = 2): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

/** Count how many timestamps in `ts` fall within `windowMs` of `nowMs`. */
function countInWindow(ts: number[], nowMs: number, windowMs: number): number {
  const cutoff = nowMs - windowMs;
  return ts.filter((t) => t >= cutoff).length;
}

/**
 * Returns true when each consecutive sample's `usedJSHeapSize` is ≥ its predecessor.
 * Used to confirm a genuine upward trend rather than GC noise.
 */
function isMonotonicallyGrowing(samples: MemorySnapshot[]): boolean {
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i]?.usedJSHeapSize ?? 0) < (samples[i - 1]?.usedJSHeapSize ?? 0)) return false;
  }
  return true;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024)          return `${bytes} B`;
  if (bytes < 1_024 * 1_024)  return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(2)} MB`;
}

// ─── Module-level singleton helpers ───────────────────────────────────────────

let _tracker: PerformanceTracker | null = null;

/**
 * Create and attach a global `PerformanceTracker` singleton.
 *
 * @example
 * ```ts
 * import { attachPerformanceTracker } from "@frontend-guardian/sdk";
 *
 * attachPerformanceTracker({
 *   apiSlowMs: 600,
 *   slowRenderMs: 16,
 *   renderRepeatThreshold: 4,
 *   logger: { log: (e) => mySDK.queue(e) },
 * });
 * ```
 */
export function attachPerformanceTracker(
  config: PerformanceTrackerConfig = {},
  opts: { force?: boolean } = {}
): PerformanceTracker {
  if (_tracker && !opts.force) return _tracker;
  _tracker?.detach();
  _tracker = new PerformanceTracker(config).attach();
  return _tracker;
}

/** Returns the current singleton, or null if never initialised. */
export function getPerformanceTracker(): PerformanceTracker | null {
  return _tracker;
}

/** Detach and destroy the singleton. */
export function detachPerformanceTracker(): void {
  _tracker?.detach();
  _tracker = null;
}
