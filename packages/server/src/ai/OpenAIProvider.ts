import { BaseProvider } from "./BaseProvider.js";

interface OAIMessage  { role: "system" | "user" | "assistant"; content: string }
interface OAIResponse { choices: Array<{ message: OAIMessage }>; usage?: { prompt_tokens: number; completion_tokens: number } }

/**
 * OpenAI provider — Chat Completions API via native fetch (Node 18+).
 * No vendor SDK required.
 *
 * Env vars:
 *   AI_API_KEY    → sk-...       (required)
 *   AI_MODEL      → default: "gpt-4o-mini"
 *   AI_MAX_TOKENS → default: 1024
 *   AI_TIMEOUT_MS → default: 30 000
 *
 * Available models (cheapest → most capable):
 *   gpt-4o-mini      ← default, best price/quality
 *   gpt-4o           ← strongest reasoning
 *   gpt-4-turbo      ← large context window
 */
export class OpenAIProvider extends BaseProvider {
  readonly name      = "openai";
  readonly available: boolean;

  protected readonly maxTokens: number;
  protected readonly timeoutMs: number;
  private   readonly apiKey:    string;
  private   readonly model:     string;
  private   readonly endpoint   = "https://api.openai.com/v1/chat/completions";

  constructor(opts: { apiKey: string; model?: string; maxTokens?: number; timeoutMs?: number }) {
    super();
    this.apiKey    = opts.apiKey;
    this.model     = opts.model     ?? "gpt-4o-mini";
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
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model:           this.model,
          max_tokens:      opts.maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt },
          ],
        }),
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      const json = await res.json() as OAIResponse;
      return json.choices[0]?.message.content ?? "{}";
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
}
