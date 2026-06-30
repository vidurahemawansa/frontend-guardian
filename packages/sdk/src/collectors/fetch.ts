import type { FetchSpan } from "@frontend-guardian/types";
import type { ResolvedConfig } from "../config.js";
import { generateId, now, byteLength, peekResponseSize } from "../utils.js";

export type FetchSpanHandler = (span: FetchSpan) => void;

/**
 * Intercepts `window.fetch` by wrapping it with a timing + size probe.
 * The original fetch is always restored when `detach()` is called.
 */
export class FetchCollector {
  private readonly onSpan: FetchSpanHandler;
  private readonly config: ResolvedConfig;
  private originalFetch: typeof fetch | null = null;
  private attached = false;

  constructor(config: ResolvedConfig, onSpan: FetchSpanHandler) {
    this.config = config;
    this.onSpan = onSpan;
  }

  attach(): void {
    if (this.attached || typeof window === "undefined" || typeof window.fetch === "undefined") return;

    this.originalFetch = window.fetch.bind(window);
    const original = this.originalFetch;
    const self = this;

    window.fetch = async function guardianFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      if (!self.config.enabled) return original(input, init);

      const spanId = generateId();
      const method = (init?.method ?? "GET").toUpperCase();
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const timestamp = now();
      const startMs = performance.now();

      // Estimate request body size
      let requestBodySize = 0;
      if (init?.body) {
        if (typeof init.body === "string") requestBodySize = byteLength(init.body);
        else if (init.body instanceof Blob) requestBodySize = init.body.size;
        else if (init.body instanceof ArrayBuffer) requestBodySize = init.body.byteLength;
      }

      let response: Response;
      let status: number | null = null;
      let responseBodySize = 0;
      let failed = false;

      try {
        response = await original(input, init);
        status = response.status;
        responseBodySize = await peekResponseSize(response);
      } catch (err) {
        failed = true;
        const duration = performance.now() - startMs;
        self.onSpan({
          id: spanId,
          url,
          method,
          status: null,
          duration,
          requestBodySize,
          responseBodySize: 0,
          timestamp,
          failed: true,
        });
        throw err;
      }

      const duration = performance.now() - startMs;

      self.onSpan({
        id: spanId,
        url,
        method,
        status,
        duration,
        requestBodySize,
        responseBodySize,
        timestamp,
        failed,
      });

      return response;
    };

    this.attached = true;
  }

  detach(): void {
    if (!this.attached || typeof window === "undefined") return;
    if (this.originalFetch) window.fetch = this.originalFetch;
    this.originalFetch = null;
    this.attached = false;
  }
}
