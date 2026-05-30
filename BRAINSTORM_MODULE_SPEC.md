# BRAINSTORM MODULE SPEC

**Status:** Locked 2026-05-29
**Owner:** Objective-canvas workstream
**Sister specs:** NOTEBOOK_TIMELINE_PLAN.md · AUTOPILOT_RESTRUCTURE_SPEC.md · MECHANISM_EXPERIENCE_SPEC.md

---

## 1. Mandate

Turn the scattered "make this better" surfaces (intake variant lab, R&D refine, annotation Deepen, enrich-chains, canvas autopilot, auto-elect) into **one orchestrated brainstorming module** that:

- Auto-presses the existing generation endpoints in a structured pipeline
- Cleans up + ranks results without user intervention
- Visualises the session on a side-rail tldraw page that collapses into the base whiteboard
- Persists sessions to a library so past brainstorms become reusable + training signal
- Lets the user add their own ideas as first-class, scored candidates

**Scope discipline:** This is an **orchestrator over existing endpoints**, not a replacement. The only NEW LLM call is the critique-and-rank pass. Everything else reuses what's built.

## 2. The 5 locked decisions

| # | Decision | Pick | Rationale |
|---|----------|------|-----------|
| 1 | Scope | **Picker-only MVP** (sub-objective approval page) | Same runner shape generalises to room features + annotations in Phase 6 |
| 2 | "Best" definition | **Composite: coverage 0.40 · diversity 0.25 · user-preference 0.20 · critique 0.15** | For sub-objectives, parent objective text IS the spec, so coverage dominates. Tunable. |
| 3 | Auto-elect vs. surface | **Never auto-elect.** Top 3 get green "ready" ribbon, one click still required | Canvas reviewing IS the user's work — autopilot-elect breaks that |
| 4 | User-added ideas | **Graded, never cut.** Same axes as LLM candidates, always above tray | User sees how their idea ranks against LLM; never demoted out of view |
| 5 | Whiteboard architecture | **One new tldraw page on the existing objective board** | "Collapse into base" = literal page switch. Persists for free via `useObjectiveBoardPersistence`. |

## 3. Press-by-press sequence (the user-visible flow)

User is on the sub-objective approval page (picker), has some proposals already (initial batch), maybe has elected/deferred/rejected some.

User presses `Brainstorm` (top chrome of picker, beside the existing "Generate better" bar — the bar STAYS as the manual single-intent option).

### Stage 0 — Panel slides in (0s)
Rail-card panel slides from the right (same chrome as `lab-notebook-panel.tsx` `rail-card` mode — non-modal, base canvas stays interactive). Hosts a new tldraw page on the existing objective board.

Header: *Brainstorming sub-objectives for "{objective title}" · 3 rounds → cleanup → critique → rank · ~30s*

### Stage 1 — Plan shows itself (~1s, no LLM)
The Runner reads state and picks **3 intents**:
- Always: **1 gap_fill** if `lens_coverage` has uncovered phrases
- **2 more from history** — per-intent elect-rate from `decision_log`. First-time users: `creative + contrarian`
- Renders the plan as 3 swappable chips. User can override before `Start`.

This is the only steering point. Everything after runs autopilot.

### Stage 2 — Divergence (~8-12s, streaming)
For each intent, the Runner calls existing `POST /api/brainstorm/sub-objectives/propose` mode=`variant`, with anti-duplicate context = (current proposals + rejected ones).

Candidates **stream onto the tldraw page** as they generate — each a draggable shape coloured by intent. Lens-coverage chips fill in under each card as the LLM returns them. End of stage: ~9-15 candidates.

### Stage 3 — Cleanup (~3s)
Existing `POST /api/brainstorm/sub-objectives/cluster` runs. Cards **auto-arrange into themed groups** via tldraw frames. Duplicates greyed (one-click restore). Soft-overlaps nudge toward each other so spatial proximity = semantic proximity.

### Stage 4 — Critique + rank (~10s) — *the only new LLM call*
**One batch LLM call** scores every surviving candidate:
```
0.40 · lens_coverage_gain
0.25 · diversity (cluster distance from existing elected set)
0.20 · user_preference_fit (matches your decision_log elect pattern)
0.15 · critique_pass_verdict (LLM "is this load-bearing?" pass)
```
Per-candidate reasoning: *why strong · where it stretches · what's missing · closest neighbour.*

Cards get ribbons: top 3 = **green "ready to elect"**, next 4 = **amber "explore"**, rest fall into a **collapsed tray** at the bottom.

### Stage 5 — Settled state (instant)
- Top-left: top 3 ranked with critique inline
- Middle: amber "explore" lane
- Bottom: tray (one-click expand)
- Toolbar: **"Add your idea"** sticky-note tool — typed text becomes a first-class candidate, scored on the same axes

User can:
- **Click green card → elects on the picker** (writes through existing `/disposition` endpoint, instant)
- **Drag between top/explore/tray** — moves logged + feed preference learning
- **Press `Brainstorm again`** — fresh 3-round run with intents adjusted by what just happened
- **Press `Collapse`** — tldraw page minimises into the base board as a labelled frame
- **Press `Save to library`** — pinned for cross-space reuse (auto-saves on close regardless)

Every elect from this panel marks `elected_from_brainstorm=true` in decision_log so future runs learn which intents + critique-reasons actually convert.

## 4. Architecture (three thin layers over what exists)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Brainstorm Rail-Card Panel  (Phase 4)                               │
│  - tldraw page on existing objective board                           │
│  - rail-card chrome (matches lab-notebook-panel)                     │
│  - candidate cards · clustering frames · sticky-idea tool · ribbons  │
└──────────────────────────────────────────────────────────────────────┘
                              │ SSE events
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Brainstorm Runner  (Phase 2)                                        │
│  POST /api/brainstorm/sessions/run                                   │
│  - Decides intents (lens coverage + decision_log preference rate)    │
│  - Loops existing /sub-objectives/propose mode=variant per intent    │
│  - Runs existing /sub-objectives/cluster for cleanup                 │
│  - Calls NEW critique endpoint for rank                              │
│  - Emits via existing pipeline_runs + pipeline_run_events            │
└──────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  EXISTING:   │    │  EXISTING:       │    │  NEW (Phase 3):  │
│  /sub-       │    │  /sub-           │    │  /sessions/      │
│  objectives/ │    │  objectives/     │    │  critique        │
│  propose     │    │  cluster         │    │  (1 batch LLM)   │
│  mode=variant│    │                  │    │                  │
└──────────────┘    └──────────────────┘    └──────────────────┘
                              │
                              ▼
                    ┌──────────────────────┐
                    │  brainstorm_sessions │  ← Phase 1 (this commit)
                    │  table               │
                    └──────────────────────┘
```

## 5. Data model

### New table: `brainstorm_sessions`

```sql
CREATE TABLE public.brainstorm_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id          uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- WHAT we're brainstorming on. sub_objective_id NULL = picker-level (Phase 1).
  -- Phase 6 sets entity_id (room feature) or annotation_index (annotations).
  target_kind       text NOT NULL CHECK (target_kind IN ('sub_objective_picker','room_feature','annotation')),
  sub_objective_id  uuid REFERENCES public.improvement_goals(id) ON DELETE SET NULL,
  entity_id         uuid REFERENCES public.entities(id) ON DELETE SET NULL,

  -- The plan + outcomes, all in one JSONB for atomicity. Each session
  -- has 1 plan (chosen intents), N generation batches (one per intent),
  -- 1 cleanup pass, 1 critique pass, N candidates with ribbons + scores.
  plan              jsonb NOT NULL DEFAULT '{}'::jsonb,
  generations       jsonb NOT NULL DEFAULT '[]'::jsonb,
  cleanup           jsonb,
  ranking           jsonb,
  user_added_ideas  jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- tldraw integration. The brainstorm session = one named tldraw PAGE
  -- on the existing objective board. The page id is stored here so the
  -- panel can switch the editor to it on open + library can re-open.
  tldraw_page_id    text,

  -- Library affordances.
  pinned            boolean NOT NULL DEFAULT false,
  title             text,           -- auto-generated, user-editable
  outcome_summary   text,           -- "elected 3 of 12, 2 user ideas"

  -- Lifecycle.
  status            text NOT NULL DEFAULT 'running' CHECK (status IN ('running','settled','abandoned')),
  started_at        timestamptz NOT NULL DEFAULT now(),
  settled_at        timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX brainstorm_sessions_space_user_idx
  ON public.brainstorm_sessions(space_id, user_id, started_at DESC);

CREATE INDEX brainstorm_sessions_pinned_idx
  ON public.brainstorm_sessions(user_id, pinned, settled_at DESC)
  WHERE pinned = true;
```

### JSONB shapes

```typescript
// plan
{
  intents: ["gap_fill", "creative", "contrarian"],  // 3 in order
  reasons: {
    gap_fill: { uncovered_lens: [2, 5] },
    creative: { source: "user_preference", elect_rate: 0.62 },
    contrarian: { source: "default" }
  }
}

// generations[i] — one entry per intent run
{
  intent: "gap_fill",
  generation_number: 1,
  batch_id: "...",                  // foreign-ref to /propose's batch
  candidates: [
    { proposal_id, title, summary, lens_coverage, confidence }
  ],
  generated_at: "2026-05-29T...",
  latency_ms: 4200
}

// cleanup
{
  clusters: [{ theme, proposal_ids, representative_id }],
  duplicates: [{ a: id, b: id, similarity: 0.92 }],
  ran_at: "..."
}

// ranking
{
  candidates: [
    {
      proposal_id,
      composite_score: 0.78,
      sub_scores: { coverage: 0.31, diversity: 0.22, preference: 0.15, critique: 0.10 },
      ribbon: "green" | "amber" | "tray",
      reasoning: { why_strong, where_stretches, whats_missing, closest_neighbor }
    }
  ],
  ranked_at: "..."
}

// user_added_ideas[i]
{
  id, title, body, added_at,
  scored_with_session: true,
  sub_scores: { coverage, diversity, preference, critique },
  composite_score, ribbon
}
```

### decision_log extension

Three new actions, written via existing `logDecision()`:

| Action | When | Metadata |
|--------|------|----------|
| `brainstorm_started` | User presses `Brainstorm`; Runner accepted | `{ session_id, target_kind, planned_intents, intent_reasons }` |
| `brainstorm_completed` | Runner finishes critique pass | `{ session_id, n_candidates, n_top, n_explore, n_tray, latency_ms }` |
| `brainstorm_elected` | User clicks a candidate to elect | `{ session_id, proposal_id, ribbon, composite_score, intent_of_origin }` |

CHECK constraint re-asserts the **full 38-action superset** from `20260906_deliverable_visibility.sql` + the 3 new ones. Clobber-trap defence per project_parallel_workstreams memory.

## 6. UI integration points

### 6.1 Press point

In `sub-objective-picker-card.tsx`, the existing **"Generate better" bar** (lines 865–987) stays as the single-intent manual path. **Add a sibling primary button** `Brainstorm` adjacent to it, with the lightning/sparkles icon. Opens the rail-card panel.

### 6.2 Rail-card panel

New component `BrainstormPanel` (path: `src/components/objective/brainstorm/brainstorm-panel.tsx`). Reuses the `chrome="rail-card"` mode from `lab-notebook-panel.tsx` so canvas underneath stays interactive. Mounts at layout level (same Phase 11.0b pattern as the Lab Notebook).

### 6.3 tldraw page

On `Brainstorm` press, the panel calls `editor.createPage()` with the session id as the page name. Switches the editor to that page. On `Collapse`, switches back to the main page — the brainstorm page persists as a named frame in the page sidebar. On `Save to library`, sets `pinned=true` on the session row.

### 6.4 Library lens

Phase 5. New view at `/app/library/brainstorms` (or as a tab on the existing workspace library). Reuses `ExperimentsLibraryView` card chrome.

## 7. What this is NOT

- **Not a new divergence prompt.** Reuses the variant lab's. Building a parallel divergence prompt is the orphan-subsystem trap.
- **Not a per-candidate critique.** ONE batch LLM call across all surviving candidates — 10x cheaper + scores comparable.
- **Not a replacement for the manual variant lab.** Power users keep one-intent-at-a-time. Brainstorm is the autopilot version.
- **Not a destructive cleanup.** Tray is always recoverable. No candidate is hard-deleted unless the session is abandoned.
- **Not a locked plan.** The 3-chip plan is editable before launch. Want all wildcard? Allowed.
- **Not a second tldraw board.** A new PAGE on the existing one. Same canvas, same persistence.

## 8. Build sequence

| Phase | Scope | Status |
|-------|-------|--------|
| **1a** | `brainstorm_sessions` migration + decision_log actions (full superset re-assert) | ✅ shipped (`20260907_brainstorm_sessions.sql`) |
| **1b** | TypeScript types + DecisionAction union extension | ✅ shipped (`src/lib/brainstorm/session-types.ts`) |
| **1c** | Session CRUD helpers | ✅ shipped (`src/lib/brainstorm/sessions.ts`) |
| **2** | Brainstorm Runner — `POST /api/brainstorm/sessions/run` orchestrating plan → 3× /propose → /cluster → critique → settle | ✅ shipped (`src/app/api/brainstorm/sessions/run/route.ts` + `src/lib/brainstorm/plan.ts` + `src/lib/brainstorm/critique.ts`) |
| **3** | LLM critique — `rankWithLLMCritique()` swap inside `critique.ts`; one batch call, scores + prose reasoning, soft-fails to deterministic | ✅ shipped (additive: `rankDeterministic` retained as fallback) |
| **4** | BrainstormPanel rail-card + Brainstorm button + elect-candidate route | ✅ shipped (`src/components/objective/brainstorm/*.tsx` + `src/app/api/brainstorm/sessions/[id]/elect-candidate/route.ts`) |
| **4-polish** | Abandon-on-close + re-open from library (rehydrate panel from prior session) | ✅ shipped (`/sessions/[id]/abandon` route + `rehydrateSession` panel prop + popover `onSelect` plumbing) |
| **4b** | tldraw page integration · per-stage SSE streaming via pipeline_runs/events · user-idea persistence · collapse-to-base | Pending |
| **5** | Brainstorm Library lens — `GET /sessions` + `POST /sessions/[id]/pin` + `BrainstormLibraryPopover` wired into the picker | ✅ shipped |
| **6** | Generalise to room features + annotations (target_kind switch) | Pending |

End-to-end MVP (Phases 1-5 + polish): shipped. Unique invention is *only* the critique-rank LLM call + the orchestration UX — everything else is plumbing over what exists.

### What's wired end-to-end right now
- Press `Brainstorm` on the sub-objective picker → orchestrated 3-intent run → LLM critique → settled candidates in 3 ribbon lanes
- One-click elect on any candidate writes through to `sub_objective_decisions` + the picker mirrors locally so lens-coverage strip updates without re-fetch
- Save-to-library pin · re-open past sessions from the library popover (jumps straight to settled view)
- Close mid-run cleans up the session row as `abandoned`
- User-added ideas live as local sticky-notes (Phase 4b persists + scores them)

## 9. Anti-patterns watched

From memory:

- **`feedback_check_existing_first.md`** — every existing endpoint already mapped + reused. New surface area = 1 table, 1 endpoint, 1 panel, 1 type module. No parallel "make-better" generator.
- **`project_parallel_workstreams.md`** — full 38-action superset re-asserted in CHECK constraint. New types added to DecisionAction union, not new union.
- **`feedback_structural_events_only.md`** — Runner emits via existing `pipeline_runs` / `pipeline_run_events` infra. Persist-then-emit. Soft-fail throughout.
- **`feedback_autonomy_rigor.md`** — every upstream (picker button, lens-coverage signal, decision_log) and downstream (disposition write, preference learning, library) wired in this spec.

## 10. Cross-references

- Variant lab today: `src/components/objective/sub-objective-picker-card.tsx:865-987`
- Cluster pass: `src/app/api/brainstorm/sub-objectives/cluster/route.ts`
- Variant propose: `src/app/api/brainstorm/sub-objectives/propose/route.ts`
- Decision log: `src/lib/objective-canvas/decision-log.ts`
- Latest action constraint: `supabase/migrations/20260906_deliverable_visibility.sql`
- Rail-card chrome pattern: `src/components/objective/lab-notebook-panel.tsx`
- Base whiteboard + tldraw editor: `src/components/objective/whiteboard-base.tsx`
- Board persistence: `src/components/objective/use-objective-board-persistence.ts`
