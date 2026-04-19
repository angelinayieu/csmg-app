// ── Run cascade detection for a space ──
//
// DB-aware wrapper around computeCascades. Fetches entities + edges + the
// structuring-metadata leverage/risk/bottleneck sets from the spaces table,
// runs the pure computeCascades() over them, and writes the report to the
// reasoning_results table with reasoning_type='cascade'.
//
// Returns the report so the caller can log/display. Throws on DB errors;
// callers should wrap in try/catch if cascade failure should not block the
// surrounding operation.

import { computeCascades, type CascadeReport } from "./cascade-detection";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any;

interface RunCascadeOptions {
  /** Tag the input_params so UIs can distinguish auto-runs from user-initiated. */
  source: "decompose_auto" | "reevaluate_auto" | "backfill" | "manual";
}

export async function runCascadeForSpace(
  db: Supabase,
  spaceId: string,
  opts: RunCascadeOptions,
): Promise<CascadeReport | null> {
  // Fetch entities (just the columns we need for cascade)
  const { data: entityRows, error: entErr } = await db
    .from("entities")
    .select("id, entity_id, name, is_leverage_point, is_risk_point, is_master_bottleneck, importance, blast_radius")
    .eq("space_id", spaceId);

  if (entErr) throw new Error(`[runCascade] entity fetch failed: ${entErr.message}`);
  if (!entityRows || entityRows.length === 0) return null;

  // Fetch edges with cascade-relevant metadata
  const { data: edgeRows, error: edgeErr } = await db
    .from("edges")
    .select("source_entity_id, target_entity_id, dimension, strength, confidence, polarity")
    .eq("space_id", spaceId);

  if (edgeErr) throw new Error(`[runCascade] edge fetch failed: ${edgeErr.message}`);

  // Pull structuring-metadata seeds (leverage/risk/bottleneck) from the space
  // so we can seed from entities the LLM flagged in synthesis_data even when
  // the is_* booleans weren't set on the entity row itself.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .single();

  const synth = (spaceRow?.synthesis_data ?? null) as Record<string, unknown> | null;
  const leverageIds = new Set<string>();
  const riskIds = new Set<string>();
  let bottleneckId: string | undefined;

  if (synth) {
    if (Array.isArray(synth.leverage_points)) {
      for (const lp of synth.leverage_points) {
        const id = typeof lp === "object" && lp !== null ? (lp as { entity_id?: string }).entity_id : null;
        if (id) leverageIds.add(id);
      }
    }
    if (Array.isArray(synth.risk_points)) {
      for (const rp of synth.risk_points) {
        const id = typeof rp === "object" && rp !== null ? (rp as { entity_id?: string }).entity_id : null;
        if (id) riskIds.add(id);
      }
    }
    if (typeof synth.master_bottleneck === "object" && synth.master_bottleneck !== null) {
      bottleneckId = (synth.master_bottleneck as { entity_id?: string }).entity_id;
    }
  }

  const cascadeEntities = entityRows.map((e: Record<string, unknown>) => ({
    id: e.id as string,
    entity_id: e.entity_id as string,
    name: e.name as string,
    is_leverage_point: Boolean(e.is_leverage_point) || leverageIds.has(e.entity_id as string),
    is_risk_point: Boolean(e.is_risk_point) || riskIds.has(e.entity_id as string),
    is_master_bottleneck: Boolean(e.is_master_bottleneck) || e.entity_id === bottleneckId,
    importance: (e.importance as string | null) ?? null,
    blast_radius: typeof e.blast_radius === "number" ? (e.blast_radius as number) : null,
  }));

  const cascadeEdges = (edgeRows ?? []).map((e: Record<string, unknown>) => ({
    source_entity_id: e.source_entity_id as string,
    target_entity_id: e.target_entity_id as string,
    dimension: (e.dimension as string | null) ?? null,
    strength: typeof e.strength === "number" ? (e.strength as number) : null,
    confidence: typeof e.confidence === "number" ? (e.confidence as number) : null,
    polarity: (e.polarity as string | null) ?? null,
  }));

  const report = computeCascades(cascadeEntities, cascadeEdges);

  // Only persist if we actually found paths — otherwise we're just polluting
  // reasoning_results with empty rows.
  if (report.paths.length > 0) {
    await db.from("reasoning_results").insert({
      space_id: spaceId,
      reasoning_type: "cascade",
      input_params: {
        source: opts.source,
        seed_strategy: "leverage_risk_bottleneck_fundamental",
        max_depth: 4,
      },
      result_data: report,
      result_text: `Auto-cascade (${opts.source}) from ${report.seeds_analyzed} seeds: ${report.total_affected_entities} entities affected across ${report.paths.length} paths (${report.systemic_pressure_points.length} systemic pressure points)`,
    });
  }

  return report;
}
