// ── Twin agent input enrichers ─────────────────────────────────────
//
// W6. Helpers that fill the previously-null `daysSinceLastObservation`
// + `daysSinceLastPrediction` fields the Narrator and Coach agents
// read. Pure data-fetch + arithmetic — no agent calls — so they
// drop into both the bundle endpoint and the dedicated refresh
// endpoints without behavior drift.
//
// Soft-fail throughout: any query error returns null and the
// agent's prompt simply treats it as "never observed / never run."

export interface EnrichedAgentTimings {
  daysSinceLastObservation: number | null;
  daysSinceLastPrediction: number | null;
}

const MS_PER_DAY = 86_400_000;

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = Date.now() - t;
  if (diff < 0) return 0; // future-dated observation/prediction — show as "today"
  return Math.round(diff / MS_PER_DAY);
}

/**
 * Computes days-since for the two narrator/coach time signals in a
 * single round-trip. Pass the supabase-typed `db` from the caller —
 * we don't import the supabase client here to keep this module
 * adapter-agnostic.
 */
export async function computeAgentTimings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
): Promise<EnrichedAgentTimings> {
  try {
    const [obsRes, predRes] = await Promise.all([
      db
        .from("observations")
        .select("observed_at")
        .eq("space_id", spaceId)
        .eq("user_id", userId)
        .order("observed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("prediction_ledger")
        .select("predicted_at")
        .eq("space_id", spaceId)
        .eq("user_id", userId)
        .order("predicted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latestObs = (obsRes?.data as any)?.observed_at as string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latestPred = (predRes?.data as any)?.predicted_at as string | null;

    return {
      daysSinceLastObservation: daysAgo(latestObs),
      daysSinceLastPrediction: daysAgo(latestPred),
    };
  } catch (err) {
    console.warn("[compute-agent-inputs] query failed:", err);
    return {
      daysSinceLastObservation: null,
      daysSinceLastPrediction: null,
    };
  }
}
