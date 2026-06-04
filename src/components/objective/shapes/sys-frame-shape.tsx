"use client";

// ── SysFrameShapeUtil — the decomposition GROUP frame ───────────────
//
// A minimal container that wraps one decomposition (its feature/variable
// cards + their arrows) into a single artifact: a frosted, soft-glow rounded
// panel with a quiet folder-tab label. Sits BEHIND the cards (create it first
// / send to back) so clicking a card still selects the card, while clicking
// the frame's open area selects the whole group — the unit converge/diverge
// and the objective connector attach to. Deliberately softer than a Miro
// frame: no hard tinted fill, no big solid tab — just frosted glass + an
// accent glow + a small label, per the board's Apple-vibe look.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";

export type SysFrameShape = TLBaseShape<
  "sys-frame",
  {
    w: number;
    h: number;
    label: string;
    /** Accent hex (drives the tab + glow). */
    accent: string;
  }
>;

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(124,58,237,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export class SysFrameShapeUtil extends BaseBoxShapeUtil<SysFrameShape> {
  static override type = "sys-frame" as const;
  static override props: RecordProps<SysFrameShape> = {
    w: T.number,
    h: T.number,
    label: T.string,
    accent: T.string,
  };

  getDefaultProps(): SysFrameShape["props"] {
    return { w: 640, h: 420, label: "Decomposition", accent: "#7C3AED" };
  }

  override canResize = () => true;
  override canEdit = () => false;
  // It's a passive backdrop — never the edit target, and it shouldn't bind as
  // an arrow start/end by accident (the deliberate frame→objective connector
  // is created explicitly).
  override canBind = () => true;

  component(shape: SysFrameShape) {
    const { w, h, label, accent } = shape.props;
    return (
      <HTMLContainer style={{ width: w, height: h, pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 24,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.30))",
            backdropFilter: "blur(6px) saturate(1.2)",
            WebkitBackdropFilter: "blur(6px) saturate(1.2)",
            border: `1px solid ${hexToRgba(accent, 0.16)}`,
            boxShadow: `0 30px 70px -34px ${hexToRgba(accent, 0.4)}, inset 0 1px 0 rgba(255,255,255,0.6)`,
          }}
        />
        {/* Quiet folder-tab label — small, accent-tinted, top-left. */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: 16,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "5px 11px",
            borderRadius: 999,
            background: hexToRgba(accent, 0.1),
            border: `1px solid ${hexToRgba(accent, 0.2)}`,
            color: accent,
            fontSize: 12,
            fontWeight: 650,
            letterSpacing: "-0.005em",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
            whiteSpace: "nowrap",
            maxWidth: w - 60,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: accent,
              flex: "0 0 auto",
            }}
          />
          {label}
        </div>
      </HTMLContainer>
    );
  }

  indicator(shape: SysFrameShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={24} ry={24} />;
  }
}
