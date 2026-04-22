// ── Run-context → LLM prompt snippet ──
//
// Closes the blackboard loop (see `lib/events/run-context.ts` header):
// downstream pipeline stages need to SEE what earlier stages produced
// without re-querying the DB or re-deriving context. This module
// renders a compact, LLM-ingestible snippet from a RunContext so any
// stage can paste it into its system/user prompt as "here's what your
// upstream stages already established."
//
// Design constraints:
//   - Deterministic. No LLM call — same RunContext in, same snippet
//     out. Layer LLM polish later if needed.
//   - Bounded. We cap entities/edges/proposals/sources so long runs
//     don't blow the prompt budget.
//   - Skippable. When a stage has no prior context (runId missing,
//     first stage of a pipeline), the helper returns null so callers
//     can branch cleanly.

import type { RunContext } from "./run-context";

export interface FormatPriorContextOptions {
  /** Max entities to list (by order of appearance). Default 20. */
  maxEntities?: number;
  /** Max edges to list. Default 20. */
  maxEdges?: number;
  /** Max proposals to list. Default 10. */
  maxProposals?: number;
  /** Max sources to list. Default 8. */
  maxSources?: number;
  /**
   * If true, includes the "totals" line at the top ("run so far produced
   * 14 entities, 22 edges, 3 cycles…"). Default true.
   */
  includeTotals?: boolean;
  /**
   * If true, includes per-stage deterministic digests. Default true —
   * this is the whole point of the digest layer.
   */
  includeStageDigests?: boolean;
}

/**
 * Render a RunContext into a compact prompt-ready snippet. Returns
 * null if there's nothing worth showing (no events recorded yet).
 *
 * The output is plain Markdown — most LLM stacks parse that cleanly
 * and it reads fine in audit logs too.
 */
export function formatPriorContextPrompt(
  ctx: RunContext | null,
  opts: FormatPriorContextOptions = {},
): string | null {
  if (!ctx) return null;
  if (ctx.totalEvents === 0) return null;

  const {
    maxEntities = 20,
    maxEdges = 20,
    maxProposals = 10,
    maxSources = 8,
    includeTotals = true,
    includeStageDigests = true,
  } = opts;

  const lines: string[] = [];
  lines.push("## Prior run context");
  lines.push(
    `Run ${ctx.runId.slice(0, 8)} (${ctx.pipeline}, status=${ctx.status}).`,
  );

  if (includeTotals) {
    const totals = describeCounts(ctx.counts);
    if (totals) lines.push(`So far this run: ${totals}.`);
  }

  if (includeStageDigests && ctx.stages.length > 0) {
    lines.push("");
    lines.push("### Stage digests");
    for (const s of ctx.stages) {
      if (!s.digest) continue;
      lines.push(`- ${s.digest}`);
    }
  }

  if (ctx.entities.length > 0) {
    lines.push("");
    lines.push("### Entities established");
    const shown = ctx.entities.slice(0, maxEntities);
    for (const e of shown) {
      const bits: string[] = [];
      if (e.entityCode) bits.push(e.entityCode);
      bits.push(e.name);
      if (e.category) bits.push(`(${e.category})`);
      lines.push(`- ${bits.join(" ")}`);
    }
    if (ctx.entities.length > shown.length) {
      lines.push(`- …and ${ctx.entities.length - shown.length} more`);
    }
  }

  if (ctx.edges.length > 0) {
    lines.push("");
    lines.push("### Relationships established");
    const shown = ctx.edges.slice(0, maxEdges);
    // Build a quick id → name/code map from the entities list so edges
    // read as "A causes B" instead of "uuid1 causes uuid2".
    const nameById = new Map<string, string>();
    for (const e of ctx.entities) {
      nameById.set(e.entityId, e.entityCode || e.name);
    }
    for (const edge of shown) {
      const src = nameById.get(edge.sourceEntityId) ?? edge.sourceEntityId.slice(0, 8);
      const tgt = nameById.get(edge.targetEntityId) ?? edge.targetEntityId.slice(0, 8);
      const polarity = edge.polarity ? ` [${edge.polarity}]` : "";
      lines.push(
        `- ${src} → ${tgt} (${edge.relationshipType}, ${edge.dimension}${polarity}, conf ${edge.confidence.toFixed(2)})`,
      );
    }
    if (ctx.edges.length > shown.length) {
      lines.push(`- …and ${ctx.edges.length - shown.length} more`);
    }
  }

  if (ctx.proposals.length > 0) {
    lines.push("");
    lines.push("### Proposals already emitted");
    const shown = ctx.proposals.slice(0, maxProposals);
    for (const p of shown) {
      const dist = p.distribution
        ? ` [p10 ${p.distribution.p10.toFixed(2)} / p50 ${p.distribution.p50.toFixed(2)} / p90 ${p.distribution.p90.toFixed(2)}]`
        : "";
      lines.push(`- (${p.kind}) ${p.title}${dist}`);
    }
    if (ctx.proposals.length > shown.length) {
      lines.push(`- …and ${ctx.proposals.length - shown.length} more`);
    }
  }

  if (ctx.sources.length > 0) {
    lines.push("");
    lines.push("### Sources consulted");
    const shown = ctx.sources.slice(0, maxSources);
    for (const s of shown) {
      const title = s.title ?? s.url;
      lines.push(`- ${title} (authority ${s.authority.toFixed(2)})`);
    }
    if (ctx.sources.length > shown.length) {
      lines.push(`- …and ${ctx.sources.length - shown.length} more`);
    }
  }

  lines.push("");
  lines.push(
    "Use the above as ground truth — do not restate or duplicate; build on top.",
  );

  return lines.join("\n");
}

function describeCounts(c: RunContext["counts"]): string | null {
  const parts: string[] = [];
  if (c.entities > 0) parts.push(`${c.entities} entities`);
  if (c.edges > 0) parts.push(`${c.edges} edges`);
  if (c.cycles > 0) parts.push(`${c.cycles} cycles`);
  if (c.bridges > 0) parts.push(`${c.bridges} bridges`);
  if (c.proposals > 0) parts.push(`${c.proposals} proposals`);
  if (c.sources > 0) parts.push(`${c.sources} sources`);
  if (c.predictions > 0) parts.push(`${c.predictions} predictions`);
  if (parts.length === 0) return null;
  return parts.join(", ");
}
