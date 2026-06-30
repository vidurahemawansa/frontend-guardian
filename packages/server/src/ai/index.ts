/**
 * AI module public surface.
 *
 * The rest of the application MUST import ONLY from this file.
 * No code outside this folder should ever reference a concrete provider class.
 *
 * Usage:
 *   import type { AiProvider } from "../ai/index.js"     // type
 *   import { createAiProvider } from "../ai/index.js"    // factory
 */

import type { AiProvider }   from "./AIProvider.js";
import type { ServerConfig } from "../config.js";

// ── Public types — re-exported so callers never import from AIProvider.ts ────
export type {
  AiProvider,
  AiAnalysisRequest,   AiAnalysisResponse,
  CursorPromptRequest, CursorPromptResponse,
  ExplainIssueRequest, ExplainIssueResponse,
  ProjectHealthRequest,ProjectHealthResponse,
  ExplainAudience, HealthGrade, HealthTrend,
} from "./AIProvider.js";

// ── Internal (not exported) ───────────────────────────────────────────────────
import { OpenAIProvider }  from "./OpenAIProvider.js";
import { ClaudeProvider }  from "./ClaudeProvider.js";
import { GeminiProvider }  from "./GeminiProvider.js";
import { OllamaProvider }  from "./OllamaProvider.js";

// ── NullProvider (exported so tests can use it explicitly) ────────────────────

class NullProvider implements AiProvider {
  readonly name      = "none";
  readonly available = false;

  private static readonly disabled: import("./AIProvider.js").AiAnalysisResponse = {
    summary:      "AI analysis is not enabled.",
    rootCause:    "Set AI_ENABLED=true and configure AI_PROVIDER in .env.",
    suggestedFix: "Use the rule-engine results for immediate, synchronous findings.",
    confidence:   0, affectedFiles: [],
  };

  async analyzeIssues()          { return NullProvider.disabled; }
  async generateCursorPrompt(r: import("./AIProvider.js").CursorPromptRequest) {
    return { prompt: r.issue.cursorPrompt, title: `Fix: ${r.issue.title}`, category: r.issue.category };
  }
  async explainIssue(r: import("./AIProvider.js").ExplainIssueRequest) {
    return {
      explanation: r.issue.description,
      impact:      "This issue may degrade user experience or cause application errors.",
      urgency:     r.issue.severity === "critical" ? "Fix immediately." : "Fix in the current sprint.",
    };
  }
  async summarizeProjectHealth() {
    return {
      overallScore: 50, grade: "C" as const,
      summary:      "AI is not enabled. Enable a provider to receive health summaries.",
      topIssues: [], positives: [],
      recommendations: ["Set AI_ENABLED=true in .env."],
      trend: "stable" as const, issuesByCategory: {}, issuesBySeverity: {},
    };
  }
}

export { NullProvider };

// ── Factory — the single entry point for all provider creation ────────────────

/**
 * Creates the correct AiProvider based on server config.
 * Returns NullProvider when AI is disabled or misconfigured.
 *
 * This is the ONLY place in the entire codebase that instantiates
 * a concrete provider. Everything else works against the AiProvider interface.
 */
export function createAiProvider(config: ServerConfig): AiProvider {
  if (!config.aiEnabled) return new NullProvider();

  switch (config.aiProvider) {
    case "openai":
      return new OpenAIProvider({
        apiKey: config.aiApiKey, model: config.aiModel || undefined,
        maxTokens: config.aiMaxTokens, timeoutMs: config.aiTimeoutMs,
      });
    case "claude":
      return new ClaudeProvider({
        apiKey: config.aiApiKey, model: config.aiModel || undefined,
        maxTokens: config.aiMaxTokens, timeoutMs: config.aiTimeoutMs,
      });
    case "gemini":
      return new GeminiProvider({
        apiKey: config.aiApiKey, model: config.aiModel || undefined,
        maxTokens: config.aiMaxTokens, timeoutMs: config.aiTimeoutMs,
      });
    case "ollama":
      return new OllamaProvider({
        baseUrl: config.ollamaBaseUrl, model: config.aiModel || undefined,
        maxTokens: config.aiMaxTokens, timeoutMs: config.aiTimeoutMs,
      });
    case "none":
    default:
      return new NullProvider();
  }
}
