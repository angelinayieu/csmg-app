# Mechanism Page Consolidation Plan

**Status:** spec for review — implementation gated on approval.
**Order:** ships **before** `AUTOPILOT_COOPERATION_PLAN.md` v2 so new data lands in a settled UI.

---

## 1. Why

Today one feature (mechanism) is reachable through **3 different per-mechanism surfaces** inside a single room — Category card inline list, Mechanism Gallery flip-deck, and the right-rail drawer with its 4 spec tabs. Plus an orphan legacy Twin drawer on `/app/space/[id]/twin/`. The user can interact with the same variation in three places, each with a different visual language. Result: information is "gathered" (everything exists) but not "organized" (no canonical home).

This plan establishes **one canonical mechanism page** per mechanism, with seven named sections (no more tabs), reachable from a stable URL.

---

## 2. Target shape

### 2.1 Canonical URL

```
/app/objective/[spaceId]/mechanism/[entityId]
```

Stable, bookmarkable, shareable. Same `spaceId`/`entityId` semantics as everywhere else in the app.

### 2.2 Seven sections, top-to-bottom

| § | Section | Source data |
|---|---|---|
| 1 | **Overview** | `expanded_detail.definition` · `causal_chain.positive_outcome` · cross-room analysis signals · current disposition state · quick-action buttons (elect / regenerate / open in room) |
| 2 | **Variations** | `expanded_detail.variations[]` (all of them, with `effectiveness_score`, `tradeoff`, `open_questions`, `prototype_briefs`, "Design experiment" buttons, "Deepen" links) |
| 3 | **Spec** *(fused from today's 4 tabs)* | `expanded_detail.mechanism_spec.*` — mechanism_of_action, active_ingredients, data flow DAG, experience layer (design_intent + interaction sketches), engineering detail (procedure, components, dosage, fidelity, research_basis). Collapsible subsections inside one page section. |
| 4 | **Inspiration** | `detail_research.technical[]` and `detail_research.design[]` — two rails, side-by-side at wide widths, stacked on narrow |
| 5 | **Planning** | `expanded_detail.planning` — Assumes / Depends on / Risks |
| 6 | **Chains** | `LinkedChainRef[]` — every chain this mechanism participates in, with % strength and click-through to the chain visualization |
| 7 | **Decisions** | Full decision-log scope for this entity (compose, elect, reject, defer, score, refine, mechanism_spec_generated, scan-touch events) |

**Cross-room signals** (today shown as "Analysis signals" in the drawer) live as a callout band inside §1 Overview when present, not their own section. They're situationally rare and don't deserve a top-level slot.

### 2.3 Layout

- Full-width on desktop with a sticky right-rail "section nav" listing the 7 sections (scroll-spy).
- Header band: feature name, layer chip, lateral disposition state, "Open in room" back-link (returns to the room with this feature pre-focused).
- No tabs anywhere. If a subsection (e.g. Engineering details under §3 Spec) is dense, it's collapsible-by-default but stays on the same page.

---

## 3. What changes at each existing surface

| Existing surface | Fate | Note |
|---|---|---|
| Right-rail drawer (`item-detail-drawer.tsx`) | **Becomes a slim preview** | Renders Overview-only summary (definition first 200 chars, top variation name + effectiveness, "Open full page →" CTA). 4-tab MechanismSpecPanel is removed from the drawer. |
| Mechanism Gallery (`mechanism-gallery.tsx`) | **Retired** | Component deleted. Toggle that switches Category card list ↔ gallery is removed from room view. |
| Category card inline variation list (`category-card.tsx`) | **Reduced to summary chip** | Shows: feature name, top variation name, effectiveness pill (single number), chain context. No inline variation grid, no scoring bars. Click anywhere → canonical page. |
| Mechanism spec 4 tabs (`mechanism-dataflow-view.tsx`, `mechanism-experience-view.tsx`, in-line in drawer) | **Fused** | These component files stay (reused as collapsible subsections inside §3 Spec on the canonical page). What's deleted is the **tab navigation**, not the visualizations. |
| Room Map view (`RoomAltitudeMap.tsx`) | **Unchanged**, link added | Clicking a mechanism node deep-links to the canonical page. Map remains the L1 altitude view. |
| Room Subsystems view (`mechanism-subsystem-view.tsx`) | **Unchanged**, link added | Same — node click goes to canonical page. |
| Lab notebook panel (`lab-notebook-panel.tsx`) | **Unchanged** | Notebook stays event-log-oriented. References to specific mechanisms become click-throughs to the canonical page. |
| Strategy brief (`strategy-brief-view.tsx`) | **Unchanged**, links updated | Per-feature summaries link to the canonical page when the user clicks "see details." |
| Legacy Twin grid + drawer (`app/space/[id]/twin/`) | **Out of scope (note follow-up)** | Parallel Apps-era system. The user didn't elect to decommission it now. Documented as orphan in §8. |

---

## 4. File-level changes

### 4.1 New files

```
src/app/app/objective/[spaceId]/mechanism/[entityId]/
  page.tsx                    — server component, loads entity + space + chain refs
  loading.tsx                 — skeleton with 7 section placeholders
  not-found.tsx               — handle non-feature entities (redirect to room)

src/components/objective/mechanism-page/
  mechanism-page-shell.tsx    — header band + sticky section nav + scroll-spy
  overview-section.tsx        — §1: definition + signals + status
  variations-section.tsx      — §2: lifts VariationScoringPanel from drawer
  spec-section.tsx            — §3: fused 4-tabs-into-one with collapsible subsections
  inspiration-section.tsx     — §4: two-rail tech + design layout
  planning-section.tsx        — §5: lifts PlanningGroup from drawer
  chains-section.tsx          — §6: linked chains with %
  decisions-section.tsx       — §7: full decision log for this entity
```

### 4.2 Modified files

| File | Change |
|---|---|
| `src/components/objective/item-detail-drawer.tsx` | Strip everything except an Overview preview block. Add "Open full page →" CTA at top. Remove imports of MechanismSpecPanel, VariationScoringPanel, PlanningGroup (these now live in mechanism-page components). |
| `src/components/objective/category-card.tsx` | Remove the inline variation list rendering. Add summary-chip layout: feature name + elected/top-scored variation name + single effectiveness pill. Whole-card click → mechanism page. |
| `src/components/objective/sub-objective-room-view.tsx` | Remove the gallery/list toggle (since gallery is deleted). |
| `src/components/objective/causal-map/altitudes/RoomAltitudeMap.tsx` | Mechanism node `onClick` → `router.push(\`/app/objective/${spaceId}/mechanism/${entityId}\`)` instead of opening the drawer. |
| `src/components/objective/mechanism-subsystem-view.tsx` | Same node-click change. |
| `src/components/objective/strategy-brief-view.tsx` | Per-feature summary blocks get a "See full mechanism →" link. |
| `src/components/objective/lab-notebook-panel.tsx` | Entity references in event rows become click-through links to the mechanism page. |

### 4.3 Deleted files

```
src/components/objective/mechanism-gallery.tsx    — retired
```

Plus any test files that target it (likely none — verify before delete).

---

## 5. Component reuse — what gets lifted, what stays

**Lifted from drawer to mechanism-page components (no fork):**
- `VariationScoringPanel` → §2 Variations
- `PlanningGroup` → §5 Planning
- `DecisionSurface` → §7 Decisions
- `AnnotatedHeading` → §1 Overview (definition gets glossary annotations as today)

**Lifted as full visualizations into collapsible §3 Spec subsections:**
- `MechanismDataflowView` (today: tab 2b) → "Data flow" collapsible inside §3
- `MechanismExperienceView` (today: tab 2c) → "Experience" collapsible inside §3
- The inline Engineering block (today: tab 2d) → "Engineering" collapsible inside §3
- The inline Summary block (today: tab 2a) → §3 header, always visible

**Stays in drawer (slim preview):**
- A new minimal `MechanismPreviewBlock` component — definition snippet, top variation, effectiveness pill, full-page CTA. Bespoke for the drawer.

---

## 6. Data flow (unchanged by this plan)

This is **pure UI consolidation**. Zero schema changes. The mechanism page reads the same `entities` row, same `expanded_detail` JSONB, same `detail_research`. It just renders them in a coherent layout instead of 4 tabs + 2 secondary surfaces.

The cooperation plan v2 will ship after this and write **additional** content into the same fields (richer mechanism_spec, populated detail_research, etc.). Those additions land in the consolidated sections automatically.

---

## 7. Migration path

**Phase 1 — Build (no removals yet)**
1. Create the new route + page + section components.
2. Wire navigation: clicks from Map, Subsystems, Lab Notebook, Strategy Brief route to the new page. Drawer still opens the old way.
3. Verify the new page renders all 7 sections with real data.

**Phase 2 — Cut over**
4. Slim the drawer to preview-only.
5. Reduce category card to summary chip.
6. Delete `mechanism-gallery.tsx` and the gallery toggle in room view.

**Phase 3 — Verify**
7. Confirm no orphan imports of MechanismGallery, no broken drawer references.
8. Manual walk: from canvas → room → category card → mechanism page → back to room. From canvas → room → map → mechanism page → back. From notebook → mechanism page.

Each phase is a separate commit; no commit leaves the UI broken.

---

## 8. Known orphans / out of scope

- **Legacy Twin mechanism grid + drawer** (`src/app/app/space/[id]/twin/views/twin-mechanism-grid-view.tsx`, `twin-mechanism-detail-drawer.tsx`). Parallel system from the Apps era, reads from a different mechanism registry (not `entities`). Per memory `project_apps_architecture.md`, Apps are first-class but this Twin UI is the unreached older view. **Recommend decommissioning in a follow-up PR** — out of scope here per the user's choice not to include it.
- **Mechanism Gallery's mockup endpoint** (`/api/brainstorm/item/variation/mockup?format=thumbnail`) — still called by the gallery today. Once the gallery is retired, evaluate whether the endpoint is consumed elsewhere; if not, also retire.
- **Lab notebook timeline plan** (`NOTEBOOK_TIMELINE_PLAN.md` in memory). Independent workstream, not affected by this consolidation.

---

## 9. Open questions

1. **Drawer-as-preview vs drawer-deprecated entirely.** This plan keeps the drawer as a slim preview because the room view's flow ("click card → peek → decide whether to drill in") is valuable. Alternative: remove the drawer entirely; every click goes straight to the full page. Quicker peek vs cleaner architecture — flag if you want the latter.

2. **Section ordering.** Spec lists Overview · Variations · Spec · Inspiration · Planning · Chains · Decisions. Variations is in §2 because it's the most-interacted section. Alternative orderings: Overview · Spec · Variations · ... (spec-first if the user reads more than they elect). Confirm or reorder.

3. **Cross-room signals placement.** Today they're a top-level drawer section. This plan demotes them into §1 Overview as a callout band. If signals become numerous (>3 per mechanism is typical after a full scan), this gets cramped. Alternative: §1.5 dedicated signals section. Flag the threshold.

4. **Section navigation style.** Sticky right-rail nav with scroll-spy is the recommendation. Alternatives: top tabs (defeats the purpose), inline anchors (less discoverable). Confirm.

5. **Mobile / narrow viewports.** The 7-section vertical scroll works natively on narrow. The right-rail section nav becomes a collapsible jump menu. No special UI needed but flag if you want a different mobile shape.

---

## 10. Verification plan

After Phase 3:

- [ ] Navigate from every entry point (Category card, Map, Subsystems, Notebook, Brief) to the canonical page — all land on the same URL with the same data.
- [ ] All 7 sections render real content for a fully-loaded feature.
- [ ] Variations section's "Design experiment" buttons still work end-to-end (prototype brief generation persists).
- [ ] Mechanism spec subsections inside §3 still render their visualizations (Data flow DAG, Experience hero patterns, Engineering accordion).
- [ ] No console errors from removed component imports.
- [ ] The drawer preview opens, shows summary, and "Open full page →" CTA navigates correctly.
- [ ] Category card click anywhere on the card → mechanism page.
- [ ] Strategy brief's "See full mechanism" link → mechanism page.
- [ ] Legacy Twin grid still works (untouched).

---

## 11. Tie-in with cooperation plan v2

When `AUTOPILOT_COOPERATION_PLAN.md` v2 ships after this consolidation:

- **Fix A's research stage** populates `detail_research` — lands in §4 Inspiration.
- **Fix B's planning + research grounding in scoring** lands in §2 Variations score reasons.
- **Fix C's re-score after refine** updates `effectiveness_score` — lands in §2 Variations.
- **Fix D's variation-aware chain enrichment** updates chain narratives — lands in §6 Chains.
- **Fix E's research-anchored mechanism spec** populates `research_basis` — lands in §3 Spec, with citations visible without further clicks.

The consolidation **makes Fix E's quality lift instantly visible**: today a richer spec would land in the Engineering tab where users rarely look. After consolidation it lands in §3 Spec, in line with the rest of the mechanism's story.

---

## 12. Effort estimate

- **New files:** 10 (1 route + 1 shell + 7 sections + 1 preview block)
- **Modified files:** 7 (drawer slim, card reduce, room view toggle, 2 graph views link, brief link, notebook link)
- **Deleted files:** 1 (mechanism-gallery.tsx)
- **No schema changes, no API changes, no migrations.**
- Roughly 1-2 days of focused work for one engineer; less if much of the section content is lift-and-shift.

Ping when ready and I'll start Phase 1.
