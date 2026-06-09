// ── POST /api/objective/[spaceId]/crucible ───────────────────────────
//
// Drives the Crucible interrogation loop (the post-objective questioning fork).
// One ROUND per request — the live card polls state and re-POSTs "continue" to
// advance autonomous (research-only) rounds, which gives the "constantly asking"
// feel without SSE, and pauses on "awaiting_user" for the founder's input.
//
// Body: { action: "state" | "start" | "continue" | "answer", answers?,  force? }
//   state    — read current state (the card polls this).
//   start    — initialize (if absent) + advance round 1.
//   continue — advance the next autonomous round (only when status === "working").
//   answer   — ingest user answers, analyze them, then advance the next round.
//
// State lives in spaces.synthesis_data.objective_canvas.crucible (no new table).
// Each advance is charged once (canvas_op) and soft-fails so a model hiccup
// converges the loop instead of 500ing.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { detectCreditError } from "@/lib/llm";
import { withCharge, creditErrorResponse } from "@/lib/credits/with-charge";
import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";
import { loadOptimizationFactors } from "@/lib/objective-canvas/load-optimization-factors";
import { readCrucibleState, writeCrucibleState } from "@/lib/objective-canvas/crucible/crucible-store";
import {
  analyze,
  inquire,
  selfAnswerResearch,
} from "@/lib/objective-canvas/crucible/crucible-engine";
import { synthesizeAndPersist } from "@/lib/objective-canvas/crucible/crucible-persist";
import { autoResolveAnswers } from "@/lib/objective-canvas/crucible/auto-resolve";
import {
  CRUCIBLE_MAX_ROUNDS,
  emptyCrucibleState,
  type CrucibleAnswer,
  type CrucibleQuestion,
  type CrucibleState,
} from "@/lib/objective-canvas/crucible/crucible-types";
import type { FactorLite } from "@/lib/objective-canvas/crucible/crucible-prompts";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface Body {
  action?: "state" | "start" | "continue" | "answer" | "converge" | "auto_answer";
  answers?: Array<{ questionId?: unknown; text?: unknown }>;
  force?: boolean;
}

/** Pull seed questions out of the prompt_sharpening artifact (round-1 raw
 *  material — reuse the sharpening pass instead of regenerating). */
function readSeedQuestions(synthesisData: unknown): string[] {
  try {
    const synth = (synthesisData ?? {}) as Record<string, unknown>;
    const oc = (synth.objective_canvas ?? {}) as Record<string, unknown>;
    const ps = (oc.prompt_sharpening ?? {}) as Record<string, unknown>;
    const out: string[] = [];
    const ranked = Array.isArray(ps.ranked_ambiguities)
      ? ps.ranked_ambiguities
      : [];
    for (const r of ranked) {
      const q = (r as { question_to_resolve?: unknown })?.question_to_resolve;
      if (typeof q === "string" && q.trim()) out.push(q.trim());
    }
    const salience = (ps.salience ?? {}) as Record<string, unknown>;
    const annotations = Array.isArray(salience.annotations)
      ? salience.annotations
      : [];
    for (const a of annotations) {
      const mqs = (a as { micro_questions?: unknown })?.micro_questions;
      if (Array.isArray(mqs)) {
        for (const m of mqs) if (typeof m === "string" && m.trim()) out.push(m.trim());
      }
    }
    // Dedup + cap.
    return Array.from(new Set(out)).slice(0, 8);
  } catch {
    return [];
  }
}

interface AdvanceCtx {
  objective: string;
  preamble: string;
  factors: FactorLite[];
  seedQuestions: string[];
}

/** Apply an Analyst update to the state (in place). */
function applyAnalystUpdate(
  state: CrucibleState,
  upd: Awaited<ReturnType<typeof analyze>>,
): void {
  for (const c of upd.classifications) {
    const ans = state.answers.find((a) => a.questionId === c.questionId);
    if (ans) {
      ans.bucket = c.bucket;
      ans.variableSlugs = Array.isArray(c.variable_slugs) ? c.variable_slugs : [];
    }
  }
  state.landscape.push(...upd.landscapeAdd);
  state.solutions.push(...upd.solutionsAdd);
  state.constraints.push(...upd.constraintsAdd);
  state.variables.push(...upd.variablesAdd);
  if (upd.summary) state.summary = upd.summary;
}

/** Advance EXACTLY ONE round: ask → self-answer research questions → analyze
 *  them → set the next status. Mutates + returns `state`. */
async function advanceOneRound(
  ctx: AdvanceCtx,
  state: CrucibleState,
): Promise<CrucibleState> {
  if (state.round >= CRUCIBLE_MAX_ROUNDS) {
    state.status = "converged";
    state.convergedReason = "Reached the round limit.";
    return state;
  }

  const round = state.round + 1;
  const res = await inquire({
    objective: ctx.objective,
    preamble: ctx.preamble,
    factors: ctx.factors,
    seedQuestions: ctx.seedQuestions,
    questions: state.questions,
    answers: state.answers,
    landscape: state.landscape,
    solutions: state.solutions,
    constraints: state.constraints,
    variables: state.variables,
    round,
  });

  if (res.questions.length === 0) {
    state.status = "converged";
    state.convergedReason = res.reason || "No further high-value questions.";
    return state;
  }

  state.round = round;
  state.questions.push(...res.questions);

  // Self-answer every 'research'-tagged question this round. If grounding
  // returns nothing, downgrade the question to the user (so it's never lost).
  const freshPairs: Array<{ q: CrucibleQuestion; a: CrucibleAnswer }> = [];
  for (const q of res.questions) {
    if (q.audience !== "research") continue;
    const ans = await selfAnswerResearch(q);
    if (ans) {
      q.answered = true;
      const a: CrucibleAnswer = {
        questionId: q.id,
        text: ans.text,
        via: "research",
        citations: ans.citations,
      };
      state.answers.push(a);
      freshPairs.push({ q, a });
    } else {
      q.audience = "user";
    }
  }

  if (freshPairs.length > 0) {
    const upd = await analyze({
      objective: ctx.objective,
      freshPairs,
      landscape: state.landscape,
      solutions: state.solutions,
      constraints: state.constraints,
      variables: state.variables,
      priorSummary: state.summary,
    });
    applyAnalystUpdate(state, upd);
  }

  const pendingUser = res.questions.filter(
    (q) => q.audience === "user" && !q.answered,
  );
  if (pendingUser.length > 0) {
    state.status = "awaiting_user";
  } else if (res.saturated) {
    state.status = "converged";
    state.convergedReason = res.reason || "Information saturated.";
  } else {
    // Research-only round, more to learn — the card will POST "continue".
    state.status = "working";
  }
  return state;
}

export async function POST(request: Request, ctx: RouteContext) {
  const { spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;
  const action = body.action ?? "state";

  // Ownership + the synthesis_data we need for seeds.
  const { data: space } = await supabase
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── state: just read ──
  if (action === "state") {
    const state = await readCrucibleState(supabase, spaceId);
    return NextResponse.json({ state });
  }

  // Context for any advancing action.
  let advanceCtx: AdvanceCtx = {
    objective: "",
    preamble: "",
    factors: [],
    seedQuestions: [],
  };
  try {
    const [spaceCtx, factors] = await Promise.all([
      buildSpaceContext(supabase, spaceId),
      loadOptimizationFactors(supabase, spaceId),
    ]);
    advanceCtx = {
      objective: (spaceCtx.objective ?? "").trim(),
      preamble: (spaceCtx.preamble ?? "").trim(),
      factors: factors.map((f) => ({
        slug: f.slug,
        label: f.label,
        kind: f.kind,
        why: f.why,
      })),
      seedQuestions: readSeedQuestions(space.synthesis_data),
    };
  } catch (err) {
    console.warn("[crucible] context load failed (soft):", err);
  }

  const nowIso = new Date().toISOString();
  let state = await readCrucibleState(supabase, spaceId);

  // ── start ──
  if (action === "start") {
    if (state && state.status !== "error" && !body.force) {
      return NextResponse.json({ state });
    }
    state = emptyCrucibleState(advanceCtx.objective, nowIso);
  }

  if (!state) {
    // continue / answer with no state → behave like start.
    state = emptyCrucibleState(advanceCtx.objective, nowIso);
  }

  // ── converge: (re)run synthesis on a converged loop. Explicit retry path —
  // surfaces credit errors (the auto-run after a round soft-skips them). ──
  if (action === "converge") {
    if (state.status !== "converged" || (state.synthesisDone && !body.force)) {
      return NextResponse.json({ state });
    }
    try {
      state = await withCharge(
        { db: supabase, userId: user.id, operation: "canvas_op", spaceId },
        () => synthesizeAndPersist(supabase, user.id, spaceId, advanceCtx, state!),
      );
    } catch (err) {
      const ce = creditErrorResponse(err);
      if (ce) return ce;
      const credit = detectCreditError(err);
      if (credit.isCredit) {
        return NextResponse.json(
          { error: credit.message, code: "credits_exhausted" },
          { status: 402 },
        );
      }
      console.warn("[crucible] converge synthesis failed (soft):", err);
    }
    state.updatedAt = new Date().toISOString();
    await writeCrucibleState(supabase, spaceId, state);
    return NextResponse.json({ state });
  }

  // ── auto_answer: the "build it for me" path. Resolve any pending founder-
  //    questions WITHOUT the founder — best-of-N candidate answers per question,
  //    factor-aware ranked, top-1 picked — then advance via the SAME analyze
  //    path a human answer uses. The client loops this until converged. ──
  if (action === "auto_answer") {
    if (state.status === "converged") return NextResponse.json({ state });
    try {
      const result = await withCharge(
        { db: supabase, userId: user.id, operation: "canvas_op", spaceId },
        async () => {
          const pending = state!.questions.filter((q) => q.audience === "user" && !q.answered);
          if (pending.length > 0) {
            const resolved = await autoResolveAnswers({
              objective: advanceCtx.objective,
              preamble: advanceCtx.preamble,
              factors: advanceCtx.factors,
              questions: pending.map((q) => ({ id: q.id, text: q.text, intent: q.intent })),
              landscape: state!.landscape,
              solutions: state!.solutions,
              constraints: state!.constraints,
              variables: state!.variables,
              summary: state!.summary,
            });
            const freshPairs: Array<{ q: CrucibleQuestion; a: CrucibleAnswer }> = [];
            for (const r of resolved) {
              const q = state!.questions.find((x) => x.id === r.questionId);
              if (!q || q.answered) continue;
              q.answered = true;
              const a: CrucibleAnswer = {
                questionId: q.id,
                text: r.text.slice(0, 2000),
                via: "user",
                auto: { candidates: r.candidates, rationale: r.rationale, runnerUp: r.runnerUp },
              };
              state!.answers.push(a);
              freshPairs.push({ q, a });
            }
            if (freshPairs.length > 0) {
              const upd = await analyze({
                objective: advanceCtx.objective,
                freshPairs,
                landscape: state!.landscape,
                solutions: state!.solutions,
                constraints: state!.constraints,
                variables: state!.variables,
                priorSummary: state!.summary,
              });
              applyAnalystUpdate(state!, upd);
            }
          }
          return advanceOneRound(advanceCtx, state!);
        },
      );
      state = result;
    } catch (err) {
      return handleAdvanceError(err, supabase, spaceId, state);
    }
    state = await runSynthesisSoft(supabase, user.id, spaceId, advanceCtx, state);
    state.updatedAt = new Date().toISOString();
    await writeCrucibleState(supabase, spaceId, state);
    return NextResponse.json({ state });
  }

  // ── answer: ingest the user's answers, then advance ──
  if (action === "answer") {
    const incoming = Array.isArray(body.answers) ? body.answers : [];
    const freshPairs: Array<{ q: CrucibleQuestion; a: CrucibleAnswer }> = [];
    for (const item of incoming) {
      const qid = typeof item?.questionId === "string" ? item.questionId : "";
      const text = typeof item?.text === "string" ? item.text.trim() : "";
      if (!qid || !text) continue;
      const q = state.questions.find((x) => x.id === qid);
      if (!q || q.answered) continue;
      q.answered = true;
      const a: CrucibleAnswer = { questionId: qid, text: text.slice(0, 2000), via: "user" };
      state.answers.push(a);
      freshPairs.push({ q, a });
    }

    try {
      const result = await withCharge(
        { db: supabase, userId: user.id, operation: "canvas_op", spaceId },
        async () => {
          if (freshPairs.length > 0) {
            const upd = await analyze({
              objective: advanceCtx.objective,
              freshPairs,
              landscape: state!.landscape,
              solutions: state!.solutions,
              constraints: state!.constraints,
              variables: state!.variables,
              priorSummary: state!.summary,
            });
            applyAnalystUpdate(state!, upd);
          }
          return advanceOneRound(advanceCtx, state!);
        },
      );
      state = result;
    } catch (err) {
      return handleAdvanceError(err, supabase, spaceId, state);
    }
    state = await runSynthesisSoft(supabase, user.id, spaceId, advanceCtx, state);
    state.updatedAt = new Date().toISOString();
    await writeCrucibleState(supabase, spaceId, state);
    return NextResponse.json({ state });
  }

  // ── start / continue: advance one round ──
  // continue is a no-op unless we're mid-flight ("working").
  if (action === "continue" && state.status !== "working") {
    return NextResponse.json({ state });
  }

  try {
    state.status = "working";
    const result = await withCharge(
      { db: supabase, userId: user.id, operation: "canvas_op", spaceId },
      () => advanceOneRound(advanceCtx, state!),
    );
    state = result;
  } catch (err) {
    return handleAdvanceError(err, supabase, spaceId, state);
  }

  state = await runSynthesisSoft(supabase, user.id, spaceId, advanceCtx, state);
  state.updatedAt = new Date().toISOString();
  await writeCrucibleState(supabase, spaceId, state);
  return NextResponse.json({ state });
}

/** Auto-run synthesis the moment a round converges. Best-effort: any failure
 *  (including credits) is swallowed so finishing the loop never 500s — the card
 *  shows the converged summary and can retry via the explicit "converge" action,
 *  which DOES surface credit errors. */
async function runSynthesisSoft(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  spaceId: string,
  ctx: AdvanceCtx,
  state: CrucibleState,
): Promise<CrucibleState> {
  if (state.status !== "converged" || state.synthesisDone) return state;
  try {
    return await withCharge(
      { db: supabase, userId, operation: "canvas_op", spaceId },
      () => synthesizeAndPersist(supabase, userId, spaceId, ctx, state),
    );
  } catch (err) {
    console.warn("[crucible] auto-synthesis failed (soft):", err);
    return state;
  }
}

/** Map an advance failure to the right response, persisting an error status so
 *  the card can surface it + offer retry. */
async function handleAdvanceError(
  err: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  spaceId: string,
  state: CrucibleState | null,
): Promise<Response> {
  const ce = creditErrorResponse(err);
  if (ce) return ce;
  const credit = detectCreditError(err);
  if (credit.isCredit) {
    return NextResponse.json(
      { error: credit.message, code: "credits_exhausted" },
      { status: 402 },
    );
  }
  console.error("[/api/objective/[spaceId]/crucible] error:", err);
  if (state) {
    state.status = "error";
    state.error = sanitizeErrorMessage(err);
    state.updatedAt = new Date().toISOString();
    await writeCrucibleState(supabase, spaceId, state);
  }
  return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
}
