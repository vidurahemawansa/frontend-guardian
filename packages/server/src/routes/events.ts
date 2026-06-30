import { Router } from "express";
import { eventStore } from "../store/index.js";

export const eventsRouter = Router();

/** GET /events?page=1&pageSize=20&category=error */
eventsRouter.get("/", (req, res) => {
  const page     = Math.max(1, Number(req.query["page"]     ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query["pageSize"] ?? 20)));
  const category = req.query["category"] as string | undefined;

  const { data, total } = eventStore.list(page, pageSize);

  const filtered = category
    ? data.filter((s) => s.event.category === category)
    : data;

  res.json({
    data: filtered.map((s) => ({
      id:          s.event.id,
      category:    s.event.category,
      name:        s.event.name,
      sessionId:   s.event.sessionId,
      timestamp:   s.event.timestamp,
      receivedAt:  s.receivedAt,
    })),
    total,
    page,
    pageSize,
  });
});

/** GET /events/:id */
eventsRouter.get("/:id", (req, res) => {
  const stored = eventStore.getById(req.params["id"] ?? "");
  if (!stored) {
    res.status(404).json({ code: "NOT_FOUND", message: "Event not found" });
    return;
  }
  res.json({ event: stored.event, receivedAt: stored.receivedAt });
});
