/**
 * BaseProvider — shared boilerplate for HTTP-based AI providers.
 *
 * Concrete providers extend this class and implement `callApi()`,
 * which handles the vendor-specific HTTP request and returns the raw text.
 * All JSON parsing, error handling, and fallback logic lives here.
 *
 * This file is internal to the `ai/` module and MUST NOT be imported
 * anywhere outside it.
 */

import type {
  AiProvider,
  AiAnalysisRequest,   AiAnalysisResponse,
  CursorPromptRequest, CursorPromptResponse,
  ExplainIssueRequest, ExplainIssueResponse,
  ProjectHealthRequest,ProjectHealthResponse,
} from "./AIProvider.js";

import {
  parseJson,
  failedAnalysis,
  failedCursorPrompt,
  failedExplain,
  failedHealth,
} from "./AIProvider.js";

import {
  buildAnalyzeSystemPrompt,  buildAnalyzeUserPrompt,
  buildCursorPromptSystemPrompt, buildCursorPromptUserPrompt,
  buildExplainSystemPrompt, buildExplainUserPrompt,
  buildHealthSystemPrompt,  buildHealthUserPrompt,
} from "./prompt.js";

// ─── Abstract base ────────────────────────────────────────────────────────────

export abstract class BaseProvider implements AiProvider {
  abstract readonly name:      string;
  abstract readonly available: boolean;

  protected abstract callApi(
    systemPrompt: string,
    userPrompt:   string,
    opts: { maxTokens: number; timeoutMs: number; temperature?: number }
  ): Promise<string>;

  // ── 1. analyzeIssues ───────────────────────────────────────────────────────

  async analyzeIssues(req: AiAnalysisRequest): Promise<AiAnalysisResponse> {
    try {
      const raw = await this.callApi(
        buildAnalyzeSystemPrompt(),
        buildAnalyzeUserPrompt(req),
        { maxTokens: this.maxTokens, timeoutMs: this.timeoutMs, temperature: 0.2 }
      );
      const obj = parseJson<Record<string, unknown>>(raw);
      if (!obj) return failedAnalysis(`Could not parse response: ${raw.slice(0, 200)}`);
      return {
        summary:            String(obj["summary"]      ?? ""),
        rootCause:          String(obj["rootCause"]    ?? ""),
        suggestedFix:       String(obj["suggestedFix"] ?? ""),
        confidence:         typeof obj["confidence"] === "number" ? obj["confidence"] : 0.5,
        affectedFiles:      Array.isArray(obj["affectedFiles"])
          ? (obj["affectedFiles"] as unknown[]).map(String) : [],
        additionalInsights: typeof obj["additionalInsights"] === "string"
          ? obj["additionalInsights"] : undefined,
      };
    } catch (err) {
      return failedAnalysis(String(err));
    }
  }

  // ── 2. generateCursorPrompt ────────────────────────────────────────────────

  async generateCursorPrompt(req: CursorPromptRequest): Promise<CursorPromptResponse> {
    try {
      const raw = await this.callApi(
        buildCursorPromptSystemPrompt(),
        buildCursorPromptUserPrompt(req),
        { maxTokens: this.maxTokens, timeoutMs: this.timeoutMs, temperature: 0.3 }
      );
      const obj = parseJson<Record<string, unknown>>(raw);
      if (!obj) return failedCursorPrompt(req.issue);
      return {
        prompt:   String(obj["prompt"]   ?? req.issue.cursorPrompt),
        title:    String(obj["title"]    ?? `Fix: ${req.issue.title}`),
        category: (obj["category"] as CursorPromptResponse["category"]) ?? req.issue.category,
      };
    } catch (err) {
      console.error(`[${this.name}] generateCursorPrompt failed:`, err);
      return failedCursorPrompt(req.issue);
    }
  }

  // ── 3. explainIssue ────────────────────────────────────────────────────────

  async explainIssue(req: ExplainIssueRequest): Promise<ExplainIssueResponse> {
    const audience = req.audience ?? "developer";
    try {
      const raw = await this.callApi(
        buildExplainSystemPrompt(audience),
        buildExplainUserPrompt(req),
        { maxTokens: 512, timeoutMs: this.timeoutMs, temperature: 0.4 }
      );
      const obj = parseJson<Record<string, unknown>>(raw);
      if (!obj) return failedExplain(req.issue);
      return {
        explanation: String(obj["explanation"] ?? ""),
        impact:      String(obj["impact"]      ?? ""),
        urgency:     String(obj["urgency"]     ?? ""),
        analogy:     typeof obj["analogy"] === "string" ? obj["analogy"] : undefined,
      };
    } catch (err) {
      console.error(`[${this.name}] explainIssue failed:`, err);
      return failedExplain(req.issue);
    }
  }

  // ── 4. summarizeProjectHealth ──────────────────────────────────────────────

  async summarizeProjectHealth(req: ProjectHealthRequest): Promise<ProjectHealthResponse> {
    try {
      const raw = await this.callApi(
        buildHealthSystemPrompt(),
        buildHealthUserPrompt(req),
        { maxTokens: 1024, timeoutMs: this.timeoutMs, temperature: 0.2 }
      );
      const obj = parseJson<Record<string, unknown>>(raw);
      if (!obj) return failedHealth();
      return {
        overallScore:     typeof obj["overallScore"] === "number" ? obj["overallScore"] : 50,
        grade:            (obj["grade"] as ProjectHealthResponse["grade"]) ?? "C",
        summary:          String(obj["summary"]   ?? ""),
        topIssues:        Array.isArray(obj["topIssues"])     ? (obj["topIssues"] as unknown[]).map(String)     : [],
        positives:        Array.isArray(obj["positives"])     ? (obj["positives"] as unknown[]).map(String)     : [],
        recommendations:  Array.isArray(obj["recommendations"])? (obj["recommendations"] as unknown[]).map(String): [],
        trend:            (obj["trend"] as ProjectHealthResponse["trend"]) ?? "stable",
        issuesByCategory: (obj["issuesByCategory"] as ProjectHealthResponse["issuesByCategory"]) ?? {},
        issuesBySeverity: (obj["issuesBySeverity"] as ProjectHealthResponse["issuesBySeverity"]) ?? {},
      };
    } catch (err) {
      console.error(`[${this.name}] summarizeProjectHealth failed:`, err);
      return failedHealth();
    }
  }

  // ── Subclass must set these ────────────────────────────────────────────────
  protected abstract maxTokens: number;
  protected abstract timeoutMs: number;
}
