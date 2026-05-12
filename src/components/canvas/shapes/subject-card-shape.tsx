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

import { useMemo } from "react";
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
import {
  STARTER_MODULATORS,
  getModulatorSpec,
  type ModulatorSpec,
} from "@/lib/subjects/modulators";

// ── Condition chip helpers ───────────────────────────────────────
//
// Subject conditions are a key→number bag (e.g. {"sleep_h": 4}). The
// modulator catalog (STARTER_MODULATORS) carries display label, units,
// range, and default value per key. We:
//   1. Resolve each (key, value) to its ModulatorSpec for label + units
//   2. Compute a normalized deviation from default → drives color tone
//   3. Sort by |deviation| descending so the most distinctive
//      conditions render first (the chips that actually tell the user
//      "this subject is unusual on these dimensions")
//   4. Cap at 3 visible chips + "+N more" overflow indicator

interface ConditionRender {
  key: string;
  spec: ModulatorSpec | null;
  value: number;
  /** Normalized deviation from default in [-1, 1]. Null when spec
   *  unknown (we still render the chip but as neutral). */
  deviation: number | null;
  /** Pre-formatted display value (e.g. "4h", "8/10", "200mg"). */
  display: string;
}

function formatConditionValue(value: number, spec: ModulatorSpec | null): string {
  if (!spec) return String(value);
  // Stress is canonically rendered as "8/10" not "8 0–10".
  if (spec.units === "0–10") return `${value}/10`;
  // Round half-step values cleanly (sleep_h 7.5 → "7.5h" not "7.5h").
  const rounded = Number.isInteger(value)
    ? value
    : Math.round(value * 10) / 10;
  return `${rounded}${spec.units}`;
}

function deviationFromDefault(value: number, spec: ModulatorSpec | null): number | null {
  if (!spec) return null;
  const range = spec.range[1] - spec.range[0];
  if (range <= 0) return 0;
  const dev = (value - spec.default) / range;
  return Math.max(-1, Math.min(1, dev));
}

/** Tone palette for the chip — three buckets keyed off normalized deviation:
 *    |dev| < 0.10 → neutral (slate)
 *    dev > 0      → above default (amber)
 *    dev < 0      → below default (sky)
 *  Unknown spec → neutral. */
function chipTone(deviation: number | null): {
  bg: string;
  border: string;
  fg: string;
  labelFg: string;
} {
  if (deviation === null || Math.abs(deviation) < 0.1) {
    return {
      bg: "#F1F5F9",        // slate-100
      border: "#E2E8F0",    // slate-200
      fg: "#0F172A",        // slate-900
      labelFg: "#64748B",   // slate-500
    };
  }
  if (deviation > 0) {
    return {
      bg: "#FFFBEB",        // amber-50
      border: "#FDE68A",    // amber-200
      fg: "#92400E",        // amber-800
      labelFg: "#B45309",   // amber-700
    };
  }
  return {
    bg: "#EFF6FF",          // blue-50
    border: "#BFDBFE",      // blue-200
    fg: "#1E40AF",          // blue-800
    labelFg: "#2563EB",     // blue-600
  };
}

function buildConditionRenders(
  conditions: Record<string, number>,
): ConditionRender[] {
  const out: ConditionRender[] = [];
  for (const [key, raw] of Object.entries(conditions)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const spec = getModulatorSpec(key, STARTER_MODULATORS) ?? null;
    out.push({
      key,
      spec,
      value: raw,
      deviation: deviationFromDefault(raw, spec),
      display: formatConditionValue(raw, spec),
    });
  }
  // Sort by |deviation| desc; unknown (deviation === null) sorts last.
  out.sort((a, b) => {
    const da = a.deviation === null ? -Infinity : Math.abs(a.deviation);
    const db = b.deviation === null ? -Infinity : Math.abs(b.deviation);
    return db - da;
  });
  return out;
}

function safeParseConditions(raw: string): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

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

export const VALID_FOCUS_KINDS = [
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
export type FocusKind = (typeof VALID_FOCUS_KINDS)[number];

export const VALID_ARTIFACT_STATES = [
  "bare_topic",
  "partial_artifact",
  "complete_artifact",
] as const;
export type ArtifactState = (typeof VALID_ARTIFACT_STATES)[number];

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
    conditionsJson: T.string,
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
      conditionsJson: "{}",
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
    conditionsJson,
    artifactState,
    needsReview,
  } = shape.props;

  // Parse conditions JSONB → render up to 3 chips sorted by |deviation
  // from default| desc. Empty / parse-fail / no-modulator-spec rows fall
  // back to the legacy "N conditions" summary pill so the card still
  // surfaces SOMETHING when it doesn't have rich condition data (yet).
  const conditionRenders = useMemo(
    () => buildConditionRenders(safeParseConditions(conditionsJson ?? "{}")),
    [conditionsJson],
  );
  const VISIBLE_CHIP_CAP = 3;
  const visibleChips = conditionRenders.slice(0, VISIBLE_CHIP_CAP);
  const overflowChipCount = Math.max(
    0,
    conditionRenders.length - visibleChips.length,
  );
  const hasRichChips = visibleChips.length > 0;

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
          {/* Condition chips — value pills sorted by deviation from
              default. Each chip shows the modulator's display label
              (e.g. "Sleep") next to the user's set value (e.g. "4h"),
              tinted by direction:
                · slate = within ±10% of default (neutral)
                · amber = above default
                · sky   = below default
              Capped at 3 visible + a "+N" overflow chip. Falls back
              to the legacy "N conditions" pill when no rich chips are
              parseable (legacy data, post-creation lag, all-unknown
              modulator keys). */}
          {hasRichChips ? (
            <>
              {visibleChips.map((c) => {
                const tone = chipTone(c.deviation);
                return (
                  <span
                    key={c.key}
                    title={
                      c.spec
                        ? `${c.spec.label}: ${c.value}${c.spec.units} (default ${c.spec.default}${c.spec.units}) — ${c.spec.description}`
                        : `${c.key}: ${c.value}`
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "3px 8px",
                      borderRadius: 999,
                      background: tone.bg,
                      border: `1px solid ${tone.border}`,
                      color: tone.fg,
                      fontSize: 10.5,
                      fontWeight: 500,
                      lineHeight: 1.2,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      style={{
                        color: tone.labelFg,
                        fontWeight: 500,
                      }}
                    >
                      {c.spec?.label ?? c.key}
                    </span>
                    <span style={{ fontWeight: 600 }}>{c.display}</span>
                  </span>
                );
              })}
              {overflowChipCount > 0 && (
                <span
                  title={`${overflowChipCount} more condition${
                    overflowChipCount === 1 ? "" : "s"
                  } configured`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "3px 7px",
                    borderRadius: 999,
                    background: "#F8FAFC",
                    border: "1px solid #E2E8F0",
                    color: "#64748B",
                    fontSize: 10.5,
                    fontWeight: 600,
                    lineHeight: 1.2,
                  }}
                >
                  +{overflowChipCount}
                </span>
              )}
            </>
          ) : (
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
          )}
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
