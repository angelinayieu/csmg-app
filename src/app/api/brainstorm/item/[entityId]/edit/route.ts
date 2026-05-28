// ── PATCH /api/brainstorm/item/[entityId]/edit ────────────────────
//
// Arc 3.6 — edit a problem (pain) or result (outcome) at the
// review checkpoint, BEFORE mechanisms are generated. There is no
// generic entity-edit route in the canvas (only specialized
// /item/* ones), so this is it — and it only edits existing entities,
// no schema.
//
// This is the hinge of the checkpoint: because Arc 3.2 makes each
// feature declare its bindings VERBATIM against a pain's root_cause +
// an outcome's indicator, editing those here changes which binding the
// mechanism stage will declare. Edits propagate into the causal chain.
//
// Body (all optional — only the provided fields change):
//   Pain (entity_type "pain_point"):
//     name?            — the problem title
//     negative_outcome? — the downstream consequence (also the entity description)
//     root_causes?     — string[] (≤6) the underlying causes a solution attacks
//   Outcome (entity_type "outcome"):
//     name?            — the result title
//     measured_by?     — the headline signal (also the entity description)
//     indicators?      — string[] (≤6) the observable success criteria
//
// When an outcome's indicators change, indicator_baselines is pruned:
// surviving indicator names keep their (possibly user-set) baseline;
// removed ones are dropped so no orphan baselines linger.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ entityId: string }>;
}

interface Body {
  name?: string;
  negative_outcome?: string;
  root_causes?: string[];
  measured_by?: string;
  indicators?: string[];
}

function cleanStringArray(v: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, max);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { entityId } = await ctx.params;
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: entity } = await db
    .from("entities")
    .select("id, name, entity_type, space_id, causal_chain")
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  if (entity.entity_type !== "pain_point" && entity.entity_type !== "outcome") {
    return NextResponse.json(
      {
        error:
          "only problems (pain) and results (outcome) are editable here (got entity_type=" +
          entity.entity_type +
          ")",
      },
      { status: 400 },
    );
  }

  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const cc = (entity.causal_chain as Record<string, unknown>) ?? {};
  const nextCc: Record<string, unknown> = { ...cc };
  const update: Record<string, unknown> = {};

  // Name (the lane card title).
  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, 200) : undefined;
  if (name) update.name = name;

  if (entity.entity_type === "pain_point") {
    const negative_outcome =
      typeof body?.negative_outcome === "string"
        ? body.negative_outcome.trim().slice(0, 200)
        : undefined;
    if (negative_outcome !== undefined) {
      nextCc.negative_outcome = negative_outcome;
      // entity.description mirrors negative_outcome (matches the room
      // generator's persistence).
      update.description = negative_outcome;
    }
    if (Array.isArray(body?.root_causes)) {
      nextCc.root_causes = cleanStringArray(body.root_causes, 6, 80);
    }
  } else {
    // outcome
    const measured_by =
      typeof body?.measured_by === "string"
        ? body.measured_by.trim().slice(0, 150)
        : undefined;
    if (measured_by !== undefined) {
      nextCc.measured_by = measured_by;
      update.description = measured_by;
    }
    if (Array.isArray(body?.indicators)) {
      const nextIndicators = cleanStringArray(body.indicators, 6, 100);
      nextCc.indicators = nextIndicators;
      // Prune indicator_baselines to surviving indicators (case-
      // insensitive) so edited-away indicators don't leave orphan
      // baselines. Keep whatever the user/LLM already set for the rest.
      const existingBaselines =
        (cc.indicator_baselines as Record<string, unknown> | null) ?? null;
      if (existingBaselines && typeof existingBaselines === "object") {
        const survivorLower = new Set(
          nextIndicators.map((i) => i.toLowerCase()),
        );
        const pruned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(existingBaselines)) {
          if (survivorLower.has(k.toLowerCase())) pruned[k] = v;
        }
        nextCc.indicator_baselines = pruned;
      }
      // Same prune for the raw indicator_specs measurement scaffold.
      const existingSpecs = cc.indicator_specs;
      if (Array.isArray(existingSpecs)) {
        const survivorLower = new Set(
          nextIndicators.map((i) => i.toLowerCase()),
        );
        nextCc.indicator_specs = (existingSpecs as unknown[]).filter((s) => {
          const ind =
            s && typeof s === "object"
              ? (s as { indicator?: unknown }).indicator
              : null;
          return typeof ind === "string" && survivorLower.has(ind.toLowerCase());
        });
      }
    }
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
    name: (update.name as string) ?? entity.name,
    causal_chain: nextCc,
  });
}
