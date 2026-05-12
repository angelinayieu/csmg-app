// ── Synergy processing — Rabbit holes ──
//
// Top 3 nodes by promise score (vs. the stated objective) — surface
// "which thread is most worth exploring next." Each row links back to
// the whiteboard with ?focus=<node_id> so the canvas opens at that
// node selected.

"use client";

import Link from "next/link";
import {
  ArrowRight,
  Compass,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { NodeKind, PromiseScore } from "@/lib/synergy/types";

const KIND_TONE: Record<NodeKind, string> = {
  branch: "bg-gray-100 text-gray-700",
  insight: "bg-purple-100 text-purple-700",
  question: "bg-amber-100 text-amber-700",
  action: "bg-emerald-100 text-emerald-700",
  variation: "bg-fuchsia-100 text-fuchsia-700",
  ranking: "bg-orange-100 text-orange-700",
  core: "bg-blue-100 text-blue-700",
  user: "bg-gray-100 text-gray-500",
};

interface Props {
  sessionId: string;
  scores: PromiseScore[] | null;
  loading: boolean;
  hasObjective: boolean;
  onScore: () => void;
}

export function SynergyRabbitHoles({
  sessionId,
  scores,
  loading,
  hasObjective,
  onScore,
}: Props) {
  const top = (scores ?? []).slice(0, 3);

  if (!scores) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
        <Compass className="mx-auto mb-3 h-6 w-6 text-blue-600" />
        <h2 className="text-lg font-semibold text-gray-900">
          Which rabbit hole next?
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
          Score every node on the board for how worth-it expanding it would
          be — measured against your objective and how under-explored each
          one is.
        </p>
        <button
          onClick={onScore}
          disabled={loading || !hasObjective}
          title={!hasObjective ? "Detect an objective first" : "Run promise scoring"}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02] disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Find rabbit holes
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
          <Compass className="h-3 w-3 text-blue-600" />
          Top 3 to expand next
          <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-[9px] text-gray-600">
            promise score
          </span>
        </div>
        <button
          onClick={onScore}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 transition hover:border-blue-400 disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          Re-score
        </button>
      </div>

      <ul className="mt-4 space-y-2">
        {top.map((s, i) => (
          <RabbitHoleRow key={s.node_id} sessionId={sessionId} rank={i + 1} score={s} />
        ))}
        {top.length === 0 && (
          <li className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-xs text-gray-500">
            Nothing worth expanding right now — the board may be mostly
            tangential to the objective.
          </li>
        )}
      </ul>
    </div>
  );
}

function RabbitHoleRow({
  sessionId,
  rank,
  score,
}: {
  sessionId: string;
  rank: number;
  score: PromiseScore;
}) {
  const kindTone = KIND_TONE[score.kind] ?? "bg-gray-100 text-gray-700";
  return (
    <li className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3 transition hover:border-blue-400">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-100 to-cyan-100 text-base font-semibold text-gray-900">
        {rank}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${kindTone}`}
          >
            {score.kind}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-blue-700">
            promise {Math.round(score.score)}
          </span>
          {score.child_count === 0 ? (
            <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-700">
              unexplored
            </span>
          ) : (
            <span className="font-mono text-[9px] uppercase tracking-wider text-gray-500">
              {score.child_count} child{score.child_count === 1 ? "" : "ren"}
            </span>
          )}
        </div>
        <div className="mt-1 text-sm font-semibold leading-snug text-gray-900">
          {score.label}
        </div>
        {score.why && (
          <p className="mt-1 text-[11px] leading-snug text-gray-600">{score.why}</p>
        )}
      </div>
      <Link
        href={`/app/synergy/${sessionId}?focus=${encodeURIComponent(score.node_id)}`}
        className="inline-flex shrink-0 items-center gap-1 self-start rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 transition hover:border-blue-400"
      >
        Open on board <ArrowRight className="h-3 w-3" />
      </Link>
    </li>
  );
}
