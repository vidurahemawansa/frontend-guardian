import type { GuardianEvent }            from "@frontend-guardian/types";
import type { AiProvider }               from "../ai/index.js";
import type {
  CursorPromptResponse,
  ExplainIssueResponse,
  ExplainAudience,
  ProjectHealthResponse,
} from "../ai/index.js";
import type { AnalysisRecord }           from "../store/AnalysisStore.js";
import { EventStore }                    from "../store/EventStore.js";
import { AnalysisStore }                 from "../store/AnalysisStore.js";
import { RuleEngine }                    from "../engine/RuleEngine.js";
import { HealthScoreEngine }             from "../engine/HealthScore.js";
import type { HealthScoreCard, CategoryKey } from "../engine/HealthScore.js";
import { config }                        from "../config.js";

const healthScoreEngine = new HealthScoreEngine();

/**
 * AnalysisPipeline — the single orchestrator of the full processing flow.
 *
 * It depends ONLY on the AiProvider interface, never on a concrete provider.
 * The factory in ai/index.ts decides which provider is used at startup.
 *
 * Methods:
 *   process()               → store + rule engine + (async) AI analysis
 *   processBatch()          → process multiple events
 *   explainIssue()          → plain-language explanation for any stored issue
 *   generateCursorPrompt()  → rich Cursor prompt for any stored issue
 *   getProjectHealth()      → overall health summary for the last N ms
 */
export class AnalysisPipeline {
  constructor(
    private readonly eventStore:    EventStore,
    private readonly analysisStore: AnalysisStore,
    private readonly ruleEngine:    RuleEngine,
    private readonly aiProvider:    AiProvider,   // ← interface only, never a concrete class
  ) {}

  // ─── 1. process / processBatch ─────────────────────────────────────────────

  process(event: GuardianEvent, sessionId: string): AnalysisRecord {
    // Store
    this.eventStore.save(event, sessionId);

    // Build events window: history (oldest→newest) + current at the end
    const history = this.eventStore
      .recent(config.ruleContextWindow)
      .map((s) => s.event)
      .filter((e) => e.id !== event.id)
      .reverse();

    const eventsWindow = [...history, event];

    // Rule Engine (synchronous)
    const ruleStart = performance.now();
    const { issues } = this.ruleEngine.run(eventsWindow);
    const ruleMs     = Math.round((performance.now() - ruleStart) * 100) / 100;

    // Persist initial record immediately
    const now     = new Date().toISOString();
    const aiWillRun = this.aiProvider.available;

    const record: AnalysisRecord = {
      eventId:          event.id,
      status:           aiWillRun ? "ai_pending"
                      : issues.length === 0 ? "ai_disabled" : "rule_complete",
      ruleResults:      issues,
      aiAnalysis:       null,
      ruleProcessingMs: ruleMs,
      aiProcessingMs:   null,
      createdAt:        now,
      updatedAt:        now,
    };
    this.analysisStore.save(record);

    // Fire-and-forget AI deep analysis
    if (aiWillRun) {
      const aiStart = performance.now();
      this.aiProvider
        .analyzeIssues({ event, ruleResults: issues, recentContext: history.slice(-10) })
        .then((aiAnalysis) => {
          this.analysisStore.patch(event.id, {
            status:         "ai_complete",
            aiAnalysis,
            aiProcessingMs: Math.round(performance.now() - aiStart),
          });
        })
        .catch((err) => {
          console.error("[AnalysisPipeline] AI analyzeIssues error:", err);
          this.analysisStore.patch(event.id, {
            status:         "ai_failed",
            aiProcessingMs: Math.round(performance.now() - aiStart),
          });
        });
    }

    return record;
  }

  processBatch(events: GuardianEvent[], sessionId: string): AnalysisRecord[] {
    return events.map((e) => this.process(e, sessionId));
  }

  // ─── 2. explainIssue ───────────────────────────────────────────────────────

  /**
   * Explain a specific rule-engine finding in plain language.
   * Looks up the event and issue by id, then calls aiProvider.explainIssue().
   * Falls back gracefully when the issue is not found or AI is unavailable.
   */
  async explainIssue(
    eventId:  string,
    ruleId:   string,
    audience: ExplainAudience = "developer"
  ): Promise<ExplainIssueResponse & { fromAi: boolean }> {
    const stored = this.analysisStore.getByEventId(eventId);
    const issue  = stored?.ruleResults.find((r) => r.ruleId === ruleId);

    if (!stored || !issue) {
      return {
        explanation: "Issue not found.",
        impact:      "Unknown.",
        urgency:     "Unknown.",
        fromAi:      false,
      };
    }

    const eventStored = this.eventStore.getById(eventId);
    if (!eventStored) {
      return {
        explanation: issue.description,
        impact:      "Event record not found.",
        urgency:     "Unknown.",
        fromAi:      false,
      };
    }

    const result = await this.aiProvider.explainIssue({
      issue, event: eventStored.event, audience,
    });

    return { ...result, fromAi: this.aiProvider.available };
  }

  // ─── 3. generateCursorPrompt ───────────────────────────────────────────────

  /**
   * Generate a rich, AI-powered Cursor prompt for a specific issue.
   * Falls back to the rule engine's static template prompt when AI is off.
   */
  async generateCursorPrompt(
    eventId:        string,
    ruleId:         string,
    projectContext?: string
  ): Promise<CursorPromptResponse & { fromAi: boolean }> {
    const stored = this.analysisStore.getByEventId(eventId);
    const issue  = stored?.ruleResults.find((r) => r.ruleId === ruleId);

    if (!stored || !issue) {
      return {
        prompt:   "Issue not found.",
        title:    "Unknown issue",
        category: "error",
        fromAi:   false,
      };
    }

    const eventStored = this.eventStore.getById(eventId);
    if (!eventStored) {
      return {
        prompt:   issue.cursorPrompt,  // rule engine's static prompt
        title:    `Fix: ${issue.title}`,
        category: issue.category,
        fromAi:   false,
      };
    }

    const result = await this.aiProvider.generateCursorPrompt({
      issue, event: eventStored.event, projectContext,
    });

    return { ...result, fromAi: this.aiProvider.available };
  }

  // ─── 4. getProjectHealth ───────────────────────────────────────────────────

  /**
   * Summarize the overall health of the project based on recent events.
   * Collects raw material from the stores and delegates to aiProvider.
   */
  async getProjectHealth(timeWindowMs = 3_600_000): Promise<
    ProjectHealthResponse & { fromAi: boolean; eventCount: number; issueCount: number }
  > {
    const cutoff = Date.now() - timeWindowMs;

    // Gather recent events within the time window
    const recentEvents = this.eventStore
      .recent(config.maxEvents)
      .map((s) => s.event)
      .filter((e) => new Date(e.timestamp).getTime() >= cutoff);

    // Gather all rule-engine findings from the analysis store
    const { data: analyses } = this.analysisStore.list(1, config.maxAnalyses);
    const recentIssues = analyses
      .filter((a) => new Date(a.createdAt).getTime() >= cutoff)
      .flatMap((a) => a.ruleResults);

    const result = await this.aiProvider.summarizeProjectHealth({
      recentEvents,
      recentIssues,
      timeWindowMs,
    });

    return {
      ...result,
      fromAi:     this.aiProvider.available,
      eventCount: recentEvents.length,
      issueCount: recentIssues.length,
    };
  }

  // ─── 5. computeHealthScore ─────────────────────────────────────────────────

  /**
   * Compute the project health score synchronously — no AI, instant response.
   *
   * Collects events and issues from the stores within the time window,
   * splits a second window for trend detection, and runs the HealthScoreEngine.
   *
   * @param timeWindowMs  How far back to look (default: 1 hour)
   * @param category      Optional: return only one category's detail
   */
  computeHealthScore(
    timeWindowMs = 3_600_000,
    category?: CategoryKey,
  ): HealthScoreCard & { category?: CategoryKey } {
    const now    = Date.now();
    const cutoff = now - timeWindowMs;

    // Collect recent issues within the window
    const { data: analyses } = this.analysisStore.list(1, config.maxAnalyses);
    const windowAnalyses = analyses.filter(
      (a) => new Date(a.createdAt).getTime() >= cutoff
    );
    const allIssues = windowAnalyses.flatMap((a) => a.ruleResults);

    // Collect event count
    const eventCount = this.eventStore
      .recent(config.maxEvents)
      .filter((s) => new Date(s.receivedAt).getTime() >= cutoff).length;

    // Trend: compare first half vs second half of the window
    const midpoint    = cutoff + timeWindowMs / 2;
    const firstHalf   = windowAnalyses.filter((a) => new Date(a.createdAt).getTime() <  midpoint).flatMap((a) => a.ruleResults);
    const secondHalf  = windowAnalyses.filter((a) => new Date(a.createdAt).getTime() >= midpoint).flatMap((a) => a.ruleResults);

    const prevScore = firstHalf.length > 0 || secondHalf.length > 0
      ? healthScoreEngine.compute(firstHalf,  0, timeWindowMs / 2).overall
      : undefined;

    const card = healthScoreEngine.compute(allIssues, eventCount, timeWindowMs, prevScore);

    // If a specific category was requested, trim all other categories' topIssues
    if (category) {
      return { ...card, category };
    }

    return card;
  }
}
