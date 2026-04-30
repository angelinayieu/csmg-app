// ── POST /api/pipeline/evidence-populate ──
//
// On-demand evidence grounding for a space. Fires multi-source
// retrieval for the top-N most important entities in the space,
// extracts structured evidence, persists to evidence_items +
// claims + claim_evidence_links.
//
// Separate from research/route.ts on purpose:
//   • research fires on every pipeline run — keeping it fast
//     matters (auto-advance chain has tight latency budgets)
//   • evidence grounding should be OPT-IN because each call fires
//     N × anthropic web_search + N × gpt-4o-mini extraction batches.
//     Credit-heavy, worth a dedicated trigger.
//   • Separating it makes the research-first check in strategy-
//     refresh meaningful — if evidence exists, grounding tier
//     upgrades; if not, MC runs alone. Neither path breaks.
//
// Flow:
//   1. Resolve space + verify ownership.
//   2. Pick top-N entities (leverage / risk / bottleneck / high
//      importance) — these are the ones worth grounding.
//   3. For each, run runMultiSourceRetrieval with the entity's
//      name+description as the query, top entities as candidates.
//   4. persistEvidenceBatch on the combined result set.
//   5. Return summary counts.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { runMultiSourceRetrieval } from "@/lib/research/multi-source-retrieval";
import { persistEvidenceBatch } from "@/lib/research/claim-producer";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type {
  CoarseDomain,
  QuestionType,
} from "@/lib/research/source-strategy";
import type { Entity } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface EntityCandidate {
  id: string;
  name: string;
  description?: string | null;
}

export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const { data: body, error: parseError } = await safeJsonParse(request);
    if (parseError) return parseError;

    const {
      spaceId,
      questionType,
      domain,
      maxEntities: rawMaxEntities,
      researchDepth: rawDepth,
      runId,
    } = (body ?? {}) as {
      spaceId?: string;
      questionType?: QuestionType;
      domain?: CoarseDomain;
      maxEntities?: number;
      researchDepth?: "training" | "light" | "standard" | "deep";
      /** Phase 2 — when caller threads through the active pipeline_run
       *  id, we emit `triangulation_gap` events per under-supported
       *  claim so the orchestrator can target them next pass. Optional
       *  (the route still works for ad-hoc grounding without a run). */
      runId?: string;
    };

    if (!spaceId) {
      return NextResponse.json({ error: "spaceId required" }, { status: 400 });
    }

    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Default to general-business prediction if the caller didn't
    // supply classification. The plan still works — it just uses the
    // default retrieval plan.
    const qType: QuestionType = questionType ?? "analysis";
    const dom: CoarseDomain = domain ?? "generic";
    const maxEntities = Math.max(1, Math.min(10, rawMaxEntities ?? 5));
    const researchDepth = rawDepth ?? "standard";

    // ── Pick the N most important entities to ground ──
    // Prefer leverage + risk + bottleneck flags, then importance.
    const { data: entities, error: entErr } = await db
      .from("entities")
      .select("*")
      .eq("space_id", spaceId);

    if (entErr) {
      return NextResponse.json(
        { error: `entity fetch failed: ${entErr.message}` },
        { status: 500 },
      );
    }

    const allEntities = (entities ?? []) as Entity[];
    if (allEntities.length === 0) {
      return NextResponse.json({
        success: true,
        evidenceInserted: 0,
        claimsCreated: 0,
        linksCreated: 0,
        note: "space has no entities to ground",
      });
    }

    // Rank: flags first, then importance enum, then name presence.
    const impRank: Record<string, number> = {
      fundamental: 0,
      critical: 1,
      important: 2,
      moderate: 3,
    };
    const ranked = [...allEntities].sort((a, b) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ae = a as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const be = b as any;
      const aFlagScore =
        (ae.is_leverage_point ? 0 : 1) +
        (ae.is_risk_point ? 0 : 1) +
        (ae.is_master_bottleneck ? 0 : 1);
      const bFlagScore =
        (be.is_leverage_point ? 0 : 1) +
        (be.is_risk_point ? 0 : 1) +
        (be.is_master_bottleneck ? 0 : 1);
      if (aFlagScore !== bFlagScore) return aFlagScore - bFlagScore;
      const aImp = impRank[ae.importance ?? "moderate"] ?? 4;
      const bImp = impRank[be.importance ?? "moderate"] ?? 4;
      return aImp - bImp;
    });

    const targets = ranked.slice(0, maxEntities);

    // Candidate list for the extractor — all top entities, so every
    // retrieval pass can link evidence to the most likely match.
    const candidateList: EntityCandidate[] = ranked.slice(0, 20).map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
    }));

    // ── Fire retrieval for each target in parallel ──
    // Bounded concurrency to avoid rate-limiting the web_search tool
    // + extraction LLM simultaneously. 3 at a time keeps total
    // latency ~60-90s for 5 targets.
    const CONCURRENCY = 3;
    const combined: Awaited<ReturnType<typeof runMultiSourceRetrieval>>["evidence"] = [];
    const errors: string[] = [];
    let totalSearches = 0;
    let totalRawCitations = 0;

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const slice = targets.slice(i, i + CONCURRENCY);
      const sliceResults = await Promise.allSettled(
        slice.map(async (target) => {
          const query = [
            target.name,
            target.description
              ? `(${target.description.slice(0, 200)})`
              : "",
          ]
            .filter(Boolean)
            .join(" ");
          return runMultiSourceRetrieval({
            query,
            questionType: qType,
            domain: dom,
            candidateEntities: candidateList,
            researchDepth,
          });
        }),
      );

      for (const r of sliceResults) {
        if (r.status === "fulfilled") {
          combined.push(...r.value.evidence);
          totalSearches += r.value.searchesPerformed;
          totalRawCitations += r.value.rawCitationCount;
          if (r.value.errors.length > 0) errors.push(...r.value.errors);
        } else {
          errors.push(`retrieval rejected: ${String(r.reason).slice(0, 200)}`);
        }
      }
    }

    // ── Persist the combined batch ──
    const persistResult = await persistEvidenceBatch(db, combined, {
      spaceId,
      claimSourceType: "fast_research",
    });

    // ── Phase 2 · emit triangulation_gap events ──
    // For every claim that didn't reach the triangulation bar,
    // surface a structural event so the canvas (and downstream
    // research orchestration) can see exactly which claims need more
    // independent supporters. Soft-fail per emission: a wedged event
    // bus shouldn't block the response. Skipped when no runId is
    // threaded in (ad-hoc grounding without a pipeline run).
    if (runId && persistResult.gaps.length > 0) {
      for (const gap of persistResult.gaps) {
        try {
          await emitStructuralEvent(db, runId, {
            type: "triangulation_gap",
            claimId: gap.claimId,
            claimText: gap.claimText,
            currentSupportCount: gap.currentSupportCount,
            requiredSupportCount: gap.requiredSupportCount,
            hasContradictor: gap.hasContradictor,
            suggestedQueries: gap.suggestedQueries,
          });
        } catch (emitErr) {
          console.warn(
            "[evidence-populate] triangulation_gap emit failed (non-fatal):",
            emitErr,
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      targets_grounded: targets.length,
      searches_performed: totalSearches,
      raw_citations_received: totalRawCitations,
      evidence_extracted: combined.length,
      ...persistResult,
      errors: errors.slice(0, 10),
    });
  } catch (outerErr) {
    console.error("[evidence-populate] unhandled:", outerErr);
    return NextResponse.json(
      {
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Evidence population failed unexpectedly",
      },
      { status: 500 },
    );
  }
}
