// ── POST /api/brainstorm/item/variation/export-prompt ─────────────
//
// Phase 13 — generate a ready-to-paste AI prompt for a variation,
// encoding the objective + mechanism + pain + constraints + open
// questions. Persists on entities.expanded_detail.variations[i].
// export_prompt. Idempotent (cache hit returns existing; mode=force
// regenerates).
//
// Body: { entityId, variationId, framing?: "implementation"|"design"|"research", mode?: "default"|"force" }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";
import {
  generateVariationExportPrompt,
  runExportPromptRoundTrip,
} from "@/lib/objective-canvas/generate-export-prompt";
import { readConstraints } from "@/lib/objective-canvas/constraints";

export const runtime = "nodejs";
export const maxDuration = 90;

interface Body {
  entityId?: string;
  variationId?: string;
  framing?: "implementation" | "design" | "research";
  mode?: "default" | "force";
  /** Op B — when true, run the round-trip optimizer (generate → test
   *  → judge → conditional revise → re-test → re-judge). Costs +3 LLM
   *  calls worst case; latency ~30-40s. Off by default — the route
   *  stays cheap unless the user opts in. */
  optimize?: boolean;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  const variationId =
    typeof body?.variationId === "string" ? body.variationId : "";
  const force = body?.mode === "force";
  const optimize = body?.optimize === true;
  const framing = body?.framing ?? "implementation";
  if (!entityId || !variationId) {
    return NextResponse.json(
      { error: "entityId + variationId required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: entity } = await db
    .from("entities")
    .select("id, name, space_id, parent_sub_objective_id, expanded_detail")
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const detail = (entity.expanded_detail as ExpandedItemDetail | null) ?? null;
  if (!detail || !Array.isArray(detail.variations)) {
    return NextResponse.json(
      { error: "entity has no expanded_detail.variations" },
      { status: 409 },
    );
  }
  const variation = detail.variations.find((v) => v.id === variationId);
  if (!variation) {
    return NextResponse.json(
      { error: "variation not found on this entity" },
      { status: 404 },
    );
  }

  // Cache hit short-circuit. When the caller asks for optimize=true
  // but we only have the legacy single-shot prompt cached, treat
  // that as a miss so we rebuild with the full pipeline.
  if (!force && typeof variation.export_prompt === "string" && variation.export_prompt.length > 0) {
    if (!optimize || variation.export_prompt_history) {
      return NextResponse.json({
        cached: true,
        export_prompt: variation.export_prompt,
        export_prompt_generated_at: variation.export_prompt_generated_at ?? null,
        export_prompt_history: variation.export_prompt_history ?? null,
      });
    }
  }

  // Resolve objective text + room title + pain (best-effort).
  let objectiveText: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "(no objective text)";
  let roomTitle: string | null = null;
  let painText: string | null = null;
  try {
    if (entity.parent_sub_objective_id) {
      const { data: sub } = await db
        .from("improvement_goals")
        .select("title, top_negative_outcome")
        .eq("id", entity.parent_sub_objective_id)
        .maybeSingle();
      if (sub) {
        roomTitle = typeof sub.title === "string" ? sub.title : null;
        painText = typeof sub.top_negative_outcome === "string"
          ? sub.top_negative_outcome
          : null;
      }
    }
  } catch {
    // Soft-fail.
  }

  const genArgs = {
    variation,
    entityName: typeof entity.name === "string" ? entity.name : "(unknown)",
    objectiveText,
    roomTitle,
    painText,
    constraints: readConstraints(space.synthesis_data),
    framing,
    // Phase A — feed the parent feature's v2 mechanism spec (when one
    // exists) so the exported prompt's ## Mechanism section carries real
    // technical depth instead of re-deriving from the 1-line description.
    mechanismSpec: detail.mechanism_spec ?? null,
  };

  // Op B — two paths:
  //   optimize=false → single-shot generator (legacy + cheap default)
  //   optimize=true  → full round-trip: gen → test → judge → revise?
  let finalPrompt: string;
  let history: import("@/lib/objective-canvas/generate-export-prompt").RoundTripResult | undefined;
  try {
    if (optimize) {
      history = await runExportPromptRoundTrip(genArgs);
      finalPrompt = history.final_prompt;
    } else {
      const single = await generateVariationExportPrompt(genArgs);
      finalPrompt = single.prompt;
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "export-prompt generation failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  const generatedAt = new Date().toISOString();
  const nextVariations = detail.variations.map((v) =>
    v.id === variationId
      ? {
          ...v,
          export_prompt: finalPrompt,
          export_prompt_generated_at: generatedAt,
          ...(history ? { export_prompt_history: history } : {}),
        }
      : v,
  );
  const nextDetail: ExpandedItemDetail = {
    ...detail,
    variations: nextVariations,
  };
  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: nextDetail })
    .eq("id", entityId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "persist failed", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    export_prompt: finalPrompt,
    export_prompt_generated_at: generatedAt,
    export_prompt_history: history ?? null,
  });
}
