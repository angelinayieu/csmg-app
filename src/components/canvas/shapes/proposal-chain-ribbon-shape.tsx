"use client";

// ── Proposal chain ribbon (Project-Overview design pass) ──
//
// Thin horizontal card docked directly beneath a proposal-snapshot.
// Answers the question "what's the reasoning chain behind this
// proposal?" in one glance — the design reference showed this as a
// row like `V4.2-F.R1  ·  N₁ → N₂ → N₃  ·  +0.14` where the middle
// segment names the causal chain and the right edge names the
// expected lift.
//
// The user's explicit ask: "chains are also what i want us to
// generate as we progress downstream from the forking out unraveling
// so users can continuously see connections being formed". The
// proposal-snapshot shows WHAT is proposed; this ribbon shows HOW it
// got there.
//
// Painted by pipeline-event-painter in response to proposal_ready
// events carrying the new optional `chain` field. If the emitter
// didn't populate chain (legacy events, generate-apps pre-extension),
// the painter simply skips the ribbon — the snapshot card alone is
// still valid.
//
// Not a persisted artifact. Deleted on run completion alongside the
// snapshot card and the other ghost shapes.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import type { ProposalChainRibbonShape } from "./types";

export const RIBBON_DEFAULT_W = 260;
export const RIBBON_DEFAULT_H = 52;

// Visual parity with proposal-snapshot's KIND_META so the ribbon reads
// as the same object as the card above it. Duplicated (not imported)
// to keep the shape module self-contained; the accent is already
// passed through on the event payload anyway.
const KIND_LABEL: Record<
  ProposalChainRibbonShape["props"]["kind"],
  string
> = {
  strategy: "S",
  experiment: "E",
  variant: "V",
};

export class ProposalChainRibbonShapeUtil extends BaseBoxShapeUtil<ProposalChainRibbonShape> {
  static override type = "proposal-chain-ribbon" as const;
  static override props: RecordProps<ProposalChainRibbonShape> = {
    w: T.number,
    h: T.number,
    proposalId: T.string,
    kind: T.literalEnum("strategy", "experiment", "variant"),
    shortId: T.string,
    // Chain node names in causal order (upstream → target). Keep as
    // string[] to match the event's `chain.nodeNames` shape exactly.
    // Max 5 rendered; overflow shown as "+N".
    nodeNames: T.arrayOf(T.string),
    // Signed deviation value (p50 from Monte Carlo, or null when the
    // simulation didn't resolve for this proposal).
    lift: T.number.nullable(),
    constraintLabel: T.string.nullable(),
    accent: T.string,
  };

  override getDefaultProps(): ProposalChainRibbonShape["props"] {
    return {
      w: RIBBON_DEFAULT_W,
      h: RIBBON_DEFAULT_H,
      proposalId: "",
      kind: "experiment",
      shortId: "",
      nodeNames: [],
      lift: null,
      constraintLabel: null,
      accent: "#0891B2",
    };
  }

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: ProposalChainRibbonShape,
    info: TLResizeInfo<ProposalChainRibbonShape>,
  ) => resizeBox(shape, info);

  override component(shape: ProposalChainRibbonShape) {
    const { w, h, kind, shortId, nodeNames, lift, constraintLabel, accent } =
      shape.props;
    const shown = nodeNames.slice(0, 4);
    const overflow = Math.max(0, nodeNames.length - shown.length);
    const liftFormatted = formatLift(lift);
    const liftPositive = (lift ?? 0) >= 0;
    const LiftIcon = liftPositive ? TrendingUp : TrendingDown;

    return (
      <HTMLContainer
        style={{
          width: w,
          height: h,
          pointerEvents: "all",
        }}
      >
        <div
          className="proposal-chain-enter"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 10,
            overflow: "hidden",
            background: "rgba(255,255,255,0.96)",
            backdropFilter: "blur(10px) saturate(1.3)",
            WebkitBackdropFilter: "blur(10px) saturate(1.3)",
            border: `1px solid color-mix(in srgb, ${accent} 16%, rgba(15, 23, 42, 0.06))`,
            boxShadow: `0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px -8px color-mix(in srgb, ${accent} 35%, transparent)`,
            display: "flex",
            alignItems: "stretch",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            color: "#0f172a",
          }}
        >
          {/* Left: kind badge + short id */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 1,
              padding: "0 10px",
              borderRight: "1px solid rgba(15, 23, 42, 0.06)",
              background: `color-mix(in srgb, ${accent} 8%, transparent)`,
              minWidth: 50,
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "0.14em",
                color: accent,
                textTransform: "uppercase",
              }}
            >
              {KIND_LABEL[kind]}
            </span>
            <span
              style={{
                fontSize: 9,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                color: "rgba(15, 23, 42, 0.55)",
                fontVariantNumeric: "tabular-nums",
                maxWidth: 44,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={shortId}
            >
              {shortId}
            </span>
          </div>

          {/* Middle: chain breadcrumb */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "0 10px",
              overflow: "hidden",
            }}
          >
            {shown.length === 0 ? (
              <span
                style={{
                  fontSize: 10,
                  color: "rgba(15, 23, 42, 0.45)",
                  fontStyle: "italic",
                }}
              >
                chain unresolved
              </span>
            ) : (
              shown.map((name, i) => (
                <ChainPill
                  key={`${i}-${name}`}
                  name={name}
                  isTarget={i === shown.length - 1 && overflow === 0}
                  accent={accent}
                  showArrow={i < shown.length - 1 || overflow > 0}
                />
              ))
            )}
            {overflow > 0 && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  color: "rgba(15, 23, 42, 0.5)",
                  padding: "1px 4px",
                  borderRadius: 4,
                  background: "rgba(15, 23, 42, 0.04)",
                }}
              >
                +{overflow}
              </span>
            )}
            {constraintLabel && (
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 8.5,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  padding: "1px 5px",
                  borderRadius: 4,
                  color: accent,
                  background: `color-mix(in srgb, ${accent} 10%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
                  flexShrink: 0,
                }}
                title={`Constraint: ${constraintLabel}`}
              >
                {constraintLabel}
              </span>
            )}
          </div>

          {/* Right: lift chip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "0 10px",
              borderLeft: "1px solid rgba(15, 23, 42, 0.06)",
              minWidth: 64,
              background: liftFormatted
                ? `color-mix(in srgb, ${liftPositive ? "#059669" : "#dc2626"} 9%, transparent)`
                : "rgba(15, 23, 42, 0.03)",
            }}
          >
            {liftFormatted ? (
              <>
                <LiftIcon
                  size={11}
                  strokeWidth={2.2}
                  color={liftPositive ? "#059669" : "#dc2626"}
                />
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    color: liftPositive ? "#047857" : "#b91c1c",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {liftFormatted}
                </span>
              </>
            ) : (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgba(15, 23, 42, 0.4)",
                }}
              >
                no sim
              </span>
            )}
          </div>
        </div>
        <style jsx>{`
          .proposal-chain-enter {
            animation: chain-ribbon-fade-in 520ms cubic-bezier(0.25, 0.8, 0.25, 1)
              both;
          }
          @keyframes chain-ribbon-fade-in {
            from {
              opacity: 0;
              transform: translateY(-4px) scaleX(0.96);
            }
            to {
              opacity: 1;
              transform: translateY(0) scaleX(1);
            }
          }
        `}</style>
      </HTMLContainer>
    );
  }

  override indicator(shape: ProposalChainRibbonShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />
    );
  }
}

function ChainPill({
  name,
  isTarget,
  accent,
  showArrow,
}: {
  name: string;
  isTarget: boolean;
  accent: string;
  showArrow: boolean;
}) {
  const truncated = truncate(name, 10);
  return (
    <>
      <span
        title={name}
        style={{
          fontSize: 10,
          fontWeight: isTarget ? 700 : 500,
          padding: "2px 6px",
          borderRadius: 5,
          background: isTarget
            ? `color-mix(in srgb, ${accent} 14%, transparent)`
            : "rgba(15, 23, 42, 0.04)",
          color: isTarget ? accent : "rgba(15, 23, 42, 0.75)",
          border: isTarget
            ? `1px solid color-mix(in srgb, ${accent} 30%, transparent)`
            : "1px solid rgba(15, 23, 42, 0.06)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 80,
          flexShrink: 0,
        }}
      >
        {truncated}
      </span>
      {showArrow && (
        <ArrowRight
          size={10}
          strokeWidth={2}
          color="rgba(15, 23, 42, 0.35)"
          style={{ flexShrink: 0 }}
        />
      )}
    </>
  );
}

function formatLift(lift: number | null): string | null {
  if (lift === null || !Number.isFinite(lift)) return null;
  const sign = lift >= 0 ? "+" : "";
  const abs = Math.abs(lift);
  // Compact notation — the design reference showed values like +0.14.
  // Use 2 decimals for small magnitudes, 1 for large.
  const decimals = abs >= 10 ? 1 : 2;
  return `${sign}${lift.toFixed(decimals)}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
