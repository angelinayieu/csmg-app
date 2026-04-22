/**
 * POST /api/pipeline/prospect-connections
 *
 * Runs one batch of the connection prospector agent.
 * Picks the least-examined entities, enumerates candidate pairs, runs pairwise
 * analysis, records results to `pairwise_connection_checks`, inserts proposed
 * edges, and increments coverage counters.
 *
 * Designed to be called on a schedule (client-side auto-refresh) — each call
 * chips away at the pair space without timing out.
 */

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, refreshSpaceCounts } from "@/lib/api-helpers";
import {
  selectCandidatePairs,
  screenPairsForPlausibility,
  prospectPairwiseConnections,
  canonicalPairKey,
  type ProspectorCandidate,
  type ProspectorResult,
  type ProspectorRunSummary,
} from "@/lib/orchestration/connection-prospector";
import type { Entity, Edge } from "@/types";

export const maxDuration = 60;

interface RequestBody {
  spaceId: string;
  /** How many of the least-examined entities to focus on this run (default 5) */
  entitiesToExamine?: number;
  /** Max pairs to analyze this run (default 12 — balance between coverage and cost) */
  pairsPerRun?: number;
  /** Hours to skip re-checking a pair that was previously examined (default 24) */
  coolingOffHours?: number;
}

export async function POST(req: Request) {
  const startTime = Date.now();
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    spaceId,
    entitiesToExamine = 5,
    pairsPerRun = 12,
    coolingOffHours = 24,
  } = body;

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const owns = await verifySpaceOwnership(supabase, user.id, spaceId);
  if (!owns) {
    return NextResponse.json({ error: "Space not found or not owned" }, { status: 403 });
  }

  // ── Fetch entities & edges ──
  const { data: entitiesData, error: entitiesErr } = await supabase
    .from("entities")
    .select("*")
    .eq("space_id", spaceId);

  if (entitiesErr) {
    console.error("[prospect-connections] entities fetch error:", entitiesErr);
    return NextResponse.json({ error: "Failed to fetch entities" }, { status: 500 });
  }

  const { data: edgesData, error: edgesErr } = await supabase
    .from("edges")
    .select("*")
    .eq("space_id", spaceId);

  if (edgesErr) {
    console.error("[prospect-connections] edges fetch error:", edgesErr);
    return NextResponse.json({ error: "Failed to fetch edges" }, { status: 500 });
  }

  const entities = (entitiesData ?? []) as unknown as Entity[];
  const edges = (edgesData ?? []) as unknown as Edge[];

  if (entities.length < 2) {
    return NextResponse.json({
      summary: { pairs_examined: 0, edges_proposed: 0, entities_touched: [], duration_ms: Date.now() - startTime },
      message: "Not enough entities to prospect.",
    });
  }

  // ── Fetch recent pairwise checks within cooling-off window ──
  // We also read `revisit_required` so the selection logic can split
  // recent checks into two groups:
  //   (a) cooling-off pairs — suppressed from this run's candidates
  //   (b) revisit-flagged pairs — promoted to the head of the queue
  //       (the invalidate-coverage helper raises this flag whenever
  //        new neighborhood topology lands that could flip the verdict)
  const cutoff = new Date(Date.now() - coolingOffHours * 60 * 60 * 1000).toISOString();
  const { data: recentChecks } = await supabase
    .from("pairwise_connection_checks")
    .select("pair_key, revisit_required, entity_a_id, entity_b_id")
    .eq("space_id", spaceId)
    .gte("checked_at", cutoff);

  type RecentCheckRow = {
    pair_key: string;
    revisit_required: boolean | null;
    entity_a_id: string;
    entity_b_id: string;
  };
  const recentRows: RecentCheckRow[] = (recentChecks ?? []) as RecentCheckRow[];

  const recentlyCheckedPairKeys = new Set<string>();
  const revisitPairs: Array<{ entity_a_id: string; entity_b_id: string }> = [];
  for (const r of recentRows) {
    if (r.revisit_required === true) {
      // Revisit-flagged pairs bypass cooling-off and get prioritized.
      revisitPairs.push({
        entity_a_id: r.entity_a_id,
        entity_b_id: r.entity_b_id,
      });
    } else {
      recentlyCheckedPairKeys.add(r.pair_key);
    }
  }

  // ── Entities with open user questions jump to front of prospector queue ──
  // Connects user intent directly to machine effort. A pair involving an
  // entity the user has asked about is disproportionately more valuable to
  // examine than a random pair.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbLoose = supabase as any;
  const { data: openQuestionRows } = await dbLoose
    .from("entity_questions")
    .select("entity_id")
    .eq("space_id", spaceId)
    .eq("status", "open");

  const questionedEntityIds = new Set<string>(
    (openQuestionRows ?? []).map((r: { entity_id: string }) => r.entity_id),
  );

  // ── Select 3× candidates for breadth-first screening ──
  // We over-sample so the cheap screening pass filters down to roughly
  // `pairsPerRun` genuinely plausible pairs that are worth the deep sweep.
  // Pairs screened as "no" are still recorded (as L1 breadth-scan checks)
  // so they count toward coverage — just at shallower depth.
  const oversampledCandidates = selectCandidatePairs({
    entities,
    edges,
    recentlyCheckedPairKeys,
    entitiesToExamine,
    pairsPerRun: pairsPerRun * 3,
    questionedEntityIds,
    revisitPairs,
  });

  if (oversampledCandidates.length === 0) {
    return NextResponse.json({
      summary: {
        pairs_examined: 0,
        edges_proposed: 0,
        entities_touched: [],
        duration_ms: Date.now() - startTime,
      },
      message: "No new pairs to examine (all recently checked or already connected).",
    });
  }

  // ── Build entity context lookup ──
  const entityContextById = new Map<
    string,
    { name: string; type: string; description: string | null; category: string }
  >();
  for (const e of entities) {
    entityContextById.set(e.id, {
      name: e.name,
      type: e.entity_type ?? "",
      description: e.description ?? null,
      category: e.entity_category ?? "",
    });
  }

  // ── Phase 1: Breadth-first screening (cheap) ──
  let screenedOut: Array<{ candidate: ProspectorCandidate; plausible: "yes" | "maybe" | "no"; hint?: string }> = [];
  let candidates: ProspectorCandidate[];
  try {
    const screen = await screenPairsForPlausibility(
      oversampledCandidates,
      entityContextById,
    );
    // Deep-analyze only up to pairsPerRun of the plausibles, prioritizing "yes" first
    const byVerdict = screen.screening_summary.sort((a, b) => {
      const rank = (v: string) => (v === "yes" ? 0 : v === "maybe" ? 1 : 2);
      return rank(a.plausible) - rank(b.plausible);
    });
    const toDeepAnalyze = byVerdict
      .filter((s) => s.plausible !== "no")
      .slice(0, pairsPerRun)
      .map((s) => s.candidate);
    candidates = toDeepAnalyze;
    // Everything else (screened "no" + excess plausibles beyond the budget) gets a shallow record
    screenedOut = byVerdict.filter((s) => !toDeepAnalyze.includes(s.candidate));
  } catch (err) {
    console.warn("[prospect-connections] breadth screen failed, fallback to direct deep analysis:", err);
    // If screening fails, fall back to direct deep analysis on the first `pairsPerRun` candidates
    candidates = oversampledCandidates.slice(0, pairsPerRun);
  }

  // ── Phase 2: Deep dimensional sweep on the plausibles ──
  let results: ProspectorResult[];
  try {
    results = await prospectPairwiseConnections(candidates, entityContextById);
  } catch (err) {
    console.error("[prospect-connections] LLM analysis failed:", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }

  // ── Fold screened-out pairs in as L1 breadth-scan results ──
  // These count toward coverage at level 1 (breadth only) — they were not
  // deep-swept, but they WERE considered and we have a confident verdict.
  for (const s of screenedOut) {
    const negConf = s.plausible === "no" ? 0.8 : s.plausible === "maybe" ? 0.4 : 0.2;
    results.push({
      entity_a_id: s.candidate.entity_a_id,
      entity_b_id: s.candidate.entity_b_id,
      edge_found: false,
      dimensions_examined: [],
      examination_level: 1,
      negative_confidence: negConf,
      reasoning: s.hint ? `Breadth screen: ${s.plausible}. ${s.hint}` : `Breadth screen: ${s.plausible}.`,
      revisit_trigger: s.plausible === "maybe" ? "if depth budget allows, re-examine with dimensional sweep" : undefined,
    });
  }

  // ── Persist: insert edges for edge_found=true, record all as pair-checks ──
  const edgesProposed: Edge[] = [];
  const pairCheckRows: Array<{
    space_id: string;
    entity_a_id: string;
    entity_b_id: string;
    edge_proposed: boolean;
    resulting_edge_id: string | null;
    pair_key: string;
    examination_level: number;
    negative_confidence: number | null;
    dimensions_examined: string[];
    revisit_trigger: string | null;
    reasoning: string | null;
  }> = [];
  const entitiesTouched = new Set<string>();

  for (const r of results) {
    entitiesTouched.add(r.entity_a_id);
    entitiesTouched.add(r.entity_b_id);
    const pairKey = canonicalPairKey(r.entity_a_id, r.entity_b_id);

    let resultingEdgeId: string | null = null;

    if (r.edge_found && r.dimension && r.relationship_type) {
      const { data: newEdge, error: edgeErr } = await supabase
        .from("edges")
        .insert({
          space_id: spaceId,
          source_entity_id: r.entity_a_id,
          target_entity_id: r.entity_b_id,
          relationship_type: r.relationship_type,
          dimension: r.dimension,
          source_tag: "inferred",
          strength: r.strength ?? 0.5,
          confidence: r.confidence ?? 0.6,
          polarity: r.polarity ?? "neutral",
          knowledge_layer: "internal",
          provenance: { agent: "connection-prospector", reasoning: r.reasoning ?? null, dimensions_examined: r.dimensions_examined },
        })
        .select("id")
        .single();

      if (!edgeErr && newEdge) {
        resultingEdgeId = (newEdge as { id: string }).id;
        edgesProposed.push(newEdge as unknown as Edge);
      } else if (edgeErr) {
        console.warn("[prospect-connections] edge insert failed:", edgeErr.message);
      }
    }

    pairCheckRows.push({
      space_id: spaceId,
      entity_a_id: r.entity_a_id,
      entity_b_id: r.entity_b_id,
      edge_proposed: r.edge_found,
      resulting_edge_id: resultingEdgeId,
      pair_key: pairKey,
      examination_level: r.examination_level ?? 1,
      negative_confidence: r.edge_found ? null : (r.negative_confidence ?? null),
      dimensions_examined: r.dimensions_examined ?? [],
      revisit_trigger: r.revisit_trigger ?? null,
      reasoning: r.reasoning ?? null,
    });
  }

  // Batch insert pair checks (ignore unique-violation conflicts — race-safe).
  // Note: ignoreDuplicates protects prior verdicts (incl. user_verdict) but
  // does mean re-examinations don't update the stored reasoning. Revisit
  // flags get cleared below regardless.
  if (pairCheckRows.length > 0) {
    const { error: checkErr } = await supabase
      .from("pairwise_connection_checks")
      .upsert(pairCheckRows, { onConflict: "space_id,pair_key", ignoreDuplicates: true });
    if (checkErr) {
      console.warn("[prospect-connections] pair check insert failed:", checkErr.message);
    }
  }

  // Clear revisit flags for pairs we just re-examined. Without this, the
  // pair stays flagged after re-examination and the prospector would
  // re-pick it on every subsequent run (infinite loop). Scoped to pairs
  // present in both revisitPairs (was flagged) AND pairCheckRows (was
  // actually examined this run) so we never clear flags we didn't honor.
  if (revisitPairs.length > 0 && pairCheckRows.length > 0) {
    const examinedPairKeys = new Set(pairCheckRows.map((r) => r.pair_key));
    const revisitedKeysThisRun: string[] = [];
    for (const rp of revisitPairs) {
      const key = canonicalPairKey(rp.entity_a_id, rp.entity_b_id);
      if (examinedPairKeys.has(key)) revisitedKeysThisRun.push(key);
    }
    if (revisitedKeysThisRun.length > 0) {
      const { error: clearErr } = await supabase
        .from("pairwise_connection_checks")
        .update({
          revisit_required: false,
          revisit_reason: null,
          revisit_flagged_at: null,
        })
        .eq("space_id", spaceId)
        .in("pair_key", revisitedKeysThisRun);
      if (clearErr) {
        console.warn("[prospect-connections] revisit flag clear failed:", clearErr.message);
      }
    }
  }

  // Increment connection_search_count for all touched entities (via RPC)
  for (const entityId of entitiesTouched) {
    await supabase.rpc("increment_entity_connection_search", { entity_uuid: entityId });
  }

  // Refresh space entity/edge counts
  await refreshSpaceCounts(supabase, [spaceId]);

  const summary: ProspectorRunSummary = {
    pairs_examined: results.length,
    edges_proposed: edgesProposed.length,
    entities_touched: Array.from(entitiesTouched),
    duration_ms: Date.now() - startTime,
  };

  return NextResponse.json({
    summary,
    edges: edgesProposed,
  });
}
