// POST /api/objective/sandbox → { spaceId }
//
// Create a fresh, fully-isolated scratch space. Everything is space_id-scoped
// with CASCADE (entities, library_objects, synthesis_data, glossary…), so a new
// space is naturally a clean sandbox. Marked synthesis_data.objective_canvas
// .sandbox so it never auto-fires the intake sharpening pipeline (it's a blank
// board to play on), and pipeline_mode "manual" so no chains run.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error: insErr } = await db
    .from("spaces")
    .insert({
      user_id: user.id,
      name: "Sandbox",
      description: "",
      space_prefix: "OB",
      // Non-empty so the space is visible in the library + routes as an
      // objective canvas; the sandbox flag keeps the sharpening pipeline off.
      input_text: "Sandbox",
      entity_count: 0,
      edge_count: 0,
      orphan_count: 0,
      cycle_count: 0,
      maturity: "actionable_now",
      space_kind: "objective_canvas",
      pipeline_mode: "manual",
      synthesis_data: { objective_canvas: { sandbox: true, stage: "main" } },
    })
    .select("id")
    .single();

  if (insErr || !data) {
    return NextResponse.json(
      { error: insErr?.message || "Create failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ spaceId: data.id });
}
