import type { GuardianEvent, PerformanceGuardianEvent } from "@frontend-guardian/types";
import type { Rule, RuleMatch, RuleCategory, RuleIssueSeverity } from "../types.js";

function isPerf(e: GuardianEvent): e is PerformanceGuardianEvent {
  return e.category === "performance";
}
function latest(events: GuardianEvent[]): GuardianEvent {
  return events[events.length - 1]!;
}

// ─── 1. Slow API ──────────────────────────────────────────────────────────────

export class SlowApiRule implements Rule {
  readonly id       = "slow-api";
  readonly title    = "Slow API Response";
  readonly category: RuleCategory = "performance";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isPerf(current) || current.kind !== "api_latency" || current.value < 1_000) return null;

    const endpoint = String(current.context["fetchUrl"] ?? current.name);
    const repeatSlow = events.slice(0, -1).filter(isPerf)
      .filter((e) => e.kind === "api_latency" && e.value >= 1_000 &&
        String(e.context["fetchUrl"] ?? e.name) === endpoint);

    return {
      issueType: "slow_api",
      description: `${endpoint} responded in ${current.value.toFixed(0)} ms (threshold: 1 000 ms). Slow ${repeatSlow.length + 1} time(s) recently.`,
      affectedEventIds: [current.id, ...repeatSlow.map((e) => e.id)],
      data: { durationMs: current.value, endpoint, repeatCount: repeatSlow.length + 1 },
      severity: current.value >= 3_000 ? "critical" : repeatSlow.length >= 3 ? "error" : "warning",
    };
  }

  recommendation(match: RuleMatch): string {
    const ep = String(match.data["endpoint"] ?? "the endpoint");
    return (
      `1. Profile ${ep} — check for N+1 queries, missing DB indexes, or expensive computations.\n` +
      `2. Add response caching (Redis, in-memory) for frequently requested data.\n` +
      `3. Consider pagination or field-selection to reduce payload size.\n` +
      `4. Add a ${String(match.data["durationMs"] ?? 3_000)} ms client-side timeout and return a user-facing error.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const ep = String(match.data["endpoint"] ?? "<endpoint>");
    const ms = String(match.data["durationMs"] ?? "?");
    return (
      `My API endpoint "${ep}" is responding in ${ms} ms — well above the 1 000 ms threshold.\n\n` +
      `Please:\n` +
      `1. Add server-side caching for this endpoint (Redis or in-memory with a 30 s TTL).\n` +
      `2. Review the database query — add missing indexes or rewrite the query.\n` +
      `3. Add a loading skeleton UI while the data loads so users see feedback immediately.\n` +
      `4. Add a client-side timeout of 10 s with a user-friendly error state:\n` +
      `   const controller = new AbortController();\n` +
      `   setTimeout(() => controller.abort(), 10_000);\n` +
      `   fetch("${ep}", { signal: controller.signal })`
    );
  }
}

// ─── 2. Render Loop ───────────────────────────────────────────────────────────

export class RenderLoopRule implements Rule {
  readonly id       = "render-loop";
  readonly title    = "Suspected Render Loop";
  readonly category: RuleCategory = "performance";
  readonly severity: RuleIssueSeverity = "critical";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isPerf(current) || !["render_loop", "render_repeated"].includes(current.kind)) return null;

    const component = String(current.context["component"] ?? current.name);
    const related = events.slice(0, -1).filter(isPerf)
      .filter((e) => ["render_loop", "render_repeated"].includes(e.kind) &&
        String(e.context["component"] ?? e.name) === component);

    return {
      issueType: current.kind === "render_loop" ? "render_loop" : "render_repeated",
      description: current.kind === "render_loop"
        ? `${component} rendered ${current.value} times in ${String(current.context["windowMs"] ?? "?")} ms — infinite loop detected.`
        : `${component} re-rendered ${current.value} times in ${String(current.context["windowMs"] ?? "?")} ms without meaningful state change.`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { component, renderCount: current.value, kind: current.kind },
    };
  }

  recommendation(match: RuleMatch): string {
    const isLoop = match.data["kind"] === "render_loop";
    return isLoop
      ? `1. Check for state updates without conditions inside useEffect — add a dependency array.\n` +
        `2. Ensure setState/dispatch are not called unconditionally at the top level.\n` +
        `3. Use React DevTools Profiler to identify which state update triggers the re-render.\n` +
        `4. Add React.StrictMode to expose accidental side effects.`
      : `1. Wrap expensive callbacks in useCallback and derived values in useMemo.\n` +
        `2. Split large components so only the affected subtree re-renders.\n` +
        `3. Use React.memo() on child components that receive stable props.\n` +
        `4. Profile with React DevTools to confirm which prop change is causing re-renders.`;
  }

  generateCursorPrompt(match: RuleMatch): string {
    const component = String(match.data["component"] ?? "the component");
    const count = String(match.data["renderCount"] ?? "many");
    const isLoop = match.data["kind"] === "render_loop";
    return (
      `My React component "${component}" ${isLoop ? "is in an infinite render loop" : `is re-rendering ${count} times unnecessarily`}.\n\n` +
      `Please:\n` +
      `1. Review the ${component} component source code.\n` +
      (isLoop
        ? `2. Find every useEffect in the component and ensure each has a correct dependency array.\n` +
          `3. Find any setState or dispatch calls that run on every render — add a condition.\n`
        : `2. Wrap any inline object/array/function props passed to child components in useMemo/useCallback.\n` +
          `3. Apply React.memo() to pure child components.\n`) +
      `4. Show me the diff before and after the fix.\n` +
      `5. Add a render count console.log temporarily to verify the fix works.`
    );
  }
}

// ─── 3. Long Task ─────────────────────────────────────────────────────────────

export class LongTaskRule implements Rule {
  readonly id       = "long-task";
  readonly title    = "Long Main-Thread Task";
  readonly category: RuleCategory = "performance";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isPerf(current) || current.kind !== "long_task" || current.value < 100) return null;

    const recent = events.slice(0, -1).filter(isPerf)
      .filter((e) => e.kind === "long_task" && e.value >= 100);

    return {
      issueType: "long_task",
      description: `A synchronous JS task blocked the main thread for ${current.value.toFixed(0)} ms. ${recent.length > 0 ? `${recent.length} more long tasks in recent history.` : ""}`,
      affectedEventIds: [current.id, ...recent.map((e) => e.id)],
      data: { durationMs: current.value, recentCount: recent.length },
      severity: current.value > 300 ? "critical" : recent.length >= 5 ? "error" : "warning",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Move heavy computation (sorting, filtering, parsing) to a Web Worker.\n` +
      `2. Break large loops into chunks: scheduler.postTask() or requestIdleCallback().\n` +
      `3. Defer non-critical work with setTimeout(fn, 0) or requestAnimationFrame().\n` +
      `4. Use the Chrome DevTools Performance panel to pinpoint the slow function.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const ms = String(match.data["durationMs"] ?? "?");
    return (
      `My app has a synchronous JavaScript task that blocked the browser main thread for ${ms} ms.\n` +
      `This causes jank, dropped frames, and unresponsive UI.\n\n` +
      `Please:\n` +
      `1. Find synchronous loops or computations that process large arrays (sort, filter, map, reduce).\n` +
      `2. Move the heaviest computation into a Web Worker:\n` +
      `   const worker = new Worker(new URL('./heavy.worker.ts', import.meta.url));\n` +
      `3. For remaining sync work, break it into chunks using requestIdleCallback:\n` +
      `   function processChunk(items, index) {\n` +
      `     // process items[index..index+100]\n` +
      `     if (index < items.length) requestIdleCallback(() => processChunk(items, index + 100));\n` +
      `   }\n` +
      `4. Show me the before/after performance profile difference.`
    );
  }
}

// ─── 4. Memory Pressure ───────────────────────────────────────────────────────

export class MemoryPressureRule implements Rule {
  readonly id       = "memory-pressure";
  readonly title    = "Memory Pressure";
  readonly category: RuleCategory = "performance";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (current.category !== "scalability") return null;
    const kind = (current as { kind?: string }).kind;
    if (!["memory_pressure", "memory_growing"].includes(kind ?? "")) return null;

    const data = (current as { data?: Record<string, unknown> }).data ?? {};
    const usage = typeof data["usageRatio"] === "number" ? data["usageRatio"] : null;
    const growing = kind === "memory_growing";

    return {
      issueType: growing ? "memory_leak_suspected" : "memory_pressure",
      description: growing
        ? "JS heap growing consistently without GC reduction — memory leak suspected."
        : `JS heap at ${usage !== null ? (usage * 100).toFixed(0) + "%" : "high"} capacity.`,
      affectedEventIds: [current.id],
      data: { usageRatio: usage, growing },
      severity: (usage !== null && usage > 0.95) || growing ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Profile with Chrome DevTools Memory tab — take 3 heap snapshots over time.\n` +
      `2. Look for Detached DOM nodes and event listeners on removed elements.\n` +
      `3. Ensure useEffect cleanup removes all subscriptions and event listeners.\n` +
      `4. Clear large caches or paginate data to avoid storing full datasets in memory.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const isLeak = Boolean(match.data["growing"]);
    return (
      `My app ${isLeak ? "has a suspected memory leak — the JS heap grows consistently without being freed" : "is under memory pressure"}.\n\n` +
      `Please:\n` +
      `1. Search for useEffect hooks that add event listeners, subscriptions, or timers WITHOUT a cleanup return.\n` +
      `2. Search for module-level arrays or Maps that grow indefinitely (caches without eviction).\n` +
      `3. Check all third-party library subscriptions (RxJS, EventEmitter) for missing unsubscribe calls.\n` +
      `4. Fix each leak by returning a cleanup function from useEffect:\n` +
      `   useEffect(() => {\n` +
      `     const handler = () => { ... };\n` +
      `     window.addEventListener('resize', handler);\n` +
      `     return () => window.removeEventListener('resize', handler); // cleanup\n` +
      `   }, []);`
    );
  }
}

// ─── 5. API Degradation ───────────────────────────────────────────────────────

export class ApiDegradationRule implements Rule {
  readonly id       = "api-degradation";
  readonly title    = "API Performance Degradation";
  readonly category: RuleCategory = "performance";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isPerf(current) || current.kind !== "api_degraded") return null;

    const ratio = typeof current.context["ratio"] === "number" ? current.context["ratio"] : null;
    const p95   = typeof current.context["p95"] === "number" ? current.context["p95"] : current.value;
    const base  = typeof current.context["baselineP95"] === "number" ? current.context["baselineP95"] : null;

    return {
      issueType: "api_degradation",
      description: `${current.name} p95 latency is ${p95.toFixed(0)} ms${base !== null ? `, up from baseline of ${base.toFixed(0)} ms` : ""}. Gradual degradation, not a spike.`,
      affectedEventIds: [current.id],
      data: { endpoint: current.name, p95, baselineP95: base, ratio },
      severity: ratio !== null && ratio > 2 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Check database slow query logs — growing datasets often cause index scans to slow down.\n` +
      `2. Look for missing pagination — the dataset returned may be growing over time.\n` +
      `3. Review recent deployments for resource limit changes.\n` +
      `4. Add a server-side APM tool (Datadog, New Relic) for deeper traces.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const ep = String(match.data["endpoint"] ?? "<endpoint>");
    const p95 = String(match.data["p95"] ?? "?");
    const base = String(match.data["baselineP95"] ?? "?");
    return (
      `My API endpoint "${ep}" is gradually getting slower.\n` +
      `Current p95 latency: ${p95} ms (was ${base} ms baseline).\n` +
      `This is a gradual degradation, not a spike — suggesting data growth or resource exhaustion.\n\n` +
      `Please:\n` +
      `1. Add pagination to this endpoint if it returns an unbounded list.\n` +
      `2. Add a Redis cache in front of this endpoint:\n` +
      `   const cached = await redis.get(cacheKey);\n` +
      `   if (cached) return JSON.parse(cached);\n` +
      `3. Review the database query for this endpoint and add missing indexes.\n` +
      `4. Add monitoring: log query time per request so we can correlate with data growth.`
    );
  }
}
