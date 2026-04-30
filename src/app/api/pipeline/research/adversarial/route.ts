// ── POST /api/pipeline/research/adversarial ──
//
// Phase 2b — adversarial pass. Targets top-N high-confidence claims
// in a space and runs an explicit counter-evidence search against
// each. Anything found gets persisted via persistEvidenceBatch with
// support_type='contradicts', which automatically demotes the claim's
// confidence (claim-producer's posterior recompute handles that) and
// can flip status to 'contested' or 'refuted' when the contradicting
// evidence is high-reliability.
//
// Body:
//   {
//     spaceId: string,
//     runId?: string,                         // for event emission
//     topN?: number,                          // default 5; clamped 1..20
//     claimIds?: string[],                    // override target selection
//     researchDepth?: ResearchDepth,          // default "standard"
//     questionType?: QuestionType,
//     domain?: CoarseDomain,
//   }
//
// Response:
//   {
//     claimsChallenged, contradictionsFound, evidenceInserted,
//     events: { contradictionFound: number },
//     errors: []
//   }
//
// Cost: each claim runs ~1 web_search + 1 extraction LLM call.
// Bound topN tightly — runaway adversarial passes burn credits fast.
//
// Auth: user must own the space.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { runMultiSourceRetrieval } from "@/lib/research/multi-source-retrieval";
import { persistEvidenceBatch } from "@/lib/research/claim-producer";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import {
  ADVERSARIAL_SEARCH_SYSTEM_ADDENDUM,
  buildAdversarialSearchQuery,
} from "@/lib/prompts/adversarial-search";
import type { ResearchDepth } from "@/lib/web-search";
import type {
  CoarseDomain,
  QuestionType,
} from "@/lib/research/source-strategy";

export const runtime = "nodejs";
export const maxDuration = 300;

interface ClaimRow {
  id: string;
  claim_text: string;
  confidence: number;
  source_entity_id: string | null;
}

interface EntityRow {
  id: string;
  name: string;
  description: string | null;
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
      runId,
      topN: rawTopN,
      claimIds,
      researchDepth: rawDepth,
      questionType,
      domain,
    } = (body ?? {}) as {
      spaceId?: string;
      runId?: string;
      topN?: number;
      claimIds?: string[];
      researchDepth?: ResearchDepth;
      questionType?: QuestionType;
      domain?: CoarseDomain;
    };

    if (!spaceId) {
      return NextResponse.json({ error: "spaceId required" }, { status: 400 });
    }

    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const topN = Math.max(1, Math.min(20, rawTopN ?? 5));
    const researchDepth: ResearchDepth = rawDepth ?? "standard";
    const qType: QuestionType = questionType ?? "analysis";
    const dom: CoarseDomain = domain ?? "generic";

    // ── Pick target claims ──────────────────────────────────────────
    // Either caller specified, or top-N by current confidence among
    // claims with status='supported' (challenging unsupported claims
    // is wasted budget — we already know they're weak).
    let targetClaims: ClaimRow[] = [];
    if (Array.isArray(claimIds) && claimIds.length > 0) {
      const { data } = await db
        .from("claims")
        .select("id, claim_text, confidence, source_entity_id")
        .eq("space_id", spaceId)
        .in("id", claimIds.slice(0, 20));
      targetClaims = (data ?? []) as ClaimRow[];
    } else {
      const { data } = await db
        .from("claims")
        .select("id, claim_text, confidence, source_entity_id")
        .eq("space_id", spaceId)
        .eq("status", "supported")
        .order("confidence", { ascending: false })
        .limit(topN);
      targetClaims = (data ?? []) as ClaimRow[];
    }

    if (targetClaims.length === 0) {
      return NextResponse.json({
        claimsChallenged: 0,
        contradictionsFound: 0,
        evidenceInserted: 0,
        events: { contradictionFound: 0 },
        errors: [],
        note: "no supported claims to challenge",
      });
    }

    // ── Resolve entity context for sharper queries ──────────────────
    const entityIds = targetClaims
      .map((c) => c.source_entity_id)
      .filter((id): id is string => typeof id === "string");
    const entitiesById = new Map<string, EntityRow>();
    if (entityIds.length > 0) {
      const { data } = await db
        .from("entities")
        .select("id, name, description")
        .in("id", entityIds);
      for (const e of (data ?? []) as EntityRow[]) {
        entitiesById.set(e.id, e);
      }
    }

    // Candidate list for the extractor — top entities so it can tag
    // relates_to_entity_ids correctly.
    const candidateList = Array.from(entitiesById.values())
      .slice(0, 20)
      .map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
      }));

    // ── Fire adversarial retrieval per claim ────────────────────────
    // Sequential rather than parallel — adversarial mode is the
    // expensive one; bounded latency matters less than bounded cost.
    // 5 sequential at ~$0.03 each = ~15s end-to-end at $0.15 worst case.
    const errors: string[] = [];
    let totalEvidenceInserted = 0;
    let totalContradictionsFound = 0;
    let contradictionEventsEmitted = 0;

    for (const claim of targetClaims) {
      const entity = claim.source_entity_id
        ? entitiesById.get(claim.source_entity_id)
        : null;
      // The query passed to runMultiSourceRetrieval is BOTH the seed
      // for the agent's web_search queries AND the queryContext fed
      // to the evidence extractor. We pass the original claim text so:
      //   (a) the extractor correctly tags counter-findings as
      //       support_type='contradicts' relative to the claim, and
      //   (b) the agent (steered by ADVERSARIAL_SEARCH_SYSTEM_ADDENDUM)
      //       still issues counter-framed search queries.
      // The buildAdversarialSearchQuery helper is exposed for callers
      // who want explicit query control, but the system-prompt route
      // gives more reliable adversarial behavior in practice.
      const _searchHint = buildAdversarialSearchQuery({
        claimText: claim.claim_text,
        entityName: entity?.name,
        currentConfidence: claim.confidence,
      });

      try {
        const retrieval = await runMultiSourceRetrieval({
          query: claim.claim_text,
          questionType: qType,
          domain: dom,
          candidateEntities: candidateList,
          researchDepth,
          systemPromptAddendum: ADVERSARIAL_SEARCH_SYSTEM_ADDENDUM,
        });

        // Filter to evidence the extractor tagged as contradicting OR
        // boundary-condition contextualizers. Persisting "supports" rows
        // here would defeat the point — we only land contradictory
        // evidence into the existing claim. Anything truly supportive
        // is also fine to keep but should be filtered to avoid drowning
        // the contradiction signal in the same pass.
        const adversarialEvidence = retrieval.evidence.filter(
          (ev) =>
            ev.support_type === "contradicts" ||
            ev.support_type === "contextualizes",
        );

        if (adversarialEvidence.length === 0) continue;

        const persistResult = await persistEvidenceBatch(
          db,
          adversarialEvidence,
          {
            spaceId,
            claimSourceType: "deep_research",
          },
        );
        totalEvidenceInserted += persistResult.evidenceInserted;
        if (persistResult.errors.length > 0) {
          errors.push(...persistResult.errors.slice(0, 3));
        }

        // Re-fetch the claim's updated confidence after persistEvidenceBatch
        // recomputed it. Used in the contradiction_found event so the
        // canvas can show the delta.
        const { data: refreshed } = await db
          .from("claims")
          .select("confidence")
          .eq("id", claim.id)
          .maybeSingle();
        const confidenceAfter =
          (refreshed as { confidence?: number } | null)?.confidence ??
          claim.confidence;

        // Emit contradiction_found per actual contradictor (not
        // contextualizers — those don't count as contradictions for
        // the canvas signal).
        const contradictors = adversarialEvidence.filter(
          (ev) => ev.support_type === "contradicts",
        );
        totalContradictionsFound += contradictors.length;

        if (runId && contradictors.length > 0) {
          // Look up the persisted evidence_items.id by URL so the
          // event payload references the actual DB row. (Cheap query
          // — typically 1-3 rows per claim.)
          for (const ev of contradictors) {
            try {
              const { data: evRow } = await db
                .from("evidence_items")
                .select("id, reliability_prior")
                .eq("space_id", spaceId)
                .eq("url", ev.url)
                .maybeSingle();
              if (!evRow) continue;
              await emitStructuralEvent(db, runId, {
                type: "contradiction_found",
                claimId: claim.id,
                evidenceId: (evRow as { id: string }).id,
                sourceUrl: ev.url,
                sourceReliability:
                  (evRow as { reliability_prior?: number })
                    .reliability_prior ??
                  ev.source_classification.reliability_prior,
                confidenceAfter,
              });
              contradictionEventsEmitted++;
            } catch (emitErr) {
              errors.push(
                `contradiction_found emit failed for ${claim.id}: ${
                  emitErr instanceof Error
                    ? emitErr.message
                    : String(emitErr)
                }`,
              );
            }
          }
        }
      } catch (err) {
        errors.push(
          `adversarial pass for claim ${claim.id} threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return NextResponse.json({
      claimsChallenged: targetClaims.length,
      contradictionsFound: totalContradictionsFound,
      evidenceInserted: totalEvidenceInserted,
      events: { contradictionFound: contradictionEventsEmitted },
      errors: errors.slice(0, 10),
    });
  } catch (outerErr) {
    console.error("[research/adversarial] unhandled:", outerErr);
    return NextResponse.json(
      {
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Adversarial pass failed unexpectedly",
      },
      { status: 500 },
    );
  }
}
