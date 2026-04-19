// ── Cross-surface search (Phase 45) ──
// GET /api/search?q=<text>
//   → { entities: SearchEntity[], reactions: SearchReaction[],
//        spaces: SearchSpace[] }
//
// Powers the studio command palette so users can jump to any entity
// or reaction across every space they own without first navigating to
// that space.
//
// Performance:
//   - Each table is queried independently (parallel)
//   - Hard limit per kind to keep the payload small (default 10 each)
//   - RLS naturally restricts to rows the user can see — no extra
//     joins needed in the query
//   - Pure ilike — fast for sub-50k row volumes; replace with pg_trgm
//     or a real search index when scale demands

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { Reaction } from "@/types/reactions";

export const maxDuration = 10;

const MIN_Q = 2;
const PER_KIND_LIMIT = 10;

interface SearchEntity {
  id: string;
  name: string;
  space_id: string;
  entity_category: string | null;
  layer: string | null;
}
interface SearchReaction {
  id: string;
  name: string;
  reaction_type: Reaction["reaction_type"];
  probability: number;
  space_id: string;
  entity_ids: string[];
  created_at: string;
}
interface SearchSpace {
  id: string;
  name: string;
  description: string | null;
}

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  void user;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_Q) {
    return NextResponse.json({ entities: [], reactions: [], spaces: [] });
  }

  // Postgres ilike escape: % and _ are wildcards. We allow them through
  // intentionally so users can do prefix search; just trim.
  const ilike = `%${q}%`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const [entitiesRes, reactionsRes, spacesRes] = await Promise.all([
    db
      .from("entities")
      .select("id, name, space_id, entity_category, layer")
      .ilike("name", ilike)
      .order("last_analyzed_at", { ascending: false, nullsFirst: false })
      .limit(PER_KIND_LIMIT),
    db
      .from("reactions")
      .select(
        "id, name, reaction_type, probability, space_id, entity_ids, created_at",
      )
      .ilike("name", ilike)
      .order("created_at", { ascending: false })
      .limit(PER_KIND_LIMIT),
    db
      .from("spaces")
      .select("id, name, description")
      .ilike("name", ilike)
      .order("updated_at", { ascending: false })
      .limit(PER_KIND_LIMIT),
  ]);

  return NextResponse.json({
    entities: (entitiesRes.data ?? []) as SearchEntity[],
    reactions: (reactionsRes.data ?? []) as SearchReaction[],
    spaces: (spacesRes.data ?? []) as SearchSpace[],
  });
}
