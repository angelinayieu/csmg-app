// ── Claim producer + evidence writer ──
//
// Takes the output of `extractEvidenceBatch` and persists it into:
//   • `evidence_items` — one row per extracted URL+quote
//   • `claims` — one row per unique extracted assertion (with
//     source_entity_id pointing to the first entity the evidence
//     relates to)
//   • `claim_evidence_links` — M:M junction with support_type
//
// Key design:
//   • Claims dedup by `claim_text` within a space. If two pieces of
//     evidence produce the same claim, we persist ONE claim row and
//     link both evidence items to it. This is what turns "6 papers
//     agree" into a single well-evidenced claim with 6 supports.
//   • Claim confidence is NOT the LLM's self-assessment — it's
//     recomputed from the weighted reliability of linked evidence
//     using a Bayesian-ish update. A claim backed by 3 high-authority
//     sources lands at much higher confidence than one backed by
//     one forum post.
//   • Status auto-derives: ≥2 supporting high-reliability sources →
//     'supported'; any contradicting high-reliability source →
//     'contested'; otherwise 'proposed'.
//
// All DB writes are soft-fail so research stages never break on a
// persistence hiccup. The produced data is rich enough that the
// research-first decision layer in strategy-refresh can query it
// directly.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractedEvidence } from "./evidence-extractor";
import {
  detectTriangulationGap,
  type TriangulationGap,
  type TriangulationPolicy,
} from "./triangulation-gap-detector";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface PersistEvidenceOpts {
  spaceId: string;
  /** Where this evidence batch came from in the pipeline — goes on
   *  derived claim rows as `source_type`. */
  claimSourceType?: "deep_research" | "fast_research" | "synthesis" | "manual";
  /** Phase 2 — triangulation policy applied per claim. Defaults to the
   *  policy in triangulation-gap-detector when omitted (≥2 distinct
   *  high-reliability supporters, no contradictors). Callers running
   *  the adversarial pass can pass a stricter policy here. */
  triangulationPolicy?: TriangulationPolicy;
}

export interface PersistEvidenceResult {
  evidenceInserted: number;
  claimsCreated: number;
  claimsUpdated: number;
  linksCreated: number;
  errors: string[];
  /** Phase 2 — claims that don't yet meet the triangulation bar.
   *  Caller emits `triangulation_gap` events from these so the research
   *  orchestrator can target them on the next pass. Empty when every
   *  claim cleared the bar. */
  gaps: TriangulationGap[];
}

export async function persistEvidenceBatch(
  db: AnyDb,
  evidence: ExtractedEvidence[],
  opts: PersistEvidenceOpts,
): Promise<PersistEvidenceResult> {
  const result: PersistEvidenceResult = {
    evidenceInserted: 0,
    claimsCreated: 0,
    claimsUpdated: 0,
    linksCreated: 0,
    errors: [],
    gaps: [],
  };

  if (evidence.length === 0) return result;
  const sourceType = opts.claimSourceType ?? "fast_research";

  // Group evidence by the claim it produced (lowercased, trimmed).
  // Multiple pieces of evidence can point to the same claim → dedup.
  const claimBuckets = new Map<
    string,
    {
      claim_text: string;
      claim_type: ExtractedEvidence["claim_type"];
      source_entity_id: string | null;
      evidence: ExtractedEvidence[];
    }
  >();

  for (const ev of evidence) {
    const key = ev.extracted_claim.trim().toLowerCase().slice(0, 400);
    if (!claimBuckets.has(key)) {
      claimBuckets.set(key, {
        claim_text: ev.extracted_claim.trim(),
        claim_type: ev.claim_type,
        source_entity_id: ev.relates_to_entity_ids[0] ?? null,
        evidence: [ev],
      });
    } else {
      claimBuckets.get(key)!.evidence.push(ev);
    }
  }

  // ── Phase 1: insert/upsert evidence_items ──
  // Use extraction_hash for dedup — same URL+quote combo shouldn't
  // duplicate across runs.
  const evidenceIdByHash = new Map<string, string>();
  for (const ev of evidence) {
    const extractionHash = hashEvidence(ev);
    try {
      // Check if this evidence already exists (same hash in this space)
      const { data: existing } = await db
        .from("evidence_items")
        .select("id")
        .eq("space_id", opts.spaceId)
        .eq("extraction_hash", extractionHash)
        .maybeSingle();

      if (existing?.id) {
        evidenceIdByHash.set(extractionHash, existing.id as string);
        continue;
      }

      const { data: inserted, error: insertErr } = await db
        .from("evidence_items")
        .insert({
          space_id: opts.spaceId,
          url: ev.url,
          title: ev.title,
          source_type: ev.source_classification.source_type,
          published_at: ev.published_at,
          quote: ev.quote,
          reliability_prior: ev.source_classification.reliability_prior,
          recency_score: ev.source_classification.recency_score,
          extraction_hash: extractionHash,
        })
        .select("id")
        .single();

      if (insertErr) {
        result.errors.push(`evidence insert: ${insertErr.message}`);
        continue;
      }
      if (inserted?.id) {
        evidenceIdByHash.set(extractionHash, inserted.id as string);
        result.evidenceInserted++;
      }
    } catch (err) {
      result.errors.push(
        `evidence insert threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Phase 2: upsert claims + link to evidence ──
  for (const bucket of claimBuckets.values()) {
    // Compute claim-level confidence from supporting evidence.
    // Bayesian-style: each supporting evidence shifts the posterior
    // up by a function of its reliability × extraction confidence;
    // contradicting evidence shifts down. Cap at [0.05, 0.98].
    let weightedForSum = 0;
    let weightedAgainstSum = 0;
    for (const ev of bucket.evidence) {
      const w = ev.source_classification.reliability_prior * ev.confidence_in_extraction;
      if (ev.support_type === "supports") weightedForSum += w;
      else if (ev.support_type === "contradicts") weightedAgainstSum += w;
      // "contextualizes" doesn't move the posterior — it's
      // background, not testimony for/against the claim.
    }
    const totalWeight = weightedForSum + weightedAgainstSum;
    const confidence =
      totalWeight > 0
        ? clamp(
            0.5 + 0.5 * ((weightedForSum - weightedAgainstSum) / Math.max(totalWeight, 1)),
            0.05,
            0.98,
          )
        : 0.5;

    // Status: supported when ≥2 high-reliability supporters and no
    // meaningful contradictions; contested when any high-reliability
    // contradictor; else proposed.
    const highReliSupporters = bucket.evidence.filter(
      (ev) =>
        ev.support_type === "supports" &&
        ev.source_classification.reliability_prior >= 0.7,
    ).length;
    const highReliContradictors = bucket.evidence.filter(
      (ev) =>
        ev.support_type === "contradicts" &&
        ev.source_classification.reliability_prior >= 0.7,
    ).length;
    const status: "proposed" | "supported" | "contested" | "refuted" =
      highReliContradictors >= 2 && highReliSupporters === 0
        ? "refuted"
        : highReliContradictors >= 1
          ? "contested"
          : highReliSupporters >= 2
            ? "supported"
            : "proposed";

    try {
      // Find existing claim with same text in this space
      const { data: existingClaim } = await db
        .from("claims")
        .select("id, confidence")
        .eq("space_id", opts.spaceId)
        .eq("claim_text", bucket.claim_text)
        .maybeSingle();

      let claimId: string | null = null;
      if (existingClaim?.id) {
        // Update with the new confidence + status (may have shifted
        // based on the new evidence).
        const { error: updateErr } = await db
          .from("claims")
          .update({ confidence, status, updated_at: new Date().toISOString() })
          .eq("id", existingClaim.id);
        if (!updateErr) {
          claimId = existingClaim.id as string;
          result.claimsUpdated++;
        } else {
          result.errors.push(`claim update: ${updateErr.message}`);
        }
      } else {
        const { data: inserted, error: insertErr } = await db
          .from("claims")
          .insert({
            space_id: opts.spaceId,
            claim_text: bucket.claim_text,
            claim_type: bucket.claim_type,
            status,
            confidence,
            source_entity_id: bucket.source_entity_id,
            source_type: sourceType,
          })
          .select("id")
          .single();
        if (insertErr) {
          result.errors.push(`claim insert: ${insertErr.message}`);
          continue;
        }
        if (inserted?.id) {
          claimId = inserted.id as string;
          result.claimsCreated++;
        }
      }

      if (!claimId) continue;

      // Link every piece of evidence in the bucket to this claim.
      for (const ev of bucket.evidence) {
        const hash = hashEvidence(ev);
        const evidenceId = evidenceIdByHash.get(hash);
        if (!evidenceId) continue;

        // Upsert junction row. `primary key (claim_id, evidence_id)`
        // means an onConflict hint is safe.
        try {
          const { error: linkErr } = await db
            .from("claim_evidence_links")
            .upsert(
              {
                claim_id: claimId,
                evidence_id: evidenceId,
                support_type: ev.support_type,
              },
              { onConflict: "claim_id,evidence_id" },
            );
          if (!linkErr) result.linksCreated++;
          else result.errors.push(`link: ${linkErr.message}`);
        } catch (err) {
          result.errors.push(
            `link threw: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // ── Phase 2 · triangulation gap check ──
      // After every piece of evidence is linked, decide whether this
      // claim has enough independent supporters to be "triangulated".
      // If not, push a TriangulationGap onto the result. Callers emit
      // a `triangulation_gap` structural event per gap when a runId
      // is in scope (see /api/pipeline/evidence-populate). Pure data:
      // we don't touch the event bus here so this module stays
      // testable as a persistence-only unit.
      const gap = detectTriangulationGap({
        claimId,
        claimText: bucket.claim_text,
        evidence: bucket.evidence,
        policy: opts.triangulationPolicy,
      });
      if (gap) {
        result.gaps.push(gap);
      }
    } catch (err) {
      result.errors.push(
        `claim block threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

// ── Helpers ──

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Stable hash for dedup: (url + normalized quote). Two different
 * quotes from the same URL are legitimately different evidence
 * items. Same quote → same evidence; any re-run lands on the same
 * hash and won't duplicate.
 */
function hashEvidence(ev: ExtractedEvidence): string {
  const normalized = `${ev.url}::${ev.quote.trim().toLowerCase().slice(0, 200)}`;
  // Simple rolling hash — sufficient for dedup (collisions would
  // require both same URL AND substantially same quote, which is
  // the right equivalence class for "is this the same evidence").
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  return `ev_${Math.abs(hash).toString(36)}_${normalized.length}`;
}
