"use client";

// ── SubsystemKgShapeUtil ──────────────────────────────────────────
//
// A single mechanism's "specialized knowledge graph" — its
// problem → mechanism → solution triad — placed on the objective
// whiteboard as a self-contained card. Distinct from:
//   • room-card     → a whole room, collapsed
//   • artifact-card → ONE room item (a single pain/feature/outcome)
//   • subsystem-kg  → the scoped TRIAD around one mechanism (this)
//
// It carries a LIGHTWEIGHT snapshot in props (chip labels + counts, never
// the full MechanismSpec) so it renders standalone on the canvas altitude,
// where no single room's lanes/edges are in scope. "Open in room" fires the
// shared OPEN_ROOM_EVENT (the shell re-enters that room) with the mechanism
// id as an additive focus hint — reusing RoomAltitudeMap's `?focus=` seam.
//
// No app context. Collision-safe NEW file; consumes only board primitives.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { ArrowRight, GripVertical, Workflow } from "lucide-react";
import { OPEN_ROOM_EVENT } from "./room-card-shape";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export type SubsystemKgShape = TLBaseShape<
  "subsystem-kg",
  {
    w: number;
    h: number;
    /** Focus mechanism (lever) entity id. */
    mechanismId: string;
    mechanismName: string;
    /** Source sub-objective room id — "Open in room" re-enters it. */
    roomId: string;
    /** Owning objective space id. */
    spaceId: string;
    /** Accent hex (#rrggbb). */
    color: string;
    /** Upstream problem labels (the "problem" column). */
    problemLabels: string[];
    /** Downstream outcome labels (the "solution" column). */
    solutionLabels: string[];
    /** Total upstream problems (may exceed shown chips). */
    problemCount: number;
    /** Total downstream outcomes (may exceed shown chips). */
    solutionCount: number;
    /** Whether a MechanismSpec exists → internals inspectable in-room. */
    hasSpec: boolean;
    /** runtime_flow step count (0 when no spec). */
    stepCount: number;
  }
>;

const PAIN_TONE = "#F43F5E"; // rose — the "problem" column
const OUTCOME_TONE = "#10B981"; // emerald — the "solution" column

export class SubsystemKgShapeUtil extends BaseBoxShapeUtil<SubsystemKgShape> {
  static override type = "subsystem-kg" as const;
  static override props: RecordProps<SubsystemKgShape> = {
    w: T.number,
    h: T.number,
    mechanismId: T.string,
    mechanismName: T.string,
    roomId: T.string,
    spaceId: T.string,
    color: T.string,
    problemLabels: T.arrayOf(T.string),
    solutionLabels: T.arrayOf(T.string),
    problemCount: T.number,
    solutionCount: T.number,
    hasSpec: T.boolean,
    stepCount: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: SubsystemKgShape,
    info: TLResizeInfo<SubsystemKgShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): SubsystemKgShape["props"] {
    return {
      w: 360,
      h: 212,
      mechanismId: "",
      mechanismName: "Mechanism",
      roomId: "",
      spaceId: "",
      color: appleVibe.stage.features,
      problemLabels: [],
      solutionLabels: [],
      problemCount: 0,
      solutionCount: 0,
      hasSpec: false,
      stepCount: 0,
    };
  }

  component(shape: SubsystemKgShape) {
    return <SubsystemKgRenderer shape={shape} />;
  }

  indicator(shape: SubsystemKgShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

/** One labelled column of chips ("PROBLEMS" / "OUTCOMES"). */
function ChipColumn({
  heading,
  tone,
  labels,
  total,
  align,
}: {
  heading: string;
  tone: string;
  labels: string[];
  total: number;
  align: "start" | "end";
}) {
  const shown = labels.slice(0, 2);
  const extra = Math.max(0, total - shown.length);
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 5,
        alignItems: align === "end" ? "flex-end" : "flex-start",
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.06em",
          color: tone,
          textTransform: "uppercase",
        }}
      >
        {heading}
      </span>
      {shown.length === 0 ? (
        <span style={{ fontSize: 10.5, color: appleVibe.text.faint }}>—</span>
      ) : (
        shown.map((l, i) => (
          <div
            key={i}
            title={l}
            style={{
              maxWidth: "100%",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 7px",
              borderRadius: 8,
              background: `${tone}10`,
              border: `1px solid ${tone}28`,
              flexDirection: align === "end" ? "row-reverse" : "row",
            }}
          >
            <span
              style={{
                width: 4,
                height: 4,
                borderRadius: 999,
                background: tone,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 10.5,
                lineHeight: 1.25,
                color: appleVibe.text.secondary,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {l}
            </span>
          </div>
        ))
      )}
      {extra > 0 && (
        <span style={{ fontSize: 9.5, color: appleVibe.text.tertiary }}>
          +{extra} more
        </span>
      )}
    </div>
  );
}

function SubsystemKgRenderer({ shape }: { shape: SubsystemKgShape }) {
  const {
    mechanismName,
    roomId,
    color,
    problemLabels,
    solutionLabels,
    problemCount,
    solutionCount,
    hasSpec,
    stepCount,
    mechanismId,
  } = shape.props;

  function openRoom(e: React.MouseEvent) {
    e.stopPropagation();
    if (!roomId) return;
    // Reuse the shell's room-open flow; mechanismId rides along as an
    // additive focus hint (RoomAltitudeMap honors `?focus=`; the current
    // shell handler ignores the extra field harmlessly).
    window.dispatchEvent(
      new CustomEvent(OPEN_ROOM_EVENT, {
        detail: { roomId, focusEntityId: mechanismId },
      }),
    );
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.98) 0%, rgba(248,249,252,0.96) 100%)",
          border: "1px solid rgba(15,23,42,0.07)",
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 16px 40px -18px ${color}66, 0 6px 18px -10px rgba(11,18,40,0.16)`,
          padding: "13px 15px 12px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Header: grip + KG eyebrow + Open-in-room */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            <GripVertical
              style={{ width: 12, height: 12, color: "rgba(15,23,42,0.26)", flexShrink: 0 }}
            />
            <Workflow style={{ width: 12, height: 12, color, flexShrink: 0 }} strokeWidth={2.2} />
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.05em",
                color,
                textTransform: "uppercase",
              }}
            >
              Subsystem KG
            </span>
          </div>
          {roomId && (
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={openRoom}
              title="Open this mechanism in its room"
              aria-label="Open in room"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                padding: "4px 9px",
                borderRadius: 999,
                border: `1px solid ${color}33`,
                cursor: "pointer",
                background: `${color}12`,
                color,
                fontSize: 10,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              Open in room
              <ArrowRight style={{ width: 10, height: 10 }} strokeWidth={2.4} />
            </button>
          )}
        </div>

        {/* Mechanism name */}
        <div
          title={mechanismName}
          style={{
            marginTop: 8,
            fontSize: 15,
            fontWeight: 650,
            lineHeight: 1.2,
            color: appleVibe.text.primary,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {mechanismName}
        </div>
        <span style={{ marginTop: 1, fontSize: 10, color: appleVibe.text.tertiary }}>
          problem → mechanism → solution
        </span>

        {/* The triad: problems  →  mechanism  →  outcomes */}
        <div
          style={{
            marginTop: 11,
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            minHeight: 0,
          }}
        >
          <ChipColumn
            heading="Problems"
            tone={PAIN_TONE}
            labels={problemLabels}
            total={problemCount}
            align="start"
          />

          <ArrowRight
            style={{ width: 13, height: 13, color: appleVibe.text.faint, flexShrink: 0 }}
            strokeWidth={2.2}
          />

          {/* Mechanism hero pill */}
          <div
            style={{
              flexShrink: 0,
              maxWidth: 116,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              padding: "8px 11px",
              borderRadius: 13,
              background: `linear-gradient(160deg, ${color}1a, ${color}0d)`,
              border: `1.5px solid ${color}`,
              boxShadow: `0 6px 16px -8px ${color}80`,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: color,
                boxShadow: `0 0 0 3px ${color}22`,
              }}
            />
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                lineHeight: 1.15,
                textAlign: "center",
                color: appleVibe.text.primary,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {mechanismName}
            </span>
          </div>

          <ArrowRight
            style={{ width: 13, height: 13, color: appleVibe.text.faint, flexShrink: 0 }}
            strokeWidth={2.2}
          />

          <ChipColumn
            heading="Outcomes"
            tone={OUTCOME_TONE}
            labels={solutionLabels}
            total={solutionCount}
            align="end"
          />
        </div>

        {/* Footer: internals hint */}
        <div
          style={{
            marginTop: 9,
            paddingTop: 8,
            borderTop: `1px solid ${appleVibe.stroke.hairline}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 9.5, color: appleVibe.text.tertiary }}>
            {problemCount} problem{problemCount === 1 ? "" : "s"} ·{" "}
            {solutionCount} outcome{solutionCount === 1 ? "" : "s"}
          </span>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              color: hasSpec ? color : appleVibe.text.faint,
            }}
          >
            {hasSpec ? `${stepCount} step${stepCount === 1 ? "" : "s"} inside` : "no internals yet"}
          </span>
        </div>
      </div>
    </HTMLContainer>
  );
}
