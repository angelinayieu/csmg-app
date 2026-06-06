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
      // Pick the ports by the DOMINANT axis so the wire flows cleanly: a card
      // stacked BELOW its source connects bottom→top (vertical), side-by-side
      // connects right→left. Never the weird side-to-side loop when stacked.
      const dxc = b.midX - a.midX;
      const dyc = b.midY - a.midY;
      let pax: number, pay: number, pbx: number, pby: number;
      let vertical: boolean;
      if (Math.abs(dyc) >= Math.abs(dxc)) {
        vertical = true;
        if (dyc >= 0) {
          // target below → out = source bottom-center, in = target top-center
          pax = a.midX; pay = a.maxY; pbx = b.midX; pby = b.minY;
        } else {
          pax = a.midX; pay = a.minY; pbx = b.midX; pby = b.maxY;
        }
      } else {
        vertical = false;
        if (dxc >= 0) {
          pax = a.maxX; pay = a.midY; pbx = b.minX; pby = b.midY;
        } else {
          pax = a.minX; pay = a.midY; pbx = b.maxX; pby = b.midY;
        }
      }
      // Local coords = page coords − this connector's own page point.
      return {
        ax: pax - shape.x,
        ay: pay - shape.y,
        bx: pbx - shape.x,
        by: pby - shape.y,
        vertical,
      };
    },
    [editor, shape.props.fromId, shape.props.toId, shape.x, shape.y],
  );
  if (!ends) return null;
  const { ax, ay, bx, by, vertical } = ends;
  const d = vertical
    ? `M ${ax} ${ay} C ${ax} ${ay + Math.max(40, Math.abs(by - ay) * 0.5)}, ${bx} ${by - Math.max(40, Math.abs(by - ay) * 0.5)}, ${bx} ${by}`
    : `M ${ax} ${ay} C ${ax + Math.max(40, Math.abs(bx - ax) * 0.5)} ${ay}, ${bx - Math.max(40, Math.abs(bx - ax) * 0.5)} ${by}, ${bx} ${by}`;
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
