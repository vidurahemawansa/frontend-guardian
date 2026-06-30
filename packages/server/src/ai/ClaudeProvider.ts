import { BaseProvider } from "./BaseProvider.js";

interface AnthropicContent  { type: "text"; text: string }
interface AnthropicResponse { content: AnthropicContent[]; stop_reason: string }

/**
 * Anthropic Claude provider — Messages API via native fetch (Node 18+).
 * No vendor SDK required.
 *
 * Env vars:
 *   AI_API_KEY    → sk-ant-...   (required)
 *   AI_MODEL      → default: "claude-3-5-haiku-20241022"
 *   AI_MAX_TOKENS → default: 1024
 *   AI_TIMEOUT_MS → default: 30 000
 *
 * Available models (cheapest → most capable):
 *   claude-3-5-haiku-20241022    ← default, fast and affordable
 *   claude-3-5-sonnet-20241022   ← best balance
 *   claude-opus-4-5              ← most capable
 */
export class ClaudeProvider extends BaseProvider {
  readonly name      = "claude";
  readonly available: boolean;

  protected readonly maxTokens:  number;
  protected readonly timeoutMs:  number;
  private   readonly apiKey:     string;
  private   readonly model:      string;
  private   readonly endpoint    = "https://api.anthropic.com/v1/messages";
  private   readonly apiVersion  = "2023-06-01";

  constructor(opts: { apiKey: string; model?: string; maxTokens?: number; timeoutMs?: number }) {
    super();
    this.apiKey    = opts.apiKey;
    this.model     = opts.model     ?? "claude-3-5-haiku-20241022";
    this.maxTokens = opts.maxTokens ?? 1024;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.available = Boolean(this.apiKey);
  }

  protected async callApi(
    systemPrompt: string,
    userPrompt: string,
    opts: { maxTokens: number; timeoutMs: number }
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         this.apiKey,
          "anthropic-version": this.apiVersion,
        },
        body: JSON.stringify({
          model:      this.model,
          max_tokens: opts.maxTokens,
          system:     systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      const json = await res.json() as AnthropicResponse;
      return json.content[0]?.text ?? "{}";
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
}
