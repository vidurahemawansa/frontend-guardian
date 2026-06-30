import { Router } from "express";
import type { ExplainAudience } from "../ai/index.js";
import { analysisStore }  from "../store/index.js";
import { pipeline }       from "../pipeline/index.js";

export const analysesRouter = Router();

// ── GET /analyses ─────────────────────────────────────────────────────────────

analysesRouter.get("/", (req, res) => {
  const page     = Math.max(1, Number(req.query["page"]     ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query["pageSize"] ?? 20)));
  const status   = req.query["status"] as string | undefined;

  const { data, total } = analysisStore.list(page, pageSize);
  const filtered = status ? data.filter((a) => a.status === status) : data;

  res.json({
    data: filtered.map((a) => ({
      eventId:          a.eventId,
      status:           a.status,
      issueCount:       a.ruleResults.length,
      hasAiAnalysis:    Boolean(a.aiAnalysis),
      ruleProcessingMs: a.ruleProcessingMs,
      aiProcessingMs:   a.aiProcessingMs,
      createdAt:        a.createdAt,
      updatedAt:        a.updatedAt,
      topIssue: a.ruleResults[0]
        ? { severity: a.ruleResults[0].severity, title: a.ruleResults[0].title, category: a.ruleResults[0].category }
        : null,
    })),
    total, page, pageSize,
  });
});

// ── GET /analyses/:eventId ────────────────────────────────────────────────────

analysesRouter.get("/:eventId", (req, res) => {
  const record = analysisStore.getByEventId(req.params["eventId"] ?? "");
  if (!record) {
    res.status(404).json({ code: "NOT_FOUND", message: "Analysis not found" });
    return;
  }
  res.json(record);
});

// ── GET /analyses/:eventId/explain?ruleId=X&audience=developer ───────────────

analysesRouter.get("/:eventId/explain", async (req, res) => {
  const eventId  = req.params["eventId"] ?? "";
  const ruleId   = req.query["ruleId"]   as string | undefined;
  const audience = (req.query["audience"] ?? "developer") as ExplainAudience;

  if (!ruleId) {
    res.status(400).json({ code: "MISSING_PARAM", message: "ruleId query param is required" });
    return;
  }

  const result = await pipeline.explainIssue(eventId, ruleId, audience);
  res.json(result);
});

// ── GET /analyses/:eventId/cursor-prompt?ruleId=X&context=... ────────────────

analysesRouter.get("/:eventId/cursor-prompt", async (req, res) => {
  const eventId       = req.params["eventId"] ?? "";
  const ruleId        = req.query["ruleId"]        as string | undefined;
  const projectContext = req.query["projectContext"] as string | undefined;

  if (!ruleId) {
    res.status(400).json({ code: "MISSING_PARAM", message: "ruleId query param is required" });
    return;
  }

  const result = await pipeline.generateCursorPrompt(eventId, ruleId, projectContext);
  res.json(result);
});
