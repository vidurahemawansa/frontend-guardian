import { Router } from "express";
import { z }      from "zod";
import type { GuardianEvent } from "@frontend-guardian/types";
import { pipeline } from "../pipeline/index.js";

export const ingestRouter = Router();

/**
 * Legacy single-event ingest route.
 * Accepts either a new GuardianEvent (category field present) or a
 * legacy ErrorEvent (type: "error") for backward compatibility.
 */
const SingleEventSchema = z.union([
  // New SDK v2 format
  z.object({
    id:        z.string(),
    category:  z.enum(["error", "performance", "scalability"]),
    name:      z.string(),
    timestamp: z.string(),
    sessionId: z.string().optional(),
  }).passthrough(),
  // Legacy SDK v1 format
  z.object({
    id:        z.string(),
    type:      z.literal("error"),
    message:   z.string(),
    severity:  z.enum(["fatal", "error", "warning", "info", "debug"]),
    timestamp: z.string(),
    sessionId: z.string(),
  }).passthrough(),
]);

const IngestBodySchema = z.object({
  event:       SingleEventSchema,
  breadcrumbs: z.array(z.unknown()).optional(),
  session:     z.unknown().optional(),
});

ingestRouter.post("/", (req, res) => {
  const parsed = IngestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: parsed.error.message });
    return;
  }

  const rawEvent = parsed.data.event as Record<string, unknown>;

  // Normalise legacy v1 format to GuardianEvent
  const event: GuardianEvent = ("category" in rawEvent
    ? rawEvent
    : {
        ...rawEvent,
        category: "error",
        name: String(rawEvent["message"] ?? "unknown error"),
      }) as unknown as GuardianEvent;

  const sessionId = event.sessionId ?? String(rawEvent["sessionId"] ?? "unknown");
  const record = pipeline.process(event, sessionId);

  res.status(202).json({
    eventId:          record.eventId,
    received:         true,
    status:           record.status,
    issuesFound:      record.ruleResults.length,
    ruleProcessingMs: record.ruleProcessingMs,
    issues:           record.ruleResults.map((r) => ({
      ruleId:    r.ruleId,
      severity:  r.severity,
      issueType: r.issueType,
      title:     r.title,
    })),
  });
});
