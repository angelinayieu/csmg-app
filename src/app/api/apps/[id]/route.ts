// GET    /api/apps/:id  → single app with intervention list
// PATCH  /api/apps/:id  → update config/state/status (user or agent)
// DELETE /api/apps/:id  → retire (soft — sets status='retired')
//
// PATCH is the seam that Sprint 3's agent write-back will use via internal
// imports. For now we log each change into app_versions.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { hydrateApp } from "@/types/app";
import type { AppRow, AppUpdate } from "@/types/app";
import type { InterventionRow } from "@/types/intervention";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: row } = (await db
    .from("apps")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle()) as { data: AppRow | null };

  if (!row) return NextResponse.json({ error: "App not found" }, { status: 404 });

  // Interventions assigned to this app
  const { data: ivRows } = (await db
    .from("interventions")
    .select("*")
    .eq("app_id", id)
    .order("priority", { ascending: true })) as {
    data: InterventionRow[] | null;
  };

  // Sub-space info
  let subSpace: { id: string; name: string } | null = null;
  if (row.sub_space_id) {
    const { data: s } = await db
      .from("spaces")
      .select("id, name")
      .eq("id", row.sub_space_id)
      .maybeSingle();
    subSpace = s ?? null;
  }

  // Latest version
  const { data: latestVer } = await db
    .from("app_versions")
    .select("version, change_summary, change_type, changed_by, changed_at")
    .eq("app_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Parent space's synthesis_data — used by AppRenderer's ResolverTable to
  // hand synthesis_leverage / synthesis_risks / synthesis_scenarios / action_plan
  // data to widgets without a second round-trip.
  const { data: parentSpace } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", row.space_id)
    .maybeSingle();

  // ── Item 4: digital-twin lab data ─────────────────────────────────────
  // Pre-fetch the data the lab widgets (baseline_deviation_tracker,
  // prediction_panel, validation_lab, deviation_signal_feed) bind to.
  // Resolvers are synchronous, so everything must land here or the widgets
  // render empty on first paint and then flicker when the data lands.
  // Query shape:
  //   - Latest strategy_baseline for the space (there's one per strategy
  //     snapshot; most-recent is what "T0 vs now" means today).
  //   - Predictions scoped by space, limited to the last 200 rows which is
  //     already index-friendly via idx_prediction_ledger_space_status.
  //     Widgets filter by status / app_id / tracker_id client-side.
  //   - Deviation rows are a projection of resolved predictions; we use
  //     the dedicated partial index idx_prediction_ledger_surprises for
  //     the surprise feed and a broader filter for the tracker widget.
  const { data: latestBaseline } = await db
    .from("strategy_baselines")
    .select("*")
    .eq("space_id", row.space_id)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: predictionRows } = await db
    .from("prediction_ledger")
    .select("*")
    .eq("space_id", row.space_id)
    .order("predicted_at", { ascending: false })
    .limit(200);

  // ── Tier 3: per-app sub-strategy ──────────────────────────────────
  // The active app_strategies row (if any) + recent version log entries.
  // Widgets that want spec-driven defaults (PredictionPanel reading the
  // sub-strategy's prediction_spec for default horizons, SimulationLab
  // reading perturbation_profiles for one-click scenario seeds) can
  // bind to these fields without a separate fetch.
  //
  // Both queries return cleanly when no sub-strategy exists (legacy
  // apps generated before Tier 3) — the GET endpoint shape stays
  // stable; new fields are nullable.
  const { data: appStrategyRow } = await db
    .from("app_strategies")
    .select("*")
    .eq("app_id", id)
    .eq("status", "active")
    .maybeSingle();

  const { data: appStrategyVersions } = await db
    .from("app_strategy_versions")
    .select("*")
    .eq("app_id", id)
    .order("changed_at", { ascending: false })
    .limit(10);

  // ── Phase 3 VP-Project: experiment taxonomy + variants ───────────
  // The iv_decomposition + variant_carousel widgets bind to these.
  // One taxonomy row per space (inferred by domain-inferrer at end
  // of intake). Variants are fetched with their per-slot rows joined
  // in a second pass so the widgets don't need to round-trip again
  // when the user activates a different variant card.
  const { data: taxonomyRow } = await db
    .from("experiment_taxonomies")
    .select("*")
    .eq("space_id", row.space_id)
    .maybeSingle();

  const { data: variantRows } = await db
    .from("experiment_variants")
    .select("*")
    .eq("space_id", row.space_id)
    .order("is_active", { ascending: false })
    .order("aggregate_quality", { ascending: false, nullsFirst: false })
    .limit(48);

  // Active variant (singular) — hydrated with its per-slot grid rows
  // so the IV decomposition widget can render immediately.
  const activeVariantRow = (variantRows ?? []).find(
    (v: { is_active: boolean }) => v.is_active,
  ) ?? (variantRows ?? [])[0] ?? null;

  let activeVariantSlots: unknown[] = [];
  if (activeVariantRow) {
    const { data: slotRows } = await db
      .from("experiment_variant_slots")
      .select("*")
      .eq("variant_id", activeVariantRow.id);
    activeVariantSlots = slotRows ?? [];
  }

  // ── Phase 3 (Batch 3) — downstream reality: latent dims + scores ──
  // The downstream_reality widget renders a variant × latent-variable
  // heatmap. Two side-by-side fetches here are cheap (both scoped to
  // the space) and mean the widget can render with zero extra
  // round-trips. Both lists are bounded (≤5 latents, ≤20*5=100 scores
  // typically) so we skip pagination for now.
  const { data: latentVariableRows } = await db
    .from("latent_variables")
    .select("*")
    .eq("space_id", row.space_id)
    .order("created_at", { ascending: true });

  const { data: outcomeScoreRows } = await db
    .from("variant_outcome_scores")
    .select("*")
    .eq("space_id", row.space_id);

  // ── Phase 3 (Batch 4) — objective_tree source rows ────────────────
  // Flat list of every goal in the space. The client composes a tree
  // (parent_goal_id → children) inside the resolver memo so widgets
  // can bind to a single root GoalTreeNode without re-querying. Scoped
  // by space_id; order by created_at so the composed tree is stable
  // across renders.
  const { data: goalRows } = await db
    .from("improvement_goals")
    .select("*")
    .eq("space_id", row.space_id)
    .order("created_at", { ascending: true });

  // Batch 8 — canonical signature substrate. Fetch entities that have
  // a materialized node_signature so the constellation widget + future
  // three-panel UI can read them via the `node_signatures` resolver.
  // Selecting only the columns the widget needs keeps payload tight —
  // the full signature lives in the JSONB column already; we attach
  // entity name for the ring labels.
  const { data: entitySigRows } = await db
    .from("entities")
    .select("id, name, node_signature")
    .eq("space_id", row.space_id)
    .not("node_signature", "is", null);

  return NextResponse.json({
    app: hydrateApp(row),
    interventions: ivRows ?? [],
    sub_space: subSpace,
    latest_version: latestVer ?? null,
    synthesis: (parentSpace?.synthesis_data as Record<string, unknown> | null) ?? null,
    // Item 4 digital-twin lab data — consumed by the AppRenderer's
    // ResolverTable. Null/empty-array defaults so widgets can render cleanly
    // on a fresh space before any baseline has been captured.
    strategy_baseline: latestBaseline ?? null,
    predictions: predictionRows ?? [],
    // Tier 3 per-app sub-strategy. Hydrated by callers that want typed
    // access; raw row is fine for widgets that just check existence.
    app_strategy: appStrategyRow ?? null,
    app_strategy_versions: appStrategyVersions ?? [],
    // Phase 3 — VP Project taxonomy data. The client hydrates via
    // hydrateTaxonomy() before feeding the ResolverTable.
    experiment_taxonomy: taxonomyRow ?? null,
    experiment_variants: variantRows ?? [],
    experiment_active_variant: activeVariantRow
      ? { ...activeVariantRow, slots: activeVariantSlots }
      : null,
    // Phase 3 Batch 3 — raw rows; the client composes a
    // DownstreamReality shape via composeDownstreamReality().
    latent_variables: latentVariableRows ?? [],
    variant_outcome_scores: outcomeScoreRows ?? [],
    // Phase 3 Batch 4 — flat improvement_goals array. The client
    // composes a parent→children tree in the objective_tree resolver.
    improvement_goals: goalRows ?? [],
    // Batch 8 — canonical node signatures + their entity names for the
    // signature_constellation widget. Resolver wraps these into
    // ConstellationItem[] at read time.
    node_signature_entities: entitySigRows ?? [],
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const patch = (body ?? {}) as Record<string, unknown>;

  // Fetch prior row (ownership check + snapshot source)
  const { data: prior } = (await db
    .from("apps")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle()) as { data: AppRow | null };

  if (!prior) return NextResponse.json({ error: "App not found" }, { status: 404 });

  // Whitelist patchable fields — do NOT let callers change ownership or source provenance
  const allowed: (keyof AppUpdate)[] = [
    "name",
    "description",
    "app_type",
    "status",
    "priority",
    "complexity",
    "config",
    "state",
    "dominant_entity_ids",
    "dominant_entity_codes",
    "serves_goal_id",
    "serves_sub_objective_ids",
    "tracked_metric_tracker_ids",
    "sub_space_id",
    "health_score",
    "stale_reason",
    "stale_since",
    "last_updated_by",
    "last_refreshed_at",
  ];

  const update: AppUpdate = {};
  for (const k of allowed) {
    if (k in patch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (update as any)[k] = patch[k];
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No patchable fields provided" }, { status: 400 });
  }

  const { data: updated, error } = await db
    .from("apps")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[apps patch] error:", error);
    return NextResponse.json({ error: "Failed to update app" }, { status: 500 });
  }

  // Record version row
  try {
    const { data: maxVer } = await db
      .from("app_versions")
      .select("version")
      .eq("app_id", id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxVer?.version ?? 0) + 1;

    const changedBy =
      typeof patch.changed_by === "string"
        ? patch.changed_by
        : (updated.last_updated_by as string | null) ?? `user:${user.id}`;

    const changeType =
      typeof patch.change_type === "string" && ["user_edit", "agent_update", "staleness_refresh"].includes(patch.change_type as string)
        ? (patch.change_type as "user_edit" | "agent_update" | "staleness_refresh")
        : "user_edit";

    await db.from("app_versions").insert({
      app_id: id,
      version: nextVersion,
      config_snapshot: updated.config,
      state_snapshot: updated.state,
      change_summary:
        typeof patch.change_summary === "string"
          ? patch.change_summary
          : `Updated: ${Object.keys(update).join(", ")}`,
      change_type: changeType,
      changed_by: changedBy,
      change_payload: { patched_fields: Object.keys(update) },
    });
  } catch (verErr) {
    console.warn("[apps patch] version insert failed:", verErr);
  }

  return NextResponse.json({ app: hydrateApp(updated) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Soft delete — set status='retired'. Preserves history + interventions.
  const { error } = await db
    .from("apps")
    .update({ status: "retired", last_updated_by: `user:${user.id}` })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[apps delete] error:", error);
    return NextResponse.json({ error: "Failed to retire app" }, { status: 500 });
  }

  return NextResponse.json({ success: true, status: "retired" });
}
