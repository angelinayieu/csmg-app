// ── Conceptual-strength scoring + ruthless pruning ───────────────────
//
// "Surface the conceptually-strong thing, not noise — as simple as possible."
//
// The problem with ranking on a single LLM self-score: those scores cluster
// (everything lands 70–85), so rank-1 isn't reliably stronger than rank-5. We
// fix that by combining the model judgment with STRUCTURE — a concept that many
// others depend on (high graph centrality) is load-bearing — plus a novelty
// bonus and a generic-language penalty. Then we PRUNE to an apex + a small
// budget and collapse the rest, so the surface stays as legible as a hand-drawn
// pill map.
//
// CLIENT-SAFE: pure functions, no imports. Reused by the pill-map renderer (and,
// later, the live board surface).

export interface PillNode {
  id: string;
  /** Full phrase — shown on hover + in the detail panel, NOT on the pill. */
  label: string;
  /** 1–2 word KEYWORD shown ON the pill (the building-block face). Falls back
   *  to a derived keyword from `label` when absent. Never truncated with "…". */
  keyword?: string;
  /** object_type (leverage_point | first_principle | variable | …). */
  type: string;
  /** 0–100 rubric/rank score (the LLM judgment), if any. */
  score?: number;
  /** Everything else lives here — rendered ONLY in the click-through, never on
   *  the pill. Keeps the surface to a label. */
  meta?: Record<string, string | number>;
}

export interface PillEdge {
  source: string;
  target: string;
  relation?: string;
}

export interface ScoredPill extends PillNode {
  /** Edges touching this node. */
  degree: number;
  /** degree / maxDegree, 0–1. */
  centrality: number;
  /** 1 − max label-overlap with any sibling, 0–1. */
  novelty: number;
  /** 1 when the label reads as generic boilerplate, else 0. */
  generic: number;
  /** Composite 0–100 — the signal-vs-noise metric. */
  strength: number;
}

/** Strength weights. Judgment + structure dominate; novelty nudges; generic
 *  language is penalized hard (it's the signature of noise). */
export const STRENGTH_WEIGHTS = {
  score: 0.5,
  centrality: 0.4,
  novelty: 0.1,
  genericPenalty: 0.3,
} as const;

/** Boilerplate that signals a low-information ("noise") concept. */
const GENERIC_PHRASES = [
  "user friendly",
  "user-friendly",
  "high quality",
  "high-quality",
  "easy to use",
  "seamless",
  "intuitive",
  "robust",
  "scalable",
  "innovative",
  "cutting edge",
  "cutting-edge",
  "world class",
  "world-class",
  "best in class",
  "best-in-class",
  "powerful",
  "flexible",
  "beautiful ui",
  "great ux",
];

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Compute centrality + novelty + generic + composite strength for every node. */
export function scoreGraph(nodes: PillNode[], edges: PillEdge[]): ScoredPill[] {
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    if (degree.has(e.source)) degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    if (degree.has(e.target)) degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const maxDeg = Math.max(1, ...nodes.map((n) => degree.get(n.id) ?? 0));
  const tok = new Map(nodes.map((n) => [n.id, tokenize(n.label)]));

  return nodes.map((n) => {
    const deg = degree.get(n.id) ?? 0;
    const centrality = deg / maxDeg;
    let maxSim = 0;
    for (const m of nodes) {
      if (m.id === n.id) continue;
      maxSim = Math.max(maxSim, jaccard(tok.get(n.id)!, tok.get(m.id)!));
    }
    const novelty = 1 - maxSim;
    const lower = n.label.toLowerCase();
    const generic = GENERIC_PHRASES.some((g) => lower.includes(g)) ? 1 : 0;
    const scoreNorm =
      typeof n.score === "number" ? Math.max(0, Math.min(100, n.score)) / 100 : 0.5;

    const raw =
      STRENGTH_WEIGHTS.score * scoreNorm +
      STRENGTH_WEIGHTS.centrality * centrality +
      STRENGTH_WEIGHTS.novelty * novelty -
      STRENGTH_WEIGHTS.genericPenalty * generic;
    const strength = Math.round(Math.max(0, Math.min(1, raw)) * 100);

    return { ...n, degree: deg, centrality, novelty, generic, strength };
  });
}

export interface PrunedGraph {
  /** The single strongest concept — the gravitational center. */
  apex: ScoredPill | null;
  /** Apex + the next strongest, up to `budget` total. */
  visible: ScoredPill[];
  /** Everything below the budget — hidden behind a "+N" pill. */
  collapsed: ScoredPill[];
}

/** Sort by strength, keep an apex + the strongest `budget`-1 others, collapse
 *  the rest. `budget` = total visible pills (incl. apex). */
export function pruneGraph(scored: ScoredPill[], budget = 6): PrunedGraph {
  const sorted = [...scored].sort((a, b) => b.strength - a.strength);
  if (sorted.length === 0) return { apex: null, visible: [], collapsed: [] };
  const cap = Math.max(1, budget);
  return {
    apex: sorted[0],
    visible: sorted.slice(0, cap),
    collapsed: sorted.slice(cap),
  };
}
