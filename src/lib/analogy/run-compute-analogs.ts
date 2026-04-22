// ── runComputeAnalogs — shared core ──
//
// Factored out of /api/pipeline/compute-analogs so the auto-advance
// chain (strategy-refresh terminal hook) can call it inline without
// HTTP overhead, auth re-validation, or burning an extra request.
// The HTTP endpoint wraps this same function.
//
// Soft-fail contract: returns a result with `success: false` + an
// error message rather than throwing. The caller (pipeline hook) is
// never blocked by analog discovery failing.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractKGSignature,
  STRUCTURAL_DIM,
  COMBINED_DIM,
} from "./signature-extractor";
import {
  retrieveAnalogsBothModes,
  type AnalogMatch,
} from "./analog-retrieval";
import { explainAnalog, type AnalogExplanation } from "./analog-explainer";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type { Entity, Edge, Cycle } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

const DEFAULT_MIN_SIMILARITY = 0.78;
const MAX_EXPLAINED_MATCHES = 4;

export interface RunComputeAnalogsOpts {
  spaceId: string;
  userId: string;
  /** When provided, fires structural_analog_found events on this run. */
  runId?: string | null;
  /** [0, 1] floor on cosine similarity. Default 0.78. */
  minSimilarity?: number;
  /** Mark the produced signature as available to other users' queries. */
  anonymizeForCrossUser?: boolean;
}

export interface RunComputeAnalogsResult {
  success: boolean;
  signatureUpserted: boolean;
  analogsFound: number;
  results: Array<{
    match: AnalogMatch;
    explanation: AnalogExplanation | null;
  }>;
  error?: string;
}

export async function runComputeAnalogs(
  db: AnyDb,
  opts: RunComputeAnalogsOpts,
): Promise<RunComputeAnalogsResult> {
  const minSimilarity = clamp01(opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY);

  try {
    const [entRes, edgeRes, cycleRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", opts.spaceId),
      db.from("edges").select("*").eq("space_id", opts.spaceId),
      db.from("cycles").select("*").eq("space_id", opts.spaceId),
    ]);

    if (entRes.error) {
      return emptyResult(`entities load: ${entRes.error.message}`);
    }
    const entities = (entRes.data ?? []) as Entity[];
    const edges = (edgeRes.data ?? []) as Edge[];
    const cycles = (cycleRes.data ?? []) as Cycle[];

    if (entities.length === 0) {
      return { success: true, signatureUpserted: false, analogsFound: 0, results: [] };
    }

    const signature = await extractKGSignature(entities, edges, cycles);

    if (signature.structural_vector.length !== STRUCTURAL_DIM) {
      return emptyResult(
        `structural vector wrong dim: ${signature.structural_vector.length}`,
      );
    }
    if (signature.combined_vector.length !== COMBINED_DIM) {
      return emptyResult(
        `combined vector wrong dim: ${signature.combined_vector.length}`,
      );
    }

    await db
      .from("kg_signatures")
      .delete()
      .eq("space_id", opts.spaceId)
      .is("cluster_id", null);

    const { error: upsertErr } = await db.from("kg_signatures").insert({
      space_id: opts.spaceId,
      user_id: opts.userId,
      cluster_id: null,
      structural_vector: signature.structural_vector,
      semantic_centroid: signature.semantic_centroid,
      combined_vector: signature.combined_vector,
      summary_text: signature.summary_text,
      entity_count: signature.features.entity_count,
      edge_count: signature.features.edge_count,
      cycle_count: signature.features.cycle_count,
      has_master_bottleneck: signature.features.has_master_bottleneck,
      is_anonymized_for_cross_user: opts.anonymizeForCrossUser === true,
    });
    if (upsertErr) {
      return emptyResult(`signature upsert: ${upsertErr.message}`);
    }

    const matches = await retrieveAnalogsBothModes(db, {
      excludeSpaceId: opts.spaceId,
      callerUserId: opts.userId,
      structuralVector: signature.structural_vector,
      combinedVector: signature.combined_vector,
      matchCount: 10,
      minSimilarity,
    });

    if (matches.length === 0) {
      return {
        success: true,
        signatureUpserted: true,
        analogsFound: 0,
        results: [],
      };
    }

    const topMatches = matches.slice(0, MAX_EXPLAINED_MATCHES);

    const sourceEntitySummaries = entities.map((e) => ({
      id: e.id,
      name: e.name,
      is_leverage_point: e.is_leverage_point,
      is_risk_point: e.is_risk_point,
      is_master_bottleneck: e.is_master_bottleneck,
      importance: e.importance,
    }));
    const sourceCycleSummaries = cycles.map((c) => ({
      name: c.name,
      classification: c.classification,
      entity_ids: c.entity_ids,
    }));

    const results: Array<{
      match: AnalogMatch;
      explanation: AnalogExplanation | null;
    }> = [];

    for (const match of topMatches) {
      const [anEntRes, anCycleRes] = await Promise.all([
        db
          .from("entities")
          .select(
            "id, name, is_leverage_point, is_risk_point, is_master_bottleneck, importance",
          )
          .eq("space_id", match.space_id),
        db
          .from("cycles")
          .select("name, classification, entity_ids")
          .eq("space_id", match.space_id),
      ]);
      const analogEntities = (anEntRes.data ?? []) as Array<
        Pick<
          Entity,
          | "id"
          | "name"
          | "is_leverage_point"
          | "is_risk_point"
          | "is_master_bottleneck"
          | "importance"
        >
      >;
      const analogCycles = (anCycleRes.data ?? []) as Array<
        Pick<Cycle, "name" | "classification" | "entity_ids">
      >;

      if (analogEntities.length === 0) {
        results.push({ match, explanation: null });
        continue;
      }

      const explanation = await explainAnalog({
        sourceSummary: signature.summary_text,
        analogSummary: match.summary_text ?? "(no summary)",
        sourceEntities: sourceEntitySummaries,
        analogEntities,
        sourceCycles: sourceCycleSummaries,
        analogCycles,
        isCrossUser: match.is_cross_user,
      });

      results.push({ match, explanation });

      if (opts.runId && explanation) {
        await emitStructuralEvent(db, opts.runId, {
          type: "structural_analog_found",
          signatureId: match.signature_id,
          analogSpaceId: match.space_id,
          isCrossUser: match.is_cross_user,
          mode: match.mode,
          similarity: match.similarity,
          analogSummary: match.summary_text,
          headline: explanation.headline,
          entityPairings: explanation.entity_pairings.map((p) => ({
            sourceEntityName: p.source_entity_name,
            analogEntityName: p.analog_entity_name,
            reason: p.reason,
          })),
          insight: explanation.insight,
          confidence: explanation.confidence,
        });
      }
    }

    return {
      success: true,
      signatureUpserted: true,
      analogsFound: matches.length,
      results,
    };
  } catch (err) {
    return emptyResult(
      err instanceof Error ? err.message : "compute-analogs threw",
    );
  }
}

function emptyResult(error: string): RunComputeAnalogsResult {
  return {
    success: false,
    signatureUpserted: false,
    analogsFound: 0,
    results: [],
    error,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_MIN_SIMILARITY;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
