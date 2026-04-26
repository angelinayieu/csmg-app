// POST /api/reports  → freeze a space (and optionally an app) into a
//                      reports row. Payload captures everything the VP
//                      Project widgets need so the report page can
//                      render without live DB reads.
// GET  /api/reports   → list reports for a space (?space_id=) or an
//                      app (?app_id=). Most-recent first.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { hydrateApp } from "@/types/app";
import type { AppRow } from "@/types/app";
import type { ReportPayload, CreateReportRequest } from "@/types/report";

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;
  const req = (body ?? {}) as CreateReportRequest;

  if (!req.space_id || typeof req.space_id !== "string") {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check via the space row. Without this the user could
  // freeze any space's data just by knowing its id.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, name, user_id, synthesis_data")
    .eq("id", req.space_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // Optional app scope — when provided we freeze the app's manifest too.
  let appRow: AppRow | null = null;
  if (req.app_id) {
    const { data } = (await db
      .from("apps")
      .select("*")
      .eq("id", req.app_id)
      .eq("user_id", user.id)
      .maybeSingle()) as { data: AppRow | null };
    if (!data) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }
    appRow = data;
  }

  // ── Gather every source the VP Project widgets bind to ──
  //
  // Each of these mirrors a query in /api/apps/[id]/route.ts so the
  // frozen payload matches what the live resolver table sees. Keep the
  // shapes raw — the resolvers hydrate on render.
  const scopeSpaceId = req.space_id;

  const [
    { data: interventionRows },
    { data: appStrategyRow },
    { data: taxonomyRow },
    { data: variantRows },
    { data: latentRows },
    { data: scoreRows },
    { data: goalRows },
    { data: baselineRow },
    { data: predictionRows },
    { data: signatureEntityRows },
  ] = await Promise.all([
    // Interventions: either app-scoped (when app_id set) or the whole
    // space's unassigned+assigned set.
    appRow
      ? db.from("interventions").select("*").eq("app_id", appRow.id).order("priority", { ascending: true })
      : db.from("interventions").select("*").eq("space_id", scopeSpaceId).order("priority", { ascending: true }),
    // App-level sub-strategy (only when app-scoped).
    appRow
      ? db.from("app_strategies").select("*").eq("app_id", appRow.id).eq("status", "active").maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("experiment_taxonomies").select("*").eq("space_id", scopeSpaceId).maybeSingle(),
    db
      .from("experiment_variants")
      .select("*")
      .eq("space_id", scopeSpaceId)
      .order("is_active", { ascending: false })
      .order("aggregate_quality", { ascending: false, nullsFirst: false })
      .limit(48),
    db.from("latent_variables").select("*").eq("space_id", scopeSpaceId).order("created_at", { ascending: true }),
    db.from("variant_outcome_scores").select("*").eq("space_id", scopeSpaceId),
    db.from("improvement_goals").select("*").eq("space_id", scopeSpaceId).order("created_at", { ascending: true }),
    db.from("strategy_baselines").select("*").eq("space_id", scopeSpaceId).order("snapshot_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("prediction_ledger").select("*").eq("space_id", scopeSpaceId).order("predicted_at", { ascending: false }).limit(200),
    // Batch 8 — freeze canonical node signatures so the constellation
    // widget renders the same rings on a frozen report as it does live.
    db
      .from("entities")
      .select("id, name, node_signature")
      .eq("space_id", scopeSpaceId)
      .not("node_signature", "is", null),
  ]);

  // Active variant → hydrate with slots so the iv_decomposition widget
  // renders off the frozen payload without a second lookup.
  const variants = (variantRows ?? []) as Array<Record<string, unknown> & { id: string; is_active: boolean }>;
  const activeVariantRow =
    variants.find((v) => v.is_active === true) ?? variants[0] ?? null;
  let activeVariant: Record<string, unknown> | null = null;
  if (activeVariantRow) {
    const { data: slotRows } = await db
      .from("experiment_variant_slots")
      .select("*")
      .eq("variant_id", activeVariantRow.id);
    activeVariant = { ...activeVariantRow, slots: slotRows ?? [] };
  }

  // Pipeline version stamp — read the latest pipeline_run for provenance.
  let pipelineVersion: number | null = null;
  try {
    const { data: runRow } = await db
      .from("pipeline_runs")
      .select("id, version")
      .eq("space_id", scopeSpaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    pipelineVersion = runRow?.version ?? null;
  } catch {
    /* non-critical */
  }

  const payload: ReportPayload = {
    app_snapshot: appRow ? hydrateApp(appRow) : null,
    synthesis: (spaceRow.synthesis_data as Record<string, unknown> | null) ?? null,
    interventions: (interventionRows ?? []) as ReportPayload["interventions"],
    app_strategy: (appStrategyRow ?? null) as ReportPayload["app_strategy"],
    taxonomy: (taxonomyRow ?? null) as ReportPayload["taxonomy"],
    variants: (variantRows ?? []) as ReportPayload["variants"],
    active_variant: activeVariant as ReportPayload["active_variant"],
    latent_variables: (latentRows ?? []) as ReportPayload["latent_variables"],
    variant_outcome_scores: (scoreRows ?? []) as ReportPayload["variant_outcome_scores"],
    improvement_goals: (goalRows ?? []) as ReportPayload["improvement_goals"],
    strategy_baseline: (baselineRow ?? null) as ReportPayload["strategy_baseline"],
    predictions: (predictionRows ?? []) as ReportPayload["predictions"],
    node_signature_entities:
      (signatureEntityRows ?? []) as ReportPayload["node_signature_entities"],
    frozen_at: new Date().toISOString(),
  };

  // Title default: prefer app.name, then space.name, fall back to a
  // generic stamp so reports are always distinguishable in the history
  // list even if the caller skipped the field.
  const title =
    (typeof req.title === "string" && req.title.trim()) ||
    appRow?.name ||
    (typeof spaceRow.name === "string" ? `${spaceRow.name} report` : "VP Project report");

  // Manifest: freeze a copy of the app's current manifest (if any) so
  // the report page renders the same layout the user saw when they
  // clicked Generate. Without this, later manifest edits would re-shape
  // old reports.
  const manifest =
    appRow && typeof appRow.config === "object" && appRow.config !== null
      ? (appRow.config as Record<string, unknown>).manifest ?? null
      : null;

  const { data: inserted, error: insertErr } = await db
    .from("reports")
    .insert({
      space_id: scopeSpaceId,
      app_id: appRow?.id ?? null,
      user_id: user.id,
      title,
      summary: typeof req.summary === "string" ? req.summary : null,
      payload,
      manifest,
      pipeline_version: pipelineVersion,
      generated_by: `user:${user.id}`,
    })
    .select("*")
    .single();

  if (insertErr || !inserted) {
    console.error("[reports POST] insert failed:", insertErr);
    return NextResponse.json({ error: "Failed to create report" }, { status: 500 });
  }

  return NextResponse.json({ report: inserted });
}

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  const appId = url.searchParams.get("app_id");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 100);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // History listing endpoint. Omits `payload` + `manifest` to keep the
  // response light — individual report pages fetch the full row via
  // /api/reports/:id. Selector is one-of space_id / app_id / current user.
  let q = db
    .from("reports")
    .select("id, space_id, app_id, user_id, title, summary, pipeline_version, generated_by, generated_at")
    .eq("user_id", user.id)
    .order("generated_at", { ascending: false })
    .limit(limit);
  if (spaceId) q = q.eq("space_id", spaceId);
  if (appId) q = q.eq("app_id", appId);

  const { data, error } = await q;
  if (error) {
    console.error("[reports GET] query failed:", error);
    return NextResponse.json({ error: "Failed to list reports" }, { status: 500 });
  }

  return NextResponse.json({ reports: data ?? [] });
}
