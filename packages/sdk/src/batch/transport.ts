import type { GuardianEvent, BatchPayload, BatchResponse, Environment } from "@frontend-guardian/types";
import { SDK_VERSION } from "../config.js";
import { now } from "../utils.js";

export interface TransportOptions {
  apiUrl: string;
  apiKey: string;
  environment: Environment;
  sessionId: string;
  debug: boolean;
}

/**
 * Sends a batch of events to the Guardian ingest endpoint via `fetch`.
 */
export async function sendBatch(
  events: GuardianEvent[],
  opts: TransportOptions
): Promise<BatchResponse | null> {
  const payload: BatchPayload = {
    events,
    sessionId: opts.sessionId,
    environment: opts.environment,
    sdkVersion: SDK_VERSION,
    sentAt: now(),
  };

  const url = `${opts.apiUrl}/batch`;
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.apiKey) headers["X-Guardian-Key"] = opts.apiKey;

  try {
    const res = await fetch(url, { method: "POST", headers, body });
    if (!res.ok) {
      if (opts.debug) console.warn("[FrontendGuardian] Batch rejected:", res.status);
      return null;
    }
    return (await res.json()) as BatchResponse;
  } catch (err) {
    if (opts.debug) console.warn("[FrontendGuardian] Batch send failed:", err);
    return null;
  }
}

/**
 * Best-effort delivery on page unload via `sendBeacon`.
 * Falls back to a sync XHR if sendBeacon isn't available.
 */
export function sendBatchBeacon(
  events: GuardianEvent[],
  opts: Omit<TransportOptions, "debug">
): void {
  if (events.length === 0) return;

  const payload: BatchPayload = {
    events,
    sessionId: opts.sessionId,
    environment: opts.environment,
    sdkVersion: SDK_VERSION,
    sentAt: now(),
  };

  const url = `${opts.apiUrl}/batch`;
  const body = JSON.stringify(payload);

  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(url, blob);
    return;
  }

  // Synchronous XHR fallback (last resort — blocks the thread briefly)
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, false); // false = synchronous
    xhr.setRequestHeader("Content-Type", "application/json");
    if (opts.apiKey) xhr.setRequestHeader("X-Guardian-Key", opts.apiKey);
    xhr.send(body);
  } catch { /* silently swallow */ }
}
