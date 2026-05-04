// GET  /api/apps?spaceId=<uuid>  → list apps for a space (with intervention counts)
// POST /api/apps                 → create an App manually (rare; normally materialized by pipeline)

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type { AppRow } from "@/types/app";
import { hydrateApp } from "@/types/app";
import type { InterventionRow } from "@/types/intervention";

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { searchParams } = new URL(request.url);
  const spaceId = searchParams.get("spaceId");
  const status = searchParams.get("status"); // optional filter

  let query = db
    .from("apps")
    .select("*")
    .eq("user_id", user.id)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });

  if (spaceId) query = query.eq("space_id", spaceId);
  if (status) query = query.eq("status", status);

  const { data, error } = (await query) as { data: AppRow[] | null; error: unknown };
  if (error) {
    console.error("[apps list] error:", error);
    return NextResponse.json({ error: "Failed to fetch apps" }, { status: 500 });
  }

  const apps = data ?? [];
  const appIds = apps.map((a) => a.id);

  // Join intervention counts in a single query
  const countsByApp = new Map<string, { total: number; completed: number }>();
  if (appIds.length > 0) {
    const { data: ivRows } = (await db
      .from("interventions")
      .select("app_id, status")
      .in("app_id", appIds)) as {
      data: Array<Pick<InterventionRow, "app_id" | "status">> | null;
    };
    for (const r of ivRows ?? []) {
      if (!r.app_id) continue;
      const bucket = countsByApp.get(r.app_id) ?? { total: 0, completed: 0 };
      bucket.total += 1;
      if (r.status === "completed") bucket.completed += 1;
      countsByApp.set(r.app_id, bucket);
    }
  }

  // Join sub_space names
  const subSpaceIds = apps
    .map((a) => a.sub_space_id)
    .filter((v): v is string => typeof v === "string");
  const subSpaceNameById = new Map<string, string>();
  if (subSpaceIds.length > 0) {
    const { data: subRows } = (await db
      .from("spaces")
      .select("id, name")
      .in("id", subSpaceIds)) as {
      data: Array<{ id: string; name: string }> | null;
    };
    for (const r of subRows ?? []) subSpaceNameById.set(r.id, r.name);
  }

  // Join goal titles
  const goalIds = apps
    .map((a) => a.serves_goal_id)
    .filter((v): v is string => typeof v === "string");
  const goalTitleById = new Map<string, string>();
  if (goalIds.length > 0) {
    const { data: goalRows } = (await db
      .from("improvement_goals")
      .select("id, title")
      .in("id", goalIds)) as {
      data: Array<{ id: string; title: string }> | null;
    };
    for (const r of goalRows ?? []) goalTitleById.set(r.id, r.title);
  }

  // ── Pending-apps classification + awaiting-approval summary ──
  // The dashboard's "apps" card needs to distinguish three states:
  //   (a) No strategy exists — show generic empty state
  //   (b) Strategy generated, awaiting user approval — show "strategy ready" card
  //       with title/confidence/tactic count/proposed app count
  //   (c) Strategy confirmed, apps present (approved or pending regen) — show app list
  //
  // We fetch the strategy summary ALWAYS (not just when apps exist) so the card
  // can render (b) even when no apps exist yet. This was the #1 UX gap
  // identified in the dashboard wiring audit.
  let strategyCommittedAt: string | null = null;
  let strategyStatus: string | null = null;
  let strategySummary: {
    title: string;
    confidence: number;
    strategic_posture?: string;
    tactic_count: number;
    proposed_app_count: number;
    ranked_alternatives_count: number;
    provenance_score?: number;
    coverage_pct?: number;
    // Phase 0 readiness wiring — surface the four ReadyToShipMeter inputs +
    // sidecar signals (degraded steps, blind spots, open questions, coherence
    // issue counts) so the dashboard card can render the composite without
    // dragging the entire synthesis_data into every list response.
    coherence_score?: number;
    coherence_issue_count?: number;
    coherence_critical_count?: number;
    open_questions_count?: number;
    degraded_steps?: string[];
    blind_spots?: string[];
    generated_at?: string;
    has_user_constraint?: boolean;
  } | null = null;
  if (spaceId) {
    const { data: spaceRow } = (await db
      .from("spaces")
      .select("strategy_committed_at, synthesis_data")
      .eq("id", spaceId)
      .eq("user_id", user.id)
      .single()) as {
      data: {
        strategy_committed_at: string | null;
        synthesis_data: Record<string, unknown> | null;
      } | null;
    };
    strategyCommittedAt = spaceRow?.strategy_committed_at ?? null;
    const synthData = (spaceRow?.synthesis_data ?? {}) as Record<string, unknown>;
    const stratRec = synthData.strategic_recommendation as Record<string, unknown> | undefined;
    strategyStatus = (stratRec?.status as string | undefined) ?? null;

    // Build the summary when a strategy exists — regardless of app count.
    if (stratRec?.recommendation) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = stratRec.recommendation as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ranked = (stratRec.ranked_strategies as any[] | undefined) ?? [];
      const proposals = ranked[0]?.infrastructure_proposals ?? [];

      // Coherence — sibling to strategic_recommendation in synthesis_data;
      // persisted by /api/pipeline/synthesize when validateStrategyCoherence runs.
      const coherenceScoreRaw = synthData.coherence_score;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const coherenceIssues = (synthData.coherence_issues as any[] | undefined) ?? [];
      const coherenceScore = typeof coherenceScoreRaw === "number" ? coherenceScoreRaw : undefined;
      const criticalIssueCount = coherenceIssues.filter(
        (i) => i?.severity === "critical",
      ).length;

      // Open questions — sibling to strategic_recommendation; populated by gap analysis.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const openQuestions = (synthData.open_questions as any[] | undefined) ?? [];

      // Blind spots — nested in the reasoning trace (Step 1 diagnosis output).
      // Path: strategic_recommendation.reasoning_trace.diagnosis.signal_synthesis.blind_spots
      const blindSpotsRaw =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((stratRec.reasoning_trace as any)?.diagnosis?.signal_synthesis?.blind_spots as
          | string[]
          | undefined) ?? undefined;

      // Degraded steps — set by strategy-engine when any pipeline step hit a
      // fallback path. Honest-failure marker; the meter shows numbers, this
      // banner explains why they may be low.
      const degradedSteps = Array.isArray(rec.degraded_steps)
        ? (rec.degraded_steps as string[])
        : undefined;

      strategySummary = {
        title: String(rec.title ?? "(untitled strategy)"),
        confidence: typeof rec.confidence === "number" ? rec.confidence : 0,
        strategic_posture: rec.strategic_posture,
        tactic_count: Array.isArray(rec.micro_tactics) ? rec.micro_tactics.length : 0,
        proposed_app_count: Array.isArray(proposals) ? proposals.length : 0,
        ranked_alternatives_count: Math.max(0, ranked.length - 1),
        provenance_score: typeof rec.provenance?.overall_provenance_score === "number"
          ? rec.provenance.overall_provenance_score : undefined,
        coverage_pct: typeof rec.provenance?.coverage_pct_at_generation === "number"
          ? rec.provenance.coverage_pct_at_generation : undefined,
        coherence_score: coherenceScore,
        coherence_issue_count: coherenceIssues.length || undefined,
        coherence_critical_count: criticalIssueCount || undefined,
        open_questions_count: openQuestions.length || undefined,
        degraded_steps: degradedSteps && degradedSteps.length > 0 ? degradedSteps : undefined,
        blind_spots: blindSpotsRaw && blindSpotsRaw.length > 0 ? blindSpotsRaw : undefined,
        generated_at: stratRec.generated_at as string | undefined,
        has_user_constraint: !!(stratRec as Record<string, unknown>).user_constraint_applied,
      };
    }
  }

  const hydrated = apps.map((row) => {
    const app = hydrateApp(row);
    const counts = countsByApp.get(row.id);
    // Derive approval_state:
    //  - "approved": strategy has been confirmed AND app was created at/before confirmation (legacy or this-confirm)
    //  - "pending":  strategy exists but not yet confirmed — this app is from a proposed strategy
    //  - "legacy":   no strategy status tracked (old spaces) — treat as approved to avoid disruption
    let approvalState: "approved" | "pending" | "legacy" = "legacy";
    if (strategyStatus === "confirmed" && strategyCommittedAt) {
      // App created on/before confirm = approved; after = pending regeneration
      approvalState = row.created_at <= strategyCommittedAt ? "approved" : "pending";
    } else if (strategyStatus === "generated" || strategyStatus === "reviewing") {
      approvalState = "pending";
    } else if (strategyStatus) {
      // "superseded" or other — surface as pending so user reviews
      approvalState = "pending";
    }
    return {
      ...app,
      intervention_count: counts?.total ?? 0,
      interventions_completed: counts?.completed ?? 0,
      sub_space_name: row.sub_space_id ? subSpaceNameById.get(row.sub_space_id) ?? null : null,
      serves_goal_title: row.serves_goal_id ? goalTitleById.get(row.serves_goal_id) ?? null : null,
      approval_state: approvalState,
    };
  });

  return NextResponse.json({
    apps: hydrated,
    strategy_committed_at: strategyCommittedAt,
    strategy_status: strategyStatus,
    strategy_summary: strategySummary,
  });
}

// POST — manual creation. Rare; primary path is pipeline materialization.
export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const {
    space_id,
    name,
    description,
    app_type,
    dominant_entity_ids,
    dominant_entity_codes,
    serves_goal_id,
    config,
    priority,
    complexity,
  } = (body ?? {}) as Record<string, unknown>;

  if (!space_id || !name) {
    return NextResponse.json(
      { error: "space_id and name are required" },
      { status: 400 }
    );
  }

  // Verify user owns the space
  const { data: space } = await db
    .from("spaces")
    .select("id")
    .eq("id", space_id)
    .eq("user_id", user.id)
    .single();

  if (!space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: inserted, error } = await db
    .from("apps")
    .insert({
      space_id,
      user_id: user.id,
      name,
      description: description ?? null,
      app_type: app_type ?? "dashboard",
      dominant_entity_ids: dominant_entity_ids ?? [],
      dominant_entity_codes: dominant_entity_codes ?? [],
      serves_goal_id: serves_goal_id ?? null,
      config: config ?? {},
      state: {},
      priority: priority ?? 999,
      complexity: complexity ?? null,
      last_updated_by: "user",
    })
    .select("*")
    .single();

  if (error) {
    console.error("[apps create] error:", error);
    return NextResponse.json(
      { error: "Failed to create app" },
      { status: 500 }
    );
  }

  // Seed an app_versions row
  try {
    await db.from("app_versions").insert({
      app_id: inserted.id,
      version: 1,
      config_snapshot: inserted.config,
      state_snapshot: inserted.state,
      change_summary: "App created manually",
      change_type: "user_edit",
      changed_by: `user:${user.id}`,
    });
  } catch (verErr) {
    console.warn("[apps create] version insert failed:", verErr);
  }

  return NextResponse.json({ app: hydrateApp(inserted) });
}
