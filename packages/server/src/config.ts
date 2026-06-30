export type AiProviderName = "openai" | "claude" | "gemini" | "ollama" | "none";

export interface ServerConfig {
  port: number;
  /** Inbound API key required on every request */
  apiKey: string;

  // ── Event store ──────────────────────────────────────────────────────────
  /** Max events kept in memory before evicting oldest. Default: 10 000 */
  maxEvents: number;
  /** Max analyses kept in memory. Default: 5 000 */
  maxAnalyses: number;
  /** How many recent events the rule engine receives as context. Default: 200 */
  ruleContextWindow: number;

  // ── AI ───────────────────────────────────────────────────────────────────
  aiEnabled: boolean;
  aiProvider: AiProviderName;
  /** OpenAI / Anthropic API key */
  aiApiKey: string;
  /** Model identifier – defaults vary per provider */
  aiModel: string;
  /** Max tokens / output length */
  aiMaxTokens: number;
  /** Request timeout in ms */
  aiTimeoutMs: number;
  /** Base URL for Ollama (only used when aiProvider === "ollama") */
  ollamaBaseUrl: string;

  // ── Alerting ──────────────────────────────────────────────────────────────
  /** Slack incoming webhook URL */
  alertSlackWebhook: string;
  /** Generic webhook URL (POST JSON) */
  alertWebhookUrl: string;
  /** Minimum severity to trigger an alert: info | warning | error | critical */
  alertMinSeverity: "info" | "warning" | "error" | "critical";
  /** Cooldown between repeated alerts for the same rule (ms) */
  alertCooldownMs: number;
  /** Public dashboard URL included in alert links */
  dashboardUrl: string;
}

export function loadConfig(): ServerConfig {
  const env = process.env;
  return {
    port:              Number(env["PORT"]            ?? 4000),
    apiKey:            env["GUARDIAN_API_KEY"]       ?? "",
    maxEvents:         Number(env["MAX_EVENTS"]      ?? 10_000),
    maxAnalyses:       Number(env["MAX_ANALYSES"]    ?? 5_000),
    ruleContextWindow: Number(env["RULE_WINDOW"]     ?? 200),
    aiEnabled:         env["AI_ENABLED"]             === "true",
    aiProvider:       (env["AI_PROVIDER"]            ?? "none") as AiProviderName,
    aiApiKey:          env["AI_API_KEY"]             ?? "",
    aiModel:           env["AI_MODEL"]               ?? "",
    aiMaxTokens:       Number(env["AI_MAX_TOKENS"]   ?? 1024),
    aiTimeoutMs:       Number(env["AI_TIMEOUT_MS"]   ?? 30_000),
    ollamaBaseUrl:      env["AI_OLLAMA_BASE_URL"]      ?? "http://localhost:11434",
    alertSlackWebhook:  env["ALERT_SLACK_WEBHOOK"]     ?? "",
    alertWebhookUrl:    env["ALERT_WEBHOOK_URL"]       ?? "",
    alertMinSeverity:  (env["ALERT_MIN_SEVERITY"]      ?? "error") as ServerConfig["alertMinSeverity"],
    alertCooldownMs:    Number(env["ALERT_COOLDOWN_MS"] ?? 300_000), // 5 min default
    dashboardUrl:       env["DASHBOARD_URL"]            ?? "http://localhost:3000",
  };
}

export const config = loadConfig();
