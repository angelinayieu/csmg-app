// ── POST /api/brainstorm/sessions/run-feature ───────────────────────
//
// Phase 6 of BRAINSTORM_MODULE_SPEC.md — generalises the brainstorm
// orchestrator to per-feature R&D variation refinement. Same shape as
// /sessions/run (the picker runner), different target_kind + different
// divergence engine.
//
// Pipeline:
//   1. Load entity + ownership + envelope (must be scored — we need a
//      target_pain to know what gaps to attack)
//   2. Identify TOP 3 weakest-covered root_causes from envelope.target_pain
//   3. Create objective_brainstorm_sessions row (target_kind='room_feature',
//      entity_id set, plan.intents = the 3 root causes)
//   4. For each root cause: call proposeMechanismCandidates() →
//      ~3 variation candidates per call → append to generations[]
//   5. Cleanup (simple name-similarity dedup)
//   6. Rank deterministically by addresses_pain × distinctness
//   7. Settle
//
// Reuses:
//   - createSession / commitPlan / appendGeneration / setCleanup / settle
//     (same helpers as the picker runner)
//   - proposeMechanismCandidates from refine-mechanism.ts (no new LLM
//     prompt)
//
// Differences from the picker runner:
//   - target_kind='room_feature' (carried through to the panel + library)
//   - "intents" array carries gap_root_cause strings (not SubObjectiveIntent)
//   - candidates are variations (name/description/tradeoff), not
//     sub-objective proposals (title/summary/rationale). The
//     BrainstormCandidate type's `title` + `summary` map cleanly to
//     variation.name + variation.description so the panel renders
//     them unchanged.
//   - cleanup uses string-similarity on variation names (no clustering
//     LLM call — overkill for ~9 short-name candidates)
//   - critique pass currently deterministic-only (no LLM) — Phase 6b
//     can swap in a variation-specific critique prompt

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
import {
  proposeMechanismCandidates,
  type RefineMechanismContext,
  type ProposedMechanismCandidate,
} from "@/lib/objective-canvas/refine-mechanism";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import type {
  ExpandedItemDetail,
  ItemVariation,
} from "@/lib/objective-canvas/expand-item-detail";
import { summariseRanking } from "@/lib/brainstorm/critique";
import type { SubObjectiveIntent } from "@/lib/objective-canvas/sub-objective-state";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
  entityId?: string;
  sessionId?: string | null;
}

// Reuse the SubObjectiveIntent shape on the type level — the panel
// renders chips from g.intent — for features we abuse it as
// gap-root-cause labels. Casting at the boundary; the panel doesn't
// actually use intent semantics for features beyond display.
function intentLabelForGap(gap: string): SubObjectiveIntent {
  // Pick a stable bucket from the gap string so the panel's chip
  // colours stay consistent. Hash-mod the 6 buckets we have.
  const intents: SubObjectiveIntent[] = [
    "creative",
    "concrete",
    "contrarian",
    "gap_fill",
    "ambitious",
    "wildcard",
  ];
  let h = 0;
  for (let i = 0; i < gap.length; i++) h = (h * 31 + gap.charCodeAt(i)) | 0;
  return intents[Math.abs(h) % intents.length];
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const userId = auth.user.id;

  // ── Load entity, ownership check ────────────────────────────────
  const { data: entity } = await db
    .from("entities")
    .select(
      "id, entity_name, entity_type, expanded_detail, causal_chain, sub_objective_id, space_id",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  if (entity.entity_type !== "feature") {
    return NextResponse.json(
      { error: "brainstorm-feature only supports feature entities" },
      { status: 400 },
    );
  }

  const spaceId = entity.space_id as string;
  const subObjectiveId = entity.sub_objective_id as string | null;

  // Verify space ownership. Also pull synthesis_data so we can derive
  // operational constraints without an extra DB hop.
  const { data: space } = await db
    .from("spaces")
    .select("user_id, input_text, description, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const detail = (entity.expanded_detail ?? {}) as ExpandedItemDetail;
  const envelope = detail.effectiveness_envelope ?? null;
  if (!envelope || !envelope.target_entity_id) {
    return NextResponse.json(
      {
        error:
          "feature has no target — score it once first so we know which pain to attack",
      },
      { status: 400 },
    );
  }

  // ── Load target pain entity for its root_causes ─────────────────
  const { data: targetPain } = await db
    .from("entities")
    .select("entity_name, causal_chain")
    .eq("id", envelope.target_entity_id)
    .maybeSingle();
  const targetPainName: string = targetPain?.entity_name ?? "(target pain)";
  const targetPainChain = (targetPain?.causal_chain ?? {}) as {
    negative_outcome?: string;
    root_causes?: string[];
  };
  const allRootCauses = Array.isArray(targetPainChain.root_causes)
    ? targetPainChain.root_causes.filter((s) => typeof s === "string" && s.trim())
    : [];
  if (allRootCauses.length === 0) {
    return NextResponse.json(
      {
        error:
          "target pain has no root_causes — re-expand the pain card to populate them",
      },
      { status: 400 },
    );
  }

  // ── Pick 3 root causes to brainstorm against ────────────────────
  // Weakest-covered first (mirrors the /refine route's logic). If
  // we have fewer than 3, repeat from the top — the LLM has different
  // sibling context each call so it still varies.
  const currentVariations: ItemVariation[] = Array.isArray(detail.variations)
    ? detail.variations
    : [];
  const coverage = scoreRootCauseCoverage(allRootCauses, currentVariations);
  const sortedByGap = [...allRootCauses].sort(
    (a, b) => (coverage[a] ?? 0) - (coverage[b] ?? 0),
  );
  const targetGaps: string[] = [];
  for (let i = 0; i < 3; i++) {
    targetGaps.push(sortedByGap[i % sortedByGap.length]);
  }

  // ── Load sibling features in the room for compose/differentiate ─
  const siblingFeatures = await loadSiblingFeatures(
    db,
    subObjectiveId,
    entityId,
  );

  // ── Load constraints (sync read from synthesis_data) ────────────
  const constraints = readConstraints(space.synthesis_data);

  // ── Build the brainstorm session ────────────────────────────────
  const plan: BrainstormPlan = {
    intents: targetGaps.map((g) => intentLabelForGap(g)),
    reasons: {},
    locked_at: new Date().toISOString(),
  };

  // Create the session row up front so the panel can start polling.
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
      targetKind: "room_feature",
      subObjectiveId,
      entityId,
      title: autoTitle(entity.entity_name as string, targetPainName),
      id: clientId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `failed to create session: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }

  await commitPlan(db, {
    userId,
    spaceId,
    sessionId: session.id,
    plan,
  });

  // ── Stage 2: run divergence batches ─────────────────────────────
  // Sequential — proposeMechanismCandidates is an LLM call, parallel
  // would race on token-budget caps.
  const coreObjectiveText: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";
  // Sub-objective title for grounding — best-effort fetch.
  let subObjectiveTitle = "";
  if (subObjectiveId) {
    const { data: subRow } = await db
      .from("improvement_goals")
      .select("title")
      .eq("id", subObjectiveId)
      .maybeSingle();
    subObjectiveTitle = subRow?.title ?? "";
  }
  const featureCtx = {
    name: (entity.entity_name as string) ?? "feature",
    positive_outcome:
      (entity.causal_chain as { positive_outcome?: string })?.positive_outcome ?? "",
    first_principles: Array.isArray(
      (entity.causal_chain as { first_principles?: string[] })?.first_principles,
    )
      ? ((entity.causal_chain as { first_principles?: string[] }).first_principles as string[])
      : [],
  };
  const targetPainCtx = {
    name: targetPainName,
    negative_outcome: targetPainChain.negative_outcome ?? "",
    root_causes: allRootCauses,
  };

  const generations: BrainstormGeneration[] = [];
  // running existing variations grows as we accumulate so the LLM
  // anti-dupes against THIS session's prior batches too.
  const accumulatedExisting: ItemVariation[] = [...currentVariations];

  for (let i = 0; i < targetGaps.length; i++) {
    const gap = targetGaps[i];
    const t0 = Date.now();
    const ctx: RefineMechanismContext = {
      feature: featureCtx,
      target_pain: targetPainCtx,
      gap_root_cause: gap,
      existing_variations: accumulatedExisting.map((v) => ({
        name: v.name,
        description: v.description,
        tradeoff: v.tradeoff,
      })),
      sibling_features: siblingFeatures,
      core_objective_text: coreObjectiveText,
      sub_objective_title: subObjectiveTitle,
      constraints,
      candidate_count: 3,
    };
    let candidates: ProposedMechanismCandidate[] = [];
    try {
      candidates = await proposeMechanismCandidates(ctx);
    } catch (err) {
      console.warn(
        `[brainstorm/run-feature] gap ${i + 1} failed:`,
        err instanceof Error ? err.message : String(err),
      );
      candidates = [];
    }

    // Translate ProposedMechanismCandidate → BrainstormCandidate.
    // Stable id: hash of name + gap so re-runs of the same prompt
    // produce stable ids (helps the panel dedupe).
    const bcs: BrainstormCandidate[] = candidates.map((c) => ({
      proposal_id: `feat-${session.id.slice(0, 8)}-${i}-${stableHash(c.name)}`,
      title: c.name,
      summary: c.description,
      rationale: c.tradeoff,
      confidence: c.addresses_pain ?? 0.5,
      lens_coverage: [],
      intent_of_origin: plan.intents[i],
    }));

    const gen: BrainstormGeneration = {
      intent: plan.intents[i],
      generation_number: i + 1,
      batch_id: `feat-batch-${i}-${Date.now()}`,
      candidates: bcs,
      generated_at: new Date().toISOString(),
      latency_ms: Date.now() - t0,
    };
    generations.push(gen);
    await appendGeneration(db, session.id, gen);

    // Push these into accumulated so the next gap's LLM call sees them.
    for (const c of candidates) {
      accumulatedExisting.push({
        id: `tmp-${Date.now()}`,
        name: c.name,
        description: c.description,
        tradeoff: c.tradeoff,
        kind: c.kind,
        provenance: "rd_iteration",
      } as ItemVariation);
    }
  }

  // ── Stage 3: simple name-similarity cleanup ─────────────────────
  const cleanup = simpleDedup(generations);
  await setCleanup(db, session.id, cleanup);

  // ── Stage 4: deterministic ranking ──────────────────────────────
  const ranking = rankFeatureVariations({
    generations,
    cleanup,
    rootCauses: allRootCauses,
  });

  await settle(db, {
    userId,
    spaceId,
    sessionId: session.id,
    ranking,
    outcomeSummary: summariseRanking(ranking),
  });

  // Return the final session for the panel to take the fast-path.
  const { data: settled } = await db
    .from("objective_brainstorm_sessions")
    .select("*")
    .eq("id", session.id)
    .single();

  return NextResponse.json({ session: settled });
}

// ── helpers ─────────────────────────────────────────────────────────

function autoTitle(featureName: string, targetPain: string): string {
  const d = new Date().toISOString().slice(0, 10);
  return `Brainstorm · ${featureName.slice(0, 28)} → ${targetPain.slice(0, 20)} · ${d}`;
}

function stableHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/** Heuristic coverage: per root_cause, count current variations whose
 *  name/description mentions any token of the root cause. Same approach
 *  /refine uses internally. */
function scoreRootCauseCoverage(
  rootCauses: string[],
  variations: ItemVariation[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rc of rootCauses) {
    const tokens = rc
      .toLowerCase()
      .split(/[\s_/,.;:-]+/)
      .filter((t) => t.length >= 4);
    let n = 0;
    for (const v of variations) {
      const blob = `${v.name} ${v.description} ${v.tradeoff}`.toLowerCase();
      if (tokens.some((t) => blob.includes(t))) n++;
    }
    out[rc] = n;
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSiblingFeatures(db: any, subObjectiveId: string | null, selfId: string) {
  if (!subObjectiveId) return [];
  try {
    const { data: siblings } = await db
      .from("entities")
      .select("id, entity_name, expanded_detail")
      .eq("sub_objective_id", subObjectiveId)
      .eq("entity_type", "feature")
      .neq("id", selfId);
    if (!Array.isArray(siblings)) return [];
    return siblings.map((s: { entity_name: string; expanded_detail: ExpandedItemDetail }) => {
      const electedNames = Array.isArray(s.expanded_detail?.variations)
        ? s.expanded_detail.variations
            .filter((v) => v.disposition === "elected")
            .map((v) => v.name)
        : [];
      return { name: s.entity_name, elected_variation_names: electedNames };
    });
  } catch {
    return [];
  }
}

/** Cheap O(n²) name-similarity dedup — at ~9 candidates the cost is
 *  negligible and we avoid bringing in the cluster LLM. */
function simpleDedup(generations: BrainstormGeneration[]): BrainstormCleanup {
  const all: BrainstormCandidate[] = generations.flatMap((g) => g.candidates);
  const duplicates: Array<{ a: string; b: string; similarity: number }> = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const sim = nameSimilarity(all[i].title, all[j].title);
      if (sim >= 0.85) {
        duplicates.push({ a: all[i].proposal_id, b: all[j].proposal_id, similarity: sim });
      }
    }
  }
  // No real clustering — each gap is its own cluster theme.
  return {
    clusters: generations.map((g) => ({
      theme: `gap ${g.generation_number}`,
      proposal_ids: g.candidates.map((c) => c.proposal_id),
      representative_id: g.candidates[0]?.proposal_id ?? "",
    })),
    duplicates,
    soft_overlaps: [],
    ran_at: new Date().toISOString(),
  };
}

function nameSimilarity(a: string, b: string): number {
  // Token-set similarity — quick + good enough for short variation names.
  const ta = new Set(a.toLowerCase().split(/[\s_,;.:-]+/).filter((t) => t.length >= 3));
  const tb = new Set(b.toLowerCase().split(/[\s_,;.:-]+/).filter((t) => t.length >= 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

interface FeatureRankInput {
  generations: BrainstormGeneration[];
  cleanup: BrainstormCleanup;
  rootCauses: string[];
}

/** Deterministic ranking for feature variations. Composite:
 *    0.50 · addresses_pain (confidence from the LLM)
 *    0.30 · distinctness   (1 − max similarity to any other live candidate)
 *    0.20 · spread         (covers a unique gap_root_cause)
 *  Critique sub-score left as 0 (Phase 6b can add an LLM pass; today's
 *  deterministic baseline is honest signal). */
function rankFeatureVariations(input: FeatureRankInput): BrainstormRanking {
  const t0 = Date.now();
  const all: BrainstormCandidate[] = input.generations.flatMap((g) => g.candidates);
  const dropped = new Set<string>();
  // Drop the lower of each duplicate pair.
  for (const dup of input.cleanup.duplicates) {
    const a = all.find((c) => c.proposal_id === dup.a);
    const b = all.find((c) => c.proposal_id === dup.b);
    if (!a || !b) continue;
    if ((a.confidence ?? 0) >= (b.confidence ?? 0)) dropped.add(b.proposal_id);
    else dropped.add(a.proposal_id);
  }
  const live = all.filter((c) => !dropped.has(c.proposal_id));

  // Distinctness: 1 - max token-set similarity to any OTHER live candidate
  const distinctness = new Map<string, number>();
  for (const a of live) {
    let maxSim = 0;
    for (const b of live) {
      if (a.proposal_id === b.proposal_id) continue;
      const s = nameSimilarity(a.title, b.title);
      if (s > maxSim) maxSim = s;
    }
    distinctness.set(a.proposal_id, Math.max(0, 1 - maxSim));
  }
  // Spread: 1 if this candidate's gap (intent_of_origin) is unique
  // among live ones, otherwise weighted down.
  const gapCounts = new Map<string, number>();
  for (const c of live) {
    gapCounts.set(c.intent_of_origin, (gapCounts.get(c.intent_of_origin) ?? 0) + 1);
  }

  const ranked: BrainstormRankedCandidate[] = live.map((c) => {
    const addresses = clampScore(c.confidence);
    const dist = distinctness.get(c.proposal_id) ?? 0;
    const spread =
      gapCounts.get(c.intent_of_origin)! === 1
        ? 1
        : 1 / gapCounts.get(c.intent_of_origin)!;
    const sub: BrainstormSubScores = {
      coverage: addresses, // re-using the slot for "addresses pain"
      diversity: dist,
      preference: spread,
      critique: 0,
    };
    const composite = 0.5 * addresses + 0.3 * dist + 0.2 * spread;
    const reasoning: BrainstormReasoning = {
      why_strong: addresses > 0.6
        ? `Targets pain at confidence ${addresses.toFixed(2)} — directly addresses gap.`
        : `Plausible counter at ${addresses.toFixed(2)} confidence.`,
      where_stretches:
        dist < 0.5
          ? "Overlaps with at least one other candidate — distinctness limited."
          : "Distinct from siblings.",
      whats_missing:
        c.rationale && c.rationale.length > 0
          ? "Tradeoff stated; verify against constraints."
          : "Tradeoff prose missing — clarify before electing.",
      closest_neighbor: null,
    };
    return {
      proposal_id: c.proposal_id,
      composite_score: composite,
      sub_scores: sub,
      ribbon: "tray" as BrainstormRibbon,
      reasoning,
    };
  });

  // Sort + assign ribbons.
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

function clampScore(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
