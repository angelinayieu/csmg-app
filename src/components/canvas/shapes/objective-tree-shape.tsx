"use client";

// ── Objective tree shape (Phase A1.7) ──
//
// Represents a ROOT objective and its full sub-objective hierarchy as a
// single draggable canvas artifact. Unlike other asset classes that
// render flat cards, an objective drop carries a serialized tree the
// shape hydrates from — so a decomposed goal surfaces on the canvas
// with all its structure intact.
//
// Collapsed: 320×180 — root title, status chip, progress ring, node/
// depth counts, proposed-badge if any sub-objective is unreviewed.
// Expanded: grows vertically to accommodate the full tree, with
// indent-per-depth + progress bar + status dot per node.
//
// Click → navigates to the space's objectives surface filtered to
// this tree. Opaque shape id = `objective-${goalId}` so re-drops
// deduplicate (unlike Twin, which intentionally multi-drops).

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Target, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import type { ObjectiveTreeShape } from "./types";
import type { GoalTreeNode } from "@/types/goals";

const STATUS_META: Record<
  string,
  { color: string; bg: string; label: string; dot: string }
> = {
  proposed: { color: "#d97706", bg: "#fef3c7", label: "Proposed", dot: "#d97706" },
  active: { color: "#0891b2", bg: "#cffafe", label: "Active", dot: "#0891b2" },
  achieved: { color: "#16a34a", bg: "#dcfce7", label: "Achieved", dot: "#16a34a" },
  paused: { color: "#64748b", bg: "#f1f5f9", label: "Paused", dot: "#64748b" },
  abandoned: { color: "#94a3b8", bg: "#f8fafc", label: "Abandoned", dot: "#94a3b8" },
  rejected: { color: "#dc2626", bg: "#fee2e2", label: "Rejected", dot: "#dc2626" },
};

function metaFor(status: string) {
  return STATUS_META[status] ?? STATUS_META.active;
}

function safeParseTree(json: string): GoalTreeNode | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && "id" in parsed) {
      return parsed as GoalTreeNode;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Compute own-node progress from baseline/current/target — matches the
 * leaf calculation in `computeRecursiveProgress` so expanded rows show
 * consistent numbers with the collapsed root ring.
 */
function leafProgress(node: GoalTreeNode): number {
  const range = Number(node.target_value) - Number(node.baseline_value);
  if (!Number.isFinite(range) || range === 0) return 0;
  const prog = Number(node.current_value) - Number(node.baseline_value);
  return Math.max(0, Math.min(100, Math.round((prog / range) * 100)));
}

export class ObjectiveTreeShapeUtil extends BaseBoxShapeUtil<ObjectiveTreeShape> {
  static override type = "objective-tree" as const;
  static override props: RecordProps<ObjectiveTreeShape> = {
    w: T.number,
    h: T.number,
    goalId: T.string,
    spaceId: T.string,
    title: T.string,
    status: T.string,
    objectiveType: T.string,
    progress: T.number,
    nodeCount: T.number,
    depth: T.number,
    proposedCount: T.number,
    treeJson: T.string,
    expanded: T.boolean,
  };

  override getDefaultProps(): ObjectiveTreeShape["props"] {
    return {
      w: 320,
      h: 180,
      goalId: "",
      spaceId: "",
      title: "Objective",
      status: "active",
      objectiveType: "maximize",
      progress: 0,
      nodeCount: 1,
      depth: 1,
      proposedCount: 0,
      treeJson: "",
      expanded: false,
    };
  }

  override canResize = () => true;
  override onResize = (shape: ObjectiveTreeShape, info: TLResizeInfo<ObjectiveTreeShape>) =>
    resizeBox(shape, info);

  override component(shape: ObjectiveTreeShape) {
    const {
      title,
      status,
      progress,
      nodeCount,
      depth,
      proposedCount,
      treeJson,
      expanded,
    } = shape.props;
    const meta = metaFor(status);
    const tree = treeJson ? safeParseTree(treeJson) : null;

    const handleToggle = (e: React.MouseEvent) => {
      e.stopPropagation();
      this.editor.updateShape<ObjectiveTreeShape>({
        id: shape.id,
        type: "objective-tree",
        props: { expanded: !expanded },
      });
    };

    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "all",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "white",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            borderRadius: 14,
            boxShadow:
              "0 1px 2px rgba(15,23,42,0.04), 0 8px 20px -12px rgba(15,23,42,0.12)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          {/* Top rail */}
          <div
            style={{
              height: 3,
              background: meta.dot,
              opacity: 0.9,
            }}
          />

          {/* Header */}
          <div
            style={{
              padding: "10px 12px 8px",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: meta.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Target size={15} color={meta.color} strokeWidth={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span
                  style={{
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: meta.color,
                  }}
                >
                  Objective · {meta.label}
                </span>
                {proposedCount > 0 && (
                  <span
                    style={{
                      fontSize: 8.5,
                      fontWeight: 600,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: "#fef3c7",
                      color: "#a16207",
                    }}
                    title={`${proposedCount} unreviewed sub-objectives`}
                  >
                    {proposedCount} proposed
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#0f172a",
                  lineHeight: 1.25,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
                title={title}
              >
                {title}
              </div>
            </div>
            <ProgressRing percent={progress} color={meta.color} />
          </div>

          {/* Stats */}
          <div
            style={{
              padding: "6px 12px",
              display: "flex",
              gap: 14,
              fontSize: 10.5,
              color: "#64748b",
              borderTop: "1px solid rgba(15,23,42,0.04)",
            }}
          >
            <StatCell label="Nodes" value={String(nodeCount)} />
            <StatCell label="Depth" value={String(depth)} />
            <StatCell
              label="Progress"
              value={`${progress}%`}
              valueColor={meta.color}
            />
          </div>

          {/* Tree body — only rendered when expanded */}
          {expanded && tree && (
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "4px 12px 10px",
                borderTop: "1px solid rgba(15,23,42,0.06)",
                background: "#fafbfc",
              }}
            >
              <TreeBody node={tree} depth={0} />
            </div>
          )}

          {/* Footer / expand control */}
          <button
            onClick={handleToggle}
            style={{
              padding: "6px 12px",
              background: "transparent",
              border: "none",
              borderTop: "1px solid rgba(15,23,42,0.06)",
              fontSize: 10,
              fontWeight: 600,
              color: "#64748b",
              cursor: "pointer",
              textAlign: "left",
              letterSpacing: "0.04em",
            }}
            title={expanded ? "Collapse tree" : "Expand tree"}
          >
            {expanded ? "▾ Collapse tree" : `▸ Show tree (${nodeCount - 1} sub)`}
          </button>
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: ObjectiveTreeShape) {
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        rx={14}
        ry={14}
      />
    );
  }
}

// ── Sub-components ──

function ProgressRing({ percent, color }: { percent: number; color: string }) {
  const size = 32;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const dash = (clamped / 100) * c;

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(15,23,42,0.08)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c - dash}`}
          strokeDashoffset={c / 4}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 200ms ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9.5,
          fontWeight: 700,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {clamped}
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span
        style={{
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#94a3b8",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: valueColor ?? "#334155",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function TreeBody({ node, depth }: { node: GoalTreeNode; depth: number }) {
  // `GoalTreeNode.status` is the legacy narrow union — Wave A extends
  // it with "proposed"/"rejected" but the shared type hasn't been
  // updated. Coerce to string for comparisons so the wider runtime
  // values still work without retyping the core shape.
  const statusStr = node.status as string;
  const meta = metaFor(statusStr);
  const isLeaf = node.children.length === 0;
  const pct = isLeaf ? leafProgress(node) : null;
  const StatusIcon =
    statusStr === "achieved"
      ? CheckCircle2
      : statusStr === "proposed"
        ? AlertCircle
        : Circle;

  return (
    <div style={{ marginTop: depth === 0 ? 4 : 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          paddingLeft: depth * 12,
          paddingTop: 3,
          paddingBottom: 3,
        }}
      >
        <StatusIcon size={10} color={meta.dot} strokeWidth={2} />
        <span
          style={{
            fontSize: 11,
            fontWeight: depth === 0 ? 600 : 500,
            color: "#334155",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={node.title}
        >
          {node.title}
        </span>
        {pct !== null && (
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              color: meta.color,
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {pct}%
          </span>
        )}
      </div>
      {node.children.map((child) => (
        <TreeBody key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}
