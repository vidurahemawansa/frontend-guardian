import type { RuleResult } from "../engine/types.js";
import type { StoredEvent } from "../store/EventStore.js";

// ─── Config (loaded from env vars in config.ts) ───────────────────────────────

export interface AlertConfig {
  /** Slack incoming webhook URL — set ALERT_SLACK_WEBHOOK */
  slackWebhook?:   string;
  /** Generic webhook URL (POST JSON) — set ALERT_WEBHOOK_URL */
  webhookUrl?:     string;
  /** Only alert on these severities (default: critical + error) */
  minSeverity:     "info" | "warning" | "error" | "critical";
  /** Cooldown between repeated alerts for the same ruleId (ms) */
  cooldownMs:      number;
}

// ─── Cooldown tracker ─────────────────────────────────────────────────────────

const lastAlerted = new Map<string, number>(); // ruleId → timestamp

function isOnCooldown(ruleId: string, cooldownMs: number): boolean {
  const last = lastAlerted.get(ruleId);
  if (!last) return false;
  return Date.now() - last < cooldownMs;
}

function markAlerted(ruleId: string): void {
  lastAlerted.set(ruleId, Date.now());
}

// ─── Severity ordering ────────────────────────────────────────────────────────

const SEVERITY_ORDER = { info: 0, warning: 1, error: 2, critical: 3 };

function meetsThreshold(
  issueSev: string,
  minSev:   AlertConfig["minSeverity"],
): boolean {
  return (SEVERITY_ORDER[issueSev as keyof typeof SEVERITY_ORDER] ?? 0)
       >= SEVERITY_ORDER[minSev];
}

// ─── Payload builders ─────────────────────────────────────────────────────────

function buildSlackPayload(
  issue:  RuleResult,
  stored: StoredEvent,
  dashboardUrl: string,
): object {
  const emoji =
    issue.severity === "critical" ? "🔴" :
    issue.severity === "error"    ? "🟠" :
    issue.severity === "warning"  ? "🟡" : "🔵";

  const url = `${dashboardUrl}/events/${stored.event.id}`;

  return {
    text: `${emoji} *Frontend Guardian Alert* — ${issue.title}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${emoji} ${issue.title}`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Severity:*\n${issue.severity.toUpperCase()}` },
          { type: "mrkdwn", text: `*Category:*\n${issue.category}` },
          { type: "mrkdwn", text: `*Rule:*\n${issue.ruleId}` },
          { type: "mrkdwn", text: `*Environment:*\n${(stored.event as { environment?: string }).environment ?? "unknown"}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Description:*\n${issue.description}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Recommended fix:*\n${issue.recommendation}` },
      },
      ...(stored.user
        ? [{
            type: "context",
            elements: [{ type: "mrkdwn", text: `👤 User: ${stored.user.email ?? stored.user.id ?? "unknown"}` }],
          }]
        : []
      ),
      {
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "View in Dashboard" },
          url,
          style: "primary",
        }],
      },
    ],
  };
}

function buildWebhookPayload(
  issue:  RuleResult,
  stored: StoredEvent,
): object {
  return {
    source:      "frontend-guardian",
    severity:    issue.severity,
    category:    issue.category,
    ruleId:      issue.ruleId,
    title:       issue.title,
    description: issue.description,
    recommendation: issue.recommendation,
    eventId:     stored.event.id,
    sessionId:   stored.sessionId,
    environment: (stored.event as { environment?: string }).environment ?? "unknown",
    user:        stored.user ?? null,
    timestamp:   new Date().toISOString(),
  };
}

// ─── AlertManager ─────────────────────────────────────────────────────────────

export class AlertManager {
  constructor(
    private readonly cfg: AlertConfig,
    private readonly dashboardUrl: string = "http://localhost:3000",
  ) {}

  get enabled(): boolean {
    return !!(this.cfg.slackWebhook ?? this.cfg.webhookUrl);
  }

  /**
   * Fire alerts for any issues that pass the severity threshold
   * and are not on cooldown. Fire-and-forget — never throws.
   */
  async notify(issues: RuleResult[], stored: StoredEvent): Promise<void> {
    if (!this.enabled) return;

    const eligible = issues.filter(
      (i) => meetsThreshold(i.severity, this.cfg.minSeverity) && !isOnCooldown(i.ruleId, this.cfg.cooldownMs)
    );

    if (eligible.length === 0) return;

    await Promise.allSettled(
      eligible.flatMap((issue) => {
        markAlerted(issue.ruleId);
        const sends: Promise<void>[] = [];

        if (this.cfg.slackWebhook) {
          sends.push(this.sendSlack(issue, stored));
        }
        if (this.cfg.webhookUrl) {
          sends.push(this.sendWebhook(issue, stored));
        }

        return sends;
      })
    );
  }

  private async sendSlack(issue: RuleResult, stored: StoredEvent): Promise<void> {
    const payload = buildSlackPayload(issue, stored, this.dashboardUrl);
    try {
      const res = await fetch(this.cfg.slackWebhook!, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn(`[AlertManager] Slack returned ${res.status} for rule ${issue.ruleId}`);
      }
    } catch (err) {
      console.warn("[AlertManager] Slack send failed:", err);
    }
  }

  private async sendWebhook(issue: RuleResult, stored: StoredEvent): Promise<void> {
    const payload = buildWebhookPayload(issue, stored);
    try {
      const res = await fetch(this.cfg.webhookUrl!, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn(`[AlertManager] Webhook returned ${res.status} for rule ${issue.ruleId}`);
      }
    } catch (err) {
      console.warn("[AlertManager] Webhook send failed:", err);
    }
  }
}
