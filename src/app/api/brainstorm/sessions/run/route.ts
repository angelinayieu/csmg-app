// ── POST /api/brainstorm/sessions/run ───────────────────────────────
//
// Brainstorm Runner — Phase 2 of BRAINSTORM_MODULE_SPEC.md.
//
// Orchestrates the whole 5-stage pipeline in one request:
//
//   Stage 1  computeBrainstormPlan() — pick 3 intents from lens
//            coverage + user preference (or accept override)
//   Stage 2  for each intent: internal-fetch the existing
//            /sub-objectives/propose mode=variant route; capture
//            the new batch + append to session.generations
//   Stage 3  internal-fetch /sub-objectives/cluster; map result
//            into BrainstormCleanup (with cheap Jaccard redundancy
//            pairs computed locally)
//   Stage 4  rankDeterministic() — composite-score every candidate,
//            assign ribbons (green/amber/tray). Phase 3 swaps in the
//            LLM critique by replacing this single call.
//   Stage 5  settle() — persist ranking + flip status='settled' +
//            fire brainstorm_completed
//
// REUSE DISCIPLINE: this route does NOT replicate the propose or
// cluster routes' context-loading (research, lens, concepts, etc.).
// It calls them via cookie-forwarded internal fetch so the existing
// routes stay the single source of truth + the runner inherits any
// future changes to their behaviour. Avoids the parallel-subsystem
// trap called out in feedback_check_existing_first.md.
//
// Body: { spaceId, intents?, tldrawPageId? }
//   spaceId       — required, the objective space to brainstorm on
//   intents       — optional 3-intent override (user pre-edited the
//                   plan chips before pressing Start)
//   tldrawPageId  — optional page id the panel created on the
//                   objective board; stored on the session for re-open
//
// Returns: { session: BrainstormSession }
//
// Wall-clock target: ~25-30s (3 LLM propose calls @ ~6-9s each + 1
// cluster call ~3s + deterministic critique). Phase 3 adds ~10s for
// the critique LLM call.

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import {
  readObjectiveCanvasState,
  allBlockProposals,
  type SubObjectiveBlock,
  type SubObjectiveBatch,
  type SubObjectiveIntent,
  type SubObjectiveProposal,
} from "@/lib/objective-canvas/sub-objective-state";
import { getUserIntentPreferences } from "@/lib/objective-canvas/decision-log";
import {
  computeProposalRedundancy,
  type ClusterAnalysis,
  type RedundantPair,
} from "@/lib/objective-canvas/cluster-proposals";
import {
  createSession,
  commitPlan,
  appendGeneration,
  setCleanup,
  settle,
  abandon,
} from "@/lib/brainstorm/sessions";
import { computeBrainstormPlan } from "@/lib/brainstorm/plan";
import { rankWithLLMCritique, summariseRanking } from "@/lib/brainstorm/critique";
import type {
  BrainstormCandidate,
  BrainstormGeneration,
  BrainstormCleanup,
  BrainstormDuplicatePair,
  BrainstormPlan,
} from "@/lib/brainstorm/session-types";

export const runtime = "nodejs";
// 3 × propose (max 45s each in /propose's own maxDuration) + cluster
// (no explicit cap, ~10-15s) + critique (deterministic, <1s). Total
// worst-case is bounded by the slowest propose call since they fire
// sequentially. 120s gives comfortable headroom.
export const maxDuration = 120;

const ALLOWED_INTENTS: ReadonlyArray<SubObjectiveIntent> = [
  // "initial" deliberately EXCLUDED — brainstorm always appends.
  "creative",
  "concrete",
  "contrarian",
  "gap_fill",
  "ambitious",
  "wildcard",
];

interface Body {
  spaceId?: string;
  intents?: SubObjectiveIntent[];
  tldrawPageId?: string | null;
  /** Phase 4b-1 live-polling: client may supply the session id up
   *  front (crypto.randomUUID()) so the panel can start polling
   *  /sessions/[id] while the runner is mid-pipeline. */
  sessionId?: string | null;
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

  // Validate optional intent override. Must be exactly 3 distinct
  // ALLOWED_INTENTS or omitted. Partial overrides aren't allowed at
  // this entry point — the panel surfaces the auto-plan and the user
  // either accepts it whole or substitutes whole slots.
  let intentOverride: SubObjectiveIntent[] | null = null;
  if (Array.isArray(body?.intents)) {
    if (body.intents.length !== 3) {
      return NextResponse.json(
        { error: "intents override must contain exactly 3 entries" },
        { status: 400 },
      );
    }
    const seen = new Set<SubObjectiveIntent>();
    for (const i of body.intents) {
      if (!ALLOWED_INTENTS.includes(i)) {
        return NextResponse.json(
          { error: `invalid intent: ${i}` },
          { status: 400 },
        );
      }
      if (seen.has(i)) {
        return NextResponse.json(
          { error: `intent ${i} listed twice` },
          { status: 400 },
        );
      }
      seen.add(i);
    }
    intentOverride = body.intents;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const userId = auth.user.id;

  // ── Load context for the plan + later scoring ───────────────────

  const { data: space, error: spaceErr } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (spaceErr || !space) {
    return NextResponse.json({ error: "space not found" }, { status: 404 });
  }
  if (space.user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const oc = readObjectiveCanvasState(space.synthesis_data);
  const block: SubObjectiveBlock | null = oc.sub_objectives ?? null;
  const currentProposals: SubObjectiveProposal[] = block
    ? allBlockProposals(block)
    : [];

  // Parent annotations + objective text live on the root improvement_goal.
  // Annotations seed gap_fill + coverage scoring; description grounds the
  // Phase 3 LLM critique pass. Fall back to space.description / input_text
  // when the goal's description is empty.
  const { data: rootGoal } = await db
    .from("improvement_goals")
    .select("annotations, description, title")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const annotations = Array.isArray(rootGoal?.annotations)
    ? rootGoal.annotations
    : [];
  const coreObjectiveText: string =
    (typeof rootGoal?.description === "string" &&
      rootGoal.description.trim()) ||
    (typeof rootGoal?.title === "string" && rootGoal.title.trim()) ||
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  // User per-intent preferences for plan + critique scoring. Loaded
  // once + reused (the plan helper + critique scorer both consume it).
  const userPreferences = await getUserIntentPreferences(db, userId);

  // ── Stage 1: build the plan ────────────────────────────────────

  let plan: BrainstormPlan;
  if (intentOverride) {
    // User supplied a hand-picked plan. Reasons all flagged as
    // user_override so the audit trail is honest.
    plan = {
      intents: intentOverride,
      reasons: Object.fromEntries(
        intentOverride.map((i) => [
          i,
          { source: "user_override" as const, replaced: i },
        ]),
      ) as BrainstormPlan["reasons"],
      locked_at: new Date().toISOString(),
    };
  } else {
    plan = await computeBrainstormPlan({
      annotations,
      currentProposals,
      userPreferences,
    });
  }

  // ── Create the session row + commit the plan ────────────────────

  let session;
  try {
    // Client-provided session id powers live polling (Phase 4b-1).
    // Strip anything that's not a v4-shape UUID to avoid pollution.
    const clientId =
      typeof body?.sessionId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.sessionId,
      )
        ? body.sessionId
        : null;
    session = await createSession(db, {
      userId,
      spaceId,
      targetKind: "sub_objective_picker",
      title: autoTitle(plan.intents),
      tldrawPageId: body?.tldrawPageId ?? null,
      id: clientId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `failed to create session: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }

  // commitPlan fires brainstorm_started internally.
  await commitPlan(db, {
    userId,
    spaceId,
    sessionId: session.id,
    plan,
  });

  // ── Stage 2: run divergence batches ─────────────────────────────

  const cookieHeader = req.headers.get("cookie") ?? "";
  const origin = new URL(req.url).origin;

  const generations: BrainstormGeneration[] = [];
  let lastSeenProposalIds = new Set(currentProposals.map((p) => p.id));

  for (let i = 0; i < plan.intents.length; i++) {
    const intent = plan.intents[i];
    const t0 = Date.now();

    let proposeBlock: SubObjectiveBlock | null = null;
    try {
      const res = await fetch(`${origin}/api/brainstorm/sub-objectives/propose`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: cookieHeader,
        },
        body: JSON.stringify({
          spaceId,
          mode: "variant",
          intent,
        }),
      });
      if (!res.ok) {
        const detail = await safeReadError(res);
        console.warn(
          `[brainstorm/run] propose intent=${intent} failed (${res.status}): ${detail}`,
        );
        continue; // skip this intent; runner still tries the next
      }
      const json = (await res.json()) as { sub_objectives?: SubObjectiveBlock };
      proposeBlock = json.sub_objectives ?? null;
    } catch (err) {
      console.warn(
        `[brainstorm/run] propose intent=${intent} threw:`,
        err instanceof Error ? err.message : String(err),
      );
      continue;
    }

    if (!proposeBlock) continue;

    // Identify the NEW batch — variant mode appends, so it's the last
    // one in batches[]. Defensive: only treat it as "ours" if its
    // intent matches what we requested + we haven't already absorbed
    // a batch with this id this run.
    const allBatches = Array.isArray(proposeBlock.batches)
      ? proposeBlock.batches
      : [];
    const newBatch = identifyNewBatch(allBatches, intent, lastSeenProposalIds);
    if (!newBatch) {
      console.warn(
        `[brainstorm/run] propose intent=${intent} returned no new batch`,
      );
      continue;
    }

    const candidates: BrainstormCandidate[] = newBatch.proposals.map((p) => ({
      proposal_id: p.id,
      title: p.title,
      summary: p.summary,
      rationale: p.rationale,
      confidence: typeof p.confidence === "number" ? p.confidence : 0.5,
      lens_coverage: Array.isArray(p.lens_coverage) ? p.lens_coverage : [],
      intent_of_origin: intent,
    }));

    const generation: BrainstormGeneration = {
      intent,
      generation_number: i + 1,
      batch_id: newBatch.id,
      candidates,
      generated_at: newBatch.generated_at,
      latency_ms: Date.now() - t0,
    };
    await appendGeneration(db, session.id, generation);
    generations.push(generation);

    // Track ids we've absorbed so the NEXT iteration can detect its
    // own batch even if /propose returned multiple new ones.
    for (const p of newBatch.proposals) lastSeenProposalIds.add(p.id);
  }

  // ── Bail out if every intent failed ─────────────────────────────
  if (generations.length === 0) {
    await abandon(db, session.id);
    return NextResponse.json(
      {
        error:
          "all divergence batches failed — see server logs. Session abandoned.",
        session_id: session.id,
      },
      { status: 502 },
    );
  }

  // ── Stage 3: cleanup pass (cluster + redundancy) ────────────────

  // Flat candidate list across all generations + existing proposals —
  // the cluster pass operates over the SPACE's full proposal set after
  // the /propose calls, so we read it once after the loop. We re-read
  // synthesis_data so we see whatever /propose persisted.
  const { data: postSpace } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  const postOc = readObjectiveCanvasState(postSpace?.synthesis_data);
  const postBlock = postOc.sub_objectives;
  const allCurrent: SubObjectiveProposal[] = postBlock
    ? allBlockProposals(postBlock)
    : [];

  // The new candidates we want to score live in `generations`; cluster
  // pass operates over the WHOLE set (so clusters reflect the merged
  // picker view). Critique reads cluster membership for diversity.
  let clusterAnalysis: ClusterAnalysis | null = null;
  try {
    const res = await fetch(`${origin}/api/brainstorm/sub-objectives/cluster`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify({ spaceId, mode: "force" }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        cluster_analysis?: ClusterAnalysis;
      };
      clusterAnalysis = json.cluster_analysis ?? null;
    } else {
      const detail = await safeReadError(res);
      console.warn(
        `[brainstorm/run] cluster failed (${res.status}): ${detail}`,
      );
    }
  } catch (err) {
    console.warn(
      "[brainstorm/run] cluster threw:",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Cheap local Jaccard for duplicate pairs — cluster route stores
  // counts but not pair details. Critique uses pairs to drop the
  // weaker of any near-identical proposal.
  const redundancy = computeProposalRedundancy(
    allCurrent.map((p) => ({ id: p.id, title: p.title, summary: p.summary })),
  );

  const cleanup: BrainstormCleanup = {
    clusters: (clusterAnalysis?.clusters ?? []).map((c) => ({
      theme: c.label,
      proposal_ids: c.proposal_ids,
      representative_id: c.representative_id,
    })),
    duplicates: redundancy.duplicate_pairs.map(mapPair),
    soft_overlaps: redundancy.soft_overlap_pairs.map(mapPair),
    ran_at: new Date().toISOString(),
  };
  await setCleanup(db, session.id, cleanup);

  // ── Stage 4: deterministic critique + ranking ───────────────────

  // Currently elected proposals = baseline for diversity + coverage
  // gain. The new candidates are scored AGAINST what's already chosen,
  // not against each other — the user's existing picks define "the bar
  // to beat" + "the holes to fill".
  const existingElected = allCurrent.filter(
    (p) => p.disposition === "elected",
  );

  // Critique only operates over the NEW candidates this run produced
  // (those in our generations[]). Existing proposals already had their
  // chance; if the user wants to re-evaluate them, they re-press
  // Brainstorm.
  const newCandidates = generations.flatMap((g) =>
    g.candidates.map((c) => {
      // Re-hydrate from allCurrent because /propose might have done
      // normalization we want to honour.
      const fresh = allCurrent.find((p) => p.id === c.proposal_id);
      const base = fresh ?? {
        id: c.proposal_id,
        title: c.title,
        summary: c.summary,
        rationale: c.rationale ?? "",
        confidence: c.confidence,
        recommended: false,
        lens_coverage: c.lens_coverage,
      } as SubObjectiveProposal;
      return { ...base, intent_of_origin: g.intent };
    }),
  );

  // Phase 3: LLM-augmented critique. Same composite math + ribbon
  // assignment as deterministic; only critique sub-score + reasoning
  // come from the LLM. Soft-fails internally to deterministic if the
  // LLM call errors, so the runner always settles.
  const ranking = await rankWithLLMCritique({
    candidates: newCandidates,
    annotations,
    existingElected,
    userPreferences,
    cleanup,
    objectiveText: coreObjectiveText,
  });

  // ── Stage 5: settle ────────────────────────────────────────────

  try {
    await settle(db, {
      userId,
      spaceId,
      sessionId: session.id,
      ranking,
      outcomeSummary: summariseRanking(ranking),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `settle failed: ${sanitizeErrorMessage(err)}`,
        session_id: session.id,
      },
      { status: 500 },
    );
  }

  // Re-fetch the session row so we return the freshly-settled snapshot
  // (caller passes this straight into the panel).
  const { data: finalRow } = await db
    .from("objective_brainstorm_sessions")
    .select("*")
    .eq("id", session.id)
    .maybeSingle();

  return NextResponse.json({ session: finalRow ?? null });
}

// ── Helpers ─────────────────────────────────────────────────────────

function identifyNewBatch(
  batches: SubObjectiveBatch[],
  intent: SubObjectiveIntent,
  alreadySeen: Set<string>,
): SubObjectiveBatch | null {
  // Walk from newest backwards. The first batch whose intent matches
  // + whose proposals are net-new is the one /propose just appended.
  for (let i = batches.length - 1; i >= 0; i--) {
    const b = batches[i];
    if (b.intent !== intent) continue;
    const isNew = b.proposals.some((p) => !alreadySeen.has(p.id));
    if (isNew) return b;
  }
  return null;
}

function mapPair(p: RedundantPair): BrainstormDuplicatePair {
  return { a: p.a_id, b: p.b_id, similarity: p.jaccard };
}

function autoTitle(intents: SubObjectiveIntent[]): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `Brainstorm · ${stamp} · ${intents.join("+")}`;
}

async function safeReadError(res: Response): Promise<string> {
  try {
    const txt = await res.text();
    return txt.slice(0, 240);
  } catch {
    return `(no body)`;
  }
}
