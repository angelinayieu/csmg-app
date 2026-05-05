// ── Insight Lab · preflight design (mockup) ─────────────────────────
//
// Static visual preview of the Insight Lab UI — three-pane layout, mock
// data, state toggle in the header to flip between idle / running /
// complete so every state is reviewable without wiring real backend.
//
// Real implementation lands at /app/lab/insight-stacks (Card 10) once
// the layout is approved here.

"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Beaker,
  ChevronDown,
  ChevronRight,
  Network,
  GitBranch,
  AlertTriangle,
  RefreshCcw,
  Plus,
  Play,
  X,
  Sparkles,
  GripVertical,
  Loader2,
  Check,
  type LucideIcon,
} from "lucide-react";

// ── Mock data ──────────────────────────────────────────────────────────

interface MockAlgo {
  id: string;
  name: string;
  description: string;
  category: "structural" | "semantic" | "hybrid";
  available: boolean;
  complexity: string;
}

const ALGORITHMS: MockAlgo[] = [
  {
    id: "preliminary-insights",
    name: "Preliminary insights",
    description: "Hubs, bridges, isolated clusters, feedback loops",
    category: "structural",
    available: true,
    complexity: "O(n²)",
  },
  {
    id: "communities",
    name: "Communities (label propagation)",
    description: "Cluster the graph + modularity Q score",
    category: "structural",
    available: true,
    complexity: "O(iter·m)",
  },
  {
    id: "cascades",
    name: "Cascades",
    description: "Multi-hop downstream from leverage / risk points",
    category: "structural",
    available: true,
    complexity: "O(seeds·n)",
  },
  {
    id: "pagerank",
    name: "PageRank",
    description: "Recursive importance — most influential nodes",
    category: "structural",
    available: false,
    complexity: "O(iter·m)",
  },
  {
    id: "betweenness",
    name: "Betweenness centrality",
    description: "Brokers on many shortest paths",
    category: "structural",
    available: false,
    complexity: "O(n·m)",
  },
  {
    id: "k-core",
    name: "K-core decomposition",
    description: "Densely-connected core vs periphery",
    category: "structural",
    available: false,
    complexity: "O(n+m)",
  },
  {
    id: "goal-rank",
    name: "Goal-relevance rank",
    description: "Re-rank by cosine to your objective",
    category: "semantic",
    available: false,
    complexity: "1 embed",
  },
  {
    id: "theme-clusters",
    name: "Theme clustering",
    description: "Embed entities → k-means → LLM names clusters",
    category: "semantic",
    available: false,
    complexity: "O(n·k)",
  },
  {
    id: "llm-traverse",
    name: "LLM-guided traversal",
    description: "GraphRAG: LLM picks next neighbor",
    category: "semantic",
    available: false,
    complexity: "k LLM calls",
  },
  {
    id: "goal-walks",
    name: "Goal-biased random walks",
    description: "Walks weighted by cosine to goal embedding",
    category: "hybrid",
    available: false,
    complexity: "O(walks·len)",
  },
  {
    id: "ppr",
    name: "Personalized PageRank",
    description: "PageRank with goal-biased restart distribution",
    category: "hybrid",
    available: false,
    complexity: "O(iter·m)",
  },
  {
    id: "counterfactual",
    name: "Counterfactual removal",
    description: "Re-run any algo with key node removed → diff insights",
    category: "hybrid",
    available: false,
    complexity: "varies",
  },
];

interface MockInsight {
  id: string;
  kind: "hub" | "bridge" | "cycle" | "cluster";
  summary: string;
  goalMatch: number;
  algoId: string;
  algoName: string;
  stepIdx: number;
  detailLine: string;
}

const INSIGHTS: MockInsight[] = [
  {
    id: "hub-1",
    kind: "hub",
    summary: "AI glasses",
    detailLine: "17 connections · 13 out, 4 in",
    goalMatch: 0.91,
    algoId: "preliminary-insights",
    algoName: "Preliminary insights",
    stepIdx: 0,
  },
  {
    id: "hub-2",
    kind: "hub",
    summary: "Human cognition",
    detailLine: "12 connections · 8 out, 4 in",
    goalMatch: 0.88,
    algoId: "preliminary-insights",
    algoName: "Preliminary insights",
    stepIdx: 0,
  },
  {
    id: "hub-3",
    kind: "hub",
    summary: "AI Processing Unit",
    detailLine: "10 connections · 6 out, 4 in",
    goalMatch: 0.79,
    algoId: "preliminary-insights",
    algoName: "Preliminary insights",
    stepIdx: 0,
  },
  {
    id: "bridge-1",
    kind: "bridge",
    summary: "Error Classification ↔ Feedback Loop",
    detailLine: "3 shared neighbors · 100% overlap",
    goalMatch: 0.74,
    algoId: "preliminary-insights",
    algoName: "Preliminary insights",
    stepIdx: 0,
  },
  {
    id: "bridge-2",
    kind: "bridge",
    summary: "Error Detection ↔ Error Correction",
    detailLine: "3 shared neighbors · 100% overlap",
    goalMatch: 0.71,
    algoId: "preliminary-insights",
    algoName: "Preliminary insights",
    stepIdx: 0,
  },
  {
    id: "bridge-3",
    kind: "bridge",
    summary: "User experience ↔ Privacy concerns",
    detailLine: "2 shared neighbors · 100% overlap",
    goalMatch: 0.62,
    algoId: "preliminary-insights",
    algoName: "Preliminary insights",
    stepIdx: 0,
  },
  {
    id: "cycle-1",
    kind: "cycle",
    summary: "Memory → Attention → Memory",
    detailLine: "Length-2 cycle",
    goalMatch: 0.68,
    algoId: "preliminary-insights",
    algoName: "Preliminary insights",
    stepIdx: 0,
  },
  {
    id: "cluster-1",
    kind: "cluster",
    summary: "Encryption Algorithms cluster",
    detailLine: "Cluster of 3 entities",
    goalMatch: 0.42,
    algoId: "preliminary-insights",
    algoName: "Preliminary insights",
    stepIdx: 0,
  },
];

const SPACES = [
  { id: "s1", name: "AI Glasses for Cognitive Augmentation" },
  { id: "s2", name: "Customer churn analysis Q2" },
  { id: "s3", name: "Renewable energy strategy" },
];

interface MockStep {
  id: string;
  algoId: string;
  status: "pending" | "running" | "complete";
  durationMs?: number;
  insightCount?: number;
}

// ── State ──────────────────────────────────────────────────────────────

type RunState = "idle" | "running" | "complete";

// ── Helpers ────────────────────────────────────────────────────────────

const KIND_META: Record<
  MockInsight["kind"],
  { icon: LucideIcon; label: string; ring: string; chip: string; bar: string }
> = {
  hub: {
    icon: Network,
    label: "Hub",
    ring: "ring-sky-200",
    chip: "bg-sky-50 text-sky-700",
    bar: "bg-sky-500",
  },
  bridge: {
    icon: GitBranch,
    label: "Bridge",
    ring: "ring-violet-200",
    chip: "bg-violet-50 text-violet-700",
    bar: "bg-violet-500",
  },
  cycle: {
    icon: RefreshCcw,
    label: "Cycle",
    ring: "ring-emerald-200",
    chip: "bg-emerald-50 text-emerald-700",
    bar: "bg-emerald-500",
  },
  cluster: {
    icon: AlertTriangle,
    label: "Cluster",
    ring: "ring-amber-200",
    chip: "bg-amber-50 text-amber-700",
    bar: "bg-amber-500",
  },
};

const CATEGORY_META: Record<
  MockAlgo["category"],
  { label: string; tone: string; dot: string }
> = {
  structural: {
    label: "Structural",
    tone: "text-violet-600",
    dot: "bg-violet-500",
  },
  semantic: {
    label: "Semantic",
    tone: "text-teal-600",
    dot: "bg-teal-500",
  },
  hybrid: {
    label: "Hybrid",
    tone: "text-amber-600",
    dot: "bg-amber-500",
  },
};

function scoreColor(score: number): string {
  if (score >= 0.8) return "bg-emerald-500";
  if (score >= 0.6) return "bg-sky-500";
  if (score >= 0.4) return "bg-amber-500";
  return "bg-slate-400";
}

// ── Page ───────────────────────────────────────────────────────────────

export default function InsightLabPreflight() {
  const [runState, setRunState] = useState<RunState>("complete");
  const [activeSpaceId, setActiveSpaceId] = useState(SPACES[0].id);
  const [stack, setStack] = useState<{ algoId: string }[]>([
    { algoId: "preliminary-insights" },
  ]);
  const [filter, setFilter] = useState<MockInsight["kind"] | "all">("all");

  const activeSpace = SPACES.find((s) => s.id === activeSpaceId)!;

  const visibleInsights = useMemo(() => {
    if (runState !== "complete") return [];
    const base =
      filter === "all" ? INSIGHTS : INSIGHTS.filter((i) => i.kind === filter);
    return [...base].sort((a, b) => b.goalMatch - a.goalMatch);
  }, [filter, runState]);

  const stackAvg = useMemo(() => {
    if (runState !== "complete" || INSIGHTS.length === 0) return 0;
    return (
      INSIGHTS.reduce((acc, i) => acc + i.goalMatch, 0) / INSIGHTS.length
    );
  }, [runState]);

  const counts = useMemo(() => {
    if (runState !== "complete") {
      return { all: 0, hub: 0, bridge: 0, cycle: 0, cluster: 0 };
    }
    return {
      all: INSIGHTS.length,
      hub: INSIGHTS.filter((i) => i.kind === "hub").length,
      bridge: INSIGHTS.filter((i) => i.kind === "bridge").length,
      cycle: INSIGHTS.filter((i) => i.kind === "cycle").length,
      cluster: INSIGHTS.filter((i) => i.kind === "cluster").length,
    };
  }, [runState]);

  const stepRows: MockStep[] =
    runState === "running"
      ? [
          {
            id: "s1",
            algoId: "preliminary-insights",
            status: "complete",
            durationMs: 12,
            insightCount: 8,
          },
          { id: "s2", algoId: "communities", status: "running" },
        ]
      : runState === "complete"
        ? stack.map((s, i) => ({
            id: `s${i}`,
            algoId: s.algoId,
            status: "complete",
            durationMs: 12 + i * 8,
            insightCount: i === 0 ? 8 : Math.max(0, 6 - i),
          }))
        : [];

  function addAlgo(id: string) {
    if (stack.some((s) => s.algoId === id)) return;
    setStack([...stack, { algoId: id }]);
  }
  function removeStep(idx: number) {
    setStack(stack.filter((_, i) => i !== idx));
  }
  function moveUp(idx: number) {
    if (idx === 0) return;
    const next = [...stack];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setStack(next);
  }
  function moveDown(idx: number) {
    if (idx >= stack.length - 1) return;
    const next = [...stack];
    [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
    setStack(next);
  }

  return (
    <div className="min-h-screen bg-[#FAFAF7] text-slate-900">
      <DotGrid />

      {/* ── Header ────────────────────────────────────────────────── */}
      <header className="relative z-10 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/70 px-5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-slate-500 hover:bg-slate-100">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Lab</span>
          </button>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-blue-500 text-white">
              <Beaker className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                Insight Lab
              </div>
              <div className="text-[13px] font-semibold leading-none text-slate-900">
                Algorithm stacks
              </div>
            </div>
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <SpacePicker
            spaces={SPACES}
            active={activeSpace}
            onChange={setActiveSpaceId}
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-amber-700">
            Preflight · mockup
          </span>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-[11px]">
            {(["idle", "running", "complete"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setRunState(s)}
                className={`rounded-md px-2.5 py-1 capitalize transition-colors ${
                  runState === s
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Three-pane main ───────────────────────────────────────── */}
      <main className="flex h-[calc(100vh-3.5rem)]">
        <PalettePane usedAlgoIds={stack.map((s) => s.algoId)} onAdd={addAlgo} />
        <BuilderPane
          stack={stack}
          runState={runState}
          stepRows={stepRows}
          onRun={() => setRunState("running")}
          onRerun={() => setRunState("running")}
          onRemove={removeStep}
          onMoveUp={moveUp}
          onMoveDown={moveDown}
        />
        <ResultsPane
          runState={runState}
          insights={visibleInsights}
          counts={counts}
          filter={filter}
          onFilterChange={setFilter}
          stackAvg={stackAvg}
        />
      </main>
    </div>
  );
}

// ── Header pieces ─────────────────────────────────────────────────────

function SpacePicker({
  spaces,
  active,
  onChange,
}: {
  spaces: typeof SPACES;
  active: (typeof SPACES)[number];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[280px] items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-100"
      >
        <span className="truncate">{active.name}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {spaces.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                onChange(s.id);
                setOpen(false);
              }}
              className={`flex w-full items-center px-3 py-2 text-left text-[12.5px] hover:bg-slate-50 ${
                s.id === active.id
                  ? "bg-slate-50 font-medium text-slate-900"
                  : "text-slate-700"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Palette pane (left, 280px) ────────────────────────────────────────

function PalettePane({
  usedAlgoIds,
  onAdd,
}: {
  usedAlgoIds: string[];
  onAdd: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const out: Record<MockAlgo["category"], MockAlgo[]> = {
      structural: [],
      semantic: [],
      hybrid: [],
    };
    for (const a of ALGORITHMS) out[a.category].push(a);
    return out;
  }, []);

  return (
    <aside className="w-[280px] shrink-0 overflow-y-auto border-r border-slate-200/80 bg-white/40">
      <div className="border-b border-slate-200/60 px-4 py-3">
        <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-slate-400">
          Algorithm palette
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          Click to add to your stack →
        </div>
      </div>

      {(["structural", "semantic", "hybrid"] as const).map((cat) => (
        <PaletteCategory
          key={cat}
          category={cat}
          algos={grouped[cat]}
          usedAlgoIds={usedAlgoIds}
          onAdd={onAdd}
        />
      ))}
    </aside>
  );
}

function PaletteCategory({
  category,
  algos,
  usedAlgoIds,
  onAdd,
}: {
  category: MockAlgo["category"];
  algos: MockAlgo[];
  usedAlgoIds: string[];
  onAdd: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const meta = CATEGORY_META[category];
  const availableCount = algos.filter((a) => a.available).length;

  return (
    <div className="border-b border-slate-200/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-slate-50/60"
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            className={`h-3 w-3 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span
            className={`text-[10px] font-bold uppercase tracking-[0.14em] ${meta.tone}`}
          >
            {meta.label}
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-slate-400">
          {availableCount}/{algos.length}
        </span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          {algos.map((a) => (
            <PaletteTile
              key={a.id}
              algo={a}
              used={usedAlgoIds.includes(a.id)}
              onAdd={onAdd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PaletteTile({
  algo,
  used,
  onAdd,
}: {
  algo: MockAlgo;
  used: boolean;
  onAdd: (id: string) => void;
}) {
  const meta = CATEGORY_META[algo.category];
  const disabled = !algo.available || used;

  return (
    <button
      onClick={() => !disabled && onAdd(algo.id)}
      disabled={disabled}
      className={`group mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-all ${
        disabled
          ? "cursor-not-allowed opacity-60"
          : "hover:-translate-y-px hover:bg-white hover:shadow-sm"
      }`}
    >
      <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-slate-800">
            {algo.name}
          </span>
          {!algo.available && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-slate-400">
              soon
            </span>
          )}
          {used && (
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-emerald-600">
              added
            </span>
          )}
        </div>
        <div className="mt-0.5 line-clamp-1 text-[10.5px] text-slate-500">
          {algo.description}
        </div>
        <div className="mt-1 text-[9.5px] tabular-nums text-slate-400">
          {algo.complexity}
        </div>
      </div>
      {!disabled && (
        <Plus className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400 opacity-0 group-hover:opacity-100" />
      )}
    </button>
  );
}

// ── Builder pane (center, flex-1) ─────────────────────────────────────

function BuilderPane({
  stack,
  runState,
  stepRows,
  onRun,
  onRerun,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  stack: { algoId: string }[];
  runState: RunState;
  stepRows: MockStep[];
  onRun: () => void;
  onRerun: () => void;
  onRemove: (idx: number) => void;
  onMoveUp: (idx: number) => void;
  onMoveDown: (idx: number) => void;
}) {
  return (
    <section className="flex-1 overflow-y-auto bg-gradient-to-b from-transparent to-slate-50/40">
      <div className="mx-auto max-w-2xl px-8 py-8">
        {/* Eyebrow */}
        <div className="mb-5">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Stack · {stack.length} step{stack.length === 1 ? "" : "s"}
          </div>
          <h2 className="mt-1 text-[18px] font-semibold text-slate-900">
            Compose & run
          </h2>
          <p className="mt-1 text-[12px] text-slate-500">
            Algorithms execute in order. Each step&apos;s output becomes one or
            more <em>insights</em> ranked in the right pane.
          </p>
        </div>

        {/* Step list */}
        {stack.length === 0 ? (
          <EmptyStackHint />
        ) : (
          <div className="space-y-2">
            {stack.map((s, idx) => {
              const algo = ALGORITHMS.find((a) => a.id === s.algoId);
              if (!algo) return null;
              const stepRow = stepRows.find((r, i) => i === idx);
              return (
                <StepCard
                  key={`${s.algoId}-${idx}`}
                  idx={idx}
                  algo={algo}
                  status={stepRow?.status}
                  durationMs={stepRow?.durationMs}
                  insightCount={stepRow?.insightCount}
                  isFirst={idx === 0}
                  isLast={idx === stack.length - 1}
                  onRemove={() => onRemove(idx)}
                  onMoveUp={() => onMoveUp(idx)}
                  onMoveDown={() => onMoveDown(idx)}
                />
              );
            })}
          </div>
        )}

        {/* Run button + progress */}
        <div className="mt-6">
          {runState === "idle" && (
            <button
              onClick={onRun}
              disabled={stack.length === 0}
              className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold shadow-sm transition-all ${
                stack.length === 0
                  ? "cursor-not-allowed bg-slate-100 text-slate-400"
                  : "bg-gradient-to-br from-violet-600 to-blue-600 text-white hover:-translate-y-px hover:shadow-md"
              }`}
            >
              <Play className="h-4 w-4 fill-current" />
              Run stack
            </button>
          )}
          {runState === "running" && <RunningPanel stepRows={stepRows} />}
          {runState === "complete" && (
            <div className="flex items-center gap-2">
              <button
                onClick={onRerun}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-[13px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-px hover:bg-slate-50 hover:shadow-md"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                Re-run stack
              </button>
              <button className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50">
                <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                Save as template
              </button>
            </div>
          )}
        </div>

        {/* Promote-to-canvas hint when complete */}
        {runState === "complete" && (
          <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-white/40 p-4 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Future · v1
            </div>
            <div className="mt-1 text-[12px] text-slate-500">
              Promote this stack to your canvas as a reusable lens →
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyStackHint() {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white/40 p-8 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-400">
        <Plus className="h-4 w-4" />
      </div>
      <div className="mt-3 text-[13px] font-semibold text-slate-700">
        Empty stack
      </div>
      <div className="mt-1 text-[11.5px] text-slate-500">
        Click any algorithm in the left palette to add it as a step.
      </div>
    </div>
  );
}

function StepCard({
  idx,
  algo,
  status,
  durationMs,
  insightCount,
  isFirst,
  isLast,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  idx: number;
  algo: MockAlgo;
  status?: MockStep["status"];
  durationMs?: number;
  insightCount?: number;
  isFirst: boolean;
  isLast: boolean;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const meta = CATEGORY_META[algo.category];

  const statusGlyph =
    status === "running" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
    ) : status === "complete" ? (
      <Check className="h-3.5 w-3.5 text-emerald-500" />
    ) : null;

  return (
    <div className="group relative rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all hover:border-slate-300">
      <div className="flex items-start gap-3">
        <button
          aria-label="Drag to reorder"
          className="mt-0.5 cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-50 text-[11px] font-bold tabular-nums text-slate-500">
          {idx + 1}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            <span className={`text-[9.5px] font-bold uppercase tracking-[0.12em] ${meta.tone}`}>
              {meta.label}
            </span>
            {statusGlyph}
          </div>
          <div className="mt-0.5 text-[13.5px] font-semibold text-slate-900">
            {algo.name}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10.5px] text-slate-500">
            <span>default params</span>
            {durationMs !== undefined && (
              <span className="tabular-nums">· {durationMs}ms</span>
            )}
            {insightCount !== undefined && (
              <span className="tabular-nums">· {insightCount} insights</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            disabled={isFirst}
            onClick={onMoveUp}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
            aria-label="Move up"
          >
            <ChevronDown className="h-3 w-3 rotate-180" />
          </button>
          <button
            disabled={isLast}
            onClick={onMoveDown}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
            aria-label="Move down"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
          <button
            onClick={onRemove}
            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            aria-label="Remove step"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function RunningPanel({ stepRows }: { stepRows: MockStep[] }) {
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
        <span className="text-[12.5px] font-semibold text-violet-900">
          Running stack…
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        {stepRows.map((r) => {
          const algo = ALGORITHMS.find((a) => a.id === r.algoId);
          return (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-md bg-white/60 px-3 py-1.5 text-[11.5px]"
            >
              <div className="flex items-center gap-2">
                {r.status === "complete" ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin text-violet-500" />
                )}
                <span className="font-medium text-slate-700">
                  {algo?.name ?? r.algoId}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10.5px] text-slate-500">
                {r.durationMs !== undefined && (
                  <span className="tabular-nums">{r.durationMs}ms</span>
                )}
                {r.insightCount !== undefined && (
                  <span className="tabular-nums">
                    · {r.insightCount} insights
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-violet-700">
        <Sparkles className="h-3 w-3" />
        Streaming via pipeline_run_events bus
      </div>
    </div>
  );
}

// ── Results pane (right, 380px) ───────────────────────────────────────

function ResultsPane({
  runState,
  insights,
  counts,
  filter,
  onFilterChange,
  stackAvg,
}: {
  runState: RunState;
  insights: MockInsight[];
  counts: { all: number; hub: number; bridge: number; cycle: number; cluster: number };
  filter: MockInsight["kind"] | "all";
  onFilterChange: (f: MockInsight["kind"] | "all") => void;
  stackAvg: number;
}) {
  return (
    <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-slate-200/80 bg-white/40">
      <div className="border-b border-slate-200/60 px-4 py-3">
        <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-slate-400">
          Results
        </div>
        <div className="mt-1 flex items-center justify-between">
          <div className="text-[13px] font-semibold text-slate-900">
            {runState === "complete"
              ? `${counts.all} insights`
              : runState === "running"
                ? "Streaming…"
                : "Run a stack to see insights"}
          </div>
          {runState === "complete" && (
            <ScoreChip label="Goal match" value={stackAvg} />
          )}
        </div>
      </div>

      {/* Filter tabs */}
      {runState === "complete" && (
        <div className="flex gap-1 border-b border-slate-200/60 px-2 py-2">
          {([
            ["all", "All", counts.all],
            ["hub", "Hubs", counts.hub],
            ["bridge", "Bridges", counts.bridge],
            ["cycle", "Cycles", counts.cycle],
            ["cluster", "Clusters", counts.cluster],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => onFilterChange(id as MockInsight["kind"] | "all")}
              className={`rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors ${
                filter === id
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
              <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Insight list */}
      <div className="p-3">
        {runState === "idle" && <ResultsIdle />}
        {runState === "running" && <ResultsStreaming />}
        {runState === "complete" && (
          <div className="space-y-2">
            {insights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function ScoreChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white">
      <span className="opacity-70">{label}</span>
      <span className="tabular-nums">{value.toFixed(2)}</span>
    </div>
  );
}

function ResultsIdle() {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white/40 p-6 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-400">
        <Beaker className="h-4 w-4" />
      </div>
      <div className="mt-3 text-[12px] font-semibold text-slate-700">
        Nothing to show yet
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        Compose a stack on the left and hit Run.
      </div>
    </div>
  );
}

function ResultsStreaming() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200 bg-white p-3"
          style={{ animationDelay: `${i * 0.1}s` }}
        >
          <div className="h-2.5 w-3/4 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-2 w-1/2 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function InsightCard({ insight }: { insight: MockInsight }) {
  const [expanded, setExpanded] = useState(false);
  const meta = KIND_META[insight.kind];
  const Icon = meta.icon;
  return (
    <button
      onClick={() => setExpanded((e) => !e)}
      className={`block w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all hover:-translate-y-px hover:border-slate-300 hover:shadow-md`}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ring-1 ${meta.ring} ${meta.chip}`}
        >
          <Icon className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider ${meta.chip}`}
                >
                  {meta.label}
                </span>
              </div>
              <div className="mt-1 truncate text-[12.5px] font-semibold text-slate-900">
                {insight.summary}
              </div>
              <div className="mt-0.5 truncate text-[10.5px] text-slate-500">
                {insight.detailLine}
              </div>
            </div>
            {/* Score chip */}
            <div className="shrink-0">
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-1 rounded-full bg-slate-50 px-1.5 py-0.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${scoreColor(insight.goalMatch)}`}
                  />
                  <span className="text-[10px] font-bold tabular-nums text-slate-700">
                    {insight.goalMatch.toFixed(2)}
                  </span>
                </div>
                <div className="mt-0.5 text-[8.5px] uppercase tracking-wider text-slate-400">
                  goal match
                </div>
              </div>
            </div>
          </div>
          {/* Provenance */}
          {expanded && (
            <div className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-[10px]">
              <div className="font-semibold uppercase tracking-wider text-slate-400">
                Provenance
              </div>
              <div className="mt-0.5 text-slate-600">
                Step {insight.stepIdx + 1} · {insight.algoName}
              </div>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Background ───────────────────────────────────────────────────────

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
