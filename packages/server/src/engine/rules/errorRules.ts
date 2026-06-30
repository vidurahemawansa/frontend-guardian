import type { GuardianEvent, ErrorGuardianEvent } from "@frontend-guardian/types";
import type { Rule, RuleMatch, RuleCategory, RuleIssueSeverity } from "../types.js";

function isError(e: GuardianEvent): e is ErrorGuardianEvent {
  return e.category === "error";
}
function latest(events: GuardianEvent[]): GuardianEvent {
  return events[events.length - 1]!;
}

// ─── 1. High Error Rate ───────────────────────────────────────────────────────

export class HighErrorRateRule implements Rule {
  readonly id       = "high-error-rate";
  readonly title    = "High Error Rate";
  readonly category: RuleCategory = "error";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isError(current)) return null;

    const similar = events.slice(0, -1).filter(isError)
      .filter((e) => e.message === current.message);
    if (similar.length < 5) return null;

    return {
      issueType: "high_error_rate",
      description: `"${current.message.slice(0, 80)}" occurred ${similar.length + 1} times recently.`,
      affectedEventIds: [current.id, ...similar.map((e) => e.id)],
      data: { count: similar.length + 1, message: current.message },
      severity: similar.length >= 20 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Add try/catch or an ErrorBoundary around the failing code path.\n` +
      `2. Investigate why this error (seen ${String(match.data["count"])}×) is not being caught — check for missing null guards or async error handling.\n` +
      `3. Add a user-friendly fallback UI so the app remains usable after the error.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    return (
      `This error is occurring repeatedly in my app:\n\n` +
      `  "${String(match.data["message"])}"\n\n` +
      `It has been seen ${String(match.data["count"])} times recently.\n\n` +
      `Please:\n` +
      `1. Find all places in the codebase where this error could originate.\n` +
      `2. Add appropriate error handling (try/catch, optional chaining, null checks).\n` +
      `3. If this is inside a React component, wrap it in an ErrorBoundary.\n` +
      `4. Add a user-visible fallback so the UI doesn't break silently.`
    );
  }
}

// ─── 2. Unhandled Rejection ───────────────────────────────────────────────────

export class UnhandledRejectionRule implements Rule {
  readonly id       = "unhandled-rejection";
  readonly title    = "Unhandled Promise Rejection";
  readonly category: RuleCategory = "error";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isError(current) || current.kind !== "unhandled_rejection") return null;

    const related = events.slice(0, -1).filter(isError)
      .filter((e) => e.kind === "unhandled_rejection" && e.message === current.message);

    return {
      issueType: "unhandled_rejection",
      description: `Promise rejected without a catch handler: "${current.message.slice(0, 80)}". Seen ${related.length + 1} time(s).`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { message: current.message, occurrences: related.length + 1 },
      severity: related.length >= 3 ? "error" : "warning",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Add .catch(err => ...) to every Promise chain.\n` +
      `2. Use try/catch inside async functions.\n` +
      `3. Add a global fallback: window.addEventListener('unhandledrejection', handler).\n` +
      `4. Enable the ESLint rule: @typescript-eslint/no-floating-promises.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    return (
      `I have an unhandled promise rejection in my app:\n\n` +
      `  "${String(match.data["message"])}"\n\n` +
      `Please search the codebase for:\n` +
      `1. Promise chains missing .catch() — wrap them.\n` +
      `2. async functions missing try/catch — add error handling.\n` +
      `3. Any fire-and-forget async calls — make sure failures are handled.\n` +
      `4. Add a global handler: window.addEventListener('unhandledrejection', e => console.error(e.reason));\n` +
      `   as a safety net in the app entry point.`
    );
  }
}

// ─── 3. Chunk Load Error ──────────────────────────────────────────────────────

export class ChunkLoadErrorRule implements Rule {
  readonly id       = "chunk-load-error";
  readonly title    = "Chunk Load Error";
  readonly category: RuleCategory = "error";
  readonly severity: RuleIssueSeverity = "error";

  private isChunkError(e: ErrorGuardianEvent): boolean {
    return (
      e.errorType === "ChunkLoadError" ||
      e.message.includes("Loading chunk") ||
      e.message.includes("Failed to fetch dynamically imported module") ||
      e.message.includes("Importing a module script failed")
    );
  }

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isError(current) || !this.isChunkError(current)) return null;

    const related = events.slice(0, -1).filter(isError).filter((e) => this.isChunkError(e));

    return {
      issueType: "chunk_load_error",
      description: `Lazy-loaded JS chunk failed to load — likely a stale deployment. Seen ${related.length + 1} time(s).`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { message: current.message, occurrences: related.length + 1 },
      severity: related.length >= 3 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Force a full page reload when a chunk load error is caught:\n` +
      `   window.location.reload() inside a React error boundary or dynamic import catch.\n` +
      `2. Configure your CDN with proper Cache-Control: no-store for HTML, max-age for JS assets.\n` +
      `3. Consider a service worker that detects new deployments and notifies users.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    return (
      `My app is throwing chunk load errors after deployment:\n\n` +
      `  "${String(match.data["message"])}"\n\n` +
      `This happens when users have the old HTML cached after a new build is deployed.\n\n` +
      `Please:\n` +
      `1. Add a global chunk error handler that reloads the page once:\n` +
      `   Catch ChunkLoadError in the nearest ErrorBoundary and call window.location.reload().\n` +
      `2. Add a version check: fetch /version.json on interval; if changed, show a "New version available" banner.\n` +
      `3. Fix the Cache-Control headers:\n` +
      `   - HTML: Cache-Control: no-cache, no-store\n` +
      `   - JS/CSS with hash: Cache-Control: public, max-age=31536000, immutable`
    );
  }
}

// ─── 4. Error Spike ───────────────────────────────────────────────────────────

export class ErrorSpikeRule implements Rule {
  readonly id       = "error-spike";
  readonly title    = "Error Spike";
  readonly category: RuleCategory = "error";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isError(current)) return null;

    const now = new Date(current.timestamp).getTime();
    const windowErrors = events.slice(0, -1).filter(isError).filter((e) => {
      const age = now - new Date(e.timestamp).getTime();
      return age >= 0 && age <= 60_000;
    });

    if (windowErrors.length < 10) return null;

    const distinctMessages = new Set(windowErrors.map((e) => e.message)).size;
    return {
      issueType: "error_spike",
      description: `${windowErrors.length} errors (${distinctMessages} distinct) in the last 60 s — possible broken deployment or infra outage.`,
      affectedEventIds: [current.id, ...windowErrors.map((e) => e.id).slice(0, 20)],
      data: { count: windowErrors.length, distinctMessages },
      severity: windowErrors.length >= 30 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Check your deployment history — was a new release pushed recently?\n` +
      `2. Check whether the errors share a common root cause.\n` +
      `3. Consider rolling back the last deployment if errors are user-facing.\n` +
      `4. Set up alerting thresholds to be notified automatically next time.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    return (
      `My frontend application has a sudden error spike:\n` +
      `${String(match.data["count"])} errors (${String(match.data["distinctMessages"])} distinct messages) in 60 seconds.\n\n` +
      `Please:\n` +
      `1. Add an error rate alerting mechanism that triggers a Slack/email notification when errors exceed a threshold.\n` +
      `2. Add a circuit-breaker pattern for API calls so that when they start failing, the app falls back gracefully.\n` +
      `3. Add a global ErrorBoundary at the app root with a user-friendly error page.\n` +
      `4. Show me where the most fragile parts of the codebase are (missing error handling).`
    );
  }
}

// ─── 5. Recurring Cross-Session Error ────────────────────────────────────────

export class RecurringErrorRule implements Rule {
  readonly id       = "recurring-error";
  readonly title    = "Recurring Cross-Session Error";
  readonly category: RuleCategory = "error";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isError(current)) return null;

    const matching = events.slice(0, -1).filter(isError)
      .filter((e) => e.message === current.message && e.sessionId !== current.sessionId);

    const distinctSessions = new Set(matching.map((e) => e.sessionId)).size;
    if (distinctSessions < 3) return null;

    return {
      issueType: "recurring_cross_session_error",
      description: `"${current.message.slice(0, 80)}" appeared in ${distinctSessions} distinct user sessions — this is a systemic bug.`,
      affectedEventIds: [current.id, ...matching.map((e) => e.id).slice(0, 20)],
      data: { message: current.message, distinctSessions, totalOccurrences: matching.length + 1 },
      severity: distinctSessions >= 10 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Reproduce in a fresh browser session — this error is not user-specific.\n` +
      `2. Check whether it correlates with a specific page URL or user action.\n` +
      `3. Add the fix to the next release and verify error rate drops to zero.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    return (
      `A critical bug is affecting multiple users in my app.\n\n` +
      `Error: "${String(match.data["message"])}"\n` +
      `Affected sessions: ${String(match.data["distinctSessions"])}\n` +
      `Total occurrences: ${String(match.data["totalOccurrences"])}\n\n` +
      `Please:\n` +
      `1. Search the entire codebase for this error message or the code path that produces it.\n` +
      `2. Identify whether this is a null/undefined access, a network failure, or a logic error.\n` +
      `3. Fix the root cause — not just the symptom.\n` +
      `4. Add a unit test that would have caught this.\n` +
      `5. Add runtime validation (e.g. zod) for any external data that could cause this.`
    );
  }
}
