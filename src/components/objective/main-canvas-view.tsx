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
        <StatusPip status={status} />
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

      {/* Approved-layer chip strip — Phase 8. Only renders when the
          user has approved cross-layer correlations in the room. */}
      {hasApproved && <ApprovedStrip items={sub.approvedItems} />}

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
}: {
  status: "pending" | "generated" | "approved";
}) {
  if (status === "approved") {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
        style={{
          background: "rgba(22,163,74,0.12)",
          color: "rgba(20,83,45,0.95)",
        }}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
        approved
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
