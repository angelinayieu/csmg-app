"use client";

// ── WhiteboardsGrid (Phase 2C secondary surface) ──
//
// The saved-whiteboards list — ported from the overnight /app page
// into a standalone component so it can live inside HomeShell as the
// "library" view alongside the immersive welcome. Behavior is
// unchanged: 3-column responsive grid of whiteboard cards, relative
// timestamps, entity/edge stat footers, link to each board.
//
// Receives `spaces` as a prop (fetched server-side by page.tsx) and
// an `onBack` callback that the shell uses to return the user to the
// welcome view. We expose a back affordance top-left so users don't
// have to rely on browser back to exit the library.

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Layers,
  Network,
  Sparkles,
} from "lucide-react";
import type { Space } from "@/types";

export interface WhiteboardsGridProps {
  spaces: Space[];
  onBack?: () => void;
}

export function WhiteboardsGrid({ spaces, onBack }: WhiteboardsGridProps) {
  return (
    <div
      className="h-full w-full overflow-y-auto"
      style={{
        background:
          "radial-gradient(circle at 30% 20%, #F8FAFF 0%, #F0F4FB 40%, #E9EEF8 100%)",
      }}
    >
      <div className="mx-auto max-w-[1280px] px-8 pb-24 pt-12">
        {/* Header row — back button + title + CTA */}
        <div className="mb-10 flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            {onBack && (
              <button
                onClick={onBack}
                className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/70 px-3 py-1 text-[11px] font-semibold text-gray-600 backdrop-blur-sm transition-all hover:-translate-x-0.5 hover:border-gray-300 hover:bg-white hover:text-gray-900"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to welcome
              </button>
            )}
            <h1 className="text-[32px] font-semibold tracking-tight text-gray-900">
              Whiteboards
            </h1>
            <p className="mt-1 text-[13.5px] text-gray-500">
              {spaces.length === 0
                ? "Start your first analysis — entities, relationships, and cycles unfurl live on the whiteboard."
                : `${spaces.length} whiteboard${spaces.length === 1 ? "" : "s"} · every analysis lives here`}
            </p>
          </div>
          <Link
            href="/app/new"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
          >
            <Sparkles className="h-3.5 w-3.5" />
            New whiteboard
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {spaces.length === 0 ? <EmptyState /> : <Grid spaces={spaces} />}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-3xl border border-gray-200/80 bg-white/90 p-12 text-center shadow-sm"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(20,30,50,0.04) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-purple-50 ring-1 ring-blue-200">
        <Sparkles className="h-6 w-6 text-blue-600" />
      </div>
      <h2 className="mb-2 text-[18px] font-semibold tracking-tight text-gray-900">
        No whiteboards yet
      </h2>
      <p className="mx-auto mb-6 max-w-md text-[13px] leading-relaxed text-gray-500">
        Describe a situation on a blank canvas. The pipeline decomposes it into
        entities, traces causal edges, detects cycles, and ranks strategies —
        all materializing in real time as you watch.
      </p>
      <Link
        href="/app/new"
        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Start first analysis
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function Grid({ spaces }: { spaces: Space[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {spaces.map((s) => (
        <WhiteboardCard key={s.id} space={s} />
      ))}
    </div>
  );
}

function WhiteboardCard({ space }: { space: Space }) {
  const snippet =
    space.description ??
    (space.input_text ? space.input_text.slice(0, 140) : null);
  const updated = formatRelative(space.updated_at);
  const entityCount = space.entity_count ?? 0;
  const edgeCount = space.edge_count ?? 0;

  return (
    <Link
      href={`/app/space/${space.id}/whiteboard`}
      className="group relative flex flex-col rounded-2xl border border-gray-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-sm"
          style={{
            background: "linear-gradient(145deg, #4fa3ff, #0051ff)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.4), 0 3px 8px rgba(0,50,180,0.18)",
          }}
        >
          {space.space_prefix ??
            (space.name ?? "SP").slice(0, 2).toUpperCase()}
        </span>
        <span className="text-[10.5px] font-medium text-gray-400">
          {updated}
        </span>
      </div>

      <h3 className="mb-1.5 line-clamp-1 text-[14.5px] font-semibold tracking-tight text-gray-900 group-hover:text-blue-900">
        {space.name}
      </h3>

      {snippet && (
        <p className="mb-4 line-clamp-3 text-[12px] leading-relaxed text-gray-500">
          {snippet}
        </p>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-gray-100 pt-3 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1">
          <Layers className="h-3 w-3 text-gray-400" />
          <strong className="font-semibold tabular-nums text-gray-700">
            {entityCount}
          </strong>
          entities
        </span>
        <span className="inline-flex items-center gap-1">
          <Network className="h-3 w-3 text-gray-400" />
          <strong className="font-semibold tabular-nums text-gray-700">
            {edgeCount}
          </strong>
          edges
        </span>
      </div>
    </Link>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const now = Date.now();
  const diffMs = now - then;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWk = Math.round(diffDay / 7);
  if (diffWk < 4) return `${diffWk}w ago`;
  const diffMo = Math.round(diffDay / 30);
  return `${diffMo}mo ago`;
}
