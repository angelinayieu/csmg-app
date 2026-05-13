// ── GET /api/synergy/marketplace/feed ──
//
// Cursor-paginated list of components users have marked
// visibility='public'. The brainstorm_components_public_read RLS
// policy (migration 20260813) lets authenticated callers read these
// rows regardless of ownership.
//
// Query params:
//   cursor    — ISO timestamp; rows older than this are returned
//   limit     — 1..50, default 24
//   kind      — optional: core_idea | upstream | downstream | polished_product
//   q         — optional free-text; ilike against label + description
//
// Hydrates each row with the owner's synergy_profile (display_name,
// avatar_url) so cards can attribute. The hydration is a separate
// batched lookup keyed by distinct owner_ids — cheaper than a join
// for the small page sizes here.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set([
  "core_idea",
  "upstream",
  "downstream",
  "polished_product",
]);

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "24", 10) || 24, 1),
    50,
  );
  const kind = url.searchParams.get("kind");
  const q = url.searchParams.get("q")?.trim();

  let query = db
    .from("brainstorm_components")
    .select(
      "id, owner_id, kind, subkind, label_public, description_public, created_at",
    )
    .eq("visibility", "public")
    // Don't surface the caller's own components in the feed — those
    // already appear in their own components card; mixing them in
    // adds noise without value.
    .neq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit + 1); // peek for next_cursor

  if (cursor) {
    query = query.lt("created_at", cursor);
  }
  if (kind && ALLOWED_KINDS.has(kind)) {
    query = query.eq("kind", kind);
  }
  if (q) {
    // ilike against either column. Postgres `or` filter syntax for
    // postgrest goes through a single string.
    const safe = q.replace(/[%_]/g, ""); // strip wildcards
    query = query.or(
      `label_public.ilike.%${safe}%,description_public.ilike.%${safe}%`,
    );
  }

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  const items = (rows ?? []) as Array<{
    id: string;
    owner_id: string;
    kind: string;
    subkind: string | null;
    label_public: string;
    description_public: string;
    created_at: string;
  }>;

  // Pagination peek
  let nextCursor: string | null = null;
  if (items.length > limit) {
    const overflow = items.pop()!;
    nextCursor = overflow.created_at;
  }

  // Batched owner profile lookup
  const ownerIds = Array.from(new Set(items.map((i) => i.owner_id)));
  let profileMap = new Map<
    string,
    { display_name: string; avatar_url: string | null }
  >();
  if (ownerIds.length > 0) {
    const { data: profiles } = await db
      .from("synergy_profiles")
      .select("user_id, display_name, avatar_url")
      .in("user_id", ownerIds);
    profileMap = new Map(
      ((profiles ?? []) as Array<{
        user_id: string;
        display_name: string;
        avatar_url: string | null;
      }>).map((p) => [
        p.user_id,
        { display_name: p.display_name, avatar_url: p.avatar_url },
      ]),
    );
  }

  const hydrated = items.map((i) => ({
    id: i.id,
    kind: i.kind,
    subkind: i.subkind,
    label_public: i.label_public,
    description_public: i.description_public,
    created_at: i.created_at,
    owner: {
      user_id: i.owner_id,
      display_name:
        profileMap.get(i.owner_id)?.display_name ?? "Anonymous",
      avatar_url: profileMap.get(i.owner_id)?.avatar_url ?? null,
    },
  }));

  return NextResponse.json({ items: hydrated, next_cursor: nextCursor });
}
