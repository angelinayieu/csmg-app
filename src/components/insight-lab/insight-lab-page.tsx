"use client";

// ── InsightLabPage ─────────────────────────────────────────────────────
//
// Top-level client shell for /app/lab/insight-stacks. Owns:
//   - selected space (driven by URL ?spaceId=)
//   - composed stack
//   - run state via useLabRun (hook owns SSE + POST)
//
// Layout matches the /preflight/insight-lab mockup: header bar +
// three-pane main (palette · builder · results).

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLabRun } from "./hooks/use-lab-run";
import { HeaderBar } from "./header-bar";
import { AlgorithmPalette } from "./algorithm-palette";
import { StackBuilder } from "./stack-builder";
import { ResultsPanel } from "./results-panel";
import type { StackConfig, AlgoId } from "@/lib/insight-lab/types";
import { ALGO_CATALOG } from "./types";
import type { InsightKind } from "./types";

export interface SpaceSummary {
  id: string;
  name: string;
  entity_count: number | null;
  edge_count: number | null;
  primary_goal: string | null;
  input_text: string | null;
}

export interface InsightLabPageProps {
  initialSpaces: SpaceSummary[];
  initialSpaceId: string;
}

export function InsightLabPage({
  initialSpaces,
  initialSpaceId,
}: InsightLabPageProps) {
  const router = useRouter();
  const [activeSpaceId, setActiveSpaceId] = useState(initialSpaceId);

  // Default stack: just preliminary-insights. The only registered algo
  // for v0 — the rest of the palette is advertised as "soon."
  const [stackSteps, setStackSteps] = useState<{ algoId: string }[]>([
    { algoId: "preliminary-insights" },
  ]);
  const [filter, setFilter] = useState<InsightKind | "all">("all");

  const labRun = useLabRun();

  const activeSpace =
    initialSpaces.find((s) => s.id === activeSpaceId) ?? initialSpaces[0];

  const handleSpaceChange = useCallback(
    (id: string) => {
      setActiveSpaceId(id);
      labRun.reset();
      // Sync URL so reloads land on the same space.
      router.replace(`/app/lab/insight-stacks?spaceId=${id}`);
    },
    [labRun, router],
  );

  const handleRun = useCallback(() => {
    if (stackSteps.length === 0) return;
    const config: StackConfig = {
      id: `manual-${Date.now()}`,
      name:
        stackSteps.length === 1
          ? (ALGO_CATALOG.find((a) => a.id === stackSteps[0].algoId)?.name ??
            "Manual run")
          : `Custom stack (${stackSteps.length} steps)`,
      steps: stackSteps.map((s) => ({ algoId: s.algoId as AlgoId })),
    };
    void labRun.run({ spaceId: activeSpaceId, stack: config });
  }, [activeSpaceId, stackSteps, labRun]);

  const addAlgo = useCallback(
    (id: string) => {
      if (stackSteps.some((s) => s.algoId === id)) return;
      const entry = ALGO_CATALOG.find((a) => a.id === id);
      if (!entry?.registered) return;
      setStackSteps((prev) => [...prev, { algoId: id }]);
    },
    [stackSteps],
  );

  const removeStep = useCallback((idx: number) => {
    setStackSteps((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const moveStep = useCallback(
    (idx: number, dir: "up" | "down") => {
      setStackSteps((prev) => {
        const target = dir === "up" ? idx - 1 : idx + 1;
        if (target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        [next[target], next[idx]] = [next[idx], next[target]];
        return next;
      });
    },
    [],
  );

  // Counts for the results filter tabs. Computed off live insights so
  // they update during streaming.
  const counts = useMemo(() => {
    const c: Record<InsightKind | "all", number> = {
      all: 0,
      hub: 0,
      bridge: 0,
      cluster: 0,
      cycle: 0,
      community: 0,
      cascade: 0,
      pathway: 0,
      tier: 0,
    };
    for (const i of labRun.insights) {
      c.all++;
      c[i.kind]++;
    }
    return c;
  }, [labRun.insights]);

  const visibleInsights = useMemo(() => {
    const base =
      filter === "all"
        ? labRun.insights
        : labRun.insights.filter((i) => i.kind === filter);
    return [...base].sort((a, b) => {
      const sa = a.goalMatch ?? -1;
      const sb = b.goalMatch ?? -1;
      return sb - sa;
    });
  }, [labRun.insights, filter]);

  return (
    <div className="min-h-screen bg-[#FAFAF7] text-slate-900">
      <DotGrid />
      <HeaderBar
        spaces={initialSpaces}
        activeSpace={activeSpace}
        onSpaceChange={handleSpaceChange}
      />
      <main className="flex h-[calc(100vh-3.5rem)]">
        <AlgorithmPalette
          usedAlgoIds={stackSteps.map((s) => s.algoId)}
          onAdd={addAlgo}
        />
        <StackBuilder
          steps={stackSteps}
          runState={labRun.state}
          stepProgress={labRun.stepProgress}
          stackAvg={labRun.stackAvg}
          insightCount={labRun.insights.length}
          activeSpace={activeSpace}
          error={labRun.error}
          onRun={handleRun}
          onRerun={handleRun}
          onRemove={removeStep}
          onMoveUp={(idx) => moveStep(idx, "up")}
          onMoveDown={(idx) => moveStep(idx, "down")}
        />
        <ResultsPanel
          runState={labRun.state}
          insights={visibleInsights}
          counts={counts}
          filter={filter}
          onFilterChange={setFilter}
          stackAvg={labRun.stackAvg}
        />
      </main>
    </div>
  );
}

function DotGrid() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(15,23,42,0.045) 1px, transparent 1px)",
        backgroundSize: "32px 32px",
      }}
    />
  );
}
