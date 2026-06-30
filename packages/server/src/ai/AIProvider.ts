import type { GuardianEvent } from "@frontend-guardian/types";
import type { RuleResult, RuleCategory, RuleIssueSeverity } from "../engine/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// analyzeIssues()
// ─────────────────────────────────────────────────────────────────────────────

export interface AiAnalysisRequest {
  /** The event being analysed */
  event: GuardianEvent;
  /** Synchronous findings already produced by the Rule Engine */
  ruleResults: RuleResult[];
  /** Recent related events for context (oldest → newest) */
  recentContext: GuardianEvent[];
}

export interface AiAnalysisResponse {
  /** 1–3 sentence summary for a dashboard card */
  summary: string;
  /** Most probable root cause */
  rootCause: string;
  /** Numbered, actionable fix steps */
  suggestedFix: string;
  /** 0.0 (speculation) → 1.0 (certain) */
  confidence: number;
  /** Source files likely involved, inferred from stack / URLs */
  affectedFiles: string[];
  /** Optional extended markdown with deeper analysis or code examples */
  additionalInsights?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateCursorPrompt()
// ─────────────────────────────────────────────────────────────────────────────

export interface CursorPromptRequest {
  /** The specific issue to generate a prompt for */
  issue: RuleResult;
  /** The event that triggered the issue */
  event: GuardianEvent;
  /**
   * Optional description of the project so the prompt can be more specific.
   * e.g. "Next.js 14 e-commerce app using Prisma and Tailwind"
   */
  projectContext?: string;
}

export interface CursorPromptResponse {
  /** The full, ready-to-paste Cursor AI prompt */
  prompt: string;
  /** Short title for display: "Fix: <issue title>" */
  title: string;
  /** Rule category for grouping */
  category: RuleCategory;
}

// ─────────────────────────────────────────────────────────────────────────────
// explainIssue()
// ─────────────────────────────────────────────────────────────────────────────

export type ExplainAudience = "developer" | "manager" | "non-technical";

export interface ExplainIssueRequest {
  /** The issue to explain */
  issue: RuleResult;
  /** The event that triggered the issue */
  event: GuardianEvent;
  /** Target audience — controls vocabulary and depth. Default: "developer" */
  audience?: ExplainAudience;
}

export interface ExplainIssueResponse {
  /** Plain-language explanation appropriate for the requested audience */
  explanation: string;
  /** What happens to users if this is not fixed */
  impact: string;
  /** How urgently this should be addressed */
  urgency: string;
  /** Optional real-world analogy to make the issue relatable */
  analogy?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// summarizeProjectHealth()
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectHealthRequest {
  /** Recent events from the store (oldest → newest) */
  recentEvents: GuardianEvent[];
  /** All rule-engine findings within the time window */
  recentIssues: RuleResult[];
  /** How many ms the data covers (e.g. 3_600_000 = last hour) */
  timeWindowMs: number;
}

export type HealthGrade = "A" | "B" | "C" | "D" | "F";
export type HealthTrend = "improving" | "stable" | "degrading";

export interface ProjectHealthResponse {
  /** Numeric score 0 (critical) → 100 (excellent) */
  overallScore: number;
  /** Letter grade derived from overallScore */
  grade: HealthGrade;
  /** 2–4 sentence executive summary */
  summary: string;
  /** Top 3 issues that need the most attention */
  topIssues: string[];
  /** Things that are working well */
  positives: string[];
  /** Prioritised, actionable recommendations */
  recommendations: string[];
  /** Whether things are getting better, staying the same, or getting worse */
  trend: HealthTrend;
  /** Breakdown of issue counts by category */
  issuesByCategory: Partial<Record<RuleCategory, number>>;
  /** Breakdown of issue counts by severity */
  issuesBySeverity: Partial<Record<RuleIssueSeverity, number>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// AiProvider interface — the ONLY type the rest of the app imports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every AI provider must implement this interface.
 *
 * Design rules:
 * - Every method MUST resolve, never reject.
 *   On any error, return a graceful degraded response using `failedResponse()`.
 * - `available` reflects whether the provider is configured and ready.
 * - The factory in `index.ts` is the ONLY place that instantiates providers.
 *   All other code depends on this interface only.
 */
export interface AiProvider {
  /** Human-readable identifier, e.g. "openai" | "claude" | "gemini" | "ollama" | "none" */
  readonly name: string;
  /** True when the provider is configured and ready to accept requests */
  readonly available: boolean;

  /**
   * Deep-analyse a Guardian event alongside the rule-engine findings.
   * Returns root-cause analysis, suggested fix, and confidence score.
   */
  analyzeIssues(request: AiAnalysisRequest): Promise<AiAnalysisResponse>;

  /**
   * Generate a rich, ready-to-paste Cursor AI prompt to fix a specific issue.
   * More context-specific than the rule engine's static template prompt.
   */
  generateCursorPrompt(request: CursorPromptRequest): Promise<CursorPromptResponse>;

  /**
   * Explain a single issue in plain language for the requested audience.
   * Developers get technical details; managers get business impact.
   */
  explainIssue(request: ExplainIssueRequest): Promise<ExplainIssueResponse>;

  /**
   * Summarise the overall health of the frontend project based on
   * recent events and accumulated findings.
   */
  summarizeProjectHealth(request: ProjectHealthRequest): Promise<ProjectHealthResponse>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers — imported by every provider implementation
// ─────────────────────────────────────────────────────────────────────────────

/** Strip markdown code fences and parse LLM JSON output. */
export function parseJson<T extends Record<string, unknown>>(raw: string): T | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

export function failedAnalysis(reason: string): AiAnalysisResponse {
  return {
    summary:      "AI analysis could not be completed.",
    rootCause:    reason,
    suggestedFix: "Review the rule-engine findings above. Check AI provider config and API key.",
    confidence:   0,
    affectedFiles: [],
  };
}

export function failedCursorPrompt(issue: RuleResult): CursorPromptResponse {
  return {
    prompt:   issue.cursorPrompt,  // fall back to rule engine's static prompt
    title:    `Fix: ${issue.title}`,
    category: issue.category,
  };
}

export function failedExplain(issue: RuleResult): ExplainIssueResponse {
  return {
    explanation: issue.description,
    impact:      "This issue may degrade user experience or cause application errors.",
    urgency:     issue.severity === "critical" ? "Fix immediately."
               : issue.severity === "error"    ? "Fix in the current sprint."
               : "Address in the next planned maintenance window.",
  };
}

export function failedHealth(): ProjectHealthResponse {
  return {
    overallScore:      50,
    grade:             "C",
    summary:           "Project health could not be assessed — AI provider is unavailable.",
    topIssues:         [],
    positives:         [],
    recommendations:   ["Enable an AI provider to receive health summaries."],
    trend:             "stable",
    issuesByCategory:  {},
    issuesBySeverity:  {},
  };
}
