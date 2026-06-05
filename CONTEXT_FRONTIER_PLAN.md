# Context Channel + Metadata Frontier — Build Plan

**Status:** Phases 0–3 + chatbox pane BUILT & type-clean (2026-06-05). Extends, does not fork:
[[project_intake_depth_salience]], [[project_prompt_sharpening_card]], [[project_canvas_ai_operations]].

**Build log (2026-06-05):**
- Phase 0 — `src/lib/objective-canvas/context-frontier.ts` (anchor + `library_object_sources`/`library_object_notes` writers + `recordContextConcept` + `getObjectiveContextScope`); `LibraryObjectType` += `context_anchor`/`context_concept`. Migration-free.
- Phase 1 — `POST/GET /api/objective/[spaceId]/context`; chatbox "Context" pane (Ideas↔Reference toggle) in `chatbox-card-shape.tsx`.
- Phase 2 — `src/lib/objective-canvas/extract-context-frontier.ts` (faithful Sonnet-4-6 extraction → ContextConcept[]).
- Phase 3 — `decompose-prompt.ts` COVERED FRONTIER + USER CONTEXT TO HONOR blocks + `frontier_relation` schema; `generate-sub-objectives.ts` + `sub-objective-state.ts` thread it through; `sub-objectives/propose` route feeds `getObjectiveContextScope`.
- Phase 5 (visualization — SHIPPED within owned files): per-proposal **provenance chip** (`FrontierRelationChip` in `sub-objective-picker-card.tsx`, both render paths); chatbox pane **"Read as N concepts"** chips (GET /context + poll); **FrontierStrip** (covered-vs-new tally + prior-idea chips) in both picker views.
- **Remaining (all require contested board/library files — coordinate first):** Phase 4 (glossary `source:'context'` — blocked by dirty `library-rail.tsx`); Phase 5 board surfaces (context underlines, on-board frontier map — need `whiteboard-base.tsx`/`board-shape-utils.ts`/`tldraw-shapes.d.ts`, all parallel-owned + currently failing typecheck); Phase 7 (snapshot harvest). Live-browser verification still pending (needs an authed draft board).
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

### 3.0 Substrate audit (verified — this is what we must wire into)

| Layer | Canonical store | Notes for context |
|---|---|---|
| Objective root | `improvement_goals` (root, `parent_goal_id IS NULL`) + `objective-card` shape | ~15 routes resolve root via `parent_goal_id` — **do not disturb** |
| Objective text metadata | `improvement_goals.annotations` (JSONB) → glossary | annotation lens already keyed by `concept_slug` |
| Object layer (NEW, canonical for OC) | `library_objects` + `object_links` (+ `concept_slug` via glossary) | oc-card / artifact-card / decompose cards back here; surfaces in Library rail + `object-detail-drawer` + `object-cluster-graph` automatically |
| Old KG (legacy) | `entities` + `edges`; `/api/spaces/[id]/graph` still reads it | per [[project_old_build_deprecation]] — **do NOT write context here** |
| Glossary | `spaces.synthesis_data.glossary`, source ∈ `user>annotation>entity>llm`, pinned-immutable | merge dedupes by `concept_slug` first |
| Files / pasted text | `ingested_files` (`source_type='text'\|'file'\|'url'`, `normalized_text`, vision cols) | already claimable to a space |
| **Per-object user metadata** | **`library_object_notes`** (`kind IN 'idea','intention','taste','note'`) | **EXISTS, RLS set, ZERO writers** — purpose-built for "prior ideas/intentions" |
| **Object ↔ file provenance** | **`library_object_sources`** (`object_id → ingested_file_id`, `role`) | **EXISTS, RLS set, ZERO writers** — purpose-built for "context files behind an object" |
| Board state | `objective_boards.snapshot` (durable) + `objective_board_snapshots` (history, 40 cap) + localStorage mirror | text/sticky shapes are **snapshot-only, NOT DB-backed** |
| Versioning | `artifacts` + `artifact_versions` (append-only, `appendArtifactVersion()`); `pipeline_run_events`; `sub_objective_decisions` (append log) | all reusable |
| ⚠️ `synthesis_data` | overwrite-in-place, **last-write-wins, no optimistic lock** | concurrent sessions clobber → **avoid as primary store for context** |

**Two consequences that rewrite v1:**
- The right home for context is **rows in the object layer** (activating the two orphan tables), *not* a
  `synthesis_data` block — both because `synthesis_data` clobbers under parallel sessions, and because
  row storage makes context auto-surface in the Library rail / detail drawer / cluster graph with no new
  UI.
- This is precisely the "addressable Object below the entity row" foundation from
  [[project_object_flow_diagnosis]] — so it must be **LOCKED + coordinated**, not built solo (see §9).

### 3.1 Data model (row-based — reuses + activates the object layer)

Context attaches to an **intake context anchor**: one `library_objects` row representing the objective's
intake (`object_type='context_anchor'`, `source_sub_objective_id = root goal id`). The objective stays
`improvement_goals` — the anchor is a *companion* object so we can hang notes/sources/links off it
without touching root resolution. From there everything reuses existing tables:

```
improvement_goals (root objective)         ← unchanged
   └─ library_objects (context_anchor)      ← NEW row, companion to root
        ├─ library_object_sources ──────────→ ingested_files  (each pasted/uploaded context block)
        │     role = 'prior_ideas' | 'reference'
        ├─ library_object_notes              ← extracted ideas/intentions/taste (kind already exists)
        │     kind = 'idea' | 'intention' | 'taste' | 'note'
        └─ object_links (relation='derived_from')
              └─ library_objects (one per extracted ContextConcept, object_type='variable'|'insight')
                    concept_slug ← joins glossary + annotations namespace
```

```ts
// Returned by the extraction pass; each becomes a library_objects row + (optionally) a note.
interface ContextConcept {
  concept: string;                 // canonical noun phrase (≤4 words)
  concept_slug: string;            // SAME slug space as annotations + glossary (dedupe key)
  kind: "idea" | "constraint" | "fact" | "question";
  role: "prior_ideas" | "reference";   // surpass vs honor
  summary: string;                 // 1 line — what the user already said/meant
  source_ingested_file_id: string; // trace-back to the raw block
  source_phrase: string;           // verbatim span (for underline + chip → source)
}
```

What this buys, for free:
- **Library / sidebar / KG visibility:** the anchor + its derived concept objects render in `library-rail.tsx`
  and `object-detail-drawer.tsx` + `object-cluster-graph.tsx` with **no new surface** — they read
  `library_objects`/`object_links` already.
- **Glossary join:** each concept's `concept_slug` dedupes against objective annotations on merge; glossary
  gains `source:'context'`.
- **Durability + audit:** `ingested_files`/`library_object_*` are immutable-ish rows (not a clobbered blob).
- **No schema invention:** only additions are the `object_type='context_anchor'` value, the `source:'context'`
  glossary enum value, and *writers* for two tables that already exist. (A small `synthesis_data.objective_canvas.context.frontier`
  cache is allowed as a denormalized read-optimization, rebuildable from rows — never the source of truth.)

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
| **0 — Types + storage** | `ContextConcept` type; `context_anchor` object_type; **writers** for `library_object_sources` + `library_object_notes` (activate orphans); `source:'context'` glossary enum | `library-objects.ts`, `generate-glossary.ts` | tiny migration: enum value only |
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

## 6. Wiring matrix — does context reach every card / object / surface?

| Surface / object | Backed by | Contributes TO context? | Receives context? | How |
|---|---|---|---|---|
| objective-card | `improvement_goals` | n/a (it's the target) | yes | anchor object hangs off root goal |
| oc-card / artifact-card | `library_objects` | **yes** | yes | concepts already in object namespace; join via `concept_slug` |
| decompose cards | `library_objects` + `object_links` | yes (after accepted) | yes | covered-frontier block in `decompose-prompt.ts` |
| sticky-note / text shapes | **board snapshot only** | yes **but must be harvested** | indirect | §7 harvest pass reads tagged stickies/text from snapshot → notes (seam) |
| voice-note-card / journal-card | snapshot (+ `synthesis_data`) | yes (transcript) | yes | extraction pass over transcript → frontier |
| objective-image-card | `ingested_files` (vision cols) | **yes** | yes | `image_description` + `extracted_entities` already structured → concepts |
| insight-card (kept) | snapshot | yes (accepted only) | yes | accepted insight → note/concept on anchor |
| comment-card | `comments` | optional | no | user annotation, not idea-context by default |
| glossary | `synthesis_data.glossary` | yes | yes | `source:'context'` terms; `concept_slug` dedupe |
| Library rail / detail drawer / cluster graph | `library_objects`/`object_links` | — | renders | auto-surfaces anchor + concept objects, no new UI |
| old KG (`entities`/`edges`) | legacy | no | no | deprecated — context never writes here |

Two seams this exposes (both real, both addressed in §7):
1. **Snapshot-only text** (stickies, text shapes, voice transcripts) isn't DB-backed, so it must be
   *harvested* from the board snapshot to count as context. This is the same harvest the frontier-scope
   query needs anyway.
2. **The anchor object** is the one new modeling primitive; it's what lets all the orphan-table wiring hang
   together (see §9 — it's a schema decision to lock).

## 7. Context accumulation — "do linked things keep feeding context?"

**Yes — and this is the most powerful part.** Context is not a one-shot intake field; it's a *growing scope*.
As the user works, everything they link to the objective becomes part of the covered frontier, so later
generations never repeat what's already on the board.

Define one scope resolver (the audit confirmed **no centralized "what's linked" view exists today** — this
is the missing piece):

```
getObjectiveContextScope(spaceId) =
    initial pasted/uploaded context  (library_object_sources → ingested_files)
  ∪ user idea/intention notes        (library_object_notes)
  ∪ accepted insight-cards + kept oc/artifact cards (library_objects, selection_status)
  ∪ harvested tagged stickies/text + voice transcripts (board snapshot)
  ∪ image extractions                (ingested_files vision cols)
  → dedupe by concept_slug → split by role (prior_ideas vs reference)
```

This single function feeds the covered-frontier block in decompose **and** every other metadata utilization
(§3.3). The frontier grows monotonically; the anti-duplication gets stronger the longer the user works. New
links append (`object_links`, `library_object_notes` are append-only), so accumulation is natural.

## 8. Versioning — reuse, don't invent

- **Don't version the `synthesis_data` blob** — it's overwrite-in-place + clobber-prone; that's exactly why
  context lives in rows.
- **Context blocks are naturally durable:** each is an `ingested_files` row + a `library_object_notes` row
  (append-only). Editing an idea = new note row or in-place update; nothing is lost silently.
- **Milestone snapshots of "the objective's understanding at time T":** model an `artifacts` row
  (`artifact_type='intake_understanding'`) and use the existing `appendArtifactVersion()` — every
  frontier re-extraction or major reframe appends an immutable `artifact_versions` snapshot with
  `change_type` + `change_summary`. Full history + rollback, zero new infra.
- **Audit trail of context events:** log `context_added` / `frontier_extracted` / `context_reframed` to the
  existing append-only `sub_objective_decisions` (it already logs `annotations_generated`,
  `constraints_set`, etc.) — gives a replayable timeline that plugs into the notebook fork-tree.

## 9. Locked decisions (2026-06-04 — verified against live schema)

Verification before lock: `library_objects.object_type` is **free-text (no CHECK)**; both
`library_object_sources` and `library_object_notes` have **zero writers in src/**;
`library_object_notes.kind` is already `CHECK IN ('idea','intention','taste','note')` and
`library_object_sources.role` is free-text. ⇒ The whole foundation is **migration-free** and additive.

1. **Anchor object — LOCKED.** `library_objects.object_type='context_anchor'`, one per space, companion to
   the root `improvement_goals` (via `source_sub_objective_id = root goal id`). No migration (free-text
   type). Chosen over a dedicated `objective_context` table because it activates the two orphan tables and
   auto-surfaces in the Library rail / detail drawer / cluster graph. Satisfies the object-flow north star
   ([[project_object_flow_diagnosis]]) additively without disturbing root resolution.
2. **Roles — LOCKED.** `library_object_sources.role ∈ {'prior_ideas','reference'}` (free-text, no
   migration); extracted ideas → `library_object_notes.kind ∈ {'idea','intention','taste'}` (fits existing
   CHECK).
3. **Snapshot harvest scope — LOCKED (v1).** `sticky-note` with a non-null `dimension` + committed voice
   transcripts count as context; plain text shapes are opt-in (Phase 7).
4. **Concurrency — LOCKED.** Context is **row-backed** (`ingested_files` / `library_object_*` /
   `object_links`), never primary-stored in `synthesis_data`. Any denormalized `synthesis_data` cache is
   rebuildable and written read-modify-write with full-superset re-assert ([[project_parallel_workstreams]]).
5. **File-touch discipline — LOCKED.** Phases 0–2 + 7 land in **new files**; the only hot-file edits are the
   additive `decompose-prompt.ts` block (Phase 3) and the `GlossarySource` enum (`+'context'`), both
   back-compat and gated behind `git`/`list_migrations` coordination.

## 10. Definition of done

- A user can paste/attach context tagged Ideas vs Reference; it persists and renders as annotated,
  concept-extracted metadata.
- Decomposition of a paste-heavy objective produces proposals that **extend/combine/fill gaps** rather
  than restating pasted ideas, each carrying a `frontier_relation`.
- Every generated card shows provenance ("extends *X*" / "gap between *X*,*Y*" / "new").
- Glossary shows `from context` terms; context metadata measurably scopes the objective's own
  annotations (a context constraint shows up in the objective's readings).
- Empty-context path is byte-identical to today.
