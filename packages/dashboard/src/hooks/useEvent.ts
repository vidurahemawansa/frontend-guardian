import { useEffect, useState } from "react";
import type { ErrorEvent, AiAnalysis } from "@frontend-guardian/types";
import { api } from "../lib/api.js";

export function useEvent(id: string) {
  const [event, setEvent] = useState<ErrorEvent | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .getEvent(id)
      .then(({ event: e, analysis: a }) => {
        setEvent(e);
        setAnalysis(a);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  return { event, analysis, loading, error };
}
