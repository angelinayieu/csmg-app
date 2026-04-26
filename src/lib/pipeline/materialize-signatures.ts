// ── Pipeline wiring for signature_materializer (Batch 7) ───────────────
//
// Called once at the tail of the `kg` stage, after entities + edges +
// cycles have been persisted and their events emitted. Walks every
// freshly-persisted entity, materializes its canonical NodeSignature
// from incident edges + axis memberships, persists it onto the
// `entities.node_signature` / `resolution_zoom` / `resolution_horizon`
// columns, and emits one `signature_deepened` event per ring so the
// canvas painter can animate rings in as they accrete.
//
// Soft-fail throughout: a malformed entity or a failed UPDATE logs a
// warning and moves on. Missing signatures render as bare dots in the
// three-panel UI — the fallback path stays usable.

import {
  materializeFromContext,
  type MaterializerContext,
  type MaterializerEdgeInput,
  type MaterializerEntityInput,
} from "@/lib/pipeline/signature-materializer";
import { emitBatchEvents } from "@/lib/events/structural-event-bus";
import type {
  ProbabilitySpaceAxis,
  StructuralEvent,
} from "@/types/pipeline-events";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

interface SanitizedEntityLike {
  entity_id: string;
  name: string;
  entity_category: string;
  entity_type: string;
  importance: string;
  confidence: number;
  is_leverage_point: boolean;
  manifold: Record<string, unknown> | null;
}

interface SanitizedEdgeLike {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  dimension: string;
  polarity: string | null;
  strength?: number | null;
  confidence?: number;
  is_part_of_cycle?: boolean;
}

/**
 * Narrow the free-text category coming out of sanitizeEntity() to the
 * closed union the materializer consumes. Unknown/new categories map
 * to "abstract" — the safest default (no invented controllability).
 */
function narrowCategory(
  raw: string,
): MaterializerEntityInput["entity_category"] {
  switch (raw) {
    case "concrete":
    case "abstract":
    case "process":
    case "relational":
    case "epistemic":
      return raw;
    default:
      return "abstract";
  }
}

function narrowImportance(
  raw: string | null | undefined,
): MaterializerEntityInput["importance"] {
  switch (raw) {
    case "fundamental":
    case "critical":
    case "important":
    case "moderate":
      return raw;
    default:
      return null;
  }
}

function narrowDimension(raw: string): MaterializerEdgeInput["dimension"] {
  const valid = [
    "structural",
    "functional",
    "temporal",
    "causal",
    "correlational",
    "logical",
    "epistemic",
    "comparative",
    "agentive",
  ] as const;
  return (valid as readonly string[]).includes(raw)
    ? (raw as MaterializerEdgeInput["dimension"])
    : "causal";
}

function narrowPolarity(raw: string | null): MaterializerEdgeInput["polarity"] {
  switch (raw) {
    case "positive":
    case "negative":
    case "neutral":
    case "conditional":
      return raw;
    default:
      return "neutral";
  }
}

function narrowControllability(
  raw: unknown,
): NonNullable<MaterializerEntityInput["manifold"]>["controllability"] {
  if (raw === "direct" || raw === "indirect" || raw === "uncontrollable") return raw;
  return "indirect";
}

/**
 * Query cross_space_link events for this run and build an entity→axes
 * lookup. Called once per materialize pass so we don't round-trip the
 * DB per entity. Soft-fails with an empty map — axis rings just won't
 * render for affected entities.
 */
async function loadAxisMemberships(
  db: AnyDb,
  runId: string,
): Promise<Map<string, ProbabilitySpaceAxis[]>> {
  const map = new Map<string, ProbabilitySpaceAxis[]>();
  try {
    const { data } = await db
      .from("pipeline_run_events")
      .select("event_type, payload")
      .eq("run_id", runId)
      .eq("event_type", "cross_space_link");
    if (!Array.isArray(data)) return map;
    for (const row of data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = (row as any).payload as
        | { entityId?: string; axes?: ProbabilitySpaceAxis[] }
        | null;
      if (!payload?.entityId || !Array.isArray(payload.axes)) continue;
      map.set(payload.entityId, payload.axes);
    }
  } catch (err) {
    console.warn("[materialize-signatures] axis loader failed (non-fatal):", err);
  }
  return map;
}

export interface MaterializeSignaturesInput {
  db: AnyDb;
  runId: string | null;
  spaceId: string;
  sanitizedEntities: SanitizedEntityLike[];
  /** entity_id (semantic code like "C1") → row UUID, from the KG insert. */
  entityIdMap: Map<string, string>;
  sanitizedEdges: SanitizedEdgeLike[];
}

/**
 * Main entry. Idempotent per entity — re-running against the same
 * inputs produces the same canonical_code and overwrites the prior
 * row (version still bumps from the trigger's perspective because the
 * materialized_at timestamp changes).
 */
export async function materializeAndEmitSignatures(
  input: MaterializeSignaturesInput,
): Promise<{ materialized: number; emitted: number }> {
  const { db, runId, sanitizedEntities, entityIdMap, sanitizedEdges } = input;
  if (sanitizedEntities.length === 0) return { materialized: 0, emitted: 0 };

  // Axis memberships are keyed by entity UUID, not semantic code.
  const axesByUuid = runId ? await loadAxisMemberships(db, runId) : new Map();

  // Group incident edges by entity UUID once — avoids O(E) rescans
  // inside the per-entity loop when the graph has hundreds of edges.
  const incidentByEntity = new Map<string, SanitizedEdgeLike[]>();
  for (const edge of sanitizedEdges) {
    const push = (id: string) => {
      const arr = incidentByEntity.get(id) ?? [];
      arr.push(edge);
      incidentByEntity.set(id, arr);
    };
    push(edge.source_entity_id);
    if (edge.target_entity_id !== edge.source_entity_id) push(edge.target_entity_id);
  }

  const events: StructuralEvent[] = [];
  let materialized = 0;

  for (const rawEntity of sanitizedEntities) {
    const uuid = entityIdMap.get(rawEntity.entity_id);
    if (!uuid) continue;

    const incidents = incidentByEntity.get(uuid) ?? [];
    const manifoldIn = rawEntity.manifold ?? null;

    const entityInput: MaterializerEntityInput = {
      id: uuid,
      name: rawEntity.name,
      entity_category: narrowCategory(rawEntity.entity_category),
      entity_type: rawEntity.entity_type,
      importance: narrowImportance(rawEntity.importance),
      confidence: rawEntity.confidence,
      is_leverage_point: rawEntity.is_leverage_point,
      // At kg-stage exit no auto-expansion has run yet. Expansion-
      // driven rings are added by a later deepen() pass.
      is_expanded: false,
      manifold: manifoldIn
        ? {
            controllability: narrowControllability(manifoldIn.controllability),
            visibility:
              manifoldIn.visibility === "observable" ||
              manifoldIn.visibility === "latent" ||
              manifoldIn.visibility === "hidden"
                ? (manifoldIn.visibility as "observable" | "latent" | "hidden")
                : undefined,
            volatility:
              manifoldIn.volatility === "stable" ||
              manifoldIn.volatility === "fluctuating" ||
              manifoldIn.volatility === "chaotic"
                ? (manifoldIn.volatility as "stable" | "fluctuating" | "chaotic")
                : undefined,
          }
        : null,
    };

    const edgeInputs: MaterializerEdgeInput[] = incidents.map((e, i) => ({
      id: `${uuid}-incident-${i}`,
      source_entity_id: e.source_entity_id,
      target_entity_id: e.target_entity_id,
      relationship_type: e.relationship_type,
      dimension: narrowDimension(e.dimension),
      polarity: narrowPolarity(e.polarity ?? null),
      strength: typeof e.strength === "number" ? e.strength : 0.7,
      confidence: typeof e.confidence === "number" ? e.confidence : 0.7,
      is_part_of_cycle: e.is_part_of_cycle === true,
    }));

    const ctx: MaterializerContext = {
      entity: entityInput,
      incidentEdges: edgeInputs,
      axisMemberships: axesByUuid.get(uuid) ?? [],
      subComponentCount: 0,
    };

    const signature = materializeFromContext(ctx);

    // Persist onto the entity row. The invariants trigger enforces
    // rings === basis.length && canonical_code === basis.join(".");
    // since materializeFromContext produces these by construction
    // the write should always pass, but we still soft-fail loudly.
    try {
      const { error } = await db
        .from("entities")
        .update({
          node_signature: signature,
          resolution_zoom: signature.resolution.zoom,
          resolution_horizon: signature.resolution.horizon,
        })
        .eq("id", uuid);
      if (error) {
        console.warn("[materialize-signatures] update failed:", uuid, error.message);
        continue;
      }
    } catch (err) {
      console.warn("[materialize-signatures] update threw:", uuid, err);
      continue;
    }

    materialized += 1;

    // One signature_deepened event per ring — the painter interprets
    // each event as "draw an additional ring", so a fresh 3-ring
    // signature produces 3 events. Keeping them individual lets the
    // painter animate the onion-layer growth the design calls for.
    signature.basis.forEach((ring, idx) => {
      // Residual uncertainty at this snapshot — simulate the partial
      // signature's residual by summing contributions up to idx only.
      const cumContribution = signature.basis
        .slice(0, idx + 1)
        .reduce((s, b) => s + b.contribution, 0);
      events.push({
        type: "signature_deepened",
        entityId: uuid,
        canonicalCode: signature.basis
          .slice(0, idx + 1)
          .map((b) => b.code)
          .join("."),
        addedRing: {
          index: ring.index,
          code: ring.code,
          label: ring.label,
          sourceAxis: ring.source_axis,
          contribution: ring.contribution,
          confidence: ring.confidence,
          controllability: ring.controllability,
        },
        rings: idx + 1,
        residualUncertainty: Math.max(0, 1 - cumContribution),
        version: signature.version,
      });
    });
  }

  if (runId && events.length > 0) {
    await emitBatchEvents(db, runId, events);
  }

  return { materialized, emitted: events.length };
}
