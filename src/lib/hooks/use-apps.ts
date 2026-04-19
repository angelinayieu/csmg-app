"use client";

import { useCallback, useEffect, useState } from "react";
import type { App } from "@/types/app";

// Client-side view of an App — mirrors the server's GET /api/apps response shape.
// Adds the joined fields (intervention_count, sub_space_name, serves_goal_title).
export interface AppView extends App {
  intervention_count?: number;
  interventions_completed?: number;
  sub_space_name?: string | null;
  serves_goal_title?: string | null;
}

interface UseAppsResult {
  apps: AppView[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches Apps for a space from the /api/apps endpoint.
 *
 * Purposefully minimal: the data is small (dozens of apps max per space) and
 * the dashboard can re-fetch on user actions — no need for SWR here.
 */
export function useApps(spaceId: string | undefined | null): UseAppsResult {
  const [apps, setApps] = useState<AppView[]>([]);
  const [loading, setLoading] = useState(Boolean(spaceId));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!spaceId) {
      setApps([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps?spaceId=${encodeURIComponent(spaceId)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to load apps (HTTP ${res.status})`);
      }
      const json = (await res.json()) as { apps: AppView[] };
      setApps(json.apps ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load apps");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { apps, loading, error, refresh: load };
}
