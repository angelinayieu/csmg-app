// ── Playground detector ──
//
// Given a piece of free-form text the user is typing, detect:
//   1. EXISTING ENTITIES in the space that the text overlaps with
//   2. PATTERNS from the global pattern library whose signature suggests
//      the text describes a known archetype
//   3. CLAIMS / EVIDENCE previously recorded in the knowledge graph
//   4. OPEN QUESTIONS the user should consider branching off
//
// Phase D MVP uses lexical matching (token overlap + name substring). The
// module is designed so a later phase can swap in vector embedding similarity
// without changing the public API — only the `scoreEntityMatch` function
// needs to be replaced.

import type { Entity, Claim } from "@/types";

// ── Token utilities ──

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "for", "and", "or", "to", "is", "are",
  "was", "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "should", "could", "may", "might", "can", "this",
  "that", "these", "those", "i", "you", "we", "they", "it", "its", "his",
  "her", "my", "our", "their", "on", "at", "by", "from", "with", "about",
  "into", "through", "during", "before", "after", "above", "below", "up",
  "down", "over", "under", "again", "further", "then", "once", "as", "if",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Entity match scoring ──
//
// Combines three signals, each [0,1]:
//   - Token Jaccard on name + description
//   - Direct substring match on name (strong positive signal)
//   - Importance bonus (we want to surface hero/critical entities first)

interface EntityMatchResult {
  entity: Entity;
  score: number;            // 0..1
  matchedTokens: string[];  // for highlighting
  reason: "name_substring" | "description_overlap" | "fuzzy";
}

export function scoreEntityMatch(queryTokens: Set<string>, queryText: string, entity: Entity): EntityMatchResult | null {
  const name = (entity.name ?? "").toLowerCase();
  const description = (entity.description ?? "").toLowerCase();

  // Substring match on name — strongest signal
  const normalizedQuery = queryText.toLowerCase().trim();
  if (normalizedQuery.length >= 3 && name.includes(normalizedQuery)) {
    return {
      entity,
      score: 0.95,
      matchedTokens: normalizedQuery.split(/\s+/).filter((t) => t.length > 0),
      reason: "name_substring",
    };
  }

  // Token overlap
  const nameTokens = new Set(tokenize(name));
  const descTokens = new Set(tokenize(description));

  // Weighted combination: name match weighted higher
  const nameOverlap = jaccard(queryTokens, nameTokens);
  const descOverlap = jaccard(queryTokens, descTokens);
  const combined = nameOverlap * 0.65 + descOverlap * 0.35;

  if (combined < 0.08) return null; // too weak — discard

  // Importance bonus
  const importanceBonus = (() => {
    if (entity.importance === "fundamental") return 0.08;
    if (entity.importance === "critical") return 0.05;
    if (entity.importance === "important") return 0.02;
    return 0;
  })();

  const matchedTokens: string[] = [];
  for (const t of queryTokens) {
    if (nameTokens.has(t) || descTokens.has(t)) matchedTokens.push(t);
  }

  return {
    entity,
    score: Math.min(1, combined + importanceBonus),
    matchedTokens,
    reason: nameOverlap > descOverlap ? "name_substring" : "description_overlap",
  };
}

export function detectEntities(text: string, entities: Entity[], limit = 8): EntityMatchResult[] {
  if (!text || text.trim().length < 3) return [];
  const queryTokens = new Set(tokenize(text));
  if (queryTokens.size === 0) return [];

  const results: EntityMatchResult[] = [];
  for (const entity of entities) {
    const match = scoreEntityMatch(queryTokens, text, entity);
    if (match) results.push(match);
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ── Pattern match scoring ──
// Since pattern_library is global, the detector fetches top-N and scores by
// (canonical_description overlap + tag name overlap). The route decides which
// patterns to fetch in a single query.

export interface PatternMatchInput {
  signature: string;
  canonical_tag: string;
  canonical_description: string | null;
  canonical_mechanism: string | null;
  typical_polarity: string | null;
  occurrence_count: number;
  example_descriptions: string[] | null;
}

export interface PatternMatchResult {
  pattern: PatternMatchInput;
  score: number;
  matchedTokens: string[];
}

export function scorePatternMatch(queryTokens: Set<string>, pattern: PatternMatchInput): PatternMatchResult | null {
  const desc = (pattern.canonical_description ?? "").toLowerCase();
  const tag = (pattern.canonical_tag ?? "").toLowerCase().replace(/_/g, " ");
  const mech = (pattern.canonical_mechanism ?? "").toLowerCase();

  const descTokens = new Set(tokenize(desc));
  const tagTokens = new Set(tokenize(tag));
  const mechTokens = new Set(tokenize(mech));

  const descOverlap = jaccard(queryTokens, descTokens);
  const tagOverlap = jaccard(queryTokens, tagTokens);
  const mechOverlap = jaccard(queryTokens, mechTokens);

  // Tag overlap weighted highest because tags are curated archetypes.
  const combined = tagOverlap * 0.5 + descOverlap * 0.3 + mechOverlap * 0.2;

  if (combined < 0.1) return null;

  // Occurrence bonus: patterns seen many times are more reliable
  const occurrenceBonus = Math.min(0.1, Math.log(pattern.occurrence_count + 1) / 30);

  const matchedTokens: string[] = [];
  for (const t of queryTokens) {
    if (descTokens.has(t) || tagTokens.has(t) || mechTokens.has(t)) matchedTokens.push(t);
  }

  return {
    pattern,
    score: Math.min(1, combined + occurrenceBonus),
    matchedTokens,
  };
}

export function detectPatterns(text: string, patterns: PatternMatchInput[], limit = 5): PatternMatchResult[] {
  if (!text || text.trim().length < 3) return [];
  const queryTokens = new Set(tokenize(text));
  if (queryTokens.size === 0) return [];

  const results: PatternMatchResult[] = [];
  for (const p of patterns) {
    const match = scorePatternMatch(queryTokens, p);
    if (match) results.push(match);
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ── Claim match ──

export interface ClaimMatchResult {
  claim: Claim;
  score: number;
  matchedTokens: string[];
}

export function detectClaims(text: string, claims: Claim[], limit = 5): ClaimMatchResult[] {
  if (!text || text.trim().length < 3) return [];
  const queryTokens = new Set(tokenize(text));
  if (queryTokens.size === 0) return [];

  const results: ClaimMatchResult[] = [];
  for (const claim of claims) {
    const claimText = (claim.claim_text ?? "").toLowerCase();
    const claimTokens = new Set(tokenize(claimText));
    const overlap = jaccard(queryTokens, claimTokens);
    if (overlap < 0.15) continue;

    const matchedTokens: string[] = [];
    for (const t of queryTokens) if (claimTokens.has(t)) matchedTokens.push(t);

    // Confidence bonus
    const confBonus = (claim.confidence ?? 0.5) * 0.1;
    results.push({
      claim,
      score: Math.min(1, overlap + confBonus),
      matchedTokens,
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ── Open-questions generator ──
// Phase D MVP: lightweight heuristic generator. Given the user's text,
// produce 2-3 "what if X" / "have you considered Y" style prompts based on
// detected entity dimensions or pattern polarities. This runs without any
// LLM call — it's a deterministic prompt-template expansion.

export interface OpenQuestion {
  text: string;
  triggered_by: "entity" | "pattern" | "generic";
  related_id?: string;
}

export function generateOpenQuestions(
  userText: string,
  entityMatches: EntityMatchResult[],
  patternMatches: PatternMatchResult[],
): OpenQuestion[] {
  const questions: OpenQuestion[] = [];
  const truncated = userText.slice(0, 80);

  // Question 1: if a high-score entity matched, ask about its tradeoffs
  const topEntity = entityMatches[0];
  if (topEntity && topEntity.score >= 0.4) {
    questions.push({
      text: `What breaks if ${topEntity.entity.name} changes unexpectedly?`,
      triggered_by: "entity",
      related_id: topEntity.entity.id,
    });
  }

  // Question 2: if a negative-polarity pattern matched, surface the failure mode
  const topPattern = patternMatches[0];
  if (topPattern && topPattern.pattern.typical_polarity === "negative" && topPattern.score >= 0.25) {
    questions.push({
      text: `Is this an instance of "${topPattern.pattern.canonical_tag.replace(/_/g, " ")}"? What would prevent it?`,
      triggered_by: "pattern",
      related_id: topPattern.pattern.signature,
    });
  }

  // Question 3: generic prompt based on user text length
  if (userText.length > 40 && questions.length < 2) {
    questions.push({
      text: `What's the strongest counter-argument to this?`,
      triggered_by: "generic",
    });
  }

  return questions.slice(0, 3);
}
