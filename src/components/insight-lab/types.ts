// ── Insight Lab UI types ──────────────────────────────────────────────
//
// UI-only types shared across the lab page components. Visual metadata
// (icons, colors) lives here so each component doesn't redefine the
// same color tables. Domain types come from src/lib/insight-lab/types.ts.

import {
  Network,
  GitBranch,
  AlertTriangle,
  RefreshCcw,
  Layers,
  Zap,
  GitMerge,
  Triangle,
  type LucideIcon,
} from "lucide-react";
import type { LabInsightEmittedEvent } from "@/types/pipeline-events";

export type InsightKind = LabInsightEmittedEvent["kind"];

/** Category groupings for the algorithm palette. */
export type AlgoCategoryUI = "structural" | "semantic" | "hybrid";

/** Static UI catalog entry. The `registered: true` ones map 1-1 to
 *  src/lib/insight-lab/registry.ts entries; `false` are advertised as
 *  "soon" so users see the future scope. */
export interface AlgoCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: AlgoCategoryUI;
  complexity: string;
  registered: boolean;
}

/** Full UI catalog — single source of truth for the palette. Every
 *  entry with `registered: true` MUST exist in src/lib/insight-lab/
 *  registry.ts; the type system catches the runtime mismatch the
 *  first time you try to add it to a stack. */
export const ALGO_CATALOG: AlgoCatalogEntry[] = [
  // ── Structural ──
  {
    id: "preliminary-insights",
    name: "Preliminary insights",
    description: "Hubs, bridges, isolated clusters, feedback loops",
    category: "structural",
    complexity: "O(n²)",
    registered: true,
  },
  {
    id: "communities",
    name: "Communities (label propagation)",
    description: "Cluster the graph + modularity Q score",
    category: "structural",
    complexity: "O(iter·m)",
    registered: false,
  },
  {
    id: "cascades",
    name: "Cascades",
    description: "Multi-hop downstream from leverage / risk points",
    category: "structural",
    complexity: "O(seeds·n)",
    registered: false,
  },
  {
    id: "pagerank",
    name: "PageRank",
    description: "Recursive importance — most influential nodes",
    category: "structural",
    complexity: "O(iter·m)",
    registered: false,
  },
  {
    id: "betweenness",
    name: "Betweenness centrality",
    description: "Brokers on many shortest paths",
    category: "structural",
    complexity: "O(n·m)",
    registered: false,
  },
  {
    id: "k-core",
    name: "K-core decomposition",
    description: "Densely-connected core vs periphery",
    category: "structural",
    complexity: "O(n+m)",
    registered: false,
  },
  // ── Semantic ──
  {
    id: "goal-rank",
    name: "Goal-relevance rank",
    description: "Re-rank by cosine to your objective",
    category: "semantic",
    complexity: "1 embed",
    registered: false,
  },
  {
    id: "theme-clusters",
    name: "Theme clustering",
    description: "Embed entities → k-means → LLM names clusters",
    category: "semantic",
    complexity: "O(n·k)",
    registered: false,
  },
  {
    id: "llm-traverse",
    name: "LLM-guided traversal",
    description: "GraphRAG: LLM picks next neighbor",
    category: "semantic",
    complexity: "k LLM calls",
    registered: false,
  },
  // ── Hybrid ──
  {
    id: "goal-walks",
    name: "Goal-biased random walks",
    description: "Walks weighted by cosine to goal embedding",
    category: "hybrid",
    complexity: "O(walks·len)",
    registered: false,
  },
  {
    id: "ppr",
    name: "Personalized PageRank",
    description: "PageRank with goal-biased restart distribution",
    category: "hybrid",
    complexity: "O(iter·m)",
    registered: false,
  },
  {
    id: "counterfactual",
    name: "Counterfactual removal",
    description: "Re-run any algo with key node removed → diff insights",
    category: "hybrid",
    complexity: "varies",
  registered: false,
  },
];

// ── Visual metadata ──

export const KIND_META: Record<
  InsightKind,
  { icon: LucideIcon; label: string; ring: string; chip: string; bar: string }
> = {
  hub: {
    icon: Network,
    label: "Hub",
    ring: "ring-sky-200",
    chip: "bg-sky-50 text-sky-700",
    bar: "bg-sky-500",
  },
  bridge: {
    icon: GitBranch,
    label: "Bridge",
    ring: "ring-violet-200",
    chip: "bg-violet-50 text-violet-700",
    bar: "bg-violet-500",
  },
  cycle: {
    icon: RefreshCcw,
    label: "Cycle",
    ring: "ring-emerald-200",
    chip: "bg-emerald-50 text-emerald-700",
    bar: "bg-emerald-500",
  },
  cluster: {
    icon: AlertTriangle,
    label: "Cluster",
    ring: "ring-amber-200",
    chip: "bg-amber-50 text-amber-700",
    bar: "bg-amber-500",
  },
  community: {
    icon: Layers,
    label: "Community",
    ring: "ring-indigo-200",
    chip: "bg-indigo-50 text-indigo-700",
    bar: "bg-indigo-500",
  },
  cascade: {
    icon: Zap,
    label: "Cascade",
    ring: "ring-rose-200",
    chip: "bg-rose-50 text-rose-700",
    bar: "bg-rose-500",
  },
  pathway: {
    icon: GitMerge,
    label: "Pathway",
    ring: "ring-teal-200",
    chip: "bg-teal-50 text-teal-700",
    bar: "bg-teal-500",
  },
  tier: {
    icon: Triangle,
    label: "Tier",
    ring: "ring-slate-200",
    chip: "bg-slate-100 text-slate-700",
    bar: "bg-slate-500",
  },
};

export const CATEGORY_META: Record<
  AlgoCategoryUI,
  { label: string; tone: string; dot: string }
> = {
  structural: {
    label: "Structural",
    tone: "text-violet-600",
    dot: "bg-violet-500",
  },
  semantic: { label: "Semantic", tone: "text-teal-600", dot: "bg-teal-500" },
  hybrid: { label: "Hybrid", tone: "text-amber-600", dot: "bg-amber-500" },
};

export function scoreColor(score: number | null): string {
  if (score === null) return "bg-slate-300";
  if (score >= 0.8) return "bg-emerald-500";
  if (score >= 0.6) return "bg-sky-500";
  if (score >= 0.4) return "bg-amber-500";
  return "bg-slate-400";
}
