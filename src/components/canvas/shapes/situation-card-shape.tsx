"use client";

// ── Situation card ──
//
// The user's CURRENT-state baseline rendered as a top-of-flow canvas
// surface. Five labeled sections (Inputs / Process / Outputs / Knowns
// / Unknowns) plus an uncertainty pill in the header. Sits below the
// origin-prompt + asset row, ABOVE the probability-space-shells, so
// the canvas reads as:
//
//   prompt + assets → CURRENT STATE (this card) → axis lenses → synthesis → proposals
//
// Spawned by pipeline-event-painter on `situation_analyzed` events.
// Counts come from the event payload; the FULL baseline (with names,
// values, units, gap math, knowns/unknowns text) lives on
// spaces.situation_baseline. A click on the card opens a sidecar
// drawer that reads the full baseline (future addition; today the
// click is a no-op).
//
// Skipped variants (e.g., vague intake) render as a quieted-down
// "no baseline — input was an idea" state instead of being absent
// entirely; that way the user always sees the layer exists and
// understands why the system didn't analyze further.

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
  ArrowRight,
  ArrowDown,
  CircleDot,
  HelpCircle,
  ListChecks,
  Workflow,
  Target,
} from "lucide-react";
import type { SituationCardShape } from "./types";

export const SITUATION_CARD_DEFAULT_W = 560;
export const SITUATION_CARD_DEFAULT_H = 240;

interface SectionMeta {
  key: "inputs" | "process" | "outputs" | "knowns" | "unknowns";
  label: string;
  Icon: typeof Activity;
  countKey:
    | "inputsCount"
    | "processStepsCount"
    | "outputsCurrentCount"
    | "knownsCount"
    | "unknownsCount";
  /** Outputs section uses a special compound count (current + target). */
  compound?: boolean;
}

const SECTIONS: SectionMeta[] = [
  { key: "inputs", label: "Inputs", Icon: ListChecks, countKey: "inputsCount" },
  { key: "process", label: "Process", Icon: Workflow, countKey: "processStepsCount" },
  { key: "outputs", label: "Outputs", Icon: Target, countKey: "outputsCurrentCount", compound: true },
  { key: "knowns", label: "Knowns", Icon: CircleDot, countKey: "knownsCount" },
  { key: "unknowns", label: "Unknowns", Icon: HelpCircle, countKey: "unknownsCount" },
];

export class SituationCardShapeUtil extends BaseBoxShapeUtil<SituationCardShape> {
  static override type = "situation-card" as const;
  static override props: RecordProps<SituationCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    uncertaintyScore: T.number,
    inputsCount: T.number,
    processStepsCount: T.number,
    outputsCurrentCount: T.number,
    outputsTargetCount: T.number,
    knownsCount: T.number,
    unknownsCount: T.number,
    assetCount: T.number,
    skippedReason: T.string,
    accent: T.string,
    version: T.number,
  };

  override getDefaultProps(): SituationCardShape["props"] {
    return {
      w: SITUATION_CARD_DEFAULT_W,
      h: SITUATION_CARD_DEFAULT_H,
      spaceId: "",
      uncertaintyScore: 0.5,
      inputsCount: 0,
      processStepsCount: 0,
      outputsCurrentCount: 0,
      outputsTargetCount: 0,
      knownsCount: 0,
      unknownsCount: 0,
      assetCount: 0,
      skippedReason: "",
      accent: "#0891B2",
      version: 0,
    };
  }

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: SituationCardShape,
    info: TLResizeInfo<SituationCardShape>,
  ) => resizeBox(shape, info);

  override component(shape: SituationCardShape) {
    const {
      w,
      h,
      uncertaintyScore,
      inputsCount,
      processStepsCount,
      outputsCurrentCount,
      outputsTargetCount,
      knownsCount,
      unknownsCount,
      assetCount,
      skippedReason,
      accent,
    } = shape.props;

    const skipped = skippedReason !== "";
    const counts = {
      inputsCount,
      processStepsCount,
      outputsCurrentCount,
      knownsCount,
      unknownsCount,
    };

    const HEADER_H = 52;
    const sectionW = (w - 20 - 4 * 8) / 5;
    const sectionH = h - HEADER_H - 20;

    return (
      <HTMLContainer
        style={{
          width: w,
          height: h,
          pointerEvents: "all",
        }}
      >
        <div
          className="situation-card-enter"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            // Bubble up to the whiteboard page via a window CustomEvent
            // — the page mounts in a different React tree (tldraw owns
            // the canvas tree) so we can't pass a callback prop in.
            // The page's useEffect listens for "interaxis:open-situation".
            e.stopPropagation();
            try {
              window.dispatchEvent(
                new CustomEvent("interaxis:open-situation", {
                  detail: { spaceId: shape.props.spaceId },
                }),
              );
            } catch {
              /* ignore — drawer can still be opened via chrome button */
            }
          }}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 14,
            overflow: "hidden",
            background: skipped
              ? "rgba(248,250,252,0.95)"
              : "rgba(255,255,255,0.97)",
            backdropFilter: "blur(14px) saturate(1.3)",
            WebkitBackdropFilter: "blur(14px) saturate(1.3)",
            border: `1px solid color-mix(in srgb, ${accent} ${skipped ? 12 : 22}%, rgba(15,23,42,0.06))`,
            boxShadow: skipped
              ? "0 1px 2px rgba(15,23,42,0.03)"
              : `0 1px 2px rgba(15,23,42,0.04), 0 12px 30px -16px color-mix(in srgb, ${accent} 35%, transparent)`,
            opacity: skipped ? 0.7 : 1,
            display: "flex",
            flexDirection: "column",
            padding: 10,
            gap: 8,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            color: "#0f172a",
          }}
        >
          {/* ── Header row ─────────────────────────────────────── */}
          <div
            style={{
              height: HEADER_H,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 4px",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Activity size={15} color={accent} strokeWidth={2.2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 8.5,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  color: accent,
                  textTransform: "uppercase",
                }}
              >
                current state
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#0f172a",
                  lineHeight: 1.2,
                }}
              >
                {skipped ? skipReasonHeadline(skippedReason) : "Baseline twin"}
              </div>
            </div>
            {!skipped && (
              <UncertaintyPill score={uncertaintyScore} />
            )}
            {assetCount > 0 && (
              <span
                title={`${assetCount} asset${assetCount === 1 ? "" : "s"} contributed to this baseline`}
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  padding: "3px 7px",
                  borderRadius: 6,
                  background: "rgba(15,23,42,0.05)",
                  color: "rgba(15,23,42,0.6)",
                }}
              >
                {assetCount} asset{assetCount === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {/* ── Five-section body ─────────────────────────────── */}
          {skipped ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                color: "rgba(15,23,42,0.5)",
                fontStyle: "italic",
                textAlign: "center",
                padding: "0 24px",
                lineHeight: 1.5,
              }}
            >
              {skipReasonExplanation(skippedReason)}
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 8,
                minHeight: 0,
              }}
            >
              {SECTIONS.map((section) => (
                <SituationSection
                  key={section.key}
                  meta={section}
                  count={counts[section.countKey]}
                  outputsTargetCount={outputsTargetCount}
                  accent={accent}
                />
              ))}
            </div>
          )}

          {/* Footer micro-arrow hinting this card feeds downstream */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "rgba(15,23,42,0.35)",
              opacity: 0.7,
            }}
          >
            informs landscapes
            <ArrowDown size={9} strokeWidth={2.2} />
          </div>
        </div>
        <style jsx>{`
          .situation-card-enter {
            animation: situation-card-fade-in 600ms
              cubic-bezier(0.25, 0.8, 0.25, 1) both;
          }
          @keyframes situation-card-fade-in {
            from {
              opacity: 0;
              transform: translateY(8px) scale(0.985);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
        `}</style>
      </HTMLContainer>
    );
  }

  override indicator(shape: SituationCardShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />
    );
  }
}

function SituationSection({
  meta,
  count,
  outputsTargetCount,
  accent,
}: {
  meta: SectionMeta;
  count: number;
  outputsTargetCount: number;
  accent: string;
}) {
  const Icon = meta.Icon;
  const showCompound = meta.compound;
  const empty = count === 0 && (!showCompound || outputsTargetCount === 0);

  return (
    <div
      style={{
        borderRadius: 10,
        background: empty
          ? "rgba(15,23,42,0.02)"
          : "rgba(15,23,42,0.035)",
        border: empty
          ? "1px dashed rgba(15,23,42,0.08)"
          : "1px solid rgba(15,23,42,0.06)",
        padding: "8px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          color: "rgba(15,23,42,0.55)",
        }}
      >
        <Icon size={11} strokeWidth={2.2} />
        <span
          style={{
            fontSize: 8,
            fontWeight: 800,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {meta.label}
        </span>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
        {empty ? (
          <span
            style={{
              fontSize: 10,
              color: "rgba(15,23,42,0.4)",
              fontStyle: "italic",
            }}
          >
            none yet
          </span>
        ) : showCompound ? (
          <CompoundCounter
            current={count}
            target={outputsTargetCount}
            accent={accent}
          />
        ) : (
          <span
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: accent,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.02em",
            }}
          >
            {count}
          </span>
        )}
      </div>
    </div>
  );
}

function CompoundCounter({
  current,
  target,
  accent,
}: {
  current: number;
  target: number;
  accent: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 4,
        flexWrap: "wrap",
      }}
    >
      <span
        title={`${current} current metric${current === 1 ? "" : "s"}`}
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: accent,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {current}
      </span>
      <ArrowRight size={9} color="rgba(15,23,42,0.35)" strokeWidth={2.2} />
      <span
        title={`${target} target metric${target === 1 ? "" : "s"}`}
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: target > 0 ? accent : "rgba(15,23,42,0.3)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontVariantNumeric: "tabular-nums",
          opacity: target > 0 ? 1 : 0.5,
        }}
      >
        {target}
      </span>
    </div>
  );
}

function UncertaintyPill({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(1, score));
  const color =
    clamped < 0.3
      ? "#059669" // emerald — low uncertainty
      : clamped < 0.6
        ? "#D97706" // amber — mid
        : "#dc2626"; // red — high
  const label =
    clamped < 0.3 ? "low" : clamped < 0.6 ? "mid" : "high";
  return (
    <div
      title={`Uncertainty: ${(clamped * 100).toFixed(0)}%`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 7px",
        borderRadius: 6,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
        color,
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: color,
        }}
      />
      uncertainty · {label}
    </div>
  );
}

function skipReasonHeadline(reason: string): string {
  switch (reason) {
    case "twin_mode_structural":
      return "Idea-only intake — no baseline yet";
    case "no_assets_no_richness":
      return "Insufficient detail for baseline";
    case "no_input_no_assets":
      return "Nothing to analyze yet";
    case "analyzer_failed":
      return "Baseline analysis failed";
    default:
      return "Baseline skipped";
  }
}

function skipReasonExplanation(reason: string): string {
  switch (reason) {
    case "twin_mode_structural":
      return "Your prompt described a goal but didn't specify current inputs / process / outputs to model. The pipeline will go directly to landscape generation. Upload a spec sheet, dataset, or prior analysis to build a baseline.";
    case "no_assets_no_richness":
      return "Not enough structured detail in the prompt and no assets attached. The pipeline will continue to landscape generation; come back and upload assets to enable baseline analysis.";
    case "no_input_no_assets":
      return "This space has no intake text and no uploaded assets — the analyzer has nothing to read. Add a prompt or upload a file via the canvas Library, then re-run from the situation drawer.";
    case "analyzer_failed":
      return "The baseline analyzer encountered an error. Landscape generation will still proceed normally — re-run the analyzer from the situation drawer to retry.";
    default:
      return "Baseline analysis was skipped for this run.";
  }
}
