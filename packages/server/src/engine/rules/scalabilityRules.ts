import type { GuardianEvent, ScalabilityGuardianEvent } from "@frontend-guardian/types";
import type { Rule, RuleMatch, RuleCategory, RuleIssueSeverity } from "../types.js";

function isScalability(e: GuardianEvent): e is ScalabilityGuardianEvent {
  return e.category === "scalability";
}
function latest(events: GuardianEvent[]): GuardianEvent {
  return events[events.length - 1]!;
}
function formatBytes(bytes: number): string {
  if (bytes < 1_024)         return `${bytes} B`;
  if (bytes < 1_048_576)     return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}

// ─── 1. Over-Fetching ─────────────────────────────────────────────────────────

export class OverFetchingRule implements Rule {
  readonly id       = "over-fetching";
  readonly title    = "API Over-Fetching";
  readonly category: RuleCategory = "scalability";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isScalability(current) || current.kind !== "high_error_rate") return null;

    const url = String(current.data["fetchUrl"] ?? "");
    if (!url) return null;

    const similar = events.slice(0, -1).filter(isScalability)
      .filter((e) => e.kind === "high_error_rate" && String(e.data["fetchUrl"] ?? "") === url);
    if (similar.length < 2) return null;

    const callCount = typeof current.data["callsInWindow"] === "number"
      ? current.data["callsInWindow"] as number : similar.length + 1;

    return {
      issueType: "over_fetching",
      description: `${url} called ${callCount}× in a short window — missing client-side caching or deduplication.`,
      affectedEventIds: [current.id, ...similar.map((e) => e.id)],
      data: { url, callCount },
      severity: callCount >= 10 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Use React Query or SWR — they deduplicate concurrent requests and cache results.\n` +
      `2. Increase staleTime so cached data is reused instead of re-fetched on remount.\n` +
      `3. If polling, increase the interval or switch to WebSocket / SSE.\n` +
      `4. Add request deduplication if multiple components need the same data.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const url = String(match.data["url"] ?? "<endpoint>");
    const count = String(match.data["callCount"] ?? "many");
    return (
      `My app is calling "${url}" ${count} times in a short window — over-fetching.\n\n` +
      `Please:\n` +
      `1. Replace the raw fetch call with React Query:\n` +
      `   const { data } = useQuery({ queryKey: ['${url}'], queryFn: () => fetch('${url}').then(r => r.json()), staleTime: 60_000 });\n` +
      `2. If multiple components call the same endpoint, lift the query to a shared parent or use a query client.\n` +
      `3. Remove any useEffect that calls this endpoint — let React Query manage the lifecycle.\n` +
      `4. Set a staleTime of at least 30 s for data that doesn't change frequently.`
    );
  }
}

// ─── 2. Large Payload ─────────────────────────────────────────────────────────

export class LargePayloadRule implements Rule {
  readonly id       = "large-payload";
  readonly title    = "Large API Payload";
  readonly category: RuleCategory = "scalability";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isScalability(current) || !["large_payload", "critical_payload"].includes(current.kind)) return null;

    const bytes = typeof current.data["bytes"] === "number" ? current.data["bytes"] as number : 0;
    const url   = String(current.data["fetchUrl"] ?? "unknown");

    return {
      issueType: "large_payload",
      description: `${url} returned ${formatBytes(bytes)}. Large payloads increase parse time, block the main thread, and strain mobile devices.`,
      affectedEventIds: [current.id],
      data: { bytes, url, formattedSize: formatBytes(bytes) },
      severity: bytes > 1_048_576 ? "critical" : bytes > 512_000 ? "error" : "warning",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Implement server-side pagination: return 20–50 items per page.\n` +
      `2. Use field selection (?fields=id,name) to return only the properties the UI needs.\n` +
      `3. Enable Brotli/gzip compression on the server.\n` +
      `4. Consider streaming responses for very large datasets.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const url  = String(match.data["url"] ?? "<endpoint>");
    const size = String(match.data["formattedSize"] ?? "?");
    return (
      `My API endpoint "${url}" is returning ${size} in a single response — too large for good UX.\n\n` +
      `Please:\n` +
      `1. Add server-side pagination to this endpoint:\n` +
      `   - Accept query params: ?page=1&pageSize=20\n` +
      `   - Return: { data: [...], total: N, page: 1, pageSize: 20, hasMore: true }\n` +
      `2. Update the frontend to read response.data and add Previous/Next controls.\n` +
      `3. Add a ?fields= parameter to let the client request only needed columns.\n` +
      `4. Enable compression: app.use(compression()) in Express (install the compression package).`
    );
  }
}

// ─── 3. Critically Slow API ───────────────────────────────────────────────────

export class SlowApiScalabilityRule implements Rule {
  readonly id       = "slow-api-scalability";
  readonly title    = "Critically Slow API (Scalability Risk)";
  readonly category: RuleCategory = "scalability";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isScalability(current) || current.kind !== "slow_api") return null;

    const ms  = typeof current.data["duration_ms"] === "number" ? current.data["duration_ms"] as number : 0;
    const url = String(current.data["fetchUrl"] ?? "unknown");

    const related = events.slice(0, -1).filter(isScalability)
      .filter((e) => e.kind === "slow_api" && String(e.data["fetchUrl"] ?? "") === url);

    return {
      issueType: "critically_slow_api",
      description: `${url} took ${ms.toFixed(0)} ms. ${related.length > 0 ? `Occurred ${related.length + 1} times recently.` : ""}`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { durationMs: ms, url, occurrences: related.length + 1 },
      severity: related.length >= 5 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    const url = String(match.data["url"] ?? "the endpoint");
    return (
      `1. Add server-side caching (Redis) for ${url} — even a 5 s TTL eliminates repeated slow queries.\n` +
      `2. Enable database connection pooling and check for lock contention.\n` +
      `3. Return a cached fallback while the slow endpoint is being fixed (circuit breaker).\n` +
      `4. Set a 10 s client timeout and show a fallback UI.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const url = String(match.data["url"] ?? "<endpoint>");
    const ms  = String(match.data["durationMs"] ?? "?");
    return (
      `My API "${url}" consistently takes ${ms} ms. At this speed users think the app is broken.\n\n` +
      `Please:\n` +
      `1. Add a Redis cache in front of this route:\n` +
      `   const TTL = 30; // seconds\n` +
      `   const cached = await redis.get('${url}');\n` +
      `   if (cached) return res.json(JSON.parse(cached));\n` +
      `   const data = await fetchFromDB();\n` +
      `   await redis.setex('${url}', TTL, JSON.stringify(data));\n` +
      `2. Add a circuit breaker: if the endpoint fails 3 times in 30 s, return a stale cached response.\n` +
      `3. Add a client-side timeout and skeleton loading state so users see feedback immediately.`
    );
  }
}

// ─── 4. Polling Detected ──────────────────────────────────────────────────────

export class PollingDetectedRule implements Rule {
  readonly id       = "polling-detected";
  readonly title    = "Polling Detected";
  readonly category: RuleCategory = "scalability";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isScalability(current) || typeof current.data["pollingIntervalMs"] !== "number") return null;

    const intervalMs = current.data["pollingIntervalMs"] as number;
    const url        = String(current.data["fetchUrl"] ?? "unknown");
    const isHighFreq = intervalMs < 5_000;

    return {
      issueType: isHighFreq ? "high_frequency_polling" : "polling_detected",
      description: `${url} is polled every ${(intervalMs / 1_000).toFixed(1)} s. At scale this multiplies server load by the number of connected clients.`,
      affectedEventIds: [current.id],
      data: { intervalMs, url, isHighFreq },
      severity: isHighFreq ? "error" : "warning",
    };
  }

  recommendation(match: RuleMatch): string {
    const url = String(match.data["url"] ?? "<endpoint>");
    return (
      `1. Replace polling with Server-Sent Events: const es = new EventSource('${url}/stream');\n` +
      `2. For bidirectional real-time communication, use WebSocket.\n` +
      `3. If polling must remain, increase the interval to ≥ 30 s and add If-None-Match.\n` +
      `4. Implement exponential backoff: double the interval each time the response hasn't changed.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const url      = String(match.data["url"] ?? "<endpoint>");
    const interval = String(((match.data["intervalMs"] as number ?? 5000) / 1_000).toFixed(1));
    return (
      `My app polls "${url}" every ${interval} seconds. Please replace this with Server-Sent Events (SSE).\n\n` +
      `On the server, add an SSE endpoint:\n` +
      `   app.get('${url}/stream', (req, res) => {\n` +
      `     res.setHeader('Content-Type', 'text/event-stream');\n` +
      `     res.setHeader('Cache-Control', 'no-cache');\n` +
      `     const send = (data) => res.write('data: ' + JSON.stringify(data) + '\\n\\n');\n` +
      `     // Push updates when data changes\n` +
      `     const interval = setInterval(() => send(getData()), 1000);\n` +
      `     req.on('close', () => clearInterval(interval));\n` +
      `   });\n\n` +
      `On the client, replace setInterval fetch with:\n` +
      `   const es = new EventSource('${url}/stream');\n` +
      `   es.onmessage = (e) => setData(JSON.parse(e.data));`
    );
  }
}

// ─── 5. Frequent Long Tasks ───────────────────────────────────────────────────

export class LongTaskFrequencyRule implements Rule {
  readonly id       = "long-task-frequency";
  readonly title    = "Frequent Long Tasks";
  readonly category: RuleCategory = "scalability";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isScalability(current) || current.kind !== "long_task") return null;

    const now = new Date(current.timestamp).getTime();
    const windowTasks = events.slice(0, -1).filter(isScalability)
      .filter((e) => e.kind === "long_task" && now - new Date(e.timestamp).getTime() <= 30_000);

    if (windowTasks.length < 5) return null;

    const total = windowTasks
      .map((e) => typeof (e.data as Record<string, unknown>)["duration"] === "number"
        ? (e.data as Record<string, unknown>)["duration"] as number : 0)
      .reduce((s, d) => s + d, 0);

    return {
      issueType: "long_task_frequency",
      description: `${windowTasks.length} long tasks in 30 s — total blocked time ~${total.toFixed(0)} ms. UI is severely unresponsive.`,
      affectedEventIds: [current.id, ...windowTasks.map((e) => e.id)],
      data: { count: windowTasks.length, totalBlockedMs: total },
      severity: windowTasks.length >= 10 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Use the Chrome Performance panel to record and identify the hot function.\n` +
      `2. Move CPU-heavy work to a Web Worker.\n` +
      `3. Break synchronous loops into batches with requestIdleCallback.\n` +
      `4. Virtualise large lists to avoid off-screen layout calculations.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const count   = String(match.data["count"] ?? "?");
    const blocked = String(match.data["totalBlockedMs"] ?? "?");
    return (
      `My app has ${count} long JS tasks in 30 s, blocking the main thread for ${blocked} ms total.\n\n` +
      `Please:\n` +
      `1. Find the most expensive synchronous operations — sort, filter, or transform of large arrays.\n` +
      `2. Move them to a Web Worker:\n` +
      `   // heavy.worker.ts\n` +
      `   self.onmessage = (e) => { const result = heavyComputation(e.data); self.postMessage(result); };\n` +
      `3. For any large list (>500 items), replace the DOM list with a virtualised list:\n` +
      `   npm install @tanstack/react-virtual\n` +
      `   Use useVirtualizer() to render only visible rows.\n` +
      `4. Show the slowest 3 functions and propose chunked alternatives.`
    );
  }
}
