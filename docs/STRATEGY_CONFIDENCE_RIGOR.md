# Strategy Confidence Rigor

**Status as of 2026-05-04 — turning the dashboard's bare `conf 85%` into an auditable, user-confirmable composite, with a calibration loop scaffolded for once outcome data accumulates.**

This doc records the audit + multi-phase change that turned a single LLM-self-reported integer into a four-factor composite meter, an auditable drawer that exposes every input, and an append-only override table that captures the user's second opinion as a labeled training datum.

> **Why this exists:** the dashboard previously surfaced `rec.confidence` — a 0-100 number the LLM emitted in the strategic-recommendation prompt — with zero drill-down, zero formula visibility, and no user override. The codebase already had the rigor pieces (`ReadyToShipMeter`, `validateStrategyCoherence`, `StrategyProvenancePanel`, three-step `reasoning_trace`) but none of them reached the surfaces a user actually saw at approval time. This sprint connected the wires; it added almost no new pipeline work.

## Before / after

| Surface | Before | After |
|---|---|---|
| Dashboard "Check-in Updates" card | `conf 85%` pill + small `prov`/`cov` footer | Composite `ReadyToShipMeter` (cov/conf/prov/coh) + critical/degraded chips |
| Strategy Hero (the inline header on the strategy page) | Local `ConfidenceRing` showing only `rec.confidence` | Composite meter + posture chip |
| BSC Strategy fullscreen header | Local `ConfidenceRing(rec.confidence)` | Composite meter + full-width `<StrategyProvenancePanel />` banner above content |
| Twin Proposal Review Panel | Local `ConfidenceRing(justification.confidence)` | Composite meter + critical/degraded chips + `<ConfidenceProvenanceDrawer />` (Phase 2) + override widget (Phase 4) + "You: N (Δ ±M)" badge |
| Confidence drill-down | None | Drawer renders formula breakdown, diagnose→estimated→verified sub-trace, provenance/coherence panel, blind spots, degraded-step callout, open questions, reasoning chain, entity citations |
| User override of confidence | None | Append-only `strategy_confidence_overrides` table + radio/slider/reason widget + per-(space, generation) latest read |
| Calibration over time | Not possible (no override data) | Schema in place; aggregator deferred until ≥30 deployed strategies with outcomes |

## Architecture

### Data flow into the meter

The `ReadyToShipMeter` ([src/components/strategy/ready-to-ship-meter.tsx:64](../src/components/strategy/ready-to-ship-meter.tsx)) computes a weighted composite:

```
composite = 0.30·coverage + 0.25·confidence + 0.25·provenance + 0.20·coherence
```

Each input is sourced from already-persisted fields:

| Factor | Source | Computed by |
|---|---|---|
| `coverage_pct` | `synthesis_data.strategic_recommendation.recommendation.provenance.coverage_pct_at_generation` | `validateStrategyCoherence` upstream (KG coverage audit) |
| `confidence` | `synthesis_data.strategic_recommendation.recommendation.confidence` | LLM (verified_confidence from the verification step in `strategy-engine.ts`) |
| `provenance_score` | `synthesis_data.strategic_recommendation.recommendation.provenance.overall_provenance_score` | Structural audit (50% critical-axiom coverage + 30% strong-convergence coverage + 20% gap-closure) |
| `coherence_score` | `synthesis_data.coherence_score` (sibling to `strategic_recommendation`) | `validateStrategyCoherence` ([src/lib/pipeline/validate-strategy-coherence.ts](../src/lib/pipeline/validate-strategy-coherence.ts)) — rule-based 0-100 with severity-graded issues |

Missing factors fall back to `50` (neutral) so legacy strategies still render a usable composite. The drawer's formula breakdown asterisks any defaulted factor so the user knows.

### Surfaces that consume the meter

All four surfaces use the same `ReadyToShipMeter` component — different chrome, same math:

1. **Dashboard card** — `compact={true}`. Inline ring + four sub-bars beside the title. Hover tooltip suppressed (would clip against the card's `overflow-y-auto`).
2. **Strategy Hero (inline)** — `compact={true}`. Sits above the posture chip in the right column.
3. **BSC fullscreen header** — `compact={true}`. Replaces the indigo-on-dark `ConfidenceRing` in the header chrome; backed by full `<StrategyProvenancePanel />` banner directly below.
4. **Twin-Proposal Review panel** — `compact={true}`. Header right-side, with optional "You: N (Δ ±M)" override badge stacked beneath when an override exists.

### The audit drawer

[src/components/strategy/confidence-provenance-drawer.tsx](../src/components/strategy/confidence-provenance-drawer.tsx) is collapsed by default. When opened it renders, top-to-bottom:

1. **Composite formula** — explicit math. `0.30·80 + 0.25·65 + 0.25·92 + 0.20·50 = 24 + 16.25 + 23 + 10 → 73`
2. **User override widget** (Phase 4) — radio (lower/similar/higher) + slider + reason + save
3. **Confidence sub-trace** — `Diagnosis → Estimated → Verified` with stress-test delta and per-step durations. Reads from `synthesis_data.strategic_recommendation.reasoning_trace.{diagnosis.confidence, synthesis.options[0].estimated_confidence, verification.verifications[0].verified_confidence}`
4. **Provenance & coherence** — embeds existing `<StrategyProvenancePanel />` (axiom counts, missed findings, coherence issues by severity)
5. **Honesty markers** — diagnosis blind spots + degraded-pipeline callout
6. **Open questions** — gap-analyzer output, priority-sorted (critical → high → medium → unset → answered)
7. **Reasoning chain** (collapsed) — the LLM's narrative
8. **Entity citations** (collapsed) — internal (C-prefix, blue) vs external (X-prefix, purple) chips
9. **Empty state** — for legacy strategies without a reasoning trace

### The override loop

```
User opens drawer
  → reads composite + breakdown
  → optionally moves slider, picks direction, adds reason
  → POST /api/strategy/confidence-override
       → INSERT into strategy_confidence_overrides
       → onSaved() callback → panel refetches /twin-proposal
       → user_override now set on response
  → drawer header shows "Composite N · You M ↓"
  → meter header shows "You: M (Δ ±N)" badge
```

The override is **advisory, not a veto**. Approval CTA still works regardless of override score. The override exists to:
- Express disagreement without blocking
- Generate labeled data for Phase 5's calibration loop

## Schema

[supabase/migrations/20260701_strategy_confidence_overrides.sql](../supabase/migrations/20260701_strategy_confidence_overrides.sql)

```sql
create table public.strategy_confidence_overrides (
  id uuid primary key,
  space_id uuid not null,
  user_id uuid not null,
  strategy_generated_at timestamptz not null,
  ai_composite_score int not null check (between 0 and 100),
  user_score int not null check (between 0 and 100),
  user_direction text not null check (in ('lower','similar','higher')),
  reason text,
  created_at timestamptz not null default now()
);
```

Anchoring on `(space_id, strategy_generated_at)` lets us:
- Tie the override to a specific generation (regenerating starts fresh)
- Append multiple overrides per generation (history preserved for calibration)
- Compute deltas without recomputing past meter values (we persist `ai_composite_score` at save time, so re-weighting the meter doesn't distort historical signal)

RLS: read-own + insert-own with double-check on space ownership. Mirrors the `lab_experiments` precedent.

> **⚠️ The migration must be applied before the override save will succeed.** Run via `supabase db push` or the team's standard deploy flow.

## Files touched

### Schema (new)
- [supabase/migrations/20260701_strategy_confidence_overrides.sql](../supabase/migrations/20260701_strategy_confidence_overrides.sql)

### API
- [src/app/api/apps/route.ts](../src/app/api/apps/route.ts) — extended `strategy_summary` with coherence/blind_spots/open_questions/degraded_steps
- [src/app/api/spaces/[id]/twin-proposal/route.ts](../src/app/api/spaces/[id]/twin-proposal/route.ts) — added `meter_inputs`, `coherence`, `degraded_steps`, `audit`, `provenance`, `user_override`, `strategy_generated_at`
- [src/app/api/strategy/confidence-override/route.ts](../src/app/api/strategy/confidence-override/route.ts) — **new** — POST + GET, RLS-protected

### Types
- [src/types/synthesis.ts](../src/types/synthesis.ts) — added `coherence_score`, `coherence_issues` to `SynthesisData`

### Components
- [src/components/dashboard/check-in-updates-card.tsx](../src/components/dashboard/check-in-updates-card.tsx) — meter + chips
- [src/components/dashboard/modules/strategy-recommendation-module.tsx](../src/components/dashboard/modules/strategy-recommendation-module.tsx) — meter + provenance panel + threading; dead `ConfidenceRing` removed
- [src/components/strategy/strategy-hero.tsx](../src/components/strategy/strategy-hero.tsx) — meter replaces local ring
- [src/components/strategy/strategy-provenance-panel.tsx](../src/components/strategy/strategy-provenance-panel.tsx) — accepts `provenance` directly OR `recommendation` (backwards compatible)
- [src/components/strategy/twin-proposal-review-panel.tsx](../src/components/strategy/twin-proposal-review-panel.tsx) — meter + drawer + override badge; dead `ConfidenceRing` removed
- [src/components/strategy/confidence-provenance-drawer.tsx](../src/components/strategy/confidence-provenance-drawer.tsx) — **new** — ~660 lines, composes existing panels + adds override widget

## Phase plan vs. delivered

| Phase | Plan | Delivered |
|---|---|---|
| 0 | API plumbing — additive fields on `/apps` and `/twin-proposal` | ✅ |
| 1a | Dashboard card meter | ✅ |
| 1b | Strategy module + BSC fullscreen meter + provenance panel | ✅ |
| 1c | Twin-proposal review panel meter | ✅ |
| 2 | "How was this computed?" drawer composing existing panels | ✅ |
| 3 | Open-questions sidecar | ✅ — folded into Phase 2 drawer (Option A from the plan; meter weighting unchanged) |
| 4 | User override + delta tracking + new schema | ✅ |
| 5 | Calibration loop (per-user/per-domain bias, override-outcome correlation) | ⏸ deferred — requires accumulated outcome data; aggregator on small samples misleads more than helps |

## Phase 5 — what's needed before building

Phase 5 produces a calibration curve like:

> AI claimed 80–90% confidence → hit rate: 64% (n=12). **Calibrated estimate: 70%.**

Requirements before this is meaningful:
1. **≥30 confirmed strategies** with the new pipeline (so the composite is comparable across rows)
2. **Outcome data per strategy** — i.e. for each strategy's target objective, did it hit / partially hit / miss? Sources available today:
   - `prediction_ledger` — already populated via [src/lib/kg/apply-confidence-from-deviation.ts](../src/lib/kg/apply-confidence-from-deviation.ts)
   - User-recorded outcomes via `onRecordOutcome` callback in `StrategyRecommendationModule`
3. **Time** — predictions need to mature. Target horizons in the ledger are the natural cadence.

When ready, the aggregator becomes a nightly job that:
- Buckets strategies by composite-score band (e.g. 80-89, 70-79, etc.)
- Within each band, computes hit rate from prediction ledger outcomes
- Emits a calibration curve to be displayed in the drawer ("Historical accuracy in this score band: X%")
- Optionally adjusts the displayed composite to reflect calibration ("Calibrated estimate: Y")
- Mines override `reason` text for common patterns the LLM missed

## Deployment checklist

1. **Apply migration** to live Supabase: `supabase db push` (or the team's flow). Without this the override save returns 500.
2. **Visual verify** the four surfaces while logged in:
   - Dashboard card — meter fits in the narrow column
   - Strategy hero — meter doesn't crowd the title
   - BSC fullscreen — meter + provenance banner read cleanly
   - Twin-proposal review panel — meter + drawer + override widget round-trip
3. **Smoke-test the override flow**:
   - Open drawer, drag slider, pick direction, save
   - Verify badge appears in the meter header ("You: 60 (Δ -16)")
   - Verify drawer toggle header shows "Composite 76 · You 60 ↓"
   - Re-save with different values; confirm append-only behavior (prior rows still in DB)
4. **Watch for layout regressions** in the BSC fullscreen — the new full-width `<StrategyProvenancePanel />` banner sits between the target-objective banner and the perspective rows. Long missed-findings lists could push the fold.

## Notes for future contributors

- **Don't bypass the meter.** All four surfaces use the same `ReadyToShipMeter` component on purpose — diverging the math creates "two confidences" UX. If you need a single number on a surface that can't render the full meter (e.g. a notification badge), use the composite from `ReadyMeterInputs` not just `confidence`.
- **The composite is computed client-side**, not persisted. The four inputs are persisted; the math runs in `ReadyToShipMeter` and `ConfidenceProvenanceDrawer` (in lockstep — keep `WEIGHTS` constants in sync).
- **`ConfidenceProvenanceDrawer` is read-only on legacy strategies.** Strategies generated before `validateStrategyCoherence` was wired won't have `coherence_score`; the drawer renders a 3-factor composite and asterisks the missing factor in the formula.
- **The override widget falls back to read-only** when `spaceId` or `strategyGeneratedAt` is missing. Don't try to make it editable in those contexts — the FK will fail.
- **`reason` is hard-capped at 1000 chars** in the API layer (defensive, no DB constraint). Drawer textarea also slices at 1000 — both layers needed.
- **Don't add a `noUnusedLocals` check** to `tsconfig.json` without sweeping legacy code first. The pre-existing `posture` const in `BSCStrategyPage` is one example of harmless dead code that the strict check would surface.

## Related

- [`KG_DEPTH_CRITIQUE.md`](KG_DEPTH_CRITIQUE.md) — the structural-rigor critique that motivated some of this work
- [`COMPUTATIONAL_SUBSTANCE_ROADMAP.md`](COMPUTATIONAL_SUBSTANCE_ROADMAP.md) — Tier-N labeling for what's real math vs LLM prose; this sprint was a Tier-3 (composite ranking) honesty pass on the strategy-confidence surface
