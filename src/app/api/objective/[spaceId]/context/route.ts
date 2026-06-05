// POST /api/objective/[spaceId]/context  — add a block of prior context/ideas
// GET  /api/objective/[spaceId]/context  — read the accumulating context scope
//
// First-class "prior thinking" channel (CONTEXT_FRONTIER_PLAN.md). Context is
// ROW-backed (NOT synthesis_data, which clobbers parallel sessions):
//   ingested_files (the raw block) → library_object_sources → context_anchor,
// then a post-response pass extracts ContextConcepts (context_concept objects
// linked derived_from the anchor). The frontier these produce is what lets
// decomposition AUGMENT the user's ideas instead of repeating them.
//
// Body: { role?: 'prior_ideas'|'reference', ingestedFileId?: string, text?: string }
//   - ingestedFileId: claim an already-ingested file/url/image (chatbox flow)
//   - text:           persist a pasted block directly (asset_class is nullable)

import { NextResponse, after } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  ensureContextAnchor,
  addContextSource,
  getObjectiveContextScope,
  type ContextRole,
} from "@/lib/objective-canvas/context-frontier";
import { extractAndRecordContextBlock } from "@/lib/objective-canvas/extract-context-frontier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ spaceId: string }> };

function normalizeRole(r: unknown): ContextRole {
  return r === "reference" ? "reference" : "prior_ideas";
}

async function findRootGoalId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
): Promise<string | null> {
  const { data } = await db
    .from("improvement_goals")
    .select("id")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let body: { role?: unknown; ingestedFileId?: unknown; text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const role = normalizeRole(body.role);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  let ingestedFileId =
    typeof body.ingestedFileId === "string" && body.ingestedFileId
      ? body.ingestedFileId
      : "";
  if (!ingestedFileId && text.length < 8) {
    return NextResponse.json(
      { error: "Provide `ingestedFileId` or `text` (≥8 chars)." },
      { status: 400 },
    );
  }

  // Ownership.
  const { data: space } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Resolve the source row: either claim an existing ingest, or persist the paste.
  let blockText: string | null = text || null;
  if (ingestedFileId) {
    // Claim onto the space (idempotent; only if unclaimed + owned).
    await db
      .from("ingested_files")
      .update({ space_id: spaceId })
      .eq("id", ingestedFileId)
      .eq("user_id", user.id)
      .is("space_id", null);
    blockText = null; // extraction reads normalized_text
  } else {
    const { data: inserted, error: insErr } = await db
      .from("ingested_files")
      .insert({
        user_id: user.id,
        space_id: spaceId,
        source_type: "text",
        source_name: role === "reference" ? "Reference context" : "Prior ideas",
        mime_type: "text/plain",
        source_url: null,
        normalized_text: text,
        raw_chars: text.length,
        normalized_chars: text.length,
        extraction_method: "paste",
        metadata: { context_role: role },
        parse_status: "ready",
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      console.error("[objective/context] text persist failed:", insErr?.message);
      return NextResponse.json({ error: "Could not save context." }, { status: 500 });
    }
    ingestedFileId = (inserted as { id: string }).id;
  }

  // Anchor + source link (activates the two orphan tables).
  const rootGoalId = await findRootGoalId(db, spaceId);
  const anchorId = await ensureContextAnchor(db, {
    spaceId,
    userId: user.id,
    rootGoalId,
  });
  if (!anchorId) {
    return NextResponse.json(
      { error: "Could not create context anchor." },
      { status: 500 },
    );
  }
  await addContextSource(db, {
    anchorId,
    userId: user.id,
    ingestedFileId,
    role,
  });

  // Extract → record concepts post-response (after() keeps the fn alive, like
  // the prompt-sharpening pass; maxDuration covers it).
  after(async () => {
    await extractAndRecordContextBlock(db, {
      spaceId,
      userId: user.id,
      anchorId,
      ingestedFileId,
      role,
      text: blockText,
    });
  });

  return NextResponse.json({ ok: true, anchorId, ingestedFileId, role });
}

export async function GET(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const scope = await getObjectiveContextScope(db, spaceId);
  return NextResponse.json(scope);
}
