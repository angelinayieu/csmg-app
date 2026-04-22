"use client";

// ── Claim chip shape (Phase A1.4a) ──
//
// A statement backed by evidence status. Compact card — the value is
// the claim's text (quoted) plus its epistemic status (proposed /
// supported / contested / refuted) and confidence %. Source entity
// rendered as a subtle "— from: X" footer when present.
//
// Click → opens source entity lab if known, otherwise no-op.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { BookOpen, CheckCircle2, AlertCircle, HelpCircle, XCircle } from "lucide-react";
import type { ClaimChipShape } from "./types";
import { GroundingBadge } from "@/components/ui/grounding-badge";

type ClaimType = ClaimChipShape["props"]["claimType"];
type ClaimStatus = ClaimChipShape["props"]["status"];

const STATUS_META: Record<
  ClaimStatus,
  {
    label: string;
    color: string;
    bg: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  }
> = {
  proposed: { label: "Proposed", color: "#64748b", bg: "#f1f5f9", icon: HelpCircle },
  supported: { label: "Supported", color: "#16a34a", bg: "#dcfce7", icon: CheckCircle2 },
  contested: { label: "Contested", color: "#d97706", bg: "#fef3c7", icon: AlertCircle },
  refuted: { label: "Refuted", color: "#dc2626", bg: "#fee2e2", icon: XCircle },
};

const TYPE_LABEL: Record<ClaimType, string> = {
  mechanism: "Mechanism",
  assertion: "Assertion",
  prediction: "Prediction",
  assumption: "Assumption",
  finding: "Finding",
};

const VALID_TYPES: readonly ClaimType[] = [
  "mechanism",
  "assertion",
  "prediction",
  "assumption",
  "finding",
] as const;
const VALID_STATUSES: readonly ClaimStatus[] = [
  "proposed",
  "supported",
  "contested",
  "refuted",
] as const;

export class ClaimChipShapeUtil extends BaseBoxShapeUtil<ClaimChipShape> {
  static override type = "claim-chip" as const;
  static override props: RecordProps<ClaimChipShape> = {
    w: T.number,
    h: T.number,
    claimId: T.string,
    spaceId: T.string,
    claimText: T.string,
    claimType: T.literalEnum(...VALID_TYPES),
    status: T.literalEnum(...VALID_STATUSES),
    confidence: T.number,
    sourceEntityId: T.string.nullable(),
    sourceEntityName: T.string.nullable(),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: ClaimChipShape, info: TLResizeInfo<ClaimChipShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): ClaimChipShape["props"] {
    return {
      w: 240,
      h: 128,
      claimId: "",
      spaceId: "",
      claimText: "Untitled claim",
      claimType: "assertion",
      status: "proposed",
      confidence: 0.5,
      sourceEntityId: null,
      sourceEntityName: null,
    };
  }

  component(shape: ClaimChipShape) {
    return <ClaimChipShapeView shape={shape} />;
  }

  indicator(shape: ClaimChipShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />;
  }
}

function ClaimChipShapeView({ shape }: { shape: ClaimChipShape }) {
  const {
    spaceId,
    claimText,
    claimType,
    status,
    confidence,
    sourceEntityId,
    sourceEntityName,
  } = shape.props;

  const statusMeta = STATUS_META[status];
  const StatusIcon = statusMeta.icon;
  const confPct = Math.round(confidence * 100);
  const navHref =
    spaceId && sourceEntityId
      ? `/app/space/${spaceId}/entity/${sourceEntityId}/lab`
      : "";

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
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(12px)",
          border: `1px solid ${statusMeta.color}33`,
          boxShadow: `0 6px 18px -6px ${statusMeta.color}22, 0 2px 6px rgba(8, 60, 180, 0.05)`,
          padding: "10px 12px",
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
            background: statusMeta.color,
          }}
        />

        {/* Header: type chip + status chip + confidence */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 6px",
              borderRadius: 3,
              background: "#f1f5f9",
              color: "#475569",
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            <BookOpen style={{ width: 8, height: 8 }} />
            {TYPE_LABEL[claimType]}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 6px",
              borderRadius: 3,
              background: statusMeta.bg,
              color: statusMeta.color,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            <StatusIcon style={{ width: 8, height: 8 }} />
            {statusMeta.label}
          </span>
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11,
              fontWeight: 700,
              color: statusMeta.color,
              fontVariantNumeric: "tabular-nums",
            }}
            title={`LLM self-assessed confidence ${confPct}% — not calibrated against outcomes. Represents the model's hedge about this claim.`}
          >
            {confPct}%
            <GroundingBadge tier="narrative" compact />
          </span>
        </div>

        {/* Quoted claim */}
        <div
          style={{
            fontSize: 11.5,
            lineHeight: 1.45,
            color: "#0a1020",
            fontStyle: "italic",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            flex: 1,
          }}
          title={claimText}
        >
          &ldquo;{claimText}&rdquo;
        </div>

        {/* Source footer */}
        {sourceEntityName && (
          <div
            style={{
              fontSize: 9.5,
              color: "#64748b",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: "0.04em",
              display: "flex",
              alignItems: "center",
              gap: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: "#94a3b8" }}>— from:</span>
            <span style={{ color: statusMeta.color, fontWeight: 600 }}>
              {sourceEntityName}
            </span>
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}
