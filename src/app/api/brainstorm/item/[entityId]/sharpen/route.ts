// ── POST /api/brainstorm/item/[entityId]/sharpen ──────────────────
//
// Arc 3.6 — one-click LLM rewrite that tightens a vague problem (pain)
// or result (outcome) at the review checkpoint. Vague definitions are
// the source of vague mechanisms; sharpening the problem/result first
// means the feature stage declares sharp bindings against sharp
// root_causes / indicators.
//
// Persists the sharpened fields back onto the entity (same shape the
// room generator + the edit endpoint write). For outcomes, the new
// indicator_specs reseed indicator_baselines (source:"llm"), keeping
// any user-set baseline_value/target_value for surviving indicators.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import { sharpenDefinition } from "@/lib/objective-canvas/sharpen-definition";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ entityId: string }>;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter((s): s is string => typeof s === "string");
}

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { entityId } = await ctx.params;
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: entity } = await db
    .from("entities")
    .select(
      "id, name, entity_type, space_id, parent_sub_objective_id, causal_chain",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  if (entity.entity_type !== "pain_point" && entity.entity_type !== "outcome") {
    return NextResponse.json(
      { error: "only problems (pain) and results (outcome) can be sharpened" },
      { status: 400 },
    );
  }

  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── Grounding: sub-objective title + core objective text ──
  let subObjectiveTitle = "";
  let coreObjectiveText = "";
  if (typeof entity.parent_sub_objective_id === "string") {
    const { data: sub } = await db
      .from("improvement_goals")
      .select("title, parent_goal_id")
      .eq("id", entity.parent_sub_objective_id)
      .maybeSingle();
    subObjectiveTitle = (typeof sub?.title === "string" && sub.title) || "";
    if (sub?.parent_goal_id) {
      const { data: parent } = await db
        .from("improvement_goals")
        .select("title, description")
        .eq("id", sub.parent_goal_id)
        .maybeSingle();
      coreObjectiveText =
        (typeof parent?.description === "string" && parent.description.trim()) ||
        (typeof parent?.title === "string" && parent.title.trim()) ||
        "";
    }
  }
  if (!coreObjectiveText) {
    coreObjectiveText =
      (typeof space.description === "string" && space.description.trim()) ||
      (typeof space.input_text === "string" && space.input_text.trim()) ||
      "";
  }
  const constraints = readConstraints(space.synthesis_data);

  const cc = (entity.causal_chain as Record<string, unknown>) ?? {};
  const kind: "pain" | "outcome" =
    entity.entity_type === "pain_point" ? "pain" : "outcome";

  const sharpened = await sharpenDefinition({
    kind,
    name: entity.name,
    negative_outcome:
      typeof cc.negative_outcome === "string" ? cc.negative_outcome : undefined,
    root_causes: stringArray(cc.root_causes),
    measured_by:
      typeof cc.measured_by === "string" ? cc.measured_by : undefined,
    indicators: stringArray(cc.indicators),
    sub_objective_title: subObjectiveTitle,
    core_objective_text: coreObjectiveText,
    constraints,
  });

  if (!sharpened) {
    return NextResponse.json(
      { error: "sharpen failed", detail: "llm_failed" },
      { status: 502 },
    );
  }

  const nextCc: Record<string, unknown> = { ...cc };
  const update: Record<string, unknown> = { name: sharpened.name };
  const now = new Date().toISOString();

  if (sharpened.kind === "pain") {
    nextCc.negative_outcome = sharpened.negative_outcome;
    nextCc.root_causes = sharpened.root_causes;
    update.description = sharpened.negative_outcome;
  } else {
    nextCc.measured_by = sharpened.measured_by;
    nextCc.indicators = sharpened.indicators;
    nextCc.indicator_specs = sharpened.indicator_specs;
    update.description = sharpened.measured_by;
    // Reseed indicator_baselines from the new specs — but PRESERVE any
    // user-set baseline_value/target_value for indicators whose name
    // survived (case-insensitive).
    const prior =
      (cc.indicator_baselines as Record<string, Record<string, unknown>> | null) ??
      {};
    const priorByLower = new Map<string, Record<string, unknown>>();
    for (const [k, v] of Object.entries(prior)) {
      priorByLower.set(k.toLowerCase(), v);
    }
    const nextBaselines: Record<string, Record<string, unknown>> = {};
    for (const s of sharpened.indicator_specs) {
      const carried = priorByLower.get(s.indicator.toLowerCase()) ?? {};
      nextBaselines[s.indicator] = {
        ...(s.unit ? { unit: s.unit } : carried.unit ? { unit: carried.unit } : {}),
        ...(s.measurement_method
          ? { measurement_method: s.measurement_method }
          : carried.measurement_method
            ? { measurement_method: carried.measurement_method }
            : {}),
        ...(s.direction ? { direction: s.direction } : {}),
        // Preserve the user's measured values if they had set them.
        ...(carried.baseline_value
          ? { baseline_value: carried.baseline_value }
          : {}),
        ...(carried.target_value
          ? { target_value: carried.target_value }
          : {}),
        source: carried.baseline_value || carried.target_value ? "user" : "llm",
        updated_at: now,
      };
    }
    nextCc.indicator_baselines = nextBaselines;
  }

  update.causal_chain = nextCc;

  const { error: updateErr } = await db
    .from("entities")
    .update(update)
    .eq("id", entityId);
  if (updateErr) {
    return NextResponse.json(
      { error: "persist failed", detail: updateErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    entity_id: entityId,
    name: sharpened.name,
    causal_chain: nextCc,
  });
}
