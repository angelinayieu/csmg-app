"use client";

// ── Sub-Objective Room View ──
//
// Two-column layout: 4 lanes on the left, docked correlation side
// panel on the right (Phase 7). The side panel emits the
// currently-hovered edge's source+target entity ids, which the lanes
// read to highlight matching items.
//
// Approvals are kept locally (Set<edgeId>) and synced through the
// /api/brainstorm/room/edges/approve endpoint. Optimistic updates;
// reverts on failure. Survives navigation because the next server
// render re-derives the approved set from edges.approved_at.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { CorrelationSidePanel } from "./correlation-side-panel";
import type { PipelineMode } from "./mode-pill";

export interface LayerItem {
  id: string;
  name: string;
  description: string | null;
  entity_type: string;
}

export interface RoomEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  strength: number | null;
  polarity: string | null;
  conditions: string | null;
  approved_at?: string | null;
}

export interface RoomLane {
  slug: "pain" | "features" | "outcomes" | "objective";
  label: string;
  color: string;
  items: LayerItem[];
}

interface Props {
  spaceId: string;
  subObjectiveId: string;
  lanes: RoomLane[];
  edges: RoomEdge[];
  /** room_layers_generated_at — null = never generated. */
  generatedAt: string | null;
  /** "autopilot" auto-fires generation on first mount; "review_each"
   *  waits for the user's explicit click. */
  pipelineMode: PipelineMode;
}

export function SubObjectiveRoomView({
  spaceId,
  subObjectiveId,
  lanes,
  edges,
  generatedAt,
  pipelineMode,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [approvedEdgeIds, setApprovedEdgeIds] = useState<Set<string>>(() => {
    return new Set(
      edges.filter((e) => e.approved_at != null).map((e) => e.id),
    );
  });

  // ── Autopilot auto-fire ──
  // In autopilot mode, kick off generation the first time the user
  // lands on an ungenerated room. Guarded so it only fires once per
  // mount (avoids a loop if the API soft-fails). In review_each mode
  // we wait for the explicit click.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (pipelineMode !== "autopilot") return;
    if (generatedAt) return;
    autoFiredRef.current = true;
    void generate("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineMode, generatedAt]);

  const isEmpty = lanes.every(
    (l) =>
      l.items.length === 0 ||
      (l.items.length === 1 && l.slug === "objective"),
  );

  const entityIndex = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        layer: "pain" | "features" | "outcomes" | "objective";
      }
    >();
    for (const lane of lanes) {
      for (const item of lane.items) {
        map.set(item.id, { id: item.id, name: item.name, layer: lane.slug });
      }
    }
    return map;
  }, [lanes]);

  function generate(mode: "initial" | "regenerate") {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/brainstorm/room/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, subObjectiveId, mode }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error ?? "Generation failed. Try again.");
          return;
        }
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Network error. Try again.",
        );
      }
    });
  }

  function handleApprovalChange(edgeId: string, approved: boolean) {
    setApprovedEdgeIds((prev) => {
      const next = new Set(prev);
      if (approved) next.add(edgeId);
      else next.delete(edgeId);
      return next;
    });
  }

  const hasEdges = edges.length > 0;
  const approvedCount = approvedEdgeIds.size;

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            4-stage room
          </div>
          <h2
            className="mt-1 text-[18px] font-semibold tracking-tight"
            style={{
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.display,
              letterSpacing: "-0.015em",
            }}
          >
            {generatedAt
              ? "Pain → Features → Outcomes → Objective"
              : "Ready to generate"}
          </h2>
          {!generatedAt && (
            <p
              className="mt-1 text-[12.5px] font-light"
              style={{ color: appleVibe.text.secondary }}
            >
              We&rsquo;ll spin out pain points first, then outcomes, then
              the features that bridge them. Cross-layer correlations
              live in the side panel on the right.
            </p>
          )}
          {generatedAt && approvedCount > 0 && (
            <p
              className="mt-1 text-[11.5px] font-light"
              style={{ color: appleVibe.text.secondary }}
            >
              {approvedCount} correlation{approvedCount === 1 ? "" : "s"}{" "}
              approved — ready to promote to the main canvas (Phase 8).
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {generatedAt && (
            <button
              type="button"
              onClick={() => generate("regenerate")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
              style={{
                background: appleVibe.surface.chip,
                color: appleVibe.text.secondary,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              <RefreshCw className="h-3 w-3" strokeWidth={2} />
              Regenerate
            </button>
          )}
          {!generatedAt && (
            <button
              type="button"
              onClick={() => generate("initial")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-[12.5px] font-semibold"
              style={{
                background: appleVibe.accent.primary,
                color: appleVibe.text.onAccent,
                borderRadius: appleVibe.radius.md,
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.7 : 1,
              }}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              <span>{busy ? "Generating…" : "Generate the room"}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl px-3.5 py-2.5 text-[12.5px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "rgba(127,29,29,0.95)",
          }}
        >
          {error}
        </div>
      )}

      {/* Two-column layout: lanes (left) + side panel (right) */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="grid gap-3 sm:grid-cols-2">
            {lanes.map((lane) => (
              <Lane
                key={lane.slug}
                lane={lane}
                loading={busy && isEmpty}
                highlightedIds={highlightedIds}
              />
            ))}
          </div>
        </div>
        {hasEdges && (
          <CorrelationSidePanel
            spaceId={spaceId}
            subObjectiveId={subObjectiveId}
            edges={edges}
            entityIndex={entityIndex}
            approvedEdgeIds={approvedEdgeIds}
            onApprovalChange={handleApprovalChange}
            onHighlightChange={setHighlightedIds}
          />
        )}
      </div>
    </div>
  );
}

// ── Lane ───────────────────────────────────────────────────────────

function Lane({
  lane,
  loading,
  highlightedIds,
}: {
  lane: RoomLane;
  loading: boolean;
  highlightedIds: Set<string>;
}) {
  return (
    <div
      className="flex min-h-[260px] flex-col rounded-3xl p-4"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.xl,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ background: lane.color }}
            aria-hidden
          />
          <h3
            className="text-[13px] font-semibold tracking-tight"
            style={{ color: appleVibe.text.primary }}
          >
            {lane.label}
          </h3>
        </div>
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            background: appleVibe.surface.chip,
            color: appleVibe.text.tertiary,
          }}
        >
          {lane.items.length}
        </span>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {lane.items.length === 0 && loading && (
          <>
            <SkeletonItem />
            <SkeletonItem />
          </>
        )}
        {lane.items.length === 0 && !loading && (
          <li
            className="rounded-2xl border border-dashed px-3 py-3 text-center text-[11.5px] font-light"
            style={{
              borderColor: appleVibe.stroke.hairline,
              color: appleVibe.text.tertiary,
              borderRadius: appleVibe.radius.md,
            }}
          >
            empty
          </li>
        )}
        {lane.items.map((item) => {
          const highlighted = highlightedIds.has(item.id);
          const dim = highlightedIds.size > 0 && !highlighted;
          return (
            <li
              key={item.id}
              className="rounded-2xl px-3 py-2.5 transition-all"
              style={{
                background: highlighted
                  ? `${lane.color}14`
                  : appleVibe.surface.base,
                border: `1px solid ${
                  highlighted ? lane.color : appleVibe.stroke.hairline
                }`,
                borderRadius: appleVibe.radius.md,
                opacity: dim ? 0.45 : 1,
                transform: highlighted ? "translateX(2px)" : "translateX(0)",
              }}
            >
              <div
                className="text-[12.5px] font-semibold leading-snug"
                style={{ color: appleVibe.text.primary }}
              >
                {item.name}
              </div>
              {item.description && (
                <p
                  className="mt-1 text-[11.5px] font-light leading-snug"
                  style={{ color: appleVibe.text.secondary }}
                >
                  {item.description}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SkeletonItem() {
  return (
    <li
      className="h-14 rounded-2xl"
      style={{
        background: appleVibe.surface.chip,
        borderRadius: appleVibe.radius.md,
      }}
    />
  );
}
