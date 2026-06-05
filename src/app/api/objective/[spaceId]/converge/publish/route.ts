// ── POST /api/objective/[spaceId]/converge/publish ───────────────────
//
// The "Converge → Publish" commit step. The Focus-Mode panel ("Converge —
// mark what you actually decided") sends the KEPT board cards here; this
// route lands them in the new object layer (`library_objects`) so the
// decided set becomes addressable, categorized, curated, and reachable by
// every downstream surface that reads library_objects (Library rail,
// glossary/KG, summarize-space-card, the spec compiler).
//
// Two kinds of kept card:
//   • already an object  (oc-cards carry props.objectId) → we DON'T
//     re-create it (that would mint a duplicate under a different natural
//     key); we just COMMIT it: selection_status='selected', on_whiteboard,
//     included_in_spec=true.
//   • board content with no object yet (insight / artifact / note / text)
//     → upsert a NEW library_object (idempotent on source_ref =
//     `converge:<shapeId>`), then commit it the same way.
//
// Categorization is the caller's `objectType` (feature / variable / insight),
// validated here against the allowed set; unknowns fall back to "feature"
// (the whiteboard's primary lingo). Mirrors the decompose-cards route so the
// two object-producing paths stay consistent.
//
// All writes go through lib/objective-canvas/library-objects.ts helpers,
// which soft-fail — a single bad card never blocks the rest. Glossary/KG
// enrichment is deliberately NOT done here (generateGlossary is an LLM call);
// the client fires that fire-and-forget after a successful publish.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  upsertLibraryObject,
  setSelectionStatus,
  setIncludedInSpec,
  setOnWhiteboard,
  type LibraryObjectType,
} from "@/lib/objective-canvas/library-objects";

export const runtime = "nodejs";

/** Object types this route will mint for converged board content. Anything
 *  else from the client is coerced to "feature" — the canvas's default
 *  building-block lingo. (Kept narrow on purpose: converge output is plan
 *  content, not experiments/deliverables/context anchors.) */
const ALLOWED: ReadonlySet<LibraryObjectType> = new Set<LibraryObjectType>([
  "feature",
  "variable",
  "insight",
  "mechanism",
  "recommendation",
]);

function coerceType(t: unknown): LibraryObjectType {
  return typeof t === "string" && ALLOWED.has(t as LibraryObjectType)
    ? (t as LibraryObjectType)
    : "feature";
}

interface ConvergeCardInput {
  /** tldraw shape id on the board — the durable source_ref + shape↔object link. */
  shapeId: string;
  /** Present when the card is ALREADY a library_object (oc-cards). */
  objectId?: string | null;
  objectType?: string;
  title?: string;
  summary?: string | null;
}

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

/** Auth + ownership → scoped db + userId (mirrors the library/objects route). */
async function authorize(spaceId: string) {
  const auth = await safeAuth();
  if (auth.error) return { error: auth.error as NextResponse };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { db, userId: auth.user.id as string };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { spaceId } = await ctx.params;
  const a = await authorize(spaceId);
  if ("error" in a) return a.error;
  const { db, userId } = a;

  const body = (await req.json().catch(() => ({}))) as { cards?: unknown };
  const cards: ConvergeCardInput[] = Array.isArray(body.cards)
    ? (body.cards as ConvergeCardInput[]).filter(
        (c) => c && typeof c.shapeId === "string" && c.shapeId.length > 0,
      )
    : [];

  if (cards.length === 0) {
    return NextResponse.json({ published: 0, created: 0, committed: 0, objectIds: [] });
  }

  // Each card is independent — run them concurrently. Per-card steps stay
  // sequential (need the id from the upsert before committing curation state).
  const results = await Promise.all(
    cards.map(async (card) => {
      const title = (typeof card.title === "string" ? card.title : "").trim() || "Untitled";
      const summary =
        typeof card.summary === "string" && card.summary.trim()
          ? card.summary.trim().slice(0, 600)
          : null;

      // Already an object (oc-card) → commit it, don't duplicate it.
      let objectId =
        typeof card.objectId === "string" && card.objectId.length > 0
          ? card.objectId
          : null;
      const created = objectId === null;

      if (objectId === null) {
        objectId = await upsertLibraryObject(db, {
          spaceId,
          userId,
          objectType: coerceType(card.objectType),
          title: title.slice(0, 200),
          summary,
          // NULL keeps the converged object durable against entity pruning
          // (no ON DELETE CASCADE) — same rule decompose/structure-snapshot use.
          sourceEntityId: null,
          // Stable per board card → idempotent re-publish (no dupes).
          sourceRef: `converge:${card.shapeId}`,
          subsystem: "Core",
        });
      }

      if (!objectId) return { ok: false as const, created };

      // Commit the curation state: this is a DECIDED item, it's on the board,
      // and it should flow into the spec. All soft-fail individually.
      await setSelectionStatus(db, objectId, "selected");
      await setOnWhiteboard(db, objectId, card.shapeId);
      await setIncludedInSpec(db, objectId, true);

      return { ok: true as const, created, objectId };
    }),
  );

  const objectIds = results
    .filter((r): r is { ok: true; created: boolean; objectId: string } => r.ok)
    .map((r) => r.objectId);
  const created = results.filter((r) => r.ok && r.created).length;
  const committed = results.filter((r) => r.ok && !r.created).length;

  return NextResponse.json({
    published: objectIds.length,
    created,
    committed,
    objectIds,
  });
}
