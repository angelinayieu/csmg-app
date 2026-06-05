# Artifacts & the Artifact Dock — Spec

**Status:** DRAFT (spec-first, pre-code) · **Date:** 2026-06-04 · **Lane:** objective-canvas / artifacts
**Goal:** Split the canvas's terminal *deliverables* ("final products") out of the power-up rail into a first-class, persistent, continuously-updated **Artifact** layer, surfaced through a customizable **Artifact Dock** of gradient circles. Make voice notes editable/expandable, stop auto-journaling, and rebuild the journal into a real editable **Notebook**.

> Grounded in a 3-front exploration (voice/journal, power-ups/build-prototype, persistence/library). **Most of this is reframing + generalizing infrastructure that already exists** — the `apps` table is already a versioned continuously-updated artifact registry, the SpecForge→tech-spec→prototype chain is already an end-to-end plan→create pipeline, and `library_objects`/`object_links` already model persistent re-accessible objects. Extend these; do not fork them. (See [[feedback_check_existing_first]], [[project_apps_architecture]].)

---

## 0. The core reframe

Today **everything** lives in one 360px rail (`src/components/objective/canvas-interactions/powerup-rail.tsx`): Forge, Build prototype, Decompose, 7 operations, Custom, the Artifacts list. Two fundamentally different kinds of thing are conflated:

| | **Power-ups** (stay in the rail) | **Artifacts** (NEW layer) |
|---|---|---|
| Purpose | *transform* canvas content → more cards | *produce a terminal deliverable* the user takes away |
| Output | factor/question/feature cards on the board | a prototype, a notebook, an image, a post, a custom product |
| Lifecycle | ephemeral, re-runnable | **persistent, re-accessible, continuously updated** |
| Persistence | `library_objects` rows / board shapes | **`artifacts` rows + `artifact_versions`** (new) |
| Surface | the existing rail | the new **Artifact Dock** (gradient circles) |
| UI plan stage? | n/a | **only Build Prototype** emits a UI; others skip it |

**Build Prototype moves out of the power-up rail** and becomes the flagship engine of the Artifact Dock. **Journaling joins it** as another engine. This realizes the user's stated model: *"final artifacts are essentially the apps… journaling falls under final products, which build-prototype also does."*

---

## 1. Data model — the `artifacts` registry

**Decision (locked here): a new `artifacts` table** that *reuses the `apps` pattern*, rather than widening `apps.app_type`.
Rationale: `apps` is semantically locked to **intervention-clusters** generated from `strategy.micro_tactics[]` ([[project_apps_architecture]], `20260428_apps_and_interventions.sql`). Overloading it with journals/images would muddy the strategy pipeline and risk clobbering parallel sessions co-editing apps. A sibling table copies the proven columns (`config`/`state`/`stale_reason`/versions) without polluting app semantics. Apps remain *one kind of* artifact conceptually, but keep their own table.

### New migration `2026XXXX_artifacts.sql`

```
artifacts
  id            uuid pk
  space_id      uuid fk -> spaces
  user_id       uuid
  artifact_type text   -- 'prototype' | 'notebook' | 'document' | 'image' | 'social_post' | 'custom'
  engine_key    text   -- which dock engine produced it (stable id, e.g. 'build_prototype', 'notebook', custom slug)
  title         text
  status        text   -- 'generating' | 'ready' | 'error' | 'archived'
  -- continuously-updated payload (mirrors apps.config/apps.state)
  config        jsonb  -- standardized template/settings for this artifact (design language, voice, format)
  content       jsonb  -- the artifact body (html, notebook blocks, image_url+meta, post text, custom payload)
  -- source lineage
  source_object_ids uuid[]    -- library_objects this was built from
  source_shape_ids  text[]    -- board shapes selected at build time
  board_shape_id    text      -- the card handle on the canvas (idempotent re-render)
  -- freshness / continuous update (copied from apps)
  stale_reason   text   -- 'source_changed' | 'user_edit' | 'manual_refresh' | null
  stale_since    timestamptz
  last_refreshed_at timestamptz
  last_updated_by   text  -- 'user' | 'agent:<engine>' 
  created_at / updated_at  (updated_at trigger)
  unique (space_id, engine_key, coalesce(board_shape_id,''))   -- idempotent per dock-run handle

artifact_versions   -- append-only audit (mirrors app_versions)
  id, artifact_id fk, version int, content_snapshot jsonb, config_snapshot jsonb,
  change_type text ('generated'|'user_edit'|'agent_update'|'refresh'), change_summary text, changed_by, changed_at
  unique (artifact_id, version)
```

- **RLS:** owner-only, same policy shape as `library_objects`/`apps`.
- **Soft-fail everywhere** (try/catch → null), so callers are safe before the migration is applied live — the established pattern ([[project_event_bus_architecture]], library-objects.ts).
- **Helper lib** `src/lib/objective-canvas/artifacts.ts`: `upsertArtifact`, `getArtifact`, `listArtifacts`, `appendArtifactVersion`, `markStale`. Single write path (mirror `library-objects.ts`).
- **Journal migration:** the existing `synthesis_data.objective_canvas.journal` blob is *promoted* into an `artifacts` row of type `notebook` on first open (lazy backfill); `voice_notes[]` stays as the input list (see §4–5).

> Custom engines themselves (user-defined) persist as rows in a small `artifact_engines` table OR under `spaces.synthesis_data.objective_canvas.custom_engines[]`. Lean: start with the synthesis_data slice (no migration), promote to a table if cross-space reuse is wanted.

---

## 2. The Artifact Dock (persistent gradient circles)

A new floating dock, **separate from the power-up rail** — the user's *"users can add specific power-ups to stay persistent within the screen, in circle shapes with really cool gradient icons."*

**Component:** `src/components/objective/canvas-interactions/artifact-dock.tsx` (mounted once in `whiteboard-base.tsx`, like the rail). Vertical strip of circular glass buttons, soft accent-glow (no spines/flat fills — [[feedback_ui_design_taste]]), gradient icon per engine.

### Behaviors
- **Pinned set is curated.** A `+` opens the engine catalog; the user pins/unpins engines. Pinned set persists per-user-per-space in `synthesis_data.objective_canvas.docked_engines[]` (no migration). Default pinned: **Prototype, Notebook**.
- **Selection-aware.** Reads the editor's current selection (reuse `shapeToScanTarget()` from the rail) → each circle enables when a usable selection exists and shows a count badge ("3 selected").
- **Power-on / run.** Tap a circle with a selection → fires the **artifact runner** (§3) against the selection → drops a persistent artifact card + writes the `artifacts` row. Long-press / gear on a circle → the engine's **template settings** (§3, "standardize the output").
- **Status feedback.** Circle pulses while its run is in flight (reuse the `status:'generating'` pattern from prototype/journal cards).

This is purely additive UI; it does **not** remove the power-up rail (transform ops stay there). The rail's current "Build prototype" button becomes a thin pointer ("→ in the Artifact Dock") to avoid two entry points.

---

## 3. The shared artifact runner (plan → create, end-to-end)

Generalize the existing prototype pipeline (SpecForge → `forge-pipeline.ts` → tech-spec → `/api/canvas/prototype`) into one **engine-driven runner** so every dock circle runs *"front to end — planning then creation"* without per-engine glue.

**Registry** `src/lib/objective-canvas/artifact-engines.ts` (extends the `canvas-operations.ts` registry idea — do not fork):

```ts
interface ArtifactEngine {
  key: string;                 // 'build_prototype' | 'notebook' | 'image' | 'social_post' | custom slug
  label: string; gradient: [string,string]; icon: ...;
  artifactType: ArtifactType;
  needsUiPlan: boolean;        // ONLY build_prototype = true  → user's "only build-prototype creates a UI"
  plan?(selection, config): Promise<PlanPayload>;   // optional planning pass
  generate(plan|selection, config): Promise<ArtifactContent>;
  configSchema: ...;           // the standardizable template fields
}
```

**Runner** `runArtifactEngine(engine, selection, config)`:
1. Resolve selection → text/objects (reuse `shapeToScanTarget`, `library_objects` lookups).
2. If `needsUiPlan` → run SpecForge/tech-spec → ui-plan stage (existing). Else skip straight to generate.
3. `generate(...)` → engine-specific API route.
4. `upsertArtifact(...)` + `appendArtifactVersion('generated')`.
5. Drop/refresh the canvas card handle (`board_shape_id`) + open in the Artifacts Library.

**Standardized templates** = each engine's `config` (the user's *"standardize on each thing what the final product should be… controllable through the build-prototype button"*). Editable from the circle's gear; persisted on the engine and copied onto each produced artifact's `config` so re-runs stay consistent.

### Built-in engines
| Engine | needsUiPlan | plan | generate route | artifact content |
|---|---|---|---|---|
| **Build Prototype** | ✅ | SpecForge→tech-spec→ui-plan | `/api/canvas/prototype` (existing) | sandboxed HTML + version |
| **Notebook** | ❌ | (none / light weave plan) | `/api/objective/[id]/notebook/synthesize` (new, §5) | ordered blocks (§5) |
| **Image** | ❌ | brief→prompt | `/api/canvas/artifact/image` (new) | `image_url` + prompt meta (reuse `ingested-images` bucket pattern) |
| **Social Post** | ❌ | angle→copy | `/api/canvas/artifact/social` (new) | post text + variants |
| **Custom** | optional | user-defined op chain | `/api/canvas/custom-op` (existing, promoted) | freeform payload |

---

## 4. Voice notes — three concrete fixes

Today: read-only (`voice-note-card-shape.tsx` `canEdit: () => false`), no expand, no analysis shown, and journal **auto-fires** on commit (`voice-record-fab.tsx`).

1. **Editable transcript.** Flip `canEdit`; transcript becomes an editable text block. Persist edits back to the note. Migrate `synthesis_data.objective_canvas.voice_notes` from `string[]` → `{ id, text, editedAt?, analysis?, durationMs?, createdAtIso }[]` so edits + analysis attach per-note. (Back-compat: read old `string[]`, write new shape.)
2. **Click-to-expand + analysis + metadata.** Add an `expanded` prop to the shape (mirror the journal card's `open`/booklet flip). Expanded view shows: full transcript (editable), AI analysis, and metadata (timestamp, duration, detected themes/entities). The live-analysis pass (`voice-analysis-controller.ts`) already computes diverge nodes — **attach those to the note as `analysis`** instead of (or in addition to) dropping loose cards.
3. **Remove auto-journal.** Delete the `deployJournalCard` + journal POST from `commit()` in `voice-record-fab.tsx`. A voice note becomes a pure **input object**. The Notebook is produced only on demand via the dock. (*"after a voice recording it immediately synthesizes a journal, but I don't want that because not everyone wants a journal."*)

---

## 5. The Notebook (rebuilt journal) — phased, **both surfaces**

The user's *"the journal is pretty but you can't really interact with it… it's weird"* → promote it from a board-only booklet to a real, editable, persistent **Notebook** (artifact_type `notebook`).

### Block model (the critical change)
Today the journal **regenerates the whole artifact from all notes every time** (`generate-journal.ts`) — that would **clobber any user edit**. New model:

```
content = {
  title: string,
  blocks: [
    { id, kind: 'ai_woven' | 'user' | 'quote', heading?, body, sourceObjectId?, locked?, updatedAt }
  ]
}
```

- AI **appends/weaves new** blocks from new inputs; it **never rewrites** existing `user`/`locked` blocks. User edits are first-class and preserved.
- **Add-from-whiteboard:** select card(s) → a dock action ("Add to Notebook") appends them as `quote` blocks with a back-link (`object_links` relation `derived_from`, reuse existing). (*"they can also add onto the journal from the whiteboard."*)
- Each notebook edit → `appendArtifactVersion('user_edit')` so history is kept.

### Phase A — on-canvas expandable panel (ship first)
A large editable glass panel that expands over the canvas (board stays live behind it), replacing the current dead-end booklet flip. Inline block editing + add-from-whiteboard. The booklet card stays as the **glanceable handle** on the board; "Open" now opens this panel.

### Phase B — dedicated full-page Notebook view
"Open in full" → a real editable document route (e.g. `/app/objective/[spaceId]/notebook/[artifactId]`), Google-Doc-like, for serious typing/reading. Same block model, same artifact row. (*"a personal Google Doc, but personal-AI — each user's own notebook of the most important takeaways."*)

---

## 6. The Artifacts Library (re-access)

The user's *"a more convenient way to access these saved digital artifacts that are constantly being updated… categorize them as a specific category."*

A dedicated **Artifacts** section parallel to the existing Library rail (`library-rail.tsx` — extend, don't fork). Lists every `artifacts` row for the space (toggle: across spaces), grouped by `artifact_type`, each showing freshness (`stale_reason`/`last_refreshed_at`) and a one-tap reopen (focus the board card or open the notebook/prototype). Closes the gap the exploration flagged: **prototypes are currently board-local with no gallery**.

---

## 7. The Custom engine

The user's *"one more button: custom"* — for ops we don't pre-make (research-paper calculator, product polisher, image/social-post). A `custom` verb already exists hidden (`canvas-operations.ts`, `/api/canvas/custom-op`). Promote it to a dock circle: the user describes the operation → the engine plans its own op chain → produces a persistent `custom` artifact. Saved custom engines can be re-pinned and re-run (persist in `custom_engines[]`, §1).

---

## 8. tldraw shapes touched / added

Register all new/changed shapes in `src/types/tldraw-shapes.d.ts` (**GOTCHA**: missing here = TLShape constraint failure — [[project_prompt_sharpening_card]]).
- `voice-note-card`: add `expanded`, `analysisJson`, `durationMs`.
- `journal-card` → keep as the Notebook *handle*; add `artifactId`.
- New (if needed): `artifact-card` generic handle for image/post/custom (or reuse existing per-type cards).

---

## 9. Phasing

1. **Voice fixes** — editable + expandable notes, show AI analysis/metadata, remove auto-journal. Small, self-contained, immediately fixes the "weird" feeling. *(No migration except the `voice_notes` shape change, which is back-compat.)*
2. **`artifacts` table + Dock skeleton** — migration + `artifacts.ts` helper + the floating dock with **Prototype** (moved out of the rail) and **Notebook** pinned. Wire the runner.
3. **Notebook rebuild — Phase A** — block model + on-canvas editable panel + add-from-whiteboard; lazy-backfill the old journal blob.
4. **Artifacts Library** — the re-access gallery in the Library rail.
5. **Notebook Phase B + Image + Social + Custom engines** — fill out the dock; full-page notebook.

---

## 10. Collision & coordination notes

Parallel Claude sessions co-edit the objective canvas ([[project_parallel_workstreams]]). Before each phase: `git status` + `list_migrations`, prefer **new files** (artifact-dock.tsx, artifacts.ts, artifact-engines.ts, new routes), and avoid heavy edits to shared hot files (`whiteboard-base.tsx`, `powerup-rail.tsx`, `board-bus.ts`) beyond additive listeners/exports. New migration uses a fresh `2026XXXX` stamp; never reuse. Re-assert any CHECK constraint supersets if touching shared enums.
