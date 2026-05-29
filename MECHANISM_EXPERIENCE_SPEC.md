# Mechanism Experience View + Typed Inspiration — Build Spec

> The plan for adding the **end-user-facing** view of a mechanism (the "designed
> solution" preview), alongside the engineering L3 data-flow view planned in
> `MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md`. Scope: Objective Canvas tab only.
> No Apps, no `experiment_variants`, no legacy `/app/space/[id]/mechanisms`.
> Verified against the codebase 2026-05-29. Companion to
> `MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md` (the L3 §6b deliverable is finished
> by this spec).

---

## 0. The reconciliation in one line

The L3 "Mechanism Internals" altitude planned in `MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md` §6b
gets **two complementary tabs over ONE data source** — not two parallel rendering
subsystems:

```
L3 MECHANISM INTERNALS  (single subsystem, single data source = MechanismSpec)
  ├─ Tab A · Data flow  (engineering view — runtime_flow as a wired DAG)
  └─ Tab B · Experience (end-user view — what the user actually sees & does)
```

This finishes the deliverable opened by `MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md`
(Tab A) AND closes the `ui_connection` quality-score axis (Tab B) — which today
grades a gap the codebase doesn't render.

**No new file `enrich-ui-artifact.ts`. No new column. No new generator. Extend
`enrich-mechanism-spec.ts`; add two tabs to `MechanismSpecPanel`.**

---

## 1. Verified ground truth (re-read 2026-05-29)

| Concern | Status | Path |
|---|---|---|
| Mechanism spec generation | exists | `src/lib/objective-canvas/enrich-mechanism-spec.ts` |
| `MechanismRuntimeStep` (step · component · data · user_sees) | exists, flat list | `enrich-mechanism-spec.ts:137-146` |
| `MechanismSpec.user_visible_behavior` (user-facing summary) | exists | `enrich-mechanism-spec.ts:213-215` |
| Quality-score `ui_connection` axis | exists, ungraded | `enrich-mechanism-spec.ts:186-187` |
| `runtime_flow[]` rendered as a wired graph | **MISSING** | — |
| End-user "designed experience" rendering | **MISSING** | — |
| Inspiration sidebar | exists, lazy-fetched, single bucket | `item-detail-drawer.tsx:1237-1308` |
| Typed inspiration (technical vs design) | **MISSING** | — |
| Proactive inspiration trigger | **MISSING** (only fires on drawer open ~`:685`) | — |
| Tavily wrapper supporting `include_domains` by category | **MISSING** | `src/lib/research/tavily-client.ts` |
| Intake toggles (autopilot/human) | exists | `src/components/objective/objective-entry-card.tsx` |
| `UI agent /` skill files (cognitive-load, MoSCoW, a11y, app-type playbooks) | exists at repo root, **not imported** | `UI agent /*.md` (trailing space in dir) |
| AppRenderer / AppManifest | exists in Apps tab — **out of scope** | `src/components/apps/*` |
| Web-research toggle + research-completion gate | parallel session in progress — coordinate, don't duplicate | (hot files) |

---

## 2. Generator extension (one Claude call, additive fields)

Extend the existing types in `src/lib/objective-canvas/enrich-mechanism-spec.ts`.
All additions live in `entities.expanded_detail.mechanism_spec` JSONB — **no DB
migration**.

### 2a. `MechanismRuntimeStep` gains structured wiring + visual intent

```ts
export interface MechanismRuntimeStep {
  step: string;
  component: string;
  data: string;
  user_sees: string;

  // NEW — wires Tab A (Data flow) without parsing free text
  produces: string[];    // token IDs this step emits (e.g. "patient_risk_score")
  consumes: string[];    // token IDs this step needs (e.g. ["raw_vitals","schedule"])

  // NEW — wires Tab B (Experience)
  visual_intent: "screen" | "notification" | "ambient" | "physical" | "background" | null;
  interaction_sketch: string | null;  // 1–2 sentences: what the user does + how it feels
}
```

### 2b. `MechanismSpec` gains a `design_intent` block

```ts
export interface MechanismDesignIntent {
  glass_tier: "plate" | "card" | "float" | "hero";
  accent_intent: "signal" | "warning" | "growth" | "insight" | "neutral";
  density: "airy" | "comfortable" | "dense";
  motion_intent: "still" | "breathing" | "reveal" | "responsive";
  hero_pattern: "metric" | "flow" | "cycle" | "before_after" | "evidence" | "decision";
  reduction_log: string[];  // MoSCoW: what was kept (Must), deferred (Could/Should), removed (Won't) + why
}

export interface MechanismSpec {
  // ... all existing fields ...
  design_intent: MechanismDesignIntent;  // NEW
}
```

### 2c. Prompt change — server-cached `UI agent /` skill as system context

- On server boot (or first call), read all 6 files in `UI agent /`:
  `SKILL.md`, `human-centered-ui.skill`, `cognitive-principles.md`,
  `app-type-playbooks.md`, `accessibility-and-states.md`, `reduction-operator.md`.
- Concatenate into a single `UI_SKILL_SYSTEM` string. Cache in module scope.
- Append to the existing `system` prompt in `enrich-mechanism-spec.ts` so every
  spec generation respects the cognitive-load + MoSCoW reduction framework.
- The new fields in 2a/2b are added to the existing JSON schema the LLM is
  asked to emit — same Claude call, broader output.

### 2d. Quality-score `ui_connection` axis now has something to grade

Reword the rubric so `ui_connection` requires:
- every `runtime_flow[]` step has `visual_intent` non-null when `user_sees ≠ "—"`
- `design_intent` is internally consistent (e.g. `density: dense` + `motion_intent: reveal` is flagged)
- `reduction_log` shows at least one MoSCoW classification

A score < 0.6 still triggers the existing one-shot regenerate (unchanged behavior).

### 2e. The `concept_slug` field — leave a stub, do not build

Add an **optional** `concept_slug?: string` on `MechanismSpec` now (defaulted to
`undefined`). When the parallel concept-slug work lands (per
`MACRO_ROLLUP_AND_COORDINATION_SPEC.md` Step 5 + `ROOM_ANNOTATION_GLOSSARY_PHASE2_PLAN.md`),
this slot is ready without a schema change. Do NOT generate or wire it now.

---

## 3. Renderer — two new tabs inside the existing `MechanismSpecPanel`

Location: `src/components/objective/item-detail-drawer.tsx` `MechanismSpecPanel`
(~L4332). Today it's a tiered accordion (consumer summary → Mechanism →
Engineering). Add a tab strip at the top of the panel:

```
[ Summary ] [ Data flow ] [ Experience ] [ Engineering ]
              ^^^^^^^^^^^   ^^^^^^^^^^^
              new           new
```

### 3a. `Tab · Data flow` — finishes `MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md` §6b

New file: `src/components/objective/mechanism-dataflow-view.tsx`.
- Input: `mechanism_spec.runtime_flow[]` + `input_data[]` + `user_visible_behavior`.
- Build a directed graph from `produces` / `consumes` (2a), using ReactFlow
  (already in `package.json` via the room Map view).
- Nodes = steps (`component` label, `step` as subtitle). Inputs/outputs rendered
  as side rails. Edges labeled with the data token.
- L3 PENDING state: if `mechanism_spec` is absent, render "Deepen to generate"
  per `MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md` §7.

### 3b. `Tab · Experience` — the end-user designed view

New file: `src/components/objective/mechanism-experience-view.tsx`.
- Input: `mechanism_spec.runtime_flow[].user_sees`/`visual_intent`/`interaction_sketch`,
  `user_visible_behavior`, `design_intent`, `system_components[category=ui]`.
- Renders a single premium "designed solution preview" composed of small
  declarative tiles (no AppRenderer dependency):
  - **Hero**: chooses layout by `design_intent.hero_pattern` (`metric` →
    big number + delta; `flow` → 3-step ribbon; `cycle` → loop diagram;
    `before_after` → split; `evidence` → quote/citation stack; `decision` → fork).
  - **Touchpoints strip**: each `runtime_flow[]` step with `user_sees` becomes a
    glass tile; `visual_intent` chooses iconography ("screen" → device frame,
    "notification" → toast, "ambient" → glow ring, "physical" → solid object,
    "background" → muted card).
  - **Interaction sketch list**: ordered, concise per-step user actions.
- Style: uses **only** existing tokens from `src/app/globals.css` — `.glass-card`,
  `.glass-hero`, `--accent-blue`, the spring easings (`--ease-spring-soft`).
  No new design tokens. No new CSS file.
- Framer-motion: spring-fade-in on mount (already used elsewhere in
  `mechanism-subsystem-view.tsx` and the room Map).

### 3c. Tab visibility

- "Summary" + "Engineering" always shown (unchanged behavior).
- "Data flow" + "Experience" shown only when `mechanism_spec` is present.
- "Experience" additionally requires the `includeUi` flag from the intake
  toggle (§5) OR a user opt-in inside the panel ("Generate experience view"
  button), so existing spaces don't pay generation cost without consent.

---

## 4. Typed inspiration buckets — split the existing rail

### 4a. Typed Tavily wrapper (NEW file, doesn't touch the hot `tavily-client.ts`)

New file: `src/lib/research/typed-search.ts`.

```ts
type InspirationCategory = "technical" | "design";

const DOMAIN_ALLOWLIST: Record<InspirationCategory, string[]> = {
  technical: ["github.com","arxiv.org","ncbi.nlm.nih.gov","nature.com","ieee.org","stackoverflow.com"],
  design:    ["mobbin.com","dribbble.com","ui.shadcn.com","linear.app","vercel.com","ramp.com","apple.com"],
};

export async function searchTavilyTyped(opts: {
  category: InspirationCategory;
  query: string;
  maxResults?: number;
}) {
  // import { searchTavily } from "./tavily-client";  // unchanged, hot file
  return searchTavily({
    query: opts.query,
    depth: "advanced",
    topic: "general",
    maxResults: opts.maxResults ?? 5,
    includeDomains: DOMAIN_ALLOWLIST[opts.category],
  });
}
```

If `searchTavily` doesn't already accept `includeDomains`, add it as an
**optional** param in a small, isolated change at the bottom of `tavily-client.ts`
that the parallel session can easily merge through. **Coordinate before editing.**

### 4b. Extend `/api/brainstorm/item/research` to return TWO buckets

The route currently builds one query and writes `entities.detail_research`.
Change it to:

1. Build two queries from the entity context:
   - **technical**: `"<entity.name> — <sub_objective> — case studies precedents implementation"`
   - **design**: `"<entity.name> — <sub_objective> — UI design patterns interaction"`
2. Run `searchTavilyTyped` for each, in parallel.
3. Reshape `entities.detail_research` JSONB to:
   ```ts
   { technical: ItemSource[]; design: ItemSource[]; failed?: boolean; fetched_at: string }
   ```
4. Keep backward-compat: if an old row is detected (flat array), treat as
   `{ technical: [...], design: [] }`.

### 4c. Sidebar — two rails

`item-detail-drawer.tsx:1237` `Section "Inspiration"` becomes two adjacent
`Section`s:

```
[ Compass icon ] Technical inspiration  · N sources
  (case studies + precedents)
[ Palette icon ] Design inspiration  · N sources
  (UI patterns + interaction references)
```

Same render shape per row (the existing source card). The `informs` line keeps
its category-tinted color (technical = lane color; design = accent-blue).

### 4d. Proactive trigger — not lazy

Today fetched on drawer open (`item-detail-drawer.tsx:685`). Move to:
- Fire **once per entity** when `room/generate` completes — pull `entityId`s
  out of the run result and queue a background fetch. This puts inspiration
  in place before the user clicks.
- Keep the on-open path as a fallback (when the bg job hasn't completed yet).
- Cache by `entityId`; idempotent.

---

## 5. Intake toggle — third `ModeChip`

`src/components/objective/objective-entry-card.tsx` — the existing
autopilot/human `ModeChip` row.

- Add a third chip: **"UI design"** (Palette icon). Tooltip: "Generate end-user
  experience view + design inspiration for each mechanism."
- State: a separate boolean `includeUi`, NOT mutually exclusive with
  autopilot/human.
- On submit, pass `includeUi` to `/api/brainstorm/start`. Persist on the space
  as `synthesis_data.includeUi: boolean` (freeform JSONB — **no migration**, per
  `[[project_parallel_workstreams]]` and `[[project_event_bus_architecture]]`).
- `enrich-mechanism-spec.ts` reads `space.synthesis_data.includeUi`:
  - `true` → always emit the §2 new fields.
  - `false` → emit them only on explicit user request from the drawer
    (the "Generate experience view" button in §3c).

Coordinate the chip layout with the parallel session's **"Web research"**
toggle — they go in the same row. Suggested layout:

```
[ Bot ] Autopilot   [ User ] Human-in-loop
[ Globe ] Web research  [ Palette ] UI design
```

Two rows, two semantic groupings (flow control · enrichment).

---

## 6. Build sequence

| # | Step | Files | Migration | Visible payoff | Risk |
|---|---|---|---|---|---|
| **1** | **Typed inspiration buckets + sidebar split + proactive trigger** | `src/lib/research/typed-search.ts` (NEW), `/api/brainstorm/item/research/route.ts`, `item-detail-drawer.tsx:1237`, `/api/brainstorm/room/generate` (queue bg fetch) | none | sidebar populates with two clearly-categorized rails on entity creation | low — isolated, coordinate `includeDomains` param with parallel session |
| **2** | **Generator extension** — new fields on `MechanismRuntimeStep` + `MechanismSpec`; load `UI agent /` skill as system prompt; rework `ui_connection` rubric | `enrich-mechanism-spec.ts`, new `src/lib/objective-canvas/ui-skill-system.ts` (loader + cache) | none (JSONB) | new specs carry wiring + design intent; old specs unaffected | medium — touches a load-bearing file; add fields as optional first |
| **3** | **Data flow tab (Tab A)** — finishes `MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md` §6b | `src/components/objective/mechanism-dataflow-view.tsx` (NEW), `item-detail-drawer.tsx` `MechanismSpecPanel` | none | engineers can see the algorithm wired | low — new component, ReactFlow already present |
| **4** | **Experience tab (Tab B)** — the designed end-user preview | `src/components/objective/mechanism-experience-view.tsx` (NEW), `item-detail-drawer.tsx` `MechanismSpecPanel` | none | the "cool designed solution" view the user asked for | medium — most novel code; biggest aesthetic surface |
| **5** | **Intake toggle** | `objective-entry-card.tsx`, `/api/brainstorm/start/route.ts`, `enrich-mechanism-spec.ts` reads flag | none (JSONB) | users opt in/out at intake | low — pattern matches existing toggles |
| **6** | **Clarity / prioritization pass** — apply `UI agent /` MoSCoW reduction to the drawer itself (not just generated artifacts) | `item-detail-drawer.tsx` (sections, copy, hierarchy) | none | drawer reads cleaner, leads with results | medium — high-touch design work |

**Order rationale.** Step 1 is the fastest visible win and unblocks the design
side of the system (the Design rail feeds Tab B context). Step 2 lays schema
groundwork that both Tabs need. Steps 3+4 ship the two tabs (Tab A first
because it's strictly mechanical from `produces`/`consumes`; Tab B second
because it's the aesthetic hero). Step 5 (toggle) is intentionally last
because it gates generation cost — until Tab B exists there's nothing to gate.
Step 6 (clarity pass) waits until real content fills the drawer.

---

## 7. What NOT to do

- **Don't create `enrich-ui-artifact.ts` as a sibling generator.** Extend the
  existing one. Two generators = two truths.
- **Don't import `src/components/apps/*`.** The AppRenderer is out of scope.
  Tab B is OC-native.
- **Don't add new design tokens / CSS files.** Compose from existing `globals.css`
  (`.glass-card`, `.glass-hero`, `--accent-blue`, spring easings).
- **Don't generate JSX strings.** All output is declarative typed data; rendering
  is hand-written React. No sandbox, no `dangerouslySetInnerHTML`.
- **Don't run a migration.** Every persistence change rides existing JSONB
  columns (`expanded_detail.*`, `detail_research`, `synthesis_data.*`).
- **Don't touch `tavily-client.ts` beyond adding one optional `includeDomains`
  param** — the parallel session owns research wiring. Coordinate first.
- **Don't wire `concept_slug` now.** Add the optional field stub (§2e), leave
  it `undefined` until the cross-mechanism identity work lands.
- **Don't pre-generate Experience views for old specs at deploy time.** Only
  newly-generated or explicitly-requested specs get the new fields.

---

## 8. Coordination with the parallel session

The parallel session (per the user's report) is fixing web-search wiring:
- Confirming `TAVILY_API_KEY` set
- Adding a research-completion gate on `room/generate`
- Adding a "Web research" intake toggle persisted to `synthesis_data.enableResearch`

This spec composes cleanly with that work:

1. **Step 1's typed buckets ride whatever the parallel session ships.** If
   research is disabled, both rails are empty + show the same empty state.
2. **Step 5's "UI design" toggle sits next to the "Web research" toggle.**
   Same persistence pattern (`synthesis_data.*` freeform JSONB).
3. **Step 4's Experience tab degrades gracefully** — if the Design inspiration
   rail is empty (no API key, or the search-worthy gate skipped this objective),
   the Experience view is generated from the `UI agent /` skill + the spec only.
   Output quality drops but the tab still renders.
4. **The `includeDomains` param on `tavily-client.ts`** is the one tiny shared
   edit. Hand-off rule: whichever session opens that file first lands the
   optional param, the other rebases on top.

### Reconciliation note (paste to the parallel session)

> The proposed UI-artifact subsystem reconciles with the L3 view planned in
> `MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md` §6b: they become two tabs over the
> SAME `MechanismSpec` data. Spec at `MECHANISM_EXPERIENCE_SPEC.md`. The
> generator extension adds `produces`/`consumes` (your §6b §8.2 rigorous wiring)
> AND `visual_intent`/`interaction_sketch` + `design_intent` in one Claude call.
> No new generator file, no parallel persistence column.
>
> The OC work depends on web-research only softly — both rails degrade to
> empty + the Experience view falls back to skill-only generation. Please
> reserve one shared edit: an optional `includeDomains` param at the bottom
> of `tavily-client.ts`. Everything else additive in new files.

---

## 9. Open decisions (only one left)

★ = recommended.

1. **`includeUi` default at intake** — ★ default **off** (opt-in). UI
   generation costs tokens and most early objectives don't need it. The chip
   makes the choice visible. Flip default to on once the Experience tab is
   polished and users want it everywhere.

Everything else is decided above.

---

## 10. File index

| Purpose | Path | Status |
| --- | --- | --- |
| Generator (extend) | `src/lib/objective-canvas/enrich-mechanism-spec.ts` | extend |
| UI skill loader (cache `UI agent /` files) | `src/lib/objective-canvas/ui-skill-system.ts` | **NEW** |
| Typed Tavily wrapper | `src/lib/research/typed-search.ts` | **NEW** |
| Inspiration route (return 2 buckets) | `src/app/api/brainstorm/item/research/route.ts` | extend |
| Room-generate (queue bg inspiration fetch) | `src/app/api/brainstorm/room/generate/route.ts` | extend |
| Drawer panel + new tabs | `src/components/objective/item-detail-drawer.tsx` | extend |
| Data-flow tab (Tab A) | `src/components/objective/mechanism-dataflow-view.tsx` | **NEW** |
| Experience tab (Tab B) | `src/components/objective/mechanism-experience-view.tsx` | **NEW** |
| Intake toggle | `src/components/objective/objective-entry-card.tsx` | extend |
| Start route (read includeUi) | `src/app/api/brainstorm/start/route.ts` | extend |
| UI skill source | `UI agent /SKILL.md` etc. (6 files, trailing space in dir) | read-only |
