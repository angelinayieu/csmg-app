# Objective Canvas — Vision-Pro-Tier UI Plan

**Status:** DRAFT (spec-first, pre-code) · **Date:** 2026-05-30 · **Lane:** objective-canvas / design-system
**Goal:** top Apple-vibe tier — minimalist, content-first, glass-material, spring-animated *where it earns its keep*, with a few innovative Vision-Pro signature interactions. Built to be applied **in coordination** with the parallel canvas build.

> Verdict from a 3-front audit (tokens, component consistency, tldraw/interaction): **the parts already exist.** The objective module is a sealed `appleVibe` TS-token island that never touches the app-wide `--glass-*`/spring-easing material system, hand-rolls ~53 blur values, has **zero motion tokens**, and carries the exact "cheap" patterns we dislike (colored side-spines, flat tinted rects, all-caps eyebrows). The fix is **unify + remediate against the components that are already reference-quality.**

---

## 1. Diagnosis (grounded)

**Two parallel design systems, not talking:**
- `src/lib/apple-vibe-tokens.ts` (`appleVibe`, used by 91 objective files): `surface`, `text` (graphite scale rgba(15,23,42,.92→.28)), `accent` (graphite, *not* blue), `stroke` (hairline .06 / soft .08 / medium .12), `radius` (12/16/20/24/999), `shadow` (card/chip/cardHover), `stage` colors. **No easing, no duration, no blur.**
- `src/app/globals.css :33–127` (the Vision-Pro material kit, used by the *rest* of the app via `<GlassPanel>`): glass bg tiers `--glass-{plate .72 / card .86 / float .92 / modal .96}`, `--glass-highlight`, `--glass-hairline/-border/-border-strong`, shadow tiers, **blur tiers `--blur-{plate 8 / card 12 / float 18 / modal 28}`**, and **motion: `--ease-spring-soft` `cubic-bezier(.34,1.56,.64,1)`, `--ease-spring-tight` `(.25,.8,.25,1)`, `--ease-out-quart` `(.22,1,.36,1)`, `--dur-quick/normal/soft 120/220/360ms`**.

**Consequence:** objective surfaces hand-roll `blur(8px)`×13 / `blur(20px)`×9 etc., have inconsistent/absent motion, and sit on `#fafafa` while the page is `#F5F5F7`.

**Cheap patterns present (the taste violations):**
1. `room-card-shape` + `artifact-card-shape`: **4–5px colored side-spines** down the left edge.
2. `layer-band-shape`: a **flat tinted rectangle** (`${accent}0E` fill + tinted border) — the most literal violation, and it tints large screen areas.
3. **All-caps wide-tracked eyebrows** (`0.14em`/`0.12em` uppercase) everywhere — the token system already deprecated these in favor of sentence-case `appleVibe.label`, but almost nothing adopted it.
4. **Repetitive instructional footers** on every card ("On the board · drag to arrange · Expand…").
5. The 3 tldraw card shapes are a **hardcoded island** (`#0B1228`, raw rgba, inline font stacks) — and they're the most-seen surfaces on the board.

**Reference-quality already in repo (standardize toward these):**
- `command-deck.tsx` — the gold standard: soft accent-**glow** instead of spines (documented in-code), results-first tiles, hairline borders, full tokens.
- `canvas-interactions/focus-mode-panel.tsx` — cleanest panel: 100% tokens, restrained accent, soft transitions.
- `board-hint.tsx` — clean, proper backdrop blur.
- `lab-notebook-panel.tsx` — the **motion** reference: the only chrome using framer-motion springs + `whileHover/whileTap` + `useReducedMotion`. (Copy its motion, not its all-caps eyebrows / timeline spine.)

---

## 2. The design language (target)

Apple Vision Pro hallmarks → mapped to this codebase:

| Principle | What it means here | Existing hook |
|---|---|---|
| **Glass material, tiered** | surfaces are translucent layers with blur depth, not opaque rectangles | `--glass-*` + `--blur-*` + `<GlassPanel tier>` |
| **Depth & elevation** | soft layered shadows + accent **glow**, never spines/fills | `appleVibe.shadow.*`, `command-deck` glow pattern |
| **Spatial focus** | when you focus one thing, the rest recedes (dim + blur) | `globals.css:813–818` recipe + `use-focus-mode` `scopedIds` |
| **Soft-spring motion** | spring easings, short durations, *restraint* | `--ease-spring-tight`, `--dur-*`, unused `.canvas-shape-enter` keyframes |
| **Content-first chrome** | the UI recedes; the work is the hero | `HIDDEN_TLDRAW_COMPONENTS` map (ready to import) |
| **Restraint / typography** | sentence-case overlines, one type scale, generous spacing | `appleVibe.label`, `.font-display*` |

**Taste rules to enforce (hard no's):** no colored side-spines · no flat tinted rectangles · no all-caps wide-tracked eyebrows (use `appleVibe.label`) · no repeated instructional footers · no hardcoded rgba where a token exists · lead with the result, not the label.

---

## 3. Plan

### Phase A — Unify the token system (FOUNDATION; do first, coordinate)
The prerequisite for everything else. Make `appleVibe` and the CSS vars **one** system.
- **Add motion + blur to `appleVibe`** so objective components stop hand-rolling: `appleVibe.motion.{springTight, springSoft, quart}`, `appleVibe.motion.dur.{quick,normal,soft}`, `appleVibe.blur.{plate,card,float,modal}` — *referencing the CSS var values* so there's a single source.
- **Bridge to CSS:** objective surfaces use `var(--blur-card)` / `var(--ease-spring-tight)` directly (kill the 53 hand-rolled blurs).
- **Reconcile base color** (`#fafafa` → align with page `#F5F5F7`) and **fonts** (Geist is configured in `layout.tsx` but body uses SF stack and `appleVibe` claims SF/Inter — pick one, declare once).
- Output: a short `appleVibe` extension + a 1-paragraph "how to pick a surface/elevation/motion" note at the top of `apple-vibe-tokens.ts`.
- ⚠ **Coordination:** `apple-vibe-tokens.ts` + `globals.css` are shared hot files — do this as a dedicated pass, not racing the parallel build.

### Phase B — Remediate the board surfaces (highest visual impact)
Rebuild the worst offenders against `command-deck` / `focus-mode-panel`:
- `shapes/room-card-shape.tsx` + `shapes/artifact-card-shape.tsx`: **replace the colored side-spine with a soft accent-color drop-shadow glow** (the `command-deck` move); swap hardcoded rgba/`#0B1228` for `appleVibe.text.*`; drop the repetitive footer (or reduce to a single hover-only affordance).
- `shapes/layer-band-shape.tsx`: **kill the flat tint** — render as a hairline-bounded zone with a soft top-edge highlight + sentence-case label, accent only as a thin glow, not a fill.
- `shapes/insight-card-shape.tsx` + all four shapes: **all-caps eyebrows → `appleVibe.label`** (sentence case).
- ⚠ **Coordination:** I recently edited room-card/artifact-card (hover menu); the parallel chat may also touch them. Partial-stage discipline; align before editing.

### Phase C — The motion + interaction layer ("animative where necessary")
A **motion budget** (restraint is the point — Apple under-animates):

| Interaction | Spec | Build on |
|---|---|---|
| **Spatial focus dim+blur** (★ highest leverage) | On Focus/Converge or single-select, non-scoped shapes → `opacity .32` + `blur` over `--dur-soft` `--ease-out-quart` | `globals.css:813–818` recipe + `use-focus-mode` `scopedIds` (promised in code, **not wired**) |
| **Spring hover-lift on cards** | body lifts `y:-2` + `shadow.card→cardHover` over `--dur-quick` `--ease-spring-tight` | existing `hovered` state in the shape renderers |
| **Animated zoom-to-room on open** | replace the opacity crossfade with a board zoom-in; thread ONE shared easing into the hardcoded `duration:300` | already-animated `centerOnPoint`/`zoomToSelection` |
| **Mount-in entrance + data-pulse** | new/updated cards play `.canvas-shape-enter` / `.canvas-shape-pulse` | unused keyframes `globals.css:507–543` (reduced-motion-safe) |
| **Content-first chrome** | import `HIDDEN_TLDRAW_COMPONENTS` (selective) instead of all-or-nothing `hideUi`; add a frosted custom toolbar | `interaxis-canvas-overlays.tsx:59–78` |

All motion gated by `prefers-reduced-motion` (follow `lab-notebook-panel`'s `useReducedMotion`).

### Phase D — Innovative Vision-Pro signature moves (pick 1–2, tasteful)
Distinctive, not gratuitous:
- **Magnetic placement of AI results** — when the scanner/ops drop result cards, tween them into a tidy radial/grid around the source instead of dumping (build on `createInsightWithLinks` centroid + tether).
- **Depth parallax on pan** — layer-band zones drift slightly slower than cards for a sense of altitude (the L1–L4 stack becomes literal depth).
- **Glass scanner plate** — the AI-scanner sidebar (from `CANVAS_AI_SCANNER_PLAN.md`) renders as a floating `--glass-float` plate with a soft top highlight, matching `synergy-node-action-popover`'s "Vision Pro chrome."

---

## 4. Coordination with the parallel build
- **Sequence:** Phase A (tokens) is the foundation — ideally land it in a dedicated pass before the AI-scanner UI, so the scanner panel + result cards inherit the unified material from day one.
- **Shared hot files:** `apple-vibe-tokens.ts`, `globals.css`, `whiteboard-base.tsx`, the card shapes. Use partial-stage commits; one-file = one-chat.
- **Shared surface:** the AI-scanner panel (other plan) and Phase D's glass plate are the *same* component — build once, against the unified tokens.

## 5. Acceptance bar ("how we know it's top-tier")
- Zero colored side-spines / flat tinted rects / all-caps wide-tracked eyebrows in the objective module.
- Zero hand-rolled `blur(Npx)` literals — all via `--blur-*`.
- One declared font; one base surface color; one motion vocabulary (spring tokens).
- Every animation respects `prefers-reduced-motion`.
- Focus/Converge visibly dims+blurs the rest of the board.
- The 3 card shapes pass the "command-deck test": glow not spine, result-first, hairline borders, tokenized.

## 6. Open decisions
1. **Single source of truth:** does `appleVibe` *emit* the CSS vars, or do TS tokens *read* the CSS vars? (Lean: CSS vars are canonical for runtime theming; `appleVibe` re-exports them so TS callers get one import.)
2. **Font:** Geist (configured) vs SF stack (body) vs Inter (claimed). Lean: SF system stack for the Apple feel; drop the Geist load if unused.
3. **tldraw chrome:** how much native UI to keep vs a custom frosted toolbar (depends how much drawing users do vs AI-card work).
