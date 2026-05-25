"use client";

// ── Main Canvas View ──
//
// Stage = "main". Shows the refined core objective in the center
// with the picked sub-objectives forking out as clickable cards.
// Clicking a sub-objective opens its room
// (/app/objective/[spaceId]/sub/[subId]) for the 4-stage layered
// analysis (Phase 5+).
//
// The center node is rendered by <AnnotatedObjectiveCard /> — the
// user's raw text with AI-extracted phrase annotations (dotted
// underlines, hover popovers, optional margin-notes mode).

import Link from "next/link";
import { ArrowRight, Check, Layers } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  AnnotatedObjectiveCard,
  type ObjectiveAnnotation,
} from "@/components/objective/annotated-objective-card";

export interface ApprovedItem {
  id: string;
  name: string;
  layer: "pain" | "features" | "outcomes" | "objective";
}

/** Tier 3 — per-lane sub-category breakdown for a sub-objective.
 *  Each row is one category that has ≥1 item in the room. The
 *  three lane arrays compose the categorical tree fork displayed
 *  on the main canvas SubCard. */
export interface LaneBreakdownRow {
  label: string;
  color: string;
  count: number;
}

/** Tier 3 — a chain archetype triple. Each entry is either the
 *  resolved category display data or null (when that item wasn't
 *  categorized). Renders as colored pips with × between. */
export interface SubCardArchetype {
  key: string;
  triple: Array<{ label: string; color: string } | null>;
  count: number;
}

export interface MainCanvasSub {
  id: string;
  title: string;
  description: string | null;
  rationale: string | null;
  /** Entities surfaced under this sub-objective after the user
   *  approved cross-layer correlations in its room (Phase 7).
   *  Empty until at least one edge is approved. */
  approvedItems: ApprovedItem[];
  generatedAt: string | null;
  /** Synthesized room-level negative outcome — populated by the
   *  room generator. Rendered under the sub title as "Counters: …"
   *  so the user sees the causal chain across the canvas. */
  topNegativeOutcome: string | null;
  /** Tier 3 — categorical tree fork per lane. Filtered to
   *  categories that have ≥1 item; sorted by count descending. */
  laneBreakdown: {
    friction: LaneBreakdownRow[];
    mechanism: LaneBreakdownRow[];
    result: LaneBreakdownRow[];
  };
  /** Total item counts per lane — what's the size of the
   *  strategy on this fork? */
  laneTotalCounts: {
    friction: number;
    mechanism: number;
    result: number;
  };
  /** Tier 3 — approved chain archetypes grouped by category
   *  triple. Empty when no chains are approved yet. */
  approvedArchetypes: SubCardArchetype[];
  /** Total number of approved chains (regardless of archetype
   *  grouping). Used in the status pip. */
  approvedPlayCount: number;
}

interface Props {
  spaceId: string;
  objective: string;
  subs: MainCanvasSub[];
  /** Server-rendered annotations on the core objective text.
   *  Empty array = not yet generated; the AnnotatedObjectiveCard
   *  will lazy-fetch on mount. */
  coreAnnotations: ObjectiveAnnotation[];
}

export function MainCanvasView({
  spaceId,
  objective,
  subs,
  coreAnnotations,
}: Props) {
  // Pass the sub list (id + title only) down so the annotated card
  // can resolve linked_sub_objective_id → title for hover popovers.
  const subStubs = subs.map((s) => ({ id: s.id, title: s.title }));

  return (
    <div className="relative mx-auto w-full max-w-5xl">
      {/* Annotated core objective — the centerpiece */}
      <AnnotatedObjectiveCard
        spaceId={spaceId}
        objective={objective}
        initialAnnotations={coreAnnotations}
        subObjectives={subStubs}
      />

      {/* Trunk → fork connector */}
      <div
        aria-hidden
        className="mx-auto mt-6 h-8 w-px"
        style={{ background: appleVibe.stroke.medium }}
      />

      {/* Sub-objective cards */}
      <div
        className="relative mx-auto mt-2 grid w-full gap-5"
        style={{
          gridTemplateColumns:
            subs.length <= 2
              ? "repeat(auto-fit, minmax(280px, 1fr))"
              : "repeat(auto-fit, minmax(260px, 1fr))",
        }}
      >
        {subs.length === 0 ? (
          <EmptyState />
        ) : (
          subs.map((sub) => (
            <SubCard key={sub.id} spaceId={spaceId} sub={sub} />
          ))
        )}
      </div>
    </div>
  );
}


function SubCard({ spaceId, sub }: { spaceId: string; sub: MainCanvasSub }) {
  const hasApproved = sub.approvedItems.length > 0;
  const status: "pending" | "generated" | "approved" = hasApproved
    ? "approved"
    : sub.generatedAt
      ? "generated"
      : "pending";

  // Categorical tree is renderable when room generation has produced
  // at least one item in any lane. Pre-generation cards stay compact.
  const hasTree =
    sub.laneTotalCounts.friction +
      sub.laneTotalCounts.mechanism +
      sub.laneTotalCounts.result >
    0;

  return (
    <Link
      href={`/app/objective/${spaceId}/sub/${sub.id}`}
      className="group relative flex flex-col gap-2 rounded-3xl p-5 transition-all"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${
          hasApproved ? "rgba(22,163,74,0.25)" : appleVibe.stroke.soft
        }`,
        boxShadow: appleVibe.shadow.card,
        borderRadius: appleVibe.radius.xl,
        fontFamily: appleVibe.font.stack,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = appleVibe.shadow.cardHover;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = appleVibe.shadow.card;
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
          style={{
            background: appleVibe.surface.chip,
            color: appleVibe.text.tertiary,
          }}
        >
          <Layers className="h-2.5 w-2.5" strokeWidth={2} />
          Sub
        </span>
        <StatusPip
          status={status}
          approvedPlayCount={sub.approvedPlayCount}
        />
      </div>

      <h3
        className="text-[15px] font-semibold leading-snug tracking-tight"
        style={{
          color: appleVibe.text.primary,
          fontFamily: appleVibe.font.display,
        }}
      >
        {sub.title}
      </h3>

      {/* Once the room has generated, the LLM-synthesized negative
          outcome IS the most useful subtitle — replaces the raw
          description. Falls back to description before generation. */}
      {sub.topNegativeOutcome ? (
        <p
          className="line-clamp-2 text-[12px] font-light italic leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          <span
            className="not-italic font-semibold"
            style={{ color: appleVibe.text.tertiary }}
          >
            Counters:
          </span>{" "}
          {sub.topNegativeOutcome}
        </p>
      ) : (
        sub.description && (
          <p
            className="line-clamp-3 text-[12.5px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {sub.description}
          </p>
        )
      )}

      {/* Categorical tree fork — Tier 3. One row per lane showing
          the dominant sub-categories with counts. Quiet typography;
          color does the work. Only renders when the room has at
          least one item. */}
      {hasTree && (
        <div
          className="mt-1 flex flex-col gap-1 rounded-2xl p-2.5"
          style={{
            background: "rgba(15,23,42,0.025)",
            border: `1px solid ${appleVibe.stroke.hairline}`,
            borderRadius: appleVibe.radius.md,
          }}
        >
          <LaneRow
            label="Problems"
            laneColor={appleVibe.stage.pain}
            total={sub.laneTotalCounts.friction}
            rows={sub.laneBreakdown.friction}
          />
          <LaneRow
            label="Mechanisms"
            laneColor={appleVibe.stage.features}
            total={sub.laneTotalCounts.mechanism}
            rows={sub.laneBreakdown.mechanism}
          />
          <LaneRow
            label="Results"
            laneColor={appleVibe.stage.outcomes}
            total={sub.laneTotalCounts.result}
            rows={sub.laneBreakdown.result}
          />
        </div>
      )}

      {/* Approved plays — Tier 3. Replaces / augments the legacy
          approved chip strip. Shows the category triples grouped
          by archetype with their counts. Quietly hides when nothing
          is approved yet. */}
      {sub.approvedArchetypes.length > 0 ? (
        <div className="mt-1">
          <div
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            {sub.approvedPlayCount} approved play
            {sub.approvedPlayCount === 1 ? "" : "s"}
          </div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {sub.approvedArchetypes.slice(0, 3).map((a) => (
              <li
                key={a.key}
                className="flex items-center gap-1 text-[10.5px]"
              >
                <ArchetypeTriple triple={a.triple} />
                {a.count > 1 && (
                  <span
                    className="font-mono text-[10px]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    ×{a.count}
                  </span>
                )}
              </li>
            ))}
            {sub.approvedArchetypes.length > 3 && (
              <li
                className="text-[10px] font-light"
                style={{ color: appleVibe.text.tertiary }}
              >
                +{sub.approvedArchetypes.length - 3} more
              </li>
            )}
          </ul>
        </div>
      ) : (
        hasApproved && <ApprovedStrip items={sub.approvedItems} />
      )}

      <div className="mt-1 flex items-center justify-between">
        {sub.rationale ? (
          <span
            className="line-clamp-1 text-[11px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
            title={sub.rationale}
          >
            {sub.rationale}
          </span>
        ) : (
          <span />
        )}
        <ArrowRight
          className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1"
          strokeWidth={2}
          style={{ color: appleVibe.text.secondary }}
        />
      </div>
    </Link>
  );
}

function StatusPip({
  status,
  approvedPlayCount,
}: {
  status: "pending" | "generated" | "approved";
  approvedPlayCount?: number;
}) {
  if (status === "approved") {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
        style={{
          background: "rgba(22,163,74,0.12)",
          color: "rgba(20,83,45,0.95)",
        }}
        title={
          approvedPlayCount
            ? `${approvedPlayCount} approved play${approvedPlayCount === 1 ? "" : "s"} ready to promote`
            : undefined
        }
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
        approved
        {approvedPlayCount && approvedPlayCount > 0 && (
          <span
            className="ml-0.5 font-mono"
            style={{ color: "rgba(20,83,45,0.7)" }}
          >
            {approvedPlayCount}
          </span>
        )}
      </span>
    );
  }
  if (status === "generated") {
    return (
      <span
        className="text-[10px] font-medium"
        style={{ color: appleVibe.text.tertiary }}
      >
        Generated · approve from the room
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-medium"
      style={{ color: appleVibe.text.tertiary }}
    >
      Pending · open the room
    </span>
  );
}

const LAYER_COLORS: Record<ApprovedItem["layer"], string> = {
  pain: appleVibe.stage.pain,
  features: appleVibe.stage.features,
  outcomes: appleVibe.stage.outcomes,
  objective: appleVibe.stage.objective,
};

function ApprovedStrip({ items }: { items: ApprovedItem[] }) {
  const max = 6;
  const shown = items.slice(0, max);
  const overflow = items.length - shown.length;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {shown.map((it) => (
        <span
          key={it.id}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            background: `${LAYER_COLORS[it.layer]}14`,
            color: LAYER_COLORS[it.layer],
            maxWidth: 200,
          }}
          title={it.name}
        >
          <span
            className="block h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: LAYER_COLORS[it.layer] }}
            aria-hidden
          />
          <span className="truncate">{it.name}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            background: appleVibe.surface.chip,
            color: appleVibe.text.tertiary,
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-3xl p-8 text-center"
      style={{
        background: appleVibe.surface.card,
        border: `1px dashed ${appleVibe.stroke.medium}`,
        borderRadius: appleVibe.radius.xl,
      }}
    >
      <p
        className="text-[13px] font-light"
        style={{ color: appleVibe.text.secondary }}
      >
        No sub-objectives are picked yet. Go back to the picker if you
        want to re-select.
      </p>
    </div>
  );
}

// ── Categorical tree primitives ───────────────────────────────────

function LaneRow({
  label,
  laneColor,
  total,
  rows,
}: {
  label: string;
  laneColor: string;
  total: number;
  rows: LaneBreakdownRow[];
}) {
  if (total === 0) return null;
  // Truncate to top 4 by count; render +N for the rest.
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const shown = sorted.slice(0, 4);
  const overflow = sorted.length - shown.length;
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-[3px] block h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: laneColor }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: laneColor }}
          >
            {label}
          </span>
          <span
            className="font-mono text-[9px]"
            style={{ color: appleVibe.text.tertiary }}
          >
            {total}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {shown.length > 0 ? (
            shown.map((r) => (
              <span
                key={r.label}
                className="inline-flex items-center gap-0.5 text-[10.5px] font-medium"
                style={{ color: r.color }}
                title={`${r.label} · ${r.count}`}
              >
                <span
                  className="block h-1 w-1 rounded-full"
                  style={{ background: r.color }}
                  aria-hidden
                />
                {r.label}
                <span
                  className="font-mono text-[9px]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {r.count}
                </span>
              </span>
            ))
          ) : (
            <span
              className="text-[10px] font-light italic"
              style={{ color: appleVibe.text.tertiary }}
            >
              uncategorized
            </span>
          )}
          {overflow > 0 && (
            <span
              className="text-[10px] font-light"
              style={{ color: appleVibe.text.tertiary }}
            >
              +{overflow}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ArchetypeTriple({
  triple,
}: {
  triple: Array<{ label: string; color: string } | null>;
}) {
  return (
    <span className="flex flex-wrap items-center gap-0.5">
      {triple.map((t, i) =>
        t ? (
          <span key={i} className="flex items-center gap-0.5">
            <span
              className="font-medium"
              style={{ color: t.color }}
            >
              {t.label}
            </span>
            {i < triple.length - 1 && triple[i + 1] && (
              <span
                className="text-[9px]"
                style={{ color: appleVibe.text.faint }}
              >
                ×
              </span>
            )}
          </span>
        ) : null,
      )}
    </span>
  );
}
