// POST /api/objective/[spaceId]/link-objects
//   { fromObjectId, toObjectId, relation? } → persist an object_link
//
// The keystone for "manual connections feed the cluster graph". The board's
// Connect op (and the rail's "+ Link") call this so a connection between two
// oc-cards becomes a REAL `object_links` row — and therefore shows up in the
// object cluster graph / detail rail, instead of being a visual-only arrow.
// Idempotent (linkObjects upserts on from/to/relation). Soft-fail.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  linkObjects,
  type ObjectRelation,
} from "@/lib/objective-canvas/library-objects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ spaceId: string }> };

/** Map a free-form AI relationship headline onto the controlled vocab where it
 *  cleanly fits (so it coheres with decompose's feeds/depends_on edges), else
 *  keep the user-meaningful phrasing verbatim (capped). */
function toRelation(raw: string): string {
  const h = raw.trim().toLowerCase();
  if (!h) return "relates_to";
  if (/\bfeed/.test(h)) return "feeds";
  if (/\bdepend/.test(h)) return "depends_on";
  if (/\bderive/.test(h)) return "derived_from";
  if (/\bvalidat/.test(h)) return "validates";
  return h.replace(/\s+/g, " ").slice(0, 48);
}

export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let fromObjectId = "";
  let toObjectId = "";
  let relationRaw = "";
  try {
    const b = (await req.json()) as {
      fromObjectId?: unknown;
      toObjectId?: unknown;
      relation?: unknown;
    };
    fromObjectId = typeof b.fromObjectId === "string" ? b.fromObjectId : "";
    toObjectId = typeof b.toObjectId === "string" ? b.toObjectId : "";
    relationRaw = typeof b.relation === "string" ? b.relation : "";
  } catch {
    /* invalid body */
  }
  if (!fromObjectId || !toObjectId || fromObjectId === toObjectId) {
    return NextResponse.json(
      { error: "Need two distinct object ids" },
      { status: 400 },
    );
  }

  const { data: space } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space)
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // Defensive: both objects must belong to this space.
  const { data: objs } = await db
    .from("library_objects")
    .select("id")
    .eq("space_id", spaceId)
    .in("id", [fromObjectId, toObjectId]);
  if (!objs || objs.length < 2) {
    return NextResponse.json(
      { error: "Objects not found in this space" },
      { status: 404 },
    );
  }

  const relation = toRelation(relationRaw);
  await linkObjects(db, {
    spaceId,
    fromObjectId,
    toObjectId,
    relation: relation as ObjectRelation,
  });
  return NextResponse.json({ status: "ok", relation });
}
