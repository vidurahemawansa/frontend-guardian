import { config as dotenvConfig } from "dotenv";
dotenvConfig(); // loads .env before any other module reads process.env

import { bootstrapDb } from "./db/index.js";
bootstrapDb(); // create tables on first run, no-op on subsequent starts

import express  from "express";
import cors     from "cors";
import { config }         from "./config.js";
import { requireApiKey }  from "./middleware/auth.js";
import { errorHandler }   from "./middleware/errorHandler.js";
import { batchRouter }    from "./routes/batch.js";
import { ingestRouter }   from "./routes/ingest.js";
import { eventsRouter }   from "./routes/events.js";
import { analysesRouter } from "./routes/analyses.js";
import { healthRouter }   from "./routes/health.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "4mb" }));

// ── Public ────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status:    "ok",
    timestamp: new Date().toISOString(),
    aiEnabled: config.aiEnabled,
    aiProvider: config.aiProvider,
  });
});

// ── Protected ─────────────────────────────────────────────────────────────────

app.use("/batch",    requireApiKey, batchRouter);
app.use("/ingest",   requireApiKey, ingestRouter);
app.use("/events",   eventsRouter);
app.use("/analyses", analysesRouter);
app.use("/health",   healthRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[Guardian Server] Listening on http://localhost:${config.port}`);
  console.log(`[Guardian Server] AI: ${config.aiEnabled ? config.aiProvider : "disabled"}`);
});

export { app };
