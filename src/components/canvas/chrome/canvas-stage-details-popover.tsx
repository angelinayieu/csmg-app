"use client";

// ── Canvas stage details popover ──
//
// Sidecar panel that opens when the user clicks a chip in the
// CanvasStageIndicator. Renders a per-stage summary so the user can
// see what each pipeline phase actually produced — closes the gap
// between the strip's one-word labels and the underlying artifacts.
//
// The popover is positional (renders below the strip, top-center) and
// dismissable (click X, click outside, click the same chip again). One
// popover at a time.
//
// Per-stage content is hand-curated rather than generated: each stage
// has its own info-density target. Intake = the prompt that started
// it all. Landscape (Breadth) = the framing panel verdict + CTA to
// the picker. KG (Depth) = entity/edge counts + per-axis breakdown.
// Proposal (Weave) = strategy summary + CTA to /strategy. Lab = pending.
// Results = run summary.

import Link from "next/link";
import { useMemo } from "react";
import { X, ExternalLink, Layers, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "@/types/pipeline-events";
import {
  useEventsOfType,
  useRunStatus,
} from "../hooks/run-event-store";
import { useSituationFrame } from "../situation-frame-context";

interface Props {
  stage: PipelineStage;
  spaceId: string;
  onClose: () => void;
}

const STAGE_TITLE: Record<PipelineStage, string> = {
  intake: "Intake — parsing the prompt",
  landscape: "Breadth — opening lenses",
  kg: "Depth — building the knowledge graph",
  proposal: "Weave — ranking strategies",
  twin: "Twin — committing strategy + mechanisms",
  lab: "Test — proposing experiments",
  reflexive: "Reflexive — calibration + coverage",
  results: "Done — run finalized",
};

const STAGE_BLURB: Record<PipelineStage, string> = {
  intake:
    "The classifier reads the prompt, decides what kind of input it is, and opens a placeholder space + pipeline run.",
  landscape:
    "Five framing lenses argue about how to frame the situation. Their consensus picks which axes the canvas will populate.",
  kg:
    "Per-axis generators write entities + edges + cycles into the graph. Each axis becomes a probability-space shell on canvas.",
  proposal:
    "Synthesis reads the graph and ranks strategic recommendations. Top-ranked strategy lands as a hero card.",
  twin:
    "Approved strategy commits a Twin proposal with mechanism rows + apps + interventions.",
  lab:
    "Generated experiments and labs to test the highest-leverage assumptions. Optional — runs when a strategy is committed.",
  reflexive:
    "Background calibration: prospector, coverage audit, edge-drift heatmap. Surfaces gaps and stale findings.",
  results:
    "Run finalized. Final entity/edge counts persisted. Coverage and prediction-ledger entries committed.",
};

export function CanvasStageDetailsPopover({ stage, spaceId, onClose }: Props) {
  return (
    <div
      className={cn(
        "pointer-events-auto absolute left-1/2 top-14 z-[39] -translate-x-1/2",
        "w-[360px] rounded-2xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur-md",
        "animate-in fade-in slide-in-from-top-2 duration-200",
      )}
    >
      <div className="flex items-start justify-between border-b border-slate-100 px-4 py-2.5">
        <div>
          <div className="text-[11px] font-semibold text-slate-700">
            {STAGE_TITLE[stage]}
          </div>
          <div className="mt-0.5 text-[10.5px] leading-snug text-slate-500">
            {STAGE_BLURB[stage]}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-2 flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close stage details"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-[360px] overflow-y-auto px-4 py-3">
        {stage === "intake" && <IntakeBody />}
        {stage === "landscape" && <LandscapeBody spaceId={spaceId} />}
        {stage === "kg" && <KgBody spaceId={spaceId} />}
        {stage === "proposal" && <ProposalBody spaceId={spaceId} />}
        {stage === "lab" && <LabBody />}
        {stage === "results" && <ResultsBody />}
      </div>
    </div>
  );
}

function IntakeBody() {
  // The intake stage doesn't emit a dedicated classification event on
  // the bus today — data_presence + situation_frame both ride inside
  // spaces.* columns rather than as their own event types. Surfacing
  // the prompt itself requires a /api/spaces/[id] hit which we'd
  // rather not gate the popover open behind. So the intake body stays
  // intentionally minimal: name the stage, lean on the blurb at top,
  // and link the user to where the prompt + classification actually
  // live (the framing pick page renders them in context).
  return (
    <div className="text-[10.5px] italic text-slate-400">
      The prompt + data-presence classification ride on the space row
      itself (no dedicated bus events). Open the framing-pick page from
      the Breadth chip below to see the prompt alongside the lens
      verdicts that interpreted it.
    </div>
  );
}

function LandscapeBody({ spaceId }: { spaceId: string }) {
  // The richest stage to detail: read the situation frame and surface
  // the lens roster, axis count, divergences, candidate framings count.
  const { frame, surfaceDivergences, candidateFramings } = useSituationFrame();

  if (!frame) {
    return (
      <div className="text-[10.5px] italic text-slate-400">
        Framing panel hasn&apos;t emitted yet. The frame appears here
        once the 5-lens consensus pass completes.
      </div>
    );
  }

  const lensesUsed = frame.lenses_used ?? [];
  const axesCount = frame.axes?.length ?? 0;
  const adHocCount = (frame.axes ?? []).filter(
    (a) => a.source === "ad_hoc",
  ).length;

  return (
    <div className="space-y-3 text-[11px] text-slate-700">
      <div className="grid grid-cols-3 gap-3 text-[10.5px]">
        <Stat label="lenses ran" value={String(lensesUsed.length)} />
        <Stat label="axes opened" value={String(axesCount)} />
        <Stat
          label="ad-hoc"
          value={String(adHocCount)}
          mute={adHocCount === 0}
        />
      </div>

      {lensesUsed.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">
            Lenses
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {lensesUsed.map((id) => (
              <span
                key={id}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
              >
                {id.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}

      {typeof frame.framing_confidence === "number" && (
        <div className="text-[10.5px] text-slate-500">
          Panel confidence:{" "}
          <span className="font-semibold text-slate-700">
            {Math.round(frame.framing_confidence * 100)}%
          </span>
          {frame.gate_status && frame.gate_status !== "pass" && (
            <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-medium text-amber-700">
              {frame.gate_status.replace(/_/g, " ")}
            </span>
          )}
        </div>
      )}

      {(surfaceDivergences.length > 0 || candidateFramings.length > 1) && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-[10.5px]">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-600" />
            <div className="flex-1">
              {surfaceDivergences.length > 0 && (
                <div className="text-amber-800">
                  {surfaceDivergences.length} lens disagreement
                  {surfaceDivergences.length === 1 ? "" : "s"} preserved
                </div>
              )}
              {candidateFramings.length > 1 && (
                <div className="mt-0.5 text-amber-800">
                  {candidateFramings.length} alternative framings on file
                </div>
              )}
              <Link
                href={`/app/space/${spaceId}/framing`}
                className="mt-1 inline-flex items-center gap-1 font-medium text-amber-900 underline-offset-2 hover:underline"
              >
                Compare framings <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KgBody({ spaceId }: { spaceId: string }) {
  // Count what's been emitted on the bus. The run-event store only
  // tracks the active run; for a post-run mount the counts come back as
  // zero, which is honest — we don't pretend to know.
  const entityEvents = useEventsOfType("entity_added");
  const edgeEvents = useEventsOfType("edge_added");
  const cycleEvents = useEventsOfType("cycle_detected");
  const spaceOpened = useEventsOfType("space_opened");

  const axes = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of spaceOpened) {
      if (e.event.type === "space_opened") {
        map.set(e.event.spaceKey, e.event.label);
      }
    }
    return Array.from(map.values());
  }, [spaceOpened]);

  const hasLive =
    entityEvents.length > 0 || edgeEvents.length > 0 || cycleEvents.length > 0;

  return (
    <div className="space-y-3 text-[11px] text-slate-700">
      {hasLive ? (
        <div className="grid grid-cols-3 gap-3 text-[10.5px]">
          <Stat label="entities" value={String(entityEvents.length)} />
          <Stat label="edges" value={String(edgeEvents.length)} />
          <Stat
            label="cycles"
            value={String(cycleEvents.length)}
            mute={cycleEvents.length === 0}
          />
        </div>
      ) : (
        <div className="text-[10.5px] italic text-slate-400">
          Counts shown live during a run. For the full catalog use the
          Entities / Edges browser.
        </div>
      )}

      {axes.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">
            Axes opened ({axes.length})
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {axes.slice(0, 8).map((label) => (
              <span
                key={label}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
              >
                {label}
              </span>
            ))}
            {axes.length > 8 && (
              <span className="text-[10px] text-slate-400">
                +{axes.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-slate-100 pt-2 text-[10.5px]">
        <Link
          href={`/app/space/${spaceId}/entities`}
          className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900"
        >
          <Layers className="h-3 w-3" />
          Entities
        </Link>
        <span className="text-slate-300">·</span>
        <Link
          href={`/app/space/${spaceId}/edges`}
          className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900"
        >
          Edges
        </Link>
      </div>
    </div>
  );
}

function ProposalBody({ spaceId }: { spaceId: string }) {
  const proposalEvents = useEventsOfType("proposal_ready");
  const heroProposal = useMemo(() => {
    for (let i = proposalEvents.length - 1; i >= 0; i--) {
      const e = proposalEvents[i];
      if (e.event.type === "proposal_ready") return e.event;
    }
    return null;
  }, [proposalEvents]);

  return (
    <div className="space-y-3 text-[11px] text-slate-700">
      {heroProposal ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">
            Top ranked proposal
          </div>
          <div className="mt-1 font-medium text-slate-700">
            {("title" in heroProposal && typeof heroProposal.title === "string"
              ? heroProposal.title
              : "Strategy proposal") as string}
          </div>
        </div>
      ) : (
        <div className="text-[10.5px] italic text-slate-400">
          No strategy ranked yet. The proposal lands here once synthesis
          completes.
        </div>
      )}

      <Link
        href={`/app/space/${spaceId}/strategy`}
        className="inline-flex items-center gap-1 text-[10.5px] font-medium text-slate-700 hover:text-slate-900"
      >
        Open strategy view <ExternalLink className="h-2.5 w-2.5" />
      </Link>
    </div>
  );
}

function LabBody() {
  return (
    <div className="text-[10.5px] italic text-slate-400">
      Lab stage runs when a strategy is committed. Generated experiments
      and lab options will appear here.
    </div>
  );
}

function ResultsBody() {
  const status = useRunStatus();
  return (
    <div className="space-y-2 text-[11px] text-slate-700">
      <div className="text-[10.5px] text-slate-500">
        Run status:{" "}
        <span
          className={cn(
            "font-semibold",
            status === "completed" && "text-emerald-700",
            status === "failed" && "text-red-700",
            status === "timeout" && "text-amber-700",
          )}
        >
          {status ?? "—"}
        </span>
      </div>
      <div className="text-[10.5px] italic text-slate-400">
        Final counts + prediction-ledger entries persisted. Continue
        editing — the canvas is yours now.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mute,
}: {
  label: string;
  value: string;
  mute?: boolean;
}) {
  return (
    <div>
      <div
        className={cn(
          "text-[18px] font-semibold leading-none",
          mute ? "text-slate-400" : "text-slate-700",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[9.5px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
    </div>
  );
}
