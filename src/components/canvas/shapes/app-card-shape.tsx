"use client";

// ── App card shape (Phase A1.2) ──
//
// Draggable representation of an App on the whiteboard. Apps are
// rich system objects (manifest, config, state, health score, stale
// reason) but the card only needs preview-level props — deep content
// opens in the per-app dashboard at /app/space/<sid>/app/<aid>.
//
// Visual hierarchy priority:
//   1. Stale badge (when present) — users should look here first
//   2. Status chip + type chip
//   3. Name
//   4. Health % (when present)
//   5. Intervention count
//
// Click → navigate to the app's dashboard route.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import {
  AlertTriangle,
  LayoutDashboard,
  Workflow,
  Wrench,
  LineChart,
  Plug,
  CheckCircle2,
} from "lucide-react";
import type { AppType, AppStatus, AppStaleReason } from "@/types/app";
import type { AppCardShape } from "./types";
import { CardSpecRenderer, parseCardSpec } from "@/components/cards";

const APP_TYPE_ACCENT: Record<AppType, string> = {
  dashboard: "#3B82F6",      // blue
  workflow: "#8B5CF6",       // violet
  tool: "#10B981",           // green
  monitor: "#F59E0B",        // amber
  integration: "#EC4899",    // pink
};

const APP_TYPE_BG: Record<AppType, string> = {
  dashboard: "#DBEAFE",
  workflow: "#EDE9FE",
  tool: "#D1FAE5",
  monitor: "#FEF3C7",
  integration: "#FCE7F3",
};

const APP_TYPE_ICON: Record<
  AppType,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  dashboard: LayoutDashboard,
  workflow: Workflow,
  tool: Wrench,
  monitor: LineChart,
  integration: Plug,
};

const STATUS_COLOR: Record<AppStatus, string> = {
  proposed: "#64748b",
  approved: "#0ea5e9",
  active: "#16a34a",
  paused: "#d97706",
  retired: "#94a3b8",
};

// Only the unstable reasons that a user cares about — null means fresh.
const STALE_LABEL: Record<AppStaleReason, string> = {
  kg_changed: "KG changed",
  new_research: "New research",
  user_feedback: "Feedback",
  strategy_regen: "Strategy regen",
  whiteboard_edit: "Edited",
};

const VALID_TYPES: readonly AppType[] = [
  "dashboard",
  "workflow",
  "tool",
  "monitor",
  "integration",
] as const;

const VALID_STATUSES: readonly AppStatus[] = [
  "proposed",
  "approved",
  "active",
  "paused",
  "retired",
] as const;

const VALID_STALE_REASONS: readonly AppStaleReason[] = [
  "kg_changed",
  "new_research",
  "user_feedback",
  "strategy_regen",
  "whiteboard_edit",
] as const;

export class AppCardShapeUtil extends BaseBoxShapeUtil<AppCardShape> {
  static override type = "app-card" as const;
  static override props: RecordProps<AppCardShape> = {
    w: T.number,
    h: T.number,
    appId: T.string,
    spaceId: T.string,
    name: T.string,
    appType: T.literalEnum(...VALID_TYPES),
    status: T.literalEnum(...VALID_STATUSES),
    healthScore: T.number.nullable(),
    staleReason: T.literalEnum(...VALID_STALE_REASONS).nullable(),
    hasInterventions: T.boolean,
    interventionCount: T.number,
    accent: T.string,
    expanded: T.boolean,
    p10: T.number.nullable(),
    p50: T.number.nullable(),
    p90: T.number.nullable(),
    cardSpecJson: T.string.nullable(),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: AppCardShape, info: TLResizeInfo<AppCardShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): AppCardShape["props"] {
    return {
      w: 220,
      h: 152,
      appId: "",
      spaceId: "",
      name: "Untitled app",
      appType: "dashboard",
      status: "proposed",
      healthScore: null,
      staleReason: null,
      hasInterventions: false,
      interventionCount: 0,
      accent: APP_TYPE_ACCENT.dashboard,
      expanded: false,
      p10: null,
      p50: null,
      p90: null,
      cardSpecJson: null,
    };
  }

  component(shape: AppCardShape) {
    return <AppCardShapeView shape={shape} />;
  }

  indicator(shape: AppCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

function AppCardShapeView({ shape }: { shape: AppCardShape }) {
  const {
    appId,
    spaceId,
    name,
    appType,
    status,
    healthScore,
    staleReason,
    interventionCount,
    p10,
    p50,
    p90,
    cardSpecJson,
  } = shape.props;

  const typeAccent = APP_TYPE_ACCENT[appType];
  const typeBg = APP_TYPE_BG[appType];
  const TypeIcon = APP_TYPE_ICON[appType];
  const statusColor = STATUS_COLOR[status];
  const isStale = !!staleReason;
  const hasHealth = typeof healthScore === "number";
  const hasDistribution =
    typeof p10 === "number" && typeof p50 === "number" && typeof p90 === "number";
  // CardSpec wins over the legacy DistributionBand whenever it parses
  // cleanly. Active apps render in "live" mode (badge says "Today");
  // everything pre-active reads as a forecast.
  const cardSpec = parseCardSpec(cardSpecJson);
  const cardSpecMode = status === "active" ? "live" : "forecast";

  const navHref = spaceId && appId ? `/app/space/${spaceId}/app/${appId}` : "";

  // ── CardSpec render path ─────────────────────────────────────────
  // When the app row carries a card_spec, the entire body is delegated
  // to <CardSpecRenderer />. We keep the outer click/nav wrapper +
  // stale chrome so canvas behaviors (drag-stop, click-to-open, stale
  // glow) stay identical.
  if (cardSpec) {
    return (
      <HTMLContainer
        style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            cursor: "pointer",
            outline: isStale ? "2px solid rgba(217,119,6,0.45)" : undefined,
            outlineOffset: isStale ? -2 : undefined,
            borderRadius: 14,
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
          role={navHref ? "link" : undefined}
          title={
            staleReason ? `${name} — ${STALE_LABEL[staleReason as AppStaleReason] ?? "stale"}` : name
          }
        >
          <CardSpecRenderer spec={cardSpec} mode={cardSpecMode} size="compact" />
        </div>
      </HTMLContainer>
    );
  }

  // ── Legacy render path (no card_spec yet) ────────────────────────
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
          borderRadius: 14,
          overflow: "hidden",
          background: "rgba(255, 255, 255, 0.94)",
          backdropFilter: "blur(12px)",
          border: isStale
            ? "1px solid rgba(217, 119, 6, 0.45)"
            : "1px solid rgba(10, 30, 80, 0.08)",
          boxShadow: isStale
            ? "0 8px 22px -8px rgba(217, 119, 6, 0.25), 0 3px 10px rgba(217, 119, 6, 0.08)"
            : "0 8px 22px -8px rgba(8, 60, 180, 0.12), 0 3px 10px rgba(8, 60, 180, 0.06)",
          padding: "12px 14px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          gap: 6,
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
        role={navHref ? "link" : undefined}
        title={staleReason ? `${name} — ${STALE_LABEL[staleReason as AppStaleReason] ?? "stale"}` : name}
      >
        {/* Left rail accent */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: typeAccent,
            boxShadow: `0 0 12px ${typeAccent}55`,
          }}
        />

        {/* Top chip row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              borderRadius: 3,
              background: typeBg,
              color: typeAccent,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            <TypeIcon style={{ width: 9, height: 9 }} />
            {appType}
          </span>
          {isStale && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                padding: "2px 6px",
                borderRadius: 3,
                background: "rgba(217, 119, 6, 0.12)",
                color: "#b45309",
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
              title={`Stale — ${STALE_LABEL[staleReason as AppStaleReason] ?? "changed"}`}
            >
              <AlertTriangle style={{ width: 9, height: 9 }} />
              Stale
            </span>
          )}
          {hasHealth && (
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 14,
                fontWeight: 700,
                color: typeAccent,
                fontVariantNumeric: "tabular-nums",
              }}
              title="Health score"
            >
              {Math.round(healthScore)}%
            </span>
          )}
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            lineHeight: 1.25,
            color: "#0a1020",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            flex: 1,
          }}
        >
          {name}
        </div>

        {hasDistribution && (
          <DistributionBand
            p10={p10 as number}
            p50={p50 as number}
            p90={p90 as number}
            accent={typeAccent}
          />
        )}

        {/* Footer: status + intervention count + open hint */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 9.5,
            color: "#64748b",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.04em",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              color: statusColor,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontSize: 8.5,
            }}
          >
            <CheckCircle2 style={{ width: 8, height: 8 }} />
            {status}
          </span>
          {interventionCount > 0 && (
            <>
              <span style={{ color: "#cbd5e1" }}>·</span>
              <span>
                {interventionCount}{" "}
                {interventionCount === 1 ? "intervention" : "interventions"}
              </span>
            </>
          )}
          <span
            style={{
              marginLeft: "auto",
              color: typeAccent,
              fontWeight: 700,
            }}
          >
            Open →
          </span>
        </div>
      </div>
    </HTMLContainer>
  );
}

function DistributionBand({
  p10,
  p50,
  p90,
  accent,
}: {
  p10: number;
  p50: number;
  p90: number;
  accent: string;
}) {
  const bandWidth = Math.max(0.0001, p90 - p10);
  const p50Pct = Math.max(0, Math.min(100, ((p50 - p10) / bandWidth) * 100));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 8.5,
        color: "#64748b",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        letterSpacing: "0.04em",
      }}
      title={`Simulated range · p10 ${p10.toFixed(2)} · p50 ${p50.toFixed(2)} · p90 ${p90.toFixed(2)}`}
    >
      <span style={{ color: "#94a3b8", fontWeight: 600 }}>{p10.toFixed(1)}</span>
      <div
        style={{
          position: "relative",
          flex: 1,
          height: 6,
          borderRadius: 3,
          background: `linear-gradient(90deg, ${accent}22, ${accent}cc)`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -2,
            left: `calc(${p50Pct}% - 1px)`,
            width: 2,
            height: 10,
            background: "#0a1020",
            borderRadius: 1,
          }}
          aria-label={`p50 = ${p50.toFixed(2)}`}
        />
      </div>
      <span style={{ color: accent, fontWeight: 700 }}>{p90.toFixed(1)}</span>
    </div>
  );
}
