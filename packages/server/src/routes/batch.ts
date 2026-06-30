import { Router } from "express";
import { z }      from "zod";
import type { GuardianEvent } from "@frontend-guardian/types";
import { pipeline } from "../pipeline/index.js";

export const batchRouter = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

/** Permissive guardian event schema — strict validation is the SDK's responsibility */
const GuardianEventSchema = z.object({
  id:        z.string(),
  category:  z.enum(["error", "performance", "scalability"]),
  name:      z.string(),
  timestamp: z.string(),
  sessionId: z.string().optional(),
}).passthrough();

const UserSchema = z.object({
  id:       z.string().optional(),
  email:    z.string().optional(),
  username: z.string().optional(),
}).passthrough();

const BatchBodySchema = z.object({
  events:      z.array(GuardianEventSchema).min(1).max(500),
  sessionId:   z.string(),
  environment: z.string().optional(),
  sdkVersion:  z.string().optional(),
  sentAt:      z.string().optional(),
  user:        UserSchema.optional(),
});

// ── POST /batch ───────────────────────────────────────────────────────────────

/**
 * Primary ingestion endpoint for the SDK's batching system.
 * Accepts up to 500 events per request; returns synchronous rule-engine
 * results immediately while AI analysis continues in the background.
 */
batchRouter.post("/", (req, res) => {
  const parsed = BatchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: parsed.error.message });
    return;
  }

  const { events, sessionId, user } = parsed.data;
  const records = pipeline.processBatch(events as GuardianEvent[], sessionId, user);

  const issueCount = records.reduce((sum, r) => sum + r.ruleResults.length, 0);

  res.status(202).json({
    received:    events.length,
    processed:   records.length,
    issuesFound: issueCount,
    aiEnabled:   records[0]?.status === "ai_pending",
    analyses:    records.map((r) => ({
      eventId:          r.eventId,
      status:           r.status,
      issueCount:       r.ruleResults.length,
      ruleProcessingMs: r.ruleProcessingMs,
      issues:           r.ruleResults.map((issue) => ({
        ruleId:    issue.ruleId,
        severity:  issue.severity,
        issueType: issue.issueType,
        title:     issue.title,
      })),
    })),
  });
});
