import type { Axiom, AxiomScope, AxiomVisibility, AxiomLoadBearing, AxiomConfidence } from "@/types/synthesis";

const AXIOM_HEADER = /^\s*AXIOM\s+(A\d+)\s*\[([^\]]+)\]\s*$/im;
const FIELD_PATTERNS: Record<string, RegExp> = {
  claim: /^\s*Claim\s*:\s*(.+)$/i,
  if_false: /^\s*If\s+false\s*:\s*(.+)$/i,
  rests_on: /^\s*Rests\s+on\s*:\s*(.+?)(?:\s*\(.*\))?\s*$/i,
  scope_anchor: /^\s*Scope\s+anchor\s*:\s*(.+)$/i,
  validation_path: /^\s*Validation\s+path\s*:\s*(.+)$/i,
  confidence: /^\s*Confidence[^:]*:\s*(.+)$/i,
};

function parseHeaderMetadata(meta: string): {
  visibility: AxiomVisibility;
  load_bearing: AxiomLoadBearing;
  scope: AxiomScope;
} {
  const parts = meta.split("|").map((s) => s.trim());
  let visibility: AxiomVisibility = "IMPLICIT";
  let load_bearing: AxiomLoadBearing = "important";
  let scope: AxiomScope = "node";

  for (const part of parts) {
    const upper = part.toUpperCase();
    if (upper === "HIDDEN" || upper === "IMPLICIT" || upper === "EXPLICIT") {
      visibility = upper as AxiomVisibility;
      continue;
    }
    const lbMatch = part.match(/load[-_ ]bearing\s*=\s*(\w+)/i);
    if (lbMatch) {
      const v = lbMatch[1].toLowerCase();
      if (v === "critical" || v === "important" || v === "moderate") {
        load_bearing = v as AxiomLoadBearing;
      }
      continue;
    }
    const scopeMatch = part.match(/scope\s*=\s*(\w+)/i);
    if (scopeMatch) {
      const v = scopeMatch[1].toLowerCase();
      if (v === "node" || v === "edge" || v === "chain" || v === "frame") {
        scope = v as AxiomScope;
      }
    }
  }

  return { visibility, load_bearing, scope };
}

function parseConfidence(raw: string): AxiomConfidence {
  const v = raw.toLowerCase().trim();
  if (v.startsWith("high")) return "high";
  if (v.startsWith("low")) return "low";
  return "medium";
}

function parseRestsOn(raw: string): string[] {
  // Strip quotes, brackets, and trailing parenthetical
  const cleaned = raw.replace(/[\[\]"<>]/g, "").replace(/\(.*?\)/g, "").trim();
  if (!cleaned || cleaned.toLowerCase() === "none") return [];
  return cleaned
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^[A-Za-z]+\d+$/.test(s));
}

function stripQuotes(s: string): string {
  return s.replace(/^["'«»]+|["'«»]+$/g, "").trim();
}

/**
 * Locate the `axioms` section in raw decomposition text.
 * Accepts variants: "axioms", "## Axioms", "AXIOMS", "### Tier 7 — Axiomatic Reduction", etc.
 * Returns the substring from the axioms header to the next top-level section (or EOF).
 */
function extractAxiomSection(text: string): string {
  const lines = text.split(/\r?\n/);
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^(#+\s*)?(tier\s*7|axioms?|axiomatic\s+reduction)\b/i.test(l)) {
      start = i;
      break;
    }
    // Bare AXIOM A1 line also marks a start if no header seen
    if (/^AXIOM\s+A\d+\s*\[/i.test(l)) {
      start = i;
      break;
    }
  }

  if (start < 0) return "";

  // Find end: next top-level header ("## Phase 2", "## Weave", etc.) or EOF
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^(#{1,3})\s+(phase\s*2|weave|pattern\s+scan|step\s+[a-d]|recomposition)/i.test(l)) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

export function parseAxioms(rawDecomposition: string): Axiom[] {
  if (!rawDecomposition || typeof rawDecomposition !== "string") return [];

  const section = extractAxiomSection(rawDecomposition);
  if (!section) return [];

  // Split into blocks keyed by AXIOM header
  const lines = section.split(/\r?\n/);
  const blocks: Array<{ header: string; body: string[] }> = [];
  let current: { header: string; body: string[] } | null = null;

  for (const line of lines) {
    if (AXIOM_HEADER.test(line)) {
      if (current) blocks.push(current);
      current = { header: line, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) blocks.push(current);

  const axioms: Axiom[] = [];

  for (const block of blocks) {
    const headerMatch = block.header.match(AXIOM_HEADER);
    if (!headerMatch) continue;
    const [, axiomId, meta] = headerMatch;
    const { visibility, load_bearing, scope } = parseHeaderMetadata(meta);

    const fields: Record<string, string> = {};
    for (const line of block.body) {
      for (const [key, pattern] of Object.entries(FIELD_PATTERNS)) {
        const m = line.match(pattern);
        if (m && !fields[key]) {
          fields[key] = stripQuotes(m[1]);
          break;
        }
      }
    }

    // Required fields: claim + if_false. Skip malformed axioms silently.
    if (!fields.claim || !fields.if_false) continue;

    axioms.push({
      axiom_id: axiomId,
      visibility,
      load_bearing,
      scope,
      claim: fields.claim,
      if_false: fields.if_false,
      rests_on: parseRestsOn(fields.rests_on ?? ""),
      scope_anchor: fields.scope_anchor ?? "",
      validation_path: fields.validation_path ?? "",
      confidence: parseConfidence(fields.confidence ?? "medium"),
    });
  }

  return axioms;
}
