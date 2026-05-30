# Mechanism Algorithm-Depth — Build Spec

> Fix: the tech spec is missing the *exact algorithm inside each mechanism*, and the
> underlying generation is too thin to supply it. This makes the internal info
> buildable, surfaces it in the tech spec, and reorders generation so the algorithm is
> coined FROM the (finalized) data flow. Verified against code 2026-05-29.

## Diagnosis (verified)

- The Strategy Brief is a *strategy memo* (experiments, validity matrices, deep-dives,
  rollback, telemetry) — that's the "useless info" for a build. The real tech spec is the
  **AgentBuildSpec** (`compile-agent-build-spec.ts`), which is leaner + structured.
- **The AgentBuildSpec HAS** how-it-works (`mechanism`) + the **data flow**
  (`data_flow.per_feature` steps + `cross_feature`). It **does NOT carry the per-feature
  algorithm** — `AgentBuildFeature` = {mechanism, components, inputs, acceptance, scope,
  depends_on, experience}; `implementation_methods` + `decision_record` are dropped.
- **No real algorithm depth exists.** `enrich-mechanism-spec.ts`'s `implementation_methods`
  are *named* (rule-based / ML / hybrid) with a **one-line `how`** — no computation, params,
  thresholds, or complexity. So even if surfaced, it's a vibe, not a spec.

## 1. Deepen the generation — new `AlgorithmDesign` (the substance fix)

Add to `enrich-mechanism-spec.ts`, attached to the **chosen** implementation method:

```ts
export interface AlgorithmParameter { name: string; default_value: string; tunes: string; }
export interface AlgorithmDesign {
  name: string;                 // "Goal-conditioned relevance ranking w/ recency decay"
  inputs: string[];            // data consumed — MUST come from the data flow's produces[]
  computation: string[];      // ordered, concrete transformation steps (the real logic)
  core_function: string;      // the scoring/ranking/decision formula or pseudocode
  parameters: AlgorithmParameter[]; // tunables w/ defaults (α, λ, threshold, K …)
  thresholds: string[];       // gating conditions ("drop if score < 0.62")
  data_structures: string[];  // "HNSW vector index over content embeddings", caches …
  complexity: string;         // "O(log N) ANN retrieval + O(M·d) scoring"
  failure_modes: string[];    // cold-start, drift, etc.
}
```

**Prompt upgrade (the load-bearing part):** for the `decision_record.chosen` method, instruct:
*"You are a staff engineer. Design the ACTUAL algorithm an engineer could code. Ground EVERY
input in the data flow's produced tokens — do not invent data not produced upstream. Give the
computation steps, a concrete core_function (formula or pseudocode), tunable parameters with
defaults, gating thresholds, data structures, complexity, and failure modes. No restating the
method name; no marketing."*

## 2. Surface it + lean the tech-spec template

- `compile-agent-build-spec.ts`: add `algorithm: AlgorithmDesign | null` to `AgentBuildFeature`.
- Render order per feature, and **nothing else** in the tech-spec view:
  **mechanism-of-action → data flow (steps) → the algorithm → acceptance criteria.**
- Keep experiments / validity matrices / deep-dives / rollback in the **Strategy Brief**, out
  of the tech spec.

## 3. Derive-after-choice sequence (fixes the consistency flaw)

Today the algorithm + data flow are **co-generated per feature in one call** — so the algorithm
isn't coined *from* a finalized data flow, and nothing re-derives after ranking. Reorder:

1. Pre-generate rooms.
2. Score / refine / **rank → choose** the winning mechanisms.
3. **Derive the data flow for the chosen state** (consistent, cross-feature threaded).
4. **Coin the algorithm grounded on that data flow** (available data constrains + enables it).
5. Compile the lean tech spec.

Dependency `data flow → algorithm` is the point: you can't design the method until you know what
data it receives.

## The difference, concretely — "Contextual Content Filter"

**TODAY (one-line `implementation_method`):**
> *ML-Based Filtering* — "Uses ML models to dynamically filter and prioritize content."
> required_data: "User goals, past activities, context data" — **not buildable.**

**DEEPENED (`AlgorithmDesign`, grounded on its real data flow
`user_context_data → relevance_scores → filtered_content → prioritized_content`):**
> **name:** Goal-conditioned relevance ranking with recency decay
> **inputs:** user_goal_embedding, candidate_content_embedding, content_age_days, past_engagement_vector
> **computation:** ① embed active goal → ② cosine(goal, candidate) per item → ③ recency weight
> `e^(−λ·age)` → ④ blend `α·cosine + β·engagement_affinity`, ×weight → ⑤ gate < τ → ⑥ sort desc, top-K
> **core_function:** `score = (α·cos(g,c) + β·affinity(u,c)) · e^(−λ·age)`
> **parameters:** α=0.7 (goal weight) · β=0.3 (engagement) · λ=0.05/day (decay) · τ=0.62 (gate) · K=20
> **data_structures:** HNSW ANN index over content embeddings; per-user engagement-vector cache
> **complexity:** O(log N) ANN retrieval + O(M·d) scoring (M candidates, d=dim)
> **failure_modes:** cold-start (no goal embedding → popularity fallback); embedding drift

That second block is what a coding agent can actually build from — and it only exists once the
generation is deepened.

## Coordination

`enrich-mechanism-spec.ts` (gen) + `compile-agent-build-spec.ts` (surface) are **parallel-owned**.
This is a hand-off / coordinated change. The macro-rollup → score/rank → data-flow → algorithm
reorder also touches the autopilot sweep (`room-fill-runner.tsx`, parallel-owned).
