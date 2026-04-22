"use client";

import { FlaskConical, RotateCcw, Check, X, Sparkles } from "lucide-react";
import {
  UNIVERSAL_PARAMETER_SPECS,
  UNIVERSAL_DEFAULTS,
  interweaveHealth,
  type UniversalParameters,
  type UniversalParameterKey,
  type UniversalParameterSpec,
  type InterweaveSignals,
} from "@/lib/lab-formulas-universal";

/**
 * Universal-scope Lab control panel — replaces LabControlPanel on
 * `/app/lab`. Same visual language (matching Dial component), different
 * semantics: the four dials here govern CROSS-space interweave, not
 * intra-entity attention allocation.
 *
 * Also surfaces the four real-KG signals (active bridges, confirmed
 * bridges, contradictions, recency) above the dials, so the user can
 * see what data their universe currently has — the dials are levers
 * ON that data, not substitutes for it.
 *
 * Integrates with the LLM What-If panel: clicking "LLM scenario"
 * (Sparkles icon) opens WhatIfPanel, which is a separate component
 * because it needs access to the entities list for target picking.
 */

export interface UniversalLabControlPanelProps {
  parameters: UniversalParameters;
  onChange: (next: Partial<UniversalParameters>) => void;
  signals: InterweaveSignals;
  ghostParams?: UniversalParameters | null;
  onGhostParamsChange?: (next: UniversalParameters | null) => void;
  /** Callback to open the LLM What-If panel. Owned by the parent since
   *  the panel renders at Lab-page scope, not inside the control strip. */
  onOpenLlmWhatIf?: () => void;
}

export function UniversalLabControlPanel({
  parameters,
  onChange,
  signals,
  ghostParams,
  onGhostParamsChange,
  onOpenLlmWhatIf,
}: UniversalLabControlPanelProps) {
  const ghostActive = ghostParams !== null && ghostParams !== undefined;
  const activeParams = ghostActive ? ghostParams : parameters;

  const liveScore = interweaveHealth(parameters, signals);
  const ghostScore = ghostActive ? interweaveHealth(ghostParams, signals) : null;
  const diff = ghostScore !== null ? ghostScore - liveScore : null;
  const ghostDiffColor =
    diff === null
      ? "#64748b"
      : diff > 0.5
        ? "#4ade80"
        : diff < -0.5
          ? "#f472b6"
          : "#94a3b8";
  const ghostIsDirty =
    ghostActive &&
    (ghostParams.weaveDensity !== parameters.weaveDensity ||
      ghostParams.contradictionSensitivity !==
        parameters.contradictionSensitivity ||
      ghostParams.crossSpaceTau !== parameters.crossSpaceTau ||
      ghostParams.coherence !== parameters.coherence);

  const isDirty =
    parameters.weaveDensity !== UNIVERSAL_DEFAULTS.weaveDensity ||
    parameters.contradictionSensitivity !==
      UNIVERSAL_DEFAULTS.contradictionSensitivity ||
    parameters.crossSpaceTau !== UNIVERSAL_DEFAULTS.crossSpaceTau ||
    parameters.coherence !== UNIVERSAL_DEFAULTS.coherence;

  const enterGhost = () => onGhostParamsChange?.({ ...parameters });
  const exitGhost = () => onGhostParamsChange?.(null);
  const applyGhost = () => {
    if (!ghostActive) return;
    onChange(ghostParams);
    onGhostParamsChange?.(null);
  };
  const handleDialChange = (patch: Partial<UniversalParameters>) => {
    if (ghostActive && onGhostParamsChange) {
      onGhostParamsChange({ ...ghostParams, ...patch });
    } else {
      onChange(patch);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--lab-panel-bg)] px-3.5 py-2.5">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-[var(--lab-text-dim)]">
            ⚙ Control Panel
          </span>
          <span
            className="rounded-[2px] bg-[var(--lab-info-tint)] px-1.5 py-0.5 text-[9px] font-semibold"
            style={{ color: "#00ACC1" }}
          >
            Universal
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {onOpenLlmWhatIf && (
            <button
              type="button"
              onClick={onOpenLlmWhatIf}
              title="Run an LLM-grounded scenario against your whole universe"
              className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-info-border)] bg-[var(--lab-info-tint)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-info)] transition-colors hover:border-[var(--lab-info-border)] hover:bg-[var(--lab-info-tint-strong)]"
            >
              <Sparkles className="h-2.5 w-2.5" />
              LLM scenario
            </button>
          )}
          {onGhostParamsChange && !ghostActive && (
            <button
              type="button"
              onClick={enterGhost}
              title="Try parameter changes without saving"
              className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-ghost-border)] bg-[var(--lab-ghost-tint)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-ghost)] transition-colors hover:border-[var(--lab-ghost-border)] hover:bg-[var(--lab-ghost-tint-strong)]"
            >
              <FlaskConical className="h-2.5 w-2.5" />
              What if?
            </button>
          )}
          {onGhostParamsChange && ghostActive && (
            <>
              <button
                type="button"
                onClick={applyGhost}
                disabled={!ghostIsDirty}
                title={
                  ghostIsDirty
                    ? "Apply ghost values to live parameters"
                    : "Ghost is identical to live"
                }
                className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-accent)] bg-[var(--lab-accent-tint)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="h-2.5 w-2.5" />
                Apply
              </button>
              <button
                type="button"
                onClick={exitGhost}
                className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-text-mid)] hover:border-[var(--lab-danger)] hover:text-[var(--lab-danger)]"
              >
                <X className="h-2.5 w-2.5" />
                Exit
              </button>
            </>
          )}
          {isDirty && !ghostActive && (
            <button
              type="button"
              onClick={() => onChange(UNIVERSAL_DEFAULTS)}
              title="Reset to defaults"
              className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-text-mid)] hover:border-[var(--lab-accent)] hover:text-[var(--lab-accent)]"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Signals strip — what your actual universe looks like right now */}
      <div className="mb-2 grid grid-cols-4 gap-1.5 rounded-[2px] border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-1.5 font-mono">
        <SignalReadout
          label="Bridges"
          value={signals.activeBridges}
          sub={`${signals.confirmedBridges} confirmed`}
        />
        <SignalReadout label="Entities" value={signals.totalEntities} />
        <SignalReadout
          label="Conflicts"
          value={signals.contradictions}
          sub={signals.contradictions === 0 ? "clean" : "needs resolve"}
        />
        <SignalReadout
          label="Freshness"
          value={Math.round(signals.recencyMult * 100)}
          unit="%"
        />
      </div>

      {/* Ghost diff strip */}
      {ghostActive && ghostScore !== null && (
        <div
          className="mb-2 flex items-center gap-2 rounded-[2px] border border-[var(--lab-ghost-border)] bg-[var(--lab-ghost-tint)] px-2 py-1.5"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        >
          <span className="text-[8px] font-semibold uppercase tracking-[0.16em] text-[var(--lab-ghost)]">
            What if
          </span>
          <span className="flex items-baseline gap-1 text-[10px] text-[var(--lab-text-dim)]">
            <span className="text-[var(--lab-text-mid)]">live</span>
            <span className="tabular-nums text-[var(--lab-text)]">
              {liveScore.toFixed(1)}%
            </span>
          </span>
          <span className="text-[var(--lab-text-faint)]">→</span>
          <span className="flex items-baseline gap-1 text-[10px] text-[var(--lab-text-dim)]">
            <span className="text-[var(--lab-ghost)]">ghost</span>
            <span className="tabular-nums text-[var(--lab-text)]">
              {ghostScore.toFixed(1)}%
            </span>
          </span>
          <span
            className="ml-auto tabular-nums text-[11px] font-semibold"
            style={{ color: ghostDiffColor }}
          >
            {diff !== null && diff >= 0 ? "+" : ""}
            {diff?.toFixed(1)}
          </span>
        </div>
      )}

      {/* Dials */}
      <div className="grid flex-1 grid-cols-2 gap-2">
        {UNIVERSAL_PARAMETER_SPECS.map((spec) => (
          <Dial
            key={spec.key}
            spec={spec}
            value={activeParams[spec.key]}
            liveValue={ghostActive ? parameters[spec.key] : null}
            onChange={(v) =>
              handleDialChange({
                [spec.key]: v,
              } as Partial<UniversalParameters>)
            }
            ghost={ghostActive}
          />
        ))}
      </div>
    </div>
  );
}

function SignalReadout({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: number;
  unit?: string;
  sub?: string;
}) {
  return (
    <div className="text-center">
      <div className="text-[8px] uppercase tracking-widest text-[var(--lab-text-dim)]">
        {label}
      </div>
      <div className="mt-0.5 text-[14px] tabular-nums text-[var(--lab-text)]">
        {value}
        {unit && <span className="ml-0.5 text-[9px] text-[var(--lab-text-dim)]">{unit}</span>}
      </div>
      {sub && (
        <div className="text-[8px] text-[var(--lab-text-faint)]" title={sub}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Dial({
  spec,
  value,
  liveValue,
  onChange,
  ghost,
}: {
  spec: UniversalParameterSpec;
  value: number;
  liveValue: number | null;
  onChange: (v: number) => void;
  ghost: boolean;
}) {
  const formatted = spec.step < 1 ? value.toFixed(1) : Math.round(value).toString();
  const thumbColor = ghost ? "#a78bfa" : "#4ade80";
  const readoutColor = ghost ? "#a78bfa" : "#4ade80";
  const livePct =
    liveValue !== null ? (liveValue - spec.min) / (spec.max - spec.min) : null;
  return (
    <div
      className="relative overflow-hidden rounded-[2px] border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-2"
      title={spec.helper}
    >
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-text-dim)]">
          {spec.label} · {spec.symbol}
          {ghost && (
            <span className="ml-1 text-[var(--lab-ghost)]" title="Ghost">
              ∿
            </span>
          )}
        </span>
        <span
          className="font-mono text-[18px] leading-none tabular-nums"
          style={{ color: readoutColor }}
        >
          {formatted}
          {spec.unit && (
            <span className="ml-1 text-[9px] text-[var(--lab-text-dim)]">{spec.unit}</span>
          )}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          aria-label={`${spec.label} (${spec.key})${ghost ? " — ghost" : ""}`}
          className="w-full cursor-pointer appearance-none rounded-[2px] bg-[var(--lab-panel-inset)] outline-none"
          style={{ height: 4 }}
        />
        {livePct !== null && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: `calc(${livePct * 100}% - 3px)`,
              top: -1,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#4ade80",
              boxShadow: "0 0 6px #4ade80",
              opacity: 0.7,
            }}
            title={`Live ${spec.label} = ${liveValue?.toFixed(spec.step < 1 ? 1 : 0)}`}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[8px] text-[var(--lab-text-faint)]">
        <span>{spec.ticks[0]}</span>
        <span>{spec.ticks[1]}</span>
        <span>{spec.ticks[2]}</span>
      </div>

      <style jsx>{`
        input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: ${thumbColor};
          box-shadow: 0 0 6px ${thumbColor};
          cursor: pointer;
          border: 1px solid #10161f;
        }
        input[type="range"]::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: ${thumbColor};
          box-shadow: 0 0 6px ${thumbColor};
          cursor: pointer;
          border: 1px solid #10161f;
        }
      `}</style>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Keys = UniversalParameterKey;
