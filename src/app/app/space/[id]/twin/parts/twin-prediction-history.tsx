"use client";

// ── Prediction history ─────────────────────────────────────────────
//
// Compact timeline of the most recent predictions the twin has made.
// Each row: kind glyph, summary, created date, resolution status
// (resolved vs awaiting outcome). The bundle endpoint caps this at
// the last 20, so the page never pulls a runaway history.
//
// Empty state explains how predictions get generated, so the user
// understands what fills this list.

import { PredictionIcon } from "@/components/twin/icons/twin-icons";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

type Prediction = TwinPageBundle["prediction_history"][number];

interface Props {
  predictions: Prediction[];
}

const KIND_LABEL: Record<string, string> = {
  outcome: "Outcome",
  trajectory: "Trajectory",
  entity_state: "Entity state",
  goal_progress: "Goal progress",
  scenario: "Scenario",
};

export function TwinPredictionHistory({ predictions }: Props) {
  return (
    <article
      className="rounded-2xl"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
      }}
    >
      <header className="flex items-center justify-between border-b border-black/[0.04] px-6 py-3.5">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
          <PredictionIcon size={11} />
          Recent predictions
        </div>
        <span className="text-[10.5px] text-gray-400">
          Last {predictions.length}
        </span>
      </header>

      {predictions.length === 0 ? (
        <div className="px-6 py-6 text-[13px] leading-relaxed text-gray-500">
          No predictions yet. Run a what-if from the canvas or trigger
          a prediction mechanism — those events feed this ledger so
          you can score the twin against reality later.
        </div>
      ) : (
        <ul className="divide-y divide-black/[0.04]">
          {predictions.slice(0, 20).map((p) => (
            <PredictionRow key={p.id} prediction={p} />
          ))}
        </ul>
      )}
    </article>
  );
}

// ── Per-row ───────────────────────────────────────────────────────

function PredictionRow({ prediction }: { prediction: Prediction }) {
  const kindLabel = KIND_LABEL[prediction.prediction_kind] ?? prediction.prediction_kind;
  const resolved = prediction.resolved_at !== null;
  return (
    <li className="flex items-start gap-4 px-6 py-3.5">
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
        style={{
          background: "rgba(15,23,42,0.04)",
          color: "var(--accent-500)",
        }}
      >
        <PredictionIcon size={11} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">
            {kindLabel}
          </span>
          <span className="text-[10.5px] text-gray-400">
            · {formatRelative(prediction.created_at)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-gray-700">
          {prediction.summary || "—"}
        </p>
      </div>
      <span
        className={`flex-shrink-0 text-[10.5px] font-medium ${
          resolved ? "text-emerald-600" : "text-gray-400"
        }`}
      >
        {resolved ? "Resolved" : "Pending"}
      </span>
    </li>
  );
}

// ── Relative-time helper ───────────────────────────────────────────

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const min = Math.round(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.round(day / 30);
    return `${mo}mo ago`;
  } catch {
    return "—";
  }
}
