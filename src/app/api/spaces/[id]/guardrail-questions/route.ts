// GET  /api/spaces/[id]/guardrail-questions
// POST /api/spaces/[id]/guardrail-questions  (body: { question_id, answer })
//
// GET: harvests gap signals from synthesis_data + entities + edges +
// space meta, runs them through the deterministic question generator,
// returns 2-4 prioritized questions plus the user's existing answers.
//
// POST: persists an answer to spaces.guardrail_answers JSONB. The
// answer becomes a hard constraint on every future LLM call in this
// space via buildGuardrailBlock() (see intent-context.ts wiring in
// the follow-up task).

import { NextResponse } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import {
  generateQuestionsFromSignals,
  type GapSignal,
  type GuardrailQuestion,
  type GuardrailAnswer,
} from "@/lib/prompts/guardrail-questions";

export const runtime = "nodejs";

interface GetResponse {
  questions: GuardrailQuestion[];
  answers: Record<string, GuardrailAnswer>;
  // Diagnostic — number of raw signals before pruning to questions.
  signal_count: number;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load everything we need to harvest signals. Most reads are tiny
  // and parallel-safe.
  const [spaceRes, entitiesRes, edgesRes] = await Promise.all([
    db
      .from("spaces")
      .select(
        // Note: there's no top-level `last_synthesis_at` column — the
        // synthesis-completion timestamp is buried in
        // synthesis_data.strategic_recommendation.generated_at. We
        // extract it after the read instead of adding a column.
        "synthesis_data, guardrail_answers, user_profile, last_paper_landed_at",
      )
      .eq("id", spaceId)
      .maybeSingle(),
    db
      .from("entities")
      .select(
        "id, name, importance, source_tag, is_leverage_point, is_risk_point, is_master_bottleneck, measurement_value_kind, ambiguity_type",
      )
      .eq("space_id", spaceId)
      .limit(500),
    db
      .from("edges")
      .select("source_entity_id, target_entity_id")
      .eq("space_id", spaceId)
      .limit(2000),
  ]);

  const space = spaceRes?.data as
    | {
        synthesis_data: Record<string, unknown> | null;
        guardrail_answers: Record<string, GuardrailAnswer> | null;
        user_profile: Record<string, unknown> | null;
        last_paper_landed_at: string | null;
      }
    | null;
  if (!space) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const entities = (entitiesRes?.data ?? []) as Array<{
    id: string;
    name: string;
    importance: string | null;
    source_tag: string | null;
    is_leverage_point: boolean | null;
    is_risk_point: boolean | null;
    is_master_bottleneck: boolean | null;
    measurement_value_kind: string | null;
    ambiguity_type: string | null;
  }>;
  const edges = (edgesRes?.data ?? []) as Array<{
    source_entity_id: string;
    target_entity_id: string;
  }>;

  const signals = harvestSignals(space, entities, edges);
  const allQuestions = generateQuestionsFromSignals(signals);

  // Hide questions the user has already answered. Keep at most 4 in
  // the active queue so the UI stays light.
  const answered = (space.guardrail_answers ?? {}) as Record<
    string,
    GuardrailAnswer
  >;
  const unanswered = allQuestions.filter((q) => !answered[q.id]);

  return NextResponse.json<GetResponse>({
    questions: unanswered.slice(0, 4),
    answers: answered,
    signal_count: signals.length,
  });
}

interface PostBody {
  question_id?: string;
  question_text?: string;
  category?: string;
  answer?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: parseErr } = await safeJsonParse<PostBody>(request);
  if (parseErr) return parseErr;

  const questionId = typeof body?.question_id === "string" ? body.question_id : "";
  const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  const questionText =
    typeof body?.question_text === "string" ? body.question_text : "";
  const category = typeof body?.category === "string" ? body.category : "";

  if (!questionId || !answer || answer.length < 2) {
    return NextResponse.json(
      { error: "question_id and a substantive answer required" },
      { status: 400 },
    );
  }
  if (answer.length > 2000) {
    return NextResponse.json(
      { error: "answer must be ≤ 2000 chars" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Atomic update: read current map, merge, write back. Single round-
  // trip via jsonb_set would be cleaner but doesn't compose with the
  // PostgREST client without raw SQL.
  const { data: spaceRow } = (await db
    .from("spaces")
    .select("guardrail_answers")
    .eq("id", spaceId)
    .maybeSingle()) as {
    data: { guardrail_answers: Record<string, GuardrailAnswer> | null } | null;
  };
  const existing = spaceRow?.guardrail_answers ?? {};
  const next: Record<string, GuardrailAnswer> = {
    ...existing,
    [questionId]: {
      answer,
      answered_at: new Date().toISOString(),
      question_text: questionText,
      category,
    },
  };

  const { error: updErr } = await db
    .from("spaces")
    .update({ guardrail_answers: next })
    .eq("id", spaceId);
  if (updErr) {
    return NextResponse.json(
      { error: "Failed to persist answer" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, answers: next });
}

// ── Signal harvest ────────────────────────────────────────────────────
// Read each gap-detection field that the rest of the pipeline already
// computes, plus a few simple structural checks, and emit GapSignal
// entries. This is the part that determines WHICH questions get asked.
//
// We deliberately keep this function "deterministic + introspectable" —
// no LLM here. The questions need to be replayable: same KG state →
// same question ids. Otherwise the user can't trust that answering
// one settles the matter.

function harvestSignals(
  space: {
    synthesis_data: Record<string, unknown> | null;
    user_profile: Record<string, unknown> | null;
    last_paper_landed_at: string | null;
  },
  entities: Array<{
    id: string;
    name: string;
    importance: string | null;
    source_tag: string | null;
    is_leverage_point: boolean | null;
    is_risk_point: boolean | null;
    is_master_bottleneck: boolean | null;
    measurement_value_kind: string | null;
    ambiguity_type: string | null;
  }>,
  edges: Array<{ source_entity_id: string; target_entity_id: string }>,
): GapSignal[] {
  const signals: GapSignal[] = [];
  const synthesis = space.synthesis_data ?? {};

  // ── A. Intake gaps ───────────────────────────────────────────────
  const userProfile = (space.user_profile ?? {}) as {
    population?: string;
    primary_goal?: string;
  };
  if (!userProfile.population) {
    signals.push({
      kind: "missing_population_scope",
      severity: "important",
    });
  }
  if (!userProfile.primary_goal) {
    signals.push({
      kind: "missing_user_goal",
      severity: "important",
    });
  }

  // ── B. Synthesis-quality gaps ────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leverage = ((synthesis as any).leverage_points as Array<{
    entity_id?: string;
    entity_name?: string;
    mechanism_grounding?: {
      falsifiable_prediction?: string;
      mechanism_explanation?: string;
      evidence_strength?: string;
    };
    reasoning?: unknown;
  }>) ?? [];

  for (const lev of leverage) {
    const mg = lev.mechanism_grounding ?? {};
    if (!mg.falsifiable_prediction || mg.falsifiable_prediction.trim().length < 8) {
      signals.push({
        kind: "missing_falsifiable_prediction",
        ref_id: lev.entity_id,
        ref_name: lev.entity_name,
        severity: "critical",
      });
    }
    if (!mg.mechanism_explanation || mg.mechanism_explanation.trim().length < 12) {
      signals.push({
        kind: "shallow_leverage",
        ref_id: lev.entity_id,
        ref_name: lev.entity_name,
        severity: "important",
      });
    }
    if (mg.evidence_strength === "anecdotal" || mg.evidence_strength === "inferred") {
      signals.push({
        kind: "low_evidence_strength",
        ref_id: lev.entity_id,
        ref_name: lev.entity_name,
        severity: "nice_to_have",
      });
    }
  }

  // ── C. Bottleneck gaps ───────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bottleneck = (synthesis as any).master_bottleneck as
    | {
        entity_id?: string;
        mechanism_grounding?: {
          falsifiable_prediction?: string;
        };
        counterfactual_unlock?: string;
      }
    | null
    | undefined;
  if (bottleneck) {
    const mg = bottleneck.mechanism_grounding;
    if (!mg?.falsifiable_prediction || mg.falsifiable_prediction.trim().length < 8) {
      signals.push({
        kind: "missing_falsifiable_prediction",
        ref_id: bottleneck.entity_id,
        ref_name: bottleneck.entity_id
          ? entities.find((e) => e.id === bottleneck.entity_id)?.name
          : undefined,
        severity: "critical",
      });
    }
    if (!bottleneck.counterfactual_unlock || bottleneck.counterfactual_unlock.trim().length < 12) {
      signals.push({
        kind: "shallow_leverage",
        ref_id: bottleneck.entity_id,
        severity: "important",
      });
    }
  }

  // ── D. Axiom visibility ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const axioms = ((synthesis as any).axioms as Array<{ visibility?: string }>) ?? [];
  if (axioms.length > 0 && !axioms.some((a) => a.visibility === "HIDDEN")) {
    signals.push({ kind: "missing_hidden_axiom", severity: "important" });
  }

  // ── E. Per-entity measurement + ambiguity ─────────────────────────
  for (const e of entities) {
    const isFundamentalOrCritical =
      e.importance === "fundamental" || e.importance === "critical";
    if (isFundamentalOrCritical && !e.measurement_value_kind) {
      signals.push({
        kind: "missing_measurement_spec",
        ref_id: e.id,
        ref_name: e.name,
        severity: "important",
      });
    }
    if (e.source_tag === "assumed" && !e.ambiguity_type) {
      signals.push({
        kind: "ambiguous_assumed_entity",
        ref_id: e.id,
        ref_name: e.name,
        severity: "nice_to_have",
      });
    }
  }

  // ── F. Structural orphans + density ──────────────────────────────
  if (entities.length > 0) {
    const edgeCount = new Map<string, number>();
    for (const ed of edges) {
      edgeCount.set(ed.source_entity_id, (edgeCount.get(ed.source_entity_id) ?? 0) + 1);
      edgeCount.set(ed.target_entity_id, (edgeCount.get(ed.target_entity_id) ?? 0) + 1);
    }
    let orphans = 0;
    for (const e of entities) {
      if ((edgeCount.get(e.id) ?? 0) === 0) orphans += 1;
    }
    if (orphans / entities.length > 0.3 && entities.length > 8) {
      signals.push({ kind: "high_orphan_count", severity: "nice_to_have" });
    }
    const density = edges.length / Math.max(1, entities.length);
    if (density < 0.8 && entities.length > 12) {
      signals.push({ kind: "low_density", severity: "nice_to_have" });
    }
  }

  // ── G. Stale synthesis ───────────────────────────────────────────
  // Synthesis-completion timestamp lives at
  // synthesis_data.strategic_recommendation.generated_at — extract
  // and compare to last_paper_landed_at. If paper landed AFTER the
  // last synthesis, surface the stale_synthesis question.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategicRec = ((synthesis as any).strategic_recommendation ?? {}) as {
    generated_at?: string;
  };
  const lastSynthesisAt = strategicRec.generated_at;
  if (space.last_paper_landed_at && lastSynthesisAt) {
    const landed = new Date(space.last_paper_landed_at).getTime();
    const synthed = new Date(lastSynthesisAt).getTime();
    if (Number.isFinite(landed) && Number.isFinite(synthed) && landed > synthed) {
      signals.push({ kind: "stale_synthesis", severity: "important" });
    }
  }

  return signals;
}
