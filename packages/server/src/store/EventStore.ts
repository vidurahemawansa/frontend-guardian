import type { GuardianEvent } from "@frontend-guardian/types";

export interface StoredEvent {
  event: GuardianEvent;
  receivedAt: string; // ISO-8601
  sessionId: string;
}

/**
 * Bounded in-memory event store backed by a circular buffer.
 *
 * - O(1) insert / lookup by id
 * - O(n) listing (n = stored events, bounded by maxSize)
 * - Oldest events are evicted when the buffer is full
 */
export class EventStore {
  private readonly maxSize: number;
  /** Ordered insertion ring – index 0 = oldest */
  private readonly ring: StoredEvent[] = [];
  /** Fast id → StoredEvent lookup */
  private readonly index = new Map<string, StoredEvent>();
  /** Session id → set of event ids */
  private readonly sessions = new Map<string, Set<string>>();

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  save(event: GuardianEvent, sessionId: string): void {
    // Evict if full
    if (this.ring.length >= this.maxSize) {
      const oldest = this.ring.shift();
      if (oldest) {
        this.index.delete(oldest.event.id);
        const sess = this.sessions.get(oldest.sessionId);
        sess?.delete(oldest.event.id);
        if (sess?.size === 0) this.sessions.delete(oldest.sessionId);
      }
    }

    const stored: StoredEvent = {
      event,
      receivedAt: new Date().toISOString(),
      sessionId,
    };
    this.ring.push(stored);
    this.index.set(event.id, stored);

    let sessSet = this.sessions.get(sessionId);
    if (!sessSet) { sessSet = new Set(); this.sessions.set(sessionId, sessSet); }
    sessSet.add(event.id);
  }

  getById(id: string): StoredEvent | undefined {
    return this.index.get(id);
  }

  /**
   * Returns up to `limit` most-recent events, newest first.
   * Optionally filtered by category.
   */
  recent(limit: number, category?: GuardianEvent["category"]): StoredEvent[] {
    const all = category
      ? this.ring.filter((s) => s.event.category === category)
      : [...this.ring];
    return all.reverse().slice(0, limit);
  }

  /** All events for a given session id, newest first. */
  bySession(sessionId: string): StoredEvent[] {
    const ids = this.sessions.get(sessionId);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.index.get(id))
      .filter((s): s is StoredEvent => s !== undefined)
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }

  list(page: number, pageSize: number): { data: StoredEvent[]; total: number } {
    const sorted = [...this.ring]
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
    return {
      data: sorted.slice((page - 1) * pageSize, page * pageSize),
      total: sorted.length,
    };
  }

  get size(): number { return this.ring.length; }
}
