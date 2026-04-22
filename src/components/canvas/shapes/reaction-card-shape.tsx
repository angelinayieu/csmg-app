"use client";

// ── Reaction card shape (Phase A1.1) ──
//
// First non-entity asset class shape. Renders a saved reaction as a
// compact card on the whiteboard. Following the audited pattern, the
// shape stores minimal preview props (id + visual fields cached at
// drop time); full reaction data hydrates via the existing
// CanvasReactionsContext lookup if available.
//
// Click → navigate to the reaction's lab with `?rxn=<id>` pre-focused
// (Phase 27 URL state).
// Hover → re-uses the Phase 35 ReactionHoverPreview popover for
// consistent cross-surface behavior.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { FlaskConical } from "lucide-react";
import { GroundingBadge } from "@/components/ui/grounding-badge";
import { useCanvasReactions } from "../canvas-reactions-context";
import { useCanvasHierarchy } from "../canvas-hierarchy-context";
import { ReactionHoverPreview } from "@/components/shared/reaction-preview";
import type { ReactionType } from "@/types/reactions";
import type { Entity } from "@/types";
import type { ReactionCardShape } from "./types";

const REACTION_TYPE_COLOR: Record<ReactionType, string> = {
  emergent: "#16a34a",
  reinforcing: "#0891b2",
  tension: "#db2777",
  trivial: "#64748b",
};
const REACTION_TYPE_BG: Record<ReactionType, string> = {
  emergent: "#dcfce7",
  reinforcing: "#cffafe",
  tension: "#fce7f3",
  trivial: "#f1f5f9",
};

const VALID_TYPES: readonly ReactionType[] = [
  "emergent",
  "reinforcing",
  "tension",
  "trivial",
] as const;

export class ReactionCardShapeUtil extends BaseBoxShapeUtil<ReactionCardShape> {
  static override type = "reaction-card" as const;
  static override props: RecordProps<ReactionCardShape> = {
    w: T.number,
    h: T.number,
    reactionId: T.string,
    spaceId: T.string,
    name: T.string,
    reactionType: T.literalEnum(...VALID_TYPES),
    probability: T.number,
    entityCount: T.number,
    accent: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: ReactionCardShape, info: TLResizeInfo<ReactionCardShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): ReactionCardShape["props"] {
    return {
      w: 240,
      h: 132,
      reactionId: "",
      spaceId: "",
      name: "Untitled reaction",
      reactionType: "trivial",
      probability: 0.5,
      entityCount: 0,
      accent: REACTION_TYPE_COLOR.trivial,
    };
  }

  component(shape: ReactionCardShape) {
    return <ReactionCardShapeView shape={shape} />;
  }

  indicator(shape: ReactionCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

function ReactionCardShapeView({ shape }: { shape: ReactionCardShape }) {
  const { reactionId, spaceId, name, reactionType, probability, entityCount } =
    shape.props;
  const color = REACTION_TYPE_COLOR[reactionType];
  const bg = REACTION_TYPE_BG[reactionType];
  const probPct = Math.round(probability * 100);

  // Phase 35 — hydrate the full reaction from the canvas-wide reactions
  // index for the hover preview, and resolve participants via the
  // hierarchy context's entity lookup.
  const { index } = useCanvasReactions();
  const { entityLookup } = useCanvasHierarchy();
  const all = reactionId
    ? Array.from(index.byEntity.values())
        .flatMap((s) => s.all)
        .find((r) => r.id === reactionId)
    : undefined;
  const participants: Array<Entity | null> = all
    ? all.entity_ids.map((id) => entityLookup.get(id) ?? null)
    : [];

  const labHref = (() => {
    if (!spaceId) return "";
    if (all && all.entity_ids[0]) {
      return `/app/space/${spaceId}/entity/${all.entity_ids[0]}/lab?rxn=${reactionId}`;
    }
    return `/app/space/${spaceId}/lab?rxn=${reactionId}`;
  })();

  const card = (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 14,
        overflow: "hidden",
        background: "rgba(255, 255, 255, 0.92)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(10, 30, 80, 0.08)",
        boxShadow:
          "0 8px 22px -8px rgba(8, 60, 180, 0.12), 0 3px 10px rgba(8, 60, 180, 0.06)",
        padding: "12px 14px",
        color: "#0a1020",
        fontFamily:
          '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (!labHref) return;
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey || e.button === 1) {
          window.open(labHref, "_blank");
        } else {
          window.location.href = labHref;
        }
      }}
    >
      {/* Left accent bar — same color grammar as the lab + synthesis feed. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: color,
          boxShadow: `0 0 12px ${color}55`,
        }}
      />

      {/* Header: type chip + flask glyph + probability */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
            borderRadius: 3,
            background: bg,
            color,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: color,
            }}
          />
          {reactionType}
        </span>
        <FlaskConical
          style={{ width: 12, height: 12, color: "#94a3b8", marginLeft: -2 }}
          aria-hidden
        />
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 14,
            fontWeight: 700,
            color,
            fontVariantNumeric: "tabular-nums",
          }}
          title={`Reaction plausibility ${probPct}% — LLM self-assessed, uncalibrated. Treat as reasoning aid, not statistical prediction.`}
        >
          {probPct}%
          <GroundingBadge tier="narrative" compact />
        </span>
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.25,
          color: "#0a1020",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          flex: 1,
        }}
        title={name}
      >
        {name}
      </div>

      {/* Footer: participant count + open-in-lab hint */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 9.5,
          color: "#64748b",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          letterSpacing: "0.04em",
        }}
      >
        <span>{entityCount} participants</span>
        <span style={{ color, fontWeight: 700 }}>Open in lab →</span>
      </div>
    </div>
  );

  // Wrap in hover preview only when we have a hydrated reaction.
  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "all",
      }}
    >
      {all ? (
        <ReactionHoverPreview
          reaction={all}
          participants={participants}
          openInLabHref={labHref}
        >
          {card}
        </ReactionHoverPreview>
      ) : (
        card
      )}
    </HTMLContainer>
  );
}
