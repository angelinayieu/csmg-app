"use client";

// ── FlowConnectorShapeUtil ─────────────────────────────────────────────
//
// The REAL bound connector (the dark flow-builder look the user chose): a
// smooth bezier wire with a CIRCULAR green-out / pink-in port pair + a green→
// pink gradient. It's a true tldraw scene shape (not the rejected SVG overlay):
// it stores fromId/toId, reads its endpoints' live page bounds reactively, and
// renders the wire in its own local space. A board reactor (flow-connector-board
// .ts) keeps its x/y/w/h synced to the endpoints so it MOVES with the cards.
//
// Encoding: GREEN port = output ("feeds") · PINK port = input ("depends_on").

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  useValue,
  type RecordProps,
  type TLBaseShape,
  type TLShapeId,
} from "tldraw";

const GREEN = "#34d399"; // output · feeds
const PINK = "#ec4899"; // input · depends_on

export type FlowConnectorShape = TLBaseShape<
  "flow-connector",
  { w: number; h: number; fromId: string; toId: string; color: string }
>;

export class FlowConnectorShapeUtil extends BaseBoxShapeUtil<FlowConnectorShape> {
  static override type = "flow-connector" as const;
  static override props: RecordProps<FlowConnectorShape> = {
    w: T.number,
    h: T.number,
    fromId: T.string,
    toId: T.string,
    color: T.string,
  };

  // A passive wire: never resized/edited/bound directly, never the drag target.
  override canResize = () => false;
  override canEdit = () => false;
  override canBind = () => false;

  getDefaultProps(): FlowConnectorShape["props"] {
    return { w: 1, h: 1, fromId: "", toId: "", color: GREEN };
  }

  component(shape: FlowConnectorShape) {
    return <FlowConnectorRenderer shape={shape} util={this} />;
  }

  indicator(shape: FlowConnectorShape) {
    return <rect width={shape.props.w} height={shape.props.h} fill="none" />;
  }
}

function FlowConnectorRenderer({
  shape,
  util,
}: {
  shape: FlowConnectorShape;
  util: FlowConnectorShapeUtil;
}) {
  const editor = util.editor;
  // Read both endpoints reactively → re-render the wire as the cards move.
  const ends = useValue(
    "flow-connector-ends",
    () => {
      const a = editor.getShapePageBounds(shape.props.fromId as TLShapeId);
      const b = editor.getShapePageBounds(shape.props.toId as TLShapeId);
      if (!a || !b) return null;
      // Local coords = page coords − this connector's own page point. Out port =
      // right-center of the source; in port = left-center of the target.
      return {
        ax: a.maxX - shape.x,
        ay: a.midY - shape.y,
        bx: b.minX - shape.x,
        by: b.midY - shape.y,
      };
    },
    [editor, shape.props.fromId, shape.props.toId, shape.x, shape.y],
  );
  if (!ends) return null;
  const { ax, ay, bx, by } = ends;
  const dx = Math.max(40, Math.abs(bx - ax) * 0.5);
  const d = `M ${ax} ${ay} C ${ax + dx} ${ay}, ${bx - dx} ${by}, ${bx} ${by}`;
  const gid = `fcg-${shape.id.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <svg
        width={shape.props.w}
        height={shape.props.h}
        style={{ position: "absolute", overflow: "visible", pointerEvents: "none" }}
      >
        <defs>
          <linearGradient
            id={gid}
            gradientUnits="userSpaceOnUse"
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
          >
            <stop offset="0%" stopColor={GREEN} />
            <stop offset="100%" stopColor={PINK} />
          </linearGradient>
        </defs>
        <path
          d={d}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={ax} cy={ay} r={6} fill={GREEN} />
        <circle cx={bx} cy={by} r={6} fill={PINK} />
      </svg>
    </HTMLContainer>
  );
}
