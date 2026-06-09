# Objective Seed Plan — sandbox the engine, surface the deliverable, fork on demand

> Status: execution-ready, 2026-06-08. Supersedes the "dump reasoning on the board" model.
> Governing law: **INTERNAL is the engine (sandboxed inside the card as metadata); EXTERNAL is the product (the one thing that surfaces). Nothing auto-exports. The user forks power-ups on demand.**

---

## 0. The thesis in one line

An objective is a **seed** = a rich KG that lives *inside* one card. The card's **face** shows only the single external deliverable (what to build, vs. what already exists). The reasoning (ambiguities, priorities, leverage, variables, connections) stays **inside** as metadata. The user **forks** features/systems/variables out on demand — each fork is itself a seed (same structure, recursively).

This is mostly **subtraction**: stop auto-dumping the engine onto the board.

---

## 1. The card model (one shape, fractal)

Every card — the objective and everything forked from it — has the same three-part shape:

```
┌─ CARD ─────────────────────────────────┐
│  EXTERNAL FACE  (always visible)         │   ← the product. One headline.
│   • deliverable: what to build           │
│   • vs-alternatives: why it beats X/Y    │
│   • do-next: the single next move        │
│                                           │
│  [ expand ⌄ ]   [ fork ⑂ ]                │
├───────────────────────────────────────────┤
│  INTERNAL ENGINE  (expand-only, peek)     │   ← the reasoning. Sandboxed.
│   tabs: Sharpen · Priorities · Leverage   │
│         · Variables · Landscape · Map     │
└───────────────────────────────────────────┘
```

- **Face** = external. ≤ 3 lines. Computed from the engine. This is the only thing on the board.
- **Engine** = internal. Revealed on expand (in the detail drawer), never on the board.
- **Fork** = on demand. Creates a downstream card (a new seed) linked back.

---

## 2. The exact metadata structure

One blob per seed, stored at `spaces.synthesis_data.objective_canvas.seed` for the objective, and in `library_objects.content_snapshot.seed` for every forked downstream card. **No migration** (JSONB + free-text object_type).

```ts
// src/lib/objective-canvas/seed/seed-types.ts  (NEW, client-safe)
export interface ObjectiveSeed {
  /** EXTERNAL — the only thing the card face renders. */
  external: {
    deliverable: string;        // "Verb-path cards — the unit is a relationship, not a node"
    vsAlternatives: string;     // "Every incumbent (Wikipedia, Obsidian) is noun-first → graphs feel empty"
    valueToSwitch: number;      // 0–100: how much better than the user's current tool
    doNext: string;             // one move: "Prototype a 3-verb browse"
    confidence: number;         // 0–1
  };
  /** INTERNAL — the engine. Peek-only, sandboxed in the expand view. */
  internal: {
    sharpenedObjective: string;
    ambiguities: { zone: string; question: string; resolved: boolean }[];   // from prompt_sharpening
    optimizationPoints: { slug: string; label: string; weight: number }[];  // priority map (factors)
    leveragePoints: LeverageRef[];     // from crucible (slug, label, score, meadows)
    firstPrinciples: PrincipleRef[];   // from crucible
    canonicalVariables: CanonicalVar[];// CONSOLIDATED units (see §5)
    landscape: { fact: string; source?: string }[];   // researched specifics
    alternatives: Alternative[];        // existing solutions, for differentiation (see §5)
    analogousExamples: Analog[];        // simpler/more-complex precedents (see §5)
    reasoningGraph: { nodes: SeedNode[]; edges: SeedEdge[] }; // the pill-map data, internal
  };
  status: "seeding" | "ready" | "error";
  updatedAt: string;
}
```

The Crucible engine (`crucible-*`) **writes `internal`**; a new distiller **computes `external` from `internal`** (§4). The card reads only `external` for the face, `internal` on expand.

---

## 3. THE SUBTRACTION (do now — exact code changes)

These remove the auto-dump. Mostly deletions/guards. Low risk; coordinate the Crucible/brief files with the parallel session.

| # | File | Change |
|---|---|---|
| S1 | `resolve-pill-shape.tsx` (~L254) | **Delete the `onDecompose` auto-fire** of `DECOMPOSE_INTO_CARDS_EVENT`. Resolve no longer dumps feature/variable cards on the board. Decompose becomes on-demand only (§6). |
| S2 | `whiteboard-base.tsx` `onPromoteToObjective` | **Stop deploying the sharpening card + crucible card to the board.** Keep only `promoteChatboxToObjective` (the objective card). The sharpening + crucible engines still RUN (they write `internal`), but they do not fork board cards. |
| S3 | `prompt-sharpening-mount.tsx` / `prompt-sharpening-board.ts` | Sharpening result no longer materializes a board card. It writes into `seed.internal` (ambiguities, optimizationPoints). Remove `deploySharpeningCard`, heatmap-card, priority-card, resolve-pill auto-forks from the deploy path. |
| S4 | `crucible-card-shape` deploy (`crucible-board.ts`, `whiteboard-base`) | Crucible no longer a separate board card. Its output writes into `seed.internal` (leveragePoints, firstPrinciples, variables, reasoningGraph). |
| S5 | `deploy-oc-cards.ts` | Keep the deploy *function* (used by the on-demand fork), but it is **never auto-invoked**. Only fired by an explicit fork action (§6). |

**Result after promote:** the board has exactly **one card** — the objective. Calm. The engine runs invisibly and fills the seed.

---

## 4. The EXTERNAL distiller (what surfaces)

New: `src/lib/objective-canvas/seed/distill-external.ts`. Runs after the Crucible converges. Takes `internal`, returns `external`. The rules that make it *not useless*:

1. **External, not internal.** Translate the top leverage point into a *user-facing deliverable* ("what to build / what the user sees"), not the optimization reason. Strip "why" words (comprehension, legibility) — those stay internal.
2. **Stated as a difference.** `vsAlternatives` is mandatory: position against `internal.alternatives`. An idea with no named alternative is rejected as a platitude.
3. **Quantify switch-value.** `valueToSwitch` = how much better than the user's current tool, given switching cost.
4. **Collapse redundancy, drill micro.** If two points entail each other, keep one. Then push to the actionable micro ("HOW do you get it in seconds") — not the macro restatement.
5. **One do-next.** Single move, fork-ready.

This is the `verdict` card content, but **external-framed** — and it replaces the current internal-framed one.

---

## 5. The VALUE ENGINE (makes ideas non-weak) — internal, feeds `external`

Three analyses run inside the engine and write `internal`. They are why output stops being a platitude. **Reuse `deep-synthesize` (Opus + web_search) as the host** — don't build a parallel generator.

- **Differentiation** → `internal.alternatives`: name the real existing solutions; for each, the specific failure + where this idea diverges. (Value is relative.)
- **Analogous examples** → `internal.analogousExamples`: existing things like this idea (simpler and more complex) + what each implies for scope.
- **Variable consolidation** → `internal.canonicalVariables`: merge variables that mean the same thing across features into ONE canonical unit ("units of interaction & trade"), so features compare/compose in shared units. Dedup by `concept_slug`; carry a `mergedFrom: string[]`.

`distill-external` then reads these to build `vsAlternatives` + `valueToSwitch`.

---

## 6. The ON-DEMAND FORKS (power-ups)

A `fork ⑂` on any card opens the power-up menu. Each fork creates downstream cards (each a new seed) linked via `object_links`. Reuse the existing registry + ops — just route them through the fork affordance instead of auto-firing.

| Fork | Engine | Produces (downstream seeds) | Link |
|---|---|---|---|
| **Decompose** | `decompose-cards` (S5) | feature + variable cards | `derived_from` |
| **Unpack** | `unpack` | first principles + variations | `derived_from` |
| **Differentiate** | value engine (§5) | alternative cards + the edge | `relates_to` |
| **Analogize** | value engine (§5) | analog cards | `relates_to` |
| **Spec it** | light decompose → `compose-tech-spec` (Sketch) or `SpecForge` (Forge) | a spec → prototype | `feeds` |

Every produced card has the **same three-part shape** (§1): external face + internal engine + its own fork. Fractal — you can drill forever, each level stays simple.

---

## 7. The exact visualizations

1. **Board (default):** the objective card's external face, plus whatever the user has explicitly forked. **No reasoning, no heatmaps, no layer shelves auto-appear.** Calm canvas.
2. **Expand (peek the engine):** the detail drawer (`object-detail-drawer.tsx`) gains tabs — *Sharpen · Priorities · Leverage · Variables · Landscape · Map*. The **Map** tab renders the sandboxed pill-map (`pill-map.tsx`) with the verdict/connections/altitude views we built. This is where complexity lives — opt-in only.
3. **External readout:** the verdict card, **external-framed** (deliverable + vs-alternatives + do-next). One fixation.
4. **Chatbox-first (the MVP):** the objective card carries a chatbox. You talk to the seed; it updates `internal` and re-distills `external`. Forks happen from chat ("fork the features", "show me alternatives"). No board sprawl needed to test value.

---

## 8. Phased execution

- **Phase A — Subtraction (now, ~½ day, mostly deletions):** S1–S5. Promote → one objective card. Engine runs, writes `seed.internal`; card face shows "seeding…" then the external deliverable. *This alone fixes the "too messy / auto-dump" problem.*
- **Phase B — Seed schema + distiller:** `seed-types.ts`, `distill-external.ts`. Crucible writes `internal`; distiller computes `external`. Card face + expand-tabs read the seed.
- **Phase C — Value engine:** wire differentiation + analogous + variable-consolidation into `deep-synthesize`, write `internal.alternatives/analogousExamples/canonicalVariables`. This is what makes the output non-weak.
- **Phase D — On-demand forks:** the `fork ⑂` menu routes the existing power-ups; downstream cards are seeds.
- **Phase E — Chatbox-first MVP + pressure test** (see §10).

Do A immediately (subtraction, low risk). B–D in order. E is the validation gate.

---

## 9. Keep / Kill / Add

- **KILL:** auto-export of decompose from ai-resolve (S1); auto-deploy of sharpening/heatmap/priority/crucible/brief cards to the board (S2–S4); internal-framed verdict.
- **KEEP (re-home inside the seed):** prompt_sharpening, the Crucible engine, the pill-map/lens/verdict views (now in the expand tab), `deep-synthesize`, `decompose-cards`, `SpecForge`/`compose-tech-spec`, the canvas-operations registry.
- **ADD:** `seed-types.ts`, `distill-external.ts`, the value engine (§5), the `fork ⑂` menu, the chatbox on the objective card, the expand-tabs.

---

## 10. Pressure-test hypothesis (the gate before building deep)

**Hypothesis:** *Compressing a complex objective/conversation into the single external deliverable — positioned vs. what already exists — helps PMs decide/move faster than their current tools.*

Test the **chatbox-minimal** version (Phase A + B + the differentiation slice of C) with 5 PMs. Show: prompt → external deliverable + vs-alternatives + do-next, fork on demand. Watch whether the deliverable lands and the vs-alternatives makes them go "oh." If not, no engine sophistication saves it. If yes, build C/D fully.

---

## 11. Coordination + verification

- Crucible/brief/layer files are co-edited by a parallel session — re-check `git`/mtime before S4 and Phase B–C edits; prefer new files (`seed/*`).
- Gate: `tsc --noEmit` = 0 errors. Board UI via `/preflight`. No migrations.
- Anti-goals: don't add a parallel reasoning engine (value engine lives in `deep-synthesize`); don't auto-export anything; don't surface internal "why" on the face.

---

## 12. Nothing is wasted — how everything we already built maps into the seed

The seed is the **container**; the Crucible is the **engine** inside it; the membrane is the **fork**; the lenses are the **Map tab**. The earlier `CRUCIBLE_MASTER_PLAN.md` is not superseded — it is the engine that fills `seed.internal`.

| What we already built / designed | Where it lives in the Seed model |
|---|---|
| AI-resolve rounds · ambiguities · priority/optimization map (prompt_sharpening) | `seed.internal` — the FIRST seeding steps; factual ambiguities auto-resolved, preference ones asked in the chatbox (not board cards) |
| **Crucible** reasoning graph — leverage_points · first_principles · variables · connections (Phases 1–4) | `seed.internal.reasoningGraph` + fields — **the engine that produces the seed** |
| Pill-map · verdict · connections · **lenses** (conceptual/structural/causal, Module 5) | the **expand → Map tab** — ONE graph, three lens projections (not two graphs) |
| **Membrane** (proposals bud from the leverage surface) | the **fork ⑂** — forking a leverage region buds a proposal (a downstream seed) |
| Ranked proposals = "ways to approach the product" | the forks, ranked by `strategy-composite-ranker` |
| conceptual → structural → prototype arc | `seed.internal` (conceptual) → fork = proposal → **"Spec it"** fork → structural lanes (image 2: `decompose-cards`+`deploy-oc-cards`) → `compose-tech-spec` → prototype |
| **SpecForge** (20-engine deep spec) | the deep **Forge** tier of the "Spec it" fork; light `decompose-cards` = Sketch/Standard tier; shared `compose-tech-spec` terminal |
| `crucible-strength.ts` (node strength: centrality × score × novelty) | the engine's node-ranker — picks the apex that becomes `external.deliverable` |
| **connection-ranker** *(MISSING — the one gap)* | inside the engine — scores edges (betweenness × endpoint-strength × novelty); decides which membrane regions are bud-worthy |
| `strategy-composite-ranker.ts` *(ORPHANED on twin rails)* | ranks the forked proposals — un-orphaned by feeding it the seed's converged graph |
| value engine — differentiation · analogous examples · variable consolidation (§5) | runs inside `deep-synthesize`, writes `seed.internal.alternatives/analogousExamples/canonicalVariables`, feeds `external.vsAlternatives` |

**Why the seed is the *better* version of the membrane model:** the membrane put the graph *above* and proposals *below* on one board plane. The seed sandboxes the graph *inside the card* (Map tab) and makes proposals *forked downstream cards* — so the reasoning never sits on the board at all. Same architecture, plus the internal/external discipline. Nothing built is discarded; it's re-homed from "scattered board cards" into "one seed's engine + on-demand forks."
```
