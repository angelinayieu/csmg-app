// ── /api/spaces/[id]/card-brief ─────────────────────────────────────
//
// Returns the space's home-library-card brief (AI-summarized name + 2-3
// key points), generating + caching it when missing or stale (the cached
// from_updated_at predates spaces.updated_at). Owner-only.
//
// POST (not GET) because a cache miss triggers an LLM generation + write.
// The home grid calls this progressively for cards lacking a fresh brief,
// so SSR stays fast and cards "sharpen" a moment after load. Soft-fails to
// { brief: null } (or the last good cached brief) so a card never breaks.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import {
  summarizeSpaceCard,
  BRIEF_VERSION,
  type SpaceCardBrief,
} from "@/lib/objective-canvas/summarize-space-card";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: space } = await db
    .from("spaces")
    .select("updated_at, card_brief")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  const cached = space?.card_brief as SpaceCardBrief | null | undefined;
  const updatedAt = space?.updated_at as string | null | undefined;

  // Fresh = a current-version, well-formed cached brief whose source
  // updated_at is at or after the space's current updated_at. Older-version
  // briefs (e.g. pre-AI-refined-title) regenerate once.
  const fresh =
    !!cached &&
    cached.v === BRIEF_VERSION &&
    typeof cached.name === "string" &&
    Array.isArray(cached.points) &&
    (!updatedAt ||
      !cached.from_updated_at ||
      new Date(cached.from_updated_at).getTime() >=
        new Date(updatedAt).getTime());

  if (fresh) {
    return NextResponse.json({ brief: cached });
  }

  // Regenerate; on failure keep the last good brief (if any) rather than
  // dropping to a blank card on a transient LLM hiccup.
  const brief = (await summarizeSpaceCard(db, spaceId)) ?? cached ?? null;
  return NextResponse.json({ brief });
}
