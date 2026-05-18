"use client";

// ── useTwinPageBundleRealtime ──────────────────────────────────────
//
// Phase 1 stub. The full Phase 2 implementation will subscribe to
// the Supabase realtime channel for `pipeline_run_events` and
// transparently refetch the bundle when relevant rows land:
//
//   - entity inserts/updates → System tab refresh
//   - mechanism inserts/status changes → System tab refresh
//   - prediction inserts/resolutions → Outcomes tab refresh
//   - twin_proposals row updates → Overview + Outcomes refresh
//   - pain_metrics inserts/updates → Outcomes refresh
//
// The hook signature here is intentionally complete so consumers can
// adopt it now and get realtime "for free" once Phase 2 lands —
// no caller-site changes will be needed.

import { useEffect } from "react";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

interface Options {
  /** When false, the hook is a no-op even after Phase 2. */
  enabled?: boolean;
}

interface ReturnShape {
  /** Phase 2 will set this to the timestamp of the last realtime event. */
  lastEventAt: string | null;
}

export function useTwinPageBundleRealtime(
  spaceId: string,
  setBundle: (next: TwinPageBundle) => void,
  options: Options = {},
): ReturnShape {
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    // Phase 2: wire Supabase realtime channels here.
    // For now: no-op. The bundle endpoint's 5-min TTL + explicit
    // invalidator helper handle freshness in the absence of pushes.
    void spaceId;
    void setBundle;
  }, [spaceId, setBundle, enabled]);

  return { lastEventAt: null };
}
