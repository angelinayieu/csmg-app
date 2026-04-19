// ── Whiteboard layer configuration ──
//
// Maps our hierarchical layer vocabulary to the L0-L4 visual scheme from the
// design mockup. System/domain/thread from hierarchical decomposition become
// L0/L1/L2; claims and atoms (not yet in the backend) are reserved as L3/L4.
// Flat entities (no layer) default to L2 so they don't disappear.

export type LayerId = "L0" | "L1" | "L2" | "L3" | "L4";

export interface LayerConfig {
  id: LayerId;
  label: string;
  shortLabel: string;
  // Main color used for borders, chips, accents
  color: string;
  // Background tint for chips / subtle fills
  bg: string;
  // Border color for chips
  border: string;
  // Cluster-zone background (very soft)
  zone: string;
  // Hero-tier gradient (used as node background for tier=hero)
  heroGradient: string;
  // Tailwind text color class for hero-tier layer tag text
  heroTagBg: string;
}

export const LAYERS: Record<LayerId, LayerConfig> = {
  L0: {
    id: "L0",
    label: "Systems · Macro",
    shortLabel: "L0",
    color: "#0051ff",
    bg: "rgba(0, 81, 255, 0.08)",
    border: "rgba(0, 81, 255, 0.28)",
    zone: "rgba(0, 81, 255, 0.08)",
    heroGradient: "linear-gradient(145deg, #0a1020 0%, #0d1f5a 30%, #1a4fd6 70%, #2d7cff 100%)",
    heroTagBg: "rgba(255,255,255,0.18)",
  },
  L1: {
    id: "L1",
    label: "Domains · Core",
    shortLabel: "L1",
    color: "#1a7aff",
    bg: "rgba(26, 122, 255, 0.07)",
    border: "rgba(26, 122, 255, 0.25)",
    zone: "rgba(26, 122, 255, 0.07)",
    heroGradient: "linear-gradient(145deg, #0a1428 0%, #0d3570 30%, #1a7aff 100%)",
    heroTagBg: "rgba(255,255,255,0.18)",
  },
  L2: {
    id: "L2",
    label: "Threads · Mechanism",
    shortLabel: "L2",
    color: "#5856d6",
    bg: "rgba(88, 86, 214, 0.07)",
    border: "rgba(88, 86, 214, 0.25)",
    zone: "rgba(88, 86, 214, 0.06)",
    heroGradient: "linear-gradient(145deg, #1a1040 0%, #3730a3 40%, #5856d6 100%)",
    heroTagBg: "rgba(255,255,255,0.18)",
  },
  L3: {
    id: "L3",
    label: "Property · Detail",
    shortLabel: "L3",
    color: "#af52de",
    bg: "rgba(175, 82, 222, 0.07)",
    border: "rgba(175, 82, 222, 0.25)",
    zone: "rgba(175, 82, 222, 0.06)",
    heroGradient: "linear-gradient(145deg, #2a1040 0%, #6b21a8 40%, #af52de 100%)",
    heroTagBg: "rgba(255,255,255,0.18)",
  },
  L4: {
    id: "L4",
    label: "Atomic Unit",
    shortLabel: "L4",
    color: "#ff9500",
    bg: "rgba(255, 149, 0, 0.07)",
    border: "rgba(255, 149, 0, 0.28)",
    zone: "rgba(255, 149, 0, 0.06)",
    heroGradient: "linear-gradient(145deg, #3a2000 0%, #92400e 40%, #ff9500 100%)",
    heroTagBg: "rgba(255,255,255,0.18)",
  },
};

export const LAYER_ORDER: LayerId[] = ["L0", "L1", "L2", "L3", "L4"];

// ── Phase 10: canonical depth system ──────────────────────────────────
//
// `entity.depth` is the source of truth (integer 0..4). `entity.layer` is
// a semantic label that co-varies with depth. Use the converters below
// both at write-time (sanitize) and read-time (any consumer that needs
// visual depth).

/** Canonical semantic labels per depth. Keep in sync with migration. */
export const CANONICAL_LAYER_NAMES = [
  "system", // 0
  "domain", // 1
  "thread", // 2
  "claim", // 3
  "atom", // 4
] as const;

export type CanonicalLayerName = (typeof CANONICAL_LAYER_NAMES)[number];

export const LAYER_TO_DEPTH: Record<string, number> = {
  system: 0,
  domain: 1,
  thread: 2,
  claim: 3,
  property: 3, // legacy alias
  atom: 4,
  atomic: 4,
};

/** Coerce any inbound layer string into a canonical label + integer depth. */
export function normalizeLayer(
  raw: string | null | undefined,
  knowledgeLayer?: string | null,
): { layer: CanonicalLayerName; depth: number } {
  const l = (raw ?? "").toLowerCase().trim();
  if (l in LAYER_TO_DEPTH) {
    const depth = LAYER_TO_DEPTH[l];
    return { layer: CANONICAL_LAYER_NAMES[depth], depth };
  }
  // Fallback: infer depth from knowledge_layer
  const kl = (knowledgeLayer ?? "").toLowerCase().trim();
  if (kl === "conceptual") return { layer: "domain", depth: 1 };
  if (kl === "external") return { layer: "claim", depth: 3 };
  if (kl === "bridge") return { layer: "thread", depth: 2 };
  return { layer: "thread", depth: 2 };
}

/** Depth → LayerId (visual). */
export function depthToLayerId(depth: number): LayerId {
  const clamped = Math.max(0, Math.min(4, Math.round(depth)));
  return LAYER_ORDER[clamped];
}

/** Depth → canonical semantic name. */
export function depthToLayerName(depth: number): CanonicalLayerName {
  const clamped = Math.max(0, Math.min(4, Math.round(depth)));
  return CANONICAL_LAYER_NAMES[clamped];
}

/** Compute the *target* depth when decomposing a parent one level down. */
export function nextDepth(parentDepth: number): number {
  return Math.min(4, (parentDepth ?? 2) + 1);
}

/**
 * Map an entity to its LayerId. Prefers the authoritative integer `depth`
 * field; falls back to the legacy `layer` string for entities that
 * pre-date the Phase 10 migration in-memory.
 */
export function entityToLayerId(entity: {
  layer?: string | null;
  depth?: number | null;
  knowledge_layer?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entity_category?: any;
}): LayerId {
  // Fault entities always render as L2 (mid-graph) so they're visually
  // prominent but not layout-breaking at the top.
  if ((entity.entity_category as string) === "fault") return "L2";

  // Primary: authoritative integer depth
  if (typeof entity.depth === "number") return depthToLayerId(entity.depth);

  // Fallback: derive from legacy layer string
  return depthToLayerId(normalizeLayer(entity.layer, entity.knowledge_layer).depth);
}

/** Read the integer depth from any entity-shaped object with robust fallbacks. */
export function entityToDepth(entity: {
  layer?: string | null;
  depth?: number | null;
  knowledge_layer?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entity_category?: any;
}): number {
  if ((entity.entity_category as string) === "fault") return 2;
  if (typeof entity.depth === "number") return entity.depth;
  return normalizeLayer(entity.layer, entity.knowledge_layer).depth;
}

/**
 * Layer-to-row mapping for the overview layout. L0 at top, L4 at bottom.
 * Returns a y-coordinate (in canvas pixels) that the layout engine should
 * place nodes of this layer around.
 */
export function layerRowY(layerId: LayerId, bandHeight: number = 220): number {
  const idx = LAYER_ORDER.indexOf(layerId);
  return idx * bandHeight;
}
