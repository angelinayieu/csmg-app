// ── Objective Layer Model ─────────────────────────────────────────
//
// Phase 11.A — types + helpers for the causal-stack decomposition
// of an objective. Each objective decomposes into 4-6 layers from
// foundational substrate (Layer 1) to emergent outcome (Layer N).
// Layers carry variables (the substantive content) + cross-layer
// influences (the causal arrows that connect adjacent or skip layers).
//
// Persistence:
//   spaces.synthesis_data.objective_canvas.layers : ObjectiveStack
//   improvement_goals.layer_ordinals : integer[] — which layer(s) the sub-obj touches
//   improvement_goals.layer_position_label : text — human-readable chip
//
// Why JSONB (not a new table for layers): layers are immutable-ish
// per generation and always read alongside synthesis_data. Adding a
// `layers` table would force a join on every canvas read. Keeping the
// stack inside synthesis_data colocates it with the data that derives
// from it (sub-objectives, room categories, cross-room state).
//
// Why integer ordinals for layer references: integers are queryable
// from Postgres (GIN index on layer_ordinals[]) without unmarshalling
// JSONB. Slug refs (e.g., "L3") would force string parsing for every
// cross-layer query.

/** Domain templates the decomposer picks from. The LLM chooses ONE
 *  based on the objective text + clarifying answers. Each template
 *  biases toward domain-appropriate layer names and variable
 *  vocabulary, but the LLM still fills in the actual content per
 *  the specific objective. */
export type LayerDomainTemplate =
  | "software"          // L1 Infra → L2 Data → L3 Logic → L4 Interface → L5 UX
  | "cognition_health"  // L1 Foundational → L2 Biological → L3 Cognitive → L4 Behavioral → L5 Outcome
  | "business_ops"      // L1 Tactical → L2 Operational → L3 Strategic → L4 Executive → L5 Market
  | "behavior_change"   // L1 Environment → L2 Triggers → L3 Routine → L4 Goal → L5 Identity
  | "scientific"        // L1 Foundations → L2 Mechanism → L3 Phenomenon → L4 Application → L5 Impact
  | "generic";          // L1 Substrate → L2 Mechanism → L3 Process → L4 Output → L5 Outcome

/** Verbs describing how layers connect causally. The decomposer
 *  picks ONE per influence pair. UI surfaces these as the arrow
 *  labels between layers. */
export type LayerInfluenceVerb =
  | "enables"     // L_n → L_(n+1) via compositional enabling
  | "produces"    // L_n → L_(n+1) as output (L_n's state → L_(n+1)'s state)
  | "depends_on"  // L_n → L_(n-1) substrate dependency (read upward)
  | "constrains"  // L_(n+1) → L_n top-down constraint
  | "measures"    // L_top → L_(n) measurement / observation closure
  | "aggregates"; // L_(n+1) aggregates signals from L_n

/** Archetype tag on each layer — used by chain enrichment (Phase 11.4)
 *  to annotate cross-layer movements in the agent_feedback narrative.
 *  Substrate is rarely directly user-actionable; mechanism is the
 *  intervention layer; process is the workflow; output is the
 *  measured signal; outcome is the strategic target. */
export type LayerArchetype =
  | "substrate"
  | "mechanism"
  | "process"
  | "output"
  | "outcome";

/** Position descriptor for a sub-objective on the stack. Computed by
 *  the layer-tagging pass on the proposer; rendered as the
 *  layer_position_label chip on the sub-objective card. */
export type LayerPositionShape =
  | "direct"       // single-layer (most common at L1, L2, L_top)
  | "bridge"       // spans 2 adjacent layers
  | "span"         // spans 2 non-adjacent layers
  | "cross_stack"; // touches ≥3 layers (rare)

export interface LayerVariable {
  /** Stable snake_case slug, e.g., "sleep_cycles". */
  id: string;
  /** Display name in the user's domain vocabulary. */
  name: string;
  /** 1-2 sentence definition. Surfaces in the variable popover when
   *  the user clicks a variable chip on the stack. */
  description: string;
  /** Optional grouping label inside the layer (e.g., "biological").
   *  Used for visual sub-clustering when a layer has 5-7 variables. */
  domain_tag?: string;
}

export interface LayerCrossInfluence {
  /** Source layer ordinal (1-based; matches ObjectiveLayer.ordinal). */
  from_layer: number;
  /** Target layer ordinal. */
  to_layer: number;
  /** Causal verb describing the relationship. */
  verb: LayerInfluenceVerb;
  /** Optional 1-sentence rationale — surfaces on hover of the
   *  arrow between layers on the stack widget. */
  rationale?: string;
}

export interface ObjectiveLayer {
  /** Stable id, e.g., "L3". Used as layer_position_label segment. */
  id: string;
  /** 1-based ordinal — matches integer[] entries on
   *  improvement_goals.layer_ordinals. Stack renders bottom-up:
   *  ordinal 1 at bottom, N at top. */
  ordinal: number;
  /** Domain-specific layer name, e.g., "Cognitive States". */
  name: string;
  /** 1-sentence layer description. */
  description: string;
  /** Archetype tag — drives chain-enrichment narrative phrasing. */
  archetype: LayerArchetype;
  /** 3-7 variables that operate at this layer. */
  variables: LayerVariable[];
}

export interface ObjectiveStack {
  /** Template the decomposer selected. */
  domain_template: LayerDomainTemplate;
  /** 1-2 sentence rationale for the template choice. Surfaces as
   *  the tooltip on the stack widget's template badge. */
  template_rationale: string;
  /** Layers ordered by ordinal ascending (1 = bottom). */
  layers: ObjectiveLayer[];
  /** Cross-layer influences. Adjacent pairs (L_n → L_(n+1)) most
   *  common; long-range ones (L_1 → L_top "measures") used sparingly. */
  influences: LayerCrossInfluence[];
  /** ISO timestamp of when this stack was generated. */
  generated_at: string;
  /** State-hash for staleness detection. Derived from objective_text
   *  + clarifying_answers content; when either changes, hash changes,
   *  stack is stale → user can regenerate. */
  state_hash: string;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Compute a layer position label from ordinals.
 *  Single-layer:  "L3 · Direct"
 *  Adjacent pair: "L2→L3 · Bridge"
 *  Non-adjacent:  "L1+L4 · Span"
 *  ≥3 layers:     "Cross-stack" */
export function computeLayerPositionLabel(
  ordinals: number[],
): string {
  const sorted = [...new Set(ordinals)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return `L${sorted[0]} · Direct`;
  if (sorted.length === 2) {
    const [a, b] = sorted;
    if (b - a === 1) return `L${a}→L${b} · Bridge`;
    return `L${a}+L${b} · Span`;
  }
  return `Cross-stack (L${sorted.join(",L")})`;
}

/** Derive position shape from ordinals — used by analytics + the
 *  Stack widget's visual treatment per shape. */
export function computeLayerPositionShape(
  ordinals: number[],
): LayerPositionShape {
  const sorted = [...new Set(ordinals)].sort((a, b) => a - b);
  if (sorted.length <= 1) return "direct";
  if (sorted.length === 2) {
    return sorted[1] - sorted[0] === 1 ? "bridge" : "span";
  }
  return "cross_stack";
}

/** Validate raw LLM output into a typed ObjectiveStack. Soft-fails to
 *  null when the structure is too broken to use; lossy-cleans common
 *  edge cases (out-of-range ordinals, missing rationale, dupe variables)
 *  rather than throwing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeObjectiveStack(raw: any): ObjectiveStack | null {
  if (!raw || typeof raw !== "object") return null;
  const domain_template = isLayerDomainTemplate(raw.domain_template)
    ? raw.domain_template
    : "generic";
  const template_rationale =
    typeof raw.template_rationale === "string"
      ? raw.template_rationale.trim().slice(0, 400)
      : "";
  const layersRaw = Array.isArray(raw.layers) ? raw.layers : [];
  if (layersRaw.length < 4 || layersRaw.length > 6) {
    // Per system-prompt hard floor/ceiling — refuse rather than
    // silently accept a malformed stack.
    return null;
  }
  const layers: ObjectiveLayer[] = [];
  for (let i = 0; i < layersRaw.length; i++) {
    const l = layersRaw[i];
    if (!l || typeof l !== "object") continue;
    const ordinal =
      typeof l.ordinal === "number" && Number.isFinite(l.ordinal)
        ? Math.round(l.ordinal)
        : i + 1;
    if (ordinal < 1 || ordinal > 6) continue;
    const name =
      typeof l.name === "string" && l.name.trim().length > 0
        ? l.name.trim().slice(0, 60)
        : `Layer ${ordinal}`;
    const description =
      typeof l.description === "string"
        ? l.description.trim().slice(0, 400)
        : "";
    const archetype: LayerArchetype = isLayerArchetype(l.archetype)
      ? l.archetype
      : "mechanism";
    const variablesRaw = Array.isArray(l.variables) ? l.variables : [];
    const seenIds = new Set<string>();
    const variables: LayerVariable[] = [];
    for (const v of variablesRaw) {
      if (!v || typeof v !== "object") continue;
      const vname =
        typeof v.name === "string" ? v.name.trim().slice(0, 80) : "";
      const vid =
        typeof v.id === "string" && v.id.trim().length > 0
          ? v.id
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_]+/g, "_")
              .slice(0, 60)
          : vname
              .toLowerCase()
              .replace(/[^a-z0-9_]+/g, "_")
              .slice(0, 60);
      if (!vid || !vname || seenIds.has(vid)) continue;
      seenIds.add(vid);
      const vdesc =
        typeof v.description === "string"
          ? v.description.trim().slice(0, 320)
          : "";
      const vdomain =
        typeof v.domain_tag === "string" && v.domain_tag.trim().length > 0
          ? v.domain_tag.trim().slice(0, 40)
          : undefined;
      variables.push({
        id: vid,
        name: vname,
        description: vdesc,
        ...(vdomain ? { domain_tag: vdomain } : {}),
      });
      if (variables.length >= 7) break; // hard cap
    }
    if (variables.length < 1) continue; // skip empty layers
    layers.push({
      id: `L${ordinal}`,
      ordinal,
      name,
      description,
      archetype,
      variables,
    });
  }
  if (layers.length < 4 || layers.length > 6) return null;
  // Ensure ordinals are contiguous 1..N after dedupe
  layers.sort((a, b) => a.ordinal - b.ordinal);
  for (let i = 0; i < layers.length; i++) {
    layers[i].ordinal = i + 1;
    layers[i].id = `L${i + 1}`;
  }
  const ordinalSet = new Set(layers.map((l) => l.ordinal));
  const influences: LayerCrossInfluence[] = [];
  const seenInfluence = new Set<string>();
  for (const inf of Array.isArray(raw.influences) ? raw.influences : []) {
    if (!inf || typeof inf !== "object") continue;
    const from_layer =
      typeof inf.from_layer === "number" ? Math.round(inf.from_layer) : NaN;
    const to_layer =
      typeof inf.to_layer === "number" ? Math.round(inf.to_layer) : NaN;
    if (!ordinalSet.has(from_layer) || !ordinalSet.has(to_layer)) continue;
    if (from_layer === to_layer) continue;
    const verb: LayerInfluenceVerb = isLayerInfluenceVerb(inf.verb)
      ? inf.verb
      : "enables";
    const key = `${from_layer}>${to_layer}:${verb}`;
    if (seenInfluence.has(key)) continue;
    seenInfluence.add(key);
    const rationale =
      typeof inf.rationale === "string" && inf.rationale.trim().length > 0
        ? inf.rationale.trim().slice(0, 240)
        : undefined;
    influences.push({
      from_layer,
      to_layer,
      verb,
      ...(rationale ? { rationale } : {}),
    });
  }
  return {
    domain_template,
    template_rationale,
    layers,
    influences,
    generated_at: new Date().toISOString(),
    state_hash: "", // caller computes — keeps the validator pure
  };
}

// ── Type guards (defensive against malformed LLM output) ─────────

function isLayerDomainTemplate(v: unknown): v is LayerDomainTemplate {
  return (
    typeof v === "string" &&
    (
      [
        "software",
        "cognition_health",
        "business_ops",
        "behavior_change",
        "scientific",
        "generic",
      ] as const
    ).includes(v as LayerDomainTemplate)
  );
}

function isLayerArchetype(v: unknown): v is LayerArchetype {
  return (
    typeof v === "string" &&
    (
      ["substrate", "mechanism", "process", "output", "outcome"] as const
    ).includes(v as LayerArchetype)
  );
}

function isLayerInfluenceVerb(v: unknown): v is LayerInfluenceVerb {
  return (
    typeof v === "string" &&
    (
      [
        "enables",
        "produces",
        "depends_on",
        "constrains",
        "measures",
        "aggregates",
      ] as const
    ).includes(v as LayerInfluenceVerb)
  );
}
