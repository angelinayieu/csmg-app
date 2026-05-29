# Notebook → Process Timeline — Final Design & Engineering Plan

> Status: design locked, not yet built. Authored 2026-05-28 after a first-hand
> code review of the decision-log data model, both notebook feeds, the event
> shape, and the existing grouping code.
> Companion to `OBJECTIVE_CANVAS_OPERATION_MAP.md` (operation inventory) and the
> locked notebook/bottom-bar division of labor.

---

## 0. Scope

This is **only** the right-side Lab Notebook popup (`LabNotebookPanel`). It does
**not** touch the canvas, the bottom command bar, or the Analysis Workbench. Per
the locked three-surface division:

- **Bottom bar** = the *now* + live + canvas-anchored navigation (non-occluding).
- **Analysis Workbench** = the *present-state brain* (priority, findings, "what next").
- **Notebook** = the ***record*** — the immersive reading surface. **This plan makes the record a process timeline.**

The notebook does **not** take over prioritization/recommendation (that's the
Workbench) or live canvas navigation (that's the bottom bar). It stays a reader —
but a structured, collapsible, clickable, chronologically-honest one.

---

## 1. The vision: a process transcript, not a flat feed

Today the notebook is a reverse-chronological list with day headers and one
special-cased autopilot group. The screenshot problem is real: **9 near-identical
"Spec'd mechanism" rows** in a row — pure noise, no structure, no sense of *what
process produced them*.

The inspiration (the voice-note transcript) teaches the right shape:

| Inspiration element | Maps to in the notebook |
|---|---|
| Date eyebrow + big title | "All Rooms · Today" + session title |
| Metadata pills (Family · 300 Words · 01:54) | Cluster counts ("12 experiments · 5 elections · 3 bets") |
| Sparse gutter timestamps (00:00, 00:30…) | **Chapter** time anchors — not one per row |
| Vertical rail + active node dot | The **spine**; the latest/active op is the lit node |
| Highlighted segment + inline chips (Family/Copy/Share) | Selected node + quick-actions (**Locate · Open · Ask**) |
| Color-coded highlights (blue / pink) | Lane colors on **headline** nodes (decisions vs routine) |
| Dimmed "unplayed" text | Collapsed / low-priority nodes render dimmed |
| Play + scrubber bar | **Belongs to the bottom bar** (live conductor), *not* here |

The core reframe: **the timeline is a fork-tree of micro-processes.** A single
human or AI action (run autopilot, generate a batch, birth a room) is a **chapter
node** on the spine; the micro-operations it spawned **fork off as collapsible
children**. You read chapters newest-first (catch-up), but *inside* a chapter the
children read oldest→newest (the sub-process as it actually unfolded — like
reading a transcript segment).

---

## 2. Information architecture — the fork-tree model

Three levels of zoom (progressive disclosure):

```
CHAPTER  (collapsible headline — one line)         ← default view
  └─ NODE (a logged operation)                     ← expand once
       └─ DETAIL (scores, evidence, breadcrumb)    ← expand again / hover
```

### 2.1 Chapter types (parent → children)

These are the real clusters in the data. Each has a **linkage signal** we can use
to group its children:

| Chapter | Parent event | Children | Linkage available today |
|---|---|---|---|
| **Autopilot session** | `autopilot_run` | `score`, `rd_iterate` | `meta.chain_ids[]` + time window (already done, fragile) |
| **Generation batch** | `generate_batch` | `elect`/`reject`/`defer`/`confirm` | shared `batch_intent` + same `entity_id`/room |
| **Room birth** | `room_generated` | `mechanism_spec_generated`, `item_expanded` | same `sub_objective_id`, time-adjacent **← the "9 Spec'd mechanism" noise cluster** |
| **Layer build** | `layers_generated` / `layers_regenerated` | (space-level, few/no children) | self-contained |
| **Chain enrichment** | `chains_enriched` | — (leaf) | self-contained |
| **Compose / bet** | `compose`, `approve_bet` | — (leaf, headline) | self-contained |

Anything not in a chapter renders as a **standalone node** on the spine.

### 2.2 The linkage problem (the one real schema gap)

There is **no `parent_id`/`group_id` column** on `sub_objective_decisions`
(verified: `20260827_sub_objective_decisions_log.sql` +
`20260828_lab_notebook_phase9.sql`). The only existing fork-tree —
`groupAutopilotChildren` (`lab-notebook-panel.tsx:1632`) — infers children by a
**5-minute time window**, and its own comment admits it can't match by id.

Two failure modes of pure client-side inference:
1. **False grouping** — unrelated manual work inside the window gets swept in.
2. **Pagination splits** — the feed pages 30 rows by `created_at`; a chapter that
   straddles a page boundary **loses its children**. This is a real bug waiting
   to happen as soon as clusters get large.

**Decision: add a first-class group column.** Nullable, stamped at write time by
the orchestrators that already know their parent. This is the foundation that
makes the fork-tree robust and lets the *server* roll clusters up (so pagination
counts a chapter as one unit instead of splitting it).

```sql
-- new migration
alter table public.sub_objective_decisions
  add column group_id uuid,          -- shared by all rows of one chapter
  add column group_kind text;        -- 'autopilot' | 'batch' | 'room_birth' | ...
create index sub_objective_decisions_group_idx
  on public.sub_objective_decisions(group_id);
-- composite for the space feed's hot path (space + recency)
create index sub_objective_decisions_space_recency_idx
  on public.sub_objective_decisions(space_id, created_at desc);
```

Legacy rows (group_id null) fall back to the existing time-window inference, so
nothing regresses.

---

## 3. Visual & interaction spec

### 3.1 Layout (top → bottom)

1. **Header** — date eyebrow + title ("All Rooms" / room name), and a single
   **count line** ("75 events · 12 experiments · 5 decisions") instead of the
   current bare "75 events". Close button. Lose the heavy treatment.
2. **Lens chips** (the existing FILTERS: All / Experiments / Elections / Bets /
   System) — kept, but demoted to a quiet segmented row. They filter; they don't
   structure. Structure comes from chapters.
3. **The spine** — a single hairline rail down the left. Sparse **time anchors**
   in the gutter at chapter boundaries (not per-row). Chapters and standalone
   nodes hang off it.
4. **Chat composer** — docked at the bottom (as today), but see §5 for tighter
   integration.

### 3.2 Chapter node (collapsed — the default)

One calm line: a lane-colored dot on the spine, an icon, a **synthesized
headline**, a child count, and a relative time.

```
●  Spec'd 7 mechanisms · Goal-Driven Knowledge Pathways      18m ago  ▸
```

- **Default-collapsed** for routine/noisy chapters (room births, batches,
  autopilot sessions). The 9-row wall becomes **one line**.
- Expanding reveals children indented under a thin fork rail (the
  `border-l pl-3` pattern `AutopilotGroupRow` already uses at line 1766),
  ordered **oldest→newest**.

### 3.3 Node (a single operation)

Borderless row (the minimalist pass already shipped this): icon badge in a lane
tint, label, subject (`object — room`), method/score chips where present,
timestamp. **No card borders, no side-spines** (taste rule).

### 3.4 Active / selected node → inline actions

Mirrors the inspiration's active segment. On hover/select, a node reveals inline
quick-action chips:

- **Locate** → tie-back to canvas (§4).
- **Open** → open the object's drawer/room.
- **Ask** → inject this node as a referenced context chip into the chat (§5).

### 3.5 Priority / noise model (what gets dimmed vs. led-with)

Three weights drive default visibility:

- **Headline** (lane-colored, always expanded, never dimmed): irreversible /
  high-meaning ops — `approve_bet`, `compose`, `elect`, surprising `score`
  (lift beats baseline), `theme_distilled`.
- **Routine** (normal weight): `generate_batch`, `mechanism_spec_generated`,
  `rd_iterate`, `item_expanded`.
- **Muted** (dimmed, folded into chapter counts): pure churn.

A "Key moments" lens (derived, no new data — uses `meta.lift_pct`,
`meta.approved`, action type) shows only headlines. This is the "see the most
important things" ask, and it's derivable **today**.

> Note: this is *visual* weighting of the record, not recommendation. Standing
> judgments about current state ("what to fix next") stay in the Workbench.

---

## 4. Tie-back to the canvas (clickable)

**Most of this is already wired.** `onNavigate(target: NotebookNavigateTarget)`
exists and `{ entityId, variationId, subObjectiveId }` is already passed by the
autopilot child rows (`lab-notebook-panel.tsx:1775`). The event shape already
carries room id+title and entity/variation/chain id+name. **No schema work, no
position storage needed** — the canvas maps ids→coordinates at render via
`layer-model.ts`.

What's missing:
1. **Call `onNavigate` from every node**, not just autopilot children.
2. **Host implements focus+highlight.** `main-canvas-view` (the host) resolves the
   target id → canvas coordinate → camera focus + object bloom.
3. **The occlusion hand-off.** Because the popup covers the canvas, "Locate" is a
   *deliberate exit*: close/step-aside the notebook, then the canvas focuses the
   object. (Locked division — never live-link an occluding surface.)
4. **Structural breadcrumb** on each node (`Room › Layer › Object`) from the
   subject fields — gives "where it belongs" *without* needing the canvas at all.
   This covers most tie-back moments inside the reader.

---

## 5. Chat accuracy & integration

The user reads this as "a bit like a chat." Today the chat and the timeline are
two stacked lists. Tighten them into one surface:

- **Ask-about-this**: the node "Ask" action injects a **reference chip**
  ("re: Spec'd mechanism — Trust-Centric Data Sharing") into the composer, so the
  agent answers grounded in that exact event. The timeline becomes the chat's
  context picker.
- **Chat-fired actions already refresh the feed** (`:309`, `:348`) — keep that;
  it's the one live-ish path today.
- Keep the agent intro bubble, but make it collapsible so it isn't permanent
  chrome.

This is what makes it "chat-accurate": the record and the conversation reference
the same objects, instead of being parallel.

---

## 6. Liveness (so the timeline moves while work runs)

Today the open panel refetches only on **open**, **filter change**, and **after a
chat action** — there is no SSE/Realtime/poll/focus listener, and the SSE bus
(`/api/pipeline/stream`) is a **different subsystem** that never touches this
data. So if autopilot runs while the panel is open, the timeline is frozen.

Two grounded options (the SSE bus is *not* one of them — wrong subsystem):

- **MVP — lightweight poll.** While the panel is open *and* a run is active, poll
  the feed every ~3–5s. Cheapest, matches the doc's existing "poll on open"
  philosophy. ~half a day.
- **Proper — Supabase Realtime** subscription on `sub_objective_decisions`
  filtered by `space_id`. The app **already uses Realtime** (synergy/twin hooks +
  `*_realtime.sql` migrations) and RLS is already on this table — so the pattern
  and security exist. New rows stream in; the timeline animates the new node onto
  the spine. This is the "settle moment" — a chapter forms live, then calms.

Recommend MVP poll first, Realtime as the upgrade once the timeline render lands.

---

## 7. Coverage audit (does the record have holes?)

`OBJECTIVE_CANVAS_OPERATION_MAP.md` (dated 2026-05-27) lists operations that log
nothing. Since then the action set has grown a lot — `ALLOWED_ACTIONS` now
declares ~27 actions and most have real metadata shapes + filter buckets, and
`autopilot_run` **does** fire now (the doc says it never did — that entry is
stale). But **declared ≠ fired.** Before calling the record complete, run a
one-pass audit: for each action in `ALLOWED_ACTIONS`, grep for a `logDecision({
action: … })` call site. Any with zero sites is a hole (the chapter will look
empty). This is mechanical and should be done as P0.5, not assumed.

---

## 8. Build sequence

| Phase | What | Depends on | Rough size |
|---|---|---|---|
| **P0** | `group_id`/`group_kind` migration + composite index | — | small |
| **P0.5** | Coverage audit: confirm every `ALLOWED_ACTION` has a writer | — | small |
| **P1** | Thread `group_id` at write time in the orchestrators (autopilot runner, batch generator, room generator) | P0 | medium |
| **P2** | Server-side cluster rollup in both feed routes (return chapters, not split rows) | P1 | medium |
| **P3** | Timeline render: spine, chapter nodes, collapse, gutter time anchors, priority weighting | P2 | large (the UI) |
| **P4** | Tie-back: call `onNavigate` from every node + host focus+highlight + step-aside hand-off + breadcrumb | P3 | medium |
| **P5** | Chat integration: ask-about-this reference chips | P3 | small |
| **P6** | Liveness: poll while active → then Realtime subscription | P3 | small → medium |

Generalize `groupAutopilotChildren` into a `buildChapters(events)` that switches
on `group_id` first and falls back to time-window inference for legacy rows.
`AutopilotGroupRow` becomes the generic `ChapterRow`.

---

## 9. File-by-file change map

- `supabase/migrations/<new>_decision_groups.sql` — add `group_id`, `group_kind`, indexes.
- `src/lib/objective-canvas/decision-log.ts` — `logDecision` accepts optional `group_id`/`group_kind`.
- `src/components/objective/canvas-autopilot-runner.tsx` + `.../autopilot/start` routes — generate one `group_id` per run, stamp parent + children.
- Batch generator + `room_generated` writers — stamp `group_id` for their child ops.
- `src/lib/objective-canvas/notebook-events.ts` — add `group_id`/`group_kind` to `NotebookEvent`; add a `Chapter` type.
- `src/app/api/brainstorm/sub-objectives/[id]/decisions/route.ts` + `.../space/[spaceId]/decisions/route.ts` — roll rows into chapters server-side; paginate by chapter so clusters never split.
- `src/components/objective/lab-notebook-panel.tsx` — replace `groupByDay`/`groupAutopilotChildren`/`AutopilotGroupRow`/`NotebookRow` with the spine + `ChapterRow` + generic node; wire `onNavigate` on every node; add inline actions; priority weighting; "Key moments" lens; poll/Realtime.
- `src/components/objective/main-canvas-view.tsx` (host) — implement focus+highlight + step-aside on navigate.

---

## 10. Open decisions to confirm before building

1. **Ordering** — recommend newest-first chapters, oldest→newest *within* a
   chapter. Alternative: fully chronological with a pinned "now" (more transcript-
   literal, weaker for catch-up). **Recommend the former.**
2. **group_id now vs. later** — recommend doing it now (P0). The pure client-side
   path works for a demo but the pagination-split bug is real and the writers that
   know the parent exist today, so threading it is cheap insurance.
3. **Liveness depth** — poll for MVP, Realtime as upgrade. Confirm that's
   acceptable vs. investing in Realtime immediately.

---

## 11. What we are explicitly NOT doing

- No prioritization/recommendation engine in the notebook (Workbench owns it).
- No live canvas navigation from the open popup (occlusion → step-aside only).
- No wiring to the `pipeline_run_events` SSE bus (wrong subsystem).
- No canvas redesign, no time-scrub/replay (the "scrubber" maps to the bottom
  bar's live role, not here).
- No storing x/y positions on events (canvas derives coordinates from ids).
