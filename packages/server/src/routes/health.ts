import { Router }       from "express";
import { pipeline }     from "../pipeline/index.js";
import type { CategoryKey } from "../pipeline/index.js";

export const healthRouter = Router();

const VALID_CATEGORIES = new Set<CategoryKey>(["errors", "performance", "scalability", "architecture"]);

function parseWindow(raw: unknown): number {
  return Math.min(86_400_000, Math.max(60_000, Number(raw ?? 3_600_000)));
}

// ── GET /health/score?windowMs=3600000 ────────────────────────────────────────
//
// Returns the full health score card with all 4 categories.
// Instant, synchronous — no AI required.
//
// Response shape:
//   {
//     overall: 91,
//     grade: "A",
//     trend: "stable",
//     categories: {
//       errors:       { score, grade, status, label, emoji, counts, topIssues },
//       performance:  { ... },
//       scalability:  { ... },
//       architecture: { ... }
//     },
//     computedAt, windowMs, eventCount, issueCount
//   }

healthRouter.get("/score", (req, res) => {
  const windowMs = parseWindow(req.query["windowMs"]);
  const card = pipeline.computeHealthScore(windowMs);
  res.json(card);
});

// ── GET /health/score/:category?windowMs=3600000 ──────────────────────────────
//
// Returns the detailed issue list for a single category.
// This is what powers the "click on Scalability → see all issues" view.
//
// Response shape:
//   {
//     category:   "scalability",
//     score:      72,
//     grade:      "C",
//     status:     "fair",
//     label:      "4 Suggestions",
//     emoji:      "🔵",
//     counts:     { critical: 0, error: 0, warning: 3, info: 1 },
//     topIssues: [
//       {
//         ruleId, title, severity, issueType,
//         description:    "You loaded 3,200 records without pagination.",
//         recommendation: "1. Implement server-side pagination...",
//         occurrences, affectedEventIds
//       },
//       ...
//     ]
//   }

healthRouter.get("/score/:category", (req, res) => {
  const rawCategory = req.params["category"] as string;
  if (!VALID_CATEGORIES.has(rawCategory as CategoryKey)) {
    res.status(400).json({
      code:    "INVALID_CATEGORY",
      message: `category must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
    });
    return;
  }
  const category = rawCategory as CategoryKey;
  const windowMs = parseWindow(req.query["windowMs"]);
  const card     = pipeline.computeHealthScore(windowMs, category);

  res.json({
    category,
    ...card.categories[category],
    overall:    card.overall,
    computedAt: card.computedAt,
    windowMs,
  });
});

// ── GET /health/ai?windowMs=3600000 ───────────────────────────────────────────
//
// AI-generated narrative health summary (async).
// Falls back gracefully when AI is disabled.

healthRouter.get("/ai", async (req, res) => {
  const windowMs = parseWindow(req.query["windowMs"]);
  const result   = await pipeline.getProjectHealth(windowMs);
  res.json({ ...result, windowMs });
});
