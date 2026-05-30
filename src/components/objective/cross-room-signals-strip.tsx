"use client";

// ── Cross-Room Signals Strip ────────────────────────────────────────
//
// Surfaces concepts the user's strategy keeps reaching for across
// sub-objective rooms. Three categories:
//
//   • Recurring mechanisms — same LLM-named lever in edges across
//     ≥2 rooms (e.g., "reward feedback loop" shows up in 3 rooms →
//     the strategy is structurally betting on this mechanism)
//   • Shared root causes — same verbatim cause / first-principle in
//     items across ≥2 rooms (convergent diagnosis or convergent
//     lever, depending on which lane)
//   • Lens convergence — same annotation index seeded items in ≥2
//     rooms (this parent-objective reading is structurally
//     load-bearing across multiple cuts)
//
// Collapsed by default — the strip is contextual, not central. Each
// signal expands to show which rooms touch it; clicking a room
// title navigates to it.

import Link from "next/link";
import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Cog,
  TreeDeciduous,
} from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  CrossRoomSignal,
  CrossRoomSignals,
} from "@/lib/objective-canvas/cross-room-signals";

interface Props {
  spaceId: string;
  signals: CrossRoomSignals;
}

export function CrossRoomSignalsStrip({ spaceId, signals }: Props) {
  const [expanded, setExpanded] = useState(false);

  const totalSignals =
    signals.mechanisms.length +
    signals.root_causes.length +
    signals.lens_convergence.length;

  if (totalSignals === 0) return null;

  return (
    <div
      className="mb-4 overflow-hidden border"
      style={{
        background: "#ffffff",
        borderColor: appleVibe.stroke.hairline,
        borderRadius: appleVibe.radius.lg,
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[rgba(15,23,42,0.015)]"
      >
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
            style={{
              background:
                "linear-gradient(180deg, rgba(15,23,42,0.06) 0%, rgba(15,23,42,0.025) 100%)",
              border: `1px solid ${appleVibe.stroke.hairline}`,
            }}
            aria-hidden
          >
            <Sparkle
              className="h-3.5 w-3.5"
              strokeWidth={1.8}
              style={{ color: appleVibe.text.secondary }}
            />
          </span>
          <div className="flex flex-col gap-0.5">
            <span
              className="text-[13px] font-semibold leading-none tracking-[-0.005em]"
              style={{ color: appleVibe.text.primary }}
            >
              Cross-room signals
            </span>
            <span
              className="text-[11px] leading-none"
              style={{ color: appleVibe.text.tertiary }}
            >
              {totalSignals} signal{totalSignals === 1 ? "" : "s"} appear in ≥2 rooms
            </span>
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors group-hover:bg-[rgba(15,23,42,0.06)]"
          style={{
            background: appleVibe.surface.chip,
            color: appleVibe.text.secondary,
          }}
        >
          {expanded ? (
            <>
              Hide <ChevronUp className="h-3 w-3" strokeWidth={2} />
            </>
          ) : (
            <>
              Show <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </>
          )}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t px-4 pb-4 pt-3" style={{ borderColor: appleVibe.stroke.hairline }}>
          {signals.lens_convergence.length > 0 && (
            <SignalSection
              spaceId={spaceId}
              icon={
                <Sparkle className="h-3 w-3" strokeWidth={2} />
              }
              title="Lens convergence"
              description="Parent-objective readings seeding items in multiple rooms"
              signals={signals.lens_convergence}
              accent="rgba(71,85,105,0.78)"
            />
          )}
          {signals.mechanisms.length > 0 && (
            <SignalSection
              spaceId={spaceId}
              icon={<Cog className="h-3 w-3" strokeWidth={2} />}
              title="Recurring mechanisms"
              description="Levers your strategy keeps reaching for across rooms"
              signals={signals.mechanisms}
              accent="rgba(37,99,235,0.78)"
            />
          )}
          {signals.root_causes.length > 0 && (
            <SignalSection
              spaceId={spaceId}
              icon={
                <TreeDeciduous className="h-3 w-3" strokeWidth={2} />
              }
              title="Shared root causes"
              description="Same verbatim cause / principle in items across rooms"
              signals={signals.root_causes}
              accent="rgba(22,163,74,0.78)"
            />
          )}
        </div>
      )}
    </div>
  );
}

function SignalSection({
  spaceId,
  icon,
  title,
  description,
  signals,
  accent,
}: {
  spaceId: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  signals: CrossRoomSignal[];
  accent: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span style={{ color: accent }}>{icon}</span>
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          {title}
        </span>
        <span
          className="text-[11px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          · {description}
        </span>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {signals.map((s, i) => (
          <li
            key={`${title}-${i}`}
            className="rounded-xl px-2.5 py-1.5"
            style={{
              background: "rgba(15,23,42,0.025)",
              border: `1px solid ${appleVibe.stroke.hairline}`,
              borderRadius: appleVibe.radius.sm,
            }}
          >
            <div className="flex items-baseline gap-1.5">
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: accent }}
                aria-hidden
              />
              <span
                className="text-[12px] font-semibold leading-tight"
                style={{ color: appleVibe.text.primary }}
                title={`${s.occurrence_count} occurrences across ${s.sub_objective_ids.length} rooms`}
              >
                {s.label}
              </span>
              <span
                className="font-mono text-[10px] font-medium"
                style={{ color: appleVibe.text.tertiary }}
              >
                {s.sub_objective_ids.length} rooms ·{" "}
                {s.occurrence_count}×
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {s.sub_objective_ids.map((subId, idx) => (
                <Link
                  key={subId}
                  href={`/app/objective/${spaceId}/sub/${subId}`}
                  className="inline-flex max-w-[200px] items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-all hover:bg-[rgba(15,23,42,0.06)]"
                  style={{
                    background: "rgba(15,23,42,0.04)",
                    color: appleVibe.text.secondary,
                    border: `1px solid ${appleVibe.stroke.hairline}`,
                  }}
                  title={s.sub_objective_titles[idx]}
                >
                  <span className="truncate">
                    {s.sub_objective_titles[idx] || "?"}
                  </span>
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
