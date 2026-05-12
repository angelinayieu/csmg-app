"use client";

// ── LabEntityVitalsPanel ──────────────────────────────────────────
//
// Phase C — replacement for the K/τ/ρ/α dial panel in generic labs
// (NodeLab, SpaceLab). The Capacity/Memory/Update/Focus dials still drive
// the chamber's throughput visualization under the hood, but those
// numbers don't translate cleanly to an abstract knowledge-graph entity
// like "LLM Integration Frameworks" — so the dials are no longer the
// resting state of the panel.
//
// Resting state shows what's actually meaningful for a graph entity:
//   • Confidence (the entity's persisted confidence score, 0–100%)
//   • Importance (fundamental / critical / important / moderate)
//   • Blast radius (computed propagation impact, when present)
//
// Plus a "Simulate change" button that opens the LLM-grounded WhatIfPanel
// modal — letting the user say "what if this entity weakens?" or
// "what if this is removed?" with semantic input rather than dial fiddling.
//
// Power users can flip to the legacy dial view via the small "Advanced"
// toggle in the header — the K/τ/ρ/α dials still mutate `parameters` and
// flow through to the chamber's throughput exactly as before. This keeps
// the ContextualLab-style modulator math available without forcing it on
// every user.

import { useState } from "react";
import { Check, ChevronRight, FlaskConical, RotateCcw, Shield, X } from "lucide-react";
import {
  PARAMETER_SPECS,
  defaultsForCategory,
  throughput as computeThroughput,
  type InstrumentParameters,
  type ParameterKey,
} from "@/lib/lab-formulas";

const IMPORTANCE_RANK: Record<string, number> = {
  fundamental: 4,
  critical: 3,
  important: 2,
  moderate: 1,
};

const IMPORTANCE_COLOR: Record<string, string> = {
  fundamental: "#dc2626",
  critical: "#ea580c",
  important: "#d97706",
  moderate: "#0891b2",
};

export interface LabEntityVitalsPanelProps {
  /** Confidence score in [0, 1]. Persisted on entities.confidence. */
  confidence: number | null;
  /** Importance enum from entities.importance. */
  importance: string | null;
  /** Optional blast-radius readout from entities.blast_radius. */
  blastRadius?: number | null;
  /** Optional connection count (sum of upstream + downstream edges). */
  connectionCount?: number | null;

  /** Phase 21 — same tuning-target plumbing as the legacy panel so
   *  selecting a subunit re-points the live readouts at it. */
  tuningTargetName?: string;
  tuningSubunitSelected?: boolean;
  onClearTuningTarget?: () => void;
  tuningCategory?: string | null;

  /** Hands the K/τ/ρ/α machinery through to the (collapsible) advanced
   *  dial view. The dials still drive the chamber's throughput when shown. */
  parameters: InstrumentParameters;
  onChange: (next: Partial<InstrumentParameters>) => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  ghostParams?: InstrumentParameters | null;
  onGhostParamsChange?: (next: InstrumentParameters | null) => void;

  /** Click → parent opens WhatIfPanel modal scoped to this entity. */
  onOpenSimulate?: () => void;
}

export function LabEntityVitalsPanel({
  confidence,
  importance,
  blastRadius,
  connectionCount,
  tuningTargetName,
  tuningSubunitSelected,
  onClearTuningTarget,
  tuningCategory,
  parameters,
  onChange,
  saveStatus,
  ghostParams,
  onGhostParamsChange,
  onOpenSimulate,
}: LabEntityVitalsPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const confidencePct =
    typeof confidence === "number"
      ? Math.round(Math.max(0, Math.min(1, confidence)) * 100)
      : null;
  const importanceLabel = importance ?? "moderate";
  const importanceColor = IMPORTANCE_COLOR[importanceLabel] ?? "#64748b";
  const importanceFill = IMPORTANCE_COLOR[importanceLabel]
    ? `${IMPORTANCE_COLOR[importanceLabel]}1a`
    : "#64748b1a";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--lab-panel-bg)] px-3.5 py-2.5">
      {/* Header — matches the existing control panel header layout
          (target chip + status badges) so the panel feels structurally
          identical when readers are scanning across the footer. */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-[var(--lab-text-dim)]">
            ⚙ Vitals
          </span>
          {tuningTargetName ? (
            <div
              className="flex min-w-0 items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[9px] font-semibold"
              style={{
                background: tuningSubunitSelected ? "#fbbf2418" : "#4ade8018",
                color: tuningSubunitSelected ? "#fbbf24" : "#4ade80",
              }}
            >
              <span className="truncate" title={tuningTargetName}>
                {tuningTargetName.length > 22
                  ? tuningTargetName.slice(0, 22) + "…"
                  : tuningTargetName}
              </span>
              {tuningSubunitSelected && onClearTuningTarget && (
                <button
                  type="button"
                  onClick={onClearTuningTarget}
                  title="Return readouts to the focal"
                  className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm hover:bg-[var(--lab-warn-tint)]"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ) : (
            <span className="text-[9px] text-[var(--lab-text-faint)]">FOCAL</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            title={
              advancedOpen
                ? "Hide advanced parameters (Capacity / Memory / Update / Focus)"
                : "Show advanced parameters (Capacity / Memory / Update / Focus)"
            }
            className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-text-mid)] transition-colors hover:border-[var(--lab-accent)] hover:text-[var(--lab-accent)]"
            aria-expanded={advancedOpen}
          >
            <ChevronRight
              className={`h-2.5 w-2.5 transition-transform ${advancedOpen ? "rotate-90" : ""}`}
            />
            Advanced
          </button>
          <SaveBadge status={saveStatus} />
        </div>
      </div>

      {advancedOpen ? (
        <AdvancedDialView
          parameters={parameters}
          onChange={onChange}
          ghostParams={ghostParams}
          onGhostParamsChange={onGhostParamsChange}
          tuningCategory={tuningCategory}
        />
      ) : (
        <div className="flex flex-1 flex-col gap-2 overflow-hidden">
          {/* Confidence bar */}
          <div className="rounded-[2px] border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] px-2.5 py-2">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-text-dim)]">
                Confidence
              </span>
              <span className="font-mono text-[16px] leading-none tabular-nums text-[var(--lab-accent)]">
                {confidencePct !== null ? `${confidencePct}%` : "—"}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--lab-panel-inset)]">
              <div
                className="h-full rounded-full bg-[var(--lab-accent)] transition-[width] duration-200"
                style={{ width: `${confidencePct ?? 0}%` }}
              />
            </div>
          </div>

          {/* Importance + Blast radius row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[2px] border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] px-2 py-1.5">
              <div className="font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-text-dim)]">
                Importance
              </div>
              <div
                className="mt-1 inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[10px] font-semibold capitalize"
                style={{ background: importanceFill, color: importanceColor }}
              >
                <Shield className="h-2.5 w-2.5" />
                {importanceLabel}
                {IMPORTANCE_RANK[importanceLabel] && (
                  <span className="font-mono opacity-70">
                    ·{IMPORTANCE_RANK[importanceLabel]}/4
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-[2px] border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] px-2 py-1.5">
              <div className="font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-text-dim)]">
                {connectionCount !== null && connectionCount !== undefined
                  ? "Connections"
                  : "Blast radius"}
              </div>
              <div className="mt-1 font-mono text-[14px] tabular-nums text-[var(--lab-text)]">
                {connectionCount !== null && connectionCount !== undefined
                  ? connectionCount
                  : (blastRadius ?? 0).toFixed(1)}
              </div>
            </div>
          </div>

          {/* Simulate change — opens the LLM-grounded WhatIfPanel modal in
              the parent. Disabled when no callback wired (read-only mode). */}
          <button
            type="button"
            onClick={onOpenSimulate}
            disabled={!onOpenSimulate}
            title="Simulate a change to this entity — strengthen / weaken / remove"
            className="mt-auto flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-[var(--lab-ghost-border)] bg-[var(--lab-ghost-tint)] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-ghost)] transition-colors hover:bg-[var(--lab-ghost-tint-strong)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FlaskConical className="h-3 w-3" />
            Simulate change
          </button>
        </div>
      )}
    </div>
  );
}

// ── Advanced (dial) view ──────────────────────────────────────────
//
// Identical math to the legacy LabControlPanel — just wrapped in the new
// header chrome so users can see "where the throughput number comes from"
// without that being the default surface. Ghost mode (counterfactual
// dial editing) lives here so it doesn't conflict with the semantic
// "Simulate change" button on the resting view.
function AdvancedDialView({
  parameters,
  onChange,
  ghostParams,
  onGhostParamsChange,
  tuningCategory,
}: {
  parameters: InstrumentParameters;
  onChange: (next: Partial<InstrumentParameters>) => void;
  ghostParams?: InstrumentParameters | null;
  onGhostParamsChange?: (next: InstrumentParameters | null) => void;
  tuningCategory?: string | null;
}) {
  const defaults = defaultsForCategory(tuningCategory);
  const isDirty =
    parameters.K !== defaults.K ||
    parameters.tau !== defaults.tau ||
    parameters.rho !== defaults.rho ||
    parameters.alpha !== defaults.alpha;

  const ghostActive = ghostParams !== null && ghostParams !== undefined;
  const activeParams = ghostActive ? ghostParams : parameters;
  const liveThroughput = computeThroughput(parameters);
  const ghostThroughput = ghostActive ? computeThroughput(ghostParams) : null;
  const diff = ghostThroughput !== null ? ghostThroughput - liveThroughput : null;
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
    <div className="flex flex-1 flex-col gap-2 overflow-hidden">
      {/* Mini toolbar for dial-mode counterfactuals + reset */}
      <div className="flex items-center gap-1.5">
        {onGhostParamsChange && !ghostActive && (
          <button
            type="button"
            onClick={enterGhost}
            title="Try parameter changes without saving"
            className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-ghost-border)] bg-[var(--lab-ghost-tint)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-ghost)] hover:bg-[var(--lab-ghost-tint-strong)]"
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
              className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-accent)] bg-[var(--lab-accent-tint)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-accent)] hover:bg-[var(--lab-accent-tint)] disabled:cursor-not-allowed disabled:opacity-40"
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
            onClick={() => onChange(defaults)}
            title="Reset parameters to category defaults"
            className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[var(--lab-text-mid)] hover:border-[var(--lab-accent)] hover:text-[var(--lab-accent)]"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            Reset
          </button>
        )}
      </div>

      {ghostActive && ghostThroughput !== null && (
        <div
          className="flex items-center gap-2 rounded-[2px] border border-[var(--lab-ghost-border)] bg-[var(--lab-ghost-tint)] px-2 py-1.5"
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
  const livePct = liveValue !== null ? (liveValue - min) / (max - min) : null;
  return (
    <div className="relative overflow-hidden rounded-[2px] border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-2">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-text-dim)]">
          {label} · {symbol}
          {ghost && (
            <span
              className="ml-1 text-[var(--lab-ghost)]"
              title="Counterfactual ghost value"
            >
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
