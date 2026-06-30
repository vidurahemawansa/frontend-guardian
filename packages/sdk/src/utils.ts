import type { StackFrame } from "@frontend-guardian/types";

export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function now(): string {
  return new Date().toISOString();
}

export function currentUrl(): string {
  return typeof location !== "undefined" ? location.href : "";
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  return stack
    .split("\n")
    .slice(1)
    .map((line) => {
      const named = /at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)/.exec(line.trim());
      const anon = /at\s+(.*?):(\d+):(\d+)/.exec(line.trim());
      const match = named ?? anon;
      if (!match) {
        return { filename: line.trim(), function: "<unknown>", lineno: null, colno: null, inApp: false };
      }
      const isNamed = match.length === 5;
      return {
        function: isNamed ? (match[1] ?? "<anonymous>") : "<anonymous>",
        filename: isNamed ? (match[2] ?? "") : (match[1] ?? ""),
        lineno: parseInt(isNamed ? (match[3] ?? "0") : (match[2] ?? "0"), 10),
        colno: parseInt(isNamed ? (match[4] ?? "0") : (match[3] ?? "0"), 10),
        inApp: !line.includes("node_modules"),
      };
    });
}

/** Estimate the byte-length of a string (UTF-8 approximation). */
export function byteLength(str: string): number {
  // In browser environments the TextEncoder API gives an exact count.
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str).length;
  }
  // Fallback: assume ~1 byte per char (underestimates multibyte chars).
  return str.length;
}

/** Safely read the body of a Response without consuming the stream. */
export async function peekResponseSize(res: Response): Promise<number> {
  const contentLength = res.headers.get("content-length");
  if (contentLength) return parseInt(contentLength, 10);
  try {
    const clone = res.clone();
    const text = await clone.text();
    return byteLength(text);
  } catch {
    return 0;
  }
}
