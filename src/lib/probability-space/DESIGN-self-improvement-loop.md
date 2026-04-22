# Self-improvement loop — design spec

**Status**: design spec (pre-implementation). Ships with PR 6 (axis exemplar
library) + companion table + scorer wiring.

## Problem

Without a feedback loop, the axis exemplar library stays frozen at hand-written
seeds. Every run produces the same caliber of output regardless of whether
earlier runs were strong or weak. The product doesn't get smarter over time.

## Decision

A four-stage loop: `user rates → candidate capture → semantic score → promotion
to exemplar library`.

```
Run completes
     ↓
User rates the run (1–5 stars, per-axis or overall)
     ↓
If ≥ 4 stars:
   Per-axis outputs captured as candidate_exemplars
     ↓
Semantic scorer reviews each candidate against a quality rubric
     ↓
If semantic score ≥ 0.8:
   Candidate promoted into axis_exemplars table
     ↓
Next time that axis runs for a similar domain:
   pattern-retrieval pulls top-K highest-scored exemplars
   → seeded into getAxisPrompt's exemplars[] parameter
   → few-shot seeding improves output caliber
```

## Tables (new)

### `axis_candidate_exemplars`

Holds every output from a run the user rated ≥ 4. Reviewed by the scorer;
either promoted or archived. Never deleted — useful audit trail.

```sql
CREATE TABLE axis_candidate_exemplars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  axis text NOT NULL,
  -- Input the axis ran on + output it produced
  input_gist text NOT NULL,         -- first 200 chars of run's initial_prompt
  output_excerpt text NOT NULL,     -- axis_summary + top-3 entity descriptions
  output_full jsonb NOT NULL,       -- full LLM output for later retrieval
  -- User signal
  user_rating int NOT NULL CHECK (user_rating BETWEEN 1 AND 5),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Scorer signal (populated async, null until reviewed)
  semantic_score numeric,
  semantic_review_at timestamptz,
  semantic_notes text,
  -- Lifecycle
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN (
    'pending_review', 'promoted', 'archived'
  )),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### `axis_exemplars`

The live library used by pattern retrieval. Only semantically-scored promotions
land here.

```sql
CREATE TABLE axis_exemplars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES axis_candidate_exemplars(id) ON DELETE CASCADE,
  axis text NOT NULL,
  -- Shape matches AxisExemplar in axis-prompts.ts
  input_gist text NOT NULL,
  output_excerpt text NOT NULL,
  -- Retrieval signals
  embedding vector(1536),            -- pgvector of input_gist, for domain-aware retrieval
  use_count int NOT NULL DEFAULT 0,  -- telemetry: how often this exemplar was retrieved
  -- Quality provenance
  user_rating int NOT NULL,
  semantic_score numeric NOT NULL,
  -- Filters
  domain text,                       -- classified domain of input_gist
  question_type text,                -- classified type
  created_at timestamptz NOT NULL DEFAULT now()
);
```

## Stage 1 — User rating capture

Shown on run completion in the HUD:

> **How useful was this analysis?** ⭐⭐⭐⭐⭐ *(optional — helps the system
> learn which axes produce high-caliber outputs for this kind of question)*

Rating is **per-run overall**. Per-axis rating is a later nicety if telemetry
shows users differentiate. For v1, overall rating ≥ 4 flags every axis output
from that run as a candidate.

Optional free-text "what stood out / what missed?" field for qualitative
telemetry.

## Stage 2 — Candidate capture

When rating lands, a background job inserts one `axis_candidate_exemplars` row
per axis that ran in that run. Fields:

- `input_gist` = first 200 chars of `pipeline_runs.initial_prompt`
- `output_excerpt` = `axis_summary` + first 3 entities' `name + description`
- `output_full` = full JSON from `probability_space_runs`'s persisted axis
  output (requires a follow-up migration to add `axis_output_json` column)
- `user_rating` = the rating
- `status = "pending_review"`

Cheap — just writes. Runs async, no latency penalty to UX.

## Stage 3 — Semantic scorer

A scheduled job (hourly cron) picks up `pending_review` candidates and scores
each against a rubric. Scoring is done by an LLM prompted as a
peer-reviewer using this rubric:

### Quality rubric (peer-reviewer LLM prompt)

For each axis output, score 0..1 on five dimensions:

1. **Specificity (0.25)**: every entity grounded in the input? No generic
   "Revenue" without the input's specific revenue mechanism?
2. **Mechanism depth (0.25)**: does each relationship name a SPECIFIC
   mechanism vs a label? ("A → B because X" vs "A affects B")
3. **Distinctness (0.15)**: entities non-redundant? No two entities describing
   the same underlying concept?
4. **Coverage (0.15)**: does the axis actually surface 6+ high-quality entities
   this situation warranted on this axis?
5. **Insight density (0.20)**: does the `axis_summary` crystallize a
   non-obvious observation, or just recap the input?

Final `semantic_score = sum of weighted dimensions`. Score ≥ 0.8 → promote.
Score < 0.8 → archive (keep the row; use for failure analysis).

The scorer is model-as-judge — not perfect but directionally correct. Spot-
check quarterly: sample 20 promotions, manually verify quality; recalibrate
the rubric if drift appears.

## Stage 4 — Promotion to exemplar library

For promoted candidates:

```sql
INSERT INTO axis_exemplars (
  candidate_id, axis, input_gist, output_excerpt,
  embedding, user_rating, semantic_score, domain, question_type
) VALUES (...);

UPDATE axis_candidate_exemplars SET status = 'promoted' WHERE id = ...;
```

`embedding` is computed on `input_gist` using OpenAI `text-embedding-3-small`
so pattern-retrieval can find "exemplars similar to THIS new input" rather
than random sampling.

## Stage 5 — Retrieval at axis-prompt time

Extend the generator endpoint (PR 2) to call a new helper:

```ts
// src/lib/probability-space/axis-exemplar-retrieval.ts
export async function retrieveAxisExemplars(
  db: AnyDb,
  opts: {
    axis: ProbabilitySpaceAxis;
    inputText: string;
    domain?: DomainTag;
    questionType?: QuestionType;
    limit?: number;  // default 2
  },
): Promise<AxisExemplar[]> {
  // 1. Embed inputText
  // 2. pgvector similarity search on axis_exemplars where axis matches,
  //    filtered by domain + questionType if provided
  // 3. Return top-K with highest combined score (cosine × semantic_score)
}
```

Plug result into `getAxisPrompt({ ..., exemplars: retrieved })`. `axis-prompts.ts`
already slots them into the system prompt as few-shot examples (section at
lines 362–380 per current implementation).

## Honest caveats

- **Cold start**: for the first ~50 runs, exemplar library is empty + all axes
  run with no few-shot. Manual seeds (3 strong examples per axis, hand-
  written) cover this.
- **Model-as-judge drift**: quarterly human calibration required to keep the
  scorer from gaming itself (if scorer and generator use the same model, they
  can converge on a shared failure mode).
- **User rating sparsity**: users won't rate every run. Expect ~10% rating
  rate → ~100 ratings per 1000 runs → ~40 promotions per 1000 runs given 40%
  hit rate. That's enough signal within a quarter to start differentiating
  axes; less than the volume needed for per-(axis, domain) calibration.
- **Adversarial cases**: a user rating 5 on a run with weak output (to placate
  or by mistake) poisons the candidate pool. The semantic scorer's 0.8 floor
  is the quality gate. Don't skip the scoring step.

## Rollout order

1. PR 6: ship tables + `axis_exemplars` retrieval stub (empty library)
2. PR 6.1: ship user rating UI + candidate capture job
3. PR 6.2: ship semantic scorer cron
4. PR 6.3: ship retrieval integration with `getAxisPrompt`
5. Monitor promotion rate + use_count telemetry for 4 weeks
6. Adjust thresholds (0.8 promotion floor, 4-star rating trigger) if needed

Total shipping cost: ~2 days across the PR 6.x series.
