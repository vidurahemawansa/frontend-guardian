import type { GuardianEvent } from "@frontend-guardian/types";

// ─── Categories ───────────────────────────────────────────────────────────────

export type RuleCategory =
  | "error"
  | "performance"
  | "scalability"
  | "react"
  | "angular"
  | "nextjs";

export type RuleIssueSeverity = "info" | "warning" | "error" | "critical";

// ─── Detection result ─────────────────────────────────────────────────────────

/**
 * Raw detection data returned by `rule.detect()`.
 * Does NOT yet contain the recommendation or Cursor prompt —
 * those are built by the engine by calling the rule's methods.
 */
export interface RuleMatch {
  issueType: string;
  description: string;
  affectedEventIds: string[];
  data: Record<string, unknown>;
  /** Override the rule's default severity when the evidence is stronger or weaker. */
  severity?: RuleIssueSeverity;
}

// ─── Full result (built by the engine) ───────────────────────────────────────

export interface RuleResult {
  ruleId:           string;
  title:            string;
  category:         RuleCategory;
  severity:         RuleIssueSeverity;
  issueType:        string;
  description:      string;
  recommendation:   string;
  cursorPrompt:     string;
  affectedEventIds: string[];
  data:             Record<string, unknown>;
}

// ─── Rule interface ───────────────────────────────────────────────────────────

export interface Rule {
  /** Globally unique identifier, e.g. "react-missing-key" */
  readonly id: string;

  /** Human-readable title shown in the dashboard */
  readonly title: string;

  /** Rule category — used for grouping and filtering */
  readonly category: RuleCategory;

  /**
   * Default severity. Rules may override per-detection in `RuleMatch.severity`
   * when the evidence changes the urgency level.
   */
  readonly severity: RuleIssueSeverity;

  /**
   * Core detection logic.
   *
   * Receives the full recent-events window.
   * Convention: `events[events.length - 1]` is the latest (triggering) event;
   *             `events.slice(0, -1)` is the prior history.
   *
   * Return a `RuleMatch` when an issue is detected, or `null` to pass.
   */
  detect(events: GuardianEvent[]): RuleMatch | null;

  /**
   * Returns a concise, actionable fix recommendation for this rule.
   * Receives the match so the message can be context-specific.
   */
  recommendation(match: RuleMatch): string;

  /**
   * Generates a ready-to-paste Cursor AI prompt that a developer can use to
   * automatically fix the detected issue.
   */
  generateCursorPrompt(match: RuleMatch): string;
}
