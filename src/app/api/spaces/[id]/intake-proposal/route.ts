// GET /api/spaces/[id]/intake-proposal
//
// Single round-trip endpoint that powers the intake-proposal page's
// 4-pane review:
//
//   1. Goal frame — derived from kg_generation_plans.scope_and_objectives
//   2. KG plan   — derived from kg_generation_plans.layer_ontology_proposal +
//                  conceptual_skeleton + research_plan
//   3. Lab setup  — buildLabSetupForecast(plan, template)
//   4. Agentic stack — buildAgenticStackForecast(reasoning_settings)
//
// Returns the full latest open plan + the two derived forecasts. The
// page polls this endpoint while the propose-plan async job is still
// running; once `plan` lands, the same response is used to render all
// four panes without further round trips.
//
// Soft-fail on missing plan: returns 200 with `plan: null` so the
// client can keep polling without an error toast.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { KgGenerationPlan } from "@/types/kg-generation-plan";
import { buildLabSetupForecast } from "@/lib/intake-proposal/lab-setup-forecast";
import { buildAgenticStackForecast } from "@/lib/intake-proposal/agentic-stack-forecast";
import { getResearchTemplate } from "@/lib/templates/mind-body-cognition/seed";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Latest open (proposed/edited/draft) plan for this space.
  const { data: planRows, error: planErr } = (await db
    .from("kg_generation_plans")
    .select("*")
    .eq("space_id", spaceId)
    .in("status", ["proposed", "edited", "draft"])
    .order("created_at", { ascending: false })
    .limit(1)) as {
    data: KgGenerationPlan[] | null;
    error: { message?: string } | null;
  };

  if (planErr) {
    return NextResponse.json(
      { error: `Failed to load plan: ${planErr.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  const plan = planRows?.[0] ?? null;

  if (!plan) {
    // Plan hasn't been created yet — propose-plan async job is still
    // running. Return a soft-200 with null plan + null forecasts so
    // the client can keep polling.
    return NextResponse.json({
      plan: null,
      lab_setup: null,
      agentic_stack: null,
    });
  }

  // Resolve template for B1/B4-aware forecasts. Spaces without a
  // template_id fall through to the all-axes / all-mechanism-kinds
  // universe.
  let templateSlug: string | null = null;
  try {
    const { data: spaceRow } = await db
      .from("spaces")
      .select("use_case_template_id")
      .eq("id", spaceId)
      .maybeSingle();
    const slug = (spaceRow as { use_case_template_id?: unknown } | null)
      ?.use_case_template_id;
    if (typeof slug === "string" && slug.length > 0) {
      templateSlug = slug;
    }
  } catch (err) {
    console.warn("[intake-proposal] template lookup failed (non-fatal):", err);
  }

  const template = templateSlug ? getResearchTemplate(templateSlug) : null;

  const lab_setup = buildLabSetupForecast({ plan, template });
  const agentic_stack = buildAgenticStackForecast({
    reasoning_settings: plan.reasoning_settings_proposed,
  });

  return NextResponse.json({ plan, lab_setup, agentic_stack });
}
