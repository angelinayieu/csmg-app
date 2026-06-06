# Clarification Engine — Implementation Plan (UI/UX + build sequence)

> Written 2026-06-05. The orchestration layer that turns the shipped intake
> depth/salience loop into a **continuous, self-driving uncertainty-reduction
> engine**: ambiguities are resolved *internally* by an agent that diverges,
> questions itself, converges, builds the KG + glossary, and surfaces **only
> clean, title-first artifacts** to the board.
>
> **This doc orchestrates — it does NOT re-spec — these existing plans. Reuse, don't fork:**
> - `DIVERGE_CONVERGE_ARCHITECTURE_PLAN.md` — the converge/diverge ops + 3-tier KG model.
> - `DEPTH_UNFURL_PLAN.md` — "one hero + a count" progressive disclosure (the anti-clutter law).
> - `INTAKE_TO_BRIEF_SURFACING_PLAN.md` — surface to the surfaces the user actually looks at.
> - The shipped 6-step `prompt_sharpening` loop (depth → micros → address → resolve → re-frame → emergent).

---

## 0. The one-paragraph vision

When a prompt lands, the goal rail appears **immediately** with the distilled
title (proof the agent is working), then fills with uncertainty metrics the
moment they generate. Each ambiguity the system finds can be **AI-resolved
internally**: the agent runs its *own* diverge→converge loop — mapping the
landscape of possible meanings/features, then questioning itself to prune and
align — gradually draining that ambiguity's uncertainty while writing the
durable result into the **knowledge graph + glossary**. The board never fills
with the churn. Only the **one highest-leverage, title-self-explanatory
artifact** per resolution surfaces; everything else lives in the Library,
reachable on demand. The loop never truly "ends" — as the agent generates, it
surfaces new questions, and the clarity meter keeps moving.

---

## 1. Current state (grounded, verified by code read 2026-06-05)

**The shipped 6-step loop** (single JSONB blob `spaces.synthesis_data.objective_canvas.prompt_sharpening`):

| # | Step | Trigger | Route / fn |
|---|------|---------|-----------|
| 0 | Base sharpen (fast) | intake submit | `prompt-sharpening` |
| 1 | Depth + micro-decomposition | card mount | `sharpening-depth` → `generateSharpeningDepthForSpace` |
| 2 | Address micros (Tier-0, no LLM) | rail open / board edit / refresh | `micro-address` → `matchMicros` |
| 3 | Resolve (Studio or AI auto-resolve) | user | `resolutions` / `auto-resolve` |
| 4 | Apply / re-frame + glossary write-back | after resolve | `apply-resolutions` |
| 5 | REFRESH in place | event | `REFRESH_SHARPENING_EVENT` |
| 6 | Emergent re-scan (Tier-1, board-aware) | manual / post-AI sweep | `sharpening-emergent` → `generateEmergentSalienceForSpace` |

**Data model.** `SalienceAnnotation` (macro) → `micro_questions[]` (each: `q`,
`uncertainty`, `addressed_by[]` gradient, `resolved_at?`). Macro `uncertainty`
= mean of micro uncertainties. `Resolution` (per `concept_slug`) carries
`source: manual|voice|ai`, `confidence`, `needs_review`. New emergent rows are
stamped `emerged_at`.

**What's solid (up to standard):** soft-fail throughout, race-safe writes
(re-read + abort on shape divergence), real backward-compat (legacy artifact →
"1 implicit micro = the macro"), the loop is fully wired (no orphan routes),
honest AI-confidence calibration, AI-activity strip with ⚠ low-confidence +
click-to-review.

**The inert half (must fix — these are the foundation):**
1. **`addressed_by[]` is write-only.** Tier-0 computes the addressing gradient on
   every rail-open/edit and persists it; **no UI reads it.**
2. **Per-micro `resolved_at` is never written.** Resolution is macro-only → micro
   dots fill all-at-once → *a small resolution clears the whole macro* (the exact
   thing we said is wrong).
3. **Macro `uncertainty` is frozen** at generation; never recomputed as work lands.

**Reusable infra (the engine is assembly, not new construction):**
`CANVAS_OPERATIONS` registry (`canvas-operations.ts`, contracts text/entity/room +
`hidden` flag), `auto-resolve`, `converge-diverge.ts`, `micro-matcher.ts`,
`generate-emergent-salience.ts`, `buildSpaceContext`, `research-service.ts` +
`web-search.ts` + `tavily-client`, `specforge/quality-critic.ts`, the KG
(`library_objects` + `object_links`), `generate-glossary.ts`, and the per-object
**expanded sidebar** `object-detail-drawer.tsx` + its detail route
`…/library/objects/[objectId]` (already renders title/body, cluster graph, taste
receipt, provenance, links, siblings via a reusable section pattern — see §6.5).

---

## 2. The internal resolution agent (the core new piece)

When an ambiguity is AI-resolved, run a **bounded recursive diverge→converge
loop, headless** (nothing intermediate deploys to the board):

```
resolveAmbiguity(macro, budget):
  frontier := [macro]                      # macro + later its emergent children
  while frontier not empty and budget.remaining() and macro.uncertainty > τ_done:
    item := frontier.pop()

    # PLAN — pick the operation(s) for THIS item's open micros (see §3)
    plan := planOps(item.micro_questions, context(item))

    for step in plan (ordered: define concepts → decompose goals → spec levers):
      if step.needs_research: rag := groundIfFactual(item)         # §5
      candidates := diverge(step.op, item, context+rag)            # map the landscape

      # CONVERGE — the agent questions ITSELF
      kept := converge(candidates, objective, taste)               # prune + align + dedupe
      for c in kept:
        node := writeKG(c, bornWithMetadata(item, step, c))        # library_objects + links
        glossary.maybeDefine(c)                                    # if c is a concept
        addressMicros(item, node)                                  # Tier-0 confirms coverage
        # SELF-QUESTION — does this new node OPEN a new gap?
        newMicros := questionSelf(node)                            # node-level emergent
        frontier.push(newMicros where uncertainty ≥ τ_surface)

    recomputeUncertainty(item)              # from micro state → stream to rail
  return { resolvedGlossary, kgNodes, residualUncertainty }
```

**Why diverge→converge→self-question, not a single answer:** a one-shot answer
to "what does *remix* mean" just asserts. The loop instead *maps* (diverge: style
transfer / stem blend / generative mashup / playlist remix), *prunes against the
objective + the user's taste* (converge), then *asks what the chosen meaning now
demands* (self-question: "if remix = stem blend, where do stems come from?") —
which becomes the next frontier node. That recursion is what "gets the full
landscape + builds the KG + glossary."

**Convergence + budget (must be bounded):**
- `τ_done` — stop a branch when macro uncertainty falls below threshold.
- `τ_surface` — only push self-questions above this uncertainty (ignore trivia).
- **Token/step budget** per resolution (reuse a `budget` like the workflow model);
  hard cap on depth and total nodes. Log what was dropped (no silent truncation).
- **Loop-until-dry**: stop when K consecutive self-question rounds add nothing new.

**Reuses:** `diverge`/`converge` from `converge-diverge.ts` + `CANVAS_OPERATIONS`;
`addressMicros` from `micro-matcher.ts`; `questionSelf` from
`generate-emergent-salience.ts` (scoped to one node instead of the whole board);
KG writes via `library_objects`/`object_links`; glossary via `generate-glossary`.

**Headless harness:** runs server-side as one orchestrated route
(`POST /api/objective/[spaceId]/clarify` `{ conceptSlug | "all" }`), persisting
into the same artifact + KG. Progress streams to the client via the existing
`pipeline_runs`/SSE pattern (see `project_event_bus_architecture`) so the rail/card
animate without polling.

---

## 3. Reasoning quality — how the agent picks mechanisms (the "planner")

A thin **clarification planner** decides which operation reduces each micro:

- **Typed op menu.** Extend each `CanvasOperation` with `produces` + `reduces`
  descriptors (e.g. `define → a definition (concept)`, `decompose → sub-features
  (goal/scope)`, `variations → alternatives (lever)`, `questions → clarifiers`,
  `research → facts (factual)`). The registry already has `contract` + `hidden`.
- **Two-tier routing.** (A) deterministic `kind → candidate ops` *prior* (guardrail,
  prevents nonsense), then (B) an LLM that **selects + orders** from that
  constrained menu and emits, per step:
  `{ op_id, targets_micro_ids[], rationale, needs_research }`.
- **Score by expected reduction:** pick ops maximizing
  `Σ(micro.uncertainty × predicted_coverage) / cost`.
- **Predict → verify (closes the loop):** planner predicts which micros a step will
  address; after the op runs, the **Tier-0 matcher confirms** predicted-vs-actual.
  Mismatch → re-plan. This is the quality signal and it reuses the matcher we're
  already wiring in Step 1.
- **Dependency ordering:** pin **concepts first** (definitions), because
  `decompose`/`make_plan` reason far better once terms are nailed.

---

## 4. Metadata quality — aligned, focused, reasoning-ready outputs

Two levers make outputs high-quality and *theirs*, not generic:

1. **Concept-scoped context (not whole-space).** For the item being resolved,
   assemble ONLY: the macro phrase + its micros + `candidate_readings` + the user's
   `resolution` (their taste) + glossary terms by `concept_slug` + the
   `object_links` neighborhood + `why`/`leverage`. Reuse `buildSpaceContext` but
   **scope it to the concept neighborhood**. This tight bundle *is* the "highly
   aligned + focused metadata."
2. **Born-with metadata on every generated node.** Each KG node arrives carrying
   `{ concept_slug, addresses_micro_ids[], op_id, source_ambiguity, confidence,
   candidate_reading_used }`. This makes it (a) matchable by Tier-0 (loop closes),
   (b) addressable, (c) reasoning-ready downstream. Without it, outputs are orphans.
3. **Quality gate.** Run each node through the existing `specforge/quality-critic`
   pattern: does it address the targeted micro + match the chosen reading? Reject /
   regenerate before it's allowed to surface.

---

## 5. Web research — conditional, and the discrimination IS the intelligence

Infra exists (`research-service.buildRagBlock`, `web-search.ts`, `tavily-client`,
`ground-objectives`; already used by the decompose RAG block + converge-diverge
grounding + deep-synthesize). The planner sets `needs_research` per item:

- **Research FACTUAL / DOMAIN / LANDSCAPE ambiguities** — "what does *remix* mean
  legally," "what do competitors do," "is X feasible." Grounding pre-pass → generate.
- **Do NOT research INTENT / TASTE / SCOPE ambiguities** — "what *flow mood* means
  to *you*," "which users you target." Researching these yields generic,
  mis-aligned output. Use the user's taste or ask them.
- Borrow `pipeline/question-type-classifier.ts` to classify factual-vs-intentional.

---

## 6. Surfacing policy — what reaches the board (answers "what's the final card?")

**The board law (from `DEPTH_UNFURL_PLAN.md`, made strict): one hero + a count,
and the Title-Sufficiency Test.**

- **Title-Sufficiency Test:** a card reaches the **board** ONLY if its *title alone*
  conveys its function. If it needs a paragraph, it stays in the **Library/KG** and
  does not get a board face. (Direct answer to "we can't afford lots of
  descriptions on the board.")
- **One hero + a count:** the internal loop may discover many features; surface the
  **single highest-leverage** one per resolution as a board card + "**+N in
  Library**." The rest live in the KG, one click away.
- **Card face contract (title-first):** `title` = the function (≤6 words, named by
  utility, no buzzwords) · ONE ≤14-word line of HOW/payoff that does **not** restate
  the title (the rule the decompose-cards prompt already enforces) · a `kind` tag ·
  a provenance dot. Nothing else on the face.

**The ambiguity card's lifecycle (what the user sees):**
1. **Question state** — the forked "Connection" card (as in the screenshot): the
   ambiguity + its clarifying question + an **AI-resolve** button.
2. **Resolving state** — on click, the card *transforms in place* (no second card):
   a soft shimmer + the uncertainty meter draining + **one ephemeral activity line**
   ("diverging · 4 readings" → "converging · kept 2" → "defining *remix*"). This is
   the only place the self-questioning is visible, and it's one line, not clutter.
3. **Resolved state** — on convergence the card **collapses to a "Resolved ✓"
   chip** (if the result is just a definition → it lands in the glossary, no board
   card) OR **becomes the one hero title-first card** (if it's a real keep-able
   artifact). The question is *replaced*, never left alongside its answer.

**Hide vs show:**
- **Hide (→ artifact + audit, never on the board face):** micro-questions,
  intermediate diverge candidates, rejected readings, the operation trace, the
  self-questions. (Aligns with `feedback_structural_events_only`: structural
  artifacts on canvas, thinking traces in the drawer.)
- **Show (board):** the one hero card, the rail clarity climb, the glossary growth.
- **Show on demand (drawer):** click any resolved artifact → the full reasoning
  trace — what was diverged, what was pruned and *why*, which ops ran, provenance,
  confidence. This is where all the hidden richness is reachable without cluttering.

---

## 6.5 The output object — rich feature-proposal cards + their expanded sidebar

**The deliverable of every resolution is a feature/proposal card BORN with rich
metadata** — a clean title-first face on the board, full structured depth in the
expanded sidebar. This is what makes §6's hide/show safe: the face stays a title; the
richness lives one click away.

**Verdict (verified 2026-06-05): the container + the sidebar already exist; only the
GENERATION is missing.**
- ✅ **Storage** — `library_objects` already has `card_face` / `content_snapshot` /
  **`evaluation`** JSONB + `object_links`. The rich block goes in `evaluation`. **No migration.**
- ✅ **Display** — `object-detail-drawer.tsx` (the docked, non-occluding expanded
  sidebar) already renders sectioned content — title/body, `Gallery`, `ImageEvidence`,
  the object **cluster graph**, a **taste receipt**, **provenance** from `source_ref`,
  links by relation, siblings — via a reusable `sectionLabel`/`section` pattern. The
  detail route returns the full row + neighborhood.
- ❌ **Generation** — the op that mints forked features (`decompose-cards`) writes THIN
  cards (title + ≤14-word line + `subsystem` + feeds/depends). It writes nothing to
  `evaluation`: no mechanism, no "which ambiguity/micros this resolves," no readings
  considered, no confidence, no data-needed, no citations.

So the work is: **(a) generate the rich block, (b) add ~4 sections to the drawer to show it.**

**The `feature_proposal` block** (stored in `library_objects.evaluation`, no migration):

```jsonc
{
  "mechanism": "string — how it works, 1–3 lines",            // the HOW behind the title
  "resolves": { "ambiguity_slug": "…", "micro_ids": ["…"] },   // closes the loop → clarity ticks
  "readings_considered": [                                       // the diverge→converge trace
    { "text": "stem-based blend",  "kept": true,  "why": "matches taste + objective" },
    { "text": "generative mashup", "kept": false, "why": "out of scope for v1" }
  ],
  // depends_on/feeds reference TYPED data-unit tokens (= variable concept_slugs in
  // the data-unit-registry), NEVER free text — see §6.6.
  "depends_on": ["var:music_taste", "var:task_tag"],           // variables it consumes
  "feeds":      ["var:match_quality"],                          // variables it moves
  "confidence": 0.0,                                            // engine self-rating (honest)
  "citations": [ { "title": "…", "url": "…" } ],                // only if it web-researched (§5)
  "op_provenance": ["diverge", "converge", "define"]            // ops that produced it
}
```

Generated by the agent (§2) + planner (§3) + quality gate (§4) — every kept node is born
with it. **`resolves` is the critical field:** it ties the card back to the micro it
closed, so the Tier-0 matcher confirms it and the clarity meter actually moves.

**Expanded-sidebar sections to add** (extend `object-detail-drawer.tsx`, reuse its
`sectionLabel`/`section` pattern; each collapsible, ordered by signal):
1. **Mechanism** — the HOW (1–3 lines).
2. **Resolves** — "Answers: ‹ambiguity›" + the micro chips it closed (links back to the rail).
3. **Readings considered** — kept ✓ vs. rejected ✗ each with its one-line *why* (the visible self-questioning).
4. **Confidence & sources** — the engine's confidence + any web citations; ⚠ when low.

(The existing graph / taste-receipt / provenance / links sections stay.)

**The board face stays title-first** (§6): none of the above shows on the canvas card —
only in the sidebar. The face is title + one ≤14-word line; the richness is the reward
for expanding. This is the literal answer to "the outcome should be feature cards with
rich metadata, well-organized on each forked feature's expanded sidebar" — **yes, and
the bones already support it; the gap is generation (§3–§5) + these drawer sections.**

---

## 6.6 Features vs. variables — the substrate contract

**Features are operators; variables are the state they operate on.** A feature's
identity = `(mechanism, {variables it depends_on}, {variables it feeds})`. Variables are
NOT an afterthought — they ARE the feature's definition (`enrich-mechanism-spec.ts`'s
logic-model layer literally "names the variables moved"). The `decompose-cards` model is
already this: a feature `feeds` a variable it moves and `depends_on` a variable it needs.

**What surfaces where:**
- **Features → board heroes** (title-first, §6).
- **Variables → substrate, never board clutter.** They live in the KG (`library_objects`
  `object_type:variable`), the **glossary** (their definition), and the
  **`data-unit-registry`** (their typed token). They surface IN CONTEXT — as the
  `depends_on`/`feeds` wiring in the feature's expanded sidebar + cluster graph, and as
  `lever`/`concept` salience rows in the rail ("what to optimize / define"). A variable
  earns its OWN card only when it is itself contested / high-leverage (e.g. "music taste"
  needs pinning) — the rare exception, not the rule.

**The engine IS the decomposer (extend `decompose-cards`, do NOT fork):**
- `diverge` = the FEATURE pass · `define`/`converge` = the VARIABLE + glossary pass.
- One pipeline produces both and wires them. It must not run as a second parallel
  decomposer next to `decompose-cards` — it subsumes/enriches that pass.

**Three hard contracts (without these the output is incoherent downstream):**
1. **Typed data units, never free text.** Every `depends_on`/`feeds` token is a
   registered data unit (`data-unit-registry.ts`) so `derive-depends-on.ts` can wire
   real edges. Free-text variable names = broken edges — the exact bug the registry
   exists to kill (`produces:["attention_units"]` vs `consumes:["attention_signals"]`).
2. **`concept_slug` is the single join key** across glossary ↔ `library_objects` ↔
   data-unit-registry. One variable = one slug = one node, three views. Enforced on write.
3. **The engine populates the substrate, not just cards.** Resolving a `concept`
   ambiguity MUST register the variable + its definition, not merely mention it. This is
   the fix for `oc_substrate_starvation` (today OC generation feeds none of the advanced
   substrates) — get it right and the tech-spec stack lights up for free.

**Downstream handoff (the payoff — already built, waiting for clean inputs):**

```
engine: define  → variable (typed data unit + concept_slug + glossary definition)
engine: diverge → feature, depends_on/feeds referencing those tokens
        ↓
derive-depends-on.ts  → per-feature dependency list (from typed edges, not asserted)
enrich-mechanism-spec → mechanism_of_action + "variables moved" + acceptance criteria
compose-tech-spec.ts  → architecture (mechanism) + data model (variables)
                        + build phases (features) + ui_plan
```

Variables = the data model. Features = the build phases. Mechanism = the architecture.
Every auto-op (tech spec, agent build spec, data-flow DAG) reads this one substrate — so
the cleaner the engine types its variables, the more of the existing stack works for free.

---

## 7. UI/UX plan

### 7.1 Instant goal rail (the heartbeat) — Step 2
- On prompt submit / promote, dispatch `OPEN_BOARD_GOAL_EVENT` → rail auto-opens.
- Immediately render a **"Sharpening…" skeleton** with a pulsing title placeholder.
- Title fills in seconds (fast pass) → "the agent is doing something."
- Clarity metrics populate when the depth pass lands (already wired via
  `fetchClarity` + `REFRESH_SHARPENING`). Progressive, never a blank wait.

### 7.2 Forked ambiguity card + animated AI-resolve button — Step 6
- Below each forked `seeds_question` card, a **gently-animated "AI resolve"** pill
  (subtle float/breathing, accent-tinted) — signals "I can take this."
- Click → the resolving state (§6.2). A board-level "**Resolve all**" runs the loop
  across every open ambiguity in dependency order.

### 7.3 The rail HUD (already mostly built — extend, don't rebuild)
- **Clarity meter** climbing — but now **micro-aware** (Step 1): the bar reflects
  the *addressed_by gradient*, not all-or-nothing.
- **"Nail next"** rows gain a **micro dot strip** that fills *partially* as work
  lands (Step 1 makes `addressed_by` visible).
- **AI-activity strip** (exists): pulse while resolving, recent commits w/ confidence,
  ⚠ low-confidence → click-to-review single-concept Studio.
- **Emergent "new" pulse** (exists) as self-questioning surfaces fresh items.

### 7.4 The drawer (progressive disclosure)
- Reuse the object detail rail (`object-detail-drawer.tsx`). Clicking a resolved
  artifact opens: definition, candidate readings considered (kept + rejected w/
  reason), ops run, provenance chain, confidence, KG neighborhood
  (`object-cluster-graph`). All the hidden depth, on demand.

### 7.5 Motion language
- Resolving = drain + shimmer; resolved = settle + green tick; emergent = soft
  "new" pulse; hero card = ease-in from the resolved question's position (continuity).

---

## 8. Build sequence (each step independently shippable)

| Step | What | Why first | Touches |
|---|---|---|---|
| **1** | **Wire the inert micro half** — render `addressed_by` gradient, write per-micro `resolved_at` (auto-flip on high Tier-0 score), recompute macro `uncertainty` live | Foundation + fixes 3 real bugs; nothing shows progress without it | `goal-ranking-sidebar.tsx`, `micro-matcher.ts`, `prompt-sharpening-prompt.ts` |
| **2** | **Instant sidebar** (auto-open + title-then-metrics skeleton) | Cheap, high-visibility heartbeat | intake/promote, `goal-ranking-sidebar.tsx` |
| **3** | **The planner** (typed op menu + heuristic prior + LLM select/order + predict-verify) | The brain for op-selection | `canvas-operations.ts` (+`produces`/`reduces`), new `clarify-planner.ts` |
| **4** | **Concept-scoped context + born-with metadata (`feature_proposal` in `evaluation`, §6.5) with TYPED data-unit deps (§6.6) + quality gate** | Output alignment/quality; the rich card is born here, wired to real variables | `buildSpaceContext` (scoped), `library-objects.ts`, `data-unit-registry.ts`, reuse `quality-critic` |
| **5** | **Internal resolution agent** (recursive **diverge=features / define=variables** → converge → self-question → KG/glossary, budgeted, SSE progress; **extends `decompose-cards`, doesn't fork**, §6.6) | The core engine | new `POST /clarify` route + `clarify-agent.ts`; reuses converge-diverge / micro-matcher / emergent / data-unit-registry |
| **6** | **Per-card animated AI-resolve button + resolving state** | The canvas surface | sharpening/forked card shapes, board-bus event |
| **7** | **Title-first surfacing / curation** (Title-Sufficiency Test, one hero + count, transform-in-place) **+ render the `feature_proposal` sections in the expanded sidebar** (§6.5) | The anti-clutter law + the rich-sidebar payoff | shape transform, `library_objects.on_whiteboard`, board-bus, `object-detail-drawer.tsx` |
| **8** | **Conditional web research routing** | Sharper factual outputs | planner + `research-service` |
| **9** | **Polish** — durable AI audit log, `emergentCount` truncation fix, feed glossary into emergent pass | Hardening | `prompt-sharpening-prompt.ts`, emergent + auto-resolve routes |

Steps 1–2 are foundation/bugfix and land fast. 3–5 are the engine. 6–7 are the UX
the screenshot implies. 8–9 sharpen + harden.

---

## 9. Data model deltas

- `MicroQuestion`: start **writing** `resolved_at` + a `resolved_by` (op/node id);
  **render** `addressed_by` (partial fill). Macro `uncertainty` recomputed from
  micro state on every address/resolve.
- **Rich feature-proposal metadata (§6.5/§6.6)** — the `feature_proposal` block lands in
  `library_objects.evaluation` (JSONB, **no migration**): `mechanism`, `resolves`
  `{ambiguity_slug, micro_ids}`, `readings_considered[]`, `depends_on`/`feeds` (**typed
  data-unit tokens, not free text**), `confidence`, `citations[]`, `op_provenance`.
  `resolves` moves the clarity meter; `depends_on`/`feeds` feed `derive-depends-on`.
- **Variables are first-class substrate** — each resolved variable = one `concept_slug`
  spanning glossary ↔ `library_objects` (`object_type:variable`) ↔ `data-unit-registry`.
  The engine registers the data unit on write (no migration; the registry is existing infra).
- **Durable activity log** (fixes the "no audit trail" gap): append-only
  `prompt_sharpening.activity[]` = `{ op, ambiguity_slug, micros_targeted,
  produced_object_ids, source, confidence, at }`. Powers the AI-activity strip +
  the drawer trace, survives reload.
- `CanvasOperation`: `+produces`, `+reduces` descriptors.

---

## 10. Risks & guardrails

- **Runaway cost.** The internal loop MUST be budgeted (token + depth + node caps,
  loop-until-dry). Log drops; never silently truncate. Pause/abort control in the UI.
- **Board clutter regression.** Enforce the Title-Sufficiency Test + one-hero rule in
  the surfacing layer, not per-call discretion. Default-hide; promote explicitly.
- **Over-matching (Tier-0).** Today's token-recall matcher over-fires on short micros;
  raise the threshold / add slug-anchored confidence before auto-flipping `resolved_at`.
- **Parallel sessions.** `goal-ranking-sidebar.tsx`, `prompt-sharpening-prompt.ts`,
  `prompt-sharpening-card-shape.tsx`, `whiteboard-base.tsx` are co-edited live —
  verify mtime + re-read before editing, prefer new files (`clarify-*.ts`), assert
  full supersets on shared constraints.
- **Convergence honesty.** "Resolved" must mean uncertainty actually fell (recomputed),
  not that an op ran. The predict→verify gate enforces this.
- **Free-text edges break tech spec (§6.6).** `depends_on`/`feeds` MUST be typed
  data-unit tokens (`concept_slug`), or `derive-depends-on` / `compose-tech-spec` get a
  disjoint graph. Reuse `data-unit-registry`; enforce `concept_slug` as the join key.
- **Substrate starvation.** Pretty feature cards without populated typed variables +
  dependencies + mechanism just reproduces today's starved substrate. Success metric =
  a populated substrate the tech-spec stack can consume, not the cards themselves.
- **Decomposer duplication.** The engine extends `decompose-cards` (diverge=features,
  define=variables); it must NOT run as a second parallel decomposer.

---

## 11. Decisions (resolved 2026-06-05)

1. **Trigger = the user's choice of THREE** (no silent auto-run): every ambiguity/card offers
   **AI resolve** (this one) · **Resolve all** · **Answer questions** (Studio). All three already
   exist (inline "Let AI decide" / `auto-resolve`-all; Resolution Studio = answer questions) —
   surface them as an explicit 3-way choice at the resolve entry points.
2. **Board is SUPER picky.** Only the single best, title-self-explanatory artifact reaches the
   board. Everything else — variants, rejected readings, sub-detail, non-hero features — lives
   INSIDE the operations / **expandable** sidebar + Library. Default-hide; promote rarely.
3. **Start at Step 1** (wire the inert micro half) — ✅ DONE 2026-06-05 (tsc-clean): `liveUncertainty()` helper + matcher auto-resolve (strict own-token ≥0.75) + `applyMicroAddressing` recomputes/persists macro uncertainty + rail 3-state dots (open/addressing/resolved).
   **Step 2** ✅ DONE 2026-06-05 (tsc-clean): rail auto-opens on a FRESH prompt (sharpening-mount dispatches `OPEN_BOARD_GOAL_EVENT` when objective set + artifact still generating — never on returning boards) + title-first heartbeat (headline read from the fast no-LLM `prompt-sharpening` fetch, calm "Sharpening your objective…" pulse until it lands).
   **Step 4 (partial)** ✅ DONE 2026-06-05 (tsc-clean): the decompose pipeline now emits + stores per-feature `mechanism` + `confidence` in `library_objects.evaluation` (`kind:"feature_proposal"`, no migration) + the object-detail-drawer renders a "How it works" section (board face stays title-first). Wired into the EXISTING decompose pipeline — no orphan. Remaining `feature_proposal` fields (`resolves`, `readings_considered`, typed `depends_on`) arrive with the agent.
   **Step 5 (base) + Step 6** ✅ DONE 2026-06-05 (tsc-clean): NEW `run-ai-resolve.ts` shared orchestrator (auto-resolve → resolutions → apply → re-frame; collapses the two duplicate resolve paths the plan flagged) + the forked `insight-card` now offers the **3-mode trigger** (AI resolve this · Resolve all · Answer→Studio), reusing the existing pipeline + decompose event — no fork, no orphan.
   **Step 7 (look harness)** ✅ DONE 2026-06-05 (tsc-clean): NEW public preflight `/preflight/dark-connectors` — a faithful pure-SVG mockup of the dark flow-builder LOOK (dark canvas + dot grid, dark rounded title-first node cards, smooth green→pink gradient bezier wires with CIRCULAR green-out/pink-in ports, multi-port fan). Encoding: green = "feeds" (output), pink = "depends_on" (input). NOTE: native bound arrows already exist (`connector-drag-layer.tsx`) — the gap was purely the look. ⚠️ Couldn't auto-screenshot (shared preview browser wandered + hung) — user to review the route directly.
   **Step 3 (v1)** ✅ DONE 2026-06-05 (tsc-clean): NEW `clarify-planner.ts` (pure, heuristic) classifies each ambiguity's strategy (define/pin/decompose/research) + flags `factual`; wired into `runAiResolve` → only decomposes into Feature/Variable cards when ≥1 concept warrants it (a goal/pain/lever), so resolving a pure term/definition yields a glossary meaning, NOT a card spray (super-picky board). `factual` is the hook for the future web-research pass.
   **Step 5 (recursive agent)** ✅ DONE 2026-06-05 (tsc-clean): NEW `run-deep-resolve.ts` — "AI resolve" (this one) now runs a BOUNDED recursive loop (resolve → emergent self-question → resolve new high-leverage → … with a hard 3-round cap + leverage gate + slug-dedup so it converges, can't run away), reusing `runAiResolve` + the `sharpening-emergent` route. "Resolve all" stays a one-pass broad resolve. ~2 LLM calls/round → behavior needs a live authed test.
   **Durable AI-activity audit log** ✅ DONE (tsc-clean): `artifact.activity[]` (append-only, capped 50) written by the resolutions route, read by the rail's AI-activity strip (full history vs. last-write-wins resolutions).
   **Web research (Step 8)** ✅ DONE 2026-06-05 (tsc-clean): NEW `ground-factual-concept.ts` (server; Anthropic `web_search` via the proven `getResearchTools`/`parseResearchResponse` pattern, depth `light`, soft-fail). The `auto-resolve` route now grounds FACTUAL ambiguities (planner's `isFactual`, ≤4, parallel) in real web findings folded into the resolution prompt; intent/taste/scope concepts are never researched. Behavior needs a live authed test (it makes web_search calls).
   **Step 7 — REAL connector shape** ✅ DONE 2026-06-05 (source tsc-clean): NEW `flow-connector-shape.tsx` (a true tldraw scene shape: bezier wire + circular green-out/pink-in ports + green→pink gradient, reads endpoints reactively) + `flow-connector-board.ts` (`deployFlowConnector` / `syncFlowConnectors` / `registerFlowConnectorReactor` — a board store-listener keeps each wire synced so it MOVES with the cards; idempotent, can't loop). Registered in `board-shape-utils.ts` + `tldraw-shapes.d.ts` (low-collision — NOT `whiteboard-base`). Live demo on a DARK tldraw board: `/preflight/flow-connectors-live` (drag a card → wire follows). NOTE: lone new tsc "error" = `.next/dev/types/validator.ts` AppRoutes for the new route = stale Next typed-routes manifest, self-heals on compile/build (NOT a source defect).
   **Step 7 — connector UNIFIED onto the live board** ✅ DONE 2026-06-05 (tsc-clean, single-owner consolidation): ALL sharpening-fork connectors now use the real `flow-connector` (green/pink ports + gradient, moves with cards) via `ensureSharpeningFlowConnectors` + `registerFlowConnectorReactor` in `whiteboard-base` `handleMount` — covering objective→sharpening, sharpening→heatmap, sharpening→priority, fork→insight. Retired BOTH the old paths: removed `<SharpeningConnectorsOverlay/>` mount + gutted the other chat's `ensureObjectiveSharpeningArrow` to a legacy-sweep (no double wire). Heatmap + priority width-matched (340) for a balanced pair. Card kept title + sharpened prompt + one resolve CTA (clean, not actionless).
   **Decompose links unified too** ✅ DONE 2026-06-05 (tsc-clean): `deploy-oc-cards.ts` now draws the feature/variable `feeds`/`depends_on` wires with `deployFlowConnector` (was native grey arrows). **So EVERY connector on the objective board is now the one real `flow-connector`** — sharpening fork + decompose links — consistent green/pink-port gradient look, all moving with the cards; the overlay + all native connector-arrows for these relationships are retired.
   **Remaining (review-gated):** (b) board-scoped DARK THEME for every card shape (large restyle; live board stays light to avoid a half-dark look — only the connector look is dark-ready) · (c) the `factual` web_search behavior needs a live authed test. Both need eyes-on a working preview / authed session.

Default budget per resolution (tunable): node depth ~3, ≤ ~8 nodes, K=2 dry rounds.

---

## 12. What exactly ships (the concrete checklist)

**The final forked products.** Today the forks are the *questions* (`seeds_question`
ambiguity cards). This model makes the forks the *answers*: **feature cards.** One
resolved ambiguity → (typically) **one hero feature card** on the board. Everything else
is substrate, NOT a board card:
- resolved variable definitions → **glossary**,
- variable objects + **typed data-unit tokens** → KG + `data-unit-registry`,
- `feeds`/`depends_on` edges → `object_links`.

(A variable gets its own card only when it is itself contested / high-leverage — rare.)

**The card face — title-first, nothing more:** title (the function, ≤6 words) · one
≤14-word HOW/payoff line (no title-echo) · kind tag · confidence/provenance dot. All
richness lives in the expanded sidebar, never on the canvas.

**The metadata** (`feature_proposal` in `library_objects.evaluation`): `mechanism` ·
`resolves {ambiguity_slug, micro_ids}` · `readings_considered[] {text, kept, why}` ·
typed `depends_on`/`feeds` · `confidence` · `citations[]` · `op_provenance[]` — plus the
standard row fields (`summary`, `subsystem`, `source_ref`, `card_face`, `object_links`).

**Reuse vs. new — ~90% reuse.**

| Reused (exists today) | What it is |
|---|---|
| Feature card | `library_objects` + the `oc-card` shape |
| Fork / deploy | `board-bus` deploy events |
| Feature/Variable/`feeds`/`depends_on` model | `decompose-cards` |
| Metadata storage | the `evaluation` JSONB slot (exists, **empty today**) |
| The operations | `canvas-operations`: `diverge` / `converge` / `decompose` |
| "Define a variable" | resolve→glossary (`auto-resolve` / `apply-resolutions` / `generate-glossary`) |
| Typed variables | `data-unit-registry` |
| Dependency wiring | `derive-depends-on` |
| Mechanism + tech spec | `enrich-mechanism-spec`, `compose-tech-spec` |
| Expanded sidebar | `object-detail-drawer` |

| New (glue only — no new capability) | Why |
|---|---|
| `clarify-agent.ts` | the loop that *sequences* existing ops + self-questions |
| `POST /clarify` route | entry point |
| `feature_proposal` schema + write to `evaluation` | the slot exists, it's just empty |
| ~4 expanded-sidebar sections | render the metadata |
| planner + `concept_slug` enforcement | op-selection + the join key |

**The one redundancy to avoid:** `decompose-cards` already mints features + variables —
the engine must EXTEND that path (orchestrate it, enriched), **NOT** add a second
parallel decomposer (§6.6).

---

## 13. Relationship to SpecForge (not a rival — the feeder)

Clarify and SpecForge are different operations at different altitudes; they run in sequence.

- **Clarify = breadth / WHAT** — the whole objective → a disambiguated feature + variable map. Light born-with metadata.
- **SpecForge = depth / HOW** — ONE chosen feature → deep ~13-stage causal product spec → tech spec → prototype.

```
Objective ──[Clarify]──▶ clarified feature cards ──pick one──▶ [SpecForge] ──▶ tech spec ──▶ prototype
```

SpecForge stays very relevant — clarify just feeds it **cleaner inputs** (today SpecForge's first stage re-cleans raw input; with clarify upstream it starts from a disambiguated, typed, glossary-grounded feature and goes deeper faster). Three rules keep them from overlapping:
1. **Light seed vs. deep spec.** The clarify `feature_proposal` is a *seed* (mechanism line, variable wiring, provenance). SpecForge owns the *deep* spec. Clarify must not produce the deep spec.
2. **SpecForge consumes clarify output + short-circuits redundant stages.** Its "target user" / "problem" stages map onto clarify's ambiguity zones (`target_user`, `problem`) — read the clarified feature instead of re-deriving.
3. **Share primitives.** Both use converge/diverge — reuse `converge-diverge.ts` + `specforge/engines.ts` at different scopes, never a parallel copy.

---

## 14. Ranking, grouping & sequence

**Ranking = dependency-weighted "resolve-first":** `priority × downstream_fanout`, where
`priority = leverage × (0.5 + 0.5·uncertainty)` (existing) and `downstream_fanout` = count
of cards that `depend_on` this, computed from `object_links`. So "what to resolve now" =
*the upstream root that unblocks the most*. Reuses `derive-depends-on` graph utils + the
dormant `library_objects.rank_score` slot (no migration).
**The seam to build:** a `concept_slug ↔ object_id` join (salience is slug-keyed,
dependencies are id-keyed) so a concept's priority can be weighted by its card's fan-out.

**Grouping = subsystem** (`library_objects.subsystem`) — the only LIVE auto-grouping
(LLM-assigned at decompose, already rendered as swimlanes + Library folders). Layers /
causal-chains are *future lenses* (they sit on deprecated/unmounted surfaces — do NOT build
the default on them).

**Expansion unit = the subsystem set** + one hero per resolution.

**Surfacing = order, not numbers** — convey rank by *sequence + one "start here" highlight*,
never scores/percentages/long text (the anti-overwhelm rule, literal).

**The sequence (what shows up, in order):**
1. Prompt submitted → goal rail appears instantly with the distilled **title** (heartbeat).
2. Uncertainty map lands → **"Resolve next"** list, grouped by subsystem, ordered root-first; #1 highlighted "start here."
3. User taps a subsystem set (or the hero) → headless **diverge → converge → self-question** loop; uncertainty bar drains live.
4. Answers surface as **title-first feature cards**; variables sink silently into the substrate (glossary + KG).
5. Self-questioning surfaces **new items** (soft "new" pulse) → list **re-ranks**.
6. The list keeps re-ordering as resolutions land (resolving a root unblocks its dependents).
7. Any card → explore further via its hover verbs (same ops the engine uses).
8. A clarified feature shows **"Forge spec →"** → hands off to SpecForge.
9. Auto-recs throughout = **one planner**, surfaced per context (rail = resolve-next; card-hover = what-to-do) — not three competing heuristics.

---

## 15. The generation experience (the choreography)

**Core idea: the board *becomes* the living graph during generation, then curates itself
down to clean cards.** The exploration plays out (nodes bloom, edges draw, bars drain), then
on convergence the churn fades and only kept title-first cards remain. Thinking is temporal
theater, not permanent clutter (consistent with `feedback_structural_events_only`).

**Choreography:** title appears → "Resolve next" fills (bars full) → focal concept pulses →
candidates fan out (diverge) → weak ones dim (converge) → survivors brighten + wire to their
variables → the rail bar drains *in lockstep* → list re-orders → a new node buds (emergent) →
the cluster collapses into one hero card; variables sink to substrate.

**Five principles for "magical, not busy":**
1. **One focal action at a time** — eye always knows where to look; rest is ambient.
2. **Graph ↔ rail in lockstep** — one SSE event updates the node *and* its bar together.
3. **Momentum one-way** — bars only drain, list only shrinks, checks only accrue.
4. **Anticipation** — the "start here" pulse + budding "new" nodes pull you forward.
5. **Calm after the storm** — the lively generation resolves into a still, organized board.

**Build split:** **v1** = the resolve happens *in place* (forked card pulses → candidate chips
fan/prune → settle into the hero card; bars drain via the existing event-bus/SSE) — magical with
existing infra. **v2** = the full node-link graph theater — needs the deferred space-wide KG
renderer (`object-cluster-graph` is per-object; `causal-map` graph-build isn't mounted). Both
hit "something every second."

---

## 16. Visual system — DARK flow-builder theme + REAL bound connectors

**Theme: DARK** (decided 2026-06-05). The objective board adopts a dark flow-builder look —
dark rounded node cards on a near-black dotted canvas — matching the user's chosen reference.
⚠️ **Scope note:** this is a meaningful restyle. `appleVibe` is a LIGHT token system; the board,
rail, and cards are all light today, and the marketing/brand surfaces are warm-sun light. So the
dark theme is **board-scoped** (a dark token set / board theme flag for the canvas + nodes +
connectors + rail), kept distinct from the rest of the app — not a global flip.

**Connectors: REAL, bound — never an overlay.** A custom tldraw **connector shape + binding**
(tldraw `^4.5.9`, bindings already used in `connector-drag-layer.tsx` / `deploy-oc-cards`). The
wire is locked to both cards and moves *natively* as they move. **Do NOT** reuse the
`sharpening-connectors.tsx` SVG overlay — the user explicitly rejected "fake / drawn-on" wires.

**Circular ports + strong connections** (the user's exact ask):
- **Circular colored ports** at each end — **green = output ("feeds"), pink/magenta = input
  ("depends_on")** — prominent filled dots; port color encodes relation direction.
- **Strong gradient bezier wires** — smooth S-curves, bold (not faint), running green→pink to
  match the ports. "Strong connections" = visually prominent wires + dots, not thin hairlines.
- **Multi-port nodes** (several green-out / pink-in dots stacked on a side); right side = out,
  left side = in.

**Nodes:** dark rounded cards, **title-first collapsed**, expand to body + options. Selecting a
node opens the **right-side inspector** = our `object-detail-drawer` (the rich `feature_proposal`
sections, §6.5). The bottom node-type toolbar maps to card kinds / ops.

**This is a cross-cutting visual layer** applied across Steps 5–7 (the agent's deploys, the
per-card surface, and curation) — not a separate functional step. Verify in a `/preflight/*`
harness (the user reviews pixels).

---

## 17. Status

Plan finalized 2026-06-05. Decided: dark board theme · real bound connectors with circular
green/pink ports + strong gradient wires · heatmap moves to the sidebar + forked nodes (out of
the objective card) · ranking = dependency-weighted resolve-first · grouping = subsystem ·
output = title-first feature cards with rich `feature_proposal` metadata in the expanded
sidebar · clarify feeds SpecForge. Still the user's call before build (§11): auto vs. opt-in
trigger · surfacing selectivity · confirm start at Step 1.
