# Context Channel + Metadata Frontier — Build Plan

**Status:** Proposed (2026-06-04). Extends, does not fork: [[project_intake_depth_salience]],
[[project_prompt_sharpening_card]], [[project_canvas_ai_operations]].
**One-line:** Give the user a first-class place to dump prior context/ideas, turn that text into
the *same* metadata namespace the objective already uses (`concept_slug`), and feed it downstream as
a **covered frontier to surpass** — not as grounding to echo back — with visible provenance on every
generated idea.

---

## 1. The problem (verified, not assumed)

Traced the live intake → metadata → decompose path. Three structural facts drive everything below:

1. **No first-class context channel.** A user with lots of background/ideas has two bad options:
   stuff it into the objective textarea (pollutes the intent signal that all metadata is computed
   from), or attach it as a file. Attachments
   (`attachedFileIds` → `ingested_files`) are only appended to the **research seed** in
   `src/app/api/brainstorm/start/route.ts` and read solely by decompose/research. There is no
   dedicated "prior thinking" input. Objective vs context is therefore *not* distinguished in any way
   that scopes meaning.

2. **The metadata layer is blind to context.** The passes that *create* metadata —
   `prompt-sharpening-prompt.ts` (sharpen), `generate-sharpening-depth.ts` (depth/salience →
   `candidate_readings`, `leverage`, `uncertainty`, `concept_slug`, pain/goal/lever),
   `generate-annotations.ts`, `generate-glossary.ts` — receive **only the raw objective string**.
   So context cannot currently "scope the metadata that scopes the objective." That inversion the
   feature wants does not exist.

3. **Anti-duplication points the wrong way.** `decompose-prompt.ts` has real teeth — ANTI-PLATITUDE,
   the `EXISTING PROPOSALS` HARD-RULES ANTI-DUPLICATE block, `gap_fill` + `uncoveredLensIndices`,
   intent mixins (creative/contrarian/wildcard). **But all anti-dup is measured against
   *generated proposals*, never against the user's own input ideas.** Context reaches decompose only
   as `ragBlock` "RESEARCH CONTEXT" — i.e. *grounding to honor* — which is precisely the instruction
   that produces echo-back of ideas the user already had.

**Consequence:** paste 20 ideas you've already considered and the system is structurally inclined to
hand them back to you as "features," because nothing tells it those are the *covered* set and the job
is to go beyond them.

---

## 2. Design principles (the "quality + system" lens)

- **Reuse the proven shapes.** Every new piece mirrors an existing one:
  - covered-frontier block ≈ existing `EXISTING PROPOSALS` ANTI-DUPLICATE block
    (`decompose-prompt.ts:253`)
  - frontier gap targeting ≈ existing `uncoveredLensIndices` / `gap_fill` engine
    (`decompose-prompt.ts:91, 288`)
  - context concept extraction ≈ existing salience pass (`SalienceAnnotation`, `candidate_readings`,
    `concept_slug` in `prompt-sharpening-prompt.ts`)
  - identity/dedup ≈ existing `concept_slug` + `buildGlossaryBySlug` + `annotation-overlap` slug-first
    matching
  - context-text storage ≈ existing `ingested_files` `source_type='text'` / `extraction_method='paste'`
  - context underlines/popover ≈ existing `annotated-objective-card.tsx`
- **Metadata is the unifying currency.** Context concepts join the **same `concept_slug` namespace** as
  objective annotations and glossary. That single decision is what makes diffing (covered vs new),
  glossary merge, and cross-surface trace-back all fall out for free.
- **Two roles, honored differently.** Context splits into:
  - `reference` — facts / constraints / background → **grounding to honor** (current behavior).
  - `prior_ideas` — ideas already articulated → **covered frontier to surpass**.
  Keeping these separate *in the prompt* is the core anti-echo fix: honor one, exceed the other.
- **Metadata is the compression.** Never fan raw context text into every downstream prompt (token
  blowup + dilution). Extract once into a compact concept set; pass the **frontier**, not the wall of
  text. This is also the answer to "turn text into metadata to reduce ambiguity."
- **Soft-fail + back-compat.** Every new input is optional; empty context → byte-identical legacy
  behavior. Matches the whole codebase (`ragBlock`, `lens`, `priorConcepts` are all optional today).
- **Coordinate, don't clobber.** `decompose-prompt.ts` / `generate-sub-objectives.ts` are co-edited by
  parallel sessions ([[project_parallel_workstreams]]). All changes are **additive optional args** with
  legacy defaults; check `git`/`list_migrations` before touching; re-assert the full superset on any
  shared constraint.

---

## 3. Architecture

### 3.1 Data model

**Context blocks** live as `ingested_files` rows (raw text stays out of the space row), referenced by a
lightweight registry in `synthesis_data.objective_canvas.context`:

```ts
// synthesis_data.objective_canvas.context
interface ContextState {
  blocks: ContextBlock[];          // user-entered context, registry only (text in ingested_files)
  frontier: ContextConcept[];      // deduped concept set extracted across all blocks
  extracted_at: string | null;
}

interface ContextBlock {
  id: string;
  role: "prior_ideas" | "reference";   // surpass vs honor
  source: "paste" | "file" | "url";
  ingested_file_id: string;            // raw text/normalized_text lives here (source_type='text'|'file'|'url')
  label: string;                       // short user/auto label for the chip
  created_at: string;
}

// The unit that joins the objective's metadata namespace.
interface ContextConcept {
  concept: string;                 // canonical noun phrase (≤4 words)
  concept_slug: string;            // SAME slug space as annotations + glossary
  kind: "idea" | "constraint" | "fact" | "question";
  summary: string;                 // 1 line — what the user already said/meant
  source_block_id: string;
  source_phrase: string;           // verbatim span, for trace-back + underline
  role: "prior_ideas" | "reference";
}
```

Why JSONB-registry + `ingested_files` for the body, not a new table: pasted context can be large;
bloating the `spaces` row read on every board render is the failure mode. `ingested_files` already
has `source_type='text'`, `extraction_method='paste'`, `normalized_text`, and `space_id` claiming.
This mirrors how `prompt_sharpening` / `voice_notes` / `journal` keep heavy artifacts referenced from
`synthesis_data` rather than inline. **No migration required** for the text path; only an optional
`role` annotation, stored in the registry (not on `ingested_files`), so we don't touch the shared
ingest schema.

### 3.2 Extraction pass — "text → metadata"

New helper `src/lib/objective-canvas/extract-context-frontier.ts`, built from the **existing salience
prompt machinery** (same `llmJSON` + `concept_slug` slugify + dedup as the depth pass). For each
context block it emits `ContextConcept[]`; the set is deduped by `concept_slug` (reuse the slug-first
dedup already in `generate-glossary.ts` / `annotation-overlap.ts`) and split by `role`.

- Fired fire-and-forget after context is added (same `after()` pattern as
  `generatePromptSharpeningForSpace`), persisted to `…objective_canvas.context.frontier`.
- **Must** run through the usage meter (`recordLlmUsage` / `withCharge`) per [[project_credit_metering]].
- Cap: top-N concepts by leverage; summarize rather than store everything.

### 3.3 Wire the frontier into generation (the core quality win)

This is the highest-leverage, lowest-cost change because the machinery exists.

**`decompose-prompt.ts` — additive, back-compat:**

- New optional `BuildDecomposeArgs` fields:
  - `coveredFrontier?: ContextConcept[]` (role `prior_ideas`) — render a block that mirrors
    `EXISTING PROPOSALS` (`:253`) but framed: *"The user has ALREADY considered these ideas. Do NOT
    re-propose them. Generate proposals that (1) extend one, (2) combine two into something neither
    covers, or (3) attack the gap between them."* Reuse the HARD-RULES self-test wording verbatim.
  - `contextGrounding?: ContextConcept[]` (roles `reference`/`constraint`/`fact`) — render as
    honor-this grounding, distinct from the surpass-this frontier. Folds into the existing research
    block path so it's clearly "facts to respect."
- New per-proposal output field `frontier_relation`:
  `"extends:<slug>" | "combines:<slug>+<slug>" | "gap_between:<slug>,<slug>" | "novel"`.
  Add to `buildResponseSchema` (gated like `lens_coverage`) so it's required only when a frontier is
  present. This single field is **anti-dup enforcement + provenance + the visualization payload** at
  once.
- `generate-sub-objectives.ts`: thread the two new args + forward `frontier_relation` through
  `normalizeProposals` (validate slugs against the frontier set, like `lens_coverage` is validated
  against the lens).

**All-utilization coverage** (the user's "important across *all* utilization of metadata" note):
thread the frontier/grounding split into the other metadata consumers so none of them echo context:
- sharpen + depth pass — pass context so the **objective's** metadata is scoped by it (this is
  literally "context scopes the metadata that scopes the objective").
- `generate-annotations.ts` / `generate-glossary.ts` — context concepts seed glossary terms with a
  new `source: "context"` (extend the existing `annotation|entity|llm|user` enum).
- canvas AI ops / converge-diverge (`canvas-operations.ts`, `/api/canvas/converge-diverge`) — same
  covered-frontier block, so power-up generation also augments rather than repeats.

### 3.4 Visualization — "we turned your text into metadata that links to your intention"

Reuse existing render primitives; only the pointing target is new.

1. **Context rendered with annotation underlines.** Generalize `annotated-objective-card.tsx` to a
   context card: the user watches their pasted ideas light up into weighted, color-coded concepts —
   disambiguation made literally visible. (Underline thickness = leverage; color = `kind`.)
2. **"We read your context as N concepts" panel.** Concept chips, each linking back to its
   `source_phrase` via `concept_slug`. The annotation→glossary→spec trace-back chain already exists
   end to end but is never *rendered* — this surfaces it.
3. **Frontier map (covered vs new).** A compact two-column / radial view: covered concepts (from
   context) on one side, generated concepts on the other, with `frontier_relation` edges
   (extends / combines / gap_between). This is the "shown ideas that link to user intention" — it
   *visually proves* augmentation over duplication. Reuse `object-cluster-graph.tsx` radial layout.
4. **Provenance label on every generated card.** "extends *your idea X*" / "fills gap between *X* and
   *Y*" / "new — not in your context." Single biggest payoff; driven entirely by `frontier_relation`.
5. **Glossary "from context" badge.** Extend the source-badge enum in `library-rail.tsx` /
   `notebook-glossary-view.tsx`.

### 3.5 Input UX

- Chatbox card (`chatbox-card-shape.tsx`) gains a second collapsible pane: **"Context / ideas you've
  already had"** with a role toggle (Ideas ↔ Reference). Paste → `ingested_files` (`source_type='text'`)
  + registry entry. Existing paperclip attachments get the same role toggle.
- New route `POST /api/objective/[spaceId]/context` (add/remove blocks; fires extraction via `after()`).

---

## 4. Phasing

| Phase | Scope | Touches | Gate |
|---|---|---|---|
| **0 — Types + storage** | `ContextState`/`ContextBlock`/`ContextConcept` types; reuse `ingested_files` text path; registry in `synthesis_data` | new `context-state.ts` | no migration |
| **1 — Input channel** | chatbox second pane + role toggle; `POST …/context` route; persistence | `chatbox-card-shape.tsx`, new route | context visible on board |
| **2 — Extraction** | `extract-context-frontier.ts` (reuse salience); `after()` fire; metered | new helper, `…/context` route | `frontier` populated + deduped by slug |
| **3 — Frontier → decompose** | `coveredFrontier` + `contextGrounding` args + `frontier_relation` (the core win) | `decompose-prompt.ts`, `generate-sub-objectives.ts` (additive) | proposals carry relations; no echo on a paste-heavy test |
| **4 — All-utilization** | thread context into sharpen/depth/annotations/glossary + canvas ops; `source:"context"` | metadata generators, canvas ops | objective metadata scoped by context |
| **5 — Visualization** | context underlines, concept-chip panel, frontier map, provenance labels, glossary badge | `annotated-objective-card.tsx` (generalize), `library-rail.tsx`, new frontier-map | provenance shown on cards |

Phases 3 and 5 are the user-visible "proof of augmentation"; 0–2 are substrate. 3 can ship and deliver
value before 4–5 if needed.

---

## 5. Critical risks & mitigations

- **Token blowup / dilution.** Never pass raw context downstream — pass the compact `frontier`. Cap
  concepts; summarize. (The metadata *is* the compression.)
- **Over-suppression starves generation.** The frontier block says *extend/combine/surpass*, never
  *forbid the topic*. `frontier_relation` forces engagement, not avoidance. Tune wording against a
  paste-heavy fixture before shipping.
- **JSONB bloat.** Raw text in `ingested_files`; only references + extracted concepts in
  `synthesis_data`.
- **Slug collision across objective + context.** Reuse existing slug-first dedup
  (`buildGlossaryBySlug`, `annotation-overlap`). Shared namespace is the point — a context idea and an
  objective annotation about the same concept *should* collapse.
- **Clobber trap on hot files.** `decompose-prompt.ts` / `generate-sub-objectives.ts` co-edited by
  parallel sessions. All changes additive-optional with legacy defaults; verify mtime + diff + `git`
  before editing; re-assert full superset on any shared constraint ([[project_parallel_workstreams]]).
- **Credit metering.** New extraction pass and any new LLM call go through `recordLlmUsage` /
  `withCharge` ([[project_credit_metering]]); flush in the run's own async context.
- **Back-compat.** Empty context ⇒ all new blocks render empty ⇒ identical legacy prompts. No behavior
  change for users who never add context.

---

## 6. Definition of done

- A user can paste/attach context tagged Ideas vs Reference; it persists and renders as annotated,
  concept-extracted metadata.
- Decomposition of a paste-heavy objective produces proposals that **extend/combine/fill gaps** rather
  than restating pasted ideas, each carrying a `frontier_relation`.
- Every generated card shows provenance ("extends *X*" / "gap between *X*,*Y*" / "new").
- Glossary shows `from context` terms; context metadata measurably scopes the objective's own
  annotations (a context constraint shows up in the objective's readings).
- Empty-context path is byte-identical to today.
