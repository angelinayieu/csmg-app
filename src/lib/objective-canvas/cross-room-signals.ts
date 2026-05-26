// ── Cross-Room Signal Detection ─────────────────────────────────────
//
// Each sub-objective room is fully scoped to its sub_objective_id —
// entities/edges only render in their own room. But the *user's* room
// pattern often spans rooms: the same mechanism shows up in two
// feature lanes, the same root cause appears under two pains in
// different rooms, the same parent-objective annotation seeds items
// in three rooms.
//
// This module computes those cross-room signals cheaply (no LLM call)
// from the existing persisted artifacts. Three categories:
//
//   1. Recurring mechanisms — same lever string across edges in ≥2
//      rooms. Surfaces "this is a structural concept your strategy
//      keeps reaching for."
//   2. Shared root causes — same verbatim root_cause / first_principle
//      string in items across ≥2 rooms. Convergence signal.
//   3. Lens convergence — same annotation index seeded items in ≥2
//      rooms. The strongest cross-room link, since the annotation IS
//      the parent-objective semantic substrate.
//
// All three are computed in a single space-scoped pass, returned as
// ranked lists capped at the top-5 of each kind to keep the UI strip
// from sprawling.

export interface CrossRoomSignal {
  /** Display label — the shared concept (mechanism name / root cause
   *  phrase / annotation phrase). */
  label: string;
  /** Which sub-objective ids touch this signal. ≥2 always (signals
   *  only surface when there's actual cross-room overlap). */
  sub_objective_ids: string[];
  /** Per-sub-objective titles for hover popovers. Pre-resolved so
   *  the UI doesn't need to re-query. */
  sub_objective_titles: string[];
  /** Total occurrence count (sum of item / edge appearances) — used
   *  for ranking. A mechanism appearing 5 times in 2 rooms ranks
   *  higher than one appearing 2 times in 2 rooms. */
  occurrence_count: number;
}

export interface CrossRoomSignals {
  mechanisms: CrossRoomSignal[];
  root_causes: CrossRoomSignal[];
  lens_convergence: CrossRoomSignal[];
}

/** Data-already-loaded variant — when the caller already has every
 *  entity + edge + sub-objective in memory (e.g., the main canvas
 *  page server-renders them all), pass them here to avoid duplicate
 *  queries. */
export function computeCrossRoomSignalsFromData(input: {
  subs: Array<{ id: string; title: string }>;
  entities: Array<{
    parent_sub_objective_id: string | null;
    causal_chain: Record<string, unknown> | null;
  }>;
  edges: Array<{
    parent_sub_objective_id: string | null;
    agent_feedback: Record<string, unknown> | null;
  }>;
}): CrossRoomSignals {
  if (input.subs.length < 2) {
    return { mechanisms: [], root_causes: [], lens_convergence: [] };
  }
  const titleById = new Map(input.subs.map((s) => [s.id, s.title] as const));
  return computeFromCollections(
    titleById,
    input.entities.filter(
      (e): e is typeof input.entities[number] & { parent_sub_objective_id: string } =>
        typeof e.parent_sub_objective_id === "string",
    ),
    input.edges.filter(
      (e): e is typeof input.edges[number] & { parent_sub_objective_id: string } =>
        typeof e.parent_sub_objective_id === "string",
    ),
  );
}

/** Compute all three cross-room signal categories for a space.
 *  Pulls every entity + edge under the space's sub-objectives in one
 *  query each, then aggregates client-side. Cheap enough to run on
 *  every main-canvas load. */
export async function computeCrossRoomSignals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
): Promise<CrossRoomSignals> {
  // ── Resolve sub-objectives in this space + their parent goal ──
  // We exclude the root (parent_goal_id IS NULL) because cross-ROOM
  // signals are about the children, not the root umbrella.
  const { data: subRows } = await db
    .from("improvement_goals")
    .select("id, title, parent_goal_id")
    .eq("space_id", spaceId)
    .not("parent_goal_id", "is", null)
    .order("created_at", { ascending: true });
  const subs = ((subRows ?? []) as Array<{
    id: string;
    title: string;
    parent_goal_id: string;
  }>) ?? [];
  if (subs.length < 2) {
    // Cross-room signals require ≥2 rooms to exist — return empty
    // shape so the UI strip just doesn't render.
    return { mechanisms: [], root_causes: [], lens_convergence: [] };
  }

  const subIds = subs.map((s) => s.id);
  const titleById = new Map(subs.map((s) => [s.id, s.title] as const));

  // ── Pull entities (for root_causes + lens_coverage) + edges (for
  //    mechanism) for every sub-objective in one fanned query each. ──
  const [entitiesRes, edgesRes] = await Promise.all([
    db
      .from("entities")
      .select(
        "id, parent_sub_objective_id, entity_type, causal_chain",
      )
      .in("parent_sub_objective_id", subIds),
    db
      .from("edges")
      .select(
        "id, parent_sub_objective_id, agent_feedback",
      )
      .in("parent_sub_objective_id", subIds),
  ]);

  const entities = ((entitiesRes.data ?? []) as Array<{
    parent_sub_objective_id: string;
    causal_chain: Record<string, unknown> | null;
  }>) ?? [];

  const edges = ((edgesRes.data ?? []) as Array<{
    parent_sub_objective_id: string;
    agent_feedback: Record<string, unknown> | null;
  }>) ?? [];

  return computeFromCollections(titleById, entities, edges);
}

/** Pure aggregation — both call sites converge here. Indexes the
 *  three signal categories (mechanism / root_cause / lens) by their
 *  canonical key, then materializes ranked CrossRoomSignal[]s capped
 *  at 5 entries per category. */
function computeFromCollections(
  titleById: Map<string, string>,
  entities: Array<{
    parent_sub_objective_id: string;
    causal_chain: Record<string, unknown> | null;
  }>,
  edges: Array<{
    parent_sub_objective_id: string;
    agent_feedback: Record<string, unknown> | null;
  }>,
): CrossRoomSignals {
  // ── 1. Recurring mechanisms (across edges) ─────────────────────
  // edges.agent_feedback.mechanism is the LLM-named lever per
  // correlation edge. Same string across ≥2 sub-objectives = signal.
  const mechMap = new Map<
    string,
    { count: number; subIds: Set<string> }
  >();
  for (const e of edges) {
    const fb = (e.agent_feedback ?? {}) as Record<string, unknown>;
    const mech =
      typeof fb.mechanism === "string" ? fb.mechanism.trim() : "";
    if (mech.length === 0) continue;
    const cell = mechMap.get(mech) ?? {
      count: 0,
      subIds: new Set<string>(),
    };
    cell.count += 1;
    cell.subIds.add(e.parent_sub_objective_id);
    mechMap.set(mech, cell);
  }

  // ── 2. Shared root causes + first principles ───────────────────
  // pain.causal_chain.root_causes[] and feature.causal_chain.first_principles[]
  // are verbatim noun phrases the room generator was instructed to
  // re-use IDENTICALLY when two items in the same room share a
  // mechanism. Cross-room re-use is the rarer + more interesting case.
  const rcMap = new Map<
    string,
    { count: number; subIds: Set<string> }
  >();
  for (const ent of entities) {
    const cc = (ent.causal_chain ?? {}) as Record<string, unknown>;
    const candidates: string[] = [];
    if (Array.isArray(cc.root_causes)) {
      for (const v of cc.root_causes as unknown[]) {
        if (typeof v === "string") candidates.push(v.trim());
      }
    }
    if (Array.isArray(cc.first_principles)) {
      for (const v of cc.first_principles as unknown[]) {
        if (typeof v === "string") candidates.push(v.trim());
      }
    }
    for (const phrase of candidates) {
      if (phrase.length === 0) continue;
      const cell = rcMap.get(phrase) ?? {
        count: 0,
        subIds: new Set<string>(),
      };
      cell.count += 1;
      cell.subIds.add(ent.parent_sub_objective_id);
      rcMap.set(phrase, cell);
    }
  }

  // ── 3. Lens convergence (across items) ─────────────────────────
  // entities.causal_chain.derived_from_annotations[] is the persisted
  // provenance (see layered-generation.ts). Same annotation phrase
  // across ≥2 rooms = the lens reading is structurally load-bearing
  // across the user's strategy. We use the persisted phrase (not the
  // index) because indices are tied to the lens at generation time;
  // phrase comparison is robust to lens reshuffles.
  const lensMap = new Map<
    string,
    { phrase: string; count: number; subIds: Set<string> }
  >();
  for (const ent of entities) {
    const cc = (ent.causal_chain ?? {}) as Record<string, unknown>;
    const provRaw = cc.derived_from_annotations;
    if (!Array.isArray(provRaw)) continue;
    for (const p of provRaw as unknown[]) {
      if (!p || typeof p !== "object") continue;
      const r = p as Record<string, unknown>;
      const phrase = typeof r.phrase === "string" ? r.phrase.trim() : "";
      if (phrase.length === 0) continue;
      const key = phrase.toLowerCase();
      const cell = lensMap.get(key) ?? {
        phrase,
        count: 0,
        subIds: new Set<string>(),
      };
      cell.count += 1;
      cell.subIds.add(ent.parent_sub_objective_id);
      lensMap.set(key, cell);
    }
  }

  function materialize<
    T extends { count: number; subIds: Set<string>; phrase?: string },
  >(
    map: Map<string, T>,
    labelFromKey: (key: string, cell: T) => string,
  ): CrossRoomSignal[] {
    const out: CrossRoomSignal[] = [];
    for (const [key, cell] of map.entries()) {
      if (cell.subIds.size < 2) continue; // cross-ROOM only
      const ids = Array.from(cell.subIds);
      out.push({
        label: labelFromKey(key, cell),
        sub_objective_ids: ids,
        sub_objective_titles: ids.map((id) => titleById.get(id) ?? "?"),
        occurrence_count: cell.count,
      });
    }
    out.sort((a, b) => {
      // Sort by spread (more rooms = higher) then by total occurrence.
      if (b.sub_objective_ids.length !== a.sub_objective_ids.length) {
        return b.sub_objective_ids.length - a.sub_objective_ids.length;
      }
      return b.occurrence_count - a.occurrence_count;
    });
    return out.slice(0, 5);
  }

  return {
    mechanisms: materialize(mechMap, (key) => key),
    root_causes: materialize(rcMap, (key) => key),
    lens_convergence: materialize(lensMap, (_key, cell) => cell.phrase ?? ""),
  };
}
