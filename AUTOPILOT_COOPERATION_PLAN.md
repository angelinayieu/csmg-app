# Autopilot Cooperation Plan (v2)

**Status:** spec for review — implementation gated on approval.
**Scope:** fixes A+B+C+D+E from the silos-vs-cooperation trace (2026-05-30).
**Out of scope:** F (prototype briefs feeding scoring) and G (real experiment objects).
**v2 changes (from v1):** corrected §1 fact-check on `detail_research`; added §2.0 to compose with parallel-session work; tightened Fix B scope to rubric-only with null-guard; flipped Fix C to subset re-score; added elected→top-scored fallback to Fix D + E; added research notebook narration to Fix A; added §3.5 tracing mechanism-spec → final brief.

---

## 1. Why this exists

The Mechanism sidebar renders 9 sections. Several of them — planning, design inspiration, and the mechanism-spec field itself — feed evaluation **incompletely or not at all** because the artifacts each autopilot stage reads is a sliver of what's available.

Concretely, per code audit:

1. **`/research` is never called by autopilot.** [`canvas-autopilot-runner.tsx`](src/components/objective/canvas-autopilot-runner.tsx) has no `research` stage (grep confirms). Inspiration only fills when the user opens the drawer — OR via the parallel session's room-gen fire-and-forget call (see §2.0). Either way, autopilot itself never awaits it.

2. **`/score` selects `detail_research` from the entity row but the *rubric scorer* never sees it.** The route loads `detail_research` and forwards it to the *evidence* scorer (`score-indicator-evidence.ts`), but the default rubric path (`scoreVariationsWithRubric`) gets no research context. So Tier-2 rubric grading is research-blind even though the bytes are already in memory.

3. **`/score` never reads `expanded_detail.planning`.** Risks, assumes, depends_on are invisible to scoring on every tier.

4. **`refine` writes new variations** with `provenance="rd_iteration"` but nothing re-scores them. They surface in the drawer unscored.

5. **`mechanism-spec` reads `elected_variations` by disposition only.** It doesn't read `effectiveness_score` so it can't tailor the spec to the strongest variation, and it ignores `detail_research` entirely so the spec has no research anchors. **Also**: autopilot fires mechanism-spec for every feature regardless of disposition, so the elected-only filter degrades to empty arrays on unelected features — the spec runs unanchored.

6. **`enrich-chains` reads no variation data at all.** Chain narratives describe pain→feature→outcome generically; the chosen mechanism is invisible.

Net effect: rich content gets generated in parallel, but each stage's prompt is built from a small subset of what the prior stages produced.

---

## 2.0 Composition with parallel-session work

A parallel Claude session shipped 11 steps focused on **visibility** (notebook narration, brief surfacing) while this plan addresses **intelligence** (data cooperation between stages). The two are complementary, but three composition points need explicit handling:

### 2.0.a Step 1's proactive research fetch creates a race

The parallel session added a fire-and-forget `/research` call at `room/generate` time for every entity in a freshly-generated room. That covers ~12 entities per room (4 pains + 5 features + 3 outcomes). The implications:

- **Good news:** Tavily warming happens before autopilot even fires. If the user idles for ~15s after room approval, autopilot's downstream stages will find `detail_research` populated.
- **Bad news:** the fetch is unawaited. A user who clicks autopilot immediately after room approval will race — `/score` runs while Tavily is mid-flight, and the evidence scorer (which today reads `detail_research`) silently degrades. **This race exists in production today.**
- **For Fix B:** the rubric scorer null-guard (added below) is *required*, not optional, to survive this race.
- **For Fix A:** the awaited research stage **complements** Step 1 rather than replacing it. Step 1 stays as a pre-warmer (idempotent — cache hit returns existing bundle); Fix A is the synchronous gate that guarantees data is present when scoring fires.

### 2.0.b Step 8 narration wires successes into chat

`logDecision` calls in each route (e.g. `narrateMechanismSpec`, `narrateChainsEnriched`) emit notebook events. The runner's `postLog` only emits on `skipped`/`failed` — successes are narrated server-side. **Critical implication for Fix A**: the existing `/research` route has *no* `logDecision` call (verified). Adding research as a stage without adding narration means the user sees nothing in the notebook on success, which violates the "wire everything into chat" rule. Fix A must include a companion narration change.

### 2.0.c Phase B `chain_context` is already an interface field

`EnrichMechanismSpecInput` already accepts a `chain_context` field (shipped in commit `f3b7b1a`). Fix E should **extend** that interface to add `top_variation_score` + `research_anchors`, not create a parallel one. The mechanism-spec route already reads chain narratives via this field; Fix E composes by adding more inputs to the existing pathway.

### 2.0.d Brief is now a downstream multiplier

The strategy brief now displays per-feature `mechanism_of_action`, `chosen_method`, `validation_experiment`, `evidence_strength` (commits `bfca189` + `200ffc8`) via `compile-agent-build-spec.ts`. So **any quality improvement Fix E makes to mechanism-spec propagates directly to the deliverable the user reads**, without further wiring. The brief's auto-fire stage (`brief_polish`) does not re-read the spec, so it's the upstream MechanismSpec object that carries the lift. Plan §3.5 traces this.

---

## 2. The five fixes

Each fix is scoped to one or two files. All five compose without schema changes — every field already exists in `entities.expanded_detail` or `entities.detail_research`.

### Fix A — Add `research` as an autopilot stage (with narration + concurrency cap)

**File:** [src/components/objective/canvas-autopilot-runner.tsx](src/components/objective/canvas-autopilot-runner.tsx)
**Companion file:** [src/app/api/brainstorm/item/research/route.ts](src/app/api/brainstorm/item/research/route.ts)

**Insertion point:** between the existing `expand` call and the `score` call, inside the per-feature loop.

**Add stage name to type union:**

```diff
 type StageName =
   | "expand"
+  | "research"
   | "score"
   ...
```

**Add narration to the `/research` route** (the mandatory companion). At the end of the success path (after the bundle is persisted, before `NextResponse.json`):

```typescript
void logDecision(db, {
  userId: auth.user.id,
  spaceId: entity.space_id,
  subObjectiveId: entity.parent_sub_objective_id ?? null,
  proposalId: entityId,
  action: "research",  // VERIFY this action is in the CHECK constraint;
                       // if not, use existing "autopilot_iteration" with
                       // metadata.stage: "research". See user memory note
                       // about the sub_objective_decisions clobber trap.
  batchIntent: null,
  metadata: {
    entity_id: entityId,
    entity_name: entity.name,
    technical_count: out.technical.length,
    design_count: out.design.length,
    cached: false,
  },
});
```

**Concurrency cap on the runner side.** Instead of awaiting research serially per feature (slow) or firing all N in parallel (Tavily rate-limit risk), batch by 3:

```typescript
// Process features in batches of 3 to respect Tavily concurrency
// without serializing the whole room. With 5-6 features per room,
// this gives 2 rounds of ~4s each = ~8s of research time per room.
const RESEARCH_CONCURRENCY = 3;
for (let chunkStart = 0; chunkStart < room.featureIds.length; chunkStart += RESEARCH_CONCURRENCY) {
  if (cancelRef.current) return;
  const chunk = room.featureIds.slice(chunkStart, chunkStart + RESEARCH_CONCURRENCY);
  await Promise.allSettled(
    chunk.map(async (entityId) => {
      const researchRes = await fetchWithTimeout(
        "/api/brainstorm/item/research",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entityId }),
        },
      ).catch(() => undefined);
      if (!researchRes || !researchRes.ok) {
        void postLog(spaceId, {
          stage: "research",
          status: "failed",
          subObjectiveId: room.subObjectiveId,
          entityId,
          reason: reasonFromResponse(researchRes),
        });
      }
    }),
  );
}
```

**Note on idempotency:** the research route short-circuits on any prior content (research/route.ts:148-159), so re-fires from Step 1's pre-warm are free.

---

### Fix B — Rubric scorer reads planning + research (with null-guard)

**Scope note:** this fix targets the **rubric** scorer only (the default tier for autopilot). The codebase has five scorers (rubric, ensemble, evidence, personas, variation-effectiveness). Of those: evidence already consumes `detail_research`; ensemble + personas + variation-effectiveness would also benefit but are explicitly out of scope here — they're invoked only on user opt-in for higher-tier scoring, so the leverage is smaller. Follow-up PR can broaden if needed.

#### B1. Extend `RubricContext`

**File:** [src/lib/objective-canvas/score-rubric.ts](src/lib/objective-canvas/score-rubric.ts)

**Add to the `RubricContext` interface** (after the existing `variations` field):

```typescript
  /** Feature's planning block from expanded_detail. Drives:
   *   - constraint_fit (depends_on / assumes flag execution dependencies)
   *   - risk (risks list anchors the inverted risk score)
   *  Optional — if missing or empty, criteria fall back to current behavior. */
  planning?: {
    assumes?: string[];
    depends_on?: string[];
    risks?: string[];
  };
  /** Feature's research bundle from detail_research. Drives:
   *   - plausibility (technical precedents anchor "well-established" judgment)
   *   - novelty (design references calibrate "first-thing-anyone-would-suggest")
   *  Optional — if missing (race with Step 1's fire-and-forget, see §2.0.a),
   *  plausibility falls back to first_principles only. The route is REQUIRED
   *  to pass these even when null so the rubric LLM doesn't see stale prompts. */
  tech_inspiration?: Array<{ title: string; informs: string }>;
  design_inspiration?: Array<{ title: string; informs: string }>;
```

**Update `SYSTEM_PROMPT`.** Add this paragraph after the existing PART 2 baseline block:

```
PART 1 — GROUNDING (when present):

When a PLANNING block is provided, use planning.risks[] to ground the `risk` criterion (these are user-identified risks for THIS feature — score risk LOWER when these risks are plausible and unmitigated; HIGHER when the variation's design pre-empts them). Use planning.depends_on[] + planning.assumes[] to ground `constraint_fit` — a variation that requires an absent dependency or violates a stated assumption scores ≤0.4 on constraint_fit.

When TECHNICAL INSPIRATION sources are provided, use them as evidence anchors for `plausibility`. If a source's "informs" note clearly supports a variation's mechanism, you may cite it inline in the reason (e.g. "plausible — T3 shows this pattern works at scale"). Do NOT invent sources or citations.

When DESIGN INSPIRATION sources are provided, use them as the comparison set for `novelty`. A variation that exactly matches a referenced design pattern scores LOWER on novelty (it's the default); one that diverges from the references in a justified way scores HIGHER.
```

**Update `buildUserPrompt`.** Add three blocks before the `VARIATIONS TO SCORE` line:

```typescript
const planningBlock = ctx.planning
  ? `\nPLANNING (feature-level — drives constraint_fit + risk grounding):
  Assumes: ${(ctx.planning.assumes ?? []).slice(0, 5).join("; ") || "—"}
  Depends on: ${(ctx.planning.depends_on ?? []).slice(0, 5).join("; ") || "—"}
  Risks: ${(ctx.planning.risks ?? []).slice(0, 5).join("; ") || "—"}\n`
  : "";

const techBlock = ctx.tech_inspiration && ctx.tech_inspiration.length > 0
  ? `\nTECHNICAL INSPIRATION (precedents — evidence anchors for plausibility):
${ctx.tech_inspiration.slice(0, 5).map((s, i) =>
  `  T${i + 1}. ${s.title}${s.informs ? ` — ${s.informs}` : ""}`,
).join("\n")}\n`
  : "";

const designBlock = ctx.design_inspiration && ctx.design_inspiration.length > 0
  ? `\nDESIGN INSPIRATION (UI patterns — comparison set for novelty):
${ctx.design_inspiration.slice(0, 5).map((s, i) =>
  `  D${i + 1}. ${s.title}${s.informs ? ` — ${s.informs}` : ""}`,
).join("\n")}\n`
  : "";
```

Splice them into the returned prompt template (between `constraintsBlock` and `VARIATIONS TO SCORE`).

#### B2. Thread the fields from the route (with null-guard)

**File:** [src/app/api/brainstorm/item/variation/score/route.ts](src/app/api/brainstorm/item/variation/score/route.ts)

The entity load already includes `expanded_detail` and `detail_research`. Just pass them through.

At the rubric call site:

```diff
 rubricEnvelope = await scoreVariationsWithRubric({
   feature: { ... },
   room_pains: roomPains,
   room_outcomes: roomOutcomes,
   sub_objective_title: subObjectiveTitle,
   core_objective_text: coreObjectiveText,
   constraints,
   variations: existing.variations,
+  planning: (existing as { planning?: RubricContext["planning"] }).planning ?? undefined,
+  tech_inspiration: extractInspirationSummaries(entity.detail_research, "technical"),
+  design_inspiration: extractInspirationSummaries(entity.detail_research, "design"),
 });
```

Add a helper at the top of the file (inlining the normalizer logic from research/route.ts so we don't depend on cross-route imports):

```typescript
/** Mirrors normalizeStoredBundle from research/route.ts — kept inline
 *  so the score route doesn't import from another route file. Handles
 *  both the new two-rail shape ({ technical, design }) and legacy
 *  flat-sources shape (promoted to technical rail). */
function extractInspirationSummaries(
  detailResearch: unknown,
  rail: "technical" | "design",
): Array<{ title: string; informs: string }> {
  if (!detailResearch || typeof detailResearch !== "object") return [];
  const obj = detailResearch as Record<string, unknown>;

  let arr: unknown;
  if (Array.isArray(obj.technical) || Array.isArray(obj.design)) {
    // New two-rail shape.
    arr = obj[rail];
  } else if (Array.isArray(obj.sources) && rail === "technical") {
    // Legacy flat shape — promote sources into technical rail.
    arr = obj.sources;
  } else {
    return [];
  }

  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s): s is { title: string; informs?: string } =>
      typeof s === "object" && s !== null &&
      typeof (s as { title?: unknown }).title === "string",
    )
    .slice(0, 5)
    .map((s) => ({
      title: s.title,
      informs: typeof s.informs === "string" ? s.informs : "",
    }));
}
```

**Null-guard behavior:** when `detail_research` is null (race with Step 1, no autopilot fire of Fix A yet), `extractInspirationSummaries` returns `[]`. The rubric's `techBlock` / `designBlock` resolve to empty strings; the system prompt's "When TECHNICAL INSPIRATION sources are provided…" clauses simply don't activate. **No fallback prompts; no degraded scoring — just absent grounding.** This is the correct behavior: better to score without research than to invent citations.

**Net effect:** the rubric LLM now has `planning.risks[]`, `tech_inspiration[]`, and `design_inspiration[]` in its prompt **when available**, and degrades cleanly when not. Composite score formula unchanged; what changes is the *evidence basis* of the 5 component scores.

**Verification:** after this lands, score reason strings for `plausibility` should occasionally cite "T1" / "T3" etc., and `risk` reasons should reference user-named risks verbatim.

---

### Fix C — Re-score after refine (subset path, recommended)

**File:** [src/components/objective/canvas-autopilot-runner.tsx](src/components/objective/canvas-autopilot-runner.tsx)

The per-feature loop today does `expand → score → refine`. Refine writes new variations but they're never graded. v1 of this plan recommended Option 1 (always re-score all). v2 flips to **Option 2 (subset re-score with reference set)** based on the parallel-session critique:

- Token cost roughly halves vs Option 1 (new variations × all criteria + 3 reference scores for novelty calibration).
- Novelty calibration still works because the rubric prompt is built to grade "vs the OTHER variations in this set" — passing 3 already-scored variations as reference preserves that comparison.
- Notebook noise: emit the second `score` event with `metadata.rescore: true` so the timeline can group "score + rescore" as one chapter (matches NOTEBOOK_TIMELINE_PLAN.md).

**Where the subset logic lives:** in the `/score` route, not the runner. Add a request body field:

```typescript
interface Body {
  entityId?: string;
  method?: "rubric" | "simulation" | "ensemble";
  /** When true, only grade variations missing effectiveness_score.
   *  Reference set of 3 already-scored variations is included in the
   *  rubric prompt for novelty calibration. Cheaper than full re-score
   *  after refine; used by autopilot's rescore pass. */
  rescore_unscored?: boolean;
}
```

**Runner change:** after the existing refine call succeeds, fire one more `/score` with `rescore_unscored: true` and stamp the resulting decision metadata with `rescore: true`. Adds one fetch + ~1-2s per feature.

```typescript
} else if (
  scoreJson.status === "ok" &&
  !cancelRef.current
) {
  // ... existing refine call ...

  // Re-score the newly-refined variations. Subset mode: grade only
  // the variations that lack effectiveness_score, using 3 already-
  // scored variations as a novelty reference set. metadata.rescore=true
  // tags the notebook event so the timeline can group it under the
  // initial score row.
  const rescoreRes = await fetchWithTimeout(
    "/api/brainstorm/item/variation/score",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityId, rescore_unscored: true }),
    },
  ).catch(() => undefined);
  if (!rescoreRes || !rescoreRes.ok) {
    void postLog(spaceId, {
      stage: "score",
      status: "failed",
      subObjectiveId: room.subObjectiveId,
      entityId,
      reason: `rescore_${reasonFromResponse(rescoreRes)}`,
    });
  }
}
```

**Notebook metadata stamp** — at the `/score` route's `logDecision` call, when `body.rescore_unscored === true`, add `rescore: true` to the metadata block.

**Caveat on idempotency:** even at temperature 0.2 LLM scoring drifts ~±0.05 composite on re-runs. The plan no longer claims "idempotent"; it says "stable within rubric noise floor." Acceptable because autopilot fires once per autopilot click, not in a loop.

---

### Fix D — Enrich-chains uses scored variations (with elected→top-scored fallback)

**File:** [src/app/api/brainstorm/room/[subObjectiveId]/enrich-chains/route.ts](src/app/api/brainstorm/room/%5BsubObjectiveId%5D/enrich-chains/route.ts)

Current behavior: enrich-chains reads pain/outcome entities + edges but ignores `expanded_detail.variations` on feature entities. Result: chain narratives describe pain→feature→outcome generically, not specific to the chosen mechanism.

**Critical fallback (v2 addition):** autopilot fires enrich-chains for the whole room regardless of disposition. Most features won't have elected variations during the first autopilot run. **The filter must fall back to top-scored when no variation is elected:**

```typescript
function pickRepresentativeVariation(
  variations: ItemVariation[],
): ItemVariation | undefined {
  if (!variations || variations.length === 0) return undefined;
  const elected = variations.filter((v) => v.disposition === "elected");
  if (elected.length > 0) {
    // Prefer elected; if multiple, take highest effectiveness_score.
    return elected.sort(
      (a, b) => (b.effectiveness_score ?? 0) - (a.effectiveness_score ?? 0),
    )[0];
  }
  // Fallback: top-scored regardless of disposition. Returns undefined
  // only if no variation has a score either (pre-autopilot state).
  const scored = variations
    .filter((v) => typeof v.effectiveness_score === "number")
    .sort(
      (a, b) => (b.effectiveness_score ?? 0) - (a.effectiveness_score ?? 0),
    );
  return scored[0];
}
```

**Add `expanded_detail` to the feature select** (currently only id, name, entity_type, parent_sub_objective_id, causal_chain).

**In the prompt construction**, for each pain→feature→outcome chain, add:

```
Feature: ${feature.name}
  Chosen mechanism (effectiveness ${representative.effectiveness_score?.toFixed(2) ?? "—"}):
    ${representative.name} — ${representative.description.slice(0, 200)}
```

When `representative` is undefined (feature hasn't been scored yet), omit the block — the existing generic narrative still works.

**Explicit overwrite policy:** chain narratives are CURRENTLY written at room-gen time (24 rows in production today from `/room/generate`'s call to `enrich-chains`). The DB stores one narrative per edge — there's no room for two. The autopilot pass **OVERWRITES** the room-gen narrative with a variation-aware successor. Justified because:
- Autopilot has access to scores + elected variations; room-gen doesn't.
- Per-edge narrative is canonical; we don't want to render two competing strings in the UI.
- Idempotency: the route is already idempotent on re-runs of identical inputs.

**Risk:** the variation block grows the prompt ~20-30% tokens. Still under 3500-token budget at typical chain density (~3-5 features per room). Cap representative.description to 150 chars if budget becomes a concern.

---

### Fix E — Mechanism-spec consumes scores + research (with fallback + retry guard)

**Files:**
- [src/app/api/brainstorm/item/[entityId]/mechanism-spec/route.ts](src/app/api/brainstorm/item/%5BentityId%5D/mechanism-spec/route.ts)
- [src/lib/objective-canvas/enrich-mechanism-spec.ts](src/lib/objective-canvas/enrich-mechanism-spec.ts)

Current state: this route reads `expanded_detail` and pulls elected variations by disposition. It does NOT read `effectiveness_score` to identify the strongest, does NOT read `detail_research` for evidence anchors, and the existing 6-axis quality gate (`QUALITY_THRESHOLD = 0.6`) auto-retries on low specificity scores — risking a retry loop when the underlying variation is low-confidence.

**Changes:**

1. **Add `detail_research` to the entity SELECT.**

```diff
-    "id, name, entity_type, space_id, parent_sub_objective_id, causal_chain, expanded_detail",
+    "id, name, entity_type, space_id, parent_sub_objective_id, causal_chain, expanded_detail, detail_research",
```

2. **Use the elected→top-scored fallback** (same helper as Fix D — extract to a shared lib `src/lib/objective-canvas/pick-variation.ts`):

```typescript
const topVariation = pickRepresentativeVariation(existing.variations);
const electedVariations = (existing.variations ?? []).filter(
  (v) => v.disposition === "elected",
);
const variationsForSpec = electedVariations.length > 0
  ? electedVariations
  : (topVariation ? [topVariation] : []);
```

3. **Extend the existing `EnrichMechanismSpecInput`** (don't fork — see §2.0.c). Add fields to the shipped interface that already accepts `chain_context`:

```typescript
export interface EnrichMechanismSpecInput {
  // ... existing fields including chain_context ...

  /** Phase B+ — when set, the spec's quality gate uses this as a floor
   *  on the specificity axis. A high-scoring variation deserves a
   *  decisive spec; a low-scoring one deserves calibrated uncertainty,
   *  not a retry. See `accept_on_first_attempt` below. */
  top_variation_score?: number;

  /** Phase B+ — technical research anchors for research_basis field.
   *  Up to 5 items from detail_research.technical, normalized via the
   *  shared helper. */
  research_anchors?: Array<{ title: string; informs: string }>;

  /** Phase B+ — when true, the retry loop is suppressed even if the
   *  quality self-score is below threshold. Caller sets this when the
   *  low quality is *expected* (low top_variation_score) so we don't
   *  burn budget on retries that can't improve. */
  accept_on_first_attempt?: boolean;
}
```

4. **Pass them through** at the call site:

```typescript
const enriched = await enrichMechanismSpec({
  feature: { ... },
  elected_variations: variationsForSpec,
  top_variation_score: topVariation?.effectiveness_score,
  research_anchors: extractInspirationSummaries(entity.detail_research, "technical"),
  accept_on_first_attempt:
    typeof topVariation?.effectiveness_score === "number" &&
    topVariation.effectiveness_score < 0.4,
  room_pains: roomPains,
  room_outcomes: roomOutcomes,
  // ...
});
```

5. **In `enrich-mechanism-spec.ts`** update the LLM prompt to:
   - Reference `research_anchors` for the `research_basis` field — cite real titles, never invent.
   - Calibrate the `mechanism_of_action` prose to `top_variation_score`: decisive when >0.7, exploratory + flagged-uncertainty when <0.4.
   - In the quality-gate retry logic, check `accept_on_first_attempt`; if true, skip the retry and persist the first-attempt spec with a `quality_calibrated_uncertainty: true` metadata flag.

6. **Feed rubric `composite_score` into the quality gate's `specificity` axis** (Finding X2 in the v2 review). The gate currently computes specificity from the spec's own prose; bringing the variation's rubric `composite_score` in as a floor (e.g., `specificity_floor = max(self_score, composite_score)`) prevents the perverse "better grading → same retry behavior" outcome.

**Net effect:** mechanism specs now cite real precedents (no hallucinated research_basis), calibrate confidence to underlying variation quality, don't waste budget retrying unfixable specs, and AUTOMATICALLY propagate to the deliverable brief (see §3.5).

---

## 3. Order of stages after this lands

Old:
```
expand → score → refine → enrich-chains → mechanism-spec (opt-in) → deliverables (opt-in) → scan → macro_rollup → brief_polish
```

New:
```
expand → research (Fix A) → score (Fix B) → refine → rescore (Fix C)
                ↓                  ↓                       ↓
            [feeds B/D/E]    [reads planning,        [subset, novelty
                              research, fallback     reference set]
                              null-guard]
         ↓
   enrich-chains (Fix D)
                ↓
            [reads variations w/ elected→top-scored fallback;
             OVERWRITES room-gen narrative]
         ↓
   mechanism-spec (Fix E, opt-in default ON)
                ↓
            [reads chain_context (Phase B) + research + scores;
             retry guarded by accept_on_first_attempt;
             specificity floored by composite_score]
         ↓
   deliverables (opt-in, no change)
         ↓
   scan
         ↓
   macro_rollup
         ↓
   brief_polish
```

Each downstream stage now reads upstream artifacts. No more parallel-lanes.

---

## 3.5 Mechanism-spec → final brief trace

A primary motivation for Fix E is that the strategy brief is the deliverable users actually consume. Tracing the path:

1. **`mechanism-spec`** writes `expanded_detail.mechanism_spec` (MechanismSpec object with `mechanism_of_action`, `active_ingredients`, `system_components`, `dosage`, `fidelity_signals`, `research_basis`, etc.).

2. **`compile-agent-build-spec.ts`** reads `MechanismSpec` and assembles per-feature fields: `mechanism_of_action`, `chosen_method`, `validation_experiment`, `evidence_strength`.

3. **`compose-experience-brief-section.ts`** renders those fields into the brief panel the user sees.

4. **`brief_polish`** runs as the final autopilot stage but DOES NOT re-read the MechanismSpec — it polishes prose from data already loaded.

**Implication:** Fix E's quality lift (research-grounded `research_basis`, score-calibrated `mechanism_of_action`, fallback-handled `elected_variations`) propagates to the brief **without further wiring**. The plan does not need a Fix H to make this work — it already does.

**Verification (added to §6):** after Fix E lands, open the strategy brief for a feature with `top_variation_score > 0.7`. The brief should display a decisive `chosen_method` line citing at least one technical source title from `research_basis`. For a feature with `top_variation_score < 0.4`, the brief should display calibrated-uncertainty language ("explores…", "investigates…", "candidate mechanism…") rather than decisive prose.

---

## 4. What this does NOT fix

Same as v1 — these are real issues but out of scope for this PR:

- **F. Prototype briefs feeding scoring.** The "Design experiment" button generates briefs that nothing reads back. Wiring them into `plausibility` requires a new context field on `RubricContext` + a heuristic. Easier follow-up after B+E land.

- **G. Real experiments.** No `experiments` table exists. Net-new schema + UI + autopilot stage. Defer.

- **Intake-time autopilot.** Doesn't exist; today autopilot starts after rooms are approved.

- **Broadening Fix B to ensemble/personas/variation-effectiveness scorers.** Those are user-opt-in paths; rubric is the autopilot default. Broaden in follow-up.

- **Sharpen-definition entering autopilot.** If sharpen is ever added to autopilot, indicator-key preservation (`${outcome_id}::${indicator_text}`) must be enforced or the four indicator-keyed scorers will drift. Phase C currently protects this at sharpen time; no action needed unless sharpen joins the autopilot loop.

---

## 5. Files touched (final list)

| File | Change |
|---|---|
| `src/components/objective/canvas-autopilot-runner.tsx` | Add `research` stage (batch 3 concurrency); rescore after refine |
| `src/lib/objective-canvas/score-rubric.ts` | Extend `RubricContext`, system prompt, `buildUserPrompt` for planning + inspiration |
| `src/app/api/brainstorm/item/variation/score/route.ts` | Thread `expanded_detail.planning` + `detail_research` into rubric context; add `rescore_unscored` body field + subset-path branch + `metadata.rescore: true` stamp; inline `extractInspirationSummaries` helper |
| `src/app/api/brainstorm/item/research/route.ts` | Add `logDecision` call on success path |
| `src/app/api/brainstorm/room/[subObjectiveId]/enrich-chains/route.ts` | Add `expanded_detail` to feature select; include representative variation in prompt; overwrite room-gen narratives |
| `src/app/api/brainstorm/item/[entityId]/mechanism-spec/route.ts` | Add `detail_research` to entity select; use elected→top-scored fallback; pass new fields to `enrichMechanismSpec` |
| `src/lib/objective-canvas/enrich-mechanism-spec.ts` | Accept `top_variation_score` + `research_anchors` + `accept_on_first_attempt`; update LLM prompt; gate-retry guard; specificity floor from composite_score |
| `src/lib/objective-canvas/pick-variation.ts` (NEW) | Shared `pickRepresentativeVariation` helper used by Fix D + Fix E |

**No migrations. No schema changes. No new tables.** One new small lib file (`pick-variation.ts`, ~30 lines).

---

## 6. Verification plan

1. **Race condition diagnostic (Finding X1).** Before any fix lands, run autopilot immediately after room creation and check whether `detail_research` is null on any feature's row at `/score` time. Confirm the race exists today. If it doesn't (Tavily is fast enough), Fix A's urgency drops; if it does (common), Fix A is critical.

2. **Run autopilot on a fresh room with 3-4 features.** Confirm the notebook timeline shows: `expand`, `research`, `score`, `refine`, `score (rescore)`, `enrich_chains`, `mechanism_spec` (if toggled), `scan`, `macro_rollup`, `brief_polish`.

3. **Open a feature's drawer.** Verify:
   - Technical + design inspiration panels populated (Fix A working)
   - At least one variation score reason cites "T1"/"T3" or names a planning risk (Fix B working)
   - All variations including refined ones have `effectiveness_score` populated (Fix C working)
   - The chain hover/click shows the elected/top-scored variation name in the narrative (Fix D working)
   - Mechanism spec `research_basis` cites real source titles (Fix E working)

4. **Open the strategy brief** for a high-scoring feature (`top_variation_score > 0.7`) — confirm decisive `chosen_method` language with research citation. For a low-scoring feature (`top_variation_score < 0.4`) — confirm calibrated-uncertainty language. (§3.5)

5. **Quality gate diagnostic (Finding X2).** Inject a feature with `top_variation_score = 0.3` and confirm mechanism-spec runs ONCE with `quality_calibrated_uncertainty: true` metadata, not in a retry loop. Confirm the gate's specificity axis honors the `composite_score` floor.

6. **Notebook events.** Confirm one `research` event per feature; second `score` event carries `metadata.rescore: true`; chain enrichment narrative event references variation names.

7. **Re-run autopilot.** Confirm all stages idempotent (within rubric noise floor — ±0.05 composite score drift is acceptable). No duplicate variations, no new notebook rows except cached-hit acknowledgments.

---

## 7. Implementation order

Recommended:

1. **Fix B first** (highest leverage, lowest risk, two files). Score gets smarter immediately — even surviving the race with Step 1 via null-guard.
2. **Fix A second.** New stage in the runner + narration. After B is in, A makes B even better.
3. **Fix C third.** Two files (runner + score route subset path).
4. **Fix E fourth.** Three files. Independent of A/B/C; benefits all.
5. **Fix D last.** Highest-traffic route. Verify token budget after change.

All five can land in one PR or be split. **Hard dependency:** if Fix B lands alone, the null-guard MUST be in place — without it, the race with Step 1 silently degrades scores. With the null-guard, Fix B is safe to ship before A.

---

## 8. Open questions (v2 resolutions)

**Q1 — Option 1 vs Option 2 for re-score (RESOLVED → Option 2).**
v1 recommended Option 1 (always re-fire all variations). v2 flips to Option 2 (subset re-score with top-3 reference set) per the parallel-session critique. Cheaper (~40% fewer tokens), same novelty calibration, second event tagged `metadata.rescore: true` for notebook grouping.

**Q2 — Inspiration verbosity (RESOLVED → verbatim).**
Pass 5 sources × 120 chars = 600 chars added to prompt. Well under 3500-token budget. No summarization pass needed.

**Q3 — Enrich-chains scope (RESOLVED → top-1).**
Include only the representative variation (elected → top-scored fallback) per chain. Chain narratives are about "the mechanism", not the full menu.

**Q4 — Low-confidence mechanism-spec behavior (REFINED).**
v1 recommended "run anyway with calibrated uncertainty." v2 adds: **the quality-gate retry MUST be suppressed when low quality is caused by low variation score** (`accept_on_first_attempt: true`). Otherwise the gate burns budget on retries that can't fix the underlying input.

**Q5 — NEW: how do we handle existing room-gen chain narratives during Fix D's overwrite?**
Resolved: autopilot overwrites unconditionally. Justified because autopilot has access to scores; room-gen doesn't. Per-edge narrative is canonical (one slot per edge).

Ping before implementation if any of these need re-opening.
