import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import type { HealthScoreCard } from "../lib/api.js";

const REFRESH_INTERVAL_MS = 30_000;

export interface UseHealthScoreResult {
  data:    HealthScoreCard | null;
  loading: boolean;
  error:   string | null;
  refresh: () => void;
  windowMs: number;
  setWindowMs: (ms: number) => void;
}

export function useHealthScore(): UseHealthScoreResult {
  const [data,     setData]     = useState<HealthScoreCard | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [windowMs, setWindowMs] = useState(3_600_000);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const score = await api.getHealthScore(windowMs);
      setData(score);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load health score");
    } finally {
      setLoading(false);
    }
  }, [windowMs]);

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  return { data, loading, error, refresh: load, windowMs, setWindowMs };
}
