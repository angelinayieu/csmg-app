// ── Pass 1 preview extractors: entity names AND edge pairs ──
//
// Pass 1 of decompose is free-form LLM reasoning that streams over ~30s.
// Its output is structured markdown that consistently labels entities
// with patterns like:
//
//   - **ID**: C1
//   - **Name**: Customer retention rate
//
// and relationships with patterns like:
//
//   C1 → C3
//   - **Source**: C1
//     **Target**: C3
//
// We run these extractors on the growing accumulated text to pull
// candidates out BEFORE Pass 2 finishes structuring. The caller emits
// synthetic `entity_added` / `edge_added` events per new candidate so
// the main canvas paints live during the streaming window instead of
// sitting empty until the Pass 2 batch lands at ~85s.
//
// Trade-offs, acknowledged:
//   • Regex-based extraction over prose is lossy — false positives
//     and false negatives both happen. Both are fine: previews are
//     replaced by Pass 2's authoritative rows at run-end (painter's
//     rebind logic keeps shape identity stable), and stray previews
//     are swept when the run completes.
//   • We only match patterns that clearly look like entity/edge
//     declarations to keep false-positive rate low. Dedup keys ensure
//     we never double-emit the same candidate.

/** Entity extraction result — name plus the entity code (C1/C2/…) when present. */
export interface EntityCandidate {
  name: string;
  /** Entity code like C1, C23. Null when the match pattern didn't surface a code. */
  code: string | null;
}

/** Edge extraction result — a directed pair of preview entity UUIDs. */
export interface EdgeCandidate {
  sourcePreviewId: string;
  targetPreviewId: string;
}

// ── Entity name extraction ──

/** Patterns that match an entity declaration in Pass 1 prose. Each pattern
 *  exposes two capture groups: [1]=entity code (may be empty), [2]=name. */
const ENTITY_PATTERNS: RegExp[] = [
  // - **ID**: C1\n  - **Name**: Customer retention rate   (separate bullets)
  /^[-*]\s*\*\*\s*ID\s*\*\*\s*:\s*([A-Z]\d+)[\s\S]{0,120}?\*\*\s*Name\s*\*\*\s*:\s*(.{3,80}?)\s*$/gim,
  // - **Name**: Customer retention rate   (no code captured)
  /^[-*]\s*\*\*\s*Name\s*\*\*\s*:\s*()(.{3,80}?)\s*$/gim,
  // **Name:** Customer retention rate
  /\*\*\s*Name\s*\*\*\s*:\s*()(.{3,80}?)(?:\n|$)/gi,
  // ### C3 — Engineering capacity   (markdown heading form, em/en dash)
  /^#{2,4}\s+([A-Z]\d+)\s*[—–-]\s*(.{3,80}?)\s*$/gim,
  // - **C3 — Engineering capacity**
  /^[-*]\s*\*\*\s*([A-Z]\d+)\s*[—–-]\s*(.{3,80}?)\s*\*\*/gim,
];

/**
 * Pull candidate entities from the current accumulated Pass 1 text.
 * Returns ONLY entities whose normalized name isn't already in
 * `alreadySeen`. Mutates `alreadySeen` to include the new names.
 */
export function extractCandidateEntityNames(
  text: string,
  alreadySeen: Set<string>,
): EntityCandidate[] {
  const discovered: EntityCandidate[] = [];
  for (const pattern of ENTITY_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const code = (match[1] ?? "").trim() || null;
      const rawName = match[2];
      if (!rawName) continue;
      const name = cleanCandidateName(rawName);
      if (!isLikelyEntityName(name)) continue;
      const key = normalizeName(name);
      if (alreadySeen.has(key)) continue;
      alreadySeen.add(key);
      discovered.push({ name, code });
    }
  }
  return discovered;
}

// ── Edge pair extraction ──

/** Arrow patterns that declare a directed edge between two entity codes.
 *  Capture groups: [1]=source code, [2]=target code. */
const EDGE_PATTERNS: RegExp[] = [
  // C1 → C3   (unicode arrow, any whitespace)
  /\b([A-Z]\d+)\s*[→⇒]\s*([A-Z]\d+)\b/g,
  // C1 -> C3 or C1 --> C3
  /\b([A-Z]\d+)\s*-+>\s*([A-Z]\d+)\b/g,
  // - **Source**: C1  ...  **Target**: C3   (allow intervening fields up to ~180 chars)
  /\*\*\s*Source\s*\*\*\s*:\s*([A-Z]\d+)[\s\S]{0,180}?\*\*\s*Target\s*\*\*\s*:\s*([A-Z]\d+)/gi,
];

/**
 * Pull candidate edges from the current accumulated Pass 1 text and
 * resolve their entity codes to preview UUIDs using the caller's
 * code→UUID map. Returns ONLY pairs that:
 *   1. Reference codes already mapped to a preview entity (unknown codes are skipped).
 *   2. Aren't already in `alreadySeen` (directed pair key: "srcUuid→tgtUuid").
 * Mutates `alreadySeen` to include the new pair keys.
 */
export function extractCandidateEdges(
  text: string,
  codeToPreviewId: Map<string, string>,
  alreadySeen: Set<string>,
): EdgeCandidate[] {
  const discovered: EdgeCandidate[] = [];
  for (const pattern of EDGE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const srcCode = match[1];
      const tgtCode = match[2];
      if (!srcCode || !tgtCode || srcCode === tgtCode) continue;
      const sourcePreviewId = codeToPreviewId.get(srcCode);
      const targetPreviewId = codeToPreviewId.get(tgtCode);
      if (!sourcePreviewId || !targetPreviewId) continue;
      const key = `${sourcePreviewId}→${targetPreviewId}`;
      if (alreadySeen.has(key)) continue;
      alreadySeen.add(key);
      discovered.push({ sourcePreviewId, targetPreviewId });
    }
  }
  return discovered;
}

// ── Helpers ──

function cleanCandidateName(raw: string): string {
  return raw
    .replace(/\*\*/g, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\s*\[.*?\]\s*$/g, "") // drop trailing [EXPLICIT] / [IMPLICIT] tags
    .replace(/\s+/g, " ")
    .trim();
}

/** Reject obvious non-entity matches (section labels, meta). */
function isLikelyEntityName(name: string): boolean {
  if (name.length < 3 || name.length > 80) return false;
  const lower = name.toLowerCase();
  const blocked = [
    "tier",
    "overview",
    "summary",
    "layer",
    "concept extraction",
    "decomposition",
    "ambiguity",
    "entity category",
  ];
  if (blocked.some((b) => lower === b || lower.startsWith(`${b} `))) return false;
  if (!/[a-zA-Z]/.test(name)) return false;
  return true;
}

export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}
