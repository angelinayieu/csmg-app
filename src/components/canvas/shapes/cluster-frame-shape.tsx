"use client";

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type Editor,
  type RecordProps,
  type TLResizeInfo,
  type TLShapeId,
  resizeBox,
} from "tldraw";
import { Layers, ChevronUp } from "lucide-react";
import type { ClusterFrameShape } from "./types";

const STASH_X = -1e6;
const STASH_Y = -1e6;

// Shared implementation used by the ShapeUtil's onDoubleClick AND by the
// external hook so both paths behave identically.
export function toggleClusterImpl(editor: Editor, clusterId: TLShapeId): void {
  const shape = editor.getShape<ClusterFrameShape>(clusterId);
  if (!shape || shape.type !== "cluster-frame") return;

  editor.markHistoryStoppingPoint(
    shape.props.collapsed ? "expand-cluster" : "collapse-cluster",
  );

  if (!shape.props.collapsed) {
    // COLLAPSE
    const stashed: ClusterFrameShape["props"]["stashedPositions"] = [];
    const childIds = shape.props.childShapeIds as TLShapeId[];
    const childIdSet = new Set<string>(childIds.map((id) => id as string));

    for (const cid of childIds) {
      const c = editor.getShape(cid);
      if (!c) continue;
      stashed.push({ id: cid as string, x: c.x, y: c.y });
    }

    // Also stash any ARROWS bound to these children so they don't render
    // as long ghost lines to offscreen coordinates. Arrow shapes have their
    // own positions + bindings. We capture their positions + keep their ids
    // in the stashed list so expand restores them.
    const arrowsToStash: { id: string; x: number; y: number }[] = [];
    for (const cid of childIds) {
      const bindings = editor.getBindingsToShape(cid as TLShapeId, "arrow");
      for (const b of bindings) {
        const arrowId = b.fromId as TLShapeId;
        const arrow = editor.getShape(arrowId);
        if (!arrow) continue;
        // Skip arrows that are already stashed (can appear twice if both
        // endpoints are children).
        if (arrowsToStash.some((a) => a.id === (arrowId as unknown as string))) continue;
        arrowsToStash.push({ id: arrowId as unknown as string, x: arrow.x, y: arrow.y });
      }
    }

    const combined = [...stashed, ...arrowsToStash];
    const moves = combined
      .map((s) => {
        const existing = editor.getShape(s.id as TLShapeId);
        if (!existing) return null;
        return { id: s.id as TLShapeId, type: existing.type, x: STASH_X, y: STASH_Y };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (moves.length > 0) {
      editor.updateShapes(moves as unknown as Parameters<typeof editor.updateShapes>[0]);
    }

    // If a ghost inside the cluster was selected, drop selection so its
    // chip doesn't try to track an off-canvas shape.
    const selected = editor.getSelectedShapeIds();
    if (selected.some((id) => childIdSet.has(id as string))) {
      editor.setSelectedShapes([clusterId]);
    }

    editor.updateShape<ClusterFrameShape>({
      id: clusterId,
      type: "cluster-frame",
      props: { collapsed: true, stashedPositions: combined, w: 300, h: 180 },
    });
    // Collapsed cluster is now the visible representation — bring it
    // forward so it sits on top of any surrounding shapes.
    editor.bringToFront([clusterId]);
  } else {
    // EXPAND
    const stashed = shape.props.stashedPositions;
    const moves = stashed
      .map((s) => {
        const existing = editor.getShape(s.id as TLShapeId);
        if (!existing) return null;
        return { id: s.id as TLShapeId, type: existing.type, x: s.x, y: s.y };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (moves.length > 0) {
      editor.updateShapes(moves as unknown as Parameters<typeof editor.updateShapes>[0]);
    }

    const boundsList = stashed
      .map((s) => editor.getShapePageBounds(s.id as TLShapeId))
      .filter((b): b is NonNullable<typeof b> => !!b);

    let newW = shape.props.w;
    let newH = shape.props.h;
    let newX = shape.x;
    let newY = shape.y;
    if (boundsList.length > 0) {
      const PAD = 32;
      const minX = Math.min(...boundsList.map((b) => b.minX));
      const minY = Math.min(...boundsList.map((b) => b.minY));
      const maxX = Math.max(...boundsList.map((b) => b.maxX));
      const maxY = Math.max(...boundsList.map((b) => b.maxY));
      newX = minX - PAD;
      newY = minY - PAD - 8;
      newW = maxX - minX + PAD * 2;
      newH = maxY - minY + PAD * 2 + 8;
    }

    editor.updateShape<ClusterFrameShape>({
      id: clusterId,
      type: "cluster-frame",
      x: newX,
      y: newY,
      props: { collapsed: false, w: newW, h: newH },
    });
    editor.sendToBack([clusterId]);
  }
}

// A cluster is a named container that wraps 2+ child shapes. When expanded
// it renders a translucent bordered frame (no fill — children sit on top of
// it). When collapsed the children are stashed off-canvas and the cluster
// shrinks to a compact summary card with title + preview labels + count.

export class ClusterFrameShapeUtil extends BaseBoxShapeUtil<ClusterFrameShape> {
  static override type = "cluster-frame" as const;
  static override props: RecordProps<ClusterFrameShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    collapsed: T.boolean,
    childShapeIds: T.arrayOf(T.string),
    stashedPositions: T.arrayOf(
      T.object({
        id: T.string,
        x: T.number,
        y: T.number,
      }),
    ),
    accent: T.string,
    previewLabels: T.arrayOf(T.string),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: ClusterFrameShape, info: TLResizeInfo<ClusterFrameShape>) => {
    return resizeBox(shape, info);
  };

  override onDoubleClick = (shape: ClusterFrameShape) => {
    toggleClusterImpl(this.editor, shape.id);
  };

  getDefaultProps(): ClusterFrameShape["props"] {
    return {
      w: 320,
      h: 200,
      title: "Cluster",
      collapsed: false,
      childShapeIds: [],
      stashedPositions: [],
      accent: "#5856d6",
      previewLabels: [],
    };
  }

  component(shape: ClusterFrameShape) {
    const { w, h, title, collapsed, accent, previewLabels, childShapeIds } = shape.props;

    if (collapsed) {
      return (
        <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              borderRadius: 16,
              background: `linear-gradient(155deg, ${accent}1a 0%, ${accent}0f 100%)`,
              border: `1.5px solid ${accent}55`,
              boxShadow: `0 0 0 1px ${accent}11, 0 12px 40px -12px ${accent}66`,
              padding: "14px 16px 12px",
              overflow: "hidden",
              fontFamily:
                '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
            }}
          >
            {/* Layer stripe */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background: accent,
              }}
            />

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px",
                  borderRadius: 4,
                  background: `${accent}22`,
                  color: accent,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                <Layers className="h-2.5 w-2.5" />
                Cluster
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#8592a8",
                }}
              >
                {childShapeIds.length} {childShapeIds.length === 1 ? "node" : "nodes"}
              </span>
            </div>

            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#0a1020",
                letterSpacing: "-0.015em",
                lineHeight: 1.2,
                marginBottom: 8,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={title}
            >
              {title}
            </div>

            {previewLabels.length > 0 && (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                {previewLabels.slice(0, 3).map((label, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 11,
                      color: "#556479",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 4,
                        height: 4,
                        borderRadius: "50%",
                        background: accent,
                        opacity: 0.6,
                        flexShrink: 0,
                      }}
                    />
                    {label}
                  </li>
                ))}
                {previewLabels.length > 3 && (
                  <li
                    style={{
                      fontSize: 10,
                      color: "#b4bfd0",
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                    }}
                  >
                    +{previewLabels.length - 3} more
                  </li>
                )}
              </ul>
            )}

            <div
              style={{
                position: "absolute",
                bottom: 8,
                right: 10,
                fontSize: 9,
                fontWeight: 600,
                color: accent,
                opacity: 0.7,
                letterSpacing: "0.08em",
              }}
            >
              DOUBLE-CLICK TO EXPAND
            </div>
          </div>
        </HTMLContainer>
      );
    }

    // Expanded: translucent bounded region with title bar.
    return (
      <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 18,
            background: `${accent}0a`,
            border: `1.5px dashed ${accent}55`,
            boxShadow: `inset 0 0 0 1px ${accent}11`,
            fontFamily:
              '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          }}
        >
          {/* Title bar */}
          <div
            style={{
              position: "absolute",
              top: -14,
              left: 16,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 10px 3px 8px",
              borderRadius: 8,
              background: "#ffffff",
              border: `1px solid ${accent}55`,
              boxShadow: `0 2px 6px ${accent}22`,
              fontSize: 11,
              fontWeight: 700,
              color: accent,
              letterSpacing: "-0.005em",
              pointerEvents: "none",
            }}
          >
            <Layers className="h-3 w-3" />
            {title}
            <span style={{ color: "#8592a8", fontWeight: 500, marginLeft: 4 }}>
              · {childShapeIds.length}
            </span>
          </div>

          <div
            style={{
              position: "absolute",
              top: -14,
              right: 16,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              borderRadius: 8,
              background: "#ffffff",
              border: "1px solid rgba(0,0,0,0.08)",
              fontSize: 9.5,
              fontWeight: 700,
              color: "#8592a8",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              pointerEvents: "none",
            }}
          >
            <ChevronUp className="h-2.5 w-2.5" />
            Dbl-click to collapse
          </div>
        </div>
      </HTMLContainer>
    );
  }

  indicator(shape: ClusterFrameShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />;
  }
}
