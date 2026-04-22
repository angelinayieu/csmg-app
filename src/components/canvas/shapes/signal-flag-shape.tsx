"use client";

// ── Signal flag shape (Phase A1.4b) ──
//
// External intelligence signal picked up by the radar / weave layer.
// Urgent by default — severity drives accent + the flag icon's fill.
// Displays category + type + description + related internal entities.
//
// No persistent row = no deep link target beyond the first related
// entity's lab (if present). The drop captures a frozen copy of the
// signal so the reading survives later radar updates.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Flag, AlertTriangle } from "lucide-react";
import type { SignalFlagShape } from "./types";

type Severity = SignalFlagShape["props"]["severity"];
type Status = SignalFlagShape["props"]["status"];

const SEVERITY_META: Record<
  Severity,
  { color: string; bg: string; label: string }
> = {
  high: { color: "#dc2626", bg: "#fee2e2", label: "High" },
  medium: { color: "#d97706", bg: "#fef3c7", label: "Medium" },
  low: { color: "#64748b", bg: "#f1f5f9", label: "Low" },
};

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  dismissed: "Dismissed",
  investigating: "Investigating",
  escalated: "Escalated",
  resolved: "Resolved",
};

const VALID_SEVERITIES: readonly Severity[] = ["high", "medium", "low"] as const;
const VALID_STATUSES: readonly Status[] = [
  "active",
  "dismissed",
  "investigating",
  "escalated",
  "resolved",
] as const;

export class SignalFlagShapeUtil extends BaseBoxShapeUtil<SignalFlagShape> {
  static override type = "signal-flag" as const;
  static override props: RecordProps<SignalFlagShape> = {
    w: T.number,
    h: T.number,
    signalId: T.string,
    spaceId: T.string,
    signalType: T.string,
    category: T.string,
    description: T.string,
    severity: T.literalEnum(...VALID_SEVERITIES),
    status: T.literalEnum(...VALID_STATUSES),
    entityName: T.string,
    relatedInternalIds: T.arrayOf(T.string),
    detectedAt: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: SignalFlagShape, info: TLResizeInfo<SignalFlagShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): SignalFlagShape["props"] {
    return {
      w: 260,
      h: 128,
      signalId: "",
      spaceId: "",
      signalType: "new_entity",
      category: "signal",
      description: "Untitled signal",
      severity: "medium",
      status: "active",
      entityName: "",
      relatedInternalIds: [],
      detectedAt: new Date().toISOString(),
    };
  }

  component(shape: SignalFlagShape) {
    return <SignalFlagShapeView shape={shape} />;
  }

  indicator(shape: SignalFlagShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />;
  }
}

function relativeTime(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
}

function SignalFlagShapeView({ shape }: { shape: SignalFlagShape }) {
  const {
    spaceId,
    signalType,
    category,
    description,
    severity,
    status,
    entityName,
    relatedInternalIds,
    detectedAt,
  } = shape.props;

  const meta = SEVERITY_META[severity];
  const navHref =
    spaceId && relatedInternalIds[0]
      ? `/app/space/${spaceId}/entity/${relatedInternalIds[0]}/lab`
      : "";
  const isHighUrgency = severity === "high" && status === "active";

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
          borderRadius: 12,
          overflow: "hidden",
          background: isHighUrgency
            ? "linear-gradient(180deg, rgba(254, 242, 242, 0.98), rgba(254, 248, 247, 0.96))"
            : "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(12px)",
          border: `1px solid ${meta.color}${isHighUrgency ? "55" : "30"}`,
          boxShadow: isHighUrgency
            ? `0 10px 26px -10px ${meta.color}44, 0 3px 10px rgba(8, 60, 180, 0.06)`
            : `0 6px 18px -6px ${meta.color}22, 0 2px 6px rgba(8, 60, 180, 0.05)`,
          padding: "12px 14px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          cursor: navHref ? "pointer" : "default",
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
      >
        {/* Left accent rail */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: meta.color,
            boxShadow: isHighUrgency ? `0 0 14px ${meta.color}` : "none",
          }}
        />

        {/* Header: flag icon + severity chip + type + time */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Flag
            style={{
              width: 12,
              height: 12,
              color: meta.color,
              fill: isHighUrgency ? meta.color : "transparent",
              flexShrink: 0,
            }}
            aria-hidden
          />
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 6px",
              borderRadius: 3,
              background: meta.bg,
              color: meta.color,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            {isHighUrgency && (
              <AlertTriangle style={{ width: 8, height: 8 }} />
            )}
            {meta.label}
          </span>
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#94a3b8",
            }}
          >
            {signalType.replace(/_/g, " ")}
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 9,
              color: "#64748b",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: "0.04em",
            }}
            title={new Date(detectedAt).toLocaleString()}
          >
            {relativeTime(detectedAt)}
          </span>
        </div>

        {/* Entity name (the external thing this signal is about) */}
        {entityName && (
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: meta.color,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={entityName}
          >
            {entityName}
          </div>
        )}

        {/* Description */}
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.45,
            color: "#1e293b",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            flex: 1,
          }}
          title={description}
        >
          {description}
        </div>

        {/* Footer: category + status + related count + open hint */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 9,
            color: "#64748b",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.04em",
          }}
        >
          <span>{category.replace(/_/g, " ")}</span>
          <span style={{ color: "#cbd5e1" }}>·</span>
          <span style={{ color: meta.color, fontWeight: 700 }}>
            {STATUS_LABEL[status]}
          </span>
          {relatedInternalIds.length > 0 && (
            <>
              <span style={{ color: "#cbd5e1" }}>·</span>
              <span>
                {relatedInternalIds.length} internal
              </span>
            </>
          )}
          {navHref && (
            <span
              style={{
                marginLeft: "auto",
                color: meta.color,
                fontWeight: 700,
              }}
            >
              Open →
            </span>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}
