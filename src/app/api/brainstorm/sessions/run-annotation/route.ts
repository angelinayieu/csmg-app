// ── POST /api/brainstorm/sessions/run-annotation ────────────────────
//
// Phase 6b of BRAINSTORM_MODULE_SPEC.md — generalises the brainstorm
// orchestrator to annotation Deepening on the core objective's lens.
// Same shape as /sessions/run (picker) and /sessions/run-feature
// (lab), different target_kind + different divergence engine.
//
// Pipeline:
//   1. Load root improvement_goal + ownership + current v1 annotations
//   2. Compute utility signal (downstream item count per v1 phrase) —
//      same logic as /annotations/deepen
//   3. Create objective_brainstorm_sessions row (target_kind='annotation')
//   4. Call generateDeepenedAnnotations() ONCE — single LLM call that
//      itself wraps two prompts (deepen context + fresh pass through
//      standard validation pipeline). Yields ~7-9 v2 annotations.
//   5. Wrap each v2 annotation as a BrainstormCandidate (phrase → title,
//      reading → summary, weight → confidence). Bucket intent by weight
//      tier for chip colour variety.
//   6. Deterministic ranking: composite = 0.5·weight + 0.3·novelty
//      (1 - max similarity to v1) + 0.2·utility_signal (utility of the
//      closest v1 phrase, since v2 deepens v1 they share signal)
//   7. Top 3 → green, next 4 → amber, rest → tray
//   8. Settle
//
// Differs from picker/feature runners:
//   - ONE LLM call, not 3 batches — the deepen prompt is already
//     opinionated; running it 3× would mostly produce duplicates
//   - generations[] has length 1 (single batch labelled "deepen")
//   - "intents" array carries weight-tier labels (high/mid/low) cast
//     to SubObjectiveIntent for chip rendering only
//   - elect = merge the phrase into improvement_goals.annotations,
//     not create a new sub-objective row

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import {
  createSession,
  commitPlan,
  appendGeneration,
  setCleanup,
  settle,
} from "@/lib/brainstorm/sessions";
import type {
  BrainstormCandidate,
  BrainstormCleanup,
  BrainstormGeneration,
  BrainstormPlan,
  BrainstormRanking,
  BrainstormRankedCandidate,
  BrainstormReasoning,
  BrainstormRibbon,
  BrainstormSubScores,
} from "@/lib/brainstorm/session-types";
import { generateDeepenedAnnotations } from "@/lib/objective-canvas/generate-deepen";
import type { ObjectiveAnnotation } from "@/lib/objective-canvas/generate-annotations";
import { summariseRanking } from "@/lib/brainstorm/critique";
import type { SubObjectiveIntent } from "@/lib/objective-canvas/sub-objective-state";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
  spaceId?: string;
  sessionId?: string | null;
}

// Weight tier → chip colour bucket. Annotations don't have semantic
// intents — this is purely visual variety so high-weight phrases
// look different from low-weight ones in the panel ribbon view.
function intentForWeight(weight: number | undefined): SubObjectiveIntent {
  const w = typeof weight === "number" ? weight : 0.5;
  if (w >= 0.75) return "creative"; // load-bearing
  if (w >= 0.45) return "concrete"; // mid
  return "wildcard"; // peripheral / speculative
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const userId = auth.user.id;

  // ── Load root improvement_goal + ownership ──────────────────────
  const { data: coreRows, error: coreErr } = await db
    .from("improvement_goals")
    .select("id, title, description, user_id, annotations")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (coreErr) {
    return NextResponse.json(
      { error: "DB error", detail: coreErr.message },
      { status: 500 },
    );
  }
  const core =
    Array.isArray(coreRows) && coreRows.length > 0 ? coreRows[0] : null;
  if (!core || core.user_id !== userId) {
    return NextResponse.json(
      { error: "no core objective in this space" },
      { status: 404 },
    );
  }
  const v1: ObjectiveAnnotation[] = Array.isArray(core.annotations)
    ? core.annotations
    : [];
  if (v1.length === 0) {
    return NextResponse.json(
      { error: "generate initial annotations before brainstorming a deepen" },
      { status: 409 },
    );
  }

  const objectiveText: string =
    (typeof core.description === "string" && core.description.trim()) ||
    (typeof core.title === "string" && core.title.trim()) ||
    "";

  // Load sub-objectives so deepen keeps linkage; also drives utility.
  const { data: subRows } = await db
    .from("improvement_goals")
    .select("id, title, description")
    .eq("space_id", spaceId)
    .eq("parent_goal_id", core.id)
    .order("created_at", { ascending: true });
  const subObjectives = ((subRows ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
  }>).map((s) => ({ id: s.id, title: s.title, description: s.description }));

  // Utility signal — copied from /annotations/deepen route. Counts items
  // (across sibling rooms) deriving from each v1 phrase.
  let priorUtility: Array<{ phrase: string; count: number }> | undefined;
  const subIds = subObjectives.map((s) => s.id);
  if (subIds.length > 0) {
    const { data: entityRows } = await db
      .from("entities")
      .select("causal_chain")
      .in("parent_sub_objective_id", subIds);
    const counts = new Map<string, number>();
    for (const row of (entityRows ?? []) as Array<{
      causal_chain: Record<string, unknown> | null;
    }>) {
      const dfa = row.causal_chain?.derived_from_annotations;
      if (!Array.isArray(dfa)) continue;
      const itemPhrases = new Set<string>();
      for (const entry of dfa as Array<{ phrase?: unknown }>) {
        if (
          typeof entry?.phrase === "string" &&
          entry.phrase.trim().length > 0
        ) {
          itemPhrases.add(entry.phrase.trim().toLowerCase());
        }
      }
      for (const p of itemPhrases) {
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
    }
    priorUtility = v1.map((a) => ({
      phrase: a.phrase,
      count: counts.get(a.phrase.trim().toLowerCase()) ?? 0,
    }));
  }

  // ── Create the session row up front (live polling support) ──────
  const clientId =
    typeof body?.sessionId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.sessionId,
    )
      ? body.sessionId
      : null;
  let session;
  try {
    session = await createSession(db, {
      userId,
      spaceId,
      targetKind: "annotation",
      subObjectiveId: core.id,
      title: autoTitle(objectiveText),
      id: clientId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `failed to create session: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }

  // Plan — one "deepen" intent. The chip rendering in the panel
  // adapts because we set weight-tier intents on per-candidate later.
  const plan: BrainstormPlan = {
    intents: ["gap_fill" as SubObjectiveIntent], // representative chip
    reasons: {
      gap_fill: {
        source: "gap_fill",
        uncovered_lens: priorUtility
          ? priorUtility
              .map((p, i) => (p.count === 0 ? i + 1 : -1))
              .filter((i) => i > 0)
          : [],
      },
    },
    locked_at: new Date().toISOString(),
  };
  await commitPlan(db, { userId, spaceId, sessionId: session.id, plan });

  // ── Stage 2: single deepen LLM call ─────────────────────────────
  const t0 = Date.now();
  let v2: ObjectiveAnnotation[];
  try {
    v2 = await generateDeepenedAnnotations({
      objective: objectiveText,
      v1,
      subObjectives,
      priorUtility,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `deepen LLM failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
  if (!v2 || v2.length === 0) {
    return NextResponse.json(
      { error: "deepen returned no candidates" },
      { status: 500 },
    );
  }

  const candidates: BrainstormCandidate[] = v2.map((a, idx) => ({
    proposal_id: `ann-${session.id.slice(0, 8)}-${idx}-${stableHash(a.phrase)}`,
    title: a.phrase,
    summary: a.reading ?? "",
    rationale: undefined,
    confidence: typeof a.weight === "number" ? a.weight : 0.5,
    lens_coverage: [],
    intent_of_origin: intentForWeight(a.weight),
    // Phase 6b: stash the full ObjectiveAnnotation so the elect handler
    // can append the structured row (offsets + dimensions + analogies)
    // not just the stripped phrase/reading/weight surface fields.
    source_payload: a,
  }));

  const generation: BrainstormGeneration = {
    intent: "gap_fill" as SubObjectiveIntent,
    generation_number: 1,
    batch_id: `ann-batch-${Date.now()}`,
    candidates,
    generated_at: new Date().toISOString(),
    latency_ms: Date.now() - t0,
  };
  await appendGeneration(db, session.id, generation);

  // ── Stage 3: cleanup — single-cluster pseudo-pass (no LLM needed) ─
  const cleanup: BrainstormCleanup = {
    clusters: [
      {
        theme: "deepen",
        proposal_ids: candidates.map((c) => c.proposal_id),
        representative_id: candidates[0]?.proposal_id ?? "",
      },
    ],
    duplicates: [],
    soft_overlaps: [],
    ran_at: new Date().toISOString(),
  };
  await setCleanup(db, session.id, cleanup);

  // ── Stage 4: deterministic ranking ──────────────────────────────
  const ranking = rankAnnotations({ candidates, v2, v1, priorUtility });
  await settle(db, {
    userId,
    spaceId,
    sessionId: session.id,
    ranking,
    outcomeSummary: summariseRanking(ranking),
  });

  // Return the settled row for the panel fast path.
  const { data: settled } = await db
    .from("objective_brainstorm_sessions")
    .select("*")
    .eq("id", session.id)
    .single();
  return NextResponse.json({ session: settled });
}

// ── helpers ─────────────────────────────────────────────────────────

function autoTitle(objective: string): string {
  const d = new Date().toISOString().slice(0, 10);
  const head = objective.slice(0, 32).trim() || "objective";
  return `Brainstorm · Deepen lens · "${head}" · ${d}`;
}

function stableHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

interface AnnotationRankInput {
  candidates: BrainstormCandidate[];
  v2: ObjectiveAnnotation[];
  v1: ObjectiveAnnotation[];
  priorUtility?: Array<{ phrase: string; count: number }>;
}

/** Composite: 0.50·weight + 0.30·novelty(vs v1) + 0.20·utility-of-nearest-v1.
 *  Critique sub-score = 0 (Phase 7+ may add an LLM critic pass). */
function rankAnnotations(input: AnnotationRankInput): BrainstormRanking {
  const t0 = Date.now();
  const v1Lower = input.v1.map((a) => a.phrase.toLowerCase().trim());
  const utilityByPhrase = new Map<string, number>();
  for (const u of input.priorUtility ?? []) {
    utilityByPhrase.set(u.phrase.toLowerCase().trim(), u.count);
  }
  // Normalize utility to 0..1 by max so the term doesn't drown others.
  const maxUtility = Math.max(
    1,
    ...Array.from(utilityByPhrase.values()),
  );

  const ranked: BrainstormRankedCandidate[] = input.candidates.map((c, i) => {
    const v2Item = input.v2[i];
    const phraseLower = v2Item.phrase.toLowerCase().trim();
    // Novelty = 1 - max token-set similarity vs any v1 phrase.
    let maxSim = 0;
    let closestV1Phrase: string | null = null;
    for (const v1p of v1Lower) {
      const s = tokenSimilarity(phraseLower, v1p);
      if (s > maxSim) {
        maxSim = s;
        closestV1Phrase = v1p;
      }
    }
    const novelty = Math.max(0, 1 - maxSim);
    // Utility: nearest v1 phrase's downstream count (normalized). If
    // novelty is high (no nearest), utility falls back to 0 — a new
    // phrase has no measured utility yet.
    const utility =
      closestV1Phrase && maxSim >= 0.5
        ? (utilityByPhrase.get(closestV1Phrase) ?? 0) / maxUtility
        : 0;
    const weight = typeof v2Item.weight === "number" ? v2Item.weight : 0.5;

    const sub: BrainstormSubScores = {
      // Repurpose the picker slots for annotation-specific terms,
      // keeping the same panel chip layout.
      coverage: weight, // load-bearing-ness
      diversity: novelty, // distance from v1
      preference: utility, // downstream proxy
      critique: 0,
    };
    const composite = 0.5 * weight + 0.3 * novelty + 0.2 * utility;

    const reasoning: BrainstormReasoning = {
      why_strong:
        weight >= 0.7
          ? `Load-bearing reading (weight ${weight.toFixed(2)}).`
          : `Plausible reading (weight ${weight.toFixed(2)}).`,
      where_stretches:
        novelty < 0.3
          ? `Close to existing lens phrase "${closestV1Phrase ?? ""}".`
          : "Genuinely new dimension.",
      whats_missing:
        utility === 0 && novelty < 0.5
          ? "No downstream items linked yet — verify it earns its weight."
          : "",
      closest_neighbor: closestV1Phrase,
    };

    return {
      proposal_id: c.proposal_id,
      composite_score: composite,
      sub_scores: sub,
      ribbon: "tray" as BrainstormRibbon,
      reasoning,
    };
  });

  ranked.sort((a, b) => b.composite_score - a.composite_score);
  ranked.forEach((r, idx) => {
    if (idx < 3) r.ribbon = "green";
    else if (idx < 7) r.ribbon = "amber";
    else r.ribbon = "tray";
  });

  return {
    candidates: ranked,
    ranked_at: new Date().toISOString(),
    latency_ms: Date.now() - t0,
  };
}

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(a.split(/[\s_,;.:-]+/).filter((t) => t.length >= 3));
  const tb = new Set(b.split(/[\s_,;.:-]+/).filter((t) => t.length >= 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}
