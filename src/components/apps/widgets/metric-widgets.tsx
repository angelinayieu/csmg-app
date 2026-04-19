"use client";

// ── Metric-style widgets ───────────────────────────────────────────────
//
// Three close cousins that all center on a "number + context" story:
//   - metric_card   → labelled number with optional target + delta
//   - hero_stat     → oversized number for the top of a "monitor" layout
//   - progress_tracker → bar + baseline/target + current
//
// Each is declared + registered in ../index.ts. Configs are intentionally
// small so an agent can emit them with minimal reasoning.

import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import { Surface, WidgetTitle, WidgetEmpty } from "./shared";
import { cn } from "@/lib/utils";
import { Ring } from "@/components/ui/ring";

// ── metric_card ────────────────────────────────────────────────────────

interface MetricCardConfig {
  label?: string;
  unit?: string;
  /** 0–1 number that, if present, renders a Ring alongside the value. */
  ring_value?: number;
  /** Inline accent color for the ring / rail. */
  accent?: string;
}

export function MetricCard({
  instance,
  context,
}: WidgetComponentProps<MetricCardConfig>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<number | string>(instance.bindings?.value);
  const target = context.resolve<number | string>(instance.bindings?.target);

  const formatted =
    res.value == null ? null : typeof res.value === "number"
      ? formatNumber(res.value)
      : String(res.value);
  const targetStr =
    target.value == null
      ? null
      : typeof target.value === "number"
      ? formatNumber(target.value)
      : String(target.value);

  return (
    <Surface accent={cfg.accent} density="comfortable">
      <WidgetTitle
        eyebrow={cfg.label ?? "Metric"}
        title={formatted ?? "—"}
        subtitle={
          targetStr
            ? `target ${targetStr}${cfg.unit ? ` ${cfg.unit}` : ""}`
            : cfg.unit
        }
        rightSlot={
          typeof cfg.ring_value === "number" ? (
            <Ring value={clamp01(cfg.ring_value)} size={42} showValue />
          ) : undefined
        }
      />
      {res.status === "missing" && !formatted && (
        <WidgetEmpty>No value available yet.</WidgetEmpty>
      )}
    </Surface>
  );
}

// ── hero_stat ──────────────────────────────────────────────────────────

interface HeroStatConfig {
  headline?: string;
  subhead?: string;
  accent?: string;
  /** 0-1 confidence. Shown as a Ring to the right. */
  confidence?: number;
}

export function HeroStat({
  instance,
  context,
}: WidgetComponentProps<HeroStatConfig>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<number | string>(instance.bindings?.value);
  const formatted =
    res.value == null
      ? cfg.headline ?? "—"
      : typeof res.value === "number"
      ? formatNumber(res.value)
      : String(res.value);

  return (
    <Surface
      tone="loud"
      accent={cfg.accent ?? "#3b82f6"}
      density="comfortable"
      className="pt-6"
    >
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">
            {cfg.subhead ?? "Headline"}
          </div>
          <div className="mt-1 truncate text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-gray-900">
            {formatted}
          </div>
          {cfg.headline && res.value != null && (
            <div className="mt-1 text-[13px] text-gray-500">{cfg.headline}</div>
          )}
        </div>
        {typeof cfg.confidence === "number" && (
          <Ring value={clamp01(cfg.confidence)} size={52} showValue />
        )}
      </div>
    </Surface>
  );
}

// ── progress_tracker ───────────────────────────────────────────────────

interface ProgressTrackerConfig {
  label?: string;
  unit?: string;
  accent?: string;
}

export function ProgressTracker({
  instance,
  context,
}: WidgetComponentProps<ProgressTrackerConfig>) {
  const cfg = instance.config ?? {};
  const current = context.resolve<number>(instance.bindings?.current);
  const baseline = context.resolve<number>(instance.bindings?.baseline);
  const target = context.resolve<number>(instance.bindings?.target);

  const c = asNum(current.value);
  const b = asNum(baseline.value);
  const t = asNum(target.value);

  const pct =
    c != null && b != null && t != null && t !== b
      ? clamp01((c - b) / (t - b))
      : null;

  const accent = cfg.accent ?? "#2563eb";

  return (
    <Surface accent={accent}>
      <WidgetTitle
        eyebrow={cfg.label ?? "Progress"}
        title={c != null ? `${formatNumber(c)}${cfg.unit ? ` ${cfg.unit}` : ""}` : "—"}
        subtitle={
          t != null
            ? `target ${formatNumber(t)}${cfg.unit ? ` ${cfg.unit}` : ""}${
                b != null ? ` · baseline ${formatNumber(b)}` : ""
              }`
            : undefined
        }
      />
      {pct == null ? (
        <WidgetEmpty>Not enough data to draw progress.</WidgetEmpty>
      ) : (
        <div className="mt-1">
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
              style={{
                width: `${Math.round(pct * 100)}%`,
                background: `linear-gradient(90deg, ${accent}, ${accent}cc)`,
              }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-gray-500">
            <span>baseline</span>
            <span className="font-medium text-gray-700">
              {Math.round(pct * 100)}%
            </span>
            <span>target</span>
          </div>
        </div>
      )}
    </Surface>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (!Number.isInteger(n)) return n.toFixed(2);
  return n.toLocaleString();
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

// Keep cn in scope so devtools don't complain about unused import across this module cluster.
void cn;
