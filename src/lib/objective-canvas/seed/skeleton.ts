// ── Skeleton KG ──────────────────────────────────────────────────────
//
// Instant, cheap first-draft graph so the Map peek is never empty and the card
// can show "N concepts mapped" within ~1s of the objective landing — instead of
// the graph only appearing at the end (after the Crucible converges + enrich).
//
// One fast call (BEST_FAST_CLAUDE_MODEL, tiny budget) extracts the key concepts
// implied by the objective; the objective is the apex node, concepts hang off it.
// The REAL graph (assemble-seed) overwrites this on enrich — this is a placeholder
// that gives the surface motion. Soft-fails to a heuristic split so it's never
// blank. SERVER-ONLY.

import { llmJSON, BEST_FAST_CLAUDE_MODEL } from "@/lib/llm";
import type { SeedNode, SeedEdge } from "./seed-types";

const SKELETON_SCHEMA = {
  name: "skeleton_graph",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["concepts"],
    properties: {
      concepts: {
        type: "array",
        description: "5–8 key concepts the objective implies — the things a strategist would map first. Keyword form (1–3 words), not phrases.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["keyword", "type"],
          properties: {
            keyword: { type: "string", description: "1–3 word concept." },
            type: { type: "string", enum: ["lever", "constraint", "variable", "actor", "outcome"], description: "What kind of thing it is." },
          },
        },
      },
    },
  },
} as const;

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "node";

function heuristicConcepts(objective: string): { keyword: string; type: string }[] {
  // Last-resort: pull the longest distinct words so the map is never empty.
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "your", "our", "you", "are", "how", "what", "when", "will", "can", "make", "build", "want", "need", "more", "less", "than"]);
  const words = (objective.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !stop.has(w));
  const seen = new Set<string>();
  const out: { keyword: string; type: string }[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push({ keyword: w, type: "variable" });
    if (out.length >= 6) break;
  }
  return out;
}

const APEX_ID = "objective";

/** Build a placeholder reasoning graph from the raw objective. Never throws. */
export async function buildSkeletonGraph(
  objective: string,
): Promise<{ nodes: SeedNode[]; edges: SeedEdge[] }> {
  const obj = (objective || "").trim();
  if (!obj) return { nodes: [], edges: [] };

  let concepts: { keyword: string; type: string }[] = [];
  try {
    const res = await llmJSON<{ concepts?: { keyword?: string; type?: string }[] }>({
      system:
        "You are a strategist sketching the FIRST concepts an objective implies — a quick skeleton, not a full analysis. Return 5–8 concepts in KEYWORD form (1–3 words each). No sentences. Return the skeleton_graph tool only.",
      user: `OBJECTIVE\n${obj}\n\nList the key concepts (levers, constraints, variables, actors, outcomes) this objective is really about.`,
      provider: "anthropic",
      model: BEST_FAST_CLAUDE_MODEL,
      maxTokens: 700,
      temperature: 0.3,
      responseSchema: SKELETON_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    });
    concepts = (res?.concepts ?? [])
      .map((c) => ({ keyword: String(c?.keyword ?? "").trim().slice(0, 40), type: String(c?.type ?? "variable") }))
      .filter((c) => c.keyword);
  } catch (err) {
    console.warn("[skeleton] LLM failed (soft → heuristic):", err);
  }
  if (concepts.length === 0) concepts = heuristicConcepts(obj);

  const apexLabel = obj.length > 64 ? `${obj.slice(0, 61)}…` : obj;
  const nodes: SeedNode[] = [
    { id: APEX_ID, label: apexLabel, keyword: "objective", type: "objective", score: 100 },
  ];
  const edges: SeedEdge[] = [];
  const used = new Set<string>([APEX_ID]);
  for (const c of concepts) {
    let id = slug(c.keyword);
    while (used.has(id)) id = `${id}-2`;
    used.add(id);
    nodes.push({ id, label: c.keyword, keyword: c.keyword, type: c.type, score: 50 });
    edges.push({ source: APEX_ID, target: id, relation: "involves" });
  }
  return { nodes, edges };
}
