// ── /api/brainstorm/space/[spaceId]/agent-spec (P1.2-B) ───────────
//
// POST  — compile the canvas into a unified AgentBuildSpec (one LLM
//         synth call) + cache it on synthesis_data.agent_build_spec,
//         keyed by the cross-room state_hash. Mirrors the brief-polish
//         cache pattern. Body: { mode?: "default" | "force" }.
// GET   — return the cached spec when its state_hash still matches
//         (fresh); when present-but-stale, return it flagged stale;
//         when absent, 404 (the UI then POSTs to compile).
//
// Gathers exactly what compileAgentBuildSpec() expects: the
// StrategyBrief (loadCrossRoomState → buildStrategyBrief), the elected
// features' MechanismSpecs (entities.expanded_detail.mechanism_spec),
// the define block (synthesis_data.define, P1.1), the glossary, and a
// best-effort macro layer skeleton (objective_canvas.layers). The macro
// layers' subObjectives/macroProblems stay empty until the macro
// roll-up wires them — the compiler degrades gracefully either way.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { loadCrossRoomState } from "@/lib/objective-canvas/analyses/cross-room-state";
import { buildStrategyBrief } from "@/lib/objective-canvas/build-strategy-brief";
import {
  compileAgentBuildSpec,
  renderAgentBuildSpecMarkdown,
  type AgentBuildSpec,
  type MacroLayerInput,
} from "@/lib/objective-canvas/compile-agent-build-spec";
import type { MechanismSpec } from "@/lib/objective-canvas/enrich-mechanism-spec";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface Body {
  mode?: "default" | "force";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** Gather the inputs the compiler expects + run it. Shared by POST. */
async function gatherAndCompile(
  db: AnyDb,
  spaceId: string,
  userId: string,
): Promise<{ spec: AgentBuildSpec; synthesisData: Record<string, unknown>; stateHash: string } | { empty: true }> {
  const loaded = await loadCrossRoomState({ db, spaceId, userId });
  const synthesisData =
    (loaded.synthesisData as Record<string, unknown> | null) ?? {};

  const cachedAnalysis: CrossRoomAnalysisState | null =
    (synthesisData.cross_room_analysis as CrossRoomAnalysisState | null | undefined) ??
    null;
  const brief = buildStrategyBrief({
    state: loaded.state,
    analysis: cachedAnalysis,
    cachedTldr: null,
  });
  if (brief.totals.rooms === 0) return { empty: true };

  // ── Elected features → their MechanismSpecs (one batched query) ──
  const electedIds = Array.from(
    new Set(
      brief.rooms.flatMap((r) => r.elected_variations.map((v) => v.item_id)),
    ),
  );
  const mechanismSpecs: Record<string, MechanismSpec> = {};
  if (electedIds.length > 0) {
    const { data: ents } = await db
      .from("entities")
      .select("id, expanded_detail")
      .in("id", electedIds);
    for (const e of (ents ?? []) as Array<{
      id: string;
      expanded_detail: { mechanism_spec?: MechanismSpec } | null;
    }>) {
      const ms = e.expanded_detail?.mechanism_spec;
      if (ms) mechanismSpecs[e.id] = ms;
    }
  }

  // ── define block (P1.1) ──
  const defineBlock =
    synthesisData.define &&
    typeof synthesisData.define === "object" &&
    !Array.isArray(synthesisData.define)
      ? (synthesisData.define as Record<string, unknown>)
      : null;

  // ── glossary terms ──
  // Phase 2 — also pass concept_slug + annotation_phrase through so the
  // compiler's LLM prompt + the spec terminology entries carry the
  // concept-trace-back back to annotations. Pre-Phase-2 rows simply have
  // these fields undefined and the compiler falls back to old behavior.
  const glossaryRaw = Array.isArray(synthesisData.glossary)
    ? (synthesisData.glossary as Array<Record<string, unknown>>)
    : [];
  const glossary = glossaryRaw
    .map((g) => ({
      term: typeof g.term === "string" ? g.term : "",
      definition: typeof g.definition === "string" ? g.definition : "",
      concept_slug:
        typeof g.concept_slug === "string" && g.concept_slug
          ? g.concept_slug
          : undefined,
      annotation_phrase:
        typeof g.annotation_phrase === "string" && g.annotation_phrase
          ? g.annotation_phrase
          : undefined,
    }))
    .filter((g) => g.term && g.definition);

  // ── macro layer skeleton (best-effort from objective_canvas.layers) ──
  // objective_canvas.layers is the ObjectiveStack object; its `.layers`
  // is the ObjectiveLayer[]. subObjectives/macroProblems stay empty until
  // the macro roll-up wires them — compile degrades gracefully.
  const oc = synthesisData.objective_canvas as
    | { layers?: { layers?: unknown } }
    | undefined;
  const layerArr = Array.isArray(oc?.layers?.layers)
    ? (oc!.layers!.layers as Array<Record<string, unknown>>)
    : [];
  // P-CtD — wire the per-layer subObjectives + macroProblems the compiler
  // expects. Previously hardcoded empty, so every feature's layer resolved
  // to "" (the dead room→layer join). subObjectives come from the rooms'
  // layer_ordinals tags (the Step-1 seam on RoomSnapshot); macroProblems
  // from the macro_problems roll-up findings, keyed by layer_ordinal.
  const subObjectivesByOrdinal = new Map<number, string[]>();
  for (const r of loaded.state.rooms ?? []) {
    for (const ord of r.layer_ordinals ?? []) {
      const arr = subObjectivesByOrdinal.get(ord) ?? [];
      if (r.title) arr.push(r.title);
      subObjectivesByOrdinal.set(ord, arr);
    }
  }
  const macroProblemsByOrdinal = new Map<
    number,
    Array<{ name: string; description: string }>
  >();
  for (const f of cachedAnalysis?.findings ?? []) {
    if (f.analysis_key !== "macro_problems") continue;
    const body = (f.body ?? {}) as { layer_ordinal?: unknown; name?: unknown };
    if (typeof body.layer_ordinal !== "number") continue;
    const arr = macroProblemsByOrdinal.get(body.layer_ordinal) ?? [];
    arr.push({
      name: typeof body.name === "string" ? body.name : f.title,
      description: typeof f.summary === "string" ? f.summary : "",
    });
    macroProblemsByOrdinal.set(body.layer_ordinal, arr);
  }

  const macroLayers: MacroLayerInput[] | null =
    layerArr.length > 0
      ? layerArr.map((l, i) => {
          const ordinal = typeof l.ordinal === "number" ? l.ordinal : i + 1;
          return {
            ordinal,
            id: typeof l.id === "string" ? l.id : `L${i + 1}`,
            name:
              typeof l.name === "string"
                ? l.name
                : typeof l.label === "string"
                  ? (l.label as string)
                  : "",
            archetype: typeof l.archetype === "string" ? l.archetype : "",
            subObjectives: subObjectivesByOrdinal.get(ordinal) ?? [],
            macroProblems: macroProblemsByOrdinal.get(ordinal) ?? [],
          };
        })
      : null;

  const spec = await compileAgentBuildSpec({
    brief,
    defineBlock,
    mechanismSpecs,
    macroLayers,
    glossary,
    stateHash: loaded.state_hash,
  });

  return { spec, synthesisData, stateHash: loaded.state_hash };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  const { data: body } = await safeJsonParse<Body>(req);
  const force = body?.mode === "force";

  const db = auth.supabase as AnyDb;

  const { data: ownerRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!ownerRow || ownerRow.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    // Cheap cache pre-check (avoids the LLM call on an unchanged canvas).
    const loaded = await loadCrossRoomState({ db, spaceId, userId: auth.user.id });
    const synthesisData =
      (loaded.synthesisData as Record<string, unknown> | null) ?? {};
    const cached = synthesisData.agent_build_spec as AgentBuildSpec | null | undefined;
    if (!force && cached && cached.state_hash === loaded.state_hash) {
      return NextResponse.json({
        spec: cached,
        markdown: renderAgentBuildSpecMarkdown(cached),
        cached: true,
      });
    }

    const result = await gatherAndCompile(db, spaceId, auth.user.id);
    if ("empty" in result) {
      return NextResponse.json(
        { error: "No rooms generated yet — nothing to compile." },
        { status: 409 },
      );
    }

    const nextSynth = {
      ...result.synthesisData,
      agent_build_spec: result.spec,
    };
    const writeRes = await db
      .from("spaces")
      .update({ synthesis_data: nextSynth })
      .eq("id", spaceId);
    if (writeRes.error) {
      console.warn(
        "[agent-spec] persist failed (non-fatal):",
        writeRes.error.message,
      );
    }

    // Notebook visibility — only the fresh-compile path (cache hits
    // short-circuit above before this).
    void logDecision(db, {
      userId: auth.user.id,
      spaceId,
      subObjectiveId: null,
      action: "deliverable_generated",
      metadata: {
        deliverable_subtype: "agent_spec",
        state_hash: result.spec.state_hash ?? null,
      },
    });

    return NextResponse.json({
      spec: result.spec,
      markdown: renderAgentBuildSpecMarkdown(result.spec),
      cached: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "compile failed", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const db = auth.supabase as AnyDb;

  const { data: ownerRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!ownerRow || ownerRow.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const loaded = await loadCrossRoomState({ db, spaceId, userId: auth.user.id });
    const synthesisData =
      (loaded.synthesisData as Record<string, unknown> | null) ?? {};
    const cached = synthesisData.agent_build_spec as AgentBuildSpec | null | undefined;
    if (!cached) {
      return NextResponse.json({ error: "not generated yet" }, { status: 404 });
    }
    // ?format=md → downloadable markdown (mirror deliverables/export headers).
    if (new URL(req.url).searchParams.get("format") === "md") {
      const md = renderAgentBuildSpecMarkdown(cached);
      const filename = `agent-build-spec-${new Date().toISOString().slice(0, 10)}.md`;
      return new NextResponse(md, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }
    return NextResponse.json({
      spec: cached,
      cached: true,
      stale: cached.state_hash !== loaded.state_hash,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "load failed", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
