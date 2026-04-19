"use client";

// ── Insight-style widgets ──────────────────────────────────────────────
//
// Widgets that surface synthesis-layer signals as app content:
//   - entity_callout       → a single dominant factor / entity badge
//   - leverage_callout     → leverage point extracted from synthesis
//   - risk_callout         → risk point extracted from synthesis
//   - action_list          → action items (string list, not Intervention rows)
//   - timeline_view        → dated events / milestones
//   - scenario_comparator  → side-by-side scenario probabilities
//
// These wrap existing visual primitives (CalloutBox, Ring) so they inherit
// the system's look without diverging.

import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import { Surface, WidgetTitle, WidgetEmpty, ActionButton } from "./shared";
import { CalloutBox } from "@/components/ui/callout-box";
import { Ring } from "@/components/ui/ring";
import { cn } from "@/lib/utils";

// ── entity_callout ─────────────────────────────────────────────────────

interface EntityCalloutConfig {
  label?: string;
  accent?: string;
}

interface EntityLite {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  confidence?: number | null;
}

export function EntityCallout({
  instance,
  context,
}: WidgetComponentProps<EntityCalloutConfig>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<EntityLite>(instance.bindings?.entity);
  const e = res.value ?? null;

  return (
    <Surface accent={cfg.accent ?? "#0ea5e9"} density="comfortable">
      <WidgetTitle
        eyebrow={cfg.label ?? "Dominant factor"}
        title={e?.name ?? "—"}
        subtitle={e?.description ?? undefined}
        rightSlot={
          typeof e?.confidence === "number" ? (
            <Ring value={Math.max(0, Math.min(1, e.confidence))} size={38} showValue />
          ) : undefined
        }
      />
      {!e && <WidgetEmpty>No entity bound yet.</WidgetEmpty>}
      {e && instance.actions?.primary && (
        <div className="mt-2">
          <ActionButton
            label="Open entity"
            variant="subtle"
            compact
            onClick={() =>
              context.dispatch(instance.id, "primary", { entity_id: e.id })
            }
          />
        </div>
      )}
    </Surface>
  );
}

// ── leverage_callout ───────────────────────────────────────────────────

interface LeveragePointLite {
  entity_id?: string;
  summary?: string;
  action?: { primary?: string } | null;
  impact?: number | null;
}

export function LeverageCallout({
  instance,
  context,
}: WidgetComponentProps<{ label?: string; accent?: string }>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<LeveragePointLite>(instance.bindings?.leverage);
  const p = res.value ?? null;

  return (
    <Surface accent={cfg.accent ?? "#3b82f6"}>
      <WidgetTitle
        eyebrow={cfg.label ?? "Leverage"}
        title={p?.entity_id ?? "—"}
        subtitle={p?.summary ?? undefined}
        rightSlot={
          typeof p?.impact === "number" ? (
            <Ring value={Math.max(0, Math.min(1, p.impact))} size={38} showValue />
          ) : undefined
        }
      />
      {p?.action?.primary && (
        <CalloutBox type="action" compact>
          {p.action.primary}
        </CalloutBox>
      )}
      {!p && <WidgetEmpty>No leverage point bound.</WidgetEmpty>}
    </Surface>
  );
}

// ── risk_callout ───────────────────────────────────────────────────────

interface RiskPointLite {
  entity_id?: string;
  summary?: string;
  mitigation?: string | null;
  severity?: number | null;
}

export function RiskCallout({
  instance,
  context,
}: WidgetComponentProps<{ label?: string; accent?: string }>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<RiskPointLite>(instance.bindings?.risk);
  const p = res.value ?? null;

  return (
    <Surface accent={cfg.accent ?? "#ef4444"}>
      <WidgetTitle
        eyebrow={cfg.label ?? "Risk"}
        title={p?.entity_id ?? "—"}
        subtitle={p?.summary ?? undefined}
        rightSlot={
          typeof p?.severity === "number" ? (
            <Ring value={Math.max(0, Math.min(1, p.severity))} size={38} showValue />
          ) : undefined
        }
      />
      {p?.mitigation && (
        <CalloutBox type="mitigation" compact>
          {p.mitigation}
        </CalloutBox>
      )}
      {!p && <WidgetEmpty>No risk point bound.</WidgetEmpty>}
    </Surface>
  );
}

// ── action_list ────────────────────────────────────────────────────────

interface ActionListItem {
  label: string;
  detail?: string;
  done?: boolean;
}

export function ActionList({
  instance,
  context,
}: WidgetComponentProps<{ label?: string; accent?: string }>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<ActionListItem[]>(instance.bindings?.items);
  const items = Array.isArray(res.value) ? res.value : [];

  return (
    <Surface accent={cfg.accent ?? "#10b981"}>
      <WidgetTitle
        eyebrow={cfg.label ?? "Actions"}
        title={items.length > 0 ? `${items.length} action${items.length === 1 ? "" : "s"}` : "—"}
      />
      {items.length === 0 ? (
        <WidgetEmpty>No actions to show.</WidgetEmpty>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li
              key={i}
              className={cn(
                "flex items-start gap-2 rounded-lg px-2 py-1.5 text-[12.5px]",
                it.done ? "text-gray-400 line-through" : "text-gray-700"
              )}
            >
              <span
                className={cn(
                  "mt-[6px] inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full",
                  it.done ? "bg-gray-300" : "bg-emerald-500"
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{it.label}</span>
                {it.detail && (
                  <span className="ml-1 text-gray-400">— {it.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

// ── timeline_view ──────────────────────────────────────────────────────

interface TimelineItem {
  at: string;      // ISO string or display label
  label: string;
  detail?: string;
  kind?: "past" | "now" | "future";
}

export function TimelineView({
  instance,
  context,
}: WidgetComponentProps<{ label?: string; accent?: string }>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<TimelineItem[]>(instance.bindings?.items);
  const items = Array.isArray(res.value) ? res.value : [];

  return (
    <Surface accent={cfg.accent ?? "#6366f1"}>
      <WidgetTitle eyebrow={cfg.label ?? "Timeline"} title={`${items.length} events`} />
      {items.length === 0 ? (
        <WidgetEmpty>No events.</WidgetEmpty>
      ) : (
        <ol className="relative space-y-3 border-l border-gray-200 pl-4">
          {items.map((it, i) => (
            <li key={i} className="relative">
              <span
                className={cn(
                  "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white",
                  it.kind === "now"
                    ? "bg-indigo-500 ring-2 ring-indigo-200"
                    : it.kind === "future"
                    ? "bg-gray-200"
                    : "bg-gray-400"
                )}
              />
              <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                {formatAt(it.at)}
              </div>
              <div className="mt-0.5 text-[13px] font-medium text-gray-800">
                {it.label}
              </div>
              {it.detail && (
                <div className="text-[12px] text-gray-500">{it.detail}</div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Surface>
  );
}

function formatAt(at: string): string {
  try {
    const d = new Date(at);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "2-digit",
      });
    }
  } catch {
    // fall through
  }
  return at;
}

// ── scenario_comparator ────────────────────────────────────────────────

interface ScenarioLite {
  id?: string;
  title: string;
  probability?: number | null;
  summary?: string | null;
  outcome?: "good" | "bad" | "neutral" | null;
}

export function ScenarioComparator({
  instance,
  context,
}: WidgetComponentProps<{ label?: string; accent?: string }>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<ScenarioLite[]>(instance.bindings?.scenarios);
  const items = Array.isArray(res.value) ? res.value : [];

  return (
    <Surface accent={cfg.accent ?? "#8b5cf6"}>
      <WidgetTitle
        eyebrow={cfg.label ?? "Scenarios"}
        title={items.length === 0 ? "—" : `${items.length} paths`}
      />
      {items.length === 0 ? (
        <WidgetEmpty>No scenarios to compare.</WidgetEmpty>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((s, i) => (
            <div
              key={s.id ?? i}
              className={cn(
                "relative overflow-hidden rounded-xl border px-3 py-2.5",
                s.outcome === "good"
                  ? "border-emerald-200/70 bg-emerald-50/40"
                  : s.outcome === "bad"
                  ? "border-red-200/70 bg-red-50/40"
                  : "border-gray-200/70 bg-gray-50/40"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-[12.5px] font-semibold text-gray-800">
                  {s.title}
                </div>
                {typeof s.probability === "number" && (
                  <div className="text-[11px] font-semibold tracking-tight text-gray-500">
                    {Math.round(s.probability * 100)}%
                  </div>
                )}
              </div>
              {s.summary && (
                <div className="mt-1 line-clamp-2 text-[11.5px] text-gray-500">
                  {s.summary}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}

// ── recent_signals_banner ──────────────────────────────────────────────
//
// Surfaces the most recent entries from AppState.recent_signals at the top
// of an app. Sprint 3's agent write-back (appendAppSignal) writes here;
// this widget is how the user sees "your agent just noticed X."
//
// Displayed as a horizontally-scrolling strip of dismissible chips, showing
// the 3 most recent by default.

interface RecentSignalsBannerConfig {
  label?: string;
  max_visible?: number;
}

interface SignalLite {
  kind?: "alert" | "insight" | "opportunity" | "risk" | string | null;
  message?: string | null;
  at?: string | null;
}

export function RecentSignalsBanner({
  instance,
  context,
}: WidgetComponentProps<RecentSignalsBannerConfig>) {
  const cfg = instance.config ?? {};
  const maxVisible = cfg.max_visible ?? 3;
  const res = context.resolve<SignalLite[]>(instance.bindings?.signals);
  const allSignals = Array.isArray(res.value) ? res.value : [];

  // Show most recent first; filter out malformed entries.
  const signals = allSignals
    .filter((s): s is SignalLite => !!s && typeof s.message === "string")
    .slice(-maxVisible)
    .reverse();

  if (signals.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">
        {cfg.label ?? "Signals"}
      </span>
      {signals.map((s, i) => (
        <SignalChip key={`${s.at ?? ""}-${i}`} signal={s} />
      ))}
    </div>
  );
}

function SignalChip({ signal }: { signal: SignalLite }) {
  const palette: Record<string, { bg: string; fg: string; dot: string }> = {
    insight:      { bg: "rgba(0,122,255,0.10)",  fg: "#0A4A8F", dot: "#0A84FF" },
    opportunity:  { bg: "rgba(48,209,88,0.12)",  fg: "#1D7A3A", dot: "#30D158" },
    risk:         { bg: "rgba(255,69,58,0.12)",  fg: "#8a2a2a", dot: "#FF453A" },
    alert:        { bg: "rgba(255,149,0,0.14)",  fg: "#8A4A00", dot: "#FF9500" },
  };
  const kind = (signal.kind ?? "insight") as keyof typeof palette;
  const p = palette[kind] ?? palette.insight;
  const when = signal.at ? formatAt(signal.at) : null;

  return (
    <div
      className="flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[11.5px] font-medium backdrop-blur-md"
      style={{ background: p.bg, color: p.fg }}
    >
      <span
        className="h-[6px] w-[6px] shrink-0 rounded-full"
        style={{ background: p.dot, boxShadow: `0 0 6px ${p.dot}` }}
      />
      <span className="max-w-[320px] truncate">{signal.message}</span>
      {when ? (
        <span className="whitespace-nowrap opacity-60">· {when}</span>
      ) : null}
    </div>
  );
}
