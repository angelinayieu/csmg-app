"use client";

import { Check, FlaskConical, RotateCcw, X } from "lucide-react";
import {
  PARAMETER_SPECS,
  defaultsForCategory,
  throughput as computeThroughput,
  type InstrumentParameters,
  type ParameterKey,
} from "@/lib/lab-formulas";

export interface LabControlPanelProps {
  parameters: InstrumentParameters;
  onChange: (next: Partial<InstrumentParameters>) => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  /**
   * Phase 21: name of the entity currently being tuned (focal name OR
   * the selected subunit's name) + optional clear callback for resetting
   * back to the focal.
   */
  tuningTargetName?: string;
  tuningSubunitSelected?: boolean;
  onClearTuningTarget?: () => void;
  /**
   * Phase 29: entity category used to resolve defaults for the Reset
   * button (addresses review finding U6 — "no reset to defaults"). When
   * omitted, the reset control is hidden.
   */
  tuningCategory?: string | null;
  /**
   * Phase 43 — counterfactual "What if?" state, owned by the lab
   * orchestrator so the chamber can render a ghost probability index
   * alongside the live one. When null, ghost mode is off and the dials
   * tune live parameters; when non-null, the dials edit the ghost set
   * without touching live (so nothing is persisted until Apply).
   */
  ghostParams?: InstrumentParameters | null;
  onGhostParamsChange?: (next: InstrumentParameters | null) => void;
}

export function LabControlPanel({
  parameters,
  onChange,
  saveStatus,
  tuningTargetName,
  tuningSubunitSelected,
  onClearTuningTarget,
  tuningCategory,
  ghostParams,
  onGhostParamsChange,
}: LabControlPanelProps) {
  // Phase 29: reset returns every dial to the category default. Dirty
  // check prevents showing the button when values already equal defaults
  // (otherwise it's always visible and never actionable).
  const defaults = defaultsForCategory(tuningCategory);
  const isDirty =
    parameters.K !== defaults.K ||
    parameters.tau !== defaults.tau ||
    parameters.rho !== defaults.rho ||
    parameters.alpha !== defaults.alpha;

  // Phase 43: which parameter set are the dials currently editing?
  // Ghost mode (ghostParams non-null) makes the dials mutate ghost; live
  // mode edits `parameters`. Ghost throughput is computed here for the
  // inline diff; the chamber also receives ghostParams via prop and
  // shows its own ghost index overlay.
  const ghostActive = ghostParams !== null && ghostParams !== undefined;
  const activeParams = ghostActive ? ghostParams : parameters;
  const liveThroughput = computeThroughput(parameters);
  const ghostThroughput = ghostActive ? computeThroughput(ghostParams) : null;
  const diff =
    ghostThroughput !== null ? ghostThroughput - liveThroughput : null;
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
    (ghostParams.K !== parameters.K ||
      ghostParams.tau !== parameters.tau ||
      ghostParams.rho !== parameters.rho ||
      ghostParams.alpha !== parameters.alpha);

  const enterGhost = () => onGhostParamsChange?.({ ...parameters });
  const exitGhost = () => onGhostParamsChange?.(null);
  const applyGhost = () => {
    if (!ghostActive) return;
    onChange(ghostParams);
    onGhostParamsChange?.(null);
  };
  const handleDialChange = (patch: Partial<InstrumentParameters>) => {
    if (ghostActive && onGhostParamsChange) {
      onGhostParamsChange({ ...ghostParams, ...patch });
    } else {
      onChange(patch);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--lab-panel-bg)] px-3.5 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-[var(--lab-text-dim)]">
            ⚙ Tuning
          </span>
          {tuningTargetName ? (
            <div
              className="flex min-w-0 items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[9px] font-semibold"
              style={{
                background: tuningSubunitSelected ? "#fbbf2418" : "#4ade8018",
                color: tuningSubunitSelected ? "#fbbf24" : "#4ade80",
              }}
            >
              <span className="truncate" title={`Tuning ${tuningTargetName}`}>
                {tuningTargetName.length > 22
                  ? tuningTargetName.slice(0, 22) + "…"
                  : tuningTargetName}
              </span>
              {tuningSubunitSelected && onClearTuningTarget && (
                <button
                  type="button"
                  onClick={onClearTuningTarget}
                  title="Return control panel to the focal"
                  className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm hover:bg-[var(--lab-warn-tint)]"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ) : (
            <span className="text-[9px] text-[var(--lab-text-faint)]">LIVE PARAMETERS</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Phase 43 — What-if toggle. Enter ghost mode from live; show
              Exit + Apply while in ghost mode. */}
          {onGhostParamsChange && !ghostActive && (
            <button
              type="button"
              onClick={enterGhost}
              title="Enter counterfactual mode — try parameter changes without saving"
              className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-ghost-border)] bg-[var(--lab-ghost-tint)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-ghost)] transition-colors hover:border-[var(--lab-ghost-border)] hover:bg-[var(--lab-ghost-tint-strong)]"
              aria-label="Enter what-if counterfactual mode"
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
                    : "Ghost is identical to live — nothing to apply"
                }
                className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-accent)] bg-[var(--lab-accent-tint)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-accent)] transition-colors hover:border-[var(--lab-accent)] hover:bg-[var(--lab-accent-tint)] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Apply ghost parameters to live"
              >
                <Check className="h-2.5 w-2.5" />
                Apply
              </button>
              <button
                type="button"
                onClick={exitGhost}
                title="Discard ghost parameters — return to live"
                className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-text-mid)] transition-colors hover:border-[var(--lab-danger)] hover:text-[var(--lab-danger)]"
                aria-label="Exit what-if mode without applying"
              >
                <X className="h-2.5 w-2.5" />
                Exit
              </button>
            </>
          )}
          {isDirty && !ghostActive && (
            <button
              type="button"
              onClick={() => onChange(defaults)}
              title={`Reset to ${tuningCategory ?? "default"} defaults (K=${defaults.K} · τ=${defaults.tau} · ρ=${defaults.rho} · α=${defaults.alpha})`}
              className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-text-mid)] transition-colors hover:border-[var(--lab-accent)] hover:bg-[var(--lab-accent-tint)] hover:text-[var(--lab-accent)]"
              aria-label="Reset parameters to category defaults"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              Reset
            </button>
          )}
          <SaveBadge status={saveStatus} />
        </div>
      </div>

      {/* Phase 43 — ghost-vs-live throughput diff strip. Only shown in
          ghost mode so the resting UI stays dense. */}
      {ghostActive && ghostThroughput !== null && (
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
              {liveThroughput.toFixed(1)}%
            </span>
          </span>
          <span className="text-[var(--lab-text-faint)]">→</span>
          <span className="flex items-baseline gap-1 text-[10px] text-[var(--lab-text-dim)]">
            <span className="text-[var(--lab-ghost)]">ghost</span>
            <span className="tabular-nums text-[var(--lab-text)]">
              {ghostThroughput.toFixed(1)}%
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

      <div className="grid flex-1 grid-cols-2 gap-2">
        {PARAMETER_SPECS.map((spec) => (
          <Dial
            key={spec.key}
            label={spec.label}
            symbol={spec.symbol}
            value={activeParams[spec.key]}
            liveValue={ghostActive ? parameters[spec.key] : null}
            unit={spec.unit}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            ticks={spec.ticks}
            onChange={(v) =>
              handleDialChange({ [spec.key]: v } as Partial<InstrumentParameters>)
            }
            paramKey={spec.key}
            ghost={ghostActive}
          />
        ))}
      </div>
    </div>
  );
}

function Dial({
  label,
  symbol,
  value,
  liveValue,
  unit,
  min,
  max,
  step,
  ticks,
  onChange,
  paramKey,
  ghost,
}: {
  label: string;
  symbol: string;
  value: number;
  /** In ghost mode, the live value is shown as a non-interactive pip. */
  liveValue: number | null;
  unit: string;
  min: number;
  max: number;
  step: number;
  ticks: [string, string, string];
  onChange: (v: number) => void;
  paramKey: ParameterKey;
  ghost: boolean;
}) {
  const formatted = step < 1 ? value.toFixed(1) : Math.round(value).toString();
  const thumbColor = ghost ? "#a78bfa" : "#4ade80";
  const readoutColor = ghost ? "#a78bfa" : "#4ade80";
  // Position (0..1) of the live pip along the track, used only in ghost.
  const livePct =
    liveValue !== null ? (liveValue - min) / (max - min) : null;
  return (
    <div className="relative overflow-hidden rounded-[2px] border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-2">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-text-dim)]">
          {label} · {symbol}
          {ghost && (
            <span className="ml-1 text-[var(--lab-ghost)]" title="Counterfactual ghost value">
              ∿
            </span>
          )}
        </span>
        <span
          className="font-mono text-[18px] leading-none tabular-nums"
          style={{ color: readoutColor }}
        >
          {formatted}
          {unit && <span className="ml-1 text-[9px] text-[var(--lab-text-dim)]">{unit}</span>}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          aria-label={`${label} (${paramKey})${ghost ? " — ghost" : ""}`}
          className="w-full cursor-pointer appearance-none rounded-[2px] bg-[var(--lab-panel-inset)] outline-none"
          style={{ height: 4 }}
        />
        {/* Phase 43 — live-value pip. Non-interactive triangle marker
            below the track so users see where live sits vs ghost. */}
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
            title={`Live ${label} = ${liveValue?.toFixed(step < 1 ? 1 : 0)}`}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[8px] text-[var(--lab-text-faint)]">
        <span>{ticks[0]}</span>
        <span>{ticks[1]}</span>
        <span>{ticks[2]}</span>
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

function SaveBadge({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  const accent =
    status === "saving" ? "#fbbf24" : status === "saved" ? "#4ade80" : "#ef4444";
  return (
    <span
      className="font-mono text-[8px] font-semibold uppercase tracking-widest"
      style={{ color: accent }}
    >
      {status === "saving" ? "SAVING…" : status === "saved" ? "SAVED" : "ERR"}
    </span>
  );
}
