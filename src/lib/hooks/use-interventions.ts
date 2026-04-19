"use client";

import { useCallback, useEffect, useState } from "react";
import type { Intervention } from "@/types/intervention";

interface UseInterventionsArgs {
  spaceId?: string | null;
  appId?: string | null;
  status?: string | null;
}

interface UseInterventionsResult {
  interventions: Intervention[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches Interventions — scoped by space and/or app.
 * Mirrors GET /api/interventions, preserving join fields (target_entity_name, app_name).
 */
export function useInterventions({
  spaceId,
  appId,
  status,
}: UseInterventionsArgs): UseInterventionsResult {
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [loading, setLoading] = useState(Boolean(spaceId || appId));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!spaceId && !appId) {
      setInterventions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (spaceId) params.set("spaceId", spaceId);
      if (appId) params.set("appId", appId);
      if (status) params.set("status", status);
      const res = await fetch(`/api/interventions?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error ?? `Failed to load interventions (HTTP ${res.status})`
        );
      }
      const json = (await res.json()) as { interventions: Intervention[] };
      setInterventions(json.interventions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load interventions");
    } finally {
      setLoading(false);
    }
  }, [spaceId, appId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return { interventions, loading, error, refresh: load };
}
