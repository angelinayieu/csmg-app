"use client";

// ── Canvas situation drawer ──────────────────────────────────────────
//
// Read-only side drawer that renders the FULL situation baseline for
// a space (the structured "current state" the analyzer extracted from
// intake_text + uploaded assets). Companion to the situation-card
// shape on the canvas, which only shows summary counts — this drawer
// is where the user sees the actual extracted content.
//
// Opened by:
//   1. Double-clicking the situation-card shape on the canvas
//   2. Clicking the new "Baseline" button in the canvas top bar
//   3. The "View baseline" affordance on a stale/skipped baseline
//
// Closed by:
//   - X button in the header
//   - Click outside (handled by the host)
//   - Esc key (handled by the host)
//
// Data source: GET /api/spaces/[id] returns the space row with its
// situation_baseline JSONB column. We re-fetch each time the drawer
// opens so a re-run of the analyzer reflects immediately.

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  CircleAlert,
  CircleDot,
  HelpCircle,
  Info,
  ListChecks,
  RefreshCw,
  Target,
  Workflow,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SituationBaseline } from "@/types/situation";

export interface CanvasSituationDrawerProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  /** Called when the user clicks "Re-run analyzer" — host fires
   *  POST /api/pipeline/analyze-situation with force: true. */
  onRerun?: () => Promise<void> | void;
}

export function CanvasSituationDrawer({
  open,
  onClose,
  spaceId,
  onRerun,
}: CanvasSituationDrawerProps) {
  const [baseline, setBaseline] = useState<SituationBaseline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);

  const fetchBaseline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      // Space API returns the row directly OR nested under `space`.
      // Be defensive — same pattern as canvas-snapshots-drawer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const space = (json?.space ?? json) as any;
      const raw = space?.situation_baseline as SituationBaseline | null;
      setBaseline(raw ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (!open) return;
    void fetchBaseline();
  }, [open, fetchBaseline]);

  const handleRerun = useCallback(async () => {
    if (!onRerun) return;
    setRerunning(true);
    try {
      await onRerun();
      // Give the analyzer a moment to land then re-fetch.
      await new Promise((r) => setTimeout(r, 1200));
      await fetchBaseline();
    } finally {
      setRerunning(false);
    }
  }, [onRerun, fetchBaseline]);

  if (!open) return null;

  const skipped = baseline?.skipped_reason != null;
  const empty = !baseline;

  return (
    <div
      role="dialog"
      aria-label="Current state baseline"
      className="fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-full flex-col border-l border-slate-200 bg-white shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
          <Activity className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-700">
            current state
          </div>
          <div className="text-[14px] font-bold text-slate-900">
            Baseline twin
          </div>
        </div>
        {onRerun && (
          <button
            type="button"
            onClick={handleRerun}
            disabled={rerunning}
            title="Re-run the situation analyzer"
            className={cn(
              "flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50",
              rerunning && "opacity-50",
            )}
          >
            <RefreshCw
              className={cn("h-3 w-3", rerunning && "animate-spin")}
            />
            {rerunning ? "Re-running…" : "Re-run"}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close baseline drawer"
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchBaseline} />
        ) : empty ? (
          <NoDataState />
        ) : skipped ? (
          <SkippedState reason={baseline.skipped_reason!} />
        ) : (
          <BaselineContent baseline={baseline!} />
        )}
      </div>

      {/* Footer */}
      {baseline && !skipped && (
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-2 text-[10px] text-slate-500">
          Analyzed {formatRelativeTime(baseline.analyzed_at)}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex h-48 items-center justify-center text-[11px] text-slate-500">
      Loading baseline…
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-2 px-6 text-center text-[11px] text-rose-600">
      <CircleAlert className="h-4 w-4" />
      <div>Failed to load: {message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-rose-200 px-2 py-1 text-[10px] font-medium hover:bg-rose-50"
      >
        Retry
      </button>
    </div>
  );
}

function NoDataState() {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-2 px-6 text-center text-[11px] text-slate-500">
      <Info className="h-4 w-4" />
      <div className="font-medium text-slate-700">
        No baseline yet for this space
      </div>
      <div className="leading-relaxed">
        The situation analyzer hasn&apos;t run, or your intake was vague
        enough that the pipeline went straight to landscape generation.
      </div>
    </div>
  );
}

function SkippedState({ reason }: { reason: string }) {
  const headline =
    reason === "twin_mode_structural"
      ? "Idea-only intake — no baseline built"
      : reason === "no_assets_no_richness"
        ? "Insufficient detail for baseline"
        : reason === "analyzer_failed"
          ? "Baseline analysis failed"
          : "Baseline skipped";
  const explanation =
    reason === "twin_mode_structural"
      ? "Your prompt described a goal but didn't specify a current process / inputs / outputs to model. Upload a spec sheet, dataset, or prior analysis and click Re-run to build a baseline."
      : reason === "no_assets_no_richness"
        ? "Not enough structured detail in the prompt and no assets attached. Add some files via the canvas Library and re-run."
        : reason === "analyzer_failed"
          ? "The baseline analyzer encountered an error during the run. Click Re-run to retry — landscape generation continued normally regardless."
          : "Baseline analysis was skipped for this run.";

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
        <Info className="h-5 w-5 text-slate-500" />
      </div>
      <div className="text-[13px] font-bold text-slate-900">{headline}</div>
      <div className="text-[11px] leading-relaxed text-slate-600 max-w-xs">
        {explanation}
      </div>
    </div>
  );
}

function BaselineContent({ baseline }: { baseline: SituationBaseline }) {
  return (
    <div className="space-y-4 px-5 py-4">
      {/* Uncertainty banner */}
      <UncertaintyBanner score={baseline.uncertainty_score} />

      {/* Inputs */}
      <Section
        icon={<ListChecks className="h-3.5 w-3.5" />}
        label="Inputs"
        count={baseline.inputs.length}
        accent="#0891B2"
      >
        {baseline.inputs.length === 0 ? (
          <EmptyRow text="No inputs extracted" />
        ) : (
          <div className="space-y-1.5">
            {baseline.inputs.map((i, idx) => (
              <InputRow key={`${idx}-${i.name}`} input={i} />
            ))}
          </div>
        )}
      </Section>

      {/* Process */}
      <Section
        icon={<Workflow className="h-3.5 w-3.5" />}
        label="Process"
        count={baseline.process.steps.length}
        accent="#0891B2"
      >
        {baseline.process.steps.length === 0 ? (
          <EmptyRow text="No process steps extracted" />
        ) : (
          <ol className="ml-4 list-decimal space-y-1 text-[12px] text-slate-700">
            {baseline.process.steps.map((s, idx) => (
              <li key={`${idx}-${s}`}>{s}</li>
            ))}
          </ol>
        )}
        {baseline.process.constraints.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-amber-700 mb-1">
              Constraints
            </div>
            <ul className="space-y-0.5 text-[11.5px] text-amber-900">
              {baseline.process.constraints.map((c, idx) => (
                <li key={`${idx}-${c}`}>· {c}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Outputs (current → target) */}
      <Section
        icon={<Target className="h-3.5 w-3.5" />}
        label="Outputs"
        count={baseline.outputs.current.length + baseline.outputs.target.length}
        accent="#0891B2"
      >
        {baseline.outputs.current.length === 0 &&
        baseline.outputs.target.length === 0 ? (
          <EmptyRow text="No metrics extracted" />
        ) : (
          <OutputsTable outputs={baseline.outputs} />
        )}
      </Section>

      {/* Knowns */}
      <Section
        icon={<CircleDot className="h-3.5 w-3.5" />}
        label="Knowns"
        count={baseline.knowns.length}
        accent="#059669"
      >
        {baseline.knowns.length === 0 ? (
          <EmptyRow text="No knowns extracted" />
        ) : (
          <ul className="space-y-1 text-[12px] text-slate-700">
            {baseline.knowns.map((k, idx) => (
              <li key={`${idx}-${k}`} className="flex gap-1.5">
                <span className="mt-1 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-emerald-500" />
                <span>{k}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Unknowns */}
      <Section
        icon={<HelpCircle className="h-3.5 w-3.5" />}
        label="Unknowns"
        count={baseline.unknowns.length}
        accent="#D97706"
      >
        {baseline.unknowns.length === 0 ? (
          <EmptyRow text="No unknowns flagged" />
        ) : (
          <>
            <div className="mb-2 text-[10.5px] italic text-slate-500">
              These will scope downstream research queries.
            </div>
            <ul className="space-y-1.5 text-[12px] text-slate-700">
              {baseline.unknowns.map((u, idx) => (
                <li
                  key={`${idx}-${u}`}
                  className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5"
                >
                  <span className="text-amber-900">{u}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </div>
  );
}

function Section({
  icon,
  label,
  count,
  accent,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <span style={{ color: accent }}>{icon}</span>
        <span
          className="text-[10px] font-bold uppercase tracking-[0.12em]"
          style={{ color: accent }}
        >
          {label}
        </span>
        <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function InputRow({
  input,
}: {
  input: { name: string; value: string | number; unit?: string };
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5">
      <span className="text-[12px] font-medium text-slate-800">
        {input.name}
      </span>
      <span className="font-mono text-[11.5px] tabular-nums text-slate-700">
        {String(input.value)}
        {input.unit ? (
          <span className="ml-1 text-[10px] text-slate-500">{input.unit}</span>
        ) : null}
      </span>
    </div>
  );
}

function OutputsTable({
  outputs,
}: {
  outputs: SituationBaseline["outputs"];
}) {
  // Build a unified row set by metric so current → target → gap reads
  // as one table per row.
  const metricKeys = Array.from(
    new Set([
      ...outputs.current.map((m) => m.metric),
      ...outputs.target.map((m) => m.metric),
      ...outputs.gap.map((g) => g.metric),
    ]),
  );

  return (
    <div className="rounded-md border border-slate-200">
      <div className="grid grid-cols-[1fr_70px_70px_60px] items-center border-b border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
        <span>Metric</span>
        <span className="text-right">Current</span>
        <span className="text-right">Target</span>
        <span className="text-right">Gap</span>
      </div>
      {metricKeys.map((key) => {
        const cur = outputs.current.find((m) => m.metric === key);
        const tgt = outputs.target.find((m) => m.metric === key);
        const gap = outputs.gap.find((g) => g.metric === key);
        return (
          <div
            key={key}
            className="grid grid-cols-[1fr_70px_70px_60px] items-center border-b border-slate-100 px-2 py-1.5 last:border-b-0 text-[11.5px]"
          >
            <span
              className="truncate font-medium text-slate-800"
              title={key}
            >
              {key}
            </span>
            <span className="text-right font-mono tabular-nums text-slate-700">
              {cur ? `${cur.value}${cur.unit ? ` ${cur.unit}` : ""}` : "—"}
            </span>
            <span className="text-right font-mono tabular-nums text-slate-700">
              {tgt ? `${tgt.value}${tgt.unit ? ` ${tgt.unit}` : ""}` : "—"}
            </span>
            <span
              className={cn(
                "text-right font-mono tabular-nums font-bold",
                gap
                  ? gap.direction === "up"
                    ? "text-emerald-700"
                    : "text-rose-700"
                  : "text-slate-300",
              )}
            >
              {gap ? `${gap.delta > 0 ? "+" : ""}${gap.delta}` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="text-[11px] italic text-slate-400">{text}</div>;
}

function UncertaintyBanner({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(1, score));
  const color =
    clamped < 0.3
      ? "emerald"
      : clamped < 0.6
        ? "amber"
        : "rose";
  const label =
    clamped < 0.3 ? "Low" : clamped < 0.6 ? "Medium" : "High";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2",
        color === "emerald" && "border-emerald-200 bg-emerald-50",
        color === "amber" && "border-amber-200 bg-amber-50",
        color === "rose" && "border-rose-200 bg-rose-50",
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          color === "emerald" && "bg-emerald-500",
          color === "amber" && "bg-amber-500",
          color === "rose" && "bg-rose-500",
        )}
      />
      <span
        className={cn(
          "text-[10.5px] font-bold uppercase tracking-[0.1em]",
          color === "emerald" && "text-emerald-800",
          color === "amber" && "text-amber-800",
          color === "rose" && "text-rose-800",
        )}
      >
        Uncertainty · {label}
      </span>
      <span
        className={cn(
          "ml-auto font-mono text-[11px] tabular-nums",
          color === "emerald" && "text-emerald-700",
          color === "amber" && "text-amber-700",
          color === "rose" && "text-rose-700",
        )}
      >
        {Math.round(clamped * 100)}%
      </span>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  try {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  } catch {
    return iso;
  }
}
