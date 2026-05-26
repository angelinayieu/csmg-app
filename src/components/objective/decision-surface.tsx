// ── Decision Surface ──────────────────────────────────────────────
//
// Quiet, compact "what needs your attention" strip that sits at the
// top of the item-detail drawer body. Aggregates ALL pending
// decisions on this item into one scan-able list — one row per
// CATEGORY (not per item), each clickable to scroll the relevant
// section into view.
//
// Design rationale (per UI critique 2026-05-26):
//   • The drawer had grown into ~7 stacked sections, each with its
//     own header / chips / affordances. Opening it felt like reading
//     a report instead of making a decision.
//   • This surface inverts the read pattern: scan ONE strip → click
//     to act → optionally scroll the supporting depth.
//   • Renders NOTHING when there are no pending decisions, so the
//     drawer stays clean for fresh items.
//
// Visual restraint:
//   • Container is QUIET (near-white bg, hairline border). Severity
//     lives in the colored DOT per row, not in the container itself.
//     This keeps the surface from competing with the existing
//     conflicts banner + staleness banner (which DO have loud bg)
//     when both are present.
//   • Stage-style color palette (red/amber/graphite) — matches the
//     existing pain/feature/outcome color discipline.
//   • Chevron-right per row signals "navigate", not "act". The
//     in-section banners still own the action verbs (Refresh,
//     Recompose, Regenerate brief).

"use client";

import { ChevronRight } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

type Category = "conflict" | "stale" | "friction" | "pending";

interface Row {
  /** Stable React key. */
  key: string;
  /** Severity color via category. */
  category: Category;
  /** Primary line — what decision is pending. ≤ ~60 chars works
   *  best (rows have fixed height). */
  label: string;
  /** Optional secondary — relative time, count detail, or first
   *  conflict text. Truncates in the UI. */
  detail?: string;
  /** The id on the Section element to scroll into view on click. */
  anchorId: string;
  /** Optional aria-label override; defaults to label. */
  ariaLabel?: string;
}

const CATEGORY_DOT_COLOR: Record<Category, string> = {
  // Red — composition conflicts the user MUST resolve before
  // shipping. Same hue as conflicts_open banner.
  conflict: "rgba(220,38,38,0.85)",
  // Amber — staleness. Same hue as the existing staleness banner.
  stale: "rgba(217,119,6,0.85)",
  // Slightly muted red — cross-room friction is real but not the
  // same intensity as a confirmed conflict in THIS item.
  friction: "rgba(220,38,38,0.55)",
  // Graphite — opportunities / pending work the user might want to
  // attend to, but not warnings.
  pending: appleVibe.text.tertiary,
};

interface DecisionSurfaceProps {
  /** Upstream staleness (item-level, from /expand). */
  itemStaleness: StalenessShape | null;
  /** Composition staleness (from /expand or /compose cache-hit). */
  compositionStaleness: StalenessShape | null;
  /** Brief staleness map keyed by brief.id. */
  briefStalenessMap: Record<string, StalenessShape> | null;
  /** Open conflicts the composition couldn't resolve. */
  conflictsOpen: string[];
  /** Variations on this item — for pending-election count. */
  variations: VariationLite[];
  /** Briefs on this item — for total counts. */
  briefs: BriefLite[];
  /** Smooth-scroll target. Receives the anchor id; callers should
   *  document.getElementById(id)?.scrollIntoView({behavior:"smooth"}).
   *  Hoisted out so the drawer can also flash-highlight the target
   *  briefly (a future enhancement; for now caller just scrolls). */
  onJumpTo: (anchorId: string) => void;
}

export interface StalenessShape {
  is_stale: boolean;
  last_upstream_change_at: string | null;
  changes: Array<{
    source_name: string;
    kind:
      | "expand"
      | "spawn"
      | "disposition"
      | "local_variations"
      | "local_composition";
    changed_at: string;
  }>;
}

/** Minimal variation shape — keep the surface decoupled from the
 *  drawer's full ItemVariation interface so it can be reused. */
export interface VariationLite {
  id?: string;
  addresses_pain?: number;
  disposition?: "elected" | "rejected" | "deferred" | null;
}

export interface BriefLite {
  id: string;
}

/** Section anchor ids — exported so the drawer can attach them to
 *  the Section components without typo risk. */
export const DECISION_ANCHORS = {
  composedDesign: "drawer-composed-design",
  variations: "drawer-variations",
  briefs: "drawer-prototype-briefs",
  definition: "drawer-definition",
} as const;

export function DecisionSurface({
  itemStaleness,
  compositionStaleness,
  briefStalenessMap,
  conflictsOpen,
  variations,
  briefs,
  onJumpTo,
}: DecisionSurfaceProps) {
  const rows = computeRows({
    itemStaleness,
    compositionStaleness,
    briefStalenessMap,
    conflictsOpen,
    variations,
    briefs,
  });

  // Critical UX call: render NOTHING when there's nothing pending.
  // No "all clear" empty state — that's chrome for chrome's sake.
  if (rows.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Decisions needing your attention"
      className="px-3.5 pt-3 pb-2"
      style={{
        background: "rgba(15,23,42,0.025)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
        fontFamily: appleVibe.font.stack,
      }}
    >
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Needs your attention
        </span>
        <span
          className="text-[10.5px] font-light"
          style={{ color: appleVibe.text.faint }}
        >
          · {rows.length}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => onJumpTo(row.anchorId)}
              aria-label={row.ariaLabel ?? row.label}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
              style={{ background: "transparent" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(15,23,42,0.045)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: CATEGORY_DOT_COLOR[row.category] }}
                aria-hidden
              />
              <span
                className="min-w-0 flex-1 truncate text-[12px] font-medium"
                style={{ color: appleVibe.text.primary }}
              >
                {row.label}
              </span>
              {row.detail ? (
                <span
                  className="hidden truncate text-[10.5px] font-light sm:inline"
                  style={{ color: appleVibe.text.tertiary, maxWidth: "40%" }}
                >
                  {row.detail}
                </span>
              ) : null}
              <ChevronRight
                className="h-3 w-3 flex-shrink-0 transition-transform group-hover:translate-x-0.5"
                strokeWidth={2}
                style={{ color: appleVibe.text.faint }}
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Row computation ──────────────────────────────────────────────
//
// One row per CATEGORY, not per item. Ordering: conflict (highest
// severity) → stale (warnings) → friction → pending (opportunities).
//
// Soft thresholds prevent noise:
//   • Pending elections shown only when ≥2 strong (addresses_pain
//     ≥ 0.6) variations are undecided — single-pending is unworthy
//     of a top-of-drawer callout.
//   • Brief staleness aggregated to one row (count), not one row
//     per brief.

function computeRows(args: {
  itemStaleness: StalenessShape | null;
  compositionStaleness: StalenessShape | null;
  briefStalenessMap: Record<string, StalenessShape> | null;
  conflictsOpen: string[];
  variations: VariationLite[];
  briefs: BriefLite[];
}): Row[] {
  const rows: Row[] = [];

  // ── 1. Open conflicts in composed design ──
  // The loudest decision — the composition synthesizer found
  // tensions it couldn't resolve, and the user has to pick.
  if (args.conflictsOpen.length > 0) {
    const n = args.conflictsOpen.length;
    rows.push({
      key: "conflicts",
      category: "conflict",
      label:
        n === 1
          ? "1 unresolved conflict in composition"
          : `${n} unresolved conflicts in composition`,
      detail: args.conflictsOpen[0]?.slice(0, 80),
      anchorId: DECISION_ANCHORS.composedDesign,
    });
  }

  // ── 2. Item is stale vs upstream ──
  if (args.itemStaleness?.is_stale) {
    const rel = relativeShort(args.itemStaleness.last_upstream_change_at);
    rows.push({
      key: "item-stale",
      category: "stale",
      label: "Upstream cards changed — your expansion is out of date",
      detail: rel ?? undefined,
      anchorId: DECISION_ANCHORS.definition,
    });
  }

  // ── 3. Composed design is stale ──
  if (args.compositionStaleness?.is_stale) {
    const rel = relativeShort(args.compositionStaleness.last_upstream_change_at);
    rows.push({
      key: "composition-stale",
      category: "stale",
      label: "Composed design is stale",
      detail: rel ?? undefined,
      anchorId: DECISION_ANCHORS.composedDesign,
    });
  }

  // ── 4. Briefs stale (count) ──
  const staleBriefIds = Object.entries(args.briefStalenessMap ?? {})
    .filter(([, s]) => s?.is_stale)
    .map(([id]) => id);
  if (staleBriefIds.length > 0) {
    rows.push({
      key: "briefs-stale",
      category: "stale",
      label:
        staleBriefIds.length === 1
          ? "1 experiment brief is stale"
          : `${staleBriefIds.length} experiment briefs are stale`,
      anchorId: DECISION_ANCHORS.variations,
    });
  }

  // ── 5. Pending strong elections ──
  // Only worth surfacing when there are ≥2 high-addresses_pain
  // variations the user hasn't dispositioned. One pending = the
  // variations card already calls for it; not worth duplicating.
  const pendingStrong = args.variations.filter(
    (v) =>
      (v.disposition ?? null) === null && (v.addresses_pain ?? 0) >= 0.6,
  );
  if (pendingStrong.length >= 2) {
    rows.push({
      key: "pending-strong",
      category: "pending",
      label: `${pendingStrong.length} strong variations awaiting your call`,
      anchorId: DECISION_ANCHORS.variations,
    });
  }

  return rows;
}

/** Local copy of the drawer's formatRelativeShort — kept here so the
 *  surface stays self-contained. Returns short forms like "just now",
 *  "5 min ago", "2 hr ago", "3 d ago". Empty when iso is null/bad. */
function relativeShort(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const deltaSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (deltaSec < 60) return "just now";
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin} min ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr} hr ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  return `${deltaDay} d ago`;
}
