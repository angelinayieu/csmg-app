// ── invalidateTwinDashboardCache ───────────────────────────────────
//
// Single helper called by every endpoint that mutates twin-relevant
// state. Sets twin_dashboard_cache + twin_dashboard_cache_at to null
// so the next GET /twin-page-bundle rebuilds from fresh data.
//
// Callers (Phase 0 + later):
//   - Observation log endpoint (after Skeptic agent + calibration)
//   - Mechanism materialization (when new mechanism rows are inserted)
//   - Narrator refresh endpoint
//   - Pain metric update endpoint (when current_value changes)
//   - Strategy approval (downstream of strategy-engine completion)
//
// Soft-fail by design — cache invalidation should never block the
// triggering write. If it errors, the next GET still works (it'll
// see stale data for up to 5 minutes via the TTL fallback).

// Loose typing — the helper is called from many routes with
// different Supabase client shapes (server-component, route-handler,
// service-role). Each works because we only call .from().update().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export async function invalidateTwinDashboardCache(
  supabase: SupabaseLike,
  spaceId: string,
): Promise<void> {
  try {
    await supabase
      .from("spaces")
      .update({
        twin_dashboard_cache: null,
        twin_dashboard_cache_at: null,
      })
      .eq("id", spaceId);
  } catch (err) {
    console.warn(
      `[invalidateTwinDashboardCache] failed for space ${spaceId}:`,
      err,
    );
  }
}
