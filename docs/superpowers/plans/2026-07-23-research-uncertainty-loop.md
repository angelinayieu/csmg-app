# Research ↔ Uncertainty Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop between the research engine and the uncertainty heat map, so resolving a question cools the graph, research expands it with strategically-aligned questions, and unmet criteria steer the next research pass.

**Architecture:** Pure functions in `src/lib/maturity/` own all math and policy; thin I/O wrappers persist. Uncertainty lives only on `entities.node_signature.residual_uncertainty`. Question weight comes from `root_score` (`root-tracer.ts`) frozen at creation. Five machine-checked criteria gate question state AND select the next research pass kind, so one mechanism drives both the UI checklist and the router.

**Tech Stack:** TypeScript (strict), Next.js 15 App Router, Supabase (Postgres + RLS), vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-research-uncertainty-loop-design.md`

## Global Constraints

- **Scope of this plan is the logic layer only.** UI (criteria checklist, saturation band on the bar) is a separate follow-on plan. No React components are created here.
- Residual uncertainty floor is **0.05**. Never write a residual below it.
- Question weight is **frozen at creation**. No code path recomputes an existing question's weight from live uncertainty.
- Make threshold: maturity **≥ 0.60** AND saturation **≥ 0.50**.
- Question spawn cap: **3 per research pass**. When the cap binds, `console.info` it — a silent cap reads as "covered everything".
- Tests live in `__tests__/` beside the module (`src/lib/maturity/__tests__/`), matching `184f226`.
- Soft-fail discipline: a failed graph write logs via `console.warn` and returns a falsy result. It never throws and never blocks question state.
- Fail closed on `root-tracer` failure: spawn zero questions rather than unaligned ones.
- The question-spawn path must never read `object_links`.
- Commit trailer for every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Branch: `feat/double-diamond-remodel`. Do not merge or push; commit locally only.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/objective-canvas/seed/materialize-seed-graph.ts` | **Create.** Maps the seed's jsonb `reasoningGraph` into real `entities` + `edges`, then seeds signatures and runs the root trace. Without this the loop is inert at the Objective Canvas. |
| `src/lib/maturity/types.ts` | **Modify.** Criteria model, `parentId`/`derivedFrom` on `GlobalQuestion` |
| `src/lib/maturity/compute.ts` | **Modify.** Maturity with unasked denominator, saturation, leaf flattening, Make conjunction, criteria gates |
| `src/lib/maturity/weight.ts` | **Create.** `root_score` → frozen question weight; sub-question weight distribution |
| `src/lib/maturity/drain.ts` | **Create.** Pure drain math (no I/O) |
| `src/lib/maturity/apply-drain.ts` | **Create.** Persists a drain as a ring via `persistSignature` + `emitSignatureDeepened` |
| `src/lib/maturity/criteria.ts` | **Create.** Five pure criterion evaluators over already-fetched inputs |
| `src/lib/maturity/spawn.ts` | **Create.** Arc 2 alignment gate + 3-per-pass cap |
| `src/lib/maturity/routing.ts` | **Create.** Arc 3 — unmet criteria → next `PassKind` |
| `src/lib/pipeline/research-depth-engine.ts` | **Modify.** `shouldContinueResearch` consumes criteria routing |
| `src/types/node-signature.ts` | **Modify.** `BasisEvidence.source` gains `"question"` |
| `supabase/migrations/20261012_global_questions.sql` | **Create.** The `global_questions` table |

---

### Task 0: vitest prerequisite

`184f226` shipped `compute.test.ts` and `verbs.test.ts` that have **never executed** — vitest is not in `package.json`. Nothing downstream is trustworthy until they run.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` runs vitest; `@/` resolves in tests

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest@^3 vite-tsconfig-paths@^5
```

- [ ] **Step 2: Create the config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Run the existing tests**

Run: `npm test`
Expected: `compute.test.ts` and `verbs.test.ts` both PASS. If either fails, **stop and report** — that is a pre-existing bug in `184f226`, not something to fix by editing the test to match the code.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(test): install vitest so the maturity + verb tests actually run"
```

---

### Task 0.5: Materialize the seed graph into entities + signatures

**Why this exists.** The Objective Canvas's graph is *not* in `entities`/`edges`.
`assemble-seed.ts:147` writes `internal.reasoningGraph = { nodes, edges }` into
the `synthesis_data.objective_canvas` jsonb blob, and `seed/route.ts` merges it
there (`sync_graph`, lines 126–148). But `node_signature.residual_uncertainty` —
which every later task operates on — lives on the `entities` table. Without this
task, all the math below is correct and fully tested and **completely inert at
the surface it is meant to run on**. This implements spec §4a.

**The detail that decides whether the loop works at all.** `root-tracer.ts` walks
**only causal edge types** (`causes`, `enables`, `inhibits`, `moderates`,
`mediates`, `constrains`, `temporally_precedes`). It deliberately excludes
`relates_to`, `composes`, `competes`. So if the seed's relations all map to
`relates_to`, every `causal_depth` comes back null, the Task 8 alignment gate
rejects everything, and no question is ever spawned. The relation mapping below
is therefore load-bearing, not cosmetic — get it wrong and the loop silently
does nothing.

**Files:**
- Create: `src/lib/objective-canvas/seed/materialize-seed-graph.ts`
- Create: `src/lib/objective-canvas/seed/__tests__/materialize-seed-graph.test.ts`

**Interfaces:**
- Consumes: `SeedNode`, `SeedEdge` from `../seed-types`; `seedNodeSignature`, `persistSignature` from `@/lib/pipeline/signature-materializer`; `traceRootCauses`, `persistTraceResults` from `@/lib/pipeline/root-tracer`
- Produces: `mapSeedNode(node, spaceId)`, `mapSeedRelation(relation)`, `mapSeedGraph(graph, spaceId)`, `materializeSeedGraph(db, spaceId, graph, apexNodeId)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/objective-canvas/seed/__tests__/materialize-seed-graph.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapSeedNode, mapSeedRelation, mapSeedGraph } from "../materialize-seed-graph";
import type { SeedNode, SeedEdge } from "../seed-types";

const SPACE = "11111111-1111-1111-1111-111111111111";

describe("mapSeedRelation", () => {
  it("maps structural seed relations onto CAUSAL types the root tracer walks", () => {
    // root-tracer.ts only follows causal types. Anything mapped to relates_to
    // is invisible to it, which would make causal_depth null everywhere.
    expect(mapSeedRelation("feeds").relationship_type).toBe("causes");
    expect(mapSeedRelation("depends_on").relationship_type).toBe("constrains");
    expect(mapSeedRelation("bounded_by").relationship_type).toBe("constrains");
    expect(mapSeedRelation("derived_from").relationship_type).toBe("enables");
  });

  it("marks the causal ones with the causal dimension", () => {
    for (const r of ["feeds", "depends_on", "bounded_by", "derived_from"]) {
      expect(mapSeedRelation(r).dimension).toBe("causal");
    }
  });

  it("keeps genuinely epistemic relations epistemic", () => {
    expect(mapSeedRelation("informed_by").relationship_type).toBe("relates_to");
    expect(mapSeedRelation("informed_by").dimension).toBe("epistemic");
    expect(mapSeedRelation("explores").relationship_type).toBe("relates_to");
  });

  it("falls back to relates_to for an unknown relation", () => {
    expect(mapSeedRelation("nonsense").relationship_type).toBe("relates_to");
    expect(mapSeedRelation(undefined).relationship_type).toBe("relates_to");
  });
});

describe("mapSeedNode", () => {
  function node(o: Partial<SeedNode> = {}): SeedNode {
    return { id: "sol-x", label: "Ship a CLI", type: "solution", ...o };
  }

  it("carries the seed slug through as entity_id so edges can resolve", () => {
    expect(mapSeedNode(node(), SPACE).entity_id).toBe("sol-x");
  });

  it("maps seed types onto entity categories", () => {
    expect(mapSeedNode(node({ type: "solution" }), SPACE).entity_category).toBe("process");
    expect(mapSeedNode(node({ type: "constraint" }), SPACE).entity_category).toBe("relational");
    expect(mapSeedNode(node({ type: "insight" }), SPACE).entity_category).toBe("epistemic");
    expect(mapSeedNode(node({ type: "variable" }), SPACE).entity_category).toBe("abstract");
  });

  it("falls back to epistemic for an unknown type", () => {
    expect(mapSeedNode(node({ type: "wat" }), SPACE).entity_category).toBe("epistemic");
  });

  it("marks provenance so these are distinguishable from research-added nodes", () => {
    expect(mapSeedNode(node(), SPACE).provenance.source_type).toBe("objective_seed");
  });

  it("uses the label as the name and stamps the space", () => {
    const e = mapSeedNode(node(), SPACE);
    expect(e.name).toBe("Ship a CLI");
    expect(e.space_id).toBe(SPACE);
  });
});

describe("mapSeedGraph", () => {
  const nodes: SeedNode[] = [
    { id: "apex", label: "The objective", type: "objective" },
    { id: "sol-a", label: "Solution A", type: "solution" },
    { id: "con-b", label: "Constraint B", type: "constraint" },
  ];
  const edges: SeedEdge[] = [
    { source: "sol-a", target: "con-b", relation: "depends_on" },
    { source: "apex", target: "sol-a", relation: "explores" },
  ];

  it("maps every node", () => {
    expect(mapSeedGraph({ nodes, edges }, SPACE).entities).toHaveLength(3);
  });

  it("keeps edges keyed by seed slug for post-insert uuid resolution", () => {
    const g = mapSeedGraph({ nodes, edges }, SPACE);
    expect(g.edges[0].source_seed_id).toBe("sol-a");
    expect(g.edges[0].target_seed_id).toBe("con-b");
  });

  it("drops edges pointing at nodes that are not present", () => {
    const g = mapSeedGraph(
      { nodes, edges: [{ source: "sol-a", target: "ghost", relation: "feeds" }] },
      SPACE,
    );
    expect(g.edges).toHaveLength(0);
  });

  it("produces at least one causal edge so the root trace has something to walk", () => {
    const g = mapSeedGraph({ nodes, edges }, SPACE);
    expect(g.edges.some((e) => e.dimension === "causal")).toBe(true);
  });

  it("handles an empty graph without throwing", () => {
    const g = mapSeedGraph({ nodes: [], edges: [] }, SPACE);
    expect(g.entities).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/objective-canvas/seed/__tests__/materialize-seed-graph.test.ts`
Expected: FAIL — cannot resolve `../materialize-seed-graph`.

- [ ] **Step 3: Implement**

Create `src/lib/objective-canvas/seed/materialize-seed-graph.ts`:

```ts
// ── Seed graph → substrate KG ─────────────────────────────────────────
//
// Spec §4a. The Objective Canvas builds its graph as jsonb
// (`internal.reasoningGraph`, assemble-seed.ts:147) — good for rendering,
// invisible to everything that reasons about uncertainty. node_signature,
// root_score, the strategizer and the whole maturity model live on
// `entities`. This bridges the two.
//
// The jsonb reasoningGraph stays the canvas's display model. `entities` +
// `edges` become the substrate. Same layering as library_objects: outputs
// point back at the substrate, the substrate carries the uncertainty.
//
// RELATION MAPPING IS LOAD-BEARING. root-tracer.ts walks causal edge types
// only — relates_to / composes / competes are excluded on purpose, because
// including them "would make every entity 1-hop from the goal via spurious
// paths". If the seed's structural relations all landed on relates_to,
// causal_depth would be null everywhere, the alignment gate would reject
// every candidate, and no question would ever spawn. The loop would look
// wired and do nothing.

import type { SeedNode, SeedEdge } from "./seed-types";
import {
  seedNodeSignature,
  persistSignature,
} from "@/lib/pipeline/signature-materializer";
import {
  traceRootCauses,
  persistTraceResults,
} from "@/lib/pipeline/root-tracer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface MappedEntity {
  space_id: string;
  /** The seed slug. Kept as entity_id so edges resolve by slug before the
   *  database hands back uuids. */
  entity_id: string;
  name: string;
  description: string;
  entity_type: string;
  entity_category: "concrete" | "abstract" | "process" | "relational" | "epistemic" | "fault";
  source_tag: "explicit" | "implicit" | "assumed";
  importance: "fundamental" | "critical" | "important" | "moderate";
  confidence: number;
  knowledge_layer: string;
  provenance: { source_type: string };
}

export interface MappedEdge {
  space_id: string;
  source_seed_id: string;
  target_seed_id: string;
  relationship_type: string;
  dimension: "causal" | "epistemic" | "structural" | "temporal";
  source_tag: "predicted";
  strength: number;
  polarity: "positive";
  confidence: number;
  knowledge_layer: string;
}

const CATEGORY_BY_SEED_TYPE: Record<string, MappedEntity["entity_category"]> = {
  objective: "abstract",
  solution: "process",
  constraint: "relational",
  variable: "abstract",
  insight: "epistemic",
  fact: "epistemic",
};

/** Seed relation → (relationship_type, dimension). The four structural
 *  relations map onto CAUSAL types so root-tracer can walk them; the two
 *  genuinely epistemic ones stay epistemic and are correctly ignored by it. */
export function mapSeedRelation(relation: string | undefined): {
  relationship_type: string;
  dimension: MappedEdge["dimension"];
} {
  switch (relation) {
    case "feeds":
      return { relationship_type: "causes", dimension: "causal" };
    case "depends_on":
    case "bounded_by":
      return { relationship_type: "constrains", dimension: "causal" };
    case "derived_from":
      return { relationship_type: "enables", dimension: "causal" };
    case "informed_by":
    case "explores":
      return { relationship_type: "relates_to", dimension: "epistemic" };
    default:
      return { relationship_type: "relates_to", dimension: "epistemic" };
  }
}

export function mapSeedNode(node: SeedNode, spaceId: string): MappedEntity {
  return {
    space_id: spaceId,
    entity_id: node.id,
    name: node.label,
    description: node.keyword ?? node.label,
    entity_type: node.type,
    entity_category: CATEGORY_BY_SEED_TYPE[node.type] ?? "epistemic",
    source_tag: "implicit",
    importance: "moderate",
    confidence: typeof node.score === "number" ? Math.max(0.3, Math.min(1, node.score)) : 0.6,
    knowledge_layer: "internal",
    provenance: { source_type: "objective_seed" },
  };
}

export function mapSeedGraph(
  graph: { nodes: SeedNode[]; edges: SeedEdge[] },
  spaceId: string,
): { entities: MappedEntity[]; edges: MappedEdge[] } {
  const entities = graph.nodes.map((n) => mapSeedNode(n, spaceId));
  const present = new Set(graph.nodes.map((n) => n.id));

  const edges: MappedEdge[] = [];
  for (const e of graph.edges) {
    if (!present.has(e.source) || !present.has(e.target)) continue;
    const { relationship_type, dimension } = mapSeedRelation(e.relation);
    edges.push({
      space_id: spaceId,
      source_seed_id: e.source,
      target_seed_id: e.target,
      relationship_type,
      dimension,
      source_tag: "predicted",
      strength: 0.6,
      polarity: "positive",
      confidence: 0.6,
      knowledge_layer: "internal",
    });
  }

  return { entities, edges };
}

/** Writes the seed graph to `entities` + `edges`, seeds a signature per node,
 *  then runs the root trace so every node has causal_depth + root_score.
 *
 *  Idempotent by (space_id, entity_id) upsert — re-running after `sync_graph`
 *  grows the graph rather than duplicating it, matching the seed route's
 *  "never shrinks below current" discipline.
 *
 *  Soft-fail: returns counts and logs. A partial materialization is better
 *  than a thrown request, and the next sync_graph tick tops it up. */
export async function materializeSeedGraph(
  db: AnyDb,
  spaceId: string,
  graph: { nodes: SeedNode[]; edges: SeedEdge[] },
  apexNodeId: string,
): Promise<{ entities: number; edges: number; traced: number }> {
  const mapped = mapSeedGraph(graph, spaceId);
  if (mapped.entities.length === 0) return { entities: 0, edges: 0, traced: 0 };

  const { data: rows, error } = await db
    .from("entities")
    .upsert(mapped.entities, { onConflict: "space_id,entity_id" })
    .select("id, entity_id");

  if (error || !rows) {
    console.warn("[seed_materialize] entity upsert failed:", error);
    return { entities: 0, edges: 0, traced: 0 };
  }

  const uuidBySeedId = new Map<string, string>();
  for (const r of rows) uuidBySeedId.set(r.entity_id, r.id);

  const edgeRows = mapped.edges
    .map((e) => {
      const source_entity_id = uuidBySeedId.get(e.source_seed_id);
      const target_entity_id = uuidBySeedId.get(e.target_seed_id);
      if (!source_entity_id || !target_entity_id) return null;
      const { source_seed_id: _s, target_seed_id: _t, ...rest } = e;
      return { ...rest, source_entity_id, target_entity_id };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  if (edgeRows.length > 0) {
    const { error: edgeErr } = await db.from("edges").insert(edgeRows);
    if (edgeErr) console.warn("[seed_materialize] edge insert failed:", edgeErr);
  }

  // Reload as full rows so seedNodeSignature and traceRootCauses see exactly
  // what the rest of the pipeline sees.
  const [{ data: entities }, { data: edges }] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
  ]);

  if (!entities) return { entities: rows.length, edges: edgeRows.length, traced: 0 };

  for (const entity of entities) {
    const touching = (edges ?? []).filter(
      (e: { source_entity_id: string; target_entity_id: string }) =>
        e.source_entity_id === entity.id || e.target_entity_id === entity.id,
    );
    const sig = seedNodeSignature({ entity, edges: touching, axisMemberships: [] });
    await persistSignature(db, entity.id, sig);
  }

  // The seed's apex IS the goal — it is what every other node was decomposed
  // from, so it is the correct backward-trace root.
  const apexUuid = uuidBySeedId.get(apexNodeId);
  let traced = 0;
  if (apexUuid) {
    const trace = traceRootCauses({
      entities,
      edges: edges ?? [],
      goalEntityIds: [apexUuid],
    });
    await persistTraceResults(db, spaceId, trace);
    traced = trace.reachable_count;
  } else {
    console.warn("[seed_materialize] apex node not found; skipping root trace");
  }

  return { entities: rows.length, edges: edgeRows.length, traced };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: tests PASS, tsc clean.

If `persistTraceResults` or `traceRootCauses` has a different parameter shape
than used above, **match the real signature** in `root-tracer.ts` rather than
changing the test — the test only asserts on the pure mapping functions.

- [ ] **Step 5: Verify a real seed produces a traceable graph**

This is the step that proves the loop is not inert. Pick a space that has been
seeded, then in a Node REPL or a scratch route:

Run: check that after `materializeSeedGraph`, at least one entity has a
non-null `causal_depth`:

```sql
select count(*) filter (where causal_depth is not null) as aligned,
       count(*) as total
from entities where space_id = '<your space id>';
```

Expected: `aligned > 0`. **If `aligned` is 0, stop** — the relation mapping is
not producing causal edges, and every downstream task will silently spawn zero
questions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/objective-canvas/seed/materialize-seed-graph.ts src/lib/objective-canvas/seed/__tests__/
git commit -m "feat(seed): materialize the reasoning graph into entities + signatures"
```

---

### Task 1: Criteria model in types

**Files:**
- Modify: `src/lib/maturity/types.ts`
- Modify: `src/lib/maturity/__tests__/compute.test.ts` (helper only)

**Interfaces:**
- Consumes: nothing
- Produces: `CriterionId`, `CriterionStatus`, `Criterion`, `ALL_CRITERION_IDS`, `CRITERION_LABELS`, revised `QuestionEvidence`, `GlobalQuestion` with `parentId?` / `derivedFrom?`

- [ ] **Step 1: Write the failing test**

Create `src/lib/maturity/__tests__/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ALL_CRITERION_IDS, CRITERION_LABELS } from "../types";

describe("criteria model", () => {
  it("has exactly five criteria", () => {
    expect(ALL_CRITERION_IDS).toEqual([
      "coverage",
      "triangulation",
      "adversarial",
      "graph_quality",
      "alignment",
    ]);
  });

  it("labels every criterion in plain language, free of jargon", () => {
    const banned = /engine|convergence|divergence|rubric|goodhart|substrate|triangulat|adversarial/i;
    for (const id of ALL_CRITERION_IDS) {
      const label = CRITERION_LABELS[id];
      expect(label, `${id} has a label`).toBeTruthy();
      expect(banned.test(label), `${id} label "${label}" is jargon-free`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/maturity/__tests__/types.test.ts`
Expected: FAIL — `ALL_CRITERION_IDS` is not exported.

- [ ] **Step 3: Add the criteria model**

In `src/lib/maturity/types.ts`, add above `GlobalQuestion`:

```ts
/** The five machine-checked criteria that decide whether a question was
 *  actually answered. Closed set — adding a sixth is a spec change, not a
 *  code change. */
export type CriterionId =
  | "coverage"
  | "triangulation"
  | "adversarial"
  | "graph_quality"
  | "alignment";

export const ALL_CRITERION_IDS: CriterionId[] = [
  "coverage",
  "triangulation",
  "adversarial",
  "graph_quality",
  "alignment",
];

/** Plain-language labels. Spec invariant #11 bans jargon from rendered
 *  strings; the internal ids stay technical, these do not. */
export const CRITERION_LABELS: Record<CriterionId, string> = {
  coverage: "Backed up",
  triangulation: "Independently checked",
  adversarial: "Argued against",
  graph_quality: "Holds together",
  alignment: "Connects to goal",
};

export type CriterionStatus = "unmet" | "met" | "contradicted";

export interface Criterion {
  id: CriterionId;
  status: CriterionStatus;
  /** One user-facing line, e.g. "1 of 2 separate sources". */
  detail: string;
}
```

Then replace `QuestionEvidence` and extend `GlobalQuestion`:

```ts
export interface QuestionEvidence {
  /** Replaces the old `research: boolean`. */
  criteria: Criterion[];
  userAnswer: boolean;
  confirmed: boolean;
}

export interface GlobalQuestion {
  id: string;
  prompt: string;
  state: QuestionState;
  /** Frozen root_score sum at creation; × CRITICAL_WEIGHT when critical.
   *  Never recomputed from live uncertainty. */
  weight: number;
  evidence: QuestionEvidence;
  sourceNodeIds: string[];
  /** Ring-derived decomposition. A question with children is excluded from
   *  the maturity average; its children are counted instead. */
  parentId?: string;
  /** Breadcrumb: the question whose research surfaced this one. Display
   *  only — never affects the math. */
  derivedFrom?: string;
}
```

Add the saturation threshold beside `MAKE_THRESHOLD`:

```ts
/** Saturation at or above which we trust the denominator enough to unlock
 *  Make. Maturity over a small denominator is meaningless on its own. */
export const MAKE_SATURATION_THRESHOLD = 0.5;

/** Floor so an aligned question never has zero weight and vanishes from the
 *  average. Only reachable if every source node's root_score is null, which
 *  the alignment gate should already prevent. */
export const MIN_QUESTION_WEIGHT = 0.01;
```

- [ ] **Step 4: Fix the existing test helper**

In `src/lib/maturity/__tests__/compute.test.ts`, replace the `evidence` helper:

```ts
function evidence(o: Partial<QuestionEvidence> = {}): QuestionEvidence {
  return { criteria: [], userAnswer: false, confirmed: false, ...o };
}
```

Add a criteria builder below it:

```ts
function crit(
  met: CriterionId[] = [],
  contradicted: CriterionId[] = [],
): Criterion[] {
  return ALL_CRITERION_IDS.map((id) => ({
    id,
    status: contradicted.includes(id)
      ? ("contradicted" as const)
      : met.includes(id)
        ? ("met" as const)
        : ("unmet" as const),
    detail: "",
  }));
}
```

Update the import block to pull `ALL_CRITERION_IDS`, `type Criterion`, `type CriterionId` from `../types`. Any existing test that passed `{ research: true }` now passes `{ criteria: crit(["coverage"]) }`.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: `types.test.ts` PASSES. `compute.test.ts` still compiles; the gate assertions may fail — that is expected and Task 2 fixes them. Do not edit `compute.ts` yet.

- [ ] **Step 6: Commit**

```bash
git add src/lib/maturity/types.ts src/lib/maturity/__tests__/
git commit -m "feat(maturity): criteria model replaces the research boolean"
```

---

### Task 2: Maturity math — unasked denominator, saturation, leaf flattening

**Files:**
- Modify: `src/lib/maturity/compute.ts`
- Modify: `src/lib/maturity/__tests__/compute.test.ts`

**Interfaces:**
- Consumes: `GlobalQuestion`, `Criterion`, `MAKE_SATURATION_THRESHOLD` (Task 1)
- Produces: `computeMaturity(questions, unaskedWeight?)`, `flattenForMaturity(questions)`, `computeSaturation(nodes, circuitBreakerReason?)`, `isMakeUnlocked(questions, saturation, unaskedWeight?)`, `type SaturationNode`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/maturity/__tests__/compute.test.ts`:

```ts
describe("unasked-uncertainty denominator", () => {
  it("lowers maturity by the unasked weight", () => {
    const qs = [q({ state: "resolved", weight: 1 })];
    expect(computeMaturity(qs)).toBe(1);
    expect(computeMaturity(qs, 1)).toBeCloseTo(0.5, 5);
  });

  it("ignores a negative unasked weight", () => {
    const qs = [q({ state: "resolved", weight: 1 })];
    expect(computeMaturity(qs, -5)).toBe(1);
  });

  it("is 0 when there are no questions and only unasked weight", () => {
    expect(computeMaturity([], 3)).toBe(0);
  });
});

describe("leaf flattening", () => {
  it("drops a question that has children", () => {
    const qs = [
      q({ id: "parent", weight: 2, state: "open" }),
      q({ id: "a", parentId: "parent", weight: 1, state: "resolved" }),
      q({ id: "b", parentId: "parent", weight: 1, state: "open" }),
    ];
    const leaves = flattenForMaturity(qs);
    expect(leaves.map((x) => x.id)).toEqual(["a", "b"]);
    expect(computeMaturity(leaves)).toBeCloseTo(0.5, 5);
  });

  it("keeps childless questions", () => {
    const qs = [q({ id: "solo" })];
    expect(flattenForMaturity(qs).map((x) => x.id)).toEqual(["solo"]);
  });

  it("leaves maturity unchanged when a question is decomposed", () => {
    const before = [q({ id: "p", weight: 2, state: "open" })];
    const after = [
      q({ id: "p", weight: 2, state: "open" }),
      q({ id: "c1", parentId: "p", weight: 1.2, state: "open" }),
      q({ id: "c2", parentId: "p", weight: 0.8, state: "open" }),
    ];
    expect(computeMaturity(flattenForMaturity(after))).toBe(
      computeMaturity(flattenForMaturity(before)),
    );
  });
});

describe("saturation", () => {
  const nodes: SaturationNode[] = [
    { entityId: "a", rootScore: 3, pinnedBecause: "saturated" },
    { entityId: "b", rootScore: 1, pinnedBecause: "budget" },
  ];

  it("is the root_score-weighted fraction that is saturated", () => {
    expect(computeSaturation(nodes, null)).toBeCloseTo(0.75, 5);
  });

  it("counts user_locked as saturated", () => {
    expect(
      computeSaturation([{ entityId: "a", rootScore: 1, pinnedBecause: "user_locked" }], null),
    ).toBe(1);
  });

  it("caps at 0.7 when research stopped early on budget", () => {
    expect(computeSaturation(nodes, "Search budget exhausted (25/25)")).toBeCloseTo(0.7, 5);
  });

  it("caps at 0.7 when research stopped early on max passes", () => {
    expect(computeSaturation(nodes, "Max passes reached (3)")).toBeCloseTo(0.7, 5);
  });

  it("does not cap when research genuinely ran dry", () => {
    expect(
      computeSaturation(nodes, "No new entities and no critical/high continuation signals"),
    ).toBeCloseTo(0.75, 5);
  });

  it("is 0 with no aligned nodes", () => {
    expect(computeSaturation([], null)).toBe(0);
  });
});

describe("the Make gate", () => {
  const resolved = [q({ state: "resolved", weight: 1 })];

  it("requires both maturity and saturation", () => {
    expect(isMakeUnlocked(resolved, 0.9)).toBe(true);
    expect(isMakeUnlocked(resolved, 0.4)).toBe(false);
  });

  it("stays locked on high saturation but low maturity", () => {
    expect(isMakeUnlocked([q({ state: "open", weight: 1 })], 0.9)).toBe(false);
  });

  it("accounts for unasked weight", () => {
    expect(isMakeUnlocked(resolved, 0.9, 1)).toBe(false);
  });
});
```

Extend the imports at the top of the file to include `computeSaturation`, `flattenForMaturity`, and `type SaturationNode` from `../compute`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/maturity/__tests__/compute.test.ts`
Expected: FAIL — `flattenForMaturity` / `computeSaturation` are not exported.

- [ ] **Step 3: Implement**

In `src/lib/maturity/compute.ts`, replace `computeMaturity`, `maturityPct` and `isMakeUnlocked`, and add the new functions:

```ts
/** Maturity as a fraction in [0, 1].
 *
 *  `unaskedWeight` is the phantom denominator: aligned nodes carrying real
 *  root_score that have not become questions yet. Without it, every
 *  discovery lurches the bar downward; with it, discovery mostly converts
 *  phantom weight into real weight. */
export function computeMaturity(
  questions: GlobalQuestion[],
  unaskedWeight = 0,
): number {
  let got = 0;
  let total = 0;
  for (const q of questions) {
    const w = q.weight > 0 ? q.weight : MIN_QUESTION_WEIGHT;
    total += w;
    got += w * stateScore(q.state);
  }
  const denom = total + Math.max(0, unaskedWeight);
  if (denom === 0) return 0;
  return got / denom;
}

export function maturityPct(
  questions: GlobalQuestion[],
  unaskedWeight = 0,
): number {
  return Math.round(computeMaturity(questions, unaskedWeight) * 100);
}

/** Drops any question that has children. Decomposition redistributes a
 *  parent's weight across its children, so counting both would double-count
 *  and make decomposition move the bar. */
export function flattenForMaturity(
  questions: GlobalQuestion[],
): GlobalQuestion[] {
  const parentIds = new Set<string>();
  for (const q of questions) {
    if (q.parentId) parentIds.add(q.parentId);
  }
  return questions.filter((q) => !parentIds.has(q.id));
}

/** One aligned node's contribution to saturation. `pinnedBecause` mirrors
 *  `ResolutionLevel.pinned_because` on the node's signature. */
export interface SaturationNode {
  entityId: string;
  rootScore: number;
  pinnedBecause: "budget" | "saturated" | "awaiting_evidence" | "user_locked";
}

/** True when the reason we stopped researching was running out of room
 *  rather than running out of findings. */
function stoppedEarly(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /max passes reached|search budget exhausted|entity iteration cap/i.test(
    reason,
  );
}

/** How much we can trust the denominator: the root_score-weighted fraction
 *  of aligned nodes that stopped because there was nothing left, capped when
 *  the research plan itself halted early. */
export function computeSaturation(
  nodes: SaturationNode[],
  circuitBreakerReason: string | null = null,
): number {
  let saturated = 0;
  let total = 0;
  for (const n of nodes) {
    const w = n.rootScore > 0 ? n.rootScore : 0;
    total += w;
    if (n.pinnedBecause === "saturated" || n.pinnedBecause === "user_locked") {
      saturated += w;
    }
  }
  if (total === 0) return 0;
  const raw = saturated / total;
  return stoppedEarly(circuitBreakerReason) ? Math.min(raw, 0.7) : raw;
}

/** Make unlocks only on the conjunction. Maturity over a small denominator
 *  is meaningless; saturation alone says nothing was answered. */
export function isMakeUnlocked(
  questions: GlobalQuestion[],
  saturation: number,
  unaskedWeight = 0,
): boolean {
  return (
    computeMaturity(questions, unaskedWeight) >= MAKE_THRESHOLD &&
    saturation >= MAKE_SATURATION_THRESHOLD
  );
}
```

Update the import at the top of `compute.ts` to add `MAKE_SATURATION_THRESHOLD` and `MIN_QUESTION_WEIGHT`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/maturity/
git commit -m "feat(maturity): unasked denominator, saturation, leaf flattening, two-part Make gate"
```

---

### Task 3: Criteria gates

**Files:**
- Modify: `src/lib/maturity/compute.ts`
- Modify: `src/lib/maturity/__tests__/compute.test.ts`

**Interfaces:**
- Consumes: `Criterion`, `ALL_CRITERION_IDS` (Task 1)
- Produces: `criterionStatus(e, id)`, `allCriteriaMet(e)`, `hasContradiction(e)`, revised `canMarkExplored(e)` / `canMarkResolved(e)` / `nextAllowedState(q)`

- [ ] **Step 1: Write the failing tests**

Append to `compute.test.ts`:

```ts
describe("criteria gates", () => {
  it("allows explored on coverage alone", () => {
    expect(canMarkExplored(evidence({ criteria: crit(["coverage"]) }))).toBe(true);
  });

  it("allows explored on the user's own answer alone", () => {
    expect(canMarkExplored(evidence({ userAnswer: true }))).toBe(true);
  });

  it("blocks explored when nothing is met", () => {
    expect(canMarkExplored(evidence())).toBe(false);
  });

  it("blocks explored when any criterion is contradicted", () => {
    expect(
      canMarkExplored(
        evidence({ criteria: crit(["coverage"], ["triangulation"]), userAnswer: true }),
      ),
    ).toBe(false);
  });

  it("requires all five criteria plus answer plus confirmation to resolve", () => {
    const all = ALL_CRITERION_IDS;
    expect(
      canMarkResolved(evidence({ criteria: crit(all), userAnswer: true, confirmed: true })),
    ).toBe(true);
    expect(
      canMarkResolved(evidence({ criteria: crit(all), userAnswer: true, confirmed: false })),
    ).toBe(false);
    expect(
      canMarkResolved(evidence({ criteria: crit(all), userAnswer: false, confirmed: true })),
    ).toBe(false);
  });

  it("blocks resolve when one criterion is short", () => {
    const four = ALL_CRITERION_IDS.filter((id) => id !== "adversarial");
    expect(
      canMarkResolved(evidence({ criteria: crit(four), userAnswer: true, confirmed: true })),
    ).toBe(false);
  });

  it("cannot be advanced by clicking alone", () => {
    expect(nextAllowedState(q({ state: "open", evidence: evidence() }))).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/maturity/__tests__/compute.test.ts`
Expected: FAIL — the current gates read `e.research`, which no longer exists (TypeScript error).

- [ ] **Step 3: Implement**

Replace the evidence-gate block in `compute.ts`:

```ts
/** Status of one criterion, defaulting to `unmet` when absent. */
export function criterionStatus(
  e: QuestionEvidence,
  id: CriterionId,
): CriterionStatus {
  return e.criteria.find((c) => c.id === id)?.status ?? "unmet";
}

/** Any criterion actively contradicted blocks all forward movement — a
 *  contradiction is information, and it means the question is not answered. */
export function hasContradiction(e: QuestionEvidence): boolean {
  return e.criteria.some((c) => c.status === "contradicted");
}

export function allCriteriaMet(e: QuestionEvidence): boolean {
  return ALL_CRITERION_IDS.every((id) => criterionStatus(e, id) === "met");
}

/** `explored` needs one real foothold — research that produced a linked claim,
 *  or the user's own committed answer — and no contradiction. */
export function canMarkExplored(e: QuestionEvidence): boolean {
  if (hasContradiction(e)) return false;
  return criterionStatus(e, "coverage") === "met" || e.userAnswer;
}

/** `resolved` needs all five criteria, both sides of the compare, and an
 *  explicit confirmation. */
export function canMarkResolved(e: QuestionEvidence): boolean {
  if (hasContradiction(e)) return false;
  return allCriteriaMet(e) && e.userAnswer && e.confirmed;
}
```

Add `ALL_CRITERION_IDS`, `type CriterionId`, `type CriterionStatus` to the import from `./types`. `nextAllowedState` needs no change — it already delegates to these two.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/maturity/
git commit -m "feat(maturity): criteria-based explored/resolved gates"
```

---

### Task 4: Weight from root_score

**Files:**
- Create: `src/lib/maturity/weight.ts`
- Create: `src/lib/maturity/__tests__/weight.test.ts`

**Interfaces:**
- Consumes: `EntityTraceResult` from `@/lib/pipeline/root-tracer`, `CRITICAL_WEIGHT`, `MIN_QUESTION_WEIGHT` (Task 1)
- Produces: `questionWeight(sourceNodeIds, trace, critical?)`, `nodeShares(sourceNodeIds, trace)`, `distributeWeight(parentWeight, contributions)`, `unaskedWeight(trace, askedNodeIds, spawnThreshold)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/maturity/__tests__/weight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  questionWeight,
  nodeShares,
  distributeWeight,
  unaskedWeight,
} from "../weight";
import type { EntityTraceResult } from "@/lib/pipeline/root-tracer";

function trace(
  entries: Array<[string, number | null, number | null]>,
): Map<string, EntityTraceResult> {
  const m = new Map<string, EntityTraceResult>();
  for (const [id, depth, score] of entries) {
    m.set(id, {
      entity_id: id,
      causal_depth: depth,
      converges_chains: [],
      is_root_candidate: false,
      root_score: score,
    });
  }
  return m;
}

describe("questionWeight", () => {
  it("sums root_score across source nodes", () => {
    const t = trace([["a", 1, 0.4], ["b", 2, 0.2]]);
    expect(questionWeight(["a", "b"], t)).toBeCloseTo(0.6, 5);
  });

  it("doubles for a critical question", () => {
    const t = trace([["a", 1, 0.4]]);
    expect(questionWeight(["a"], t, true)).toBeCloseTo(0.8, 5);
  });

  it("floors rather than returning zero for unscored nodes", () => {
    const t = trace([["a", null, null]]);
    expect(questionWeight(["a"], t)).toBe(0.01);
  });

  it("ignores nodes missing from the trace", () => {
    const t = trace([["a", 1, 0.5]]);
    expect(questionWeight(["a", "ghost"], t)).toBeCloseTo(0.5, 5);
  });
});

describe("nodeShares", () => {
  it("splits by root_score and sums to 1", () => {
    const t = trace([["a", 1, 0.75], ["b", 1, 0.25]]);
    const s = nodeShares(["a", "b"], t);
    expect(s.get("a")).toBeCloseTo(0.75, 5);
    expect(s.get("b")).toBeCloseTo(0.25, 5);
  });

  it("gives a single source the whole share", () => {
    const t = trace([["a", 1, 0.3]]);
    expect(nodeShares(["a"], t).get("a")).toBe(1);
  });

  it("splits evenly when no node has a score", () => {
    const t = trace([["a", null, null], ["b", null, null]]);
    const s = nodeShares(["a", "b"], t);
    expect(s.get("a")).toBeCloseTo(0.5, 5);
    expect(s.get("b")).toBeCloseTo(0.5, 5);
  });
});

describe("distributeWeight", () => {
  it("splits the parent's weight in proportion to ring contribution", () => {
    expect(distributeWeight(2, [0.3, 0.1])).toEqual([1.5, 0.5]);
  });

  it("conserves the parent's weight exactly", () => {
    const parts = distributeWeight(1.7, [0.11, 0.07, 0.05]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(1.7, 10);
  });

  it("splits evenly when contributions are all zero", () => {
    expect(distributeWeight(1, [0, 0])).toEqual([0.5, 0.5]);
  });

  it("returns an empty array for no children", () => {
    expect(distributeWeight(1, [])).toEqual([]);
  });
});

describe("unaskedWeight", () => {
  it("sums root_score for aligned nodes below the spawn threshold", () => {
    const t = trace([["a", 1, 0.4], ["b", 1, 0.1], ["c", null, null]]);
    expect(unaskedWeight(t, new Set(), 0.3)).toBeCloseTo(0.1, 5);
  });

  it("excludes nodes that already have a question", () => {
    const t = trace([["a", 1, 0.1], ["b", 1, 0.2]]);
    expect(unaskedWeight(t, new Set(["a"]), 0.3)).toBeCloseTo(0.2, 5);
  });

  it("excludes unaligned nodes entirely", () => {
    const t = trace([["c", null, null]]);
    expect(unaskedWeight(t, new Set(), 0.3)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/maturity/__tests__/weight.test.ts`
Expected: FAIL — cannot resolve `../weight`.

- [ ] **Step 3: Implement**

Create `src/lib/maturity/weight.ts`:

```ts
// ── Question weight derivation ────────────────────────────────────────
//
// Weight comes from `root_score` (root-tracer.ts):
//   convergence_weight × depth_ratio × uncertainty_boost
// — importance, causal alignment and uncertainty in one number. It replaces
// a flat 1.0, and it replaces the strategizer's centrality × uncertainty,
// which target-outcome-extractor.ts already calls out as degenerate:
// "without an explicit target… ranking degenerates to graph centrality."
//
// Weight is FROZEN at question creation. If it tracked live uncertainty,
// resolving a question would shrink its own weight and the bar would chase
// itself. Nothing here reads current residual — callers pass the trace
// captured when the question was made.

import type { EntityTraceResult } from "@/lib/pipeline/root-tracer";
import { CRITICAL_WEIGHT, MIN_QUESTION_WEIGHT } from "./types";

type Trace = Map<string, EntityTraceResult>;

function scoreOf(trace: Trace, id: string): number {
  const s = trace.get(id)?.root_score;
  return typeof s === "number" && s > 0 ? s : 0;
}

/** Frozen weight for a new question: the summed root_score of its source
 *  nodes, doubled when the user marks it critical. */
export function questionWeight(
  sourceNodeIds: string[],
  trace: Trace,
  critical = false,
): number {
  let sum = 0;
  for (const id of sourceNodeIds) sum += scoreOf(trace, id);
  const base = sum > 0 ? sum : MIN_QUESTION_WEIGHT;
  return critical ? base * CRITICAL_WEIGHT : base;
}

/** Each source node's fraction of the question, summing to 1. Used by the
 *  drain so one question resolving does not fully drain several nodes. */
export function nodeShares(sourceNodeIds: string[], trace: Trace): Map<string, number> {
  const out = new Map<string, number>();
  if (sourceNodeIds.length === 0) return out;
  let total = 0;
  for (const id of sourceNodeIds) total += scoreOf(trace, id);
  if (total <= 0) {
    const even = 1 / sourceNodeIds.length;
    for (const id of sourceNodeIds) out.set(id, even);
    return out;
  }
  for (const id of sourceNodeIds) out.set(id, scoreOf(trace, id) / total);
  return out;
}

/** Split a parent's frozen weight across ring-derived children in proportion
 *  to each proposed ring's expected contribution. Conserving weight exactly
 *  is what makes "decomposition leaves the bar unchanged" true rather than
 *  approximate. */
export function distributeWeight(
  parentWeight: number,
  contributions: number[],
): number[] {
  if (contributions.length === 0) return [];
  const total = contributions.reduce((a, c) => a + (c > 0 ? c : 0), 0);
  if (total <= 0) {
    return contributions.map(() => parentWeight / contributions.length);
  }
  return contributions.map((c) => (parentWeight * (c > 0 ? c : 0)) / total);
}

/** The phantom denominator: aligned nodes carrying real root_score that sit
 *  below the spawn threshold, so they never became questions. Counting them
 *  stops every discovery from lurching the bar. */
export function unaskedWeight(
  trace: Trace,
  askedNodeIds: Set<string>,
  spawnThreshold: number,
): number {
  let sum = 0;
  for (const [id, t] of trace) {
    if (askedNodeIds.has(id)) continue;
    if (t.causal_depth === null) continue;
    const s = t.root_score;
    if (typeof s !== "number" || s <= 0) continue;
    if (s >= spawnThreshold) continue;
    sum += s;
  }
  return sum;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/maturity/weight.ts src/lib/maturity/__tests__/weight.test.ts
git commit -m "feat(maturity): derive frozen question weight from root_score"
```

---

### Task 5: Arc 1 — pure drain math

**Files:**
- Create: `src/lib/maturity/drain.ts`
- Create: `src/lib/maturity/__tests__/drain.test.ts`

**Interfaces:**
- Consumes: `QuestionState` (Task 1)
- Produces: `RESIDUAL_FLOOR`, `drainFraction(state)`, `computeDrain(residual, state, share)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/maturity/__tests__/drain.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeDrain, drainFraction, RESIDUAL_FLOOR } from "../drain";

describe("drain fraction mirrors stateScore", () => {
  it("matches the maturity state scores", () => {
    expect(drainFraction("open")).toBe(0);
    expect(drainFraction("explored")).toBe(0.5);
    expect(drainFraction("resolved")).toBe(1);
  });
});

describe("computeDrain", () => {
  it("halves the drainable gap on explored", () => {
    // drainable = 0.65 - 0.05 = 0.60; half = 0.30
    expect(computeDrain(0.65, "explored", 1)).toBeCloseTo(0.35, 5);
  });

  it("lands exactly on the floor on resolved with a full share", () => {
    expect(computeDrain(0.65, "resolved", 1)).toBe(RESIDUAL_FLOOR);
  });

  it("scales by the node's share of a multi-source question", () => {
    // drainable 0.60, share 0.25 → drop 0.15
    expect(computeDrain(0.65, "resolved", 0.25)).toBeCloseTo(0.5, 5);
  });

  it("never moves on open", () => {
    expect(computeDrain(0.65, "open", 1)).toBe(0.65);
  });

  it("never writes below the floor", () => {
    expect(computeDrain(0.05, "resolved", 1)).toBe(RESIDUAL_FLOOR);
    expect(computeDrain(0.01, "resolved", 1)).toBe(RESIDUAL_FLOOR);
  });

  it("clamps a share outside 0..1", () => {
    expect(computeDrain(0.65, "resolved", 5)).toBe(RESIDUAL_FLOOR);
    expect(computeDrain(0.65, "resolved", -1)).toBe(0.65);
  });

  it("is idempotent — draining an already-drained node is a no-op", () => {
    const once = computeDrain(0.65, "resolved", 1);
    expect(computeDrain(once, "resolved", 1)).toBe(once);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/maturity/__tests__/drain.test.ts`
Expected: FAIL — cannot resolve `../drain`.

- [ ] **Step 3: Implement**

Create `src/lib/maturity/drain.ts`:

```ts
// ── Arc 1: resolving a question cools the map ─────────────────────────
//
// The drain mirrors stateScore exactly (open 0, explored 0.5, resolved 1).
// That is what makes "the map and the bar are the same signal viewed two
// ways" provable rather than aspirational: the same fraction that moves the
// bar moves the node.
//
// Pure. No I/O, no React. apply-drain.ts handles persistence.

import type { QuestionState } from "./types";

/** Existing floor from signature-materializer.ts:919. A node never reads as
 *  fully certain — 0.05 is "saturated", not "known". */
export const RESIDUAL_FLOOR = 0.05;

/** Mirrors stateScore in compute.ts. Kept as its own function so a change to
 *  one without the other is a visible edit rather than silent drift. */
export function drainFraction(state: QuestionState): number {
  switch (state) {
    case "resolved":
      return 1;
    case "explored":
      return 0.5;
    case "open":
      return 0;
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** The node's new residual_uncertainty after a question reaches `state`.
 *
 *  `share` is this node's fraction of the question (see nodeShares), so a
 *  question pointing at four nodes does not fully drain all four. Idempotent:
 *  re-running on an already-drained value returns the same value, so a retry
 *  after a partial failure cannot double-drain. */
export function computeDrain(
  residual: number,
  state: QuestionState,
  share: number,
): number {
  const drainable = Math.max(0, residual - RESIDUAL_FLOOR);
  const next = residual - drainable * drainFraction(state) * clamp01(share);
  return Math.max(RESIDUAL_FLOOR, next);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/maturity/drain.ts src/lib/maturity/__tests__/drain.test.ts
git commit -m "feat(maturity): pure drain math for arc 1"
```

---

### Task 6: Arc 1 — persist the drain as a ring

**Files:**
- Modify: `src/types/node-signature.ts` (the `BasisEvidence.source` union)
- Create: `src/lib/maturity/apply-drain.ts`
- Create: `src/lib/maturity/__tests__/apply-drain.test.ts`

**Interfaces:**
- Consumes: `computeDrain`, `RESIDUAL_FLOOR` (Task 5); `nodeShares` (Task 4); `persistSignature`, `emitSignatureDeepened` from `@/lib/pipeline/signature-materializer`
- Produces: `buildDrainRing(sig, question, newResidual)`, `applyQuestionDrain(db, runId, input)` returning `{ drained: string[]; failed: string[] }`

- [ ] **Step 1: Widen the BasisEvidence source union**

In `src/types/node-signature.ts`, change:

```ts
export interface BasisEvidence {
  basis_index: number;
  source:
    | "entity"
    | "edge"
    | "expansion"
    | "axis"
    | "cross_space_link"
    | "llm_inference"
    /** A global question resolving — the ring records which question drained
     *  this node, so "why did this cool?" is answerable from the signature. */
    | "question";
  source_ids: string[];
  claim: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/maturity/__tests__/apply-drain.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildDrainRing } from "../apply-drain";
import { RESIDUAL_FLOOR } from "../drain";
import type { NodeSignature } from "@/types/node-signature";

function sig(o: Partial<NodeSignature> = {}): NodeSignature {
  return {
    entity_id: "e1",
    canonical_code: "c1",
    rings: 1,
    basis: [
      {
        index: 0,
        code: "cat",
        label: "Category",
        source_axis: null,
        contribution: 0.2,
        confidence: 0.9,
        controllability: "indirect",
      },
    ],
    evidence: [],
    resolution: { zoom: 1, horizon: "days", pinned_because: "budget" },
    residual_uncertainty: 0.65,
    composes_with: [],
    consequence_surface: [],
    materialized_at: "2026-07-23T00:00:00.000Z",
    version: 1,
    ...o,
  } as NodeSignature;
}

describe("buildDrainRing", () => {
  const q = { id: "q1", prompt: "Who is this for?", state: "resolved" as const };

  it("appends exactly one ring and keeps basis.length === rings", () => {
    const next = buildDrainRing(sig(), q, 0.35);
    expect(next.basis).toHaveLength(2);
    expect(next.rings).toBe(2);
    expect(next.basis[1].index).toBe(1);
  });

  it("records contribution as the uncertainty actually removed", () => {
    const next = buildDrainRing(sig(), q, 0.35);
    expect(next.basis[1].contribution).toBeCloseTo(0.3, 5);
  });

  it("cites the question in the evidence trace", () => {
    const next = buildDrainRing(sig(), q, 0.35);
    const ev = next.evidence.find((e) => e.basis_index === 1);
    expect(ev?.source).toBe("question");
    expect(ev?.source_ids).toEqual(["q1"]);
    expect(ev?.claim).toContain("Who is this for?");
  });

  it("writes the new residual and bumps the version", () => {
    const next = buildDrainRing(sig(), q, 0.35);
    expect(next.residual_uncertainty).toBe(0.35);
    expect(next.version).toBe(2);
  });

  it("marks the node saturated once it reaches the floor", () => {
    const next = buildDrainRing(sig(), q, RESIDUAL_FLOOR);
    expect(next.resolution.pinned_because).toBe("saturated");
  });

  it("leaves pinned_because alone above the floor", () => {
    const next = buildDrainRing(sig(), q, 0.35);
    expect(next.resolution.pinned_because).toBe("budget");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/maturity/__tests__/apply-drain.test.ts`
Expected: FAIL — cannot resolve `../apply-drain`.

- [ ] **Step 4: Implement**

Create `src/lib/maturity/apply-drain.ts`:

```ts
// ── Arc 1 persistence ─────────────────────────────────────────────────
//
// Writes a drain as a real ring so the map's cooling is auditable: clicking
// the ring answers "why did this cool?" with the question that did it.
//
// Soft-fail throughout. A failed signature write logs and is reported in
// `failed`; the caller still advances the question. We never block a user on
// a graph write.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NodeSignature, BasisElement } from "@/types/node-signature";
import {
  persistSignature,
  emitSignatureDeepened,
} from "@/lib/pipeline/signature-materializer";
import { computeDrain, RESIDUAL_FLOOR } from "./drain";
import { nodeShares } from "./weight";
import type { QuestionState } from "./types";
import type { EntityTraceResult } from "@/lib/pipeline/root-tracer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any> | any;

export interface DrainQuestion {
  id: string;
  prompt: string;
  state: QuestionState;
}

/** Pure: the signature a node should have after `question` drained it to
 *  `newResidual`. Appends one ring; preserves the basis.length === rings
 *  invariant from node-signature.ts. */
export function buildDrainRing(
  sig: NodeSignature,
  question: DrainQuestion,
  newResidual: number,
): NodeSignature {
  const index = sig.basis.length;
  const contribution = Math.max(0, sig.residual_uncertainty - newResidual);

  const ring: BasisElement = {
    index,
    code: `q${index}`,
    label: question.prompt.slice(0, 60),
    source_axis: null,
    contribution,
    confidence: question.state === "resolved" ? 1 : 0.5,
    controllability: "direct",
  };

  return {
    ...sig,
    rings: index + 1,
    basis: [...sig.basis, ring],
    evidence: [
      ...sig.evidence,
      {
        basis_index: index,
        source: "question",
        source_ids: [question.id],
        claim: `Answered by: ${question.prompt}`,
      },
    ],
    residual_uncertainty: newResidual,
    resolution:
      newResidual <= RESIDUAL_FLOOR
        ? { ...sig.resolution, pinned_because: "saturated" }
        : sig.resolution,
    version: sig.version + 1,
  };
}

export interface ApplyDrainInput {
  question: DrainQuestion;
  /** Signatures for the question's source nodes, keyed by entity id. */
  signatures: Map<string, NodeSignature>;
  /** Trace captured at question creation — used only for share weighting. */
  trace: Map<string, EntityTraceResult>;
  sourceNodeIds: string[];
}

/** Drains every source node of a question. Idempotent per (question, state):
 *  computeDrain on an already-drained residual returns the same value, so a
 *  retry cannot double-drain. */
export async function applyQuestionDrain(
  db: AnyDb,
  runId: string | null,
  input: ApplyDrainInput,
): Promise<{ drained: string[]; failed: string[] }> {
  const { question, signatures, trace, sourceNodeIds } = input;
  const shares = nodeShares(sourceNodeIds, trace);
  const drained: string[] = [];
  const failed: string[] = [];

  for (const entityId of sourceNodeIds) {
    const sig = signatures.get(entityId);
    if (!sig) {
      console.warn("[maturity_drain] no signature for entity:", entityId);
      failed.push(entityId);
      continue;
    }

    const newResidual = computeDrain(
      sig.residual_uncertainty,
      question.state,
      shares.get(entityId) ?? 0,
    );
    if (newResidual === sig.residual_uncertainty) continue;

    const next = buildDrainRing(sig, question, newResidual);
    const ok = await persistSignature(db, entityId, next);
    if (!ok) {
      failed.push(entityId);
      continue;
    }

    try {
      await emitSignatureDeepened(db, runId, next, next.basis[next.basis.length - 1]);
    } catch (err) {
      console.warn("[maturity_drain] event emit failed (non-fatal):", err);
    }
    drained.push(entityId);
  }

  return { drained, failed };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: tests PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/types/node-signature.ts src/lib/maturity/apply-drain.ts src/lib/maturity/__tests__/apply-drain.test.ts
git commit -m "feat(maturity): persist question drain as an auditable ring"
```

---

### Task 7: Criteria evaluators

**Files:**
- Create: `src/lib/maturity/criteria.ts`
- Create: `src/lib/maturity/__tests__/criteria.test.ts`

**Interfaces:**
- Consumes: `Criterion`, `CriterionId` (Task 1); `DEFAULT_TRIANGULATION_POLICY`, `detectTriangulationGap` from `@/lib/research/triangulation-gap-detector`; `DecompositionQualityReport` from `@/lib/decomposition-quality`
- Produces: `evaluateCriteria(input): Criterion[]`, `type CriteriaInput`

- [ ] **Step 1: Write the failing test**

Create `src/lib/maturity/__tests__/criteria.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluateCriteria, type CriteriaInput } from "../criteria";

function input(o: Partial<CriteriaInput> = {}): CriteriaInput {
  return {
    linkedClaimCount: 0,
    supporters: [],
    adversarialRan: false,
    survivingContradictions: 0,
    quality: null,
    newNodeAlignment: [],
    ...o,
  };
}

function statusOf(cs: ReturnType<typeof evaluateCriteria>, id: string) {
  return cs.find((c) => c.id === id)?.status;
}

describe("evaluateCriteria", () => {
  it("always returns all five, in order", () => {
    const cs = evaluateCriteria(input());
    expect(cs.map((c) => c.id)).toEqual([
      "coverage", "triangulation", "adversarial", "graph_quality", "alignment",
    ]);
  });

  it("meets coverage once a claim is linked to the source node", () => {
    expect(statusOf(evaluateCriteria(input({ linkedClaimCount: 1 })), "coverage")).toBe("met");
    expect(statusOf(evaluateCriteria(input()), "coverage")).toBe("unmet");
  });

  it("meets triangulation on two distinct high-reliability supporters", () => {
    const supporters = [
      { url: "https://a.com/x", reliability: 0.8 },
      { url: "https://b.com/y", reliability: 0.9 },
    ];
    expect(statusOf(evaluateCriteria(input({ supporters })), "triangulation")).toBe("met");
  });

  it("does not count two quotes from the same source twice", () => {
    const supporters = [
      { url: "https://a.com/x", reliability: 0.8 },
      { url: "https://a.com/x", reliability: 0.8 },
    ];
    expect(statusOf(evaluateCriteria(input({ supporters })), "triangulation")).toBe("unmet");
  });

  it("ignores low-reliability supporters", () => {
    const supporters = [
      { url: "https://a.com/x", reliability: 0.4 },
      { url: "https://b.com/y", reliability: 0.5 },
    ];
    expect(statusOf(evaluateCriteria(input({ supporters })), "triangulation")).toBe("unmet");
  });

  it("marks adversarial contradicted when a contradiction survives", () => {
    const cs = evaluateCriteria(
      input({ adversarialRan: true, survivingContradictions: 1 }),
    );
    expect(statusOf(cs, "adversarial")).toBe("contradicted");
  });

  it("meets adversarial when the pass ran clean", () => {
    const cs = evaluateCriteria(input({ adversarialRan: true }));
    expect(statusOf(cs, "adversarial")).toBe("met");
  });

  it("leaves adversarial unmet when the pass never ran", () => {
    expect(statusOf(evaluateCriteria(input()), "adversarial")).toBe("unmet");
  });

  it("fails graph_quality when the delta needs a retry", () => {
    const quality = { retryRecommended: true, overall: 0.3 };
    expect(statusOf(evaluateCriteria(input({ quality })), "graph_quality")).toBe("unmet");
  });

  it("meets graph_quality on a clean delta", () => {
    const quality = { retryRecommended: false, overall: 0.8 };
    expect(statusOf(evaluateCriteria(input({ quality })), "graph_quality")).toBe("met");
  });

  it("meets alignment when every new node is on a causal trace", () => {
    const cs = evaluateCriteria(input({ newNodeAlignment: [2, 1] }));
    expect(statusOf(cs, "alignment")).toBe("met");
  });

  it("fails alignment when any new node is unreachable from a goal", () => {
    const cs = evaluateCriteria(input({ newNodeAlignment: [2, null] }));
    expect(statusOf(cs, "alignment")).toBe("unmet");
  });

  it("gives every criterion a non-empty user-facing detail line", () => {
    for (const c of evaluateCriteria(input())) {
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/maturity/__tests__/criteria.test.ts`
Expected: FAIL — cannot resolve `../criteria`.

- [ ] **Step 3: Implement**

Create `src/lib/maturity/criteria.ts`:

```ts
// ── The five criteria ─────────────────────────────────────────────────
//
// Pure over already-fetched inputs — the caller does the DB reads. That
// keeps this recomputable at any time and means criteria evaluation is
// never a blocking write.
//
// The same criteria drive two things: the checklist under each question,
// and (via routing.ts) which research pass runs next. One mechanism, so
// what the user sees missing is what the system goes after.

import {
  ALL_CRITERION_IDS,
  type Criterion,
  type CriterionStatus,
} from "./types";
import { DEFAULT_TRIANGULATION_POLICY } from "@/lib/research/triangulation-gap-detector";

export interface CriteriaInput {
  /** Claims produced by research and linked to this question's source node. */
  linkedClaimCount: number;
  /** Supporting evidence rows for those claims. */
  supporters: Array<{ url: string; reliability: number }>;
  /** Whether the adversarial pass has run for this question. */
  adversarialRan: boolean;
  /** Contradictions that survived the adversarial pass. */
  survivingContradictions: number;
  /** Quality report for the graph delta this question's research produced. */
  quality: { retryRecommended: boolean; overall: number } | null;
  /** `causal_depth` for each node this question's research added. */
  newNodeAlignment: Array<number | null>;
}

function mk(id: (typeof ALL_CRITERION_IDS)[number], status: CriterionStatus, detail: string): Criterion {
  return { id, status, detail };
}

/** Distinct high-reliability supporters. Three quotes from one paper count
 *  once — dedup by URL, matching triangulation-gap-detector. */
function distinctSupporters(
  supporters: Array<{ url: string; reliability: number }>,
): number {
  const seen = new Set<string>();
  for (const s of supporters) {
    if (s.reliability >= DEFAULT_TRIANGULATION_POLICY.highReliabilityThreshold) {
      seen.add(s.url);
    }
  }
  return seen.size;
}

export function evaluateCriteria(input: CriteriaInput): Criterion[] {
  const out: Criterion[] = [];

  // coverage
  out.push(
    input.linkedClaimCount > 0
      ? mk("coverage", "met", `${input.linkedClaimCount} findings point at this`)
      : mk("coverage", "unmet", "nothing found yet"),
  );

  // triangulation
  const distinct = distinctSupporters(input.supporters);
  const required = DEFAULT_TRIANGULATION_POLICY.requiredSupportCount;
  out.push(
    distinct >= required
      ? mk("triangulation", "met", `${distinct} separate sources agree`)
      : mk("triangulation", "unmet", `${distinct} of ${required} separate sources`),
  );

  // adversarial
  if (!input.adversarialRan) {
    out.push(mk("adversarial", "unmet", "not tried yet"));
  } else if (input.survivingContradictions > 0) {
    out.push(
      mk(
        "adversarial",
        "contradicted",
        `${input.survivingContradictions} findings point the other way`,
      ),
    );
  } else {
    out.push(mk("adversarial", "met", "nothing contradicts it"));
  }

  // graph_quality
  if (!input.quality) {
    out.push(mk("graph_quality", "unmet", "not checked yet"));
  } else if (input.quality.retryRecommended) {
    out.push(mk("graph_quality", "unmet", "the pieces don't hold together yet"));
  } else {
    out.push(mk("graph_quality", "met", "no loose ends"));
  }

  // alignment
  const unaligned = input.newNodeAlignment.filter((d) => d === null).length;
  if (input.newNodeAlignment.length === 0) {
    out.push(mk("alignment", "unmet", "nothing new to connect yet"));
  } else if (unaligned > 0) {
    out.push(mk("alignment", "unmet", `${unaligned} not connected to a goal`));
  } else {
    const depths = input.newNodeAlignment as number[];
    out.push(
      mk("alignment", "met", `${Math.min(...depths)} steps from your goal`),
    );
  }

  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/maturity/criteria.ts src/lib/maturity/__tests__/criteria.test.ts
git commit -m "feat(maturity): five machine-checked criteria evaluators"
```

---

### Task 8: Arc 2 — the alignment spawn gate

**Files:**
- Create: `src/lib/maturity/spawn.ts`
- Create: `src/lib/maturity/__tests__/spawn.test.ts`

**Interfaces:**
- Consumes: `EntityTraceResult` from `@/lib/pipeline/root-tracer`
- Produces: `SPAWN_THRESHOLD`, `MAX_SPAWN_PER_PASS`, `selectSpawnCandidates(input): SpawnDecision`

- [ ] **Step 1: Write the failing test**

Create `src/lib/maturity/__tests__/spawn.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  selectSpawnCandidates,
  MAX_SPAWN_PER_PASS,
  SPAWN_THRESHOLD,
} from "../spawn";
import type { EntityTraceResult } from "@/lib/pipeline/root-tracer";

function trace(
  entries: Array<[string, number | null, number | null]>,
): Map<string, EntityTraceResult> {
  const m = new Map<string, EntityTraceResult>();
  for (const [id, depth, score] of entries) {
    m.set(id, {
      entity_id: id,
      causal_depth: depth,
      converges_chains: [],
      is_root_candidate: false,
      root_score: score,
    });
  }
  return m;
}

afterEach(() => vi.restoreAllMocks());

describe("selectSpawnCandidates", () => {
  it("spawns for an aligned, hot, new node", () => {
    const t = trace([["a", 2, SPAWN_THRESHOLD + 0.1]]);
    const d = selectSpawnCandidates({ newEntityIds: ["a"], trace: t, quality: null });
    expect(d.spawn).toEqual(["a"]);
  });

  it("never spawns for a node unreachable from any goal", () => {
    const t = trace([["a", null, null]]);
    const d = selectSpawnCandidates({ newEntityIds: ["a"], trace: t, quality: null });
    expect(d.spawn).toEqual([]);
    expect(d.suppressed).toEqual(["a"]);
  });

  it("never spawns below the score threshold", () => {
    const t = trace([["a", 2, SPAWN_THRESHOLD - 0.01]]);
    const d = selectSpawnCandidates({ newEntityIds: ["a"], trace: t, quality: null });
    expect(d.spawn).toEqual([]);
  });

  it("suppresses everything when the delta needs a retry", () => {
    const t = trace([["a", 2, 0.9]]);
    const d = selectSpawnCandidates({
      newEntityIds: ["a"],
      trace: t,
      quality: { retryRecommended: true, overall: 0.2 },
    });
    expect(d.spawn).toEqual([]);
    expect(d.reason).toMatch(/hold together/i);
  });

  it("fails closed when the trace is empty", () => {
    const d = selectSpawnCandidates({ newEntityIds: ["a"], trace: new Map(), quality: null });
    expect(d.spawn).toEqual([]);
    expect(d.reason).toMatch(/no trace/i);
  });

  it("caps at MAX_SPAWN_PER_PASS, keeping the highest scores", () => {
    const t = trace([
      ["a", 1, 0.9], ["b", 1, 0.8], ["c", 1, 0.7], ["d", 1, 0.6],
    ]);
    const d = selectSpawnCandidates({
      newEntityIds: ["a", "b", "c", "d"], trace: t, quality: null,
    });
    expect(d.spawn).toHaveLength(MAX_SPAWN_PER_PASS);
    expect(d.spawn).toEqual(["a", "b", "c"]);
    expect(d.suppressed).toContain("d");
  });

  it("logs when the cap binds — a silent cap reads as full coverage", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const t = trace([
      ["a", 1, 0.9], ["b", 1, 0.8], ["c", 1, 0.7], ["d", 1, 0.6],
    ]);
    selectSpawnCandidates({ newEntityIds: ["a", "b", "c", "d"], trace: t, quality: null });
    expect(spy).toHaveBeenCalled();
  });

  it("does not log when the cap does not bind", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const t = trace([["a", 1, 0.9]]);
    selectSpawnCandidates({ newEntityIds: ["a"], trace: t, quality: null });
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/maturity/__tests__/spawn.test.ts`
Expected: FAIL — cannot resolve `../spawn`.

- [ ] **Step 3: Implement**

Create `src/lib/maturity/spawn.ts`:

```ts
// ── Arc 2: which new nodes become questions ───────────────────────────
//
// The anti-node-spam gate. A plausible-sounding but irrelevant node has no
// backward causal path to any goal, so causal_depth is null and it cannot
// become a question no matter how confident the LLM sounded. That is a graph
// filter, not a judgment call — which is the whole point.
//
// Fails closed: no trace means no questions. Spawning unaligned questions is
// worse than spawning none.
//
// Never reads object_links. Dependencies live on `edges`; a dependency
// recorded only as an object_link is invisible here by design.

import type { EntityTraceResult } from "@/lib/pipeline/root-tracer";

/** Minimum root_score for a new node to be worth asking about. Below this
 *  the node still counts in the unasked denominator (see weight.ts). */
export const SPAWN_THRESHOLD = 0.3;

/** Per-pass cap, so one productive research pass cannot collapse the bar. */
export const MAX_SPAWN_PER_PASS = 3;

export interface SpawnInput {
  newEntityIds: string[];
  trace: Map<string, EntityTraceResult>;
  quality: { retryRecommended: boolean; overall: number } | null;
}

export interface SpawnDecision {
  /** Entity ids that should become questions, highest root_score first. */
  spawn: string[];
  /** Entity ids considered and rejected. */
  suppressed: string[];
  /** Why nothing spawned, or why the set was trimmed. Null when unremarkable. */
  reason: string | null;
}

export function selectSpawnCandidates(input: SpawnInput): SpawnDecision {
  const { newEntityIds, trace, quality } = input;

  if (trace.size === 0) {
    return {
      spawn: [],
      suppressed: [...newEntityIds],
      reason: "no trace available — failing closed rather than spawning unaligned questions",
    };
  }

  if (quality?.retryRecommended) {
    return {
      spawn: [],
      suppressed: [...newEntityIds],
      reason: "we found things, but they didn't hold together",
    };
  }

  const eligible: Array<{ id: string; score: number }> = [];
  const suppressed: string[] = [];

  for (const id of newEntityIds) {
    const t = trace.get(id);
    const score = t?.root_score;
    if (!t || t.causal_depth === null || typeof score !== "number" || score < SPAWN_THRESHOLD) {
      suppressed.push(id);
      continue;
    }
    eligible.push({ id, score });
  }

  eligible.sort((a, b) => b.score - a.score);

  const capped = eligible.length > MAX_SPAWN_PER_PASS;
  const spawn = eligible.slice(0, MAX_SPAWN_PER_PASS).map((e) => e.id);
  for (const e of eligible.slice(MAX_SPAWN_PER_PASS)) suppressed.push(e.id);

  if (capped) {
    console.info(
      `[maturity_spawn] cap bound: ${eligible.length} eligible, ${MAX_SPAWN_PER_PASS} spawned, ${eligible.length - MAX_SPAWN_PER_PASS} deferred`,
    );
  }

  return {
    spawn,
    suppressed,
    reason: capped ? `capped at ${MAX_SPAWN_PER_PASS} of ${eligible.length} eligible` : null,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/maturity/spawn.ts src/lib/maturity/__tests__/spawn.test.ts
git commit -m "feat(maturity): arc 2 alignment gate — causal_depth decides what becomes a question"
```

---

### Task 9: Arc 3 — criteria steer the next pass

**Files:**
- Create: `src/lib/maturity/routing.ts`
- Create: `src/lib/maturity/__tests__/routing.test.ts`

**Interfaces:**
- Consumes: `GlobalQuestion`, `criterionStatus` (Tasks 1, 3); `PassKind` from `@/lib/pipeline/research-depth-engine`
- Produces: `nextPassFromCriteria(questions): CriteriaRoute | null`, `type CriteriaRoute`

- [ ] **Step 1: Write the failing test**

Create `src/lib/maturity/__tests__/routing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextPassFromCriteria } from "../routing";
import { ALL_CRITERION_IDS, type Criterion, type CriterionId, type GlobalQuestion } from "../types";

function crit(met: CriterionId[]): Criterion[] {
  return ALL_CRITERION_IDS.map((id) => ({
    id,
    status: met.includes(id) ? ("met" as const) : ("unmet" as const),
    detail: "",
  }));
}

function q(id: string, met: CriterionId[], weight = 1): GlobalQuestion {
  return {
    id,
    prompt: id,
    state: "open",
    weight,
    evidence: { criteria: crit(met), userAnswer: false, confirmed: false },
    sourceNodeIds: [`n-${id}`],
  };
}

describe("nextPassFromCriteria", () => {
  it("routes an unmet coverage to a focused breadth pass", () => {
    const r = nextPassFromCriteria([q("a", [])]);
    expect(r?.kind).toBe("outcome_breadth");
    expect(r?.focusNodeIds).toEqual(["n-a"]);
  });

  it("routes to triangulation once coverage is met", () => {
    expect(nextPassFromCriteria([q("a", ["coverage"])])?.kind).toBe("triangulation");
  });

  it("routes to adversarial once coverage and triangulation are met", () => {
    expect(
      nextPassFromCriteria([q("a", ["coverage", "triangulation"])])?.kind,
    ).toBe("adversarial");
  });

  it("returns null when every criterion on every question is met", () => {
    expect(nextPassFromCriteria([q("a", ALL_CRITERION_IDS)])).toBe(null);
  });

  it("returns null for no questions", () => {
    expect(nextPassFromCriteria([])).toBe(null);
  });

  it("picks the heaviest question when several have the same gap", () => {
    const r = nextPassFromCriteria([q("light", [], 1), q("heavy", [], 5)]);
    expect(r?.focusNodeIds).toEqual(["n-heavy"]);
  });

  it("does not route on graph_quality or alignment — no pass kind fixes those", () => {
    const r = nextPassFromCriteria([
      q("a", ["coverage", "triangulation", "adversarial"]),
    ]);
    expect(r).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/maturity/__tests__/routing.test.ts`
Expected: FAIL — cannot resolve `../routing`.

- [ ] **Step 3: Implement**

Create `src/lib/maturity/routing.ts`:

```ts
// ── Arc 3: unmet criteria are the research loop's objective function ───
//
// The piece that actually closes the loop. Before this, the research engine
// picked its next pass from claim-level continuation signals while the heat
// map ranked nodes independently — two reasoners that never read each other.
//
// Only three criteria route: a research pass can produce coverage, add
// independent sources, or look for contradictions. Nothing a pass does fixes
// graph_quality or alignment — those are properties of the delta and are
// handled by the spawn gate instead. Returning null for them is correct.

import { criterionStatus } from "./compute";
import type { GlobalQuestion } from "./types";
import type { PassKind } from "@/lib/pipeline/research-depth-engine";

export interface CriteriaRoute {
  kind: PassKind;
  /** Source nodes of the question that motivated this pass. */
  focusNodeIds: string[];
  /** The question driving it — for telemetry and the "why this pass?" line. */
  questionId: string;
}

/** Ordered: you cannot triangulate what you have not covered, and arguing
 *  against a claim with one source is noise. */
const ROUTE_ORDER: Array<{ id: "coverage" | "triangulation" | "adversarial"; kind: PassKind }> = [
  { id: "coverage", kind: "outcome_breadth" },
  { id: "triangulation", kind: "triangulation" },
  { id: "adversarial", kind: "adversarial" },
];

/** The next pass to run, or null when every routable criterion is met.
 *  Null means "the criteria are satisfied" — the caller's circuit breakers
 *  remain the outer bound and are not relaxed by this. */
export function nextPassFromCriteria(
  questions: GlobalQuestion[],
): CriteriaRoute | null {
  for (const { id, kind } of ROUTE_ORDER) {
    const gap = questions
      .filter((q) => criterionStatus(q.evidence, id) !== "met")
      .sort((a, b) => b.weight - a.weight)[0];
    if (gap) {
      return { kind, focusNodeIds: gap.sourceNodeIds, questionId: gap.id };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/maturity/routing.ts src/lib/maturity/__tests__/routing.test.ts
git commit -m "feat(maturity): arc 3 — unmet criteria select the next research pass"
```

---

### Task 10: Wire routing into shouldContinueResearch

**Files:**
- Modify: `src/lib/pipeline/research-depth-engine.ts:228-...` (`shouldContinueResearch`)
- Create: `src/lib/pipeline/__tests__/research-depth-engine.test.ts`

**Interfaces:**
- Consumes: `nextPassFromCriteria` (Task 9)
- Produces: `shouldContinueResearch(plan, lastPassResult, criteriaRoute?)` — a third optional parameter; existing two-argument call sites keep working unchanged

- [ ] **Step 1: Write the failing test**

Create `src/lib/pipeline/__tests__/research-depth-engine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  createDepthPlan,
  shouldContinueResearch,
  type PassResult,
} from "../research-depth-engine";

function result(o: Partial<PassResult> = {}): PassResult {
  return { external_entities: [{ name: "e1" }], ...o };
}

describe("shouldContinueResearch with criteria routing", () => {
  it("halts when max passes is reached, regardless of unmet criteria", () => {
    const plan = createDepthPlan("light");
    plan.passes_completed = [{} as never];
    const d = shouldContinueResearch(plan, result(), {
      kind: "triangulation",
      focusNodeIds: ["n1"],
      questionId: "q1",
    });
    expect(d.continue).toBe(false);
    expect(d.reason).toMatch(/max passes/i);
  });

  it("halts when the search budget is exhausted, regardless of criteria", () => {
    const plan = createDepthPlan("standard");
    plan.searches_used = plan.total_search_budget;
    const d = shouldContinueResearch(plan, result(), {
      kind: "adversarial",
      focusNodeIds: ["n1"],
      questionId: "q1",
    });
    expect(d.continue).toBe(false);
    expect(d.reason).toMatch(/budget/i);
  });

  it("continues on an unmet criterion even with no new entities", () => {
    const plan = createDepthPlan("deep");
    const d = shouldContinueResearch(plan, result({ external_entities: [] }), {
      kind: "triangulation",
      focusNodeIds: ["n1"],
      questionId: "q1",
    });
    expect(d.continue).toBe(true);
    expect(d.next_pass_kind).toBe("triangulation");
  });

  it("halts when criteria are satisfied and nothing new was found", () => {
    const plan = createDepthPlan("deep");
    const d = shouldContinueResearch(plan, result({ external_entities: [] }), null);
    expect(d.continue).toBe(false);
  });

  it("behaves exactly as before when no route is supplied", () => {
    const plan = createDepthPlan("deep");
    const withArg = shouldContinueResearch(plan, result({ external_entities: [] }), null);
    const plan2 = createDepthPlan("deep");
    const without = shouldContinueResearch(plan2, result({ external_entities: [] }));
    expect(without.continue).toBe(withArg.continue);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/pipeline/__tests__/research-depth-engine.test.ts`
Expected: FAIL — `shouldContinueResearch` takes two arguments.

- [ ] **Step 3: Implement**

In `src/lib/pipeline/research-depth-engine.ts`, add the import:

```ts
import type { CriteriaRoute } from "@/lib/maturity/routing";
```

**Note on the cycle:** `routing.ts` imports `PassKind` from this file, and this
file imports `CriteriaRoute` from `routing.ts`. Both are `import type`, so
TypeScript erases them and no runtime cycle exists. Do not "fix" this by
duplicating the `PassKind` union in `routing.ts` — a second copy would drift
the moment a new pass kind is added, and the exhaustiveness check in
`pass-kind-dispatcher.ts` would not catch it.

Change the signature:

```ts
export function shouldContinueResearch(
  plan: ResearchDepthPlan,
  lastPassResult: PassResult,
  /** Arc 3. When supplied, unmet criteria are the objective function: a gap
   *  keeps the loop alive and picks the pass kind. The circuit breakers above
   *  remain the outer bound — criteria never override them. Undefined
   *  preserves the pre-arc-3 behavior for call sites not yet migrated. */
  criteriaRoute?: CriteriaRoute | null,
): ContinuationDecision {
```

Then, immediately **after** circuit breakers 1 and 2 (max passes, search budget) and **before** breaker 3 (`No new entities and no critical/high continuation signals`), insert:

```ts
  // ── Arc 3: an unmet criterion is reason enough to keep going ──
  //
  // Placed after the hard budget breakers so criteria can never spend past
  // them, and before the no-new-entities breaker so a pass that found
  // nothing new still runs the triangulation/adversarial work a question is
  // waiting on.
  if (criteriaRoute) {
    return {
      continue: true,
      reason: `Unmet criterion on question ${criteriaRoute.questionId}`,
      next_pass_type: "deepening",
      next_pass_kind: criteriaRoute.kind,
      focus_queries: [],
    };
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: tests PASS, tsc clean. Existing two-argument call sites still compile because the parameter is optional.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/research-depth-engine.ts src/lib/pipeline/__tests__/
git commit -m "feat(research): criteria gaps keep the loop alive and pick the next pass kind"
```

---

### Task 11: The global_questions table

**Files:**
- Create: `supabase/migrations/20261012_global_questions.sql`

**Interfaces:**
- Consumes: nothing
- Produces: the `global_questions` table

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261012_global_questions.sql`:

```sql
-- ── Global open questions (double-diamond remodel, issue #17) ─────────
--
-- The question spine of the maturity model. Distinct from entity_questions
-- (20260417), which stays as-is for user-authored node questions:
--   • multiple source nodes, not a single entity_id FK
--   • three-state lifecycle (open/explored/resolved), not four
--   • carries frozen weight + the five machine-checked criteria
--
-- Each row traces to the uncertainty hot spot(s) it was derived from, so
-- resolving it can drain those nodes' residual_uncertainty and cool the map.

create table if not exists global_questions (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces(id) on delete cascade,
  user_id        uuid not null,
  prompt         text not null,
  state          text not null default 'open'
    check (state in ('open', 'explored', 'resolved')),
  -- Frozen root_score sum at creation (× 2 when critical). NEVER recomputed
  -- from live uncertainty — a weight that tracked residual would shrink as
  -- its own question resolved and the bar would chase itself.
  weight         numeric not null default 1,
  is_critical    boolean not null default false,
  -- The uncertainty hot spot(s) this question came from. Not an FK array —
  -- entities can be pruned without orphaning the question's history.
  source_node_ids uuid[] not null default '{}',
  -- Criterion[] — [{ id, status, detail }]. Recomputable at any time from
  -- persisted rows, so this is a cache, never a source of truth.
  criteria       jsonb not null default '[]'::jsonb,
  user_answer    text,
  confirmed      boolean not null default false,
  -- Ring-derived decomposition. A question with children is excluded from
  -- the maturity average; its children are counted instead.
  parent_id      uuid references global_questions(id) on delete cascade,
  -- Breadcrumb: the question whose research surfaced this one. Display only.
  derived_from   uuid references global_questions(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index if not exists global_questions_space  on global_questions (space_id);
create index if not exists global_questions_state  on global_questions (space_id, state);
create index if not exists global_questions_parent on global_questions (parent_id);

alter table global_questions enable row level security;

drop policy if exists global_questions_owner on global_questions;
create policy global_questions_owner on global_questions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function touch_global_questions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists global_questions_updated_at on global_questions;
create trigger global_questions_updated_at
  before update on global_questions
  for each row execute function touch_global_questions_updated_at();
```

- [ ] **Step 2: Verify the migration applies**

Run: `npm run db:push`
Expected: applies cleanly. If Supabase is not linked in this environment, run `npx supabase db lint --schema public` instead and report that push was not possible.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261012_global_questions.sql
git commit -m "feat(db): global_questions table for the maturity spine"
```

---

### Task 12: Guard invariants with tests

The two invariants from the spec that are easy to violate silently in later work.

**Files:**
- Create: `src/lib/maturity/__tests__/invariants.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: nothing — this task is a ratchet

- [ ] **Step 1: Write the tests**

Create `src/lib/maturity/__tests__/invariants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MATURITY_DIR = join(process.cwd(), "src/lib/maturity");

function sources(): string[] {
  return readdirSync(MATURITY_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join(MATURITY_DIR, f), "utf8"));
}

describe("spec invariants", () => {
  it("the question path never reads object_links", () => {
    for (const src of sources()) {
      expect(src).not.toMatch(/object_links/);
    }
  });

  it("the question path never imports the retired ambiguity zones", () => {
    for (const src of sources()) {
      expect(src).not.toMatch(/AMBIGUITY_ZONES/);
    }
  });

  it("nothing writes a residual below the floor", () => {
    // The single source of the floor. If a second literal 0.05 appears in a
    // residual assignment, this test is the place to catch it.
    const drain = readFileSync(join(MATURITY_DIR, "drain.ts"), "utf8");
    expect(drain).toMatch(/export const RESIDUAL_FLOOR = 0\.05/);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/lib/maturity/__tests__/invariants.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the whole suite and typecheck**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/maturity/__tests__/invariants.test.ts
git commit -m "test(maturity): ratchet the object_links and ambiguity-zone invariants"
```

---

## Not in this plan

Deliberately deferred, each needing its own plan:

1. **UI layer.** The criteria checklist under each question, the saturation band on the bar, indented sub-questions, the "3 things surfaced since you unlocked this" review step. All of it consumes the functions built here.
2. **Repository + route wiring.** Reading/writing `global_questions`, calling `applyQuestionDrain` on state change, calling `selectSpawnCandidates` after a research pass, threading `nextPassFromCriteria` into `research/route.ts`, and calling `materializeSeedGraph` from `seed/route.ts`'s `sync_graph` action so the substrate grows as the seed does. This plan builds and tests the parts; wiring them into live request paths is the next plan and needs its own integration tests.

   Note the ordering consequence: until that wiring lands, Task 0.5 must be invoked by hand to verify anything end-to-end (see its Step 5).
3. **Ring-derived sub-question generation.** `distributeWeight` (Task 4) is the math; actually proposing children from `deepenNodeSignature` needs the logging-before-rendering step the spec calls for, so proposal quality can be judged on real output first.
4. **Retiring Engine A.** This plan stops nothing from reading `prompt-sharpening-prompt.ts`; deleting the 10 zones is its own commit.
5. **Surfacing `kg_communities`** as the grouping for findings.
