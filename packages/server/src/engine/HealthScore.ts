import type { RuleResult, RuleCategory, RuleIssueSeverity } from "./types.js";

// ─── Output types ─────────────────────────────────────────────────────────────

export type CategoryKey = "errors" | "performance" | "scalability" | "architecture";

export type CategoryStatus =
  | "excellent"   // score ≥ 95, no issues
  | "good"        // score ≥ 85, no critical/error
  | "fair"        // score ≥ 70, has warnings
  | "poor"        // score ≥ 50, has errors
  | "critical";   // score < 50, has critical issues

export interface SeverityCounts {
  critical: number;
  error:    number;
  warning:  number;
  info:     number;
}

export interface CategoryIssueGroup {
  ruleId:          string;
  title:           string;
  category:        RuleCategory;
  severity:        RuleIssueSeverity;
  issueType:       string;
  description:     string;
  recommendation:  string;
  occurrences:     number;
  affectedEventIds: string[];
}

export interface CategoryScore {
  /** 0–100 */
  score:       number;
  /** Letter grade for this category */
  grade:       "A" | "B" | "C" | "D" | "F";
  /** Status drives dashboard color and label */
  status:      CategoryStatus;
  /** Human-readable label e.g. "0 Critical", "2 Medium", "4 Suggestions", "Excellent" */
  label:       string;
  /** Emoji indicator */
  emoji:       "🟢" | "🟡" | "🟠" | "🔴" | "🔵";
  counts:      SeverityCounts;
  /** Top issues de-duplicated and sorted by severity */
  topIssues:   CategoryIssueGroup[];
}

export interface HealthScoreCard {
  /** Weighted overall score 0–100 */
  overall:    number;
  /** Overall letter grade */
  grade:      "A" | "B" | "C" | "D" | "F";
  /** Whether health is improving, stable, or degrading */
  trend:      "improving" | "stable" | "degrading";
  categories: Record<CategoryKey, CategoryScore>;
  /** ISO-8601 timestamp of when the score was computed */
  computedAt: string;
  windowMs:   number;
  eventCount: number;
  issueCount: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** How many points each severity deducts from a category score */
const DEDUCTIONS: Record<RuleIssueSeverity, number> = {
  critical: 25,
  error:    12,
  warning:   4,
  info:      1,
};

/** Category weights that sum to 1.0 */
const WEIGHTS: Record<CategoryKey, number> = {
  errors:       0.35,
  performance:  0.30,
  scalability:  0.20,
  architecture: 0.15,
};

/** Which rule categories map to which health category */
const RULE_TO_HEALTH: Record<RuleCategory, CategoryKey> = {
  error:        "errors",
  performance:  "performance",
  scalability:  "scalability",
  react:        "architecture",
  angular:      "architecture",
  nextjs:       "architecture",
};

// ─── Calculator ───────────────────────────────────────────────────────────────

/**
 * HealthScoreEngine — pure, synchronous score calculator.
 *
 * Takes a flat list of RuleResult objects (de-duplicated or not) and
 * produces a HealthScoreCard with per-category scores and issue groups.
 *
 * No stores, no AI, no async — just math.
 */
export class HealthScoreEngine {
  /**
   * Compute the health score card.
   *
   * @param issues      All rule-engine findings in the time window
   * @param eventCount  Total events in the same window (for context)
   * @param windowMs    Time window covered by the data
   * @param prevScore   Optional previous overall score for trend calculation
   */
  compute(
    issues:     RuleResult[],
    eventCount: number,
    windowMs:   number,
    prevScore?: number,
  ): HealthScoreCard {
    // Group issues by health category
    const grouped = groupByHealthCategory(issues);

    // Score each category
    const categories: Record<CategoryKey, CategoryScore> = {
      errors:       this.scoreCategory("errors",       grouped.errors       ?? []),
      performance:  this.scoreCategory("performance",  grouped.performance  ?? []),
      scalability:  this.scoreCategory("scalability",  grouped.scalability  ?? []),
      architecture: this.scoreCategory("architecture", grouped.architecture ?? []),
    };

    // Weighted overall
    const overall = Math.round(
      Object.entries(WEIGHTS).reduce(
        (sum, [key, weight]) => sum + categories[key as CategoryKey].score * weight,
        0,
      )
    );

    return {
      overall,
      grade:      toGrade(overall),
      trend:      deriveTrend(overall, prevScore),
      categories,
      computedAt: new Date().toISOString(),
      windowMs,
      eventCount,
      issueCount: issues.length,
    };
  }

  private scoreCategory(key: CategoryKey, issues: RuleResult[]): CategoryScore {
    const counts = countBySeverity(issues);
    const deduction = Math.min(100,
      counts.critical * DEDUCTIONS.critical +
      counts.error    * DEDUCTIONS.error    +
      counts.warning  * DEDUCTIONS.warning  +
      counts.info     * DEDUCTIONS.info
    );
    const score = Math.max(0, 100 - deduction);

    return {
      score,
      grade:    toGrade(score),
      status:   toStatus(score, counts),
      label:    toLabel(counts),
      emoji:    toEmoji(counts, key),
      counts,
      topIssues: deduplicateAndSort(issues),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupByHealthCategory(issues: RuleResult[]): Partial<Record<CategoryKey, RuleResult[]>> {
  const out: Partial<Record<CategoryKey, RuleResult[]>> = {};
  for (const issue of issues) {
    const key = RULE_TO_HEALTH[issue.category];
    if (!out[key]) out[key] = [];
    out[key]!.push(issue);
  }
  return out;
}

function countBySeverity(issues: RuleResult[]): SeverityCounts {
  return {
    critical: issues.filter((i) => i.severity === "critical").length,
    error:    issues.filter((i) => i.severity === "error").length,
    warning:  issues.filter((i) => i.severity === "warning").length,
    info:     issues.filter((i) => i.severity === "info").length,
  };
}

function toGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 55) return "D";
  return "F";
}

function toStatus(score: number, counts: SeverityCounts): CategoryStatus {
  if (counts.critical > 0)  return "critical";
  if (counts.error    > 0)  return "poor";
  if (counts.warning  > 0)  return "fair";
  if (score >= 95)          return "excellent";
  return "good";
}

function toLabel(counts: SeverityCounts): string {
  if (counts.critical > 0) return `${counts.critical} Critical`;
  if (counts.error    > 0) return `${counts.error} Issue${counts.error > 1 ? "s" : ""}`;
  const suggestions = counts.warning + counts.info;
  if (suggestions     > 0) return `${suggestions} Suggestion${suggestions > 1 ? "s" : ""}`;
  return "Excellent";
}

function toEmoji(
  counts: SeverityCounts,
  key: CategoryKey,
): "🟢" | "🟡" | "🟠" | "🔴" | "🔵" {
  if (counts.critical > 0)                  return "🔴";
  if (counts.error    > 0)                  return "🟠";
  if (counts.warning  > 0 && key === "scalability") return "🔵";
  if (counts.warning  > 0)                  return "🟡";
  if (counts.info     > 0)                  return "🔵";
  return "🟢";
}

function deriveTrend(
  current: number,
  prev?: number,
): "improving" | "stable" | "degrading" {
  if (prev === undefined) return "stable";
  const delta = current - prev;
  if (delta >  5) return "improving";
  if (delta < -5) return "degrading";
  return "stable";
}

/**
 * Merge issues with the same ruleId (count occurrences),
 * then sort: critical first, then by occurrence count desc.
 */
function deduplicateAndSort(issues: RuleResult[]): CategoryIssueGroup[] {
  const map = new Map<string, CategoryIssueGroup>();

  for (const issue of issues) {
    const existing = map.get(issue.ruleId);
    if (existing) {
      existing.occurrences++;
      existing.affectedEventIds.push(...issue.affectedEventIds);
    } else {
      map.set(issue.ruleId, {
        ruleId:           issue.ruleId,
        title:            issue.title,
        category:         issue.category,
        severity:         issue.severity,
        issueType:        issue.issueType,
        description:      issue.description,
        recommendation:   issue.recommendation,
        occurrences:      1,
        affectedEventIds: [...issue.affectedEventIds],
      });
    }
  }

  const SEVERITY_ORDER: Record<RuleIssueSeverity, number> = {
    critical: 0, error: 1, warning: 2, info: 3,
  };

  return [...map.values()].sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return sev !== 0 ? sev : b.occurrences - a.occurrences;
  });
}
