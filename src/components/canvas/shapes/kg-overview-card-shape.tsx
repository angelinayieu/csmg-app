"use client";

// ── KG Overview card shape ────────────────────────────────────────
//
// Persistent companion to the live KGFormationShape. Same visual
// vocabulary (mini SVG graph with hub nodes + REAL connecting edges)
// but with explicit interactive affordances:
//   • Clickable "Browse entities →" button → /app/space/[id]/entities
//   • Clickable "Open lab" button (when a primary subject is set)
//   • Card click → navigates to entity browser
//
// Why a separate shape from KGFormationShape:
//   - KGFormationShape is ephemeral, owned by the live pipeline event
//     painter. It mutates on every entity_added event and is deleted
//     on run completion. Adding click handlers there would conflict
//     with its mutation lifecycle.
//   - This shape is permanent, spawned once for template-seeded
//     spaces (or future "view your KG" affordances). It needs to
//     persist across sessions and survive shape selection.
//
// Spawner: src/components/canvas/chrome/canvas-kg-overview-spawner.tsx

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Network, ListTree, ArrowUpRight } from "lucide-react";
import type { KgOverviewCardShape } from "./types";
import { nameHashSlot } from "@/lib/graph/hub-discovery";

const DEFAULT_W = 420;
const DEFAULT_H = 360;

export class KgOverviewCardShapeUtil extends BaseBoxShapeUtil<KgOverviewCardShape> {
  static override type = "kg-overview-card" as const;
  static override props: RecordProps<KgOverviewCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    entityCount: T.number,
    edgeCount: T.number,
    hubCount: T.number,
    layerCount: T.number,
    hubsJson: T.string,
    hubEdgesJson: T.string,
    title: T.string,
    accent: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: KgOverviewCardShape,
    info: TLResizeInfo<KgOverviewCardShape>,
  ) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): KgOverviewCardShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      spaceId: "",
      entityCount: 0,
      edgeCount: 0,
      hubCount: 0,
      layerCount: 0,
      hubsJson: "[]",
      hubEdgesJson: "[]",
      title: "Knowledge Graph",
      accent: "#7C3AED",
    };
  }

  component(shape: KgOverviewCardShape) {
    return <KgOverviewCardView shape={shape} />;
  }

  indicator(shape: KgOverviewCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />;
  }
}

// ── View ─────────────────────────────────────────────────────────

interface RenderedHub {
  name: string;
  degree: number;
}

interface HubEdgePair {
  a: string;
  b: string;
}

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

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function KgOverviewCardView({ shape }: { shape: KgOverviewCardShape }) {
  const {
    w,
    h,
    spaceId,
    entityCount,
    edgeCount,
    hubCount,
    layerCount,
    hubsJson,
    hubEdgesJson,
    title,
    accent,
  } = shape.props;

  const hubs = safeParseHubs(hubsJson);
  const realHubEdges = safeParseHubEdges(hubEdgesJson);
  const svgW = w - 28;
  const svgH = h - 168; // leave room for header + footer + button row
  const cx = svgW / 2;
  const cy = svgH / 2;
  const radius = Math.min(svgW, svgH) * 0.34;

  const positioned = hubs.slice(0, 6).map((hub, i) => {
    const slotJitter = (nameHashSlot(hub.name) - 0.5) * 14;
    const theta = (i / Math.max(1, hubs.length)) * Math.PI * 2 - Math.PI / 2;
    return {
      ...hub,
      x: cx + Math.cos(theta) * (radius + slotJitter),
      y: cy + Math.sin(theta) * (radius + slotJitter),
    };
  });
  const maxDegree = Math.max(1, ...positioned.map((p) => p.degree));

  const browseHref = spaceId ? `/app/space/${spaceId}/entities` : "";
  const edgesHref = spaceId ? `/app/space/${spaceId}/edges` : "";

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
      }}
    >
      <div
        // Stop pointer-down propagation so tldraw doesn't try to
        // start a select-drag from inside the card. Buttons below
        // handle their own clicks.
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 18,
          overflow: "hidden",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(248,250,253,0.97) 100%)",
          border: `1px solid ${accent}33`,
          boxShadow: `0 18px 48px -18px ${accent}22, 0 4px 16px rgba(15, 40, 90, 0.06)`,
          padding: "16px 16px 14px 16px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* Header */}
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
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "#0a1020",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                width: 22,
                height: 22,
                borderRadius: 6,
                background: `${accent}1a`,
                color: accent,
                alignItems: "center",
                justifyContent: "center",
              }}
              aria-hidden
            >
              <Network style={{ width: 12, height: 12 }} />
            </span>
            {title}
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
            borderRadius: 12,
            background: `radial-gradient(circle at 50% 50%, ${accent}0d 0%, rgba(255,255,255,0) 70%)`,
            border: `1px dashed ${accent}22`,
            overflow: "hidden",
          }}
        >
          {hubs.length === 0 ? (
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
              no hubs detected yet
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              width="100%"
              height="100%"
              preserveAspectRatio="xMidYMid meet"
              style={{ display: "block" }}
            >
              {/* Real hub-pair connector lines */}
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
                    stroke={`${accent}55`}
                    strokeWidth={1.2}
                  />
                );
              })}
              {/* Center anchor */}
              <circle
                cx={cx}
                cy={cy}
                r={9}
                fill={accent}
                stroke="white"
                strokeWidth={2}
              />
              <text
                x={cx}
                y={cy + 26}
                textAnchor="middle"
                fontSize={9}
                fontWeight={700}
                fill="#0a1020"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                CORE
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
                      stroke={`${accent}40`}
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
                      fontSize={9}
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

        {/* Stat strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 10.5,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            color: "#475569",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>
            <strong style={{ color: "#0a1020", fontWeight: 700 }}>
              {entityCount}
            </strong>{" "}
            entities
          </span>
          <span style={{ color: "#cbd5e1" }}>·</span>
          <span>
            <strong style={{ color: "#0a1020", fontWeight: 700 }}>
              {edgeCount}
            </strong>{" "}
            edges
          </span>
          <span style={{ color: "#cbd5e1" }}>·</span>
          <span>
            <strong style={{ color: accent, fontWeight: 700 }}>
              {hubCount}
            </strong>{" "}
            hubs
          </span>
          {layerCount > 0 && (
            <>
              <span style={{ color: "#cbd5e1" }}>·</span>
              <span>
                <strong style={{ color: "#0a1020", fontWeight: 700 }}>
                  {layerCount}
                </strong>{" "}
                layers
              </span>
            </>
          )}
        </div>

        {/* CTA buttons */}
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            alignItems: "center",
            marginTop: 4,
          }}
        >
          {edgesHref && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (e.metaKey || e.ctrlKey || e.button === 1) {
                  window.open(edgesHref, "_blank");
                } else {
                  window.location.href = edgesHref;
                }
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                borderRadius: 8,
                background: "white",
                color: "#475569",
                border: "1px solid #e2e8f0",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Edges
            </button>
          )}
          {browseHref && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (e.metaKey || e.ctrlKey || e.button === 1) {
                  window.open(browseHref, "_blank");
                } else {
                  window.location.href = browseHref;
                }
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 12px",
                borderRadius: 8,
                background: accent,
                color: "white",
                border: "none",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: `0 2px 8px -2px ${accent}88`,
              }}
            >
              <ListTree style={{ width: 11, height: 11 }} />
              Browse all entities
              <ArrowUpRight style={{ width: 11, height: 11 }} />
            </button>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}
