# Merge resolver — two-pass dedup design

**Status**: design spec (pre-implementation). Ships with PR 4.

## Problem

At merge time the pipeline reconciles ~75–115 candidate entities:

- Decompose Pass 1+2 produces 15–40 entities (monolithic view of input)
- Each of N per-axis generators (typically 4–7) produces 6–18 entities
- Same concept appears multiple times in lexically varied forms
- A single-pass 0.82 cosine-similarity dedup misses obvious duplicates ("customer
  retention" vs "user churn rate" are semantically identical but may score 0.78)
  while auto-merging legitimately distinct concepts that happen to embed close
  (0.83–0.85 is the treacherous band)

## Decision

Two passes + one human-in-the-loop band, with escalating rigor:

### Pass 1 — Exact / near-exact normalized match (no user prompt)

```
normalize(name) = toLower(trim(stripPunct(name)))
levenshtein(normalize(a), normalize(b)) / max(|a|, |b|) <= 0.15
```

Auto-merge when either:
- Identical after normalization
- Levenshtein-normalized distance ≤ 0.15 (catches typos + trivial morphology:
  "customer retention" ≈ "customer retention rate")

Rationale: this is deterministic, cheap, and has near-zero false-positive rate.
The 15% threshold is empirically safe for 3-word+ entity names; for <3-word
entities we tighten to exact match to avoid collapsing "user" and "users" when
one refers to individual users and the other to a user base.

### Pass 2 — Embedding cosine with three bands (confident / uncertain / distinct)

Compute OpenAI `text-embedding-3-small` on `name + ". " + description` for each
Pass-1-survivor. Pairwise cosine:

| Cosine sim | Action | UX |
|---|---|---|
| ≥ 0.88 | Auto-merge | No prompt. Merge receipt shown in merge summary. |
| 0.75–0.88 | **Suspected-duplicate chip** | User sees chip with both entities + similarity score + merge/keep-separate buttons. Default behavior: keep separate if user doesn't act within 5s of merge animation completing. |
| < 0.75 | Distinct | Keep both. |

Rationale: 0.88 is a defensible auto-merge floor (empirically catches
paraphrases without collapsing nuanced distinctions). The 0.75–0.88 band
contains the hard cases that shouldn't be silently collapsed — surface them to
the user as actionable chips rather than make an irreversible decision.

Below 0.75, entities are distinct enough that auto-keeping both produces fewer
false-negative leverage signals than the dedup would catch.

## Concrete implementation sketch

```ts
// src/lib/probability-space/merge-dedup.ts

interface CandidateEntity {
  id: string;              // temp id (not yet persisted)
  name: string;
  description: string;
  appearsInAxes: ProbabilitySpaceAxis[];
  weight: number;
  // provenance: which run emitted this (decompose | axis generator)
  source: "decompose" | ProbabilitySpaceAxis;
}

interface MergeGroup {
  canonical: CandidateEntity;        // the representative
  absorbed: CandidateEntity[];       // merged into canonical
  leverage: number;                  // computed post-merge
}

interface DedupSuspect {
  a: CandidateEntity;
  b: CandidateEntity;
  cosine: number;
  // User choice: merge | keep-separate | pending (no decision yet)
  resolution: "merge" | "keep_separate" | "pending";
}

export interface DedupResult {
  groups: MergeGroup[];
  suspects: DedupSuspect[];          // 0.75–0.88 band
}

export async function runTwoPassDedup(
  candidates: CandidateEntity[],
  embed: (texts: string[]) => Promise<number[][]>,
): Promise<DedupResult>;
```

### Pass 1 algorithm

```
1. union-find over normalized-name equivalence classes
2. for each pair in same class: auto-merge into the earliest-added canonical
3. return survivors (one per class)
```

### Pass 2 algorithm

```
1. batch-embed all survivor (name + description) strings — single API call for ~100 entities
2. pairwise cosine over the upper triangle
3. partition pairs into: auto-merge (≥0.88), suspect (0.75–0.88), distinct (<0.75)
4. for auto-merge pairs: union-find → merge into canonical
5. for suspect pairs: emit SpaceDedupSuspectEvent (new event type) with both entities + cosine
```

## New event type

Add to `pipeline-events.ts`:

```ts
export interface SpaceDedupSuspectEvent {
  type: "dedup_suspect";
  pairId: string;                    // deterministic hash of (aId, bId)
  a: { name: string; description: string; axes: ProbabilitySpaceAxis[] };
  b: { name: string; description: string; axes: ProbabilitySpaceAxis[] };
  cosine: number;
}
```

Painter handles it by rendering a small suspect-chip over the merge animation's
center — user can click `merge` / `keep separate`. If no action within 5s, the
chip expires + pair stays separate (default safe).

## Leverage scoring post-merge

Once groups are frozen:

```ts
leverage(group) =
    0.4 * (|group.appearsInAxes| / totalAxesInRun)
  + 0.3 * (mean(weight) across absorbed + canonical)
  + 0.3 * (graphCentrality(canonical) post-merge)
```

Entities with leverage ≥ 0.7 get the gold-ring treatment on the final unified
KG. This is the "cross-space leverage" signal.

## Rollout

- Ship as part of PR 4
- Log all dedup decisions (merge / suspect / distinct) with cosines for a
  telemetry window
- After ~50 runs, check false-positive rate on auto-merges (users un-merging
  the canonical) and false-negative rate (users manually merging two distinct
  entities)
- Adjust thresholds only if telemetry shows consistent drift (don't chase
  single-run anecdata)
