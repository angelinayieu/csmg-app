// ── build-subsystem-modules ───────────────────────────────────────
//
// Pure transform for the re-altitude'd room "Subsystems" tab: each
// LEVER (a mechanism = a `features`-lane item) becomes a SUBSYSTEM
// MODULE that previews its internal data-flow, and the modules are
// wired to each other by DETERMINISTIC shared-data-token edges.
//
// Why deterministic token matching (not the existing cross_feature
// edges): `compile-agent-build-spec.ts` `data_flow.cross_feature` is
// LLM-emitted and "may carry phantom references" (see
// derive-depends-on.ts). Here we match each lever's
// `runtime_flow[].produces` against another lever's `consumes` — a
// fact derivable straight from the stored MechanismSpec, with no LLM
// call and no new generation. This is the rigorous "how levers
// interlock" axis the causal-flow Map deliberately drops (the Map
// draws only problem→mechanism→result flow, never lever↔lever).
//
// We REUSE deriveDependsOn + topologicalBuildOrder from
// derive-depends-on.ts for the per-module upstream lists and the
// left→right depth layout, keyed by lever id (the helpers treat the
// key as opaque, so ids avoid name collisions).

import type {
  RoomLane,
  LayerItem,
} from "@/components/objective/sub-objective-room-view";
import type { RoomCategories } from "@/lib/objective-canvas/generate-categories";
import type { MechanismSpec } from "@/lib/objective-canvas/enrich-mechanism-spec";
import {
  deriveDependsOn,
  topologicalBuildOrder,
} from "@/lib/objective-canvas/derive-depends-on";

interface EdgeLike {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  conditions?: string | null;
}

// Mirrors the mechanism-family palette so modules read as variations
// of one "mechanism" identity (matches build-mechanism-subsystems).
const SUBSYSTEM_PALETTE = ["#2563EB", "#7C3AED", "#0E7490", "#4338CA", "#1D4ED8", "#0D9488"];
const UNCATEGORIZED = "__uncat";

export interface SubsystemGroup {
  id: string;
  label: string;
  /** Accent hex (#rrggbb). */
  color: string;
}

export interface SubsystemModuleSpec {
  /** Lever entity id. */
  id: string;
  name: string;
  /** SubsystemGroup.id this module belongs to (sub_category). */
  subsystem: string;
  /** False when no mechanism_spec has been generated → render a
   *  "not yet specified" placeholder instead of a flow preview. */
  hasSpec: boolean;
  /** ≤1-line causal summary (mechanism_of_action), preview only. */
  mechanismOfAction: string | null;
  /** Logic-model inputs (free-text), distinct from typed tokens. */
  inputs: string[];
  /** runtime_flow step count — the internal-algorithm length. */
  stepCount: number;
  /** What the user ends up seeing — the result this lever drives. */
  outcome: string | null;
  /** Typed tokens this lever EMITS (union of runtime_flow.produces). */
  produces: string[];
  /** Typed tokens this lever REQUIRES (union of runtime_flow.consumes). */
  consumes: string[];
  /** Upstream lever ids (derived from token wiring). */
  dependsOn: string[];
  /** Longest-path depth for left→right layout (roots = 0). */
  depth: number;
  /** Consumed tokens no other lever produces — the module's external
   *  inputs (trace to problems / data sources, not another lever). */
  externalInputs: string[];
}

/** Directional A→B: A produces tokens that B consumes. */
export interface TokenWire {
  from: string;
  to: string;
  tokens: string[];
}

/** Symmetric conflict (interferes_with) — kept for the insight strip. */
export interface ConflictEdge {
  a: string;
  b: string;
  rationale: string | null;
}

export interface SubsystemModulesModel {
  modules: SubsystemModuleSpec[];
  groups: SubsystemGroup[];
  wires: TokenWire[];
  conflicts: ConflictEdge[];
  /** System-level inputs: consumed by some lever, produced by none. */
  externalInputTokens: string[];
  /** System-level outputs: produced by some lever, consumed by none. */
  terminalTokens: string[];
  /** Full spec per lever id (only levers that have one) — lets the
   *  view expand a module into the existing MechanismDataflowView
   *  without re-reading expanded_detail. */
  specsById: Record<string, MechanismSpec>;
}

function pickString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** Tolerant token cleaner — trims, drops empties, dedupes. */
function tokens(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const t of raw) {
    if (typeof t === "string") {
      const s = t.trim();
      if (s) out.add(s);
    }
  }
  return [...out];
}

function readSpec(item: LayerItem): MechanismSpec | null {
  const blob = item.expanded_detail as Record<string, unknown> | null;
  const spec = blob?.mechanism_spec;
  return spec && typeof spec === "object" ? (spec as MechanismSpec) : null;
}

export function buildSubsystemModules(input: {
  lanes: RoomLane[];
  edges: EdgeLike[];
  roomCategories: RoomCategories;
}): SubsystemModulesModel {
  const features = input.lanes.find((l) => l.slug === "features")?.items ?? [];
  const featureIds = new Set(features.map((f) => f.id));

  const labelForSub = (slug: string): string =>
    slug === UNCATEGORIZED
      ? "Other mechanisms"
      : input.roomCategories.mechanism?.find((c) => c.slug === slug)?.label ??
        "Other mechanisms";

  const specsById: Record<string, MechanismSpec> = {};
  for (const f of features) {
    const s = readSpec(f);
    if (s) specsById[f.id] = s;
  }

  // ── 1. One module per lever, with its internal-flow preview + tokens.
  const modules: SubsystemModuleSpec[] = features.map((f) => {
    const cc = f.causal_chain as Record<string, unknown> | null;
    const spec = specsById[f.id] ?? null;
    const flow = Array.isArray(spec?.runtime_flow) ? spec!.runtime_flow : [];
    const produces = tokens(flow.flatMap((s) => s?.produces ?? []));
    const consumes = tokens(flow.flatMap((s) => s?.consumes ?? []));
    return {
      id: f.id,
      name: f.name,
      subsystem: pickString(cc, "sub_category") ?? UNCATEGORIZED,
      hasSpec: !!spec,
      mechanismOfAction: pickString(spec, "mechanism_of_action"),
      inputs: tokens(spec?.input_data),
      stepCount: flow.length,
      outcome: pickString(spec, "user_visible_behavior"),
      produces,
      consumes,
      dependsOn: [],
      depth: 0,
      externalInputs: [],
    };
  });

  // ── 2. Directional token wires: A.produces ∩ B.consumes (A ≠ B).
  const producedAnywhere = new Set<string>();
  const consumedAnywhere = new Set<string>();
  for (const m of modules) {
    m.produces.forEach((t) => producedAnywhere.add(t));
    m.consumes.forEach((t) => consumedAnywhere.add(t));
  }

  const wires: TokenWire[] = [];
  for (const a of modules) {
    if (a.produces.length === 0) continue;
    const aSet = new Set(a.produces);
    for (const b of modules) {
      if (b.id === a.id || b.consumes.length === 0) continue;
      const shared = b.consumes.filter((t) => aSet.has(t));
      if (shared.length > 0) wires.push({ from: a.id, to: b.id, tokens: shared });
    }
  }

  // ── 3. Per-module upstream lists + depth (REUSE derive-depends-on).
  // Keyed by lever id; the helpers treat the key as opaque.
  const depMap = deriveDependsOn(
    modules.map((m) => ({ name: m.id })),
    wires.map((w) => ({ from: w.from, to: w.to, data: w.tokens.join(",") })),
  );
  for (const m of modules) m.dependsOn = depMap.get(m.id) ?? [];

  const order = topologicalBuildOrder(
    modules.map((m) => ({ name: m.id, depends_on: m.dependsOn })),
  );
  const depthById = new Map<string, number>();
  for (const id of order) {
    const m = modules.find((x) => x.id === id);
    const ups = m?.dependsOn ?? [];
    const d = ups.length
      ? 1 + Math.max(...ups.map((u) => depthById.get(u) ?? 0))
      : 0;
    depthById.set(id, d);
  }
  for (const m of modules) {
    m.depth = depthById.get(m.id) ?? 0;
    // External inputs: tokens this lever consumes that NO lever produces.
    m.externalInputs = m.consumes.filter((t) => !producedAnywhere.has(t));
  }

  // ── 4. Subsystem groups (sub_category) in first-appearance order.
  const groupOrder: string[] = [];
  for (const m of modules) if (!groupOrder.includes(m.subsystem)) groupOrder.push(m.subsystem);
  const groups: SubsystemGroup[] = groupOrder.map((slug, i) => ({
    id: slug,
    label: labelForSub(slug),
    color: SUBSYSTEM_PALETTE[i % SUBSYSTEM_PALETTE.length],
  }));

  // ── 5. Conflicts (interferes_with) — symmetric, kept for the strip.
  const conflicts: ConflictEdge[] = input.edges
    .filter(
      (e) =>
        e.relationship_type === "interferes_with" &&
        featureIds.has(e.source_entity_id) &&
        featureIds.has(e.target_entity_id),
    )
    .map((e) => ({
      a: e.source_entity_id,
      b: e.target_entity_id,
      rationale: typeof e.conditions === "string" ? e.conditions : null,
    }));

  const externalInputTokens = [...consumedAnywhere].filter((t) => !producedAnywhere.has(t));
  const terminalTokens = [...producedAnywhere].filter((t) => !consumedAnywhere.has(t));

  return { modules, groups, wires, conflicts, externalInputTokens, terminalTokens, specsById };
}
