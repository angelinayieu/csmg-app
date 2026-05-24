"use client";

// ClaimStackMode — third middle-panel mode. Renders the
// knowledge graph as a vertical causal stack:
//
//   TOP    — Optimization point (causal_role='goal')
//   ↑↑↑    — Causal chain arrows (edges with dimension='causal')
//   MID    — Claims (causal_role='truth' or 'outcome')
//   ↑↑↑    — Causal chain arrows
//   BOT    — Evidence (causal_role='evidence' + linked literature)
//
// The stack reads top-down: the optimization point is what we're
// solving for; claims are the truth-statements about how to move it;
// evidence is what backs each claim.
//
// PHASE 2a (this build) — static render only. Drag-to-reorder,
// expansion tray, and causal chain arrows ship in Phases 2b/2c/2d.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Entity, Edge } from "@/types";
import { useRouter } from "next/navigation";
import { colors, tracking } from "./tokens";

interface ClaimStackModeProps {
  spaceId: string;
  entities: Entity[];
  edges: Edge[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
}

// Causal role grouping. The DB enum has 6 roles:
//   truth · evidence · deliverable · application · outcome · goal
// We collapse into 3 visual layers:
//   - GOAL (top) = goal
//   - CLAIM (middle) = truth + outcome
//   - EVIDENCE (bottom) = evidence + deliverable + application
// (deliverable/application aren't pure evidence but they're more
// concrete than claims, so they sit in the evidence layer for visual
// purposes. Subject to revision in Phase 2b once we wire weighting.)
type StackLayer = "goal" | "claim" | "evidence";
const ROLE_TO_LAYER: Record<string, StackLayer> = {
  goal: "goal",
  truth: "claim",
  outcome: "claim",
  evidence: "evidence",
  deliverable: "evidence",
  application: "evidence",
};

export function ClaimStackMode({
  spaceId,
  entities,
  edges,
  selectedEntityId,
  onSelectEntity,
}: ClaimStackModeProps) {
  const router = useRouter();

  // ── Drag-reorder state for the claim layer ─────────────────────────
  // We only allow drag on the CLAIM layer (not goal or evidence) since
  // those have semantic ordering the user shouldn't override. dragId
  // holds the currently-dragged entity id; dragOverId holds the slot
  // the user is hovering over so we can render a drop indicator.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // ── Causal arrow positioning (Phase 2d) ─────────────────────────────
  // The claim layer wrapper is position: relative so the SVG overlay
  // and the card-position math share a coordinate space. We measure
  // each card's top + height relative to this container, then bow
  // bezier curves through the right gutter to draw causal-edge arrows
  // between any two claims linked by an edge with dimension='causal'.
  const claimLayerContainerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  // Position cache: entity_id → { top, height } in container-relative
  // coords. State (not ref) so the SVG re-renders when positions
  // change after a resize / reorder / expansion-tray toggle.
  const [cardPositions, setCardPositions] = useState<
    Map<string, { top: number; height: number }>
  >(new Map());
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // Recompute positions whenever the DOM layout changes. We tap into
  // both ResizeObserver (catches expansion-tray height changes + viewport
  // resize) and the claim ordering itself (when drag reorders cards).
  useEffect(() => {
    const container = claimLayerContainerRef.current;
    if (!container) return;
    const recompute = () => {
      const cRect = container.getBoundingClientRect();
      setContainerWidth(cRect.width);
      const next = new Map<string, { top: number; height: number }>();
      cardRefs.current.forEach((el, id) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        next.set(id, {
          top: r.top - cRect.top,
          height: r.height,
        });
      });
      setCardPositions(next);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    // Also observe each individual card so expansion-tray toggles
    // trigger a recompute even when the container's total height
    // doesn't change visibly.
    cardRefs.current.forEach((el) => {
      if (el) ro.observe(el);
    });
    return () => ro.disconnect();
    // Re-run when the claim list or selection changes (selection
    // toggles the expansion tray which mutates layout).
  }, [selectedEntityId, entities, edges]);

  // After a successful drop we POST the new ordering. The endpoint
  // accepts a batch of (entity_id, weight) pairs so we send the whole
  // claim layer's new weights in one round-trip.
  const persistOrdering = async (orderedClaimIds: string[]) => {
    if (orderedClaimIds.length === 0) return;
    // Normalize positions to weights in [0, 1]. Top = 1.0, bottom near
    // 0. Linear spacing — keeps the UI's perceived gap between items
    // proportional to the position gap.
    const n = orderedClaimIds.length;
    const weights = orderedClaimIds.map((id, idx) => ({
      entity_id: id,
      weight: n === 1 ? 1 : 1 - idx / (n - 1),
    }));
    try {
      await fetch(`/api/spaces/${spaceId}/claim-weights`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weights }),
      });
      // Refresh to pull authoritative claim_weight values back into
      // the entities prop. SpaceShell SSR includes claim_weight via
      // the entities select, so the next render reflects the new
      // order even if optimistic state diverged.
      router.refresh();
    } catch (err) {
      console.warn("[claim-stack] persist ordering failed:", err);
    }
  };
  // ── Group entities by stack layer ───────────────────────────────────
  // Entities without a causal_role land in "claim" by default —
  // synthesis usually marks important entities with truth/outcome but
  // some chain-generated entities skip the tag. Better to show them
  // than hide them.
  const layers = useMemo(() => {
    const out: Record<StackLayer, Entity[]> = {
      goal: [],
      claim: [],
      evidence: [],
    };
    for (const e of entities) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const role = ((e as any).causal_role as string | null | undefined) ?? "";
      const layer = ROLE_TO_LAYER[role] ?? "claim";
      out[layer].push(e);
    }
    // Order within each layer: leverage/risk/bottleneck first
    // (synthesis has already marked these), then by edge count.
    const edgeCount = new Map<string, number>();
    for (const e of edges) {
      edgeCount.set(
        e.source_entity_id,
        (edgeCount.get(e.source_entity_id) ?? 0) + 1,
      );
      edgeCount.set(
        e.target_entity_id,
        (edgeCount.get(e.target_entity_id) ?? 0) + 1,
      );
    }
    for (const layerKey of Object.keys(out) as StackLayer[]) {
      out[layerKey].sort((a, b) => {
        // ── User-assigned claim_weight wins ──
        // If the user has drag-reordered claims, claim_weight is set
        // and authoritative. Sort by weight DESC. Items WITHOUT a
        // weight fall back to the synthesis-inferred priority.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const aw = (a as any).claim_weight as number | null | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bw = (b as any).claim_weight as number | null | undefined;
        const aHas = typeof aw === "number" && Number.isFinite(aw);
        const bHas = typeof bw === "number" && Number.isFinite(bw);
        if (aHas && bHas) return bw! - aw!;
        if (aHas && !bHas) return -1; // user-weighted first
        if (!aHas && bHas) return 1;

        // ── Fallback: synthesis-inferred priority ──
        const aPriority =
          (a.is_master_bottleneck ? 100 : 0) +
          (a.is_leverage_point ? 60 : 0) +
          (a.is_risk_point ? 40 : 0) +
          (edgeCount.get(a.id) ?? 0);
        const bPriority =
          (b.is_master_bottleneck ? 100 : 0) +
          (b.is_leverage_point ? 60 : 0) +
          (b.is_risk_point ? 40 : 0) +
          (edgeCount.get(b.id) ?? 0);
        return bPriority - aPriority;
      });
    }
    return out;
  }, [entities, edges]);

  // Total entity count drives the "empty-ness" gate
  const total =
    layers.goal.length + layers.claim.length + layers.evidence.length;

  // Build a quick lookup for entity name display + causal edge count
  // (used by EvidenceCard footer "supports N claims").
  const causalOutDegree = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dim = (e as any).dimension as string | null | undefined;
      if (dim !== "causal") continue;
      m.set(e.source_entity_id, (m.get(e.source_entity_id) ?? 0) + 1);
    }
    return m;
  }, [edges]);

  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
        <div
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: colors.brand.bgSoft }}
        >
          <span style={{ color: colors.brand.fg, fontSize: 16 }}>≡</span>
        </div>
        <div className="text-sm font-semibold text-slate-700">
          Claim stack will form here
        </div>
        <div className="mt-1 max-w-[280px] text-xs leading-relaxed text-slate-500">
          As entities land with causal roles (goal · truth · outcome ·
          evidence), they stack here top-down: optimization point →
          claims → evidence.
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      style={{ background: "white" }}
    >
      <div className="flex flex-col gap-3 px-4 py-4">
        {/* ── GOAL LAYER ────────────────────────────────────────────── */}
        <LayerSection
          label="Optimization point"
          glyph="◎"
          tone={{
            accent: colors.brand.fg,
            bg: colors.brand.bgSoft,
            fg: colors.brand.fgDark,
          }}
          count={layers.goal.length}
          isEmpty={layers.goal.length === 0}
          emptyHint="No goal entity yet. Set one via the dashboard objectives."
        >
          {layers.goal.map((e) => (
            <ClaimCard
              key={e.id}
              entity={e}
              layer="goal"
              selected={selectedEntityId === e.id}
              onSelect={() =>
                onSelectEntity(selectedEntityId === e.id ? null : e.id)
              }
              footerNote={`${causalOutDegree.get(e.id) ?? 0} downstream causal links`}
            />
          ))}
        </LayerSection>

        {/* Connector — visual cue that the goal sits above the claims */}
        {layers.goal.length > 0 && layers.claim.length > 0 && (
          <StackConnector label="supported by" />
        )}

        {/* ── CLAIM LAYER ──────────────────────────────────────────── */}
        {/* Claims are the ONLY drag-reorderable layer. Goal + Evidence
         *  stay static — semantic ordering there belongs to synthesis,
         *  not user preference. The claim layer is where the user's
         *  domain knowledge most often overrides the LLM's prior.
         *  Wrapped in a position: relative container with extra right
         *  padding so the SVG causal-arrow overlay (Phase 2d) can bow
         *  curves out to the right without clipping. */}
        <div
          ref={claimLayerContainerRef}
          className="relative"
          style={{ paddingRight: 36 }}
        >
        <LayerSection
          label="Claims"
          glyph="≡"
          tone={{
            accent: colors.state.leverage,
            bg: colors.state.leverageSoft,
            fg: colors.state.leverageFgDark,
          }}
          count={layers.claim.length}
          isEmpty={layers.claim.length === 0}
          emptyHint="No claims yet. Decompose your idea or drop a paper."
          headerHint={
            layers.claim.length > 1
              ? "drag to reorder · causal arrows on the right"
              : undefined
          }
        >
          {layers.claim.map((e, idx) => (
            // Wrap each claim card + its (conditional) expansion tray
            // in a ref'd div so the causal-arrow overlay can measure
            // its position. The div also keeps the tray spatially
            // attached to its claim card (the tray is "what this
            // specific claim breaks down into", not floating).
            <div
              key={e.id}
              ref={(el) => {
                if (el) cardRefs.current.set(e.id, el);
                else cardRefs.current.delete(e.id);
              }}
            >
              <DraggableClaimCard
                entity={e}
                isDragging={dragId === e.id}
                isDropTarget={dragOverId === e.id && dragId !== e.id}
                selected={selectedEntityId === e.id}
                onSelect={() =>
                  onSelectEntity(selectedEntityId === e.id ? null : e.id)
                }
                footerNote={
                  causalOutDegree.get(e.id)
                    ? `${causalOutDegree.get(e.id)} downstream effects`
                    : null
                }
                // Drag handlers — native HTML5 drag-and-drop, no
                // external lib. Sufficient for a single-column reorder.
                onDragStart={(ev) => {
                  setDragId(e.id);
                  ev.dataTransfer.effectAllowed = "move";
                  // Set a dummy payload so Firefox treats it as a drag
                  // (it ignores drags with empty dataTransfer).
                  ev.dataTransfer.setData("text/plain", e.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDragOverId(null);
                }}
                onDragEnter={() => {
                  if (dragId && dragId !== e.id) setDragOverId(e.id);
                }}
                onDragOver={(ev) => {
                  if (dragId && dragId !== e.id) {
                    ev.preventDefault();
                    ev.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(ev) => {
                  ev.preventDefault();
                  if (!dragId || dragId === e.id) {
                    setDragId(null);
                    setDragOverId(null);
                    return;
                  }
                  // Compute new ordering by removing the dragged item
                  // and re-inserting before the drop target.
                  const ids = layers.claim.map((x) => x.id);
                  const fromIdx = ids.indexOf(dragId);
                  const toIdx = ids.indexOf(e.id);
                  if (fromIdx === -1 || toIdx === -1) {
                    setDragId(null);
                    setDragOverId(null);
                    return;
                  }
                  const next = [...ids];
                  next.splice(fromIdx, 1);
                  const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
                  next.splice(insertAt, 0, dragId);
                  setDragId(null);
                  setDragOverId(null);
                  void persistOrdering(next);
                }}
                rankIndex={idx}
              />
              {/* Expansion tray — Phase 2c. Rendered inline below the
               *  currently-selected claim card. Shows sub-components
               *  (1-hop downstream entities via structural/functional
               *  edges) as candidate variations the user could promote
               *  to lab experiments. Lab proposals + experiment_variants
               *  integration ships in Phase 2c-extended. */}
              {selectedEntityId === e.id && (
                <ClaimExpansionTray
                  claim={e}
                  entities={entities}
                  edges={edges}
                  onSelectEntity={onSelectEntity}
                />
              )}
            </div>
          ))}
        </LayerSection>

        {/* Causal-arrow SVG overlay — Phase 2d. Renders on top of the
         *  LayerSection (pointer-events: none so it doesn't block
         *  drag/click). Bezier curves arc through the right gutter
         *  (paddingRight: 36 on the wrapper above) so they don't
         *  cross the cards themselves. */}
        <CausalArrowOverlay
          claims={layers.claim}
          edges={edges}
          positions={cardPositions}
          containerWidth={containerWidth}
        />
        </div>

        {layers.claim.length > 0 && layers.evidence.length > 0 && (
          <StackConnector label="backed by" />
        )}

        {/* ── EVIDENCE LAYER ───────────────────────────────────────── */}
        <LayerSection
          label="Evidence"
          glyph="◇"
          tone={{
            accent: colors.state.ok,
            bg: colors.state.okSoft,
            fg: colors.state.okFg,
          }}
          count={layers.evidence.length}
          isEmpty={layers.evidence.length === 0}
          emptyHint="No evidence rows yet. Effect sizes + temporal anchors land here after extraction."
        >
          {layers.evidence.map((e) => (
            <ClaimCard
              key={e.id}
              entity={e}
              layer="evidence"
              selected={selectedEntityId === e.id}
              onSelect={() =>
                onSelectEntity(selectedEntityId === e.id ? null : e.id)
              }
              footerNote={null}
            />
          ))}
        </LayerSection>
      </div>
    </div>
  );
}

// ── Layer section wrapper ──────────────────────────────────────────
// Each layer gets a labeled header + a vertical stack of claim cards.
// Empty state shown inline when a layer has no entities yet.
function LayerSection({
  label,
  glyph,
  tone,
  count,
  isEmpty,
  emptyHint,
  headerHint,
  children,
}: {
  label: string;
  glyph: string;
  tone: { accent: string; bg: string; fg: string };
  count: number;
  isEmpty: boolean;
  emptyHint: string;
  /** Optional sub-label on the header — used by the Claims layer to
   *  show "drag to reorder by impact" so the affordance is discoverable. */
  headerHint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border bg-white"
      style={{ borderColor: colors.neutral.borderFaint }}
    >
      {/* Layer header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: tone.bg }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="font-mono text-[11px] font-bold"
            style={{ color: tone.accent }}
          >
            {glyph}
          </span>
          <span
            className="text-[9px] font-bold uppercase"
            style={{ color: tone.fg, letterSpacing: tracking.eyebrow }}
          >
            {label}
          </span>
          {headerHint && (
            <span
              className="text-[8.5px] uppercase tracking-wider"
              style={{ color: tone.fg, opacity: 0.65 }}
            >
              · {headerHint}
            </span>
          )}
        </div>
        <span
          className="font-mono text-[10px] font-bold"
          style={{ color: tone.fg }}
        >
          {count}
        </span>
      </div>

      {/* Body */}
      {isEmpty ? (
        <div className="px-3 py-3 text-[10.5px] italic text-slate-500">
          {emptyHint}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 px-3 py-2.5">{children}</div>
      )}
    </div>
  );
}

// ── Connector between layers ───────────────────────────────────────
// Vertical visual link between the layer cards. Tells the user how
// to read the stack — claims "supported by" evidence, etc.
function StackConnector({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-0.5">
      <span
        className="text-[8.5px] font-bold uppercase tracking-[0.22em]"
        style={{ color: colors.neutral.fg400 }}
      >
        ↓ {label} ↓
      </span>
    </div>
  );
}

// ── Single card representing one entity in a layer ─────────────────
function ClaimCard({
  entity,
  layer,
  selected,
  onSelect,
  footerNote,
}: {
  entity: Entity;
  layer: StackLayer;
  selected: boolean;
  onSelect: () => void;
  footerNote: string | null;
}) {
  // Layer-specific accent so the user can scan the stack and read
  // "this is a goal" / "this is a claim" / "this is evidence" before
  // reading the name.
  const tone =
    layer === "goal"
      ? {
          accent: colors.brand.fg,
          bg: colors.brand.bgSoft,
          fg: colors.brand.fgDark,
        }
      : layer === "claim"
      ? {
          accent: colors.state.leverage,
          bg: colors.state.leverageSoft,
          fg: colors.state.leverageFgDark,
        }
      : {
          accent: colors.state.ok,
          bg: colors.state.okSoft,
          fg: colors.state.okFg,
        };

  // Synthesis-flagged entities get a small badge so the user can
  // see at a glance which claims are load-bearing.
  const badges: Array<{ label: string; color: string; bg: string }> = [];
  if (entity.is_master_bottleneck) {
    badges.push({
      label: "BOTTLENECK",
      color: colors.state.bottleneckFgChip,
      bg: colors.state.bottleneckChip,
    });
  }
  if (entity.is_leverage_point) {
    badges.push({
      label: "LEVER",
      color: colors.state.leverageFg,
      bg: colors.state.leverageBadgeBg,
    });
  }
  if (entity.is_risk_point) {
    badges.push({
      label: "RISK",
      color: colors.state.bottleneckFgChip,
      bg: colors.state.bottleneckChip,
    });
  }

  return (
    <div
      onClick={onSelect}
      className="cursor-pointer overflow-hidden rounded-lg border transition-all"
      style={{
        background: selected
          ? `${tone.accent}0F`
          : colors.neutral.panelBg,
        borderColor: selected ? tone.accent : colors.neutral.borderFaint,
        boxShadow: selected
          ? `0 4px 14px ${tone.accent}26`
          : colors.neutral.cardShadow,
      }}
    >
      {/* Accent stripe to color-code the layer at the row level */}
      <div style={{ height: 2, background: tone.accent }} />

      <div className="px-3 py-2">
        {/* Top row: badges + edge-count or other meta */}
        {badges.length > 0 && (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {badges.map((b) => (
              <span
                key={b.label}
                className="rounded px-1 text-[8.5px] font-bold uppercase tracking-wider"
                style={{ background: b.bg, color: b.color }}
              >
                {b.label}
              </span>
            ))}
          </div>
        )}

        {/* Name */}
        <div className="text-[12px] font-semibold leading-snug text-slate-900">
          {entity.name}
        </div>

        {/* Description (truncated) */}
        {entity.description && (
          <div
            className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-slate-600"
            title={entity.description}
          >
            {entity.description}
          </div>
        )}

        {/* Footer note — usually "N downstream effects" or evidence
         *  count. Layer-specific subtext that signals impact. */}
        {footerNote && (
          <div
            className="mt-1.5 text-[9.5px] uppercase tracking-wider"
            style={{ color: tone.fg, letterSpacing: tracking.eyebrowTight }}
          >
            {footerNote}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Draggable variant of ClaimCard (claim layer only) ───────────────
// Same visual as ClaimCard but with HTML5 drag handlers + a drag
// affordance (grip glyph) + a drop indicator (top border) when the
// card is the active drop target. Rank index (1-based) renders to
// the left of the card so the user can see the current ordering at
// a glance.
function DraggableClaimCard({
  entity,
  isDragging,
  isDropTarget,
  selected,
  onSelect,
  footerNote,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragOver,
  onDrop,
  rankIndex,
}: {
  entity: Entity;
  isDragging: boolean;
  isDropTarget: boolean;
  selected: boolean;
  onSelect: () => void;
  footerNote: string | null;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  rankIndex: number;
}) {
  // Layer tone for the claim layer (amber). Kept local so we don't
  // need to import the per-layer tone helper from ClaimCard above.
  const tone = {
    accent: colors.state.leverage,
    bg: colors.state.leverageSoft,
    fg: colors.state.leverageFgDark,
  };

  // Synthesis-flagged badges — same logic as ClaimCard.
  const badges: Array<{ label: string; color: string; bg: string }> = [];
  if (entity.is_master_bottleneck) {
    badges.push({
      label: "BOTTLENECK",
      color: colors.state.bottleneckFgChip,
      bg: colors.state.bottleneckChip,
    });
  }
  if (entity.is_leverage_point) {
    badges.push({
      label: "LEVER",
      color: colors.state.leverageFg,
      bg: colors.state.leverageBadgeBg,
    });
  }
  if (entity.is_risk_point) {
    badges.push({
      label: "RISK",
      color: colors.state.bottleneckFgChip,
      bg: colors.state.bottleneckChip,
    });
  }

  // Show the user-assigned weight as a small chip if present —
  // surfaces the persisted value back into the UI so the user can
  // tell which claims they've actively ranked.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claimWeight = (entity as any).claim_weight as
    | number
    | null
    | undefined;
  const hasManualWeight =
    typeof claimWeight === "number" && Number.isFinite(claimWeight);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onSelect}
      className="relative flex cursor-grab items-stretch overflow-hidden rounded-lg border transition-all active:cursor-grabbing"
      style={{
        background: selected
          ? `${tone.accent}0F`
          : isDragging
          ? `${tone.accent}1A`
          : colors.neutral.panelBg,
        borderColor: isDropTarget
          ? tone.accent
          : selected
          ? tone.accent
          : colors.neutral.borderFaint,
        boxShadow: selected
          ? `0 4px 14px ${tone.accent}26`
          : isDragging
          ? `0 8px 20px ${tone.accent}33`
          : colors.neutral.cardShadow,
        // Subtle scale-down while dragging so the user can tell the
        // card is "lifted" off the stack.
        transform: isDragging ? "scale(0.985)" : "scale(1)",
        opacity: isDragging ? 0.85 : 1,
        // Drop-target indicator: thicker accent top border when
        // another card is being dropped INTO this slot.
        borderTopWidth: isDropTarget ? 3 : 1,
      }}
    >
      {/* Rank index + drag grip — vertical strip on the left */}
      <div
        className="flex shrink-0 flex-col items-center justify-center gap-1 border-r px-2 py-2"
        style={{
          background: tone.bg,
          borderRightColor: `${tone.accent}33`,
        }}
      >
        {/* Rank number — 1-based */}
        <span
          className="font-mono text-[11px] font-bold"
          style={{ color: tone.accent }}
        >
          {rankIndex + 1}
        </span>
        {/* Grip glyph — affordance signal for drag */}
        <span className="font-mono text-[10px] text-slate-400">⋮⋮</span>
      </div>

      {/* Main body — same content as ClaimCard but minus the accent
       *  stripe on top (we use the rank strip on the left instead). */}
      <div className="min-w-0 flex-1 px-3 py-2">
        {(badges.length > 0 || hasManualWeight) && (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {badges.map((b) => (
              <span
                key={b.label}
                className="rounded px-1 text-[8.5px] font-bold uppercase tracking-wider"
                style={{ background: b.bg, color: b.color }}
              >
                {b.label}
              </span>
            ))}
            {hasManualWeight && (
              <span
                className="rounded px-1 text-[8.5px] font-bold uppercase tracking-wider"
                style={{ background: tone.bg, color: tone.accent }}
              >
                w {(claimWeight as number).toFixed(2)}
              </span>
            )}
          </div>
        )}
        <div className="text-[12px] font-semibold leading-snug text-slate-900">
          {entity.name}
        </div>
        {entity.description && (
          <div
            className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-slate-600"
            title={entity.description}
          >
            {entity.description}
          </div>
        )}
        {footerNote && (
          <div
            className="mt-1.5 text-[9.5px] uppercase tracking-wider"
            style={{ color: tone.fg, letterSpacing: tracking.eyebrowTight }}
          >
            {footerNote}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ClaimExpansionTray — Phase 2c ────────────────────────────────────
// Inline tray rendered immediately below a selected claim card. Shows
// "what this claim breaks down into" — 1-hop downstream entities via
// structural/functional edges. Each row is a candidate variation the
// user could promote to a lab experiment.
//
// Why these edge kinds:
//   - structural (composes / part_of / contains / has_property): claim
//     decomposes into its sub-components (variables / mechanisms)
//   - functional (enables / amplifies / gates / requires): claim
//     depends on these (what would need to be true)
//
// Causal edges (causes / contributes-to) live in Phase 2d as arrows
// BETWEEN claims, not as expansion children.
function ClaimExpansionTray({
  claim,
  entities,
  edges,
  onSelectEntity,
}: {
  claim: Entity;
  entities: Entity[];
  edges: Edge[];
  onSelectEntity: (id: string | null) => void;
}) {
  // Build a quick id → entity lookup so we don't re-scan the list.
  const byId = useMemo(() => {
    const m = new Map<string, Entity>();
    for (const e of entities) m.set(e.id, e);
    return m;
  }, [entities]);

  // 1-hop downstream entities via the kind-of edges that represent
  // decomposition / composition. Direction = OUT (claim → component).
  const children = useMemo(() => {
    const STRUCTURAL_FUNCTIONAL = new Set<string>([
      "composes",
      "part_of",
      "part-of",
      "contains",
      "has_property",
      "has-property",
      "enables",
      "amplifies",
      "gates",
      "requires",
      "is-a",
      "instance-of",
    ]);
    const out: Array<{ entity: Entity; relation: string }> = [];
    for (const e of edges) {
      if (e.source_entity_id !== claim.id) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rel = ((e as any).relationship_type as string | null) ?? "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dim = ((e as any).dimension as string | null) ?? "";
      const accept =
        STRUCTURAL_FUNCTIONAL.has(rel.toLowerCase()) ||
        dim === "structural" ||
        dim === "functional";
      if (!accept) continue;
      const child = byId.get(e.target_entity_id);
      if (!child) continue;
      out.push({ entity: child, relation: rel || dim || "relates_to" });
    }
    // Stable order: by entity name so the tray doesn't jitter across
    // refetches.
    out.sort((a, b) => a.entity.name.localeCompare(b.entity.name));
    return out;
  }, [byId, edges, claim.id]);

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{
        marginLeft: 18,
        borderColor: `${colors.state.leverage}66`,
        background: colors.state.leverageSoft,
        boxShadow: `0 4px 14px ${colors.state.leverage}1A`,
      }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-1.5"
        style={{
          borderBottomColor: `${colors.state.leverage}33`,
          background: `${colors.state.leverage}1A`,
        }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="font-mono text-[10px] font-bold"
            style={{ color: colors.state.leverage }}
          >
            ⤷
          </span>
          <span
            className="text-[8.5px] font-bold uppercase"
            style={{
              color: colors.state.leverageFgDark,
              letterSpacing: tracking.eyebrowTight,
            }}
          >
            Decomposes into · {children.length}
          </span>
        </div>
        <span
          className="text-[8.5px] uppercase tracking-wider"
          style={{ color: colors.state.leverageFgDark, opacity: 0.7 }}
        >
          candidate variations
        </span>
      </div>

      {children.length === 0 ? (
        <div className="px-3 py-2.5 text-[10.5px] italic text-slate-600">
          No structural / functional sub-components yet. Use the card
          action menu → Decompose to break this claim down.
        </div>
      ) : (
        <div className="flex flex-col gap-1 px-3 py-2">
          {children.map((c) => (
            <div
              key={c.entity.id}
              onClick={(ev) => {
                ev.stopPropagation();
                onSelectEntity(c.entity.id);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white"
            >
              <span
                className="font-mono text-[10px]"
                style={{ color: colors.state.leverage }}
              >
                ◦
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-slate-900">
                  {c.entity.name}
                </div>
                {c.entity.description && (
                  <div
                    className="line-clamp-1 text-[10px] text-slate-600"
                    title={c.entity.description}
                  >
                    {c.entity.description}
                  </div>
                )}
              </div>
              <span
                className="rounded px-1 text-[8px] font-bold uppercase tracking-wider"
                style={{
                  background: "white",
                  color: colors.state.leverageFgDark,
                  border: `1px solid ${colors.state.leverage}33`,
                }}
              >
                {c.relation.replace(/_/g, " ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CausalArrowOverlay — Phase 2d ────────────────────────────────────
// Renders SVG bezier arrows between any two claim cards linked by an
// edge with dimension='causal'. Positioned absolute inside the claim
// layer's wrapper (which has paddingRight: 36 to host the curves).
//
// Path math:
//   - Start: right edge of source card, vertically centered
//   - End:   right edge of target card, vertically centered
//   - Control point: bowed out further right by 28px so the curve
//     reads as "this flows down (or up) to that"
//   - Arrowhead marker at the END (target)
//
// pointer-events: none so the SVG never blocks drag / click on the
// cards themselves. overflow: visible because the bezier sometimes
// extends a few pixels beyond the wrapper's right edge.
function CausalArrowOverlay({
  claims,
  edges,
  positions,
  containerWidth,
}: {
  claims: Entity[];
  edges: Edge[];
  positions: Map<string, { top: number; height: number }>;
  containerWidth: number;
}) {
  // Causal edges where BOTH endpoints are claims in this layer.
  const causalArrows = useMemo(() => {
    const claimIdSet = new Set(claims.map((c) => c.id));
    const out: Array<{
      id: string;
      sourceId: string;
      targetId: string;
      confidence: number;
    }> = [];
    for (const e of edges) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dim = (e as any).dimension as string | null | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rel = ((e as any).relationship_type as string | null) ?? "";
      const isCausal =
        dim === "causal" ||
        rel === "causes" ||
        rel === "contributes_to" ||
        rel === "contributes-to" ||
        rel === "inhibits";
      if (!isCausal) continue;
      if (!claimIdSet.has(e.source_entity_id)) continue;
      if (!claimIdSet.has(e.target_entity_id)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conf = typeof (e as any).confidence === "number" ? (e as any).confidence : 0.5;
      out.push({
        id: e.id,
        sourceId: e.source_entity_id,
        targetId: e.target_entity_id,
        confidence: conf,
      });
    }
    return out;
  }, [claims, edges]);

  // Bail if we don't have positions yet (first paint before
  // ResizeObserver fires) — render an empty SVG so the layout stays
  // stable but no arrows appear yet.
  if (positions.size === 0 || containerWidth === 0) {
    return null;
  }

  // The right-edge anchor for arrows. Cards live inside the LayerSection
  // which sits in the wrapper with paddingRight=36. The cards extend to
  // approximately containerWidth - 36. We anchor arrows at the right
  // edge of the cards and bow OUT into the gutter.
  const cardRightEdge = containerWidth - 36;
  const gutterCenter = containerWidth - 18;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      style={{ overflow: "visible" }}
      width="100%"
      height="100%"
    >
      <defs>
        {/* Arrowhead marker — applied at the end of each path */}
        <marker
          id="causal-arrowhead"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path
            d="M 0 0 L 10 5 L 0 10 z"
            fill={colors.state.cycle}
          />
        </marker>
      </defs>
      {causalArrows.map((arrow) => {
        const src = positions.get(arrow.sourceId);
        const tgt = positions.get(arrow.targetId);
        if (!src || !tgt) return null;
        const y1 = src.top + src.height / 2;
        const y2 = tgt.top + tgt.height / 2;
        // Bezier control points sit in the gutter, further to the
        // right the bigger the vertical gap (so long arrows arc more
        // smoothly). cy* are derived to give an even S-curve.
        const dy = Math.abs(y2 - y1);
        const cx = gutterCenter + Math.min(20, dy / 6);
        const path = `M ${cardRightEdge} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${cardRightEdge} ${y2}`;
        return (
          <path
            key={arrow.id}
            d={path}
            fill="none"
            stroke={colors.state.cycle}
            strokeWidth={0.8 + arrow.confidence * 1.6}
            strokeOpacity={0.55 + arrow.confidence * 0.35}
            markerEnd="url(#causal-arrowhead)"
          />
        );
      })}
    </svg>
  );
}
