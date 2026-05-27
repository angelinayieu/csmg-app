// ── Sub-Objective Decision Log helpers ─────────────────────────────
//
// Thin wrapper over the sub_objective_decisions table. Two functions:
//
//   logDecision(db, args)
//     Append-only insert. Fire-and-forget from the route handlers —
//     a failure here MUST NOT block the user-facing PATCH. We log the
//     warning and swallow.
//
//   getUserIntentPreferences(db, userId)
//     Computes the user's revealed-preference distribution across the
//     six lab intents from their last ~50 elect/reject events. Returns
//     a sorted list with election rate per intent. Drives the
//     "Suggested intent" in the variant lab bar when no lens-gap
//     signal is present.
//
// Both are intentionally simple — preference learning becomes more
// sophisticated later (recency weighting, domain segmentation,
// A/B); the current version is the minimum viable flywheel start.

import type { SubObjectiveIntent } from "./sub-objective-state";

export type DecisionAction =
  | "elect"
  | "reject"
  | "defer"
  | "clear"
  | "generate_batch"
  | "confirm"
  // Phase 9 — Lab Notebook event types. The DB CHECK constraint
  // is extended in migration 20260828_lab_notebook_phase9 to
  // accept these. Earlier callers still use the original six.
  | "rd_iterate"
  | "score"
  | "approve_bet"
  | "compose"
  | "autopilot_run"
  | "autopilot_iteration"
  // Phase 10a — system events + cross-room curation. The CHECK
  // constraint is extended in 20260829_phase10a_notebook_events.
  // sub_objective_id null = space-scoped event (stage / constraints /
  // findings / themes / concepts).
  | "room_generated"
  | "item_expanded"
  | "expansion_spawned"
  | "prototype_status_changed"
  | "finding_acknowledged"
  | "finding_dismissed"
  | "finding_resolved"
  | "theme_distilled"
  | "concept_branched"
  | "constraints_set"
  | "stage_transitioned"
  // Phase 11.4 — causal chain enrichment. Fires once per room per
  // enrichment run (either via the explicit /enrich-chains endpoint
  // or as Step 2 of the canvas autopilot). Metadata carries chain
  // counts + avg_chain_strength + orphans_closed so the notebook can
  // render "enriched 6 chains · avg strength 0.71 · 2 orphans closed".
  | "chains_enriched"
  // Phase 11.6 — indicator baseline set. Fires whenever the user
  // (or the LLM via expansion-tree calibration_baseline auto-fill)
  // sets a baseline + target on an outcome's indicator. Metadata
  // carries indicator_name, baseline_value, target_value, unit,
  // source: "user" | "llm" so the chat agent can reference the
  // measurement context when reasoning about projected delta.
  | "baseline_set";

export interface LogDecisionArgs {
  userId: string;
  spaceId: string;
  /** Phase 9 — finer-grained scope so the Lab Notebook can filter
   *  to ONE room. Backward-compatible: pre-Phase-9 callers can omit
   *  it and the row stays scoped to space_id only. */
  subObjectiveId?: string | null;
  proposalId?: string | null;
  action: DecisionAction;
  batchIntent?: SubObjectiveIntent | null;
  metadata?: Record<string, unknown>;
}

/** Append a decision row. Soft-fail by design — logging is telemetry,
 *  it must never break the user flow. Callers should `void` this. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logDecision(db: any, args: LogDecisionArgs): Promise<void> {
  try {
    const { error } = await db.from("sub_objective_decisions").insert({
      user_id: args.userId,
      space_id: args.spaceId,
      sub_objective_id: args.subObjectiveId ?? null,
      proposal_id: args.proposalId ?? null,
      action: args.action,
      batch_intent: args.batchIntent ?? null,
      metadata: args.metadata ?? {},
    });
    if (error) {
      console.warn("[decision-log] insert failed:", error.message);
    }
  } catch (err) {
    console.warn(
      "[decision-log] insert threw:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export interface IntentPreference {
  intent: SubObjectiveIntent;
  /** How many elect events on proposals from this intent's batches. */
  elects: number;
  /** How many reject events. */
  rejects: number;
  /** elects / (elects + rejects) — undefined when no signal at all. */
  rate: number | null;
  /** elects - rejects, used as a fallback rank when rate is shared. */
  net: number;
}

const ALL_INTENTS: SubObjectiveIntent[] = [
  "initial",
  "creative",
  "concrete",
  "contrarian",
  "gap_fill",
  "ambitious",
  "wildcard",
];

/** Compute per-intent revealed preferences from the user's last
 *  ~200 disposition events (recent enough to capture current taste,
 *  large enough to not be noisy on a single early choice). Returns
 *  intents sorted by election rate desc, falling back to net count
 *  when rates tie.
 *
 *  Returns an entry for every intent (even unobserved ones) with
 *  rate=null + elects=0 + rejects=0 — keeps the caller branch-free. */
export async function getUserIntentPreferences(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
): Promise<IntentPreference[]> {
  try {
    const { data, error } = await db
      .from("sub_objective_decisions")
      .select("action, batch_intent")
      .eq("user_id", userId)
      .in("action", ["elect", "reject"])
      .not("batch_intent", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.warn(
        "[decision-log] preference read failed:",
        error.message,
      );
      return emptyPreferences();
    }
    return aggregatePreferences(
      (data as Array<{ action: string; batch_intent: string }> | null) ?? [],
    );
  } catch (err) {
    console.warn(
      "[decision-log] preference threw:",
      err instanceof Error ? err.message : String(err),
    );
    return emptyPreferences();
  }
}

/** Pick the user's top-preferred intent for the variant lab's
 *  "Suggested" affordance, excluding "initial" (which is the
 *  first-pass baseline, not a regen intent). Returns null when the
 *  user has no signal yet — caller falls back to a static default
 *  (typically "creative"). */
export function topPreferredIntent(
  prefs: IntentPreference[],
): SubObjectiveIntent | null {
  for (const p of prefs) {
    if (p.intent === "initial") continue;
    if (p.rate !== null) return p.intent;
  }
  return null;
}

/** Cross-user / global preference aggregation. Reads the last ~2000
 *  elect+reject events across ALL users (no user_id filter), grouped
 *  by intent. Used as the fallback below per-user prefs: when the
 *  user is brand new and has no signal, surface the population's
 *  revealed-pattern instead of a hardcoded "creative" default.
 *
 *  This is the second-layer flywheel — per-user prefs personalize for
 *  individual taste; global prefs bootstrap new users with the
 *  community's discovered patterns.
 *
 *  NOTE: This bypasses RLS via the service-role assumption (called
 *  server-side only). If you ever move this to the client, you'll
 *  need a SECURITY DEFINER RPC instead — the user policies on
 *  sub_objective_decisions only allow self-read. */
export async function getGlobalIntentPreferences(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
): Promise<IntentPreference[]> {
  try {
    const { data, error } = await db
      .from("sub_objective_decisions")
      .select("action, batch_intent")
      .in("action", ["elect", "reject"])
      .not("batch_intent", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) {
      // Most common cause: RLS blocks (caller is not service-role).
      // Silent fail back to empty — caller uses static default.
      console.warn(
        "[decision-log] global preference read failed:",
        error.message,
      );
      return emptyPreferences();
    }
    return aggregatePreferences(
      (data as Array<{ action: string; batch_intent: string }> | null) ?? [],
    );
  } catch (err) {
    console.warn(
      "[decision-log] global preference threw:",
      err instanceof Error ? err.message : String(err),
    );
    return emptyPreferences();
  }
}

function emptyPreferences(): IntentPreference[] {
  return ALL_INTENTS.map((intent) => ({
    intent,
    elects: 0,
    rejects: 0,
    rate: null,
    net: 0,
  }));
}

/** Per-variation-kind preference signal (cf. IntentPreference). The
 *  variation system has its own axis ("kind": alternative / additive /
 *  principle) distinct from the sub-objective batch_intent axis, so
 *  per-kind preferences are computed from the variation-disposition
 *  log entries (those carry metadata.entity_type = "variation" and
 *  metadata.variation_kind). */
export interface VariationKindPreference {
  kind: "alternative" | "additive" | "principle";
  elects: number;
  rejects: number;
  /** elects / (elects + rejects). null when no signal yet. */
  rate: number | null;
  /** elects - rejects, used to break ties. */
  net: number;
  /** Total touches (elects + rejects). Useful for cold-start gating
   *  in the caller — only inject the soft signal once ≥10 total
   *  events exist to avoid reacting to 1-2 elections. */
  total: number;
}

const ALL_KINDS: VariationKindPreference["kind"][] = [
  "alternative",
  "additive",
  "principle",
];

/** Per-user per-kind election pattern for the item-detail variation
 *  lab. Reads sub_objective_decisions rows tagged
 *  metadata.entity_type='variation' (written by item/variation/
 *  disposition route, Polish-3). Used by expand-item-detail to bias
 *  borderline kind decisions toward the user's revealed pattern —
 *  soft signal, NOT a hard rule. Caller should gate on total ≥10
 *  to avoid filter-bubble lock-in from a tiny event count.
 *
 *  Returns one entry per kind (zeroed when no signal), sorted by
 *  rate desc with nulls last. */
export async function getUserVariationKindPreferences(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
): Promise<VariationKindPreference[]> {
  try {
    // Filter on JSONB key: supabase-js translates this to a -> ->>
    // expression on metadata.entity_type. The metadata column is jsonb
    // (default '{}'::jsonb per migration) so reads never break.
    const { data, error } = await db
      .from("sub_objective_decisions")
      .select("action, metadata")
      .eq("user_id", userId)
      .in("action", ["elect", "reject"])
      .eq("metadata->>entity_type", "variation")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.warn(
        "[decision-log] variation-kind preference read failed:",
        error.message,
      );
      return emptyKindPreferences();
    }
    return aggregateKindPreferences(
      (data as Array<{ action: string; metadata: Record<string, unknown> }> | null) ?? [],
    );
  } catch (err) {
    console.warn(
      "[decision-log] variation-kind preference threw:",
      err instanceof Error ? err.message : String(err),
    );
    return emptyKindPreferences();
  }
}

function emptyKindPreferences(): VariationKindPreference[] {
  return ALL_KINDS.map((kind) => ({
    kind,
    elects: 0,
    rejects: 0,
    rate: null,
    net: 0,
    total: 0,
  }));
}

function aggregateKindPreferences(
  rows: Array<{ action: string; metadata: Record<string, unknown> }>,
): VariationKindPreference[] {
  const counts = new Map<
    VariationKindPreference["kind"],
    { elects: number; rejects: number }
  >();
  for (const k of ALL_KINDS) counts.set(k, { elects: 0, rejects: 0 });
  for (const r of rows) {
    const md = r.metadata ?? {};
    const kindRaw =
      typeof md.variation_kind === "string" ? md.variation_kind : "";
    if (!(ALL_KINDS as string[]).includes(kindRaw)) continue;
    const cell = counts.get(kindRaw as VariationKindPreference["kind"])!;
    if (r.action === "elect") cell.elects += 1;
    else if (r.action === "reject") cell.rejects += 1;
  }
  const out: VariationKindPreference[] = ALL_KINDS.map((kind) => {
    const { elects, rejects } = counts.get(kind)!;
    const total = elects + rejects;
    return {
      kind,
      elects,
      rejects,
      rate: total > 0 ? elects / total : null,
      net: elects - rejects,
      total,
    };
  });
  out.sort((a, b) => {
    if (a.rate === null && b.rate === null) return 0;
    if (a.rate === null) return 1;
    if (b.rate === null) return -1;
    if (b.rate !== a.rate) return b.rate - a.rate;
    return b.net - a.net;
  });
  return out;
}

/** Cold-start gate — only return preferences when there's enough
 *  signal to act on. Returns null when total events across all kinds
 *  is below the threshold so callers can branch cleanly.
 *  Default threshold matches my design note (≥10 to avoid 1-2 event
 *  reactions). */
export function variationKindSignalIsLive(
  prefs: VariationKindPreference[],
  threshold = 10,
): boolean {
  const total = prefs.reduce((sum, p) => sum + p.total, 0);
  return total >= threshold;
}

/** Shared aggregator — counts elect / reject events per intent and
 *  sorts by rate desc (null rates last). Extracted so per-user and
 *  global preference functions can share it. */
function aggregatePreferences(
  rows: Array<{ action: string; batch_intent: string }>,
): IntentPreference[] {
  const counts = new Map<
    SubObjectiveIntent,
    { elects: number; rejects: number }
  >();
  for (const intent of ALL_INTENTS) {
    counts.set(intent, { elects: 0, rejects: 0 });
  }
  for (const r of rows) {
    const intent = r.batch_intent as SubObjectiveIntent;
    if (!ALL_INTENTS.includes(intent)) continue;
    const cell = counts.get(intent)!;
    if (r.action === "elect") cell.elects += 1;
    else if (r.action === "reject") cell.rejects += 1;
  }
  const prefs: IntentPreference[] = ALL_INTENTS.map((intent) => {
    const { elects, rejects } = counts.get(intent)!;
    const total = elects + rejects;
    return {
      intent,
      elects,
      rejects,
      rate: total > 0 ? elects / total : null,
      net: elects - rejects,
    };
  });
  prefs.sort((a, b) => {
    if (a.rate === null && b.rate === null) return 0;
    if (a.rate === null) return 1;
    if (b.rate === null) return -1;
    if (b.rate !== a.rate) return b.rate - a.rate;
    return b.net - a.net;
  });
  return prefs;
}
