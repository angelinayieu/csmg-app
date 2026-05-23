"use client";

// Raw signal panel — left column of triple-lab.
//
// Shows only the entities/assets the USER has dropped directly (not
// chain-generated children). Each card has hover-to-reveal actions
// (Decompose / Probe / Solve / Connect / Add Related) matching the
// main canvas card-action-menu. When the concept-expansion toggle is
// on, Claude-suggested expansion chips appear under each card.

import { useCallback, useMemo, useRef, useState } from "react";
import type { Entity, Edge } from "@/types";
import { useRouter } from "next/navigation";
import { ExpansionRecommendationStrip } from "./expansion-recommendation-strip";
import { processFileDrops } from "./upload-flow";
import { useCardActions } from "./card-action-host";
import { AddRelatedStrip } from "./add-related-strip";
import { colors, tracking } from "./tokens";

// Heuristic for "this entity is raw signal, not chain-generated."
// We treat as raw: explicit source_tag from a user action OR
// asset-derived entities (papers, docs the user uploaded). We exclude
// proxy_indicator/causal_driver/proto entities that pipeline stages
// auto-create. Keep this generous so the user sees their work, not
// strict so they wonder where their cards went.
function isRawSignal(e: Entity): boolean {
  // Manual/explicit/asset → always show
  if (e.source_tag === "explicit") return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prov = (e as any).provenance as Record<string, unknown> | null | undefined;
  if (prov && typeof prov === "object") {
    const sourceType = prov.source_type;
    if (typeof sourceType === "string") {
      if (sourceType.startsWith("asset:")) return true;
      if (sourceType === "manual") return true;
      if (sourceType === "sticky") return true;
      if (sourceType === "playground_materialize") return true;
      if (sourceType === "user_seed") return true;
    }
  }
  // Reject chain-generated types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (e as any).entity_type as string | null | undefined;
  if (t === "proxy_indicator") return false;
  if (t === "causal_driver") return false;
  if (t === "expansion_component") return false;
  // Fallback: any entity that survived the early-return without an
  // explicit source_tag or asset provenance is chain-generated. The
  // "when in doubt, don't show it" branch — chain-generated entities
  // default to source_tag="inferred"/"assumed" so they get filtered
  // out here.
  return false;
}

interface RawSignalPanelProps {
  spaceId: string;
  entities: Entity[];
  edges: Edge[];
  expansionMode: boolean;
  onExpansionModeChange: (v: boolean) => void;
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  // Triggered by the drop handler once a research-class asset finishes
  // parsing — the parent owns the extraction-review drawer state and
  // opens it with this callback. Other asset classes (text, markdown,
  // image) don't call this; they materialize synchronously and just
  // need router.refresh() to render.
  onAssetReady: (
    assetId: string,
    assetName: string,
    assetClass: string | null,
  ) => Promise<void>;
}

export function RawSignalPanel({
  spaceId,
  entities,
  edges,
  expansionMode,
  onExpansionModeChange,
  selectedEntityId,
  onSelectEntity,
  onAssetReady,
}: RawSignalPanelProps) {
  const router = useRouter();
  const rawEntities = useMemo(() => entities.filter(isRawSignal), [entities]);

  // ── Drop zone ───────────────────────────────────────────────────────
  // Accepts the same MIME types as the main canvas. On drop we POST
  // multipart to /api/ingest, then trigger refresh. Tied to the
  // panel-local drag-enter counter (same pattern as the bug fix to the
  // main canvas — entry-counter > currentTarget===target).
  const [dropActive, setDropActive] = useState(false);
  const dragCount = useRef(0);
  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCount.current += 1;
    if (dragCount.current === 1) setDropActive(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCount.current = Math.max(0, dragCount.current - 1);
    if (dragCount.current === 0) setDropActive(false);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dragCount.current = 0;
      setDropActive(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0) return;
      // Delegate to the shared helper — same code path the unified
      // empty state uses, so behavior stays consistent across surfaces.
      await processFileDrops(files, {
        spaceId,
        onAssetReady,
        onRefresh: () => router.refresh(),
      });
    },
    [spaceId, router, onAssetReady],
  );

  return (
    <div
      className="flex h-full flex-col"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/60 px-5 py-4"
        style={{ background: colors.neutral.panelBgFlat }}
      >
        <div>
          <div
            className="text-[9px] font-bold uppercase text-slate-500"
            style={{ letterSpacing: tracking.eyebrow }}
          >
            ◉ Raw signal
          </div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900">
            {rawEntities.length} card{rawEntities.length === 1 ? "" : "s"}
          </div>
        </div>

        {/* Concept-expansion toggle */}
        <button
          type="button"
          onClick={() => onExpansionModeChange(!expansionMode)}
          className="relative flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium transition-all"
          style={{
            background: expansionMode
              ? colors.brand.gradient
              : colors.neutral.chipBgStrong,
            color: expansionMode ? "white" : "rgb(71, 85, 105)",
            boxShadow: expansionMode
              ? `0 6px 16px ${colors.brand.shadowStrong}`
              : "none",
          }}
        >
          <span
            style={{
              fontSize: 9,
              letterSpacing: tracking.eyebrowTight,
              textTransform: "uppercase",
            }}
          >
            ⊕ Expansion
          </span>
          <span
            className="text-[9px] font-bold uppercase tracking-wider"
            style={{ opacity: expansionMode ? 1 : 0.5 }}
          >
            {expansionMode ? "ON" : "OFF"}
          </span>
        </button>
      </div>

      {/* ── Cards list ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {rawEntities.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-2.5">
            {rawEntities.map((e) => (
              <RawSignalCard
                key={e.id}
                entity={e}
                edges={edges}
                spaceId={spaceId}
                expansionMode={expansionMode}
                selected={selectedEntityId === e.id}
                onSelect={() =>
                  onSelectEntity(selectedEntityId === e.id ? null : e.id)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Drop overlay ───────────────────────────────────────────── */}
      {dropActive && (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${colors.drop.halo} 0%, ${colors.drop.bgVignetteEnd} 80%)`,
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            className="rounded-2xl border-2 border-dashed px-6 py-5 text-center"
            style={{
              borderColor: colors.drop.borderStrong,
              background: "rgba(10, 14, 22, 0.7)",
            }}
          >
            <div
              className="text-[9px] font-bold uppercase"
              style={{
                color: colors.drop.fg,
                letterSpacing: tracking.eyebrow,
              }}
            >
              ◉ Drop to seed
            </div>
            <div className="mt-1 text-sm font-bold text-slate-50">
              Add to raw signal
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: colors.brand.bgSoft }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 2v16M2 10h16"
            stroke={colors.brand.fg}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="text-sm font-semibold text-slate-700">
        Drop a paper, paste a thought
      </div>
      <div className="mt-1 max-w-[240px] text-xs leading-relaxed text-slate-500">
        Every card you put here becomes a node. The middle panel grows
        the graph; the right panel surfaces the insights.
      </div>
    </div>
  );
}

// ── Card with hover-to-reveal action menu ────────────────────────────
function RawSignalCard({
  entity,
  edges,
  spaceId,
  expansionMode,
  selected,
  onSelect,
}: {
  entity: Entity;
  edges: Edge[];
  spaceId: string;
  expansionMode: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // Per-card "Add Related" inline panel open state. Closed by default;
  // opens when the user clicks the Related hover action. Closing
  // clears the cached suggestions (managed inside AddRelatedStrip).
  const [relatedOpen, setRelatedOpen] = useState(false);

  // Connect-mode state from the page-level host. When connectSource is
  // set AND it isn't this card, this card becomes a "pick target"
  // affordance — visual glow + click-to-pick.
  const cardActions = useCardActions();
  const isConnectSource =
    cardActions.connectSource?.id === entity.id;
  const isConnectTargetCandidate =
    cardActions.connectSource !== null && !isConnectSource;

  // Count edges touching this entity — used as a quick "this card has
  // N connections in the KG" affordance so the user can see at a
  // glance which cards are well-integrated vs. orphaned.
  const edgeCount = useMemo(
    () =>
      edges.filter(
        (e) => e.source_entity_id === entity.id || e.target_entity_id === entity.id,
      ).length,
    [edges, entity.id],
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        // Clicking a card during connect-mode-as-target picks it as
        // the target. Otherwise normal selection.
        if (isConnectTargetCandidate) {
          cardActions.pickConnectTarget(entity);
        } else {
          onSelect();
        }
      }}
      className="group relative cursor-pointer overflow-hidden rounded-xl border transition-all"
      style={{
        background: selected
          ? "linear-gradient(135deg, #FFFFFF 0%, #F5F7FF 100%)"
          : isConnectSource
          ? colors.brand.bgPanelStrong
          : isConnectTargetCandidate
          ? colors.state.leverageSoft
          : colors.neutral.panelBg,
        borderColor: selected
          ? colors.brand.halo
          : isConnectSource
          ? colors.brand.fg
          : isConnectTargetCandidate
          ? colors.state.leverage
          : colors.neutral.borderFaint,
        boxShadow:
          selected || isConnectSource
            ? `0 8px 24px ${colors.brand.shadow}`
            : hovered
            ? colors.neutral.cardShadowHover
            : colors.neutral.cardShadow,
      }}
    >
      <div className="px-4 py-3">
        {/* Eyebrow row */}
        <div className="mb-1 flex items-center gap-2">
          <div
            className="text-[8.5px] font-bold uppercase"
            style={{
              color: layerColor(entity),
              letterSpacing: tracking.eyebrowTight,
            }}
          >
            {layerLabel(entity)}
          </div>
          <div className="text-[9px] text-slate-400">·</div>
          <div className="text-[9px] font-medium text-slate-500">
            {edgeCount} edge{edgeCount === 1 ? "" : "s"}
          </div>
          {entity.is_leverage_point && (
            <div
              className="ml-auto rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
              style={{
                background: colors.state.leverageBadgeBg,
                color: colors.state.leverageFg,
              }}
            >
              Lever
            </div>
          )}
        </div>

        {/* Name */}
        <div className="text-[13px] font-semibold leading-snug text-slate-900">
          {entity.name}
        </div>

        {/* Description (truncated to one line, full on hover via title attr) */}
        {entity.description && (
          <div
            className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-600"
            title={entity.description}
          >
            {entity.description}
          </div>
        )}

        {/* Connect-mode hint banner — shown when this card is a
         *  potential target (i.e., the user clicked Connect on a
         *  different card). Replaces the hover action bar with a
         *  clearer "click to connect" affordance. */}
        {isConnectTargetCandidate && (
          <div
            className="mt-2 rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: colors.state.leverageChip,
              color: colors.state.leverageFgDark,
              letterSpacing: tracking.eyebrowTight,
            }}
          >
            → Click to connect from {cardActions.connectSource?.name}
          </div>
        )}
      </div>

      {/* ── Hover action menu ─────────────────────────────────────── */}
      {hovered && !isConnectTargetCandidate && (
        <div
          className="flex items-center justify-between gap-1 border-t border-slate-100 px-3 py-2"
          style={{ background: colors.neutral.panelBgLightest }}
        >
          <HoverAction
            icon="◇"
            label="Decompose"
            onClick={(e) => {
              e.stopPropagation();
              triggerDecompose(entity, spaceId);
            }}
          />
          <HoverAction
            icon="?"
            label="Probe"
            onClick={(e) => {
              e.stopPropagation();
              void cardActions.openProbe(entity);
            }}
          />
          <HoverAction
            icon="✦"
            label="Solve"
            onClick={(e) => {
              e.stopPropagation();
              cardActions.openSolve(entity);
            }}
          />
          <HoverAction
            icon="↔"
            label="Connect"
            onClick={(e) => {
              e.stopPropagation();
              cardActions.startConnect(entity);
            }}
          />
          <HoverAction
            icon="+"
            label="Related"
            onClick={(e) => {
              e.stopPropagation();
              setRelatedOpen(true);
            }}
          />
        </div>
      )}

      {/* ── Add Related strip (per-card) ─────────────────────────── */}
      {relatedOpen && (
        <AddRelatedStrip
          entity={entity}
          onClose={() => setRelatedOpen(false)}
        />
      )}

      {/* ── Expansion chips (Phase 2) ─────────────────────────────── */}
      {expansionMode && (
        <ExpansionRecommendationStrip
          spaceId={spaceId}
          entity={entity}
        />
      )}
    </div>
  );
}

function HoverAction({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-slate-600 transition-all hover:bg-white hover:text-slate-900 hover:shadow-sm"
    >
      <span className="font-mono text-[11px] text-slate-500 group-hover:text-indigo-600">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

// ── Action triggers ─────────────────────────────────────────────────
// Only Decompose remains as a free function — Probe / Solve / Connect /
// Related all go through the CardActionHost context now (so they can
// show modals, side panels, and cross-card pickers respectively).

function triggerDecompose(entity: Entity, spaceId: string) {
  void fetch(`/api/entities/${entity.id}/deepen?depth=medium`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ space_id: spaceId }),
  });
}

// ── Layer styling ───────────────────────────────────────────────────
// Each knowledge_layer has its own eyebrow color so the user can see
// at a glance whether a card is internal/conceptual/external/bridge.

function layerLabel(entity: Entity): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (entity as any).knowledge_layer as string | null | undefined;
  if (layer) return layer.toUpperCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cat = (entity as any).entity_category as string | null | undefined;
  if (cat) return cat.toUpperCase();
  return "CONCEPT";
}

function layerColor(entity: Entity): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (entity as any).knowledge_layer as string | null | undefined;
  switch (layer) {
    case "internal":
      return colors.layer.internal;
    case "conceptual":
      return colors.layer.conceptual;
    case "external":
      return colors.layer.external;
    case "bridge":
      return colors.layer.bridge;
    default:
      return colors.layer.unknown;
  }
}
