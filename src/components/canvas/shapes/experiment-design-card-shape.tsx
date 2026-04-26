"use client";

// ── Experiment design card (5-column hypothesis layout) ──
//
// Sits below the proposal-snapshot + chain ribbon for an
// experiment-kind proposal_ready event. Lays the proposal out in the
// language of experimental design — Independent Variables / Dependent
// Variables / Control / Process / Results — with an editable
// hypothesis row on top.
//
// Why this exists: the inventory pass surfaced that experiment data
// (IV rings, DV heatmap, process chain, results distribution) was
// scattered across five different shapes/widgets but no single
// surface named what's being tested using IV/DV/Control/Process/
// Results vocabulary. Users with experimental-design literacy
// couldn't read the canvas as "an experiment is being run." This
// card closes that gap by repackaging data the proposal_ready event
// already carries (chain.nodeNames, distribution, dowhy.identify,
// dowhy.refute) into a recognizable layout.
//
// Hypothesis text is editable via tldraw's standard canEdit flow;
// stored on the shape itself (no DB write yet). A persistent
// hypothesis would land on a new column or `apps.state.hypothesis`
// once the framing settles.

import { useCallback, useEffect, useRef } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
  stopEventPropagation,
} from "tldraw";
import { ArrowRight, FlaskConical, Sparkles, ShieldCheck, ChevronsRight, BarChart3 } from "lucide-react";
import type { ExperimentDesignCardShape } from "./types";

export const EXPERIMENT_DESIGN_DEFAULT_W = 560;
export const EXPERIMENT_DESIGN_DEFAULT_H = 240;

const COLUMN_GAP = 8;
const HEADER_HEIGHT = 60;

interface ColumnMeta {
  key: "iv" | "dv" | "control" | "process" | "results";
  label: string;
  Icon: typeof FlaskConical;
}

const COLUMNS: ColumnMeta[] = [
  { key: "iv", label: "Independent variables", Icon: FlaskConical },
  { key: "dv", label: "Dependent variables", Icon: Sparkles },
  { key: "control", label: "Control", Icon: ShieldCheck },
  { key: "process", label: "Process", Icon: ChevronsRight },
  { key: "results", label: "Results", Icon: BarChart3 },
];

export class ExperimentDesignCardShapeUtil extends BaseBoxShapeUtil<ExperimentDesignCardShape> {
  static override type = "experiment-design-card" as const;
  static override props: RecordProps<ExperimentDesignCardShape> = {
    w: T.number,
    h: T.number,
    proposalId: T.string,
    appId: T.string.nullable(),
    title: T.string,
    hypothesis: T.string,
    ivNames: T.arrayOf(T.string),
    dvName: T.string.nullable(),
    controlLabel: T.string,
    processChain: T.arrayOf(T.string),
    identifyKind: T.string,
    refuteVerdict: T.string,
    p10: T.number.nullable(),
    p50: T.number.nullable(),
    p90: T.number.nullable(),
    distributionProvenance: T.string,
    distributionSampleCount: T.number.nullable(),
    accent: T.string,
  };

  override getDefaultProps(): ExperimentDesignCardShape["props"] {
    return {
      w: EXPERIMENT_DESIGN_DEFAULT_W,
      h: EXPERIMENT_DESIGN_DEFAULT_H,
      proposalId: "",
      appId: null,
      title: "",
      hypothesis: "",
      ivNames: [],
      dvName: null,
      controlLabel: "",
      processChain: [],
      identifyKind: "",
      refuteVerdict: "",
      p10: null,
      p50: null,
      p90: null,
      distributionProvenance: "",
      distributionSampleCount: null,
      accent: "#0891B2",
    };
  }

  override canResize = () => true;
  override canEdit = () => true;

  override onResize = (
    shape: ExperimentDesignCardShape,
    info: TLResizeInfo<ExperimentDesignCardShape>,
  ) => resizeBox(shape, info);

  override component(shape: ExperimentDesignCardShape) {
    return <ExperimentDesignRenderer shape={shape} util={this} />;
  }

  override indicator(shape: ExperimentDesignCardShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />
    );
  }
}

function ExperimentDesignRenderer({
  shape,
  util,
}: {
  shape: ExperimentDesignCardShape;
  util: ExperimentDesignCardShapeUtil;
}) {
  const editor = util.editor;
  const isEditing = editor.getEditingShapeId() === shape.id;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isEditing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [isEditing]);

  const updateHypothesis = useCallback(
    (next: string) => {
      editor.updateShape<ExperimentDesignCardShape>({
        id: shape.id,
        type: "experiment-design-card",
        props: { hypothesis: next },
      });
    },
    [editor, shape.id],
  );
  const commit = useCallback(() => editor.setEditingShape(null), [editor]);

  const { w, h, accent, title, hypothesis, ivNames, dvName, controlLabel,
    processChain, identifyKind, refuteVerdict, p10, p50, p90,
    distributionProvenance, distributionSampleCount } = shape.props;

  const columnW = (w - COLUMN_GAP * (COLUMNS.length + 1)) / COLUMNS.length;
  const columnsTop = HEADER_HEIGHT + 10;
  const columnH = h - columnsTop - 10;

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
      }}
    >
      <div
        className="experiment-design-card-enter"
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 14,
          overflow: "hidden",
          background: "rgba(255,255,255,0.97)",
          backdropFilter: "blur(14px) saturate(1.3)",
          WebkitBackdropFilter: "blur(14px) saturate(1.3)",
          border: `1px solid color-mix(in srgb, ${accent} 18%, rgba(15,23,42,0.06))`,
          boxShadow: isEditing
            ? `0 0 0 2px color-mix(in srgb, ${accent} 30%, transparent), 0 8px 24px -10px color-mix(in srgb, ${accent} 40%, transparent)`
            : `0 1px 2px rgba(15,23,42,0.04), 0 8px 22px -12px color-mix(in srgb, ${accent} 35%, transparent)`,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          color: "#0f172a",
          display: "flex",
          flexDirection: "column",
          padding: 10,
          gap: 8,
        }}
      >
        {/* ── Header row — title + hypothesis input ────────────── */}
        <div
          style={{
            height: HEADER_HEIGHT,
            display: "flex",
            alignItems: "stretch",
            gap: 10,
          }}
        >
          {/* Left badge — design framing label */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              padding: "0 12px",
              borderRadius: 8,
              background: `color-mix(in srgb, ${accent} 10%, transparent)`,
              border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
              minWidth: 72,
              flexShrink: 0,
            }}
          >
            <FlaskConical size={16} color={accent} strokeWidth={2.2} />
            <span
              style={{
                fontSize: 8.5,
                fontWeight: 800,
                letterSpacing: "0.14em",
                color: accent,
                textTransform: "uppercase",
              }}
            >
              experiment
            </span>
          </div>

          {/* Title + hypothesis editable */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: "#0f172a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={title}
            >
              {title || "Untitled experiment"}
            </div>
            {isEditing ? (
              <textarea
                ref={inputRef}
                value={hypothesis}
                onChange={(e) => updateHypothesis(e.target.value)}
                onPointerDown={stopEventPropagation}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    commit();
                  }
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    commit();
                  }
                }}
                placeholder="Hypothesis: if we change [IV], then [DV] will move by [amount] because [mechanism]"
                aria-label="Experiment hypothesis"
                style={{
                  flex: 1,
                  width: "100%",
                  background: "rgba(15,23,42,0.03)",
                  border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: 1.35,
                  color: "#0f172a",
                  outline: "none",
                  resize: "none",
                  fontFamily: "inherit",
                }}
              />
            ) : (
              <button
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={(e) => {
                  e.stopPropagation();
                  editor.setEditingShape(shape.id);
                }}
                title="Click to edit hypothesis"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "flex-start",
                  textAlign: "left",
                  background: hypothesis ? "transparent" : "rgba(15,23,42,0.025)",
                  border: hypothesis
                    ? "1px solid transparent"
                    : "1px dashed rgba(15,23,42,0.18)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: 1.35,
                  color: hypothesis ? "#0f172a" : "rgba(15,23,42,0.4)",
                  fontStyle: hypothesis ? "normal" : "italic",
                  cursor: "text",
                  fontFamily: "inherit",
                  width: "100%",
                  overflow: "hidden",
                }}
              >
                {hypothesis ||
                  "Hypothesis: if we change [IV], then [DV] will move by [amount] because [mechanism] — click to write"}
              </button>
            )}
          </div>
        </div>

        {/* ── Five-column body ─────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: `repeat(${COLUMNS.length}, 1fr)`,
            gap: COLUMN_GAP,
            minHeight: columnH,
          }}
        >
          {COLUMNS.map((col) => {
            const Icon = col.Icon;
            return (
              <div
                key={col.key}
                style={{
                  borderRadius: 10,
                  background: "rgba(15,23,42,0.025)",
                  border: "1px solid rgba(15,23,42,0.05)",
                  padding: "8px 8px 8px 8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                {/* Column label */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    color: "rgba(15,23,42,0.55)",
                  }}
                >
                  <Icon size={11} strokeWidth={2.2} />
                  <span
                    style={{
                      fontSize: 8.5,
                      fontWeight: 800,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    {col.label}
                  </span>
                </div>
                {/* Column body */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {col.key === "iv" && (
                    <IvColumn names={ivNames} accent={accent} />
                  )}
                  {col.key === "dv" && (
                    <DvColumn name={dvName} accent={accent} />
                  )}
                  {col.key === "control" && (
                    <ControlColumn label={controlLabel} />
                  )}
                  {col.key === "process" && (
                    <ProcessColumn
                      chain={processChain}
                      identifyKind={identifyKind}
                      refuteVerdict={refuteVerdict}
                      accent={accent}
                    />
                  )}
                  {col.key === "results" && (
                    <ResultsColumn
                      p10={p10}
                      p50={p50}
                      p90={p90}
                      provenance={distributionProvenance}
                      sampleCount={distributionSampleCount}
                      accent={accent}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <style jsx>{`
        .experiment-design-card-enter {
          animation: edcard-fade-in 540ms cubic-bezier(0.25, 0.8, 0.25, 1) both;
        }
        @keyframes edcard-fade-in {
          from {
            opacity: 0;
            transform: translateY(6px) scale(0.985);
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

// ── Per-column components ─────────────────────────────────────

function IvColumn({ names, accent }: { names: string[]; accent: string }) {
  if (names.length === 0) {
    return <EmptyState text="no upstream lever resolved" />;
  }
  return (
    <>
      {names.slice(0, 3).map((n, i) => (
        <Pill key={`${i}-${n}`} text={n} accent={accent} variant="filled" />
      ))}
      {names.length > 3 && (
        <span
          style={{
            fontSize: 9,
            color: "rgba(15,23,42,0.5)",
            fontWeight: 600,
          }}
        >
          +{names.length - 3} more
        </span>
      )}
    </>
  );
}

function DvColumn({ name, accent }: { name: string | null; accent: string }) {
  if (!name) return <EmptyState text="no target outcome" />;
  return (
    <>
      <Pill text={name} accent={accent} variant="bold" />
      <span
        style={{
          fontSize: 9,
          color: "rgba(15,23,42,0.5)",
          fontStyle: "italic",
        }}
      >
        target outcome
      </span>
    </>
  );
}

function ControlColumn({ label }: { label: string }) {
  return (
    <>
      <Pill text="baseline" accent="#64748b" variant="filled" />
      <span
        style={{
          fontSize: 9.5,
          color: "rgba(15,23,42,0.65)",
          lineHeight: 1.3,
        }}
      >
        {label || "no-intervention world"}
      </span>
    </>
  );
}

function ProcessColumn({
  chain,
  identifyKind,
  refuteVerdict,
  accent,
}: {
  chain: string[];
  identifyKind: string;
  refuteVerdict: string;
  accent: string;
}) {
  const verdictColor =
    refuteVerdict === "pass"
      ? "#059669"
      : refuteVerdict === "fail"
        ? "#dc2626"
        : "rgba(15,23,42,0.5)";
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          flexWrap: "wrap",
        }}
      >
        {chain.length === 0 ? (
          <EmptyState text="no chain" inline />
        ) : (
          chain.slice(0, 3).map((n, i) => (
            <span key={`${i}-${n}`} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "rgba(15,23,42,0.05)",
                  color: "rgba(15,23,42,0.75)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 60,
                }}
                title={n}
              >
                {truncate(n, 10)}
              </span>
              {i < Math.min(chain.length, 3) - 1 && (
                <ArrowRight size={9} color="rgba(15,23,42,0.35)" strokeWidth={2} />
              )}
            </span>
          ))
        )}
        {chain.length > 3 && (
          <span style={{ fontSize: 8.5, color: "rgba(15,23,42,0.5)" }}>
            +{chain.length - 3}
          </span>
        )}
      </div>
      {(identifyKind || refuteVerdict) && (
        <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
          {identifyKind && (
            <span
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "1px 5px",
                borderRadius: 4,
                color: accent,
                background: `color-mix(in srgb, ${accent} 10%, transparent)`,
                border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
              }}
              title={`Identification: ${identifyKind}`}
            >
              {identifyKind}
            </span>
          )}
          {refuteVerdict && (
            <span
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "1px 5px",
                borderRadius: 4,
                color: verdictColor,
                background: `color-mix(in srgb, ${verdictColor} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${verdictColor} 22%, transparent)`,
              }}
              title={`Refute: ${refuteVerdict}`}
            >
              refute · {refuteVerdict}
            </span>
          )}
        </div>
      )}
    </>
  );
}

function ResultsColumn({
  p10,
  p50,
  p90,
  provenance,
  sampleCount,
  accent,
}: {
  p10: number | null;
  p50: number | null;
  p90: number | null;
  provenance: string;
  sampleCount: number | null;
  accent: string;
}) {
  const hasDist =
    typeof p10 === "number" &&
    typeof p50 === "number" &&
    typeof p90 === "number" &&
    Number.isFinite(p10) &&
    Number.isFinite(p50) &&
    Number.isFinite(p90);

  const provLabel =
    provenance === "mc_simulation"
      ? "MC sim"
      : provenance === "ode_rk4"
        ? "ODE RK4"
        : provenance === "bootstrap"
          ? "bootstrap"
          : provenance === "composite_computed"
            ? "composite"
            : provenance === "llm_estimate"
              ? "LLM est."
              : "no sim";
  const provStrong =
    provenance === "mc_simulation" ||
    provenance === "ode_rk4" ||
    provenance === "bootstrap";

  if (!hasDist) {
    return (
      <>
        <EmptyState text="no distribution" inline />
        <span
          style={{
            fontSize: 9,
            color: "rgba(15,23,42,0.45)",
            fontStyle: "italic",
            marginTop: 2,
          }}
        >
          {provLabel}
        </span>
      </>
    );
  }

  const liftPositive = (p50 ?? 0) >= 0;
  const liftColor = liftPositive ? "#047857" : "#b91c1c";
  return (
    <>
      <span
        style={{
          fontSize: 13,
          fontWeight: 800,
          color: liftColor,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
        }}
      >
        {formatLift(p50)}
      </span>
      <span
        style={{
          fontSize: 9.5,
          color: "rgba(15,23,42,0.6)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        p10 {formatNum(p10)} · p90 {formatNum(p90)}
      </span>
      <span
        style={{
          marginTop: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          padding: "1px 5px",
          borderRadius: 4,
          color: provStrong ? accent : "rgba(15,23,42,0.5)",
          background: provStrong
            ? `color-mix(in srgb, ${accent} 10%, transparent)`
            : "rgba(15,23,42,0.04)",
          alignSelf: "flex-start",
        }}
        title={
          sampleCount != null
            ? `${provLabel} · ${sampleCount} samples`
            : provLabel
        }
      >
        {provLabel}
        {sampleCount != null && (
          <span style={{ opacity: 0.7, fontWeight: 600 }}>
            · n={sampleCount}
          </span>
        )}
      </span>
    </>
  );
}

// ── Tiny visual primitives ────────────────────────────────────

function Pill({
  text,
  accent,
  variant,
}: {
  text: string;
  accent: string;
  variant: "filled" | "bold";
}) {
  return (
    <span
      title={text}
      style={{
        fontSize: variant === "bold" ? 10.5 : 9.5,
        fontWeight: variant === "bold" ? 700 : 600,
        padding: "2px 6px",
        borderRadius: 5,
        color: variant === "bold" ? accent : "rgba(15,23,42,0.78)",
        background:
          variant === "bold"
            ? `color-mix(in srgb, ${accent} 14%, transparent)`
            : "rgba(15,23,42,0.05)",
        border:
          variant === "bold"
            ? `1px solid color-mix(in srgb, ${accent} 28%, transparent)`
            : "1px solid rgba(15,23,42,0.06)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
        alignSelf: "flex-start",
      }}
    >
      {text}
    </span>
  );
}

function EmptyState({ text, inline = false }: { text: string; inline?: boolean }) {
  return (
    <span
      style={{
        fontSize: inline ? 9 : 9.5,
        color: "rgba(15,23,42,0.4)",
        fontStyle: "italic",
      }}
    >
      {text}
    </span>
  );
}

function formatLift(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  const abs = Math.abs(v);
  const decimals = abs >= 10 ? 1 : 2;
  return `${sign}${v.toFixed(decimals)}`;
}

function formatNum(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const decimals = abs >= 10 ? 1 : 2;
  return v.toFixed(decimals);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
