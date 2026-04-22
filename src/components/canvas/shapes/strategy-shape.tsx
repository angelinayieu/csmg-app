"use client";

// ── StrategyShape (Arc 4 Phase B) ──────────────────────────────────────
//
// Renders a strategy_snapshot as a draggable tldraw shape on the freestyle
// canvas. Two visual modes:
//
//   expanded=false  → compact card (200×120). Shows version label, status
//                     chip, title, readiness composite, tactic count.
//                     Double-click expands.
//   expanded=true   → larger card (300×220). Adds top-3 tactics, confidence
//                     bar, "Open strategy →" link. Double-click collapses.
//
// Both modes stay read-only: the canonical strategy lives in
// strategy_snapshots; mutating it here would fork silently. The shape is
// an artifact pointer, not an editable surface. Iteration happens by
// dropping this shape alongside stickies + running AI actions on the
// group (Arc 4 Phase D).
//
// Persistence: props carry a hydrated preview (title, readyScore, etc.)
// so the shape is cheap to render without re-fetching the full recommendation.
// If the underlying snapshot is renamed the label won't auto-update on
// existing shapes — the user can re-drop to refresh, or a future
// realtime subscription (Arc 4 Phase F) can patch props live.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  createShapeId,
  stopEventPropagation,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useCallback, useState } from "react";
import { CheckCircle2, Eye, Archive, Sparkles, MessageSquarePlus } from "lucide-react";
import type { StrategyShape, StrategyShapeStatus, StickyNoteShape } from "./types";
import { toast } from "@/lib/hooks/use-toast";
import { GroundingBadge } from "@/components/ui/grounding-badge";

const STATUS_COLOR: Record<
  StrategyShapeStatus,
  { accent: string; chipBg: string; chipText: string; chipBorder: string; icon: typeof CheckCircle2 }
> = {
  confirmed: {
    accent: "#10B981",
    chipBg: "rgba(16, 185, 129, 0.10)",
    chipText: "#047857",
    chipBorder: "rgba(16, 185, 129, 0.35)",
    icon: CheckCircle2,
  },
  reviewing: {
    accent: "#F59E0B",
    chipBg: "rgba(245, 158, 11, 0.10)",
    chipText: "#B45309",
    chipBorder: "rgba(245, 158, 11, 0.35)",
    icon: Eye,
  },
  generated: {
    accent: "#6366F1",
    chipBg: "rgba(99, 102, 241, 0.10)",
    chipText: "#4338CA",
    chipBorder: "rgba(99, 102, 241, 0.35)",
    icon: Sparkles,
  },
  superseded: {
    accent: "#9CA3AF",
    chipBg: "rgba(156, 163, 175, 0.12)",
    chipText: "#4B5563",
    chipBorder: "rgba(156, 163, 175, 0.35)",
    icon: Archive,
  },
};

const STATUS_LABEL: Record<StrategyShapeStatus, string> = {
  confirmed: "Confirmed",
  reviewing: "Reviewing",
  generated: "Generated",
  superseded: "Superseded",
};

// Dimensions for the two visual modes. Kept as constants so the
// onDoubleClick toggle can resize cleanly without exposing w/h as
// user-controlled props.
const COMPACT_W = 220;
const COMPACT_H = 120;
const EXPANDED_W = 320;
const EXPANDED_H = 220;

export class StrategyShapeUtil extends BaseBoxShapeUtil<StrategyShape> {
  static override type = "strategy-card" as const;
  static override props: RecordProps<StrategyShape> = {
    w: T.number,
    h: T.number,
    snapshotId: T.string,
    version: T.number,
    label: T.string,
    title: T.string,
    status: T.literalEnum("generated", "reviewing", "confirmed", "superseded"),
    readyScore: T.nullable(T.number),
    tacticCount: T.nullable(T.number),
    confidence: T.nullable(T.number),
    expanded: T.boolean,
  };

  override canResize = () => true;
  // Not editable in the tldraw sense — content is immutable at shape level;
  // double-click only toggles compact↔expanded (handled in the renderer).
  override canEdit = () => false;

  override onResize = (shape: StrategyShape, info: TLResizeInfo<StrategyShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): StrategyShape["props"] {
    return {
      w: COMPACT_W,
      h: COMPACT_H,
      snapshotId: "",
      version: 0,
      label: "v0",
      title: "Strategy",
      status: "generated",
      readyScore: null,
      tacticCount: null,
      confidence: null,
      expanded: false,
    };
  }

  component(shape: StrategyShape) {
    return <StrategyShapeRenderer shape={shape} util={this} />;
  }

  indicator(shape: StrategyShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

// Dimension + color pairing for each kind of AI-generated sticky.
// Kept in sync with the sticky-note-shape palette (yellow/pink/blue/green/purple).
const HIGHLIGHT_STICKIES = [
  { kind: "decision", color: "pink" as const, dimension: "question" as const, prefix: "KEY DECISION" },
  { kind: "tactic", color: "green" as const, dimension: "solution" as const, prefix: "TOP TACTIC" },
  { kind: "failure", color: "yellow" as const, dimension: "risk" as const, prefix: "PRE-MORTEM RISK" },
  { kind: "axiom", color: "blue" as const, dimension: "insight" as const, prefix: "GROUNDING AXIOM" },
];

function StrategyShapeRenderer({
  shape,
  util,
}: {
  shape: StrategyShape;
  util: StrategyShapeUtil;
}) {
  const editor = util.editor;
  const meta = STATUS_COLOR[shape.props.status];
  const StatusIcon = meta.icon;
  const [annotating, setAnnotating] = useState(false);

  const toggleExpanded = useCallback(() => {
    const next = !shape.props.expanded;
    editor.updateShape<StrategyShape>({
      id: shape.id,
      type: "strategy-card",
      props: {
        expanded: next,
        w: next ? EXPANDED_W : COMPACT_W,
        h: next ? EXPANDED_H : COMPACT_H,
      },
    });
  }, [editor, shape.id, shape.props.expanded]);

  const readyScore = shape.props.readyScore;
  const confidence = shape.props.confidence;

  // ── Annotate with stickies ────────────────────────────────────────────
  // Fetches the full snapshot, extracts up to 4 highlight slices, and
  // drops a sticky note for each in a fan around the strategy shape.
  // Each sticky is tagged aiTagged=true + dimensioned so downstream
  // sticky-decompose flows recognise the origin.
  const annotateWithStickies = useCallback(async () => {
    if (annotating) return;
    if (!shape.props.snapshotId) {
      toast.error("Missing snapshot id", { description: "Re-drop this strategy from the version drawer." });
      return;
    }
    setAnnotating(true);
    try {
      // Derive space id from the current URL path. The canvas lives at
      // /app/space/[id]/whiteboard so path[3] is the space id.
      const pathParts = typeof window !== "undefined"
        ? window.location.pathname.split("/").filter(Boolean)
        : [];
      const spaceId = pathParts[2] ?? null; // ["app","space","{id}","whiteboard"]
      if (!spaceId) {
        toast.error("Can't resolve space id for annotation");
        return;
      }
      const res = await fetch(
        `/api/spaces/${spaceId}/strategy-snapshots/${shape.props.snapshotId}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Fetch failed" }));
        throw new Error(err.error ?? "Fetch failed");
      }
      const detail = (await res.json()) as import("@/app/api/spaces/[id]/strategy-snapshots/[snapshotId]/route").StrategySnapshotDetail;
      const rec = detail.recommendation;

      // Extract highlights — defensive because snapshot schemas drifted
      // over time. Skip any slot where the data isn't present.
      const highlights: Array<{ kind: string; text: string; color: "yellow" | "pink" | "blue" | "green" | "purple"; dimension: "problem" | "solution" | "question" | "insight" | "risk" | "evidence"; prefix: string }> = [];

      const decisionQ = rec.key_decision?.question;
      const decisionR = rec.key_decision?.recommended;
      if (decisionQ && decisionR) {
        highlights.push({
          ...HIGHLIGHT_STICKIES[0],
          text: `${decisionQ}\n\n→ ${decisionR}`,
        });
      }

      const topTactic = rec.micro_tactics?.[0];
      if (topTactic && typeof topTactic === "object" && "action" in topTactic) {
        highlights.push({
          ...HIGHLIGHT_STICKIES[1],
          text: (topTactic as { action?: string }).action ?? "",
        });
      }

      const topFailure = rec.pre_mortem?.[0];
      if (topFailure && typeof topFailure === "object") {
        const failText = (topFailure as { failure_mode?: string; mode?: string }).failure_mode
          ?? (topFailure as { mode?: string }).mode
          ?? "";
        if (failText) {
          highlights.push({
            ...HIGHLIGHT_STICKIES[2],
            text: `Failure mode:\n${failText}`,
          });
        }
      }

      const topAxiom = rec.provenance?.axioms_respected?.[0];
      if (topAxiom) {
        highlights.push({
          ...HIGHLIGHT_STICKIES[3],
          text: `Respected axiom:\n${topAxiom}`,
        });
      }

      if (highlights.length === 0) {
        toast.info("Nothing to annotate", {
          description: "This strategy has no decisions, tactics, or pre-mortem entries yet.",
        });
        return;
      }

      // Fan layout: place stickies in a 2×2 grid to the right of the shape.
      // w/h match the sticky-note getDefaultProps (200×200).
      const STICKY_W = 200;
      const STICKY_H = 200;
      const GAP = 16;
      const shapeX = editor.getShapePageBounds(shape.id)?.x ?? 0;
      const shapeY = editor.getShapePageBounds(shape.id)?.y ?? 0;
      const startX = shapeX + shape.props.w + GAP * 2;
      const startY = shapeY;

      editor.markHistoryStoppingPoint(`annotate-strategy-${shape.props.snapshotId}`);
      highlights.forEach((h, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const stickyId = createShapeId(`annot-${shape.props.snapshotId}-${h.kind}-${Date.now()}-${i}`);
        editor.createShape<StickyNoteShape>({
          id: stickyId,
          type: "sticky-note",
          x: Math.round(startX + col * (STICKY_W + GAP)),
          y: Math.round(startY + row * (STICKY_H + GAP)),
          props: {
            w: STICKY_W,
            h: STICKY_H,
            text: `${h.prefix}\n\n${h.text}`,
            color: h.color,
            dimension: h.dimension,
            aiTagged: true,
            entityId: null,
          },
        });
      });

      toast.success(`Dropped ${highlights.length} annotation${highlights.length === 1 ? "" : "s"}`, {
        description: "Edit or delete any sticky — your canvas, your call.",
      });
    } catch (e) {
      toast.error("Couldn't annotate", { description: (e as Error).message });
    } finally {
      setAnnotating(false);
    }
  }, [editor, shape.id, shape.props.snapshotId, shape.props.w, annotating]);

  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "all",
      }}
    >
      <div
        onDoubleClick={toggleExpanded}
        role="button"
        aria-label={`${shape.props.label} strategy card, ${STATUS_LABEL[shape.props.status]}. Double-click to ${shape.props.expanded ? "collapse" : "expand"}.`}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 14,
          background:
            "linear-gradient(155deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.95) 100%)",
          border: `1px solid ${meta.chipBorder}`,
          boxShadow: `0 1px 3px rgba(15, 23, 42, 0.06), 0 10px 24px -6px ${meta.accent}22`,
          padding: shape.props.expanded ? "14px 16px 12px" : "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: shape.props.expanded ? 8 : 6,
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          cursor: "pointer",
          overflow: "hidden",
        }}
      >
        {/* Accent bar (left) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: meta.accent,
            borderTopLeftRadius: 14,
            borderBottomLeftRadius: 14,
          }}
        />

        {/* Header row: status chip + version label */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 9.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 6px",
              borderRadius: 999,
              background: meta.chipBg,
              color: meta.chipText,
              border: `1px solid ${meta.chipBorder}`,
            }}
          >
            <StatusIcon style={{ width: 9, height: 9 }} />
            {STATUS_LABEL[shape.props.status]}
          </span>
          <span
            style={{
              color: "#0F172A",
              fontWeight: 700,
              letterSpacing: "0.06em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {shape.props.label}
          </span>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: shape.props.expanded ? 14 : 13,
            lineHeight: 1.3,
            fontWeight: 600,
            color: "#0F172A",
            display: "-webkit-box",
            WebkitLineClamp: shape.props.expanded ? 2 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {shape.props.title || "Untitled strategy"}
        </div>

        {/* Metrics row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 10.5,
            color: "#64748B",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {readyScore !== null && (
            <span title="Ready-to-ship composite">
              <span style={{ fontWeight: 700, color: meta.accent }}>
                {Math.round(readyScore)}
              </span>
              <span style={{ marginLeft: 2, opacity: 0.7 }}>/100</span>
            </span>
          )}
          {shape.props.tacticCount !== null && (
            <span>
              <span style={{ fontWeight: 600, color: "#334155" }}>
                {shape.props.tacticCount}
              </span>
              <span style={{ marginLeft: 3, opacity: 0.7 }}>
                tactic{shape.props.tacticCount === 1 ? "" : "s"}
              </span>
            </span>
          )}
          {confidence !== null && (
            <span
              title={`LLM self-assessed confidence ${Math.round(confidence * 100)}% — uncalibrated. Represents the model's hedge about this strategy's ranking, not outcome probability.`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              conf {Math.round(confidence * 100)}%
              <GroundingBadge tier="narrative" compact />
            </span>
          )}
        </div>

        {/* Expanded-only region */}
        {shape.props.expanded && (
          <>
            {/* Readiness bar */}
            {readyScore !== null && (
              <div
                style={{
                  marginTop: 2,
                  height: 4,
                  borderRadius: 999,
                  background: "rgba(148, 163, 184, 0.18)",
                  overflow: "hidden",
                }}
                aria-hidden
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(0, Math.min(100, readyScore))}%`,
                    background: meta.accent,
                    borderRadius: 999,
                  }}
                />
              </div>
            )}

            {/* Arc 4 Phase D: annotate with stickies action */}
            <div
              style={{
                marginTop: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                borderTop: "1px dashed rgba(148, 163, 184, 0.3)",
                paddingTop: 6,
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  color: "#94A3B8",
                  lineHeight: 1.3,
                }}
              >
                Drop stickies to annotate
              </span>
              <button
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={(e) => {
                  e.stopPropagation();
                  void annotateWithStickies();
                }}
                disabled={annotating}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: annotating ? "rgba(99,102,241,0.15)" : meta.accent,
                  color: annotating ? meta.chipText : "#fff",
                  border: "none",
                  cursor: annotating ? "wait" : "pointer",
                  fontFamily: "inherit",
                  opacity: annotating ? 0.75 : 1,
                }}
                title="Drop AI-generated sticky notes highlighting key decisions, tactics, and risks"
                aria-label="Annotate this strategy with AI-generated sticky notes"
              >
                <MessageSquarePlus style={{ width: 10, height: 10 }} />
                {annotating ? "Annotating…" : "Annotate"}
              </button>
            </div>
          </>
        )}

        {/* Collapsed-only hint */}
        {!shape.props.expanded && (
          <div
            style={{
              marginTop: "auto",
              fontSize: 9,
              color: "#94A3B8",
              lineHeight: 1.2,
            }}
          >
            Double-click to expand
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

export { COMPACT_W as STRATEGY_SHAPE_COMPACT_W, COMPACT_H as STRATEGY_SHAPE_COMPACT_H };
