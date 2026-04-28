// ── D11 · Template edge augmenter ──────────────────────────────────────
//
// Closes the gap diagnosed in docs/KG_DEPTH_CRITIQUE.md (template-seeded
// spaces have ~0.30 edges/entity vs ~1.5× target on user-text decompose).
//
// Background: /api/explore/create seeds entities + edges from a curated
// research template (e.g. mind-body-cognition: 63 biology nodes + 6
// interventions + 6 instruments = ~76 entities; ~23 surviving seed
// edges from CRCI). Heterogeneous entities — interventions (leaves in
// CRCI, no edges) and instruments (not in CRCI at all) — land
// completely isolated. The user-text decompose pipeline enforces
// orphan-detection in its prompt (every entity ≥ 2 edges, edge density
// ≥ 1.5×); the template path bypasses that enforcement entirely.
//
// This module is the catch-up pass:
//   1. Load all entities + edges in the just-created space
//   2. Detect isolated entities (degree ≤ 1)
//   3. Pick anchor candidates (top-degree, well-connected entities)
//   4. Sample existing edges so the LLM learns the template's vocabulary
//   5. Single LLM call: "wire these isolated entities to anchors"
//   6. Validate + persist as edges with source_tag="predicted",
//      requires_user_approval=true, provenance source_type="template_augment"
//
// Soft-fail throughout. Cost-bounded by candidate caps. Runs in
// `after()` from /api/explore/create so the response ships first.
//
// Honest contract: prompt explicitly allows "decline" answers — we are
// not forcing the LLM to fabricate. Empty `edges: []` with a populated
// `declined: [...]` is a valid output and gets persisted as
// provenance.declined_entities on the space row (so user sees "system
// declined to wire X, Y, Z because…" instead of mysterious orphans).

import type { SupabaseClient } from "@supabase/supabase-js";
import { llmJSON } from "@/lib/llm";
import { resilientInsert } from "@/lib/sanitize";
import {
  TEMPLATE_EDGE_AUGMENT_SYSTEM,
  validateAugmentResponse,
  type AugmentResponse,
} from "@/lib/prompts/template-edge-augment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

// ── Tunables ────────────────────────────────────────────────────────

/** Skip the augmenter entirely on tiny spaces — not enough signal. */
const MIN_TOTAL_ENTITIES_FOR_AUGMENT = 8;

/**
 * Skip when the template already produced a healthy graph. Threshold
 * is the edges-per-entity ratio below which we consider the graph
 * under-connected. The user-text decompose prompt targets ≥ 1.5×; we
 * use 0.8× as the augmenter's trigger so well-seeded templates aren't
 * disturbed.
 */
const AUGMENT_TRIGGER_DENSITY = 0.8;

/** Max isolated entities surfaced to the LLM in one call. With 25
 *  isolated entities and 25 anchors, the prompt fits comfortably in
 *  one call's context window without truncation. */
const MAX_ISOLATED_PER_CALL = 25;

/** Max anchor entities surfaced to the LLM. We pick the highest-degree
 *  entities so the LLM has the most context-rich set to wire to. */
const MAX_ANCHORS_PER_CALL = 25;

/** Max edges sampled for vocabulary learning. */
const MAX_EXISTING_EDGES_SAMPLE = 30;

/** Hard cap on edges the augmenter will create per run. Prevents
 *  pathological runs that wire every isolated entity to every anchor. */
const MAX_AUGMENT_EDGES = 60;

const LLM_MAX_TOKENS = 6000;
const LLM_TEMPERATURE = 0.2;

// ── I/O ─────────────────────────────────────────────────────────────

export interface RunTemplateAugmentInput {
  db: AnyDb;
  spaceId: string;
  templateSlug: string;
}

export interface RunTemplateAugmentResult {
  /** Why the augmenter exited (or "ran" if it actually did the LLM call). */
  status:
    | "skipped_too_few_entities"
    | "skipped_density_ok"
    | "skipped_no_isolated"
    | "ran_no_proposals"
    | "ran";
  total_entities: number;
  total_edges_before: number;
  isolated_count: number;
  edges_proposed: number;
  edges_persisted: number;
  declined_count: number;
  llm_calls: number;
  duration_ms: number;
}

// ── Public entry ────────────────────────────────────────────────────

export async function runTemplateEdgeAugmenter(
  input: RunTemplateAugmentInput,
): Promise<RunTemplateAugmentResult> {
  const t0 = Date.now();
  const { db, spaceId, templateSlug } = input;

  const result: RunTemplateAugmentResult = {
    status: "skipped_too_few_entities",
    total_entities: 0,
    total_edges_before: 0,
    isolated_count: 0,
    edges_proposed: 0,
    edges_persisted: 0,
    declined_count: 0,
    llm_calls: 0,
    duration_ms: 0,
  };

  // 1. Load entities + edges
  const [entitiesRes, edgesRes] = await Promise.all([
    db
      .from("entities")
      .select("id, entity_id, name, description, entity_category, layer, importance")
      .eq("space_id", spaceId),
    db
      .from("edges")
      .select(
        "id, source_entity_id, target_entity_id, relationship_type, polarity",
      )
      .eq("space_id", spaceId),
  ]);

  type EntityRow = {
    id: string;
    entity_id: string;
    name: string;
    description: string | null;
    entity_category: string | null;
    layer: string | null;
    importance: string | null;
  };
  type EdgeRow = {
    id: string;
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string | null;
    polarity: string | null;
  };

  const entities = (entitiesRes.data ?? []) as EntityRow[];
  const edges = (edgesRes.data ?? []) as EdgeRow[];

  result.total_entities = entities.length;
  result.total_edges_before = edges.length;

  if (entities.length < MIN_TOTAL_ENTITIES_FOR_AUGMENT) {
    result.duration_ms = Date.now() - t0;
    return result;
  }

  // 2. Density gate
  const density = entities.length > 0 ? edges.length / entities.length : 0;
  if (density >= AUGMENT_TRIGGER_DENSITY) {
    result.status = "skipped_density_ok";
    result.duration_ms = Date.now() - t0;
    return result;
  }

  // 3. Compute degree per entity
  const degree = new Map<string, number>();
  for (const e of entities) degree.set(e.id, 0);
  for (const ed of edges) {
    degree.set(ed.source_entity_id, (degree.get(ed.source_entity_id) ?? 0) + 1);
    degree.set(ed.target_entity_id, (degree.get(ed.target_entity_id) ?? 0) + 1);
  }

  // 4. Identify isolated entities (degree 0 or 1) and anchors (top degree)
  const isolatedAll = entities
    .filter((e) => (degree.get(e.id) ?? 0) <= 1)
    .sort((a, b) =>
      // Prioritize fundamental/critical entities first — wiring them
      // unlocks downstream signal more than wiring a moderate orphan.
      importanceWeight(b.importance) - importanceWeight(a.importance),
    );
  if (isolatedAll.length === 0) {
    result.status = "skipped_no_isolated";
    result.duration_ms = Date.now() - t0;
    return result;
  }

  const isolated = isolatedAll.slice(0, MAX_ISOLATED_PER_CALL);
  result.isolated_count = isolatedAll.length;

  const anchorsAll = entities
    .filter((e) => (degree.get(e.id) ?? 0) >= 2)
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
  const anchors = anchorsAll.slice(0, MAX_ANCHORS_PER_CALL);

  // No anchors at all = nothing for the LLM to wire to. Return early.
  if (anchors.length === 0) {
    result.status = "skipped_no_isolated";
    result.duration_ms = Date.now() - t0;
    return result;
  }

  // 5. Sample existing edges for vocabulary + structure context
  const sampledEdges = edges
    .slice(0, MAX_EXISTING_EDGES_SAMPLE)
    .map((ed) => {
      const src = entities.find((e) => e.id === ed.source_entity_id);
      const tgt = entities.find((e) => e.id === ed.target_entity_id);
      return {
        source_name: src?.name ?? "?",
        target_name: tgt?.name ?? "?",
        relationship_type: ed.relationship_type ?? "relates to",
        polarity: ed.polarity ?? "neutral",
      };
    });

  // 6. LLM call
  const userPrompt = buildUserPrompt({
    templateSlug,
    isolated,
    anchors,
    sampledEdges,
  });

  let llmResponse: AugmentResponse;
  try {
    llmResponse = await llmJSON<AugmentResponse>({
      system: TEMPLATE_EDGE_AUGMENT_SYSTEM,
      user: userPrompt,
      maxTokens: LLM_MAX_TOKENS,
      temperature: LLM_TEMPERATURE,
      validator: validateAugmentResponse,
      fallback: { edges: [], declined: [] },
    });
    result.llm_calls = 1;
  } catch (err) {
    console.warn("[template-augment] LLM call failed (non-fatal):", err);
    result.status = "ran_no_proposals";
    result.duration_ms = Date.now() - t0;
    return result;
  }

  result.edges_proposed = llmResponse.edges.length;
  result.declined_count = llmResponse.declined.length;

  if (llmResponse.edges.length === 0) {
    result.status = "ran_no_proposals";
    // Persist declined entries as provenance on the space so the UI can
    // surface "system declined to wire X because…" instead of mysterious
    // orphans. Soft-fail.
    await persistDeclined({ db, spaceId, declined: llmResponse.declined });
    result.duration_ms = Date.now() - t0;
    return result;
  }

  // 7. Filter + build edge rows directly (bypass sanitizeEdge so we
  //    can keep requires_user_approval + provenance, matching the
  //    /api/canvas/recursive-decompose pattern for predicted edges).
  const validIdSet = new Set(entities.map((e) => e.id));
  const existingEdgeKeys = new Set(
    edges.map((ed) => edgeKey(ed.source_entity_id, ed.target_entity_id)),
  );

  const augmentedAt = new Date().toISOString();
  const edgeRows = llmResponse.edges
    .slice(0, MAX_AUGMENT_EDGES)
    .filter(
      (e) =>
        validIdSet.has(e.source_entity_id) &&
        validIdSet.has(e.target_entity_id) &&
        e.source_entity_id !== e.target_entity_id &&
        !existingEdgeKeys.has(
          edgeKey(e.source_entity_id, e.target_entity_id),
        ),
    )
    .map((e) => ({
      space_id: spaceId,
      source_entity_id: e.source_entity_id,
      target_entity_id: e.target_entity_id,
      relationship_type: e.relationship_type,
      dimension: e.dimension,
      source_tag: "predicted",
      polarity: e.polarity,
      strength: e.strength,
      confidence: e.confidence,
      conditions: e.conditions,
      requires_user_approval: true,
      is_tradeoff: false,
      is_part_of_cycle: false,
      dynamics: null,
      dynamics_properties: null,
      provenance: {
        source_type: "template_augment",
        template_slug: templateSlug,
        rationale: e.rationale,
        augmented_at: augmentedAt,
      },
    }));

  if (edgeRows.length === 0) {
    result.status = "ran_no_proposals";
    await persistDeclined({ db, spaceId, declined: llmResponse.declined });
    result.duration_ms = Date.now() - t0;
    return result;
  }

  try {
    const { data: inserted } = await resilientInsert(
      db,
      "edges",
      edgeRows,
      "id",
    );
    result.edges_persisted = (inserted ?? []).length;
  } catch (err) {
    console.warn(
      "[template-augment] edge insert failed (non-fatal):",
      err,
    );
  }

  // Update space's edge_count cache so list views reflect the augment.
  if (result.edges_persisted > 0) {
    try {
      await db
        .from("spaces")
        .update({
          edge_count: edges.length + result.edges_persisted,
        })
        .eq("id", spaceId);
    } catch (err) {
      console.warn("[template-augment] count update failed (non-fatal):", err);
    }
  }

  await persistDeclined({ db, spaceId, declined: llmResponse.declined });

  result.status = "ran";
  result.duration_ms = Date.now() - t0;
  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildUserPrompt(input: {
  templateSlug: string;
  isolated: Array<{
    id: string;
    name: string;
    description: string | null;
    entity_category: string | null;
    layer: string | null;
  }>;
  anchors: Array<{
    id: string;
    name: string;
    description: string | null;
    entity_category: string | null;
    layer: string | null;
  }>;
  sampledEdges: Array<{
    source_name: string;
    target_name: string;
    relationship_type: string;
    polarity: string;
  }>;
}): string {
  return [
    `Template: ${input.templateSlug}`,
    "",
    `ISOLATED entities (${input.isolated.length}) — these need wiring:`,
    JSON.stringify(
      input.isolated.map((e) => ({
        id: e.id,
        name: e.name,
        description: (e.description ?? "").slice(0, 300),
        category: e.entity_category,
        layer: e.layer,
      })),
      null,
      2,
    ),
    "",
    `ANCHOR entities (${input.anchors.length}) — well-connected nodes you can wire isolated entities to:`,
    JSON.stringify(
      input.anchors.map((e) => ({
        id: e.id,
        name: e.name,
        description: (e.description ?? "").slice(0, 300),
        category: e.entity_category,
        layer: e.layer,
      })),
      null,
      2,
    ),
    "",
    `EXISTING edges (sample for relationship-type vocabulary):`,
    JSON.stringify(input.sampledEdges, null, 2),
    "",
    `Produce the augment JSON now. Decline rather than fabricate.`,
  ].join("\n");
}

async function persistDeclined(input: {
  db: AnyDb;
  spaceId: string;
  declined: Array<{ entity_id: string; reason: string }>;
}): Promise<void> {
  if (input.declined.length === 0) return;
  // Stamp a provenance note on each declined entity so the UI can
  // explain why it remains isolated. We update entities.provenance JSONB
  // additively (preserve existing fields). Soft-fail on each row.
  for (const d of input.declined) {
    try {
      const { data: row } = await input.db
        .from("entities")
        .select("provenance")
        .eq("id", d.entity_id)
        .eq("space_id", input.spaceId)
        .maybeSingle();
      const existing =
        row && typeof row.provenance === "object" && row.provenance !== null
          ? (row.provenance as Record<string, unknown>)
          : {};
      existing.template_augment_declined = {
        reason: d.reason,
        declined_at: new Date().toISOString(),
      };
      await input.db
        .from("entities")
        .update({ provenance: existing })
        .eq("id", d.entity_id)
        .eq("space_id", input.spaceId);
    } catch {
      // Soft-fail per row — one bad write doesn't abort the rest.
    }
  }
}

function importanceWeight(importance: string | null): number {
  switch (importance) {
    case "fundamental":
      return 4;
    case "critical":
      return 3;
    case "important":
      return 2;
    case "moderate":
      return 1;
    default:
      return 0;
  }
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
