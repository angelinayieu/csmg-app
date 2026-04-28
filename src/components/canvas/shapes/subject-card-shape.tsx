"use client";

// ── Subject card shape (Phase 4) ─────────────────────────────────
//
// First-class whiteboard primitive for the Subject sandbox primitive.
// A draggable card representing a Subject row from the database.
//
// Created via:
//   • +Subject manual-authoring button on the canvas chrome
//   • Lab proposal wizard accepting an AI-proposed subject
//
// CTAs:
//   • Click body → expand inline detail (future)
//   • "Open Lab" footer button → /app/space/[spaceId]/lab?subjectId=X
//
// Visual treatment:
//   • Left accent rail color-keyed to focus_kind
//   • focus_kind icon at top-left
//   • Compact name + focus_label
//   • Scope summary line (when present)
//   • Conditions count + artifact state chips at the bottom
//   • "Open Lab" CTA bottom-right
//
// Storage: all display fields live in tldraw props (validated via T
// schema). The persistent Subject row is the source of truth; this
// shape is a frozen snapshot rendered on canvas. Mutations (rename,
// edit conditions) round-trip through the API and re-paint the card.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import {
  User,
  FileText,
  Package,
  BookOpen,
  Globe,
  Network,
  Database,
  Atom,
  CircleDot,
  Layers,
  ArrowUpRight,
  Sliders,
} from "lucide-react";
import type { SubjectCardShape } from "./types";

// ── focus_kind → visual mapping ──────────────────────────────────

const FOCUS_META: Record<
  string,
  {
    label: string;
    color: string;
    bg: string;
    icon: React.ComponentType<{ style?: React.CSSProperties; className?: string }>;
  }
> = {
  person: { label: "Person", color: "#0891B2", bg: "#ECFEFF", icon: User },
  document: { label: "Document", color: "#7C3AED", bg: "#F5F3FF", icon: FileText },
  product: { label: "Product", color: "#D97706", bg: "#FEF3C7", icon: Package },
  topic: { label: "Topic", color: "#16A34A", bg: "#DCFCE7", icon: BookOpen },
  environment: { label: "Environment", color: "#2563EB", bg: "#EFF6FF", icon: Globe },
  system: { label: "System", color: "#475569", bg: "#F1F5F9", icon: Network },
  data: { label: "Data", color: "#DC2626", bg: "#FEE2E2", icon: Database },
  reaction: { label: "Reaction", color: "#7C3AED", bg: "#F5F3FF", icon: Atom },
  other: { label: "Other", color: "#64748B", bg: "#F1F5F9", icon: CircleDot },
};

const ARTIFACT_STATE_LABEL: Record<string, string> = {
  bare_topic: "Bare topic",
  partial_artifact: "Partial",
  complete_artifact: "Complete",
};

const VALID_FOCUS_KINDS = [
  "person",
  "document",
  "product",
  "topic",
  "environment",
  "system",
  "data",
  "reaction",
  "other",
] as const;

const VALID_ARTIFACT_STATES = [
  "bare_topic",
  "partial_artifact",
  "complete_artifact",
] as const;

function metaForFocusKind(kind: string) {
  return FOCUS_META[kind] ?? FOCUS_META.other;
}

// ── Shape util ───────────────────────────────────────────────────

export class SubjectCardShapeUtil extends BaseBoxShapeUtil<SubjectCardShape> {
  static override type = "subject-card" as const;
  static override props: RecordProps<SubjectCardShape> = {
    w: T.number,
    h: T.number,
    subjectId: T.string,
    spaceId: T.string,
    name: T.string,
    focusKind: T.literalEnum(...VALID_FOCUS_KINDS),
    focusLabel: T.string,
    scopeSummary: T.string.nullable(),
    conditionCount: T.number,
    artifactState: T.literalEnum(...VALID_ARTIFACT_STATES),
    needsReview: T.boolean,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: SubjectCardShape,
    info: TLResizeInfo<SubjectCardShape>,
  ) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): SubjectCardShape["props"] {
    return {
      w: 320,
      h: 180,
      subjectId: "",
      spaceId: "",
      name: "Untitled subject",
      focusKind: "topic",
      focusLabel: "",
      scopeSummary: null,
      conditionCount: 0,
      artifactState: "bare_topic",
      needsReview: false,
    };
  }

  component(shape: SubjectCardShape) {
    return <SubjectCardShapeView shape={shape} />;
  }

  indicator(shape: SubjectCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

// ── View ─────────────────────────────────────────────────────────

function SubjectCardShapeView({ shape }: { shape: SubjectCardShape }) {
  const {
    spaceId,
    subjectId,
    name,
    focusKind,
    focusLabel,
    scopeSummary,
    conditionCount,
    artifactState,
    needsReview,
  } = shape.props;

  const meta = metaForFocusKind(focusKind);
  const FocusIcon = meta.icon;
  const labHref =
    spaceId && subjectId
      ? `/app/space/${spaceId}/lab?subjectId=${subjectId}`
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
          borderRadius: 14,
          overflow: "hidden",
          background: "rgba(255, 255, 255, 0.97)",
          backdropFilter: "blur(14px)",
          border: needsReview
            ? `1.5px dashed ${meta.color}`
            : `1px solid ${meta.color}33`,
          boxShadow: `0 12px 28px -10px ${meta.color}22, 0 4px 10px rgba(8, 60, 180, 0.05)`,
          padding: "12px 14px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Left accent rail */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: meta.color,
          }}
        />

        {/* Header — focus kind chip + artifact state */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            paddingLeft: 4,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              borderRadius: 4,
              background: meta.bg,
              color: meta.color,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            <FocusIcon style={{ width: 9, height: 9 }} />
            {meta.label}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 6px",
              borderRadius: 4,
              background: "#f1f5f9",
              color: "#64748b",
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
            title={`Twin artifact state: ${artifactState}`}
          >
            {ARTIFACT_STATE_LABEL[artifactState] ?? artifactState}
          </span>
        </div>

        {/* Name */}
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.25,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "#0a1020",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            paddingLeft: 4,
          }}
          title={name}
        >
          {name}
        </div>

        {/* Focus label sub-line (when distinct from name) */}
        {focusLabel && focusLabel !== name && (
          <div
            style={{
              fontSize: 11,
              color: "#64748b",
              paddingLeft: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {focusLabel}
          </div>
        )}

        {/* Scope + conditions strip */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingLeft: 4,
            flexWrap: "wrap",
          }}
        >
          {scopeSummary && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                borderRadius: 999,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                color: "#475569",
                fontSize: 10.5,
                fontWeight: 500,
              }}
              title={scopeSummary}
            >
              <Layers style={{ width: 10, height: 10 }} />
              <span
                style={{
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {scopeSummary}
              </span>
            </span>
          )}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              borderRadius: 999,
              background: conditionCount > 0 ? "#ECFDF5" : "#f8fafc",
              border: `1px solid ${conditionCount > 0 ? "#A7F3D0" : "#e2e8f0"}`,
              color: conditionCount > 0 ? "#047857" : "#94a3b8",
              fontSize: 10.5,
              fontWeight: 500,
            }}
            title={`${conditionCount} condition${conditionCount === 1 ? "" : "s"} configured`}
          >
            <Sliders style={{ width: 10, height: 10 }} />
            {conditionCount} condition{conditionCount === 1 ? "" : "s"}
          </span>
        </div>

        {/* Footer CTA */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            paddingLeft: 4,
          }}
        >
          {labHref ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (e.metaKey || e.ctrlKey || e.button === 1) {
                  window.open(labHref, "_blank");
                } else {
                  window.location.href = labHref;
                }
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                borderRadius: 8,
                background: meta.color,
                color: "#ffffff",
                border: "none",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: `0 2px 6px -1px ${meta.color}66`,
              }}
            >
              Open Lab
              <ArrowUpRight style={{ width: 11, height: 11 }} />
            </button>
          ) : (
            <span
              style={{
                fontSize: 10,
                color: "#94a3b8",
                fontStyle: "italic",
              }}
            >
              (saving…)
            </span>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}
