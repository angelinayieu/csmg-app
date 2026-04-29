// ── /api/explore/[id]/backfill ─────────────────────────────────────
//
// Backfill route for EXISTING template-seeded spaces whose
// `synthesis_data` is null because they were created before the
// `/api/explore/create` after() block chained synthesis. Fires the
// same augment + consequence_surface + research(autoAdvance) chain
// so existing spaces get the same fully-populated experience as new
// template creates.
//
// Idempotent: callable repeatedly. The augmenter's density gate
// (≥0.8 edges/entity) skips spaces that are already well-connected;
// research+synthesis happily overwrite synthesis_data with fresh
// output if the user wants to regenerate.
//
// Auth: standard cookie-based auth + space ownership check, matching
// /api/explore/create. Service-role / cron does NOT use this route —
// for that, write a separate /api/cron/template-backfill that pulls
// session cookies from a secrets-table or uses RLS-bypass.
//
// Why a per-space POST rather than a "find all template spaces with
// null synthesis_data" sweep:
//   - Predictable cost (one POST = one space's full chain)
//   - Easy to rate-limit per-user
//   - User can choose which space to backfill (e.g. archive others)
//   - Service-role sweep is a separate concern that can compose this

import { NextResponse, after } from "next/server";
import {
  safeAuth,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";

export const maxDuration = 60;

interface BackfillContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: BackfillContext) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { id: spaceId } = await context.params;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Verify this is actually a template-seeded space — backfilling
  // arbitrary user-text spaces with the gate-bypassing chain would
  // skip the layer-coverage + measurement-coverage checks they're
  // supposed to honor. Template-seeded spaces don't have those
  // structures by design, so bypassing is safe for them only.
  const { data: spaceRow, error: spaceErr } = await db
    .from("spaces")
    .select("id, template_slug, synthesis_data, name")
    .eq("id", spaceId)
    .maybeSingle();

  if (spaceErr) {
    return NextResponse.json(
      { error: `space lookup failed: ${spaceErr.message}` },
      { status: 500 },
    );
  }
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const space = spaceRow as any;
  if (!space.template_slug) {
    return NextResponse.json(
      {
        error:
          "This space wasn't created from a template. Backfill only applies to template-seeded spaces; user-text spaces should use /api/pipeline/synthesize directly with the layer + measurement gates intact.",
      },
      { status: 400 },
    );
  }

  // Resolve the template so we can build inputSummary for research
  // AND so we can stamp pre-baked synthesis_data immediately if the
  // existing space has none yet.
  let inputSummary = `Template: ${space.template_slug}`;
  let seededSynthesis = false;
  try {
    const { getResearchTemplate } = await import(
      "@/lib/templates/mind-body-cognition/seed"
    );
    const template = getResearchTemplate(space.template_slug);
    if (template) {
      inputSummary = [template.title, template.tagline, template.description]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 2000);

      // If the existing space has no synthesis_data and the template
      // ships with pre-baked content, stamp it NOW (before research/
      // synthesize fire async). Unblocks all 6 side panels immediately
      // for existing spaces created before the bake landed.
      if (!space.synthesis_data && template.seed_synthesis_data) {
        const { error: updErr } = await db
          .from("spaces")
          .update({ synthesis_data: template.seed_synthesis_data })
          .eq("id", spaceId);
        if (!updErr) {
          seededSynthesis = true;
        }
      }
    }
  } catch {
    // Soft-fail — fall back to the generic summary; backfill chain
    // still fires below
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const origin = new URL(request.url).origin;
  const templateSlug = space.template_slug as string;

  // Mirror the /api/explore/create after() chain:
  //   1. augment (D11)
  //   2. consequence_surface backfill (D13a)
  //   3. research with autoAdvance=true → research's after() chain fires synthesize
  after(async () => {
    try {
      const { runTemplateEdgeAugmenter } = await import(
        "@/lib/templates/template-edge-augmenter"
      );
      const augmentResult = await runTemplateEdgeAugmenter({
        db,
        spaceId,
        templateSlug,
      });
      console.log(
        `[explore/backfill ${spaceId}] augment: status=${augmentResult.status} isolated=${augmentResult.isolated_count} proposed=${augmentResult.edges_proposed} persisted=${augmentResult.edges_persisted} (${augmentResult.duration_ms}ms)`,
      );
    } catch (augmentErr) {
      console.warn(
        `[explore/backfill ${spaceId}] template-edge-augmenter failed (non-fatal):`,
        augmentErr,
      );
    }

    try {
      const { backfillConsequenceSurfaces } = await import(
        "@/lib/pipeline/consequence-surface-tail"
      );
      const csResult = await backfillConsequenceSurfaces({ db, spaceId });
      if (csResult && csResult.updated > 0) {
        console.log(
          `[explore/backfill ${spaceId}] consequence_surface: scanned=${csResult.scanned} updated=${csResult.updated} (${csResult.duration_ms}ms)`,
        );
      }
    } catch (csErr) {
      console.warn(
        `[explore/backfill ${spaceId}] consequence_surface failed (non-fatal):`,
        csErr,
      );
    }

    try {
      const ctrl = new AbortController();
      const handoffTimeout = setTimeout(() => ctrl.abort(), 10000);
      try {
        await fetch(`${origin}/api/pipeline/research`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader,
          },
          body: JSON.stringify({
            spaceIds: [spaceId],
            inputSummary,
            researchDepth: "standard",
            triggeredBy: "explore_template_backfill",
            // research's auto-advance fires synthesize; both already
            // bypass layer + measurement gates for templates
            autoAdvance: true,
          }),
          signal: ctrl.signal,
        });
        clearTimeout(handoffTimeout);
      } catch (researchErr) {
        clearTimeout(handoffTimeout);
        const name = (researchErr as { name?: string })?.name;
        if (name !== "AbortError") {
          console.warn(
            `[explore/backfill ${spaceId}] research handoff threw (non-fatal):`,
            researchErr,
          );
        }
      }
    } catch (researchOuterErr) {
      console.warn(
        `[explore/backfill ${spaceId}] research trigger setup failed (non-fatal):`,
        researchOuterErr,
      );
    }
  });

  return NextResponse.json({
    space_id: spaceId,
    template_slug: templateSlug,
    name: space.name,
    triggered: {
      seeded_synthesis_data_immediately: seededSynthesis,
      augment: true,
      consequence_surface_backfill: true,
      research: true,
      synthesize: "via research autoAdvance chain",
    },
    note: seededSynthesis
      ? "Pre-baked synthesis_data stamped IMMEDIATELY — refresh the space now to see all 6 side panels populated. Augment + research + synthesize fire async in `after()` and replace this content with LLM-generated output within ~30-90s."
      : "Augment + research + synthesize fire async in `after()`. Re-fetch the space in ~30-90s to see populated synthesis_data and intelligence_radar.signals.",
  });
}

export async function GET(_request: Request, context: BackfillContext) {
  // Convenience: GET returns the backfill state without firing.
  // Useful for "is this space already populated?" checks before POST.
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { id: spaceId } = await context.params;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const [spaceRes, edgeCountRes, entityCountRes] = await Promise.all([
      db
        .from("spaces")
        .select("template_slug, synthesis_data, name")
        .eq("id", spaceId)
        .maybeSingle(),
      db
        .from("edges")
        .select("id", { count: "exact", head: true })
        .eq("space_id", spaceId),
      db
        .from("entities")
        .select("id", { count: "exact", head: true })
        .eq("space_id", spaceId),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const space = spaceRes.data as any;
    if (!space) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    const synthesisData = space.synthesis_data ?? null;
    const hasLeverage = !!(
      synthesisData &&
      Array.isArray(synthesisData.leverage_points) &&
      synthesisData.leverage_points.length > 0
    );
    const hasRadar = !!(
      synthesisData &&
      synthesisData.intelligence_radar &&
      Array.isArray(synthesisData.intelligence_radar.signals) &&
      synthesisData.intelligence_radar.signals.length > 0
    );

    return NextResponse.json({
      space_id: spaceId,
      name: space.name,
      template_slug: space.template_slug,
      entity_count: entityCountRes.count ?? 0,
      edge_count: edgeCountRes.count ?? 0,
      has_synthesis_data: !!synthesisData,
      has_leverage_points: hasLeverage,
      has_intelligence_radar_signals: hasRadar,
      can_backfill: !!space.template_slug,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `backfill state lookup failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
