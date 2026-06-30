import { BaseProvider } from "./BaseProvider.js";

interface GeminiPart      { text: string }
interface GeminiContent   { role?: string; parts: GeminiPart[] }
interface GeminiCandidate { content: GeminiContent; finishReason?: string }
interface GeminiResponse  { candidates: GeminiCandidate[] }

/**
 * Google Gemini provider — Generative Language API via native fetch (Node 18+).
 * No vendor SDK required.
 *
 * Env vars:
 *   AI_API_KEY    → Google AI Studio key  (required)
 *                   Get one at: https://aistudio.google.com/app/apikey
 *   AI_MODEL      → default: "gemini-1.5-flash"
 *   AI_MAX_TOKENS → default: 1024
 *   AI_TIMEOUT_MS → default: 30 000
 *
 * Available models (cheapest → most capable):
 *   gemini-1.5-flash-8b   ← smallest / cheapest
 *   gemini-1.5-flash      ← default, generous free tier
 *   gemini-1.5-pro        ← best balance
 *   gemini-2.0-flash      ← newest fast model
 */
export class GeminiProvider extends BaseProvider {
  readonly name      = "gemini";
  readonly available: boolean;

  protected readonly maxTokens: number;
  protected readonly timeoutMs: number;
  private   readonly apiKey:    string;
  private   readonly model:     string;

  constructor(opts: { apiKey: string; model?: string; maxTokens?: number; timeoutMs?: number }) {
    super();
    this.apiKey    = opts.apiKey;
    this.model     = opts.model     ?? "gemini-1.5-flash";
    this.maxTokens = opts.maxTokens ?? 1024;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.available = Boolean(this.apiKey);
  }

  private get endpoint(): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
  }

  protected async callApi(
    systemPrompt: string,
    userPrompt: string,
    opts: { maxTokens: number; timeoutMs: number; temperature?: number }
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens:  opts.maxTokens,
            temperature:      opts.temperature ?? 0.2,
          },
        }),
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      const json = await res.json() as GeminiResponse;
      return json.candidates[0]?.content.parts[0]?.text ?? "{}";
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
}
