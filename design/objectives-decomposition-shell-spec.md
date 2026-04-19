# Build Spec: Objectives Decomposition Shell

Complete implementation spec for a single shared component that replaces the current `ObjectiveCommandCenter` / `ObjectivesTreeModule` / `ObjectiveOverviewBanner` rendering paths with one unified decomposition-tree shell matching the glass/mission-icon reference design.

---

## 1. File to create

**Path:** `src/components/objectives/objectives-decomposition-shell.tsx`

Single file containing the main component plus all sub-components. Exports:
- `ObjectivesDecompositionShell` (default-exported main component)
- `ObjectivesDecompositionShellProps` (exported type)

## 2. Files to modify (integration)

### 2a. `src/app/app/space/[id]/objectives/page.tsx`

Replace the whole body conditional (currently ~lines 72–114) with:

```tsx
return (
  <div className="h-full overflow-y-auto p-4">
    <ObjectivesDecompositionShell
      primaryGoal={ctx.activeGoal}
      allGoals={ctx.goalList}
      suggestedObjectives={suggestedObjectives}
      onAccept={handleAcceptObjective}
      onDecompose={async (goalId) => {
        await fetch(`/api/goals/${goalId}/sub-objectives`, { method: "POST" });
        ctx.refresh();
      }}
      onCreateSubSpace={async (goalId) => {
        const res = await fetch(`/api/goals/${goalId}/sub-space`, { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          router.push(`/app/space/${data.spaceId}`);
        }
      }}
      onNavigateToSpace={(spaceId) => router.push(`/app/space/${spaceId}`)}
      onGoalClick={ctx.setActiveGoal}
      variant="full"
      initiallyExpanded
    />
  </div>
);
```

Remove the `ObjectiveCommandCenter` and `ObjectivesTreeModule` imports from this page.

### 2b. `src/components/dashboard/dashboard-grid.tsx` (~lines 571–608)

Replace the three-way conditional inside `<div id="section-objectives">` with a single call:

```tsx
<div id="section-objectives">
  {hasSynthesis ? (
    <ObjectivesDecompositionShell
      primaryGoal={activeGoal}
      allGoals={goals}
      suggestedObjectives={suggestedObjectives}
      onAccept={onAcceptObjective ?? (() => {})}
      onDecompose={onBreakDownGoal ?? (() => {})}
      onCreateSubSpace={onCreateSubSpace ?? (() => {})}
      onNavigateToSpace={onNavigateToSpace ?? (() => {})}
      onGoalClick={onGoalClick ?? (() => {})}
      variant="full"
      initiallyExpanded={false}
    />
  ) : (
    <LockedModuleCard
      id=""
      icon={<Target className="h-4 w-4" />}
      title="Detected Objectives"
      description="AI-detected objectives organized as a decomposition tree."
      unlockAction="Run synthesis to auto-detect objectives"
    />
  )}
</div>
```

## 3. Prop interface

```ts
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";

export interface ObjectivesDecompositionShellProps {
  /** The active tracked goal (L1 root). If null, uses highest-priority pending objective as root. */
  primaryGoal: ImprovementGoal | null;

  /** Full flat list of accepted goals — used to walk the child tree. */
  allGoals: ImprovementGoal[];

  /** Pending suggestions from synthesis (not yet accepted). */
  suggestedObjectives: SuggestedObjective[];

  /** User accepts a suggestion — creates an ImprovementGoal. */
  onAccept?: (obj: SuggestedObjective) => void | Promise<void>;

  /** User requests sub-objective generation for an existing goal. */
  onDecompose?: (goalId: string) => void | Promise<void>;

  /** User drills into a dedicated sub-space for the goal. */
  onCreateSubSpace?: (goalId: string) => void | Promise<void>;

  /** Navigate to an existing space. */
  onNavigateToSpace?: (spaceId: string) => void;

  /** User clicks a goal card header to activate it. */
  onGoalClick?: (goal: ImprovementGoal) => void;

  /** "full" = header + body + tree. "compact" = header only (overview teaser). */
  variant?: "full" | "compact";

  /** Whether the body is open on mount. */
  initiallyExpanded?: boolean;
}
```

## 4. Data-mapping rules

These are computed inside the shell before rendering:

### Depth → Layer (L1/L2/L3)

| `depth` field | Layer | Kind label | Badge color |
|---|---|---|---|
| `fundamental` (or root goal) | **L1** | "Concept" | blue (`#1a7aff`) |
| `structural` | **L2** | "Relationship" | indigo (`#5856d6`) |
| `surface` | **L3** | "First-principle" | amber (`#ff9500`) |
| undefined on accepted goal | derive from parent depth + 1 | — | — |

For `ImprovementGoal` without a `depth` field, infer:
- Root goal (`parent_goal_id === null`) → L1
- Direct child of root → L2
- Grandchild or deeper → L3

### Objective type → Kind sub-label

| `objective_type` | L1 kind | L2 kind | L3 kind |
|---|---|---|---|
| `maximize` | Fundamental | Structural | Tactic |
| `minimize` | Fundamental | Risk | Tactic |
| `maintain` | Fundamental | Structural | Tactic |
| `explore` | Fundamental | Hypothesis | Tactic |
| `avoid` | Fundamental | Risk | Tactic |

### Source → Source tag chip

| Derived from | Tag color | Tag label |
|---|---|---|
| `SuggestedObjective.source_type === "open_question"` OR user-provided (e.g. manual goal, root objective) | green (`#1a9553`) | "User input" |
| `source_type` in `{leverage_point, risk_point, feedback_loop, bottleneck, scenario}` | blue (`#0051ff`) | "Derived concept" |
| `source_type` in `{external_insight, cross_context, worth_considering}` | purple (`#8e3bb8`) | "Research" |
| `external_evidence != null` | purple | "Research" (append alongside primary tag) |

### Confidence → numeric %

Use these midpoints so the bar looks meaningful:

```ts
function confidenceToPct(c: "high" | "moderate" | "low"): number {
  return c === "high" ? 90 : c === "moderate" ? 75 : 60;
}
```

If `SuggestedObjective.priority` is 1–6 with 1 being highest, optionally nudge by `± (6 - priority)` to differentiate cards. But don't overthink — `high` ≈ 85–94, `moderate` ≈ 70–84, `low` ≈ 55–69.

Bar color:
- ≥ 80: green gradient (`#2ad06d → #1aa055`)
- 65–79: amber gradient (`#ffb43b → #ff9500`)
- < 65: red/muted

### Convergence dots

Render `min(convergence_score ?? 0, 4)` filled dots plus `4 - n` empty dots. Text: `"{convergence_score} chains"`.

For the **header gauge**, compute aggregate convergence:
```ts
const allConvergences = allObjectives
  .map(o => o.convergence_score ?? 0)
  .filter(n => n > 0);
const avgConvergence = allConvergences.length > 0
  ? allConvergences.reduce((a, b) => a + b, 0) / allConvergences.length
  : 0;
const convergencePct = Math.min(100, Math.round((avgConvergence / 4) * 100));
```

### Title parsing for gradient number

When rendering the primary goal title, extract any numeric token (with commas/percent) and wrap it in the gradient span:

```ts
function parseTitleForNumber(title: string): {
  prefix: string; number: string | null; suffix: string;
} {
  // Match 1,000,000 or 1000 or 10% or $5M etc.
  const match = title.match(/([\d,]+(?:\.\d+)?[%Mk]?)/);
  if (!match) return { prefix: title, number: null, suffix: "" };
  const idx = title.indexOf(match[0]);
  return {
    prefix: title.slice(0, idx),
    number: match[0],
    suffix: title.slice(idx + match[0].length),
  };
}
```

### Days remaining

```ts
function daysRemaining(deadline: string | null): number | null {
  if (!deadline) return null;
  const d = new Date(deadline).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((d - now) / 86_400_000));
}
```

### Layer counts (for the L1/L2/L3 chips)

```ts
function countByLayer(objectives: Array<ImprovementGoal | SuggestedObjective>) {
  let l1 = 0, l2 = 0, l3 = 0;
  for (const o of objectives) {
    const d = "depth" in o ? o.depth : undefined;
    if (d === "fundamental" || !("depth" in o) && !o.parent_goal_id) l1++;
    else if (d === "structural") l2++;
    else l3++;
  }
  return { l1, l2, l3 };
}
```

### Sibling numbering (2.1, 2.2, a, b)

Build once when tree is constructed:
- L2 children get `"{parentIdx}.{siblingIdx}"` (e.g. `"2.1"`, `"2.3"`)
- L3 children get single letter `"a"`, `"b"`, `"c"` based on sibling index
- Tracked L1 shows a ✓ checkmark instead of a number

## 5. Component tree inside the file

```
ObjectivesDecompositionShell (main, default export)
├── MissionIcon              (58×58 dark tile, conic sweep, reticle SVG)
├── EyebrowStrip             (live green dot + "Primary Objective · N Detected · M Tracked")
├── TitleBlock               (gradient-clipped number inside plain text)
├── LayerChips               (L1 · n / L2 · n / L3 · n pills)
├── StatBlock                ("62d REMAINING" column)
├── ConvergenceGauge         (48×48 SVG with stroke-dasharray ring + center %)
├── ExpandButton             (44×44 blue gradient button, rotates on open)
├── ProgressStrip            (5px gradient bar, animated tracker dot)
├── FilterTabs               ("All" / "Tracked" / "L3 tactics")
├── Tree                     (relative positioned, padding-left 8)
│   ├── <svg> connector layer (absolute, computed via useLayoutEffect)
│   └── Node (recursive)
│       ├── NodeMarker       (40×40 for L1/L2, 32×32 for L3 — styled by layer + tracked)
│       └── NodeCard
│           ├── CardHeader   (BadgeIcon + "L1 · Concept" + kind + ConfidenceMini)
│           ├── CardTitle
│           ├── CardDesc
│           ├── KeyActionCallout  (only on L1 and when propellant present)
│           └── CardFoot
│               ├── SourceTag (possibly multiple)
│               ├── ConvDots   (filled/empty depending on convergence_score)
│               └── TrackButton (varies: "+ Track" / "Tracked" / "Accept" for suggestions)
```

## 6. SVG connector algorithm

Use `useLayoutEffect` + `ResizeObserver` + refs on each marker.

```tsx
const treeRef = useRef<HTMLDivElement>(null);
const markerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
const [paths, setPaths] = useState<Array<{ d: string; level: 2 | 3; key: string }>>([]);

useLayoutEffect(() => {
  if (!treeRef.current) return;

  const compute = () => {
    const rootRect = treeRef.current!.getBoundingClientRect();
    const next: Array<{ d: string; level: 2 | 3; key: string }> = [];

    for (const [nodeId, marker] of markerRefs.current) {
      const parentId = parentIdOf(nodeId);               // from your tree data
      if (!parentId) continue;
      const parent = markerRefs.current.get(parentId);
      if (!parent) continue;

      const p = parent.getBoundingClientRect();
      const c = marker.getBoundingClientRect();

      const startX = p.left - rootRect.left + p.width / 2;
      const startY = p.bottom - rootRect.top + 2;
      const endX = c.left - rootRect.left + c.width / 2;
      const endY = c.top - rootRect.top + c.height / 2;
      const R = 12;
      const turnY = endY - R;
      const d = `M ${startX} ${startY} L ${startX} ${turnY} Q ${startX} ${endY} ${startX + R} ${endY} L ${endX - 14} ${endY}`;

      next.push({ d, level: levelOf(nodeId) as 2 | 3, key: nodeId });
    }

    setPaths(next);
  };

  compute();
  const ro = new ResizeObserver(compute);
  ro.observe(treeRef.current);
  window.addEventListener("resize", compute);
  return () => {
    ro.disconnect();
    window.removeEventListener("resize", compute);
  };
}, [/* deps: expandedState, filteredNodes, tree structure */]);
```

Render:

```tsx
<svg className="absolute inset-0 w-full h-full pointer-events-none z-0" style={{ overflow: "visible" }}>
  <defs>
    <linearGradient id="pathL2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#1a7aff" stopOpacity="0.9" />
      <stop offset="100%" stopColor="#5856d6" stopOpacity="0.7" />
    </linearGradient>
    <linearGradient id="pathL3" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#5856d6" stopOpacity="0.8" />
      <stop offset="100%" stopColor="#ff9500" stopOpacity="0.7" />
    </linearGradient>
  </defs>
  {paths.map(p => (
    <path
      key={p.key}
      d={p.d}
      fill="none"
      stroke={p.level === 2 ? "url(#pathL2)" : "url(#pathL3)"}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeDasharray="4 5"
      opacity={0.65}
    />
  ))}
</svg>
```

Also force a recompute after the expand-body animation finishes by adding `transitionend` handler on the body element.

## 7. Copy-ready style tokens

Define these inside the component file as plain constants. Use Tailwind for layout, inline `style` objects for the complex gradients/shadows that Tailwind doesn't express cleanly.

```ts
const S = {
  // Mission icon
  missionIconBg: "linear-gradient(145deg, #0a1020 0%, #1f2d5a 55%, #0051ff 110%)",
  missionIconShadow:
    "inset 0 1px 0 rgba(255,255,255,0.25), 0 12px 32px rgba(0,30,140,0.35), 0 4px 12px rgba(0,30,140,0.2)",
  missionSweep:
    "conic-gradient(from 0deg, rgba(79,163,255,0) 0deg, rgba(79,163,255,0.5) 60deg, rgba(79,163,255,0) 120deg)",

  // Goal number gradient (background-clip: text)
  numberGradient: "linear-gradient(180deg, #0a56d6 20%, #1a7aff 100%)",
  numberDropshadow: "drop-shadow(0 2px 8px rgba(10,90,230,0.25))",

  // Expand button
  expandBtnBg: "linear-gradient(180deg, #2d8cff, #0051ff)",
  expandBtnShadow:
    "0 10px 24px rgba(0,90,255,0.38), inset 0 1px 0 rgba(255,255,255,0.5)",

  // Track button — tracked (green)
  trackedBg: "rgba(42,208,109,0.15)",
  trackedBorder: "rgba(42,208,109,0.35)",
  trackedColor: "#1a9553",

  // Track button — untracked (blue)
  trackBg: "linear-gradient(180deg, #2d8cff, #0051ff)",
  trackShadow:
    "0 6px 14px rgba(0,90,255,0.32), inset 0 1px 0 rgba(255,255,255,0.4)",

  // Progress strip
  progressFill:
    "linear-gradient(90deg, #4fa3ff 0%, #0051ff 60%, #5856d6 100%)",
  progressGlow: "0 0 16px rgba(26,122,255,0.5)",

  // Module shell — glass
  shellBg: "rgba(255, 255, 255, 0.82)",          // fallback when no colored bg
  shellBgGlass: "rgba(255, 255, 255, 0.22)",      // over colored bg
  shellBorder: "1px solid rgba(255, 255, 255, 0.85)",
  shellShadow:
    "0 40px 100px -30px rgba(8,60,180,0.28), 0 18px 40px -18px rgba(8,60,180,0.18), inset 0 1.5px 0 rgba(255,255,255,1), inset 0 0 0 1px rgba(255,255,255,0.35)",
  shellShadowExpanded:
    "0 60px 140px -40px rgba(8,60,180,0.36), 0 24px 60px -24px rgba(8,60,180,0.24), inset 0 1.5px 0 rgba(255,255,255,1), inset 0 0 0 1px rgba(255,255,255,0.45)",

  // Node card
  cardBg: "rgba(255,255,255,0.65)",               // pragmatic: less glass for readability
  cardBorder: "1px solid rgba(255,255,255,0.9)",
  cardShadow:
    "0 10px 28px -12px rgba(8,60,180,0.18), inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(255,255,255,0.3)",

  // Layer badge backgrounds
  l1Bg: "rgba(26,122,255,0.15)",  l1Color: "#0051ff",
  l2Bg: "rgba(88,86,214,0.15)",   l2Color: "#3c44d9",
  l3Bg: "rgba(255,149,0,0.18)",   l3Color: "#c77400",

  // Key action (propellant)
  kaBg: "linear-gradient(180deg, rgba(255,220,175,0.55), rgba(255,200,150,0.42))",
  kaBorder: "1px solid rgba(230,160,90,0.35)",
  kaIconBg: "linear-gradient(180deg, #ffc07a, #e88e3a)",

  // Source tags
  tagUserBg: "rgba(42,208,109,0.12)",    tagUserBorder: "rgba(42,208,109,0.3)",   tagUserText: "#1a9553",
  tagConceptBg: "rgba(26,122,255,0.1)",   tagConceptBorder: "rgba(26,122,255,0.28)", tagConceptText: "#0051ff",
  tagResearchBg: "rgba(175,82,222,0.12)", tagResearchBorder: "rgba(175,82,222,0.28)", tagResearchText: "#8e3bb8",

  // Convergence gauge stroke
  gaugeStroke: "url(#convergeGrad)",
  gaugeGlow: "drop-shadow(0 0 6px rgba(26,122,255,0.5))",
};
```

Important: because the app's background is light gray (not the reference's colored radial), use `shellBg` (0.82 opacity white) not `shellBgGlass` for the outer module. Inside the module, apply a subtle blue tint (`linear-gradient(180deg, rgba(240,245,255,0.5), rgba(255,255,255,0))`) so the glass cards have something to blur over and the inner tree reads as distinct from the page.

## 8. Keyframes to add

Add to `src/app/globals.css` (append at end — `sweep` was already added in a prior change):

```css
@keyframes pulse-live-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.5; transform: scale(1.4); }
}
@keyframes tracker-fade {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}
@keyframes rise-fade {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

Then in the component:
- Live dot: `animate-[pulse-live-dot_2s_infinite]`
- Progress tracker dot: `animate-[tracker-fade_3s_ease-in-out_infinite]`
- Module mount: `animate-[rise-fade_0.9s_0.2s_forwards_cubic-bezier(0.22,1,0.36,1)]`
- Mission icon sweep: `animate-[sweep_4s_linear_infinite]`

## 9. Edge cases & states

### No active goal, pending suggestions exist
Use the highest-priority `depth: "fundamental"` suggestion as the root. The L1 marker shows no checkmark; the Track button says `+ Accept`; clicking it calls `onAccept`.

### No active goal, no pending suggestions
Render only the header with a muted placeholder title ("No objectives detected yet"). Hide the expand button and body. Show a single `+ Run detection` CTA in place of track buttons.

### Active goal with no children and no pending sub-objectives
Show the L1 card in the tree. Below it render a dashed "Decompose into sub-objectives" full-width button that calls `onDecompose(primaryGoal.id)`.

### Variant `"compact"` (for dashboard overview)
Render only the header (mission icon + eyebrow + title + layer chips + stats) and the progress strip. No body, no tree, no expand button. Clicking the card navigates to the objectives side page.

### Filter tabs
Local `useState<"all" | "tracked" | "l3">("all")`.
- `"all"`: render every node
- `"tracked"`: render only goals with `status === "active"` and their ancestors (so tree stays connected)
- `"l3"`: render only L3 leaves — as a flat list without connectors (hide the SVG layer when this filter is active)

### Tracked vs untracked styling per node
- Tracked (accepted goal, `status === "active"`): marker gets solid gradient fill + white checkmark, Track button becomes green "Tracked"
- Untracked (suggestion): marker shows number/letter, Track button is blue "+ Track" or "+ Accept"

## 10. Removal checklist

After the shell replaces the old components, delete these from their current import sites but keep the files (they may still be imported by other pages):

- `dashboard-grid.tsx`: remove `ObjectiveCommandCenter`, `ObjectivesTreeModule` imports (still imported from their own files, but the grid no longer uses them).
- `objectives/page.tsx`: remove `ObjectiveCommandCenter`, `ObjectivesTreeModule` imports.
- `dashboard-overview-grid.tsx`: keep `ObjectiveOverviewBanner` but update it to use `<ObjectivesDecompositionShell variant="compact" />` internally.

Do NOT delete `objective-command-center.tsx` or `objectives-tree-module.tsx` — there's likely still code referencing them (e.g. from a full-screen view or embed). Verify with a grep before removal.

## 11. Verification steps

1. Run `npx tsc --noEmit` — should have zero new errors.
2. Visit `/app/space/[id]/objectives` — expect the full shell with primary goal as L1, accepted children as L2, pending suggestions as tracked-off nodes, SVG connectors between markers.
3. Visit dashboard — same shell embedded inline.
4. Click expand/collapse — body animates, SVG connectors recompute on `transitionend`.
5. Click filter tabs — tree re-renders, connectors recompute.
6. Click `+ Track` on a suggestion — calls `onAccept`, node re-renders with tracked state.
7. Click decompose button — calls `onDecompose`, refreshes data.
8. Resize window — connectors update via `ResizeObserver`.
9. Check Lighthouse — ensure `prefers-reduced-motion` disables the conic sweep and tracker-fade animations.

## 12. Skeleton to paste as starting point

```tsx
"use client";

import { useState, useMemo, useRef, useLayoutEffect, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Check, Plus, ChevronDown, Zap, User, Network, Search,
} from "lucide-react";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";

export interface ObjectivesDecompositionShellProps {
  primaryGoal: ImprovementGoal | null;
  allGoals: ImprovementGoal[];
  suggestedObjectives: SuggestedObjective[];
  onAccept?: (obj: SuggestedObjective) => void | Promise<void>;
  onDecompose?: (goalId: string) => void | Promise<void>;
  onCreateSubSpace?: (goalId: string) => void | Promise<void>;
  onNavigateToSpace?: (spaceId: string) => void;
  onGoalClick?: (goal: ImprovementGoal) => void;
  variant?: "full" | "compact";
  initiallyExpanded?: boolean;
}

// --- internal tree node representation ---
type TreeNode = {
  id: string;
  kind: "goal" | "suggestion";
  data: ImprovementGoal | SuggestedObjective;
  level: 1 | 2 | 3;
  label: string;                      // "2.1", "a", or "✓"
  children: TreeNode[];
  parentId: string | null;
};

// 1. Build tree (buildTree helper)
// 2. Compute header stats (detected, tracked, layer counts, convergence %, days)
// 3. Parse title for gradient number
// 4. Render MissionIcon, EyebrowStrip, TitleBlock, LayerChips, Stats, ConvergenceGauge, ExpandButton
// 5. Render ProgressStrip
// 6. Render collapsible body with FilterTabs + Tree
// 7. Tree uses svg overlay with useLayoutEffect connector computation
// 8. Recursive NodeCard handles L1/L2/L3 variants

export default function ObjectivesDecompositionShell(props: ObjectivesDecompositionShellProps) {
  // ... implement per sections 4–9 above
  return null;
}
```

---

## Summary

Follow this spec end-to-end in a fresh session and the result should match the reference within a single implementation pass. The heaviest pieces are (a) building `TreeNode` correctly from two data sources (accepted goals + pending suggestions), and (b) the SVG connector `useLayoutEffect`. Everything else is styling assembly from the tokens in §7.
