// ── Research bundle persistence ───────────────────────────────────
//
// Wraps the runSurfacePass / runDeepPass calls with DB write +
// pending-state housekeeping so the start / complete routes can
// kick them off in one line each.
//
// These functions return a Promise<void>. The callers usually
// `void` them (fire-and-forget) — but you can also await for
// synchronous behavior in tests or batch jobs.

import {
  runSurfacePass,
  runDeepPass,
  type SurfaceBundle,
  type DeepBundle,
} from "./research-service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

/**
 * Surface pass: mark pending → run → persist. Catches all errors;
 * never throws. Logs to console on failure so we have telemetry.
 */
export async function surfacePassToDb(
  db: AnySupabase,
  spaceId: string,
  objective: string,
): Promise<SurfaceBundle> {
  // Mark pending so polling clients see something while we work.
  try {
    await db
      .from("spaces")
      .update({
        surface_research: {
          status: "pending",
          started_at: new Date().toISOString(),
        },
      })
      .eq("id", spaceId);
  } catch (err) {
    console.warn("[surfacePassToDb] pending-write failed:", err);
  }

  let bundle: SurfaceBundle;
  try {
    bundle = await runSurfacePass({ objective });
  } catch (err) {
    console.warn("[surfacePassToDb] runSurfacePass threw:", err);
    bundle = {
      status: "error",
      sources: [],
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };
  }

  try {
    await db
      .from("spaces")
      .update({ surface_research: bundle })
      .eq("id", spaceId);
  } catch (err) {
    console.warn("[surfacePassToDb] persist-write failed:", err);
  }

  return bundle;
}

/**
 * Deep pass: marks pending → runs → persists. Takes the full
 * inputs the deep pass needs.
 */
export async function deepPassToDb(
  db: AnySupabase,
  spaceId: string,
  args: {
    objective: string;
    clarifyingAnswers: Array<{ question: string; answer: string }>;
    surface: SurfaceBundle | null;
  },
): Promise<DeepBundle> {
  try {
    await db
      .from("spaces")
      .update({
        deep_research: {
          status: "pending",
          started_at: new Date().toISOString(),
        },
      })
      .eq("id", spaceId);
  } catch (err) {
    console.warn("[deepPassToDb] pending-write failed:", err);
  }

  let bundle: DeepBundle;
  try {
    bundle = await runDeepPass({
      objective: args.objective,
      clarifyingAnswers: args.clarifyingAnswers,
      surface: args.surface ?? undefined,
    });
  } catch (err) {
    console.warn("[deepPassToDb] runDeepPass threw:", err);
    bundle = {
      status: "error",
      all_sources: [],
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };
  }

  try {
    await db
      .from("spaces")
      .update({ deep_research: bundle })
      .eq("id", spaceId);
  } catch (err) {
    console.warn("[deepPassToDb] persist-write failed:", err);
  }

  return bundle;
}
