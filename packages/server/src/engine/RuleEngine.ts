import type { GuardianEvent } from "@frontend-guardian/types";
import type { Rule, RuleResult, RuleCategory } from "./types.js";
import { ALL_RULES } from "./rules/index.js";

export interface RuleEngineResult {
  issues:          RuleResult[];
  rulesEvaluated:  number;
  durationMs:      number;
}

/**
 * Synchronous Rule Engine.
 *
 * For each call to `run()` it:
 *   1. Passes the full events window to every rule's `detect()` method
 *   2. For each match, calls `recommendation()` and `generateCursorPrompt()`
 *      to build the complete `RuleResult`
 *   3. Returns all results immediately — no async, no external calls
 *
 * Conventions for the `events` window:
 *   - `events[events.length - 1]` is the latest event (just received)
 *   - `events.slice(0, -1)`       is the historical context
 */
export class RuleEngine {
  private readonly rules: Rule[];

  constructor(rules: Rule[] = ALL_RULES) {
    this.rules = rules;
  }

  run(events: GuardianEvent[]): RuleEngineResult {
    if (events.length === 0) {
      return { issues: [], rulesEvaluated: 0, durationMs: 0 };
    }

    const start  = performance.now();
    const issues: RuleResult[] = [];

    for (const rule of this.rules) {
      try {
        const match = rule.detect(events);
        if (!match) continue;

        issues.push({
          ruleId:           rule.id,
          title:            rule.title,
          category:         rule.category,
          severity:         match.severity ?? rule.severity,
          issueType:        match.issueType,
          description:      match.description,
          recommendation:   rule.recommendation(match),
          cursorPrompt:     rule.generateCursorPrompt(match),
          affectedEventIds: match.affectedEventIds,
          data:             match.data,
        });
      } catch (err) {
        console.error(`[RuleEngine] Rule "${rule.id}" threw:`, err);
      }
    }

    return {
      issues,
      rulesEvaluated: this.rules.length,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
    };
  }

  /** Add a rule at runtime. Throws on duplicate id. */
  addRule(rule: Rule): void {
    if (this.rules.find((r) => r.id === rule.id)) {
      throw new Error(`[RuleEngine] Duplicate rule id: "${rule.id}"`);
    }
    this.rules.push(rule);
  }

  getRules(): readonly Rule[]                       { return this.rules; }
  getRulesByCategory(c: RuleCategory): readonly Rule[] {
    return this.rules.filter((r) => r.category === c);
  }
}
