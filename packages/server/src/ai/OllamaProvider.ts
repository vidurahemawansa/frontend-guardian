import { BaseProvider } from "./BaseProvider.js";

interface OllamaMessage  { role: "system" | "user" | "assistant"; content: string }
interface OllamaResponse { model: string; message: OllamaMessage; done: boolean }

/**
 * Ollama provider — local LLM inference via native fetch (Node 18+).
 * No API key required. 100% private, runs on your machine.
 *
 * Prerequisites:
 *   1. Install Ollama: https://ollama.com/download
 *   2. Pull a model:   ollama pull qwen2.5-coder:7b
 *   3. Keep running:   ollama serve
 *
 * Env vars:
 *   AI_OLLAMA_BASE_URL → default: "http://localhost:11434"
 *   AI_MODEL           → default: "qwen2.5-coder:7b"
 *   AI_MAX_TOKENS      → default: 1024
 *   AI_TIMEOUT_MS      → default: 60 000 (local inference is slower)
 *
 * Recommended models for code analysis:
 *   qwen2.5-coder:7b     ← default, excellent code reasoning, ~4 GB
 *   deepseek-coder:6.7b  ← strong on code, ~4 GB
 *   codellama:7b         ← Meta's code model, ~4 GB
 *   llama3.1:8b          ← good general model, ~5 GB
 *   llama3.2:3b          ← smallest / fastest, ~2 GB
 */
export class OllamaProvider extends BaseProvider {
  readonly name      = "ollama";
  readonly available = true; // can't pre-check without a request

  protected readonly maxTokens: number;
  protected readonly timeoutMs: number;
  private   readonly baseUrl:   string;
  private   readonly model:     string;

  constructor(opts: { baseUrl?: string; model?: string; maxTokens?: number; timeoutMs?: number }) {
    super();
    this.baseUrl   = (opts.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    this.model     = opts.model     ?? "qwen2.5-coder:7b";
    this.maxTokens = opts.maxTokens ?? 1024;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  protected async callApi(
    systemPrompt: string,
    userPrompt: string,
    opts: { maxTokens: number; timeoutMs: number; temperature?: number }
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model:   this.model,
          stream:  false,
          format:  "json",
          options: { num_predict: opts.maxTokens, temperature: opts.temperature ?? 0.2 },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt },
          ],
        }),
      });
      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        if (res.status === 404) {
          throw new Error(`Ollama model "${this.model}" not found. Run: ollama pull ${this.model}`);
        }
        throw new Error(`Ollama ${res.status}: ${text}`);
      }

      const json = await res.json() as OllamaResponse;
      return json.message?.content ?? "{}";
    } catch (err) {
      clearTimeout(timer);
      const msg = String(err);
      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
        throw new Error(`Ollama is not running at ${this.baseUrl}. Start with: ollama serve`);
      }
      throw err;
    }
  }
}
