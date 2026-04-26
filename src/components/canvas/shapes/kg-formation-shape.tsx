"use client";

// ── KG Formation live overview shape ──
//
// The centerpiece the user asked for in the Project-Overview design pass:
// a tall rectangular card that renders at the top of the canvas during an
// active pipeline run and paints the "landscape being formed" in real
// time — entity count, edge count, hub count, plus a mini force-directed
// preview of the top-degree entities.
//
// Not a persisted artifact. The painter creates it on stage_boundary(kg,
// enter), mutates its props on every entity_added / edge_added event, and
// deletes it on run completion along with the other ghost shapes. All
// counts are local tallies (no DB round-trip), so it costs nothing per
// event.
//
// Visual hierarchy (mirrors the design reference):
//   1. Title row   — "Knowledge Graph formation" + count chip
//   2. Mini graph  — labeled hub nodes with fine connecting lines
//   3. Stat footer — "N entities · M edges · K hubs"
//
// The hub list is the top-6 entities by degree, re-sorted on every edge
// event. Positions are deterministic (hash of name + index) so the same
// entity keeps the same slot as new hubs displace older ones. No user
// interaction — this shape is read-only during the run.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import type { KGFormationShape } from "./types";
import { nameHashSlot, type Hub } from "@/lib/graph/hub-discovery";

const DEFAULT_W = 360;
const DEFAULT_H = 280;

export class KGFormationShapeUtil extends BaseBoxShapeUtil<KGFormationShape> {
  static override type = "kg-formation" as const;
  static override props: RecordProps<KGFormationShape> = {
    w: T.number,
    h: T.number,
    entityCount: T.number,
    edgeCount: T.number,
    hubCount: T.number,
    // Serialized JSON of up to 6 hub entries: { name, degree }.
    // tldraw props don't support complex unions well; JSON round-trip
    // keeps the schema flat while still giving us typed data at runtime.
    hubsJson: T.string,
    // JSON: Array<{ a: string; b: string }> — REAL edges connecting
    // visible hubs. Replaces the cosmetic all-pairs lines the
    // renderer used to draw.
    hubEdgesJson: T.string,
    // Monotonic counter bumped every paint-event so the shape re-renders
    // even when semantic content is unchanged (edge count can increment
    // without hub list changing).
    pulse: T.number,
    accent: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: KGFormationShape, info: TLResizeInfo<KGFormationShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): KGFormationShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      entityCount: 0,
      edgeCount: 0,
      hubCount: 0,
      hubsJson: "[]",
      hubEdgesJson: "[]",
      pulse: 0,
      accent: "#2563eb",
    };
  }

  component(shape: KGFormationShape) {
    return <KGFormationView shape={shape} />;
  }

  indicator(shape: KGFormationShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />;
  }
}

// Hub shape imported from the shared utility — same definition the
// painter (incremental HubTracker) and SpaceDataContext (static
// computeHubsFromGraph) use. Payload stores only name + degree for
// compactness in the tldraw doc; entityId isn't needed for rendering.
type RenderedHub = Pick<Hub, "name" | "degree">;

function safeParseHubs(json: string): RenderedHub[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (h) => h && typeof h.name === "string" && typeof h.degree === "number",
      )
      .slice(0, 6);
  } catch {
    return [];
  }
}

interface HubEdgePair {
  a: string;
  b: string;
}

function safeParseHubEdges(json: string): HubEdgePair[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) =>
        e &&
        typeof e.a === "string" &&
        typeof e.b === "string" &&
        e.a !== e.b,
    );
  } catch {
    return [];
  }
}

function KGFormationView({ shape }: { shape: KGFormationShape }) {
  const {
    w,
    h,
    entityCount,
    edgeCount,
    hubCount,
    hubsJson,
    hubEdgesJson,
    accent,
    pulse,
  } = shape.props;
  const hubs = safeParseHubs(hubsJson);
  const realHubEdges = safeParseHubEdges(hubEdgesJson);
  const svgW = w - 28;
  const svgH = h - 104;
  const cx = svgW / 2;
  const cy = svgH / 2;
  const radius = Math.min(svgW, svgH) * 0.34;

  // Lay hubs on a circle, ordered by degree so the top-degree hub sits
  // at top-center and subsequent hubs fan around clockwise.
  const positioned = hubs
    .slice(0, 6)
    .map((hub, i) => {
      // nameHashSlot → deterministic jitter keeps the same name in the
      // same radial slot across paints, so as new hubs displace old
      // ones the layout reads as "graph growing" not "graph churning".
      const slotJitter = (nameHashSlot(hub.name) - 0.5) * 14;
      const theta = (i / Math.max(1, hubs.length)) * Math.PI * 2 - Math.PI / 2;
      return {
        ...hub,
        x: cx + Math.cos(theta) * (radius + slotJitter),
        y: cy + Math.sin(theta) * (radius + slotJitter),
      };
    });

  const maxDegree = Math.max(1, ...positioned.map((p) => p.degree));

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
      }}
    >
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 16,
          overflow: "hidden",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,248,253,0.96) 100%)",
          border: "1px solid rgba(15, 40, 90, 0.08)",
          boxShadow:
            "0 18px 48px -18px rgba(15, 40, 90, 0.22), 0 4px 16px rgba(15, 40, 90, 0.06)",
          padding: "14px 14px 12px 14px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
        data-pulse={pulse}
      >
        {/* Title row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            <LivePip accent={accent} />
            Knowledge Graph formation
          </div>
          <div
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#64748b",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {entityCount} ENTITIES · {edgeCount} EDGES
          </div>
        </div>

        {/* Mini graph */}
        <div
          style={{
            position: "relative",
            flex: 1,
            borderRadius: 10,
            background:
              "radial-gradient(circle at 50% 50%, rgba(37, 99, 235, 0.04) 0%, rgba(255,255,255,0) 70%)",
            border: "1px dashed rgba(15, 40, 90, 0.08)",
            overflow: "hidden",
          }}
        >
          {hubs.length === 0 ? (
            <EmptyState accent={accent} />
          ) : (
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              width="100%"
              height="100%"
              preserveAspectRatio="xMidYMid meet"
              style={{ display: "block" }}
            >
              {/* Connector lines between hub pairs that have a REAL
                  edge between them. Replaces the prior cosmetic
                  all-pairs lines that misrepresented "every hub
                  is connected to every other hub." When the painter
                  doesn't yet have edge data (early in a run, or if
                  the shape is restored from a pre-fix snapshot
                  where hubEdgesJson is "[]"), the field of nodes
                  renders without connectors — accurate "no edges
                  observed yet" state. */}
              {realHubEdges.map((pair, i) => {
                const a = positioned.find((p) => p.name === pair.a);
                const b = positioned.find((p) => p.name === pair.b);
                if (!a || !b) return null;
                return (
                  <line
                    key={`l-${i}-${pair.a}-${pair.b}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="rgba(37, 99, 235, 0.32)"
                    strokeWidth={1.1}
                  />
                );
              })}
              {/* PROMPT center — always present, represents the run's root */}
              <circle
                cx={cx}
                cy={cy}
                r={8}
                fill={accent}
                stroke="white"
                strokeWidth={2}
              />
              <text
                x={cx}
                y={cy + 24}
                textAnchor="middle"
                fontSize={9}
                fontWeight={700}
                fill="#0a1020"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                PROMPT
              </text>

              {/* Hub nodes */}
              {positioned.map((p, i) => {
                const size = 4 + (p.degree / maxDegree) * 5;
                return (
                  <g key={`h-${i}`}>
                    <line
                      x1={cx}
                      y1={cy}
                      x2={p.x}
                      y2={p.y}
                      stroke="rgba(37, 99, 235, 0.32)"
                      strokeWidth={0.9}
                    />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={size}
                      fill="white"
                      stroke={accent}
                      strokeWidth={1.6}
                    />
                    <text
                      x={p.x}
                      y={p.y - size - 4}
                      textAnchor="middle"
                      fontSize={8.5}
                      fontWeight={600}
                      fill="#0a1020"
                    >
                      {truncate(p.name, 14)}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Stat footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 10,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            color: "#475569",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Stat label="entities" value={entityCount} />
          <span style={{ color: "#cbd5e1" }}>·</span>
          <Stat label="edges" value={edgeCount} />
          <span style={{ color: "#cbd5e1" }}>·</span>
          <Stat label="hubs" value={hubCount} accent={accent} />
        </div>
      </div>
    </HTMLContainer>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      <strong
        style={{
          color: accent ?? "#0a1020",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {value}
      </strong>
      <span style={{ color: "#64748b" }}>{label}</span>
    </span>
  );
}

function LivePip({ accent }: { accent: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: accent,
        boxShadow: `0 0 0 3px ${accent}22, 0 0 10px ${accent}66`,
      }}
    />
  );
}

function EmptyState({ accent }: { accent: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#94a3b8",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: accent,
            animation: "pulse 1.4s ease-in-out infinite",
          }}
        />
        awaiting first entities
      </span>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
