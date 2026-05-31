"use client";

// ── Room skeleton view + detail-mode toggle ───────────────────────
//
// A per-room "reveal or not" switch with two sides of the SAME system:
//   • Full      — the normal room (hero prose, spec rollup, the
//                 altitude views with full cards, results + pills).
//   • Skeleton  — the bare shape: the four causal stages, each listing
//                 only its item TITLES. No descriptions, no result
//                 pills, no prose. "Pure structure."
//
// Nothing is destroyed — this only changes what the room RENDERS.
// Flipping back to Full restores everything. The choice persists per
// room via useLocalPref (see sub-objective-room-view), so a room
// remembers which side you left it on.
//
// Titles stay clickable so the skeleton is a navigation surface, not a
// dead-end: click any node to open its detail drawer.

import { appleVibe } from "@/lib/apple-vibe-tokens";

// Minimal structural shapes — typed locally so this file stays
// decoupled from the room view's exported interfaces (parallel-edit
// safety). The room passes its full RoomLane[]; structural typing makes
// the richer objects assignable to these subsets.
interface SkeletonItem {
  id: string;
  name: string;
}
interface SkeletonLane {
  slug: "pain" | "features" | "outcomes" | "objective";
  label: string;
  color: string;
  items: SkeletonItem[];
}

// Causal order — the system reads left → right as a pipeline:
// pains feed the features that bridge them to outcomes, which roll up
// to the room objective. Mirrors the stage order used elsewhere.
const STAGE_ORDER: SkeletonLane["slug"][] = [
  "pain",
  "features",
  "outcomes",
  "objective",
];

// ── Detail-mode toggle ────────────────────────────────────────────
// Segmented control matching ViewToggleInline exactly so it reads as a
// peer room control. Two sides: Full (everything) ↔ Skeleton (shape).
export function RoomDetailToggle({
  skeleton,
  onChange,
}: {
  skeleton: boolean;
  onChange: (next: boolean) => void;
}) {
  const options: Array<{ key: boolean; label: string; hint: string }> = [
    {
      key: false,
      label: "Full",
      hint: "Full detail — definitions, the feature spec, and the cards with results",
    },
    {
      key: true,
      label: "Skeleton",
      hint: "Bare structure — just the stages and item titles, no descriptions or results",
    },
  ];
  return (
    <div
      className="inline-flex items-center"
      style={{
        background: appleVibe.surface.chip,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.pill,
        padding: 2,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {options.map((opt) => {
        const active = skeleton === opt.key;
        return (
          <button
            key={String(opt.key)}
            type="button"
            onClick={() => onChange(opt.key)}
            title={opt.hint}
            aria-pressed={active}
            className="inline-flex items-center px-3 py-1 text-[11px] font-semibold transition-all duration-150 ease-out"
            style={{
              background: active ? appleVibe.surface.card : "transparent",
              color: active ? appleVibe.text.primary : appleVibe.text.tertiary,
              borderRadius: appleVibe.radius.pill,
              boxShadow: active ? appleVibe.shadow.chip : "none",
              letterSpacing: "0.02em",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Skeleton view ─────────────────────────────────────────────────
export function RoomSkeletonView({
  lanes,
  onOpenItem,
}: {
  lanes: SkeletonLane[];
  onOpenItem: (id: string) => void;
}) {
  const bySlug = new Map(lanes.map((l) => [l.slug, l] as const));
  const ordered = STAGE_ORDER.map((slug) => bySlug.get(slug)).filter(
    (l): l is SkeletonLane => Boolean(l),
  );

  if (ordered.length === 0) return null;

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* A single quiet caption so the stripped view reads as
          intentional, not broken. */}
      <p
        className="mb-3 text-[11.5px] font-normal"
        style={{ color: appleVibe.text.tertiary }}
      >
        Skeleton · titles only — click any node to open its detail.
      </p>

      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        {ordered.map((lane) => (
          <div key={lane.slug}>
            {/* Stage header — lane-colored dot + label + count. */}
            <div className="mb-2 flex items-center gap-2">
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ background: lane.color }}
                aria-hidden
              />
              <span
                className="text-[12.5px] font-semibold leading-tight"
                style={{
                  color: appleVibe.text.primary,
                  letterSpacing: "-0.006em",
                }}
              >
                {lane.label}
              </span>
              <span
                className="text-[11px] font-semibold tabular-nums"
                style={{ color: appleVibe.text.faint }}
              >
                {lane.items.length}
              </span>
            </div>

            {/* Titles only. */}
            {lane.items.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
                {lane.items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => onOpenItem(it.id)}
                      className="group flex w-full items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors duration-150"
                      style={{ cursor: "pointer" }}
                      title={it.name}
                    >
                      <span
                        className="mt-[2px] h-1 w-1 flex-shrink-0 rounded-full transition-colors duration-150"
                        style={{ background: appleVibe.text.faint }}
                        aria-hidden
                      />
                      <span
                        className="truncate text-[12.5px] font-medium leading-snug transition-colors duration-150 group-hover:underline"
                        style={{ color: appleVibe.text.secondary }}
                      >
                        {it.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p
                className="px-1.5 text-[11.5px] italic"
                style={{ color: appleVibe.text.faint }}
              >
                —
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
