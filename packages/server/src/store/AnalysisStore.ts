import type { RuleResult } from "../engine/types.js";
import type { AiAnalysisResponse } from "../ai/types.js";

export type AnalysisStatus = "rule_complete" | "ai_pending" | "ai_complete" | "ai_failed" | "ai_disabled";

export interface AnalysisRecord {
  eventId: string;
  status: AnalysisStatus;
  ruleResults: RuleResult[];
  /** null until AI finishes or is disabled */
  aiAnalysis: AiAnalysisResponse | null;
  ruleProcessingMs: number;
  aiProcessingMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export class AnalysisStore {
  private readonly maxSize: number;
  private readonly ring: AnalysisRecord[] = [];
  private readonly index = new Map<string, AnalysisRecord>();

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  save(record: AnalysisRecord): void {
    if (this.ring.length >= this.maxSize) {
      const oldest = this.ring.shift();
      if (oldest) this.index.delete(oldest.eventId);
    }
    this.ring.push(record);
    this.index.set(record.eventId, record);
  }

  /** Patch an existing record in-place (e.g. when AI completes asynchronously). */
  patch(eventId: string, patch: Partial<AnalysisRecord>): void {
    const rec = this.index.get(eventId);
    if (!rec) return;
    Object.assign(rec, { ...patch, updatedAt: new Date().toISOString() });
  }

  getByEventId(eventId: string): AnalysisRecord | undefined {
    return this.index.get(eventId);
  }

  list(page: number, pageSize: number): { data: AnalysisRecord[]; total: number } {
    const sorted = [...this.ring]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return {
      data: sorted.slice((page - 1) * pageSize, page * pageSize),
      total: sorted.length,
    };
  }
}
