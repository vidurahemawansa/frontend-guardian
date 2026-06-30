import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ─── events ──────────────────────────────────────────────────────────────────

export const events = sqliteTable("events", {
  id:          text("id").primaryKey(),
  sessionId:   text("session_id").notNull(),
  kind:        text("kind").notNull(),          // 'error' | 'performance' | 'scalability'
  environment: text("environment").notNull().default("unknown"),
  payload:     text("payload").notNull(),       // full GuardianEvent JSON
  receivedAt:  text("received_at").notNull(),
  // user context (optional — set via guardian.setUser())
  userId:      text("user_id"),
  userEmail:   text("user_email"),
  userName:    text("user_name"),
});

// ─── analyses ────────────────────────────────────────────────────────────────

export const analyses = sqliteTable("analyses", {
  id:          text("id").primaryKey(),
  eventId:     text("event_id").notNull(),
  status:      text("status").notNull().default("pending"),  // 'pending' | 'complete' | 'error'
  ruleResults: text("rule_results").notNull().default("[]"), // JSON array
  aiAnalysis:  text("ai_analysis"),                          // JSON | null
  createdAt:   text("created_at").notNull(),
  updatedAt:   text("updated_at").notNull(),
});
