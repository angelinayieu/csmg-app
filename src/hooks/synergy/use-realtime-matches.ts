// ── useRealtimeMatches ──
//
// Subscribes the caller to component_matches INSERT events where
// EITHER side belongs to one of the user's own components. The hook
// pre-fetches the user's component_ids once on mount (since the
// Supabase realtime filter can match on either component_a OR
// component_b, we use a single channel with no filter and gate
// client-side — there's no `or` filter syntax in postgres_changes).
//
// Each new match fires the `onMatch` callback with a minimal hint
// (the row payload + which side is mine). The consumer decides
// what to do — toast, badge bump, live-prepend to a feed, etc.
//
// RLS gates which payloads reach the channel — Supabase enforces
// the component_matches_owner_read policy at the publication layer,
// so non-matching INSERTs never arrive in the first place. Our
// client-side gate is a safety net.

"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface ComponentMatchRow {
  id: string;
  component_a: string;
  component_b: string;
  match_kind: string;
  final_score: number;
  rationale: string;
  computed_at: string;
}

export interface RealtimeMatchEvent {
  matchId: string;
  finalScore: number;
  mineComponentId: string;
  theirComponentId: string;
  rationale: string;
  computedAt: string;
}

export function useRealtimeMatches(
  enabled: boolean,
  onMatch: (event: RealtimeMatchEvent) => void,
) {
  // Stash the callback in a ref so the channel doesn't tear down on
  // every parent re-render. Consumer-side stability matters because
  // building/destroying the Supabase channel is heavy.
  const cbRef = useRef(onMatch);
  cbRef.current = onMatch;

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let cancelled = false;
    let myComponentIds = new Set<string>();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    // Cache the component ids client-side so we can gate INSERT
    // payloads without a per-event DB query. Refresh every 60s in
    // case the user publishes new components mid-session.
    const refresh = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("brainstorm_components")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select("id" as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq("owner_id" as any, user.id);
      if (cancelled || !data) return;
      myComponentIds = new Set(
        (data as Array<{ id: string }>).map((r) => r.id),
      );
    };
    void refresh();
    const refreshInterval = window.setInterval(refresh, 60_000);

    channel = supabase
      .channel("synergy_matches_arrivals")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "component_matches",
        },
        (payload) => {
          const row = payload.new as ComponentMatchRow;
          if (!row) return;
          // Client-side gate: only fire if either side is mine. RLS
          // should already prevent foreign payloads from reaching
          // here, but this is the belt-and-suspenders check.
          const mineIsA = myComponentIds.has(row.component_a);
          const mineIsB = myComponentIds.has(row.component_b);
          if (!mineIsA && !mineIsB) return;
          cbRef.current({
            matchId: row.id,
            finalScore: row.final_score,
            mineComponentId: mineIsA ? row.component_a : row.component_b,
            theirComponentId: mineIsA ? row.component_b : row.component_a,
            rationale: row.rationale,
            computedAt: row.computed_at,
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      if (channel) supabase.removeChannel(channel);
    };
  }, [enabled]);
}
