// ── Room-kind segmented control ──
//
// The top-level toggle between "Collaborations" (component_match-based
// rooms — the original Synergy concept) and "Parallel paths"
// (strategy_match-based rooms — Phase 5).
//
// Visual: Apple iOS-style pill segmented control. Two segments, active
// segment is gray-900 fill on white text, inactive is gray-500 text on
// transparent background. Each segment carries an inline count badge
// in monospace tabular numerals.
//
// Behavior: arrow-key navigation per ARIA tablist pattern, click to
// switch, animated thumb (no CSS sliding indicator — we just change
// backgrounds; the simplicity reads as Apple, not Material).

"use client";

import type { RoomKind } from "@/lib/synergy/types";

interface Props {
  value: RoomKind;
  onChange: (next: RoomKind) => void;
  collabCount: number;
  parallelCount: number;
}

const SEGMENTS: Array<{ key: RoomKind; label: string }> = [
  { key: "collaboration", label: "Collaborations" },
  { key: "parallel_path", label: "Parallel paths" },
];

export function RoomKindSegmented({
  value,
  onChange,
  collabCount,
  parallelCount,
}: Props) {
  const countFor = (k: RoomKind) =>
    k === "collaboration" ? collabCount : parallelCount;

  return (
    <div
      role="tablist"
      aria-label="Room kind"
      className="inline-flex items-center rounded-full border border-gray-200 bg-white p-0.5"
    >
      {SEGMENTS.map((seg) => {
        const active = value === seg.key;
        const count = countFor(seg.key);
        return (
          <button
            key={seg.key}
            role="tab"
            aria-selected={active}
            aria-controls={`rooms-panel-${seg.key}`}
            onClick={() => onChange(seg.key)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const otherIdx = SEGMENTS.findIndex((s) => s.key !== value);
                if (otherIdx >= 0) onChange(SEGMENTS[otherIdx].key);
              }
            }}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium tracking-tight transition",
              active
                ? "bg-gray-900 text-white"
                : "text-gray-500 hover:text-gray-900",
            ].join(" ")}
          >
            {seg.label}
            <span
              className={[
                "font-mono text-[10px] tabular-nums",
                active ? "text-white/70" : "text-gray-400",
              ].join(" ")}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
