import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * Guards the ingest and batch routes with a shared API key.
 *
 * The SDK sends the key in the "x-guardian-key" header.
 * The server compares it against the GUARDIAN_API_KEY env variable.
 *
 * If GUARDIAN_API_KEY is empty (local dev default), the guard is
 * skipped entirely so developers can start without any configuration.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // No key configured → open in dev mode, skip check
  if (!config.apiKey) {
    next();
    return;
  }

  const incoming = req.headers["x-guardian-key"];
  if (incoming !== config.apiKey) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Invalid or missing API key" });
    return;
  }

  next();
}
