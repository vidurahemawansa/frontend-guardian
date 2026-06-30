import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { GuardianEvent } from "@frontend-guardian/types";

export interface StoredEvent {
  event:      GuardianEvent;
  receivedAt: string;
  sessionId:  string;
  user?: {
    id?:    string;
    email?: string;
    name?:  string;
  };
}

/**
 * SQLite-backed event store.
 * Public interface is identical to the old in-memory version —
 * nothing else in the codebase needs to change.
 */
export class EventStore {
  save(event: GuardianEvent, sessionId: string, user?: StoredEvent["user"]): void {
    db.insert(schema.events).values({
      id:          event.id,
      sessionId,
      kind:        event.category,
      environment: (event as { environment?: string }).environment ?? "unknown",
      payload:     JSON.stringify(event),
      receivedAt:  new Date().toISOString(),
      userId:      user?.id    ?? null,
      userEmail:   user?.email ?? null,
      userName:    user?.name  ?? null,
    })
    // Silently ignore duplicate IDs (idempotent ingestion)
    .onConflictDoNothing()
    .run();
  }

  getById(id: string): StoredEvent | undefined {
    const row = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .get();

    return row ? rowToStoredEvent(row) : undefined;
  }

  recent(limit: number, category?: GuardianEvent["category"]): StoredEvent[] {
    const query = db
      .select()
      .from(schema.events)
      .orderBy(desc(schema.events.receivedAt))
      .limit(limit);

    const rows = query.all();

    return rows
      .filter((r) => !category || r.kind === category)
      .map(rowToStoredEvent);
  }

  bySession(sessionId: string): StoredEvent[] {
    return db
      .select()
      .from(schema.events)
      .where(eq(schema.events.sessionId, sessionId))
      .orderBy(desc(schema.events.receivedAt))
      .all()
      .map(rowToStoredEvent);
  }

  list(page: number, pageSize: number): { data: StoredEvent[]; total: number } {
    const offset = (page - 1) * pageSize;

    const data = db
      .select()
      .from(schema.events)
      .orderBy(desc(schema.events.receivedAt))
      .limit(pageSize)
      .offset(offset)
      .all()
      .map(rowToStoredEvent);

    const totalRow = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.events)
      .get();

    return { data, total: totalRow?.count ?? 0 };
  }

  get size(): number {
    return db
      .select({ count: sql<number>`count(*)` })
      .from(schema.events)
      .get()?.count ?? 0;
  }
}

// ─── Helper ────────────────────────────────────────────────────────────────

function rowToStoredEvent(row: typeof schema.events.$inferSelect): StoredEvent {
  return {
    event:      JSON.parse(row.payload) as GuardianEvent,
    receivedAt: row.receivedAt,
    sessionId:  row.sessionId,
    user: (row.userId ?? row.userEmail ?? row.userName)
      ? { id: row.userId ?? undefined, email: row.userEmail ?? undefined, name: row.userName ?? undefined }
      : undefined,
  };
}
