// GET /api/spaces/[id]/final-artifacts
//
// Aggregation endpoint for the Synthesis Lab right panel (the "Final
// Artifacts" view). Returns every pipeline-output the user can act
// on — strategies, twin proposals, lab scaffolds, experiment
// variants, apps, interventions — in ONE shape so the panel polls
// a single URL on a 12s cadence instead of fetching 5 separately.
//
// Source rules:
//   - synthesis_data.strategy_batch  → strategy_options (primary + alts)
//   - twin_proposals (kind=lab_twin) → lab_proposals
//   - twin_proposals (kind=strategy_twin / problem_twin) → twin_proposals
//   - experiment_variants            → variations
//   - apps + interventions           → apps_and_interventions
//   - lab_scaffolds                  → lab_scaffolds
//
// All queries are scoped by space_id + user_id (via verifySpaceOwnership).
// All return null-safe values so the panel renders empty sections
// gracefully when a category has no artifacts yet.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 12;

// ── Response shape (exported for the client) ────────────────────────

export interface FinalArtifactStrategyOption {
  rank: number;
  title: string;
  summary: string;
  posture: string | null;
  confidence: number | null;
  is_primary: boolean;
}

export interface FinalArtifactTwinProposal {
  id: string;
  kind: string; // 'lab_twin' | 'strategy_twin' | 'problem_twin'
  label: string;
  summary: string | null;
  user_status: string;
  generated_at: string | null;
}

export interface FinalArtifactVariant {
  id: string;
  label: string;
  summary: string | null;
  status: string;
  app_id: string | null;
  accent_color: string | null;
  is_active: boolean;
  aggregate_quality: number | null;
  aggregate_lift: number | null;
}

export interface FinalArtifactApp {
  id: string;
  name: string;
  description: string | null;
  app_type: string | null;
  status: string;
  health_score: number | null;
  intervention_count: number;
  stale_reason: string | null;
}

export interface FinalArtifactIntervention {
  id: string;
  title: string;
  description: string | null;
  status: string;
  app_id: string | null;
  priority: string | null;
  effort: string | null;
  impact: string | null;
}

export interface FinalArtifactLabScaffold {
  id: string;
  status: string;
  subject_count: number;
  approved_at: string | null;
}

export interface FinalArtifactsResponse {
  strategy_options: FinalArtifactStrategyOption[];
  twin_proposals: FinalArtifactTwinProposal[];
  lab_proposals: FinalArtifactTwinProposal[];
  variations: FinalArtifactVariant[];
  apps: FinalArtifactApp[];
  interventions: FinalArtifactIntervention[];
  lab_scaffolds: FinalArtifactLabScaffold[];
  // Headline summary so the panel can show "12 artifacts ready"
  // without summing five arrays client-side.
  counts: {
    strategy_options: number;
    twin_proposals: number;
    lab_proposals: number;
    variations: number;
    apps: number;
    interventions: number;
    lab_scaffolds: number;
    total: number;
  };
  // Generated-at signal — when synthesis last ran. Lets the panel
  // surface freshness ("synthesis 3m ago") even when no new artifact
  // has landed since.
  last_synthesis_at: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Parallel fetch ──
  // Each query is narrow + cheap. We deliberately don't join apps to
  // interventions or apps to variants — the panel re-keys client-side
  // (apps render with their intervention count, variants render under
  // their parent app section).
  const [
    spaceRow,
    twinProposalsRes,
    variantsRes,
    appsRes,
    interventionsRes,
    labScaffoldsRes,
  ] = await Promise.all([
    db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle(),
    db
      .from("twin_proposals")
      .select(
        "id, kind, justification, user_status, generated_at, frame_payload, lab_payload",
      )
      .eq("space_id", spaceId)
      .order("generated_at", { ascending: false })
      .limit(40),
    db
      .from("experiment_variants")
      .select(
        "id, label, summary, status, app_id, accent_color, is_active, aggregate_quality, aggregate_lift",
      )
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(40),
    db
      .from("apps")
      .select(
        "id, name, description, app_type, status, health_score, stale_reason",
      )
      .eq("space_id", spaceId)
      .order("priority", { ascending: false, nullsFirst: false })
      .limit(30),
    db
      .from("interventions")
      .select(
        "id, title, description, status, app_id, priority, effort, impact",
      )
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(60),
    db
      .from("lab_scaffolds")
      .select("id, status, proposed_subjects, approved_at")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // ── Project Strategy Options from synthesis_data.strategy_batch ──
  // Synthesis returns a ranked list of strategy alternatives plus a
  // primary. Both shapes live in synthesis_data; we collapse them
  // here so the panel sees one list ordered by rank ASC.
  const synthesis = (spaceRow?.data?.synthesis_data ?? {}) as Record<
    string,
    unknown
  >;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategyBatch = (synthesis as any).strategy_batch as
    | {
        primary?: {
          rank?: number;
          title?: string;
          summary?: string;
          posture?: string;
          confidence?: number;
        };
        ranked_strategies?: Array<{
          rank?: number;
          title?: string;
          summary?: string;
          posture?: string;
          confidence?: number;
          is_primary?: boolean;
        }>;
      }
    | null
    | undefined;
  const strategy_options: FinalArtifactStrategyOption[] = [];
  if (Array.isArray(strategyBatch?.ranked_strategies)) {
    for (const s of strategyBatch!.ranked_strategies!) {
      strategy_options.push({
        rank: typeof s.rank === "number" ? s.rank : strategy_options.length + 1,
        title: typeof s.title === "string" ? s.title : "Strategy option",
        summary: typeof s.summary === "string" ? s.summary : "",
        posture: typeof s.posture === "string" ? s.posture : null,
        confidence: typeof s.confidence === "number" ? s.confidence : null,
        is_primary: Boolean(s.is_primary),
      });
    }
  }
  // Fallback: if no ranked_strategies but a primary exists, surface it
  // as the only option so the panel doesn't show empty.
  if (strategy_options.length === 0 && strategyBatch?.primary) {
    const p = strategyBatch.primary;
    strategy_options.push({
      rank: typeof p.rank === "number" ? p.rank : 1,
      title: typeof p.title === "string" ? p.title : "Primary strategy",
      summary: typeof p.summary === "string" ? p.summary : "",
      posture: typeof p.posture === "string" ? p.posture : null,
      confidence: typeof p.confidence === "number" ? p.confidence : null,
      is_primary: true,
    });
  }
  strategy_options.sort((a, b) => a.rank - b.rank);

  // ── Split twin_proposals by kind ──
  const allTwinProposals = (twinProposalsRes?.data ?? []) as Array<{
    id: string;
    kind: string;
    justification: string | null;
    user_status: string;
    generated_at: string | null;
    frame_payload: Record<string, unknown> | null;
    lab_payload: Record<string, unknown> | null;
  }>;
  const lab_proposals: FinalArtifactTwinProposal[] = [];
  const twin_proposals: FinalArtifactTwinProposal[] = [];
  for (const tp of allTwinProposals) {
    const label = labelFromTwinProposal(tp);
    const summary = tp.justification ?? null;
    const projected: FinalArtifactTwinProposal = {
      id: tp.id,
      kind: tp.kind,
      label,
      summary,
      user_status: tp.user_status,
      generated_at: tp.generated_at,
    };
    if (tp.kind === "lab_twin") {
      lab_proposals.push(projected);
    } else {
      twin_proposals.push(projected);
    }
  }

  // ── Variations ──
  const variations: FinalArtifactVariant[] = (
    (variantsRes?.data ?? []) as Array<{
      id: string;
      label: string;
      summary: string | null;
      status: string;
      app_id: string | null;
      accent_color: string | null;
      is_active: boolean;
      aggregate_quality: number | null;
      aggregate_lift: number | null;
    }>
  ).map((v) => ({
    id: v.id,
    label: v.label,
    summary: v.summary,
    status: v.status,
    app_id: v.app_id,
    accent_color: v.accent_color,
    is_active: v.is_active,
    aggregate_quality: v.aggregate_quality,
    aggregate_lift: v.aggregate_lift,
  }));

  // ── Apps with intervention counts ──
  const appRows = (appsRes?.data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    app_type: string | null;
    status: string;
    health_score: number | null;
    stale_reason: string | null;
  }>;
  const interventionRows = (interventionsRes?.data ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    app_id: string | null;
    priority: string | null;
    effort: string | null;
    impact: string | null;
  }>;
  // Count interventions per app for the apps section header.
  const ivCountByApp = new Map<string, number>();
  for (const iv of interventionRows) {
    if (!iv.app_id) continue;
    ivCountByApp.set(iv.app_id, (ivCountByApp.get(iv.app_id) ?? 0) + 1);
  }
  const apps: FinalArtifactApp[] = appRows.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    app_type: a.app_type,
    status: a.status,
    health_score: a.health_score,
    intervention_count: ivCountByApp.get(a.id) ?? 0,
    stale_reason: a.stale_reason,
  }));
  const interventions: FinalArtifactIntervention[] = interventionRows.map(
    (iv) => ({
      id: iv.id,
      title: iv.title,
      description: iv.description,
      status: iv.status,
      app_id: iv.app_id,
      priority: iv.priority,
      effort: iv.effort,
      impact: iv.impact,
    }),
  );

  // ── Lab scaffolds ──
  const lab_scaffolds: FinalArtifactLabScaffold[] = (
    (labScaffoldsRes?.data ?? []) as Array<{
      id: string;
      status: string;
      proposed_subjects: unknown;
      approved_at: string | null;
    }>
  ).map((ls) => ({
    id: ls.id,
    status: ls.status,
    subject_count: Array.isArray(ls.proposed_subjects)
      ? ls.proposed_subjects.length
      : 0,
    approved_at: ls.approved_at,
  }));

  // ── Last-synthesis timestamp (from strategic_recommendation) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategicRec = ((synthesis as any).strategic_recommendation ?? {}) as {
    generated_at?: string;
  };
  const last_synthesis_at = strategicRec.generated_at ?? null;

  const counts = {
    strategy_options: strategy_options.length,
    twin_proposals: twin_proposals.length,
    lab_proposals: lab_proposals.length,
    variations: variations.length,
    apps: apps.length,
    interventions: interventions.length,
    lab_scaffolds: lab_scaffolds.length,
    total:
      strategy_options.length +
      twin_proposals.length +
      lab_proposals.length +
      variations.length +
      apps.length +
      interventions.length +
      lab_scaffolds.length,
  };

  const payload: FinalArtifactsResponse = {
    strategy_options,
    twin_proposals,
    lab_proposals,
    variations,
    apps,
    interventions,
    lab_scaffolds,
    counts,
    last_synthesis_at,
  };
  return NextResponse.json(payload);
}

// Best-effort label projection for a twin_proposal row. The label
// lives in DIFFERENT JSONB fields depending on kind — lab_twin uses
// lab_payload.title, problem_twin uses frame_payload.label, strategy
// twins typically have a justification that doubles as the label.
function labelFromTwinProposal(tp: {
  kind: string;
  justification: string | null;
  frame_payload: Record<string, unknown> | null;
  lab_payload: Record<string, unknown> | null;
}): string {
  if (tp.kind === "lab_twin") {
    const lab = tp.lab_payload ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (lab as any).title ?? (lab as any).stance ?? (lab as any).label;
    if (typeof t === "string" && t.length > 0) return t;
    return "Lab proposal";
  }
  if (tp.kind === "problem_twin") {
    const frame = tp.frame_payload ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (frame as any).label ?? (frame as any).title ?? (frame as any).framing;
    if (typeof t === "string" && t.length > 0) return t;
    return "Framing proposal";
  }
  // strategy_twin fallback — justification often reads as the title.
  if (typeof tp.justification === "string" && tp.justification.length > 0) {
    // Truncate the first sentence as the label.
    const firstSentence = tp.justification.split(/[.!?]/)[0];
    return firstSentence.slice(0, 80) || "Strategy proposal";
  }
  return "Twin proposal";
}
