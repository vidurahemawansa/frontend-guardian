import type { GuardianEvent }         from "@frontend-guardian/types";
import type {
  AiAnalysisRequest,
  CursorPromptRequest,
  ExplainIssueRequest,
  ProjectHealthRequest,
  ExplainAudience,
} from "./AIProvider.js";
import type { RuleResult, RuleCategory } from "../engine/types.js";

// ─── Shared system prompt header ──────────────────────────────────────────────

const BASE_SYSTEM = (role: string) =>
  `You are ${role} working inside "Frontend Guardian", an AI-powered frontend monitoring system.\n` +
  `You receive structured data from a deterministic rule engine and enrich it with deeper insights.\n` +
  `ALWAYS respond with ONLY valid JSON matching the schema shown in the user message — no preamble, no explanation outside the JSON.`;

// ─── 1. analyzeIssues ────────────────────────────────────────────────────────

export function buildAnalyzeSystemPrompt(): string {
  return BASE_SYSTEM("a senior frontend engineer and performance specialist") +
    `\n\nYour response MUST match this JSON schema:\n` +
    `{\n` +
    `  "summary":            "<1–3 sentences for a dashboard card>",\n` +
    `  "rootCause":          "<most likely root cause, be specific>",\n` +
    `  "suggestedFix":       "<numbered step-by-step fix>",\n` +
    `  "confidence":         <0.0–1.0>,\n` +
    `  "affectedFiles":      ["<filename>"],\n` +
    `  "additionalInsights": "<optional markdown with deeper analysis>"\n` +
    `}\n\n` +
    `Rules:\n` +
    `- Reference actual function names, URLs, and values from the event data.\n` +
    `- Do not repeat rule-engine findings verbatim — add new insights.\n` +
    `- suggestedFix must be code-level and actionable.\n` +
    `- affectedFiles: infer from stack frames or URLs; return [] if unknown.\n` +
    `- confidence: 1.0 = certain, 0.5 = likely, 0.2 = speculative.`;
}

export function buildAnalyzeUserPrompt(req: AiAnalysisRequest): string {
  const { event, ruleResults, recentContext } = req;

  const evtBlock = formatEventBlock(event);
  const rulesBlock = ruleResults.length === 0
    ? "  (none — event passed all rules)"
    : ruleResults.map((r, i) =>
        `  [${i + 1}] ${r.ruleName ?? r.title} (${r.severity}) — ${r.issueType}\n` +
        `      ${r.description}`
      ).join("\n");

  const ctxBlock = recentContext.length === 0
    ? "  (no recent events)"
    : recentContext.slice(0, 8).map((e, i) =>
        `  [${i + 1}] ${e.category}/${(e as { kind?: string }).kind ?? "?"} — ` +
        `${(e as { message?: string }).message ?? e.name} @ ${e.timestamp}`
      ).join("\n");

  return (
    `=== TRIGGERING EVENT ===\n${evtBlock}\n\n` +
    `=== RULE ENGINE FINDINGS ===\n${rulesBlock}\n\n` +
    `=== RECENT CONTEXT (last 8 events) ===\n${ctxBlock}\n\n` +
    `Provide your analysis as JSON.`
  );
}

// ─── 2. generateCursorPrompt ─────────────────────────────────────────────────

export function buildCursorPromptSystemPrompt(): string {
  return BASE_SYSTEM("an expert Cursor AI prompt engineer and senior developer") +
    `\n\nYour response MUST match this JSON schema:\n` +
    `{\n` +
    `  "prompt":   "<full, copy-paste ready Cursor prompt>",\n` +
    `  "title":    "Fix: <brief issue title ≤ 60 chars>",\n` +
    `  "category": "<rule category>"\n` +
    `}\n\n` +
    `A great Cursor prompt:\n` +
    `- Opens with a concrete description of the problem (1–2 sentences).\n` +
    `- References specific file paths, function names, or URLs when available.\n` +
    `- Includes the exact error message or measured value.\n` +
    `- Gives numbered steps asking for specific code changes.\n` +
    `- Includes a before/after code example when possible.\n` +
    `- Ends by asking Cursor to show the full diff.\n` +
    `- Is 150–400 words — detailed enough to be useful, concise enough to be actionable.`;
}

export function buildCursorPromptUserPrompt(req: CursorPromptRequest): string {
  const { issue, event, projectContext } = req;
  const url = extractUrl(event);

  return (
    `Generate a Cursor AI prompt to fix this issue:\n\n` +
    `Rule:        ${issue.title}\n` +
    `Category:    ${issue.category}\n` +
    `Severity:    ${issue.severity}\n` +
    `Issue type:  ${issue.issueType}\n` +
    `Description: ${issue.description}\n` +
    `Recommendation: ${issue.recommendation}\n` +
    (url ? `URL / endpoint: ${url}\n` : "") +
    (projectContext ? `Project context: ${projectContext}\n` : "") +
    `\nEvent data:\n${formatEventBlock(event)}\n\n` +
    `Respond with JSON.`
  );
}

// ─── 3. explainIssue ─────────────────────────────────────────────────────────

const AUDIENCE_PERSONAS: Record<ExplainAudience, string> = {
  developer:      "a senior developer explaining a technical issue to a fellow engineer",
  manager:        "a technical lead explaining an issue to a non-coding engineering manager",
  "non-technical": "a support engineer explaining a website problem to a non-technical business stakeholder",
};

export function buildExplainSystemPrompt(audience: ExplainAudience): string {
  return BASE_SYSTEM(AUDIENCE_PERSONAS[audience]) +
    `\n\nAdjust vocabulary and depth for a "${audience}" audience.\n\n` +
    `Your response MUST match this JSON schema:\n` +
    `{\n` +
    `  "explanation": "<plain-language explanation for the audience (2–4 sentences)>",\n` +
    `  "impact":      "<what happens to real users if this is not fixed>",\n` +
    `  "urgency":     "<how soon this should be addressed and why>",\n` +
    `  "analogy":     "<optional: a real-world analogy that makes the issue relatable>"\n` +
    `}`;
}

export function buildExplainUserPrompt(req: ExplainIssueRequest): string {
  const { issue, event } = req;
  const url = extractUrl(event);

  return (
    `Explain this frontend issue:\n\n` +
    `Title:       ${issue.title}\n` +
    `Category:    ${issue.category}\n` +
    `Severity:    ${issue.severity}\n` +
    `Description: ${issue.description}\n` +
    `Recommended fix: ${issue.recommendation}\n` +
    (url ? `Where it occurred: ${url}\n` : "") +
    `\nRespond with JSON.`
  );
}

// ─── 4. summarizeProjectHealth ────────────────────────────────────────────────

export function buildHealthSystemPrompt(): string {
  return BASE_SYSTEM("a senior frontend performance consultant reviewing project monitoring data") +
    `\n\nYour response MUST match this JSON schema:\n` +
    `{\n` +
    `  "overallScore":      <0–100>,\n` +
    `  "grade":             "A" | "B" | "C" | "D" | "F",\n` +
    `  "summary":           "<2–4 sentence executive summary>",\n` +
    `  "topIssues":         ["<top issue 1>", "<top issue 2>", "<top issue 3>"],\n` +
    `  "positives":         ["<what is working well>"],\n` +
    `  "recommendations":   ["<prioritised action>"],\n` +
    `  "trend":             "improving" | "stable" | "degrading",\n` +
    `  "issuesByCategory":  { "<category>": <count> },\n` +
    `  "issuesBySeverity":  { "critical": N, "error": N, "warning": N, "info": N }\n` +
    `}\n\n` +
    `Scoring guide:\n` +
    `  90–100 → A: No critical/error issues, only minor warnings.\n` +
    `  75–89  → B: Some errors but no critical issues, being actively managed.\n` +
    `  60–74  → C: Multiple errors, at least one area needing urgent attention.\n` +
    `  40–59  → D: Critical issues present, user experience is significantly impacted.\n` +
    `  0–39   → F: Multiple critical issues, application is broken for many users.`;
}

export function buildHealthUserPrompt(req: ProjectHealthRequest): string {
  const { recentEvents, recentIssues, timeWindowMs } = req;

  const windowLabel = timeWindowMs >= 3_600_000
    ? `${(timeWindowMs / 3_600_000).toFixed(0)} hour(s)`
    : `${(timeWindowMs / 60_000).toFixed(0)} minute(s)`;

  // Aggregate counts
  const bySeverity = countBy(recentIssues, (i) => i.severity);
  const byCategory = countBy(recentIssues, (i) => i.category);
  const eventsByCategory = countBy(recentEvents, (e) => e.category);

  // Top 5 most frequent issue titles
  const titleCounts = countBy(recentIssues, (i) => i.title);
  const topTitles = Object.entries(titleCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([title, count]) => `  - ${title} (×${count})`)
    .join("\n");

  // Unique URLs affected
  const urls = new Set(recentEvents.map(extractUrl).filter(Boolean));

  return (
    `Analyse project health over the last ${windowLabel}:\n\n` +
    `Events received:   ${recentEvents.length}\n` +
    `Issues detected:   ${recentIssues.length}\n` +
    `Pages/endpoints:   ${urls.size} unique URLs affected\n\n` +
    `Issues by severity:\n` +
    `  critical: ${bySeverity["critical"] ?? 0}\n` +
    `  error:    ${bySeverity["error"]    ?? 0}\n` +
    `  warning:  ${bySeverity["warning"]  ?? 0}\n` +
    `  info:     ${bySeverity["info"]     ?? 0}\n\n` +
    `Issues by category:\n` +
    Object.entries(byCategory).map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\n\n" +
    `Events by category:\n` +
    Object.entries(eventsByCategory).map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\n\n" +
    (topTitles ? `Top recurring issues:\n${topTitles}\n\n` : "") +
    `Respond with JSON.`
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function formatEventBlock(event: GuardianEvent): string {
  const e = event as Record<string, unknown>;
  let out =
    `  id:        ${event.id}\n` +
    `  category:  ${event.category}\n` +
    `  kind:      ${String(e["kind"] ?? "?")}\n` +
    `  name:      ${event.name}\n` +
    `  timestamp: ${event.timestamp}\n`;

  if (e["message"])  out += `  message:   ${String(e["message"])}\n`;
  if (e["value"])    out += `  value:     ${String(e["value"])}\n`;

  const url = extractUrl(event);
  if (url)           out += `  url:       ${url}\n`;

  const stack = (e["stack"] as Array<{ filename?: string; function?: string; lineno?: number }> | undefined);
  if (stack?.length) {
    out += `  stack:\n` + stack.slice(0, 4).map(
      (f) => `    at ${f.function ?? "?"} (${f.filename ?? "?"}:${f.lineno ?? "?"})`
    ).join("\n") + "\n";
  }
  return out;
}

function extractUrl(event: GuardianEvent): string {
  const e = event as Record<string, unknown>;
  return String(
    e["url"] ??
    (e["data"] as Record<string, unknown> | undefined)?.["fetchUrl"] ??
    (e["context"] as Record<string, unknown> | undefined)?.["fetchUrl"] ??
    ""
  );
}

function countBy<T>(arr: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of arr) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// Keep legacy export so existing code that imports buildSystemPrompt still compiles
export const buildSystemPrompt = buildAnalyzeSystemPrompt;
export const buildUserPrompt   = buildAnalyzeUserPrompt;
