import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { RuleResult } from "../engine/types.js";
import type { AiAnalysisResponse } from "../ai/types.js";

export type AnalysisStatus =
  | "rule_complete"
  | "ai_pending"
  | "ai_complete"
  | "ai_failed"
  | "ai_disabled";

export interface AnalysisRecord {
  id:               string;
  eventId:          string;
  status:           AnalysisStatus;
  ruleResults:      RuleResult[];
  aiAnalysis:       AiAnalysisResponse | null;
  ruleProcessingMs: number;
  aiProcessingMs:   number | null;
  createdAt:        string;
  updatedAt:        string;
}

/**
 * SQLite-backed analysis store.
 * Same public interface as the previous in-memory version.
 */
export class AnalysisStore {
  save(record: AnalysisRecord): void {
    db.insert(schema.analyses).values({
      id:          record.id,
      eventId:     record.eventId,
      status:      record.status,
      ruleResults: JSON.stringify(record.ruleResults),
      aiAnalysis:  record.aiAnalysis ? JSON.stringify(record.aiAnalysis) : null,
      createdAt:   record.createdAt,
      updatedAt:   record.updatedAt,
    })
    .onConflictDoNothing()
    .run();
  }

  patch(eventId: string, patch: Partial<AnalysisRecord>): void {
    const now = new Date().toISOString();
    const existing = this.getByEventId(eventId);
    if (!existing) return;

    db.update(schema.analyses)
      .set({
        status:      patch.status      ?? existing.status,
        ruleResults: patch.ruleResults ? JSON.stringify(patch.ruleResults) : JSON.stringify(existing.ruleResults),
        aiAnalysis:  patch.aiAnalysis  ? JSON.stringify(patch.aiAnalysis) : existing.aiAnalysis ? JSON.stringify(existing.aiAnalysis) : null,
        updatedAt:   now,
      })
      .where(eq(schema.analyses.eventId, eventId))
      .run();
  }

  getByEventId(eventId: string): AnalysisRecord | undefined {
    const row = db
      .select()
      .from(schema.analyses)
      .where(eq(schema.analyses.eventId, eventId))
      .get();

    return row ? rowToRecord(row) : undefined;
  }

  list(page: number, pageSize: number): { data: AnalysisRecord[]; total: number } {
    const offset = (page - 1) * pageSize;

    const data = db
      .select()
      .from(schema.analyses)
      .orderBy(desc(schema.analyses.createdAt))
      .limit(pageSize)
      .offset(offset)
      .all()
      .map(rowToRecord);

    const totalRow = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.analyses)
      .get();

    return { data, total: totalRow?.count ?? 0 };
  }
}

// ─── Helper ────────────────────────────────────────────────────────────────

function rowToRecord(row: typeof schema.analyses.$inferSelect): AnalysisRecord {
  return {
    id:               row.id,
    eventId:          row.eventId,
    status:           row.status as AnalysisStatus,
    ruleResults:      JSON.parse(row.ruleResults) as RuleResult[],
    aiAnalysis:       row.aiAnalysis ? JSON.parse(row.aiAnalysis) as AiAnalysisResponse : null,
    ruleProcessingMs: 0,
    aiProcessingMs:   null,
    createdAt:        row.createdAt,
    updatedAt:        row.updatedAt,
  };
}
