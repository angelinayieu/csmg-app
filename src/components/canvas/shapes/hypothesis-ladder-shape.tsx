"use client";

// ── Hypothesis Ladder shape ─────────────────────────────────────────
//
// First-class canvas representation of a row in the `hypothesis_ladders`
// table (migration 20260707). Renders the strategy's implicit falsifiable
// claims as 4-rung structured cards:
//
//   ① CLAIM       — the implicit hypothesis the strategy rests on
//   ② MECHANISM   — the causal chain (entity walk) the claim relies on
//   ③ FALSIFIER   — observable that would refute the claim
//   ④ VERDICT     — current state: pending | supported | refuted | contested
//
// Anchored inside the proposal room of the operational cascade (alongside
// the strategy hero) so users can audit the rigor scaffolding of any
// approved twin without digging into the strategy JSONB.
//
// Why this matters: variable_proposals captured METRICS the strategy
// proposes, but did not capture the FALSIFIABLE CLAIMS the strategy
// rests on. This shape closes that gap — it surfaces the LLM's
// pre_mortem entries in a structure that makes "what would have to be
// true for this strategy to work?" + "what would refute it?" visible.

import { useMemo } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Target, GitBranch, AlertTriangle, CheckCircle2, Clock, XCircle, HelpCircle } from "lucide-react";
import type { HypothesisLadderShape } from "./types";
import type { MechanismChainStep } from "@/types/hypothesis-ladders";

export const HYPOTHESIS_LADDER_DEFAULT_W = 320;
export const HYPOTHESIS_LADDER_DEFAULT_H = 360;

// Per-category accent. The pre_mortem category controls the card's left
// accent rail so users can scan a row of ladder cards by category type
// (internal failures vs interaction failures vs timing etc). Null
// category falls back to neutral slate (manual-authored ladders or LLM
// rows without a category tag).
const CATEGORY_VISUALS: Record<
  NonNullable<HypothesisLadderShape["props"]["category"]>,
  { accent: string; bg: string; label: string }
> = {
  internal: {
    accent: "#7C3AED", // violet — failures rooted in our own state
    bg: "rgba(124,58,237,0.05)",
    label: "Internal",
  },
  structural: {
    accent: "#0891B2", // cyan — failures from system structure
    bg: "rgba(8,145,178,0.05)",
    label: "Structural",
  },
  competitive: {
    accent: "#DC2626", // red — failures from external actors
    bg: "rgba(220,38,38,0.05)",
    label: "Competitive",
  },
  timing: {
    accent: "#D97706", // amber — failures from sequencing/horizon
    bg: "rgba(217,119,6,0.05)",
    label: "Timing",
  },
  interaction: {
    accent: "#EC4899", // pink — compound failures from 2+ causes
    bg: "rgba(236,72,153,0.05)",
    label: "Interaction",
  },
};

const NEUTRAL_VISUAL = {
  accent: "#64748B",
  bg: "rgba(100,116,139,0.04)",
  label: "Manual",
};

const VERDICT_VISUAL: Record<
  HypothesisLadderShape["props"]["verdict"],
  {
    color: string;
    bg: string;
    label: string;
    Icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  }
> = {
  pending: {
    color: "#F59E0B",
    bg: "rgba(245,158,11,0.10)",
    label: "Pending",
    Icon: Clock,
  },
  supported: {
    color: "#10B981",
    bg: "rgba(16,185,129,0.10)",
    label: "Supported",
    Icon: CheckCircle2,
  },
  refuted: {
    color: "#DC2626",
    bg: "rgba(220,38,38,0.10)",
    label: "Refuted",
    Icon: XCircle,
  },
  contested: {
    color: "#7C3AED",
    bg: "rgba(124,58,237,0.10)",
    label: "Contested",
    Icon: HelpCircle,
  },
};

const SEVERITY_LABEL: Record<
  NonNullable<HypothesisLadderShape["props"]["severity"]>,
  string
> = {
  catastrophic: "catastrophic",
  major: "major",
  moderate: "moderate",
};

function safeParseChain(json: string): MechanismChainStep[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is MechanismChainStep =>
        s &&
        typeof s === "object" &&
        typeof (s as { entity_id?: unknown }).entity_id === "string" &&
        typeof (s as { entity_name?: unknown }).entity_name === "string",
    );
  } catch {
    return [];
  }
}

export class HypothesisLadderShapeUtil extends BaseBoxShapeUtil<HypothesisLadderShape> {
  static override type = "hypothesis-ladder" as const;
  static override props: RecordProps<HypothesisLadderShape> = {
    w: T.number,
    h: T.number,
    ladderId: T.string,
    claim: T.string,
    mechanismChainJson: T.string,
    // tldraw T.string can't be nullable inline; T.any here for falsifier
    // and the view handles null. Same pattern mechanism-card uses for
    // its rationale/cyclePattern fields.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    falsifier: T.any as any,
    verdict: T.literalEnum(
      "pending",
      "supported",
      "refuted",
      "contested",
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    category: T.any as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    severity: T.any as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    probability: T.any as any,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: HypothesisLadderShape,
    info: TLResizeInfo<HypothesisLadderShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): HypothesisLadderShape["props"] {
    return {
      w: HYPOTHESIS_LADDER_DEFAULT_W,
      h: HYPOTHESIS_LADDER_DEFAULT_H,
      ladderId: "",
      claim: "",
      mechanismChainJson: "[]",
      falsifier: null,
      verdict: "pending",
      category: null,
      severity: null,
      probability: null,
    };
  }

  component(shape: HypothesisLadderShape) {
    return <HypothesisLadderView shape={shape} />;
  }

  indicator(shape: HypothesisLadderShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

function HypothesisLadderView({ shape }: { shape: HypothesisLadderShape }) {
  const {
    w,
    h,
    claim,
    mechanismChainJson,
    falsifier,
    verdict,
    category,
    severity,
    probability,
  } = shape.props;

  const visual =
    category && category in CATEGORY_VISUALS
      ? CATEGORY_VISUALS[category as keyof typeof CATEGORY_VISUALS]
      : NEUTRAL_VISUAL;
  const v = VERDICT_VISUAL[verdict];
  const VIcon = v.Icon;

  const chain = useMemo(() => safeParseChain(mechanismChainJson), [
    mechanismChainJson,
  ]);

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
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
          border: `1px solid ${visual.accent}33`,
          boxShadow: `0 12px 28px -10px ${visual.accent}22, 0 4px 10px rgba(8, 60, 180, 0.05)`,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          color: "#0a1020",
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
            background: visual.accent,
          }}
        />

        {/* Header — category + verdict pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
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
              background: visual.bg,
              color: visual.accent,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
            title={`Pre-mortem category: ${visual.label}`}
          >
            <Target style={{ width: 9, height: 9 }} />
            Hypothesis · {visual.label}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 4,
              background: v.bg,
              color: v.color,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              border: `1px solid ${v.color}33`,
            }}
            title={`Verdict: ${v.label}`}
          >
            <VIcon style={{ width: 10, height: 10 }} />
            {v.label}
          </span>
        </div>

        {/* ① CLAIM */}
        <Rung
          ordinal="①"
          label="Claim"
          accent={visual.accent}
        >
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.35,
              fontWeight: 500,
              color: "#0a1020",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
            title={claim}
          >
            {claim || (
              <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
                (no claim)
              </span>
            )}
          </div>
        </Rung>

        {/* ② MECHANISM CHAIN */}
        <Rung
          ordinal="②"
          label="Mechanism"
          accent={visual.accent}
          icon={<GitBranch style={{ width: 10, height: 10 }} />}
        >
          {chain.length > 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 4,
                fontSize: 11,
                lineHeight: 1.3,
              }}
            >
              {chain.slice(0, 5).map((step, i) => (
                <span key={`${step.entity_id}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span
                    style={{
                      padding: "2px 7px",
                      borderRadius: 4,
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      color: "#0f172a",
                      fontWeight: 500,
                      fontSize: 10.5,
                      whiteSpace: "nowrap",
                      maxWidth: 100,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={`${step.entity_id}: ${step.entity_name}${step.role ? ` · ${step.role}` : ""}`}
                  >
                    {step.entity_name}
                  </span>
                  {i < Math.min(chain.length, 5) - 1 && (
                    <span style={{ color: visual.accent, fontWeight: 600 }}>→</span>
                  )}
                </span>
              ))}
              {chain.length > 5 && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#64748b",
                    fontStyle: "italic",
                  }}
                >
                  +{chain.length - 5} more
                </span>
              )}
            </div>
          ) : (
            <span style={{ color: "#94a3b8", fontSize: 11, fontStyle: "italic" }}>
              (no mechanism chain identified)
            </span>
          )}
        </Rung>

        {/* ③ FALSIFIER */}
        <Rung
          ordinal="③"
          label="Falsifier"
          accent={visual.accent}
          icon={<AlertTriangle style={{ width: 10, height: 10 }} />}
        >
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.35,
              color: falsifier ? "#475569" : "#94a3b8",
              fontStyle: falsifier ? "normal" : "italic",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
            title={falsifier ?? "no falsifier specified"}
          >
            {falsifier ?? "(no observable falsifier specified)"}
          </div>
        </Rung>

        {/* Footer — severity + probability chips (when present) */}
        {(severity || probability) && (
          <div
            style={{
              marginTop: "auto",
              display: "flex",
              gap: 6,
              paddingLeft: 4,
            }}
          >
            {severity && (
              <span
                style={{
                  fontSize: 9.5,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "#f1f5f9",
                  color: "#475569",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
                title={`Severity if claim is wrong: ${severity}`}
              >
                {SEVERITY_LABEL[severity as keyof typeof SEVERITY_LABEL]}
              </span>
            )}
            {probability && (
              <span
                style={{
                  fontSize: 9.5,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "#f1f5f9",
                  color: "#475569",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
                title={`Probability of failure mode: ${probability}`}
              >
                p={probability}
              </span>
            )}
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

function Rung({
  ordinal,
  label,
  accent,
  icon,
  children,
}: {
  ordinal: string;
  label: string;
  accent: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ paddingLeft: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 3,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: accent,
        }}
      >
        <span style={{ fontSize: 11, lineHeight: 1 }}>{ordinal}</span>
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}
