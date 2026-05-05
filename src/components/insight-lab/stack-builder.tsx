"use client";

// ── Insight Lab · stack builder ───────────────────────────────────────
//
// Center pane. Vertical list of step cards + Run button. Streams
// per-step progress during a running stack and offers Re-run after
// completion. Empty-state when no entities exist on the active space
// (the API would 400 anyway).

import {
  Play,
  RefreshCcw,
  Plus,
  X,
  ChevronDown,
  Loader2,
  Check,
  GripVertical,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import {
  ALGO_CATALOG,
  CATEGORY_META,
  type AlgoCatalogEntry,
} from "./types";
import type { LabRunState, LabStepProgress } from "./hooks/use-lab-run";
import type { SpaceSummary } from "./insight-lab-page";

export function StackBuilder({
  steps,
  runState,
  stepProgress,
  stackAvg,
  insightCount,
  activeSpace,
  error,
  onRun,
  onRerun,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  steps: { algoId: string }[];
  runState: LabRunState;
  stepProgress: LabStepProgress[];
  stackAvg: number | null;
  insightCount: number;
  activeSpace: SpaceSummary;
  error: string | null;
  onRun: () => void;
  onRerun: () => void;
  onRemove: (idx: number) => void;
  onMoveUp: (idx: number) => void;
  onMoveDown: (idx: number) => void;
}) {
  const noEntities = (activeSpace.entity_count ?? 0) === 0;
  const isRunning = runState === "running" || runState === "submitting" || runState === "streaming";
  const isComplete = runState === "complete";

  return (
    <section className="flex-1 overflow-y-auto bg-gradient-to-b from-transparent to-slate-50/40">
      <div className="mx-auto max-w-2xl px-8 py-8">
        {/* Eyebrow */}
        <div className="mb-5">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Stack · {steps.length} step{steps.length === 1 ? "" : "s"}
          </div>
          <h2 className="mt-1 text-[18px] font-semibold text-slate-900">
            Compose & run
          </h2>
          <p className="mt-1 text-[12px] text-slate-500">
            Algorithms execute in order. Each step&apos;s output becomes one or
            more <em>insights</em> ranked in the right pane.
          </p>
        </div>

        {noEntities && (
          <NoEntitiesHint spaceId={activeSpace.id} />
        )}

        {!noEntities && (
          <>
            {/* Step list */}
            {steps.length === 0 ? (
              <EmptyStackHint />
            ) : (
              <div className="space-y-2">
                {steps.map((s, idx) => {
                  const algo = ALGO_CATALOG.find((a) => a.id === s.algoId);
                  if (!algo) return null;
                  const progress = stepProgress.find(
                    (p) => p.stepIdx === idx,
                  );
                  return (
                    <StepCard
                      key={`${s.algoId}-${idx}`}
                      idx={idx}
                      algo={algo}
                      progress={progress}
                      isFirst={idx === 0}
                      isLast={idx === steps.length - 1}
                      runState={runState}
                      onRemove={() => onRemove(idx)}
                      onMoveUp={() => onMoveUp(idx)}
                      onMoveDown={() => onMoveDown(idx)}
                    />
                  );
                })}
              </div>
            )}

            {/* Run / Progress / Re-run */}
            <div className="mt-6">
              {!isRunning && !isComplete && (
                <button
                  onClick={onRun}
                  disabled={steps.length === 0}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold shadow-sm transition-all ${
                    steps.length === 0
                      ? "cursor-not-allowed bg-slate-100 text-slate-400"
                      : "bg-gradient-to-br from-violet-600 to-blue-600 text-white hover:-translate-y-px hover:shadow-md"
                  }`}
                >
                  <Play className="h-4 w-4 fill-current" />
                  Run stack
                </button>
              )}

              {isRunning && (
                <RunningPanel
                  stepProgress={stepProgress}
                  state={runState}
                  insightCount={insightCount}
                />
              )}

              {isComplete && (
                <div className="flex flex-col gap-3">
                  <CompletedSummary
                    insightCount={insightCount}
                    stackAvg={stackAvg}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={onRerun}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-[13px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-px hover:bg-slate-50 hover:shadow-md"
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                      Re-run stack
                    </button>
                    <button
                      disabled
                      className="flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[12.5px] font-medium text-slate-400 opacity-60"
                      title="Coming in v1"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Save as template
                    </button>
                  </div>
                </div>
              )}

              {runState === "error" && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-700">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold">Run failed</div>
                    <div className="mt-0.5 opacity-80">{error}</div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function NoEntitiesHint({ spaceId }: { spaceId: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5">
      <div className="text-[12px] font-semibold text-amber-900">
        This space has no entities yet
      </div>
      <p className="mt-1 text-[11.5px] text-amber-800/80">
        The lab needs a decomposed graph to run algorithms against. Open this
        space and run Decompose first.
      </p>
      <a
        href={`/app/space/${spaceId}`}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-amber-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-800"
      >
        Open space →
      </a>
    </div>
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
  progress,
  isFirst,
  isLast,
  runState,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  idx: number;
  algo: AlgoCatalogEntry;
  progress?: LabStepProgress;
  isFirst: boolean;
  isLast: boolean;
  runState: LabRunState;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const meta = CATEGORY_META[algo.category];
  const editable = runState === "idle" || runState === "complete" || runState === "error";

  const statusGlyph =
    progress?.status === "running" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
    ) : progress?.status === "complete" ? (
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
            <span
              className={`text-[9.5px] font-bold uppercase tracking-[0.12em] ${meta.tone}`}
            >
              {meta.label}
            </span>
            {statusGlyph}
          </div>
          <div className="mt-0.5 text-[13.5px] font-semibold text-slate-900">
            {algo.name}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10.5px] text-slate-500">
            <span>default params</span>
            {progress?.insightCount !== undefined && progress.insightCount > 0 && (
              <span className="tabular-nums">
                · {progress.insightCount} insight
                {progress.insightCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        {editable && (
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
        )}
      </div>
    </div>
  );
}

function RunningPanel({
  stepProgress,
  state,
  insightCount,
}: {
  stepProgress: LabStepProgress[];
  state: LabRunState;
  insightCount: number;
}) {
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
        <span className="text-[12.5px] font-semibold text-violet-900">
          {state === "submitting"
            ? "Submitting…"
            : state === "streaming"
              ? "Running stack…"
              : "Running…"}
        </span>
        {insightCount > 0 && (
          <span className="ml-auto text-[10.5px] tabular-nums text-violet-700">
            {insightCount} insight{insightCount === 1 ? "" : "s"} so far
          </span>
        )}
      </div>
      {stepProgress.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {stepProgress.map((p) => (
            <div
              key={p.stepIdx}
              className="flex items-center justify-between rounded-md bg-white/60 px-3 py-1.5 text-[11.5px]"
            >
              <div className="flex items-center gap-2">
                {p.status === "complete" ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin text-violet-500" />
                )}
                <span className="font-medium text-slate-700">{p.algoName}</span>
              </div>
              <div className="flex items-center gap-2 text-[10.5px] text-slate-500">
                {p.insightCount > 0 && (
                  <span className="tabular-nums">
                    · {p.insightCount} insight{p.insightCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-violet-700">
        <Sparkles className="h-3 w-3" />
        Streaming via pipeline_run_events bus
      </div>
    </div>
  );
}

function CompletedSummary({
  insightCount,
  stackAvg,
}: {
  insightCount: number;
  stackAvg: number | null;
}) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="flex items-center gap-2">
        <Check className="h-3.5 w-3.5 text-emerald-600" />
        <span className="text-[12px] font-semibold text-emerald-900">
          Run complete
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-emerald-800">
          {insightCount} insight{insightCount === 1 ? "" : "s"}
          {stackAvg !== null && (
            <>
              {" "}
              · goal-match {stackAvg.toFixed(2)}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
