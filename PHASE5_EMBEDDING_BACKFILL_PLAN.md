# Phase 5 Embedding Backfill Plan

## Current storage approach
Embeddings are stored inline on each expansion sub-component inside `expansions.sub_components` JSONB:
- `embedding: number[]`
- `embedding_model: string`
- `embedding_version: string`

This avoids schema changes and keeps expansion payloads self-contained.

## Backfill objective
Populate embeddings for historical expansions that were created before embedding generation was introduced.

## Selection query
Target rows where at least one sub-component lacks embedding metadata.

Pseudo SQL filter idea:
- `space_id` scoped batches
- `stale = false`
- JSONB array contains component with missing `embedding`

## Backfill job design
1. Read expansions in batches (e.g., 50 rows).
2. For each row:
   - Parse `sub_components`.
   - Build embedding inputs from `name + description + component_type`.
   - Call embedding API in mini-batches.
   - Write back updated `sub_components` JSONB.
3. Mark progress in logs/checkpoints.
4. Retry transient API failures with exponential backoff.

## Safety constraints
- Do not overwrite existing embeddings with same `embedding_version`.
- Only recompute when:
  - embedding missing, or
  - `embedding_version` is older than target.
- Keep writes idempotent.

## Rollout
- Run in staging first and validate intersection quality deltas.
- Run production by space batches during low-traffic windows.
- Monitor API cost and duration.

## Validation
- % expansions with complete embedding coverage.
- Intersection false-positive rate (manual sample) before/after.
- Detection recall on known semantic pairs.
