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

import { useMemo } from "react";
import type { Entity, Edge } from "@/types";
import { colors, tracking } from "./tokens";

interface ClaimStackModeProps {
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
  entities,
  edges,
  selectedEntityId,
  onSelectEntity,
}: ClaimStackModeProps) {
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
        >
          {layers.claim.map((e) => (
            <ClaimCard
              key={e.id}
              entity={e}
              layer="claim"
              selected={selectedEntityId === e.id}
              onSelect={() =>
                onSelectEntity(selectedEntityId === e.id ? null : e.id)
              }
              footerNote={
                causalOutDegree.get(e.id)
                  ? `${causalOutDegree.get(e.id)} downstream effects`
                  : null
              }
            />
          ))}
        </LayerSection>

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
  children,
}: {
  label: string;
  glyph: string;
  tone: { accent: string; bg: string; fg: string };
  count: number;
  isEmpty: boolean;
  emptyHint: string;
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
