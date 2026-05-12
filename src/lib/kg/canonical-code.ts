// ── Canonical code normalization ─────────────────────────────────────
//
// TIER: 1 (canonical/schema) — produces the stable identifier that
// per-space entity rows use to point at canonical concepts.
//
// What a `canonical_code` is:
//   A stable, normalized slug for a concept. "BDNF", "Brain-Derived
//   Neurotrophic Factor", and "bdnf protein" all normalize to the
//   same code so the future canonical_concepts table (Week 6+) can
//   cluster them as ONE row instead of three.
//
// Why we populate it NOW (before the canonical_concepts table exists):
//   When we materialize proto-entities at framing-approval time
//   (Week 3 work), every new entity gets its canonical_code stamped
//   into `node_signatures.canonical_code`. When the canonical_concepts
//   table lands, the backfill query that clusters codes into concepts
//   gets a free, pre-populated input. Without this discipline, the
//   Week 6 backfill would need to re-derive codes for every entity
//   ever created, which is expensive AND lossy (the source text we
//   normalize from is often gone by then).
//
// This is the cheapest possible Tier 1 surface: 5 LOC of computation
// at every entity write, ZERO LOC of new infrastructure. Pays off
// at Week 6 with a clean backfill.
//
// Normalization rules (matching `node_signatures.canonical_code`):
//   1. Lowercase
//   2. Strip leading/trailing whitespace
//   3. Replace runs of non-alphanumeric characters with a single
//      underscore
//   4. Strip leading/trailing underscores
//   5. Cap length at 80 chars (matches node_signatures schema)
//   6. Empty string fallback: return null (caller decides what to
//      do — typically skip the canonical_code stamp)
//
// What's NOT done here (intentional):
//   - Embedding-based similarity. That's the Week 6 backfill's job;
//     it clusters multiple codes that semantically mean the same
//     thing into ONE canonical_concepts.id. Pure-string normalization
//     is sufficient at write time.
//   - Lemmatization / stemming. "Proteins" and "protein" become
//     different codes today (`proteins` vs `protein`). The Week 6
//     clustering pass handles this via embedding distance. Pure-
//     string normalization stays fast + predictable.
//   - Domain-specific aliasing (e.g., "BDNF" ↔ "brain-derived
//     neurotrophic factor"). Same reason — clustering handles it.
//
// Example outputs:
//   "BDNF"                              → "bdnf"
//   "Brain-Derived Neurotrophic Factor" → "brain_derived_neurotrophic_factor"
//   "  Sleep   Quality "                → "sleep_quality"
//   "ROS (reactive oxygen species)"    → "ros_reactive_oxygen_species"
//   "8-OHdG"                            → "8_ohdg"
//   ""                                  → null
//   "   ---   "                         → null

const CANONICAL_CODE_MAX_LENGTH = 80;

export function normalizeCanonicalCode(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Lowercase, replace non-alphanumeric runs with underscore.
  // Match the existing node_signatures.canonical_code convention.
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, CANONICAL_CODE_MAX_LENGTH);

  return slug.length > 0 ? slug : null;
}

// Convenience: type guard for places where you want to know if a
// normalization succeeded without doing the call twice.
export function hasCanonicalCode(input: string | null | undefined): boolean {
  return normalizeCanonicalCode(input) !== null;
}
