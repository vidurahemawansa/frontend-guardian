import type { EventSummary, ErrorEvent, AiAnalysis, PaginatedResponse } from "@frontend-guardian/types";

const BASE = "/api";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ─── Health Score types ───────────────────────────────────────────────────────

export type CategoryKey = "errors" | "performance" | "scalability" | "architecture";
export type CategoryStatus = "excellent" | "good" | "fair" | "poor" | "critical";
export type Grade = "A" | "B" | "C" | "D" | "F";
export type Trend = "improving" | "stable" | "degrading";
export type RuleIssueSeverity = "critical" | "error" | "warning" | "info";

export interface SeverityCounts {
  critical: number;
  error:    number;
  warning:  number;
  info:     number;
}

export interface CategoryIssueGroup {
  ruleId:           string;
  title:            string;
  severity:         RuleIssueSeverity;
  issueType:        string;
  description:      string;
  recommendation:   string;
  occurrences:      number;
  affectedEventIds: string[];
}

export interface CategoryScore {
  score:     number;
  grade:     Grade;
  status:    CategoryStatus;
  label:     string;
  emoji:     string;
  counts:    SeverityCounts;
  topIssues: CategoryIssueGroup[];
}

export interface HealthScoreCard {
  overall:    number;
  grade:      Grade;
  trend:      Trend;
  categories: Record<CategoryKey, CategoryScore>;
  computedAt: string;
  windowMs:   number;
  eventCount: number;
  issueCount: number;
}

// ─── API client ──────────────────────────────────────────────────────────────

export const api = {
  // Events
  getEvents(page = 1, pageSize = 20): Promise<PaginatedResponse<EventSummary>> {
    return request(`/events?page=${page}&pageSize=${pageSize}`);
  },

  getEvent(id: string): Promise<{ event: ErrorEvent; analysis: AiAnalysis | null }> {
    return request(`/events/${id}`);
  },

  // Health Score
  getHealthScore(windowMs = 3_600_000): Promise<HealthScoreCard> {
    return request(`/health/score?windowMs=${windowMs}`);
  },

  getCategoryDetail(category: CategoryKey, windowMs = 3_600_000): Promise<CategoryScore & {
    category: CategoryKey;
    overall: number;
    computedAt: string;
    windowMs: number;
  }> {
    return request(`/health/score/${category}?windowMs=${windowMs}`);
  },
};
