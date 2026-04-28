// ── D13a · Consequence-surface backfill tail ─────────────────────────
//
// Idempotent backfill of `entities.node_signature.consequence_surface`
// for spaces whose signatures were materialized BEFORE D13a shipped
// (the field always landed empty pre-D13a) or for template-seeded
// spaces that may have entities without consequence-surface
// population.
//
// Pure function over (db, spaceId). Soft-fail throughout — a failed
// backfill leaves the existing signature untouched. Called from the
// decompose route's `after()` tail and (later) from the
// /api/explore/create template tail.
//
// Idempotency contract: ONLY writes when the computed surface is
// non-empty AND the existing surface is empty or missing. So calling
// it twice in a row is a no-op on the second call. Calling it after
// a fresh decompose (where seedNodeSignature already populated the
// field) is also a no-op.
//
// See docs/KG_DEPTH_CRITIQUE.md §13a for context.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeConsequenceSurface,
  type ConsequenceSurfaceEdgeInput,
} from "@/lib/pipeline/signature-materializer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

const MIN_ENTITIES_FOR_BACKFILL = 4;

export interface BackfillConsequenceSurfacesInput {
  db: AnyDb;
  spaceId: string;
}

export interface BackfillConsequenceSurfacesResult {
  /** How many entities had their signature touched. */
  updated: number;
  /** Entities scanned (with non-null node_signature). */
  scanned: number;
  /** Entities skipped because the signature already had a non-empty surface. */
  skipped_already_populated: number;
  /** Entities skipped because the entity has no outgoing edges. */
  skipped_no_outgoing: number;
  /** Hard errors during update; logged but don't propagate. */
  update_failures: number;
  duration_ms: number;
}

export async function backfillConsequenceSurfaces(
  input: BackfillConsequenceSurfacesInput,
): Promise<BackfillConsequenceSurfacesResult | null> {
  const t0 = Date.now();
  const { db, spaceId } = input;

  const result: BackfillConsequenceSurfacesResult = {
    updated: 0,
    scanned: 0,
    skipped_already_populated: 0,
    skipped_no_outgoing: 0,
    update_failures: 0,
    duration_ms: 0,
  };

  // Load entities + edges in parallel. We only need rows whose
  // node_signature is non-null — empty signatures have nothing to
  // backfill into (seedNodeSignature/materializeFromContext should be
  // called separately for those).
  const [entitiesRes, edgesRes] = await Promise.all([
    db
      .from("entities")
      .select("id, node_signature")
      .eq("space_id", spaceId)
      .not("node_signature", "is", null),
    db
      .from("edges")
      .select("source_entity_id, target_entity_id, polarity, strength, confidence")
      .eq("space_id", spaceId),
  ]);

  const entityRows = (entitiesRes.data ?? []) as Array<{
    id: string;
    node_signature: Record<string, unknown> | null;
  }>;
  const edgeRows = (edgesRes.data ?? []) as ConsequenceSurfaceEdgeInput[];

  if (entityRows.length < MIN_ENTITIES_FOR_BACKFILL) {
    console.log(
      `[consequence-surface-tail] skip — only ${entityRows.length} entities with signatures (< ${MIN_ENTITIES_FOR_BACKFILL})`,
    );
    return null;
  }

  // Bucket outgoing edges by source for cheap per-entity lookup.
  const outgoingBySource = new Map<string, ConsequenceSurfaceEdgeInput[]>();
  for (const edge of edgeRows) {
    if (!edge.source_entity_id) continue;
    let bucket = outgoingBySource.get(edge.source_entity_id);
    if (!bucket) {
      bucket = [];
      outgoingBySource.set(edge.source_entity_id, bucket);
    }
    bucket.push(edge);
  }

  for (const row of entityRows) {
    result.scanned += 1;
    const sig = row.node_signature;
    if (!sig || typeof sig !== "object") continue;

    // Idempotency: skip if already populated. We treat "any entry" as
    // populated to avoid clobbering an LLM-deepened richer surface.
    const existingSurface = (sig as { consequence_surface?: unknown })
      .consequence_surface;
    if (Array.isArray(existingSurface) && existingSurface.length > 0) {
      result.skipped_already_populated += 1;
      continue;
    }

    const outgoing = outgoingBySource.get(row.id) ?? [];
    if (outgoing.length === 0) {
      result.skipped_no_outgoing += 1;
      continue;
    }

    const surface = computeConsequenceSurface(row.id, outgoing);
    if (surface.length === 0) {
      result.skipped_no_outgoing += 1;
      continue;
    }

    // Update the JSONB column. Read-modify-write; soft-fail.
    const updatedSig = { ...sig, consequence_surface: surface };
    try {
      const { error } = await db
        .from("entities")
        .update({ node_signature: updatedSig })
        .eq("id", row.id);
      if (error) {
        result.update_failures += 1;
        console.warn(
          `[consequence-surface-tail] update failed for ${row.id} (non-fatal):`,
          error.message ?? error,
        );
        continue;
      }
      result.updated += 1;
    } catch (err) {
      result.update_failures += 1;
      console.warn(
        `[consequence-surface-tail] update threw for ${row.id} (non-fatal):`,
        err,
      );
    }
  }

  result.duration_ms = Date.now() - t0;

  console.log(
    `[consequence-surface-tail] updated=${result.updated} scanned=${result.scanned} skipped_populated=${result.skipped_already_populated} skipped_no_out=${result.skipped_no_outgoing} failures=${result.update_failures} (${result.duration_ms}ms)`,
  );

  return result;
}
