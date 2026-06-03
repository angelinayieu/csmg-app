// POST /api/objective/draft
//
// Find-or-create the user's hidden DRAFT objective space — the real space
// the whiteboard-native intake board mounts on (so the board has a real
// spaceId from the first keystroke; no navigation/persistence-swap on
// submit). A draft = an objective_canvas space flagged
// synthesis_data.objective_canvas.draft = true with no objective yet.
// Promotion (/promote) clears the flag. One draft per user.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Reuse the existing draft if one exists.
  const { data: existing } = await db
    .from("spaces")
    .select("id")
    .eq("user_id", user.id)
    .eq("space_kind", "objective_canvas")
    .eq("synthesis_data->objective_canvas->>draft", "true")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    return NextResponse.json({ spaceId: existing.id as string });
  }

  // Create a fresh draft (lightweight — the insert trigger seeds layers).
  const { data: created, error: insErr } = await db
    .from("spaces")
    .insert({
      user_id: user.id,
      name: "Draft",
      description: "",
      space_prefix: "OB",
      input_text: "",
      entity_count: 0,
      edge_count: 0,
      orphan_count: 0,
      cycle_count: 0,
      maturity: "actionable_now",
      space_kind: "objective_canvas",
      pipeline_mode: "review_each",
      synthesis_data: { objective_canvas: { draft: true, stage: "main" } },
    })
    .select("id")
    .single();

  if (insErr || !created) {
    console.error("[objective/draft] create failed:", insErr);
    return NextResponse.json(
      { error: "Could not create a draft." },
      { status: 500 },
    );
  }
  return NextResponse.json({ spaceId: created.id as string });
}
