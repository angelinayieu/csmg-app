/**
 * Context Capping Utilities
 * ─────────────────────────
 * Prevents memory bloat from sibling context by capping size and filtering by relevance.
 * Sibling context can grow to 270KB+ with unbounded spaces. This module caps at 50KB
 * with relevance-based filtering to preserve quality while preventing token inflation.
 *
 * Phase 2.5: Cap sibling context size
 */

import type { ScopeResult } from "@/types/orchestration";

/** Maximum size for sibling context in bytes (50KB) */
const SIBLING_CONTEXT_MAX_BYTES = 50 * 1024; // 50KB

/** Maximum number of sibling spaces to include in context */
const MAX_SIBLING_SPACES = 5;

/**
 * Calculate relevance score between current space and sibling
 * Higher score = more relevant = should be included
 *
 * Scoring factors:
 * - Shared key concepts (high weight)
 * - Related dimensions/layers
 * - Conceptual overlap in descriptions
 */
function calculateRelevance(
  currentSpace: ScopeResult["spaces"][number],
  siblingSpace: ScopeResult["spaces"][number]
): number {
  let score = 0;

  // Shared key concepts (highest weight)
  const sharedConcepts = currentSpace.key_concepts.filter((concept) =>
    siblingSpace.key_concepts.includes(concept)
  );
  score += sharedConcepts.length * 10;

  // Concept overlap in descriptions (normalized)
  const currentDescWords = currentSpace.description.toLowerCase().split(/\s+/);
  const siblingDescWords = siblingSpace.description.toLowerCase().split(/\s+/);
  const descriptionOverlap = currentDescWords.filter((word) =>
    siblingDescWords.includes(word)
  ).length;
  score += descriptionOverlap * 2;

  // Prefix similarity (e.g., "Space A" and "Space B" are similar)
  if (
    currentSpace.prefix &&
    siblingSpace.prefix &&
    currentSpace.prefix.charAt(0) === siblingSpace.prefix.charAt(0)
  ) {
    score += 1;
  }

  return score;
}

/**
 * Format a single sibling space entry for context
 * Returns: "- Space {prefix} "{name}": covers {concepts}"
 */
function formatSiblingSpace(space: ScopeResult["spaces"][number]): string {
  return `- Space ${space.prefix} "${space.name}": covers ${space.key_concepts.join(", ")}`;
}

/**
 * Build and cap sibling context for a specific space
 *
 * Algorithm:
 * 1. Calculate relevance scores for all siblings
 * 2. Sort by relevance (most relevant first)
 * 3. Add siblings in order until we hit size limit or max count
 * 4. Return truncated context + metadata
 *
 * Returns: { context, siblingCount, truncated, sizeBytes }
 */
export function buildCappedSiblingContext(
  currentSpace: ScopeResult["spaces"][number],
  allSpaces: ScopeResult["spaces"][number][]
): {
  context: string;
  siblingCount: number;
  truncated: boolean;
  sizeBytes: number;
} {
  // Get all siblings (excluding current space)
  const siblings = allSpaces.filter(
    (s: ScopeResult["spaces"][number]) => s.prefix !== currentSpace.prefix
  );

  if (siblings.length === 0) {
    return { context: "", siblingCount: 0, truncated: false, sizeBytes: 0 };
  }

  // Score siblings by relevance
  const scoredSiblings = siblings.map((sibling: ScopeResult["spaces"][number]) => ({
    space: sibling,
    relevance: calculateRelevance(currentSpace, sibling),
  }));

  // Sort by relevance (descending)
  scoredSiblings.sort((a: { space: ScopeResult["spaces"][number]; relevance: number }, b: { space: ScopeResult["spaces"][number]; relevance: number }) => b.relevance - a.relevance);

  // Build context with size cap
  const contextLines: string[] = [];
  let currentSize = 0;
  let siblingCount = 0;
  let truncated = false;

  for (const { space } of scoredSiblings) {
    if (siblingCount >= MAX_SIBLING_SPACES) {
      truncated = true;
      break;
    }

    const line = formatSiblingSpace(space);
    const lineSize = Buffer.byteLength(line, "utf-8") + 1; // +1 for newline

    // Check if adding this line would exceed limit
    if (currentSize + lineSize > SIBLING_CONTEXT_MAX_BYTES) {
      truncated = true;
      break;
    }

    contextLines.push(line);
    currentSize += lineSize;
    siblingCount++;
  }

  const finalContext = contextLines.join("\n");
  const sizeBytes = Buffer.byteLength(finalContext, "utf-8");

  return {
    context: finalContext,
    siblingCount,
    truncated,
    sizeBytes,
  };
}

/**
 * Batch build sibling contexts for all spaces with capping
 * Returns array of contexts with metadata
 */
export function buildAllCappedSiblingContexts(
  spaces: ScopeResult["spaces"][number][]
): Array<{
  context: string;
  siblingCount: number;
  truncated: boolean;
  sizeBytes: number;
}> {
  return spaces.map((space, i) => {
    const result = buildCappedSiblingContext(space, spaces);

    // Log truncation if it occurred
    if (result.truncated) {
      console.warn(
        `Sibling context truncated for space ${i} (${space.name}): ` +
          `${result.siblingCount}/${spaces.length - 1} siblings included, ` +
          `${result.sizeBytes} bytes (max ${SIBLING_CONTEXT_MAX_BYTES})`
      );
    }

    return result;
  });
}

/**
 * Get context capping statistics for monitoring
 * Useful for CloudWatch metrics and performance tracking
 */
export function getContextStats(
  results: Array<{
    context: string;
    siblingCount: number;
    truncated: boolean;
    sizeBytes: number;
  }>
): {
  totalBytes: number;
  avgBytes: number;
  maxBytes: number;
  truncatedCount: number;
  totalSiblings: number;
  avgSiblingsPerSpace: number;
} {
  const totalBytes = results.reduce((sum, r) => sum + r.sizeBytes, 0);
  const truncatedCount = results.filter((r) => r.truncated).length;
  const totalSiblings = results.reduce((sum, r) => sum + r.siblingCount, 0);
  const maxBytes = Math.max(...results.map((r) => r.sizeBytes), 0);

  return {
    totalBytes,
    avgBytes: Math.round(totalBytes / results.length),
    maxBytes,
    truncatedCount,
    totalSiblings,
    avgSiblingsPerSpace:
      results.length > 0 ? totalSiblings / results.length : 0,
  };
}

/**
 * Verify that context capping is working (for unit tests)
 */
export function verifyContextCaps(
  results: Array<{
    context: string;
    siblingCount: number;
    truncated: boolean;
    sizeBytes: number;
  }>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    // Check size limit
    if (result.sizeBytes > SIBLING_CONTEXT_MAX_BYTES) {
      errors.push(
        `Space ${i}: context size ${result.sizeBytes} exceeds limit ${SIBLING_CONTEXT_MAX_BYTES}`
      );
    }

    // Check sibling count limit
    if (result.siblingCount > MAX_SIBLING_SPACES) {
      errors.push(
        `Space ${i}: sibling count ${result.siblingCount} exceeds limit ${MAX_SIBLING_SPACES}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─── Export configuration for testing/adjustment ───

export const CONTEXT_CAPPING_CONFIG = {
  MAX_BYTES: SIBLING_CONTEXT_MAX_BYTES,
  MAX_SPACES: MAX_SIBLING_SPACES,
};
