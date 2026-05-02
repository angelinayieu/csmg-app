// ── renderKgContext — Phase 1 prompt renderer ────────────────────
//
// Turns a `KgContext` (from buildKgContext) into prompt text the LLM
// reads as grounding. Five sections, each suppressed when empty:
//
//   1. ENTITIES + edges + claims (rich entity grouping — reuses the
//      existing format-kg-rich-context formatter for the entity body)
//   2. COMMUNITIES — GraphRAG-style cluster summaries (the killer
//      compression: a 30-entity cluster becomes one paragraph)
//   3. AXIOMS — load-bearing assumptions the analysis rests on
//   4. CONVERGENCES — post-synthesis cross-mechanism clusters
//   5. CONTEXT BUDGET — small footer the LLM can use to pace itself
//      ("you have ~3.2k tokens of grounding; reason densely")
//
// Why we re-export the entity body from the existing formatter
// instead of rewriting it: format-kg-rich-context already handles
// the dense per-entity prose (manifold, temporal, edge polarity,
// utility). Phase 1 ADDS sections; it doesn't rewrite them.

import { formatRichKgContextForStrategy } from "@/lib/pipeline/format-kg-rich-context";
import type { KgContext, RenderKgContextOpts } from "./types";
import type { Axiom, InsightConvergence } from "@/types/synthesis";

const DEFAULT_HEADER =
  "## Knowledge graph — grounding (use as facts; do not enumerate back)";

export function renderKgContext(
  ctx: KgContext,
  opts: RenderKgContextOpts = {},
): string {
  const suppressEmpty = opts.suppressEmpty !== false;
  const sections: string[] = [];

  // Header — task-specific framing if supplied; otherwise generic
  // "use as grounding" instruction.
  sections.push(opts.header ?? DEFAULT_HEADER);
  if (ctx.queryHint) {
    sections.push(`_Scoped to: ${ctx.queryHint.slice(0, 240)}_`);
  }
  sections.push("");

  // 1. Entity + edge + claim block (delegated to existing formatter).
  // Returns null when entities is empty; we propagate suppression.
  const entityBlock = formatRichKgContextForStrategy(
    ctx.primaryEntities,
    ctx.edges,
    ctx.claims,
    {
      maxEntities: ctx.primaryEntities.length, // don't re-cap
      maxEdgesPerEntity: 6, // we already pre-trimmed in fetcher
      maxClaimsPerEntity: 4,
    },
  );
  if (entityBlock) {
    sections.push(entityBlock);
  } else if (!suppressEmpty) {
    sections.push("(no entities matched the current query)");
  }

  // 2. Community summaries — GraphRAG section.
  if (ctx.communities.length > 0 || !suppressEmpty) {
    sections.push("");
    sections.push("## Cluster summaries (GraphRAG)");
    sections.push(
      `${ctx.communities.length} cluster${ctx.communities.length === 1 ? "" : "s"} from the latest community detection. ` +
        `Each summary is the LLM's prior reading of a structurally-coherent subgraph. ` +
        `Reference clusters when reasoning about cross-cluster patterns or trade-offs.`,
    );
    sections.push("");
    for (const c of ctx.communities) {
      sections.push(renderCommunity(c));
    }
  }

  // 3. Axioms — load-bearing assumptions.
  if (ctx.axioms.length > 0 || !suppressEmpty) {
    sections.push("");
    sections.push("## Load-bearing axioms");
    sections.push(
      "Assumptions the rest of the analysis rests on. Marked load-bearing because if any flips, " +
        "the strategic picture shifts. Surface explicitly when your reasoning depends on them.",
    );
    sections.push("");
    for (const a of ctx.axioms) {
      sections.push(renderAxiom(a));
    }
  }

  // 4. Convergences — post-synthesis cross-mechanism clusters.
  if (ctx.convergences.length > 0 || !suppressEmpty) {
    sections.push("");
    sections.push("## Convergent concerns");
    sections.push(
      "Concerns where multiple independent signals (axiom + leverage + risk + cycle + …) converge. " +
        "These are higher-confidence than any single signal alone.",
    );
    sections.push("");
    for (const c of ctx.convergences) {
      sections.push(renderConvergence(c));
    }
  }

  // 5. Context budget footer — observability for the LLM.
  sections.push("");
  sections.push(
    `_Grounding context: ~${ctx.estimatedTokens.toLocaleString()} tokens ` +
      `(${ctx.primaryEntities.length} entities, ${ctx.edges.length} edges, ` +
      `${ctx.claims.length} claims, ${ctx.communities.length} clusters, ` +
      `${ctx.axioms.length} axioms, ${ctx.convergences.length} convergences). ` +
      `Reason densely; do not list these back._`,
  );

  return sections.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ── Supplemental-only render ───────────────────────────────────────
//
// For callers (strategy-refresh) that already render their own
// entity+edge+claim block via the legacy formatRichKgContextForStrategy
// path. They want the NEW sections — community summaries, axioms,
// convergences — appended without duplicating the entity section.
// Returns "" when all three are empty (caller can suppress).
export function renderKgContextSupplements(ctx: KgContext): string {
  if (
    ctx.communities.length === 0 &&
    ctx.axioms.length === 0 &&
    ctx.convergences.length === 0
  ) {
    return "";
  }
  const sections: string[] = [];

  if (ctx.communities.length > 0) {
    sections.push("## Cluster summaries (GraphRAG)");
    sections.push(
      `${ctx.communities.length} cluster${ctx.communities.length === 1 ? "" : "s"} from the latest community detection. ` +
        `Reference clusters when reasoning about cross-cluster patterns or trade-offs.`,
    );
    sections.push("");
    for (const c of ctx.communities) {
      sections.push(renderCommunity(c));
    }
    sections.push("");
  }

  if (ctx.axioms.length > 0) {
    sections.push("## Load-bearing axioms");
    sections.push(
      "Assumptions the rest of the analysis rests on. If any flips, the strategic picture shifts.",
    );
    sections.push("");
    for (const a of ctx.axioms) {
      sections.push(renderAxiom(a));
    }
    sections.push("");
  }

  if (ctx.convergences.length > 0) {
    sections.push("## Convergent concerns");
    sections.push(
      "Concerns where multiple independent signals converge — higher-confidence than any single signal.",
    );
    sections.push("");
    for (const c of ctx.convergences) {
      sections.push(renderConvergence(c));
    }
  }

  return sections.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ── Section renderers ─────────────────────────────────────────────

function renderCommunity(c: KgContext["communities"][number]): string {
  const lines: string[] = [];
  const title = c.summary?.title ?? `Community ${c.id.slice(0, 6)}`;
  const ratingBit =
    typeof c.summary?.rating === "number"
      ? ` · rating ${c.summary.rating.toFixed(1)}/10`
      : "";
  const overlapBit =
    c.overlapWithFocus > 0
      ? ` · ${c.overlapWithFocus}/${c.entityIds.length} entities in focus`
      : ` · ${c.entityIds.length} entities`;
  lines.push(`### ${title}  (level ${c.level}${ratingBit}${overlapBit})`);
  if (c.summary?.summary) {
    const trimmed = c.summary.summary.trim().replace(/\s+/g, " ");
    lines.push(trimmed.length > 480 ? `${trimmed.slice(0, 477)}…` : trimmed);
  }
  // Findings: top 2-3 are usually the load-bearing ones; the rest is
  // long-tail noise. Cap to keep the section dense.
  const findings = (c.summary?.findings ?? []).slice(0, 3);
  for (const f of findings) {
    const text = f.summary?.trim().replace(/\s+/g, " ") ?? "";
    if (!text) continue;
    const short = text.length > 220 ? `${text.slice(0, 217)}…` : text;
    lines.push(`  • ${short}`);
  }
  return lines.join("\n");
}

function renderAxiom(a: Axiom): string {
  // Format: "[CRITICAL/EDGE] Claim text. If false → consequence. (rests_on: A1, A3)"
  const flags: string[] = [];
  if (a.load_bearing) flags.push(a.load_bearing.toUpperCase());
  if (a.scope) flags.push(a.scope);
  if (a.visibility && a.visibility !== "EXPLICIT") flags.push(a.visibility);
  const flagBit = flags.length > 0 ? `[${flags.join(", ")}] ` : "";
  let line = `• ${flagBit}${a.claim.trim()}`;
  if (a.if_false && a.if_false.trim()) {
    line += ` _If false → ${a.if_false.trim()}_`;
  }
  if (Array.isArray(a.rests_on) && a.rests_on.length > 0) {
    line += ` (rests on: ${a.rests_on.slice(0, 4).join(", ")})`;
  }
  return line;
}

function renderConvergence(c: InsightConvergence): string {
  const lines: string[] = [];
  const strengthBit = c.strength.toUpperCase();
  lines.push(
    `• [${strengthBit}] ${c.concern_label}  ` +
      `(${c.signal_count} signals across ${c.distinct_type_count} mechanism${c.distinct_type_count === 1 ? "" : "s"})`,
  );
  // Top 3 underlying signals — gives the LLM the substrate to
  // reason from without re-deriving the cluster.
  const top = c.signals.slice(0, 3);
  for (const sig of top) {
    const text = sig.summary.trim().replace(/\s+/g, " ");
    const short = text.length > 200 ? `${text.slice(0, 197)}…` : text;
    lines.push(`    ↳ ${sig.type}: ${short}`);
  }
  return lines.join("\n");
}
