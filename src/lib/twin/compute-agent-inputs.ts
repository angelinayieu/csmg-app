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
 * Plain-English summary of the most recent material change to the
 * space, suitable for the Narrator's `recentChangeNote` slot. Reads
 * the latest space_changelog row within the last 30 days and renders
 * "${summary} (${daysAgo}d ago)". Older changes get suppressed —
 * a 6-month-old "approved strategy" is no longer "recent."
 *
 * Returns null when no recent activity exists; the narrator handles
 * null as "no recent material changes."
 */
export async function computeRecentChangeNote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
): Promise<string | null> {
  try {
    const { data } = await db
      .from("space_changelog")
      .select("summary, change_type, created_at")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = data as any | null;
    if (!row?.created_at) return null;

    const days = daysAgo(row.created_at);
    if (days === null || days > 30) return null;

    // Prefer the human-readable summary when present; fall back to a
    // sentence-cased change_type so we never return a code-shape
    // string the agent can't parse cleanly.
    const summary =
      typeof row.summary === "string" && row.summary.trim().length > 0
        ? row.summary.trim()
        : prettyChangeType(row.change_type as string | null);
    if (!summary) return null;

    const when = days === 0 ? "today" : `${days}d ago`;
    return `${summary} (${when})`;
  } catch (err) {
    console.warn("[compute-agent-inputs] recent change note failed:", err);
    return null;
  }
}

function prettyChangeType(kind: string | null): string | null {
  if (!kind) return null;
  // Replace underscores with spaces + capitalize first word.
  const cleaned = kind.replace(/_/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
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
