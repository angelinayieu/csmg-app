"use client";

// ── Twin snapshot shape (Phase A1.4c) ──
//
// A frozen reading of a space's twin state at a specific moment in
// time. Users drop one (or many) snapshots on the whiteboard to
// reason about trajectory — compare today's state to one from last
// week, or contextualize entities against the space's overall health.
//
// Unlike other asset classes, Twin is a per-space singleton at the
// source. Multiple drops of "this twin" produce multiple frozen
// readings timestamped at each drop — that's the explicit design.
// Each snapshot carries its own `snappedAt` so duplicate shape ids
// (keyed by time) never collide.
//
// Click → opens the live /twin view for the originating space.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import {
  Activity,
  TrendingUp,
  ShieldAlert,
  RotateCw,
  Layers,
} from "lucide-react";
import type { TwinSnapshotShape } from "./types";

type Label = TwinSnapshotShape["props"]["healthLabel"];

const HEALTH_META: Record<
  Label,
  { color: string; bg: string; label: string }
> = {
  strong: { color: "#16a34a", bg: "#dcfce7", label: "Strong" },
  developing: { color: "#0891b2", bg: "#cffafe", label: "Developing" },
  fragile: { color: "#d97706", bg: "#fef3c7", label: "Fragile" },
  critical: { color: "#dc2626", bg: "#fee2e2", label: "Critical" },
};

const VALID_LABELS: readonly Label[] = [
  "strong",
  "developing",
  "fragile",
  "critical",
] as const;

const MATURITY_LABELS = [
  "actionable_now",
  "waiting_on_dependency",
  "theoretical",
  "blocked",
] as const;

export class TwinSnapshotShapeUtil extends BaseBoxShapeUtil<TwinSnapshotShape> {
  static override type = "twin-snapshot" as const;
  static override props: RecordProps<TwinSnapshotShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    spaceName: T.string,
    snappedAt: T.string,
    healthScore: T.number,
    healthLabel: T.literalEnum(...VALID_LABELS),
    maturity: T.literalEnum(...MATURITY_LABELS),
    entitiesCount: T.number,
    edgesCount: T.number,
    cyclesCount: T.number,
    leveragePoints: T.number,
    riskPoints: T.number,
    reinforcingPositive: T.number,
    reinforcingNegative: T.number,
    balancing: T.number,
    bottleneckName: T.string.nullable(),
    bottleneckShare: T.number.nullable(),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: TwinSnapshotShape, info: TLResizeInfo<TwinSnapshotShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): TwinSnapshotShape["props"] {
    return {
      w: 340,
      h: 220,
      spaceId: "",
      spaceName: "Untitled space",
      snappedAt: new Date().toISOString(),
      healthScore: 0,
      healthLabel: "developing",
      maturity: "theoretical",
      entitiesCount: 0,
      edgesCount: 0,
      cyclesCount: 0,
      leveragePoints: 0,
      riskPoints: 0,
      reinforcingPositive: 0,
      reinforcingNegative: 0,
      balancing: 0,
      bottleneckName: null,
      bottleneckShare: null,
    };
  }

  component(shape: TwinSnapshotShape) {
    return <TwinSnapshotShapeView shape={shape} />;
  }

  indicator(shape: TwinSnapshotShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function TwinSnapshotShapeView({ shape }: { shape: TwinSnapshotShape }) {
  const {
    spaceId,
    spaceName,
    snappedAt,
    healthScore,
    healthLabel,
    maturity,
    entitiesCount,
    edgesCount,
    cyclesCount,
    leveragePoints,
    riskPoints,
    reinforcingPositive,
    reinforcingNegative,
    balancing,
    bottleneckName,
    bottleneckShare,
  } = shape.props;

  const meta = HEALTH_META[healthLabel];
  const navHref = spaceId ? `/app/space/${spaceId}/twin` : "";

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
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 16,
          overflow: "hidden",
          // Twin feels like "satellite view" — cooler, deeper gradient
          // than a typical card so it reads as a system-level readout.
          background:
            "linear-gradient(180deg, rgba(248, 250, 253, 0.98) 0%, rgba(240, 244, 250, 0.97) 100%)",
          backdropFilter: "blur(14px)",
          border: `1px solid ${meta.color}40`,
          boxShadow: `0 12px 32px -12px ${meta.color}33, 0 4px 12px rgba(8, 60, 180, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.9)`,
          padding: "14px 16px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          cursor: navHref ? "pointer" : "default",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (!navHref) return;
          e.stopPropagation();
          if (e.metaKey || e.ctrlKey || e.button === 1) {
            window.open(navHref, "_blank");
          } else {
            window.location.href = navHref;
          }
        }}
      >
        {/* Top rail */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 3,
            background: `linear-gradient(90deg, ${meta.color}, ${meta.color}88)`,
          }}
        />

        {/* Header: TWIN chip + snapped-at + space name */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              borderRadius: 3,
              background: meta.bg,
              color: meta.color,
              fontSize: 8,
              fontWeight: 800,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
            }}
          >
            <Activity style={{ width: 9, height: 9 }} />
            Twin
          </span>
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 9,
              color: "#94a3b8",
              letterSpacing: "0.04em",
            }}
            title={`Snapshot taken ${new Date(snappedAt).toLocaleString()}`}
          >
            {formatDate(snappedAt)}
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 8,
              color: "#64748b",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
            title={`Maturity: ${maturity.replace(/_/g, " ")}`}
          >
            {maturity.replace(/_/g, " ")}
          </span>
        </div>

        {/* Space name + health readout */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: 72,
              height: 60,
              borderRadius: 10,
              background: meta.bg,
              border: `1px solid ${meta.color}44`,
            }}
          >
            <span
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 24,
                fontWeight: 800,
                color: meta.color,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.round(healthScore)}
            </span>
            <span
              style={{
                marginTop: 2,
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: meta.color,
              }}
            >
              {meta.label}
            </span>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                lineHeight: 1.25,
                color: "#0a1020",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
              title={spaceName}
            >
              {spaceName}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 10,
                color: "#64748b",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {entitiesCount} nodes · {edgesCount} edges · {cyclesCount}{" "}
              {cyclesCount === 1 ? "cycle" : "cycles"}
            </div>
          </div>
        </div>

        {/* Three-panel grid: coverage · risk · dynamics */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 6,
            fontSize: 9.5,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          <Panel
            icon={<Layers style={{ width: 10, height: 10, color: "#0891b2" }} />}
            label="Leverage"
            value={`${leveragePoints}`}
            color="#0891b2"
            sub="high-impact nodes"
          />
          <Panel
            icon={<ShieldAlert style={{ width: 10, height: 10, color: "#d97706" }} />}
            label="Risk"
            value={`${riskPoints}`}
            color="#d97706"
            sub={
              bottleneckShare !== null
                ? `B=${Math.round(bottleneckShare * 100)}%`
                : "risk points"
            }
          />
          <Panel
            icon={<RotateCw style={{ width: 10, height: 10, color: "#16a34a" }} />}
            label="Dynamics"
            value={`${reinforcingPositive + reinforcingNegative + balancing}`}
            color="#16a34a"
            sub={`+${reinforcingPositive} −${reinforcingNegative} =${balancing}`}
          />
        </div>

        {/* Bottleneck callout when present */}
        {bottleneckName && (
          <div
            style={{
              marginTop: "auto",
              fontSize: 9.5,
              lineHeight: 1.4,
              color: "#64748b",
              display: "flex",
              alignItems: "center",
              gap: 4,
              paddingTop: 6,
              borderTop: "1px dashed rgba(148, 163, 184, 0.3)",
            }}
            title={`Master bottleneck: ${bottleneckName}`}
          >
            <TrendingUp
              style={{ width: 10, height: 10, color: "#dc2626", flexShrink: 0 }}
            />
            <span style={{ color: "#475569", fontWeight: 600 }}>Bottleneck:</span>
            <span
              style={{
                color: "#0a1020",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {bottleneckName}
            </span>
          </div>
        )}

        {navHref && (
          <span
            style={{
              position: "absolute",
              right: 14,
              bottom: 10,
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: meta.color,
              opacity: 0.8,
            }}
          >
            Open live twin →
          </span>
        )}
      </div>
    </HTMLContainer>
  );
}

function Panel({
  icon,
  label,
  value,
  color,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  sub: string;
}) {
  return (
    <div
      style={{
        padding: "6px 8px",
        borderRadius: 6,
        background: "rgba(255, 255, 255, 0.6)",
        border: "1px solid rgba(148, 163, 184, 0.2)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          fontSize: 7.5,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#64748b",
        }}
      >
        {icon}
        {label}
      </div>
      <div
        style={{
          marginTop: 2,
          fontSize: 16,
          fontWeight: 800,
          color,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 2,
          fontSize: 8.5,
          color: "#94a3b8",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {sub}
      </div>
    </div>
  );
}
