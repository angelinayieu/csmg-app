// ── Tier 3 annotation extraction from Pass 1 prose ──
// The decomposition LLM emits free-form prose in Pass 1 with embedded annotations
// like [TOPOLOGY: composes], [DYNAMICS: compounding | cycle_time="2 weeks"], and
// edge notation like "C5 —[causes]→ C12". Pass 2 (structuring) reads this as a
// blob and re-infers these properties from scratch, usually failing to preserve
// them. This module extracts the annotations deterministically so they can be
// injected into the structuring prompt as hard hints.

export interface ExtractedEdgeAnnotation {
  source_id: string;
  target_id: string;
  relationship_type?: string;
  topology?: string;
  dynamics?: string;
  conditions?: string;
  cycle_time?: string;
  multiplier?: string;
  confidence_hint?: string; // "strong" | "moderate" | "speculative" from brackets
}

const TOPOLOGY_VALUES = new Set([
  "inside", "overlap", "meets", "disjoint", "composes", "cover", "equal",
]);
const DYNAMICS_VALUES = new Set([
  "threshold", "linear", "compounding", "exponential",
  "logarithmic", "decay", "step_function", "delayed",
]);

// Entity-pair edge line: "C5 —[causes]→ C12", "C5 -[causes]-> C12", "C5 → C12", with flexible arrows
const EDGE_LINE_RE = /(C\d+)\s*(?:—|-|–|=)?\s*\[([^\]]+)\]\s*(?:→|->|—>|–>)\s*(C\d+)/gi;
const SIMPLE_EDGE_RE = /(C\d+)\s*(?:→|->|—>|–>)\s*(C\d+)/gi;

// Annotation tags that may appear on the same line or within ~200 chars
const TOPOLOGY_RE = /\[TOPOLOGY\s*:\s*([a-z_|\s]+?)\]/gi;
const DYNAMICS_RE = /\[DYNAMICS\s*:\s*([^\]]+?)\]/gi;
const CONDITIONS_RE = /\[CONDITIONS?\s*:\s*([^\]]+?)\]/gi;
const STRENGTH_RE = /\[(?:CAUSAL|STRUCTURAL|LOGICAL|TEMPORAL|CORRELATIONAL|FUNCTIONAL)?\s*[-–—]?\s*(STRONG|MODERATE|WEAK|SPECULATIVE)\]/gi;

interface RawMatch {
  type: "edge" | "topology" | "dynamics" | "conditions" | "strength";
  index: number;
  source?: string;
  target?: string;
  relationship?: string;
  value?: string;
}

/**
 * Parse the first topology keyword from a value string. Handles cases where the
 * LLM emits multiple options separated by `|`.
 */
function normalizeTopology(raw: string): string | undefined {
  const parts = raw
    .toLowerCase()
    .split(/[|,/]/)
    .map((s) => s.trim().replace(/[\s-]+/g, "_"))
    .filter(Boolean);
  for (const p of parts) {
    if (TOPOLOGY_VALUES.has(p)) return p;
  }
  return undefined;
}

/**
 * DYNAMICS annotation can contain: "compounding | cycle_time=2 weeks | multiplier=1.5"
 * or just "compounding". Parse out dynamics keyword + properties.
 */
function parseDynamicsAnnotation(raw: string): {
  dynamics?: string;
  cycle_time?: string;
  multiplier?: string;
  conditions?: string;
} {
  const result: ReturnType<typeof parseDynamicsAnnotation> = {};
  const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const lower = part.toLowerCase();
    const keyword = lower.replace(/[\s-]+/g, "_");
    if (DYNAMICS_VALUES.has(keyword)) {
      result.dynamics = keyword;
      continue;
    }
    const ctMatch = part.match(/cycle[_\s]?time\s*[:=]\s*"?([^"\]]+?)"?$/i);
    if (ctMatch) { result.cycle_time = ctMatch[1].trim(); continue; }
    const mMatch = part.match(/multiplier\s*[:=]\s*"?([^"\]]+?)"?$/i);
    if (mMatch) { result.multiplier = mMatch[1].trim(); continue; }
    const condMatch = part.match(/(?:condition|when|trigger)\s*[:=]\s*"?([^"\]]+?)"?$/i);
    if (condMatch) { result.conditions = condMatch[1].trim(); continue; }
  }
  return result;
}

function collectMatches(text: string): RawMatch[] {
  const matches: RawMatch[] = [];

  // Edge lines with explicit relationship in brackets
  EDGE_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EDGE_LINE_RE.exec(text)) !== null) {
    matches.push({
      type: "edge",
      index: m.index,
      source: m[1].toUpperCase(),
      target: m[3].toUpperCase(),
      relationship: m[2].trim(),
    });
  }

  // Simple edge arrows without explicit bracket relationship — only add if not already
  // captured by EDGE_LINE_RE (check by index overlap)
  SIMPLE_EDGE_RE.lastIndex = 0;
  while ((m = SIMPLE_EDGE_RE.exec(text)) !== null) {
    const conflict = matches.some(
      (x) => x.type === "edge" && Math.abs(x.index - m!.index) < 60,
    );
    if (!conflict) {
      matches.push({
        type: "edge",
        index: m.index,
        source: m[1].toUpperCase(),
        target: m[2].toUpperCase(),
      });
    }
  }

  TOPOLOGY_RE.lastIndex = 0;
  while ((m = TOPOLOGY_RE.exec(text)) !== null) {
    matches.push({ type: "topology", index: m.index, value: m[1].trim() });
  }
  DYNAMICS_RE.lastIndex = 0;
  while ((m = DYNAMICS_RE.exec(text)) !== null) {
    matches.push({ type: "dynamics", index: m.index, value: m[1].trim() });
  }
  CONDITIONS_RE.lastIndex = 0;
  while ((m = CONDITIONS_RE.exec(text)) !== null) {
    matches.push({ type: "conditions", index: m.index, value: m[1].trim() });
  }
  STRENGTH_RE.lastIndex = 0;
  while ((m = STRENGTH_RE.exec(text)) !== null) {
    matches.push({ type: "strength", index: m.index, value: m[1].trim().toLowerCase() });
  }

  return matches.sort((a, b) => a.index - b.index);
}

/**
 * Associate each annotation with the nearest edge within ±300 chars, preferring
 * annotations on the SAME line as the edge.
 */
function associateAnnotations(
  matches: RawMatch[],
  fullText: string,
): ExtractedEdgeAnnotation[] {
  const edgeMatches = matches.filter((m) => m.type === "edge");
  const annotations = matches.filter((m) => m.type !== "edge");
  const results: ExtractedEdgeAnnotation[] = [];
  const seen = new Set<string>();

  for (const edge of edgeMatches) {
    const key = `${edge.source}|${edge.target}`;
    if (seen.has(key)) continue; // dedup duplicate edge mentions
    seen.add(key);

    const ann: ExtractedEdgeAnnotation = {
      source_id: edge.source!,
      target_id: edge.target!,
    };
    if (edge.relationship) {
      // Strip strength prefix like "CAUSAL - STRONG": keep only the verb if present
      const rel = edge.relationship
        .replace(/^(CAUSAL|STRUCTURAL|LOGICAL|TEMPORAL|CORRELATIONAL|FUNCTIONAL)\s*[-–—]?\s*(STRONG|MODERATE|WEAK|SPECULATIVE)?\s*/i, "")
        .replace(/^(STRONG|MODERATE|WEAK|SPECULATIVE)\s*[-–—]?\s*/i, "")
        .trim();
      if (rel) ann.relationship_type = rel;
    }

    // Find nearest annotations within window. Prefer same-line (no newline between edge and annotation).
    const windowStart = Math.max(0, edge.index - 100);
    const windowEnd = Math.min(fullText.length, edge.index + 400);
    const nearby = annotations.filter(
      (a) => a.index >= windowStart && a.index <= windowEnd,
    );
    // Sort by distance
    nearby.sort((a, b) => Math.abs(a.index - edge.index) - Math.abs(b.index - edge.index));

    for (const a of nearby) {
      // Don't cross past the NEXT edge line — that annotation belongs to the next edge
      const interveningEdge = edgeMatches.find((e) =>
        e !== edge &&
        ((e.index > edge.index && e.index < a.index) ||
         (e.index < edge.index && e.index > a.index)),
      );
      if (interveningEdge) continue;

      if (a.type === "topology" && !ann.topology) {
        const t = normalizeTopology(a.value ?? "");
        if (t) ann.topology = t;
      } else if (a.type === "dynamics" && !ann.dynamics) {
        const parsed = parseDynamicsAnnotation(a.value ?? "");
        if (parsed.dynamics) ann.dynamics = parsed.dynamics;
        if (parsed.cycle_time) ann.cycle_time = parsed.cycle_time;
        if (parsed.multiplier) ann.multiplier = parsed.multiplier;
        if (parsed.conditions && !ann.conditions) ann.conditions = parsed.conditions;
      } else if (a.type === "conditions" && !ann.conditions) {
        ann.conditions = a.value;
      } else if (a.type === "strength" && !ann.confidence_hint) {
        ann.confidence_hint = a.value;
      }
    }

    results.push(ann);
  }

  return results;
}

export function extractTier3Annotations(rawDecomposition: string): ExtractedEdgeAnnotation[] {
  if (!rawDecomposition || typeof rawDecomposition !== "string") return [];
  const matches = collectMatches(rawDecomposition);
  if (matches.length === 0) return [];
  return associateAnnotations(matches, rawDecomposition);
}

/**
 * Format the annotations as a hint block to be injected into the structuring prompt.
 * Keeps it compact so it doesn't eat the structuring LLM's token budget.
 */
export function formatAnnotationsForStructuring(
  annotations: ExtractedEdgeAnnotation[],
): string {
  if (annotations.length === 0) return "";

  const withData = annotations.filter(
    (a) => a.topology || a.dynamics || a.conditions || a.cycle_time || a.relationship_type || a.confidence_hint,
  );
  if (withData.length === 0) return "";

  const lines = withData.map((a) => {
    const parts: string[] = [];
    if (a.relationship_type) parts.push(`rel="${a.relationship_type}"`);
    if (a.topology) parts.push(`topology=${a.topology}`);
    if (a.dynamics) parts.push(`dynamics=${a.dynamics}`);
    if (a.cycle_time) parts.push(`cycle_time="${a.cycle_time}"`);
    if (a.multiplier) parts.push(`multiplier="${a.multiplier}"`);
    if (a.conditions) parts.push(`conditions="${a.conditions}"`);
    if (a.confidence_hint) parts.push(`strength=${a.confidence_hint}`);
    return `- ${a.source_id} → ${a.target_id}: ${parts.join(", ")}`;
  });

  return `--- PRE-EXTRACTED TIER 3 ANNOTATIONS (MANDATORY — preserve on corresponding edges) ---
The Pass 1 decomposition emitted these annotations on specific edges. You MUST preserve them in your JSON output exactly. If you see an edge from ${withData.length > 0 ? withData[0].source_id : "C?"} → ${withData.length > 0 ? withData[0].target_id : "C?"}, populate its topology / dynamics / conditions / cycle_time fields with the extracted values below. Do NOT default these to null — doing so silently destroys Pass 1 rigor.

${lines.join("\n")}

If an edge below does NOT appear in your JSON output, add it — the Pass 1 analysis identified it explicitly.
`;
}
