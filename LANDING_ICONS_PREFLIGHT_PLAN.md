# Landing Icons — Preflight UI Plan

Goal: replace the generic **lucide** icons on the V2 landing (`/?v2=1`) template
cards with a **unique, hand-drawn line-icon set** in the spirit of the Airbnb
interest chips — distinctive, branded, drawn with the same "pen" as the hero
starburst, and still tintable by each card's accent. Reviewed on a dedicated
`/preflight` page **before** anything ships to the landing.

> Status: PLAN ONLY — nothing built yet. Awaiting go-ahead.

---

## 1. Where icons live today (the surface to upgrade)

- **`src/components/landing/template-meta.ts`** — per-template `inputs[]` +
  `outputs[]`, each `{ label, icon: LucideIcon }`.
- **`src/components/landing/card-decomposition.tsx`** renders them on card hover:
  - "Feed in" → frosted-glass **chips** (`icon + label` pill) — *this is exactly
    the Airbnb reference pattern already*; only the icon art is generic.
  - "Generates" → rows with an accent-tinted rounded-square icon + label.
  - Call site: `<Icon className="h-3 w-3" strokeWidth={2.2} style={{color: accent}} />`
    → **12px, monochrome, accent-tinted.**

Everything else on the landing is already custom (the starburst, the per-card
`CardGlyph` knowledge-graph, the `VerifiedSeal`, the brand wordmark) or is plain
text (nav, "sync tabs…"). **So the meta chips are the one generic-icon surface —
that's the scope.**

### Distinct concepts to draw (deduped across all 5 templates)

**Inputs (13):** Notes · Voice · Photos · Highlights · PDFs · Articles · Links ·
Papers · Datasets · Tickets · Résumé · Job Posts · Docs

**Outputs (15):** Pattern Map · Reflection Brief · Better Prompts · Concept Map ·
Synthesis Brief · Cross-book Links · Hypothesis Map · Evidence Matrix ·
Experiment Plan · Research Brief · Cause Map · Decision Review · Action Plan ·
Skill-Gap Map · Transition Plan · Milestones

≈ **27 unique marks.** Note: today **5 different "Map" outputs all reuse one
lucide `Network` icon** (Pattern/Concept/Hypothesis/Cause/Skill-Gap) — giving
each its own glyph is the single biggest "make it unique" win.

---

## 2. Design direction (Airbnb-style, on-brand)

- **Same pen as the hero:** stroke `currentColor`, weight ~1.7–2, **round caps +
  joins**, `24×24` viewBox, one path family — so they read as the same hand that
  drew the starburst + card glyphs. Using `currentColor` keeps the existing
  accent tint (`style={{ color: accent }}`) working with zero call-site change.
- **Characterful, not stock** (the Airbnb move): e.g.
  - Voice = waveform riding a speech tail (not a plain mic)
  - Datasets = a little tilted table-stack
  - Evidence Matrix = 2×2 grid, one cell ticked
  - Each **Map** gets a distinct node/edge silhouette: Pattern = radial burst
    (rhymes with the hero), Concept = web, Hypothesis = converging arrows,
    Cause = chain, Skill-Gap = two nodes with a bridged gap.
- **Tiny-legible:** must read at **12px** → cap detail at ~3 strokes; verify at
  chip size in the preview before committing each one.

---

## 3. Architecture (drop-in, no schema change, incremental)

1. **New `src/components/landing/landing-icons.tsx`** — a registry of custom SVG
   icon components. Each is `(props: { className?; style?; strokeWidth? }) => JSX`
   drawing with `stroke="currentColor"`. Shared `LandingIcon` type.
2. **Keep the call API identical.** `LandingIcon` accepts the same props lucide
   does, so `card-decomposition.tsx` needs **zero changes**, and `template-meta`
   can mix lucide + custom **during rollout** (no big-bang).
3. **Migrate `template-meta.ts`** imports `lucide-react` → `./landing-icons`,
   concept by concept.

---

## 4. The preflight preview page (the review surface) — the "preflight"

**`src/app/preflight/landing-icons/page.tsx`** (joins the ~40 existing
`/preflight/*` preview pages):

- Gallery of every concept: **new custom icon vs. current lucide, side by side**,
  shown at real chip size (12px) **and** enlarged (28px), with the label.
- Rendered on the *actual* "Feed in" chip + "Generates" row styles, tinted by
  each of the 5 accents, so you see them exactly as they'll appear on a card.
- Grouped per template so each card's full set is checkable at a glance.

→ Review at **`/preflight/landing-icons`** before any landing change ships.

---

## 5. Rollout (prioritized — "where possible")

- **Phase 1 (highest impact):** the 5 "Map" outputs (kills the repeated
  `Network`) + the most-seen generic inputs (Notes, Voice, Photos, PDFs, Links,
  Datasets). Ship the preview page with these first.
- **Phase 2:** remaining inputs + outputs → full set.
- **Optional extensions (flagged, not committed):** a tiny unique icon on each
  category pill (PERSONAL / RESEARCH / PROFESSIONAL), or a signature per-template
  mark. Only if you want icons beyond the meta chips.

---

## 6. Constraints / what NOT to do

- **Monochrome + `currentColor` only** — the accent tint must keep working; no
  multi-color or filled icons.
- Don't over-detail (they live at 12px).
- **Preserve the lucide-compatible prop API** so `card-decomposition.tsx` is
  untouched and rollout is incremental.
- `aria-hidden` on the icon; the label carries the meaning (a11y).
- Extend in place — don't fork `template-meta.ts` / `card-decomposition.tsx`.

---

## 7. Suggested first deliverable

**Phase-1 icons (≈11 marks) + the `/preflight/landing-icons` page**, for review.
Then complete the set in Phase 2 once the style is approved on the preview page.
