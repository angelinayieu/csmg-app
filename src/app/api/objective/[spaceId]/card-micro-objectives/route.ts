// ── POST /api/objective/[spaceId]/card-micro-objectives ───────────────
//
// Resolve a card's micro-objectives — the per-card success rubric used by
// Deep Synthesize (and, downstream, make_plan / brief / expansion-recs).
// Cached on first call per card; subsequent ops on the same card are free.
//
// Body:
//   {
//     cardId: string,         // library_objects.id OR tldraw shape id
//     headline?: string,      // card content (used when the cache misses
//     body?: string,          // and we need to derive fresh). Optional —
//     role?: string,          // when the card is library-backed, we can
//                             // read its title/summary from the row.
//     force?: boolean,        // bypass cache, derive fresh
//   }
//
// Returns:
//   { micros: MicroObjective[], cached: boolean, source: "library_objects"
//     | "synthesis_data" | "fresh", libraryObjectId: string | null,
//     factors: OptimizationFactor[] }
//
// The `factors` echo lets the client render the laddersTo chips without
// re-reading prompt_sharpening.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  buildMicroObjectivesArtifact,
  deriveMicroObjectives,
} from "@/lib/objective-canvas/derive-micro-objectives";
import {
  cacheMicroObjectives,
  getMicroObjectives,
} from "@/lib/objective-canvas/get-micro-objectives";
import { loadOptimizationFactors } from "@/lib/objective-canvas/load-optimization-factors";
import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface Body {
  cardId?: string;
  headline?: string;
  body?: string;
  role?: string;
  force?: boolean;
  /** Read-only mode: return what's cached, never derive on miss. Lets the
   *  detail-drawer's Micros panel show instantly on open without burning
   *  a Sonnet call — the user clicks "Derive" explicitly to populate. */
  cacheOnly?: boolean;
}

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }

  // Ownership — same explicit user_id check the other objective routes use.
  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const cardId = typeof body.cardId === "string" ? body.cardId.trim() : "";
  if (!cardId) {
    return NextResponse.json({ error: "Missing cardId" }, { status: 400 });
  }

  // Card content — what we'll derive from on a miss. Falls back to the
  // library_objects row when the client didn't pass inline content (e.g.
  // the user opened a card and we want to pre-derive).
  let headline = String(body.headline ?? "").trim();
  let cardBody = String(body.body ?? "").trim();
  let role = String(body.role ?? "").trim();

  // Load the seed objective + factors in parallel — the deriver needs both
  // (objective is the LENS, factors are the weighting under it).
  const [factors, spaceCtx] = await Promise.all([
    loadOptimizationFactors(auth.supabase, spaceId),
    buildSpaceContext(auth.supabase, spaceId),
  ]);
  const objective = (spaceCtx.objective ?? "").trim();

  // 1. Cache check (unless force=true).
  if (!body.force) {
    const resolved = await getMicroObjectives(auth.supabase, spaceId, cardId, {
      headline,
      body: cardBody,
    });
    if (resolved.artifact) {
      return NextResponse.json({
        micros: resolved.artifact.micros,
        cached: true,
        source: resolved.source,
        libraryObjectId: resolved.libraryObjectId,
        factors,
      });
    }
    // Cache miss — if the card is library-backed and the client didn't pass
    // inline content, pull the row's title/summary so the deriver has signal.
    if (resolved.libraryObjectId && (!headline || !cardBody)) {
      try {
        const { data } = await auth.supabase
          .from("library_objects")
          .select("title, summary, object_type")
          .eq("id", resolved.libraryObjectId)
          .maybeSingle();
        if (data) {
          headline = headline || String(data.title ?? "").trim();
          cardBody = cardBody || String(data.summary ?? "").trim();
          role = role || String(data.object_type ?? "").trim();
        }
      } catch {
        /* soft */
      }
    }
  }

  if (!headline && !cardBody) {
    return NextResponse.json(
      { error: "Card content missing (no headline or body)." },
      { status: 400 },
    );
  }

  // cacheOnly short-circuit — caller wants whatever's cached, no derive.
  // The detail-drawer panel uses this on open so it renders instantly.
  if (body.cacheOnly) {
    // We already checked the cache above; if we're here, it was a miss.
    return NextResponse.json({
      micros: [],
      cached: false,
      source: "miss" as const,
      libraryObjectId: null,
      factors,
    });
  }

  // 2. Derive fresh — objective-keyed.
  const micros = await deriveMicroObjectives({
    card: { headline, body: cardBody, role: role || undefined },
    factors: factors.map((f) => ({
      slug: f.slug,
      label: f.label,
      kind: f.kind,
      why: f.why,
    })),
    objective,
  });

  if (micros.length === 0) {
    return NextResponse.json(
      { error: "No usable micro-objectives produced." },
      { status: 502 },
    );
  }

  const artifact = buildMicroObjectivesArtifact({
    cardId,
    card: { headline, body: cardBody, role: role || undefined },
    micros,
  });

  // 3. Cache for next time. Resolved.libraryObjectId may be null (shape-only
  // card) → goes into synthesis_data fallback.
  const lookup = await getMicroObjectives(auth.supabase, spaceId, cardId, {
    headline,
    body: cardBody,
  });
  await cacheMicroObjectives(
    auth.supabase,
    spaceId,
    cardId,
    artifact,
    lookup.libraryObjectId,
  );

  return NextResponse.json({
    micros,
    cached: false,
    source: "fresh" as const,
    libraryObjectId: lookup.libraryObjectId,
    factors,
  });
}
