import type { IngestRequest, IngestResponse } from "@frontend-guardian/types";

export interface TransportOptions {
  endpoint: string;
  apiKey: string;
}

/**
 * Sends an event to the Guardian server.
 * Uses `navigator.sendBeacon` for fire-and-forget on page unload,
 * falls back to `fetch` for all other cases.
 */
export async function sendEvent(
  payload: IngestRequest,
  options: TransportOptions,
  useBeacon = false
): Promise<IngestResponse | null> {
  const url = `${options.endpoint}/ingest`;
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "X-Guardian-Key": options.apiKey,
  };

  if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(url, blob);
    return null;
  }

  try {
    const res = await fetch(url, { method: "POST", headers, body });
    if (!res.ok) return null;
    return (await res.json()) as IngestResponse;
  } catch {
    return null;
  }
}
