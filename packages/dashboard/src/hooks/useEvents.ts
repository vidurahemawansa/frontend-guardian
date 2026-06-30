import { useEffect, useState } from "react";
import type { EventSummary, PaginatedResponse } from "@frontend-guardian/types";
import { api } from "../lib/api.js";

export function useEvents(page = 1) {
  const [data, setData] = useState<PaginatedResponse<EventSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getEvents(page)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [page]);

  return { data, loading, error };
}
