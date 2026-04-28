"use client";

// ── Condition modulators panel ──────────────────────────────────
//
// The Sleep / Stress / Caffeine / Time-of-day slider stack from the
// design discussion. Reusable in two contexts:
//
//   1. Subject detail page — sliders edit subject.conditions and
//      PATCH /api/subjects/[id] on commit (debounced).
//   2. Lab page (when `?subjectId=` is present) — sliders edit a
//      LIVE conditions overlay that re-derives effective entity
//      params via applyModulators(); experiments POST that
//      conditions snapshot to /api/subjects/[id]/experiments.
//
// Pure presentational + a controlled value+onChange contract — no
// fetch, no debounce, no API calls. The owning surface decides
// what to do with changes.

import { useMemo } from "react";
import { Sliders, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STARTER_MODULATORS,
  type ModulatorSpec,
  modulatorDefault,
} from "@/lib/subjects/modulators";

interface Props {
  /** Current condition values, keyed by modulator key. Missing keys
   *  fall back to each modulator's default at render time. */
  conditions: Record<string, number>;
  /** Owner is responsible for persisting / debouncing. */
  onChange: (next: Record<string, number>) => void;
  /** Optional vocabulary override — defaults to STARTER_MODULATORS. */
  modulators?: ModulatorSpec[];
  /** Optional subset filter — only show modulators whose key is in
   *  this set. Useful when a subject only cares about a few. */
  visibleKeys?: Set<string>;
  /** Compact rendering (smaller fonts, tighter spacing) for use
   *  inside the lab header strip vs. the detail page. */
  dense?: boolean;
  /** Read-only view (sliders disabled, useful for experiment
   *  history rendering). */
  readOnly?: boolean;
  /** Optional title override. */
  title?: string;
}

export function ConditionModulatorsPanel({
  conditions,
  onChange,
  modulators = STARTER_MODULATORS,
  visibleKeys,
  dense = false,
  readOnly = false,
  title = "Conditions",
}: Props) {
  const visible = useMemo(
    () =>
      visibleKeys
        ? modulators.filter((m) => visibleKeys.has(m.key))
        : modulators,
    [modulators, visibleKeys],
  );

  // Group modulators by their declared group so the UI reads
  // sectioned (Physiology / Context / etc.) without us hard-coding
  // group ordering at this layer.
  const grouped = useMemo(() => {
    const m = new Map<ModulatorSpec["group"], ModulatorSpec[]>();
    for (const mod of visible) {
      const arr = m.get(mod.group) ?? [];
      arr.push(mod);
      m.set(mod.group, arr);
    }
    return Array.from(m.entries());
  }, [visible]);

  if (visible.length === 0) return null;

  const handleChange = (key: string, value: number) => {
    if (readOnly) return;
    const next = { ...conditions, [key]: value };
    onChange(next);
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-white",
        dense ? "p-2" : "p-3",
      )}
      role="group"
      aria-label={title}
    >
      <div
        className={cn(
          "mb-2 flex items-center gap-1.5 font-bold uppercase tracking-[0.12em] text-slate-500",
          dense ? "text-[9px]" : "text-[10px]",
        )}
      >
        <Sliders className={cn(dense ? "h-2.5 w-2.5" : "h-3 w-3")} />
        {title}
        {readOnly && (
          <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[8.5px] font-semibold text-slate-500">
            read-only
          </span>
        )}
      </div>
      <div className={cn("space-y-2", dense && "space-y-1.5")}>
        {grouped.map(([group, mods]) => (
          <fieldset key={group} className="space-y-1.5">
            {!dense && (
              <legend className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">
                {group}
              </legend>
            )}
            {mods.map((mod) => {
              const value =
                typeof conditions[mod.key] === "number"
                  ? conditions[mod.key]
                  : modulatorDefault(mod.key, modulators);
              const atDefault =
                Math.abs(value - mod.default) <
                Math.max(mod.step / 2, 0.01);
              return (
                <ModulatorRow
                  key={mod.key}
                  mod={mod}
                  value={value}
                  atDefault={atDefault}
                  dense={dense}
                  readOnly={readOnly}
                  onChange={(v) => handleChange(mod.key, v)}
                />
              );
            })}
          </fieldset>
        ))}
      </div>
    </div>
  );
}

function ModulatorRow({
  mod,
  value,
  atDefault,
  dense,
  readOnly,
  onChange,
}: {
  mod: ModulatorSpec;
  value: number;
  atDefault: boolean;
  dense: boolean;
  readOnly: boolean;
  onChange: (v: number) => void;
}) {
  const labelSize = dense ? "text-[10px]" : "text-[11px]";
  return (
    <div className="grid grid-cols-[110px_1fr_56px] items-center gap-2">
      <label
        htmlFor={`mod-${mod.key}`}
        className={cn(
          "flex items-center gap-1 font-medium text-slate-700",
          labelSize,
        )}
        title={mod.description}
      >
        {mod.label}
        <span
          className={cn(
            "text-slate-300",
            dense ? "text-[8px]" : "text-[9px]",
          )}
        >
          <Info className={cn(dense ? "h-2.5 w-2.5" : "h-3 w-3")} />
        </span>
      </label>
      <input
        id={`mod-${mod.key}`}
        type="range"
        min={mod.range[0]}
        max={mod.range[1]}
        step={mod.step}
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          "h-1.5 cursor-pointer appearance-none rounded-full bg-slate-200 accent-violet-600",
          readOnly && "cursor-not-allowed opacity-60",
        )}
      />
      <span
        className={cn(
          "text-right font-mono tabular-nums",
          atDefault ? "text-slate-400" : "text-violet-700",
          dense ? "text-[10px]" : "text-[11px]",
        )}
      >
        {formatValue(value, mod)}
      </span>
    </div>
  );
}

function formatValue(value: number, mod: ModulatorSpec): string {
  // Pick a sensible decimal count from the step granularity.
  const decimals = mod.step >= 1 ? 0 : mod.step >= 0.1 ? 1 : 2;
  return `${value.toFixed(decimals)}${mod.units ? mod.units : ""}`;
}
