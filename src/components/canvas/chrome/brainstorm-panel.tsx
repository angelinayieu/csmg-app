"use client";

// ── BrainstormPanel (Phase 2D) ──
//
// Right-rail AI partner panel. Six toggleable features + preset
// quick-switch + master enable. Slides in from the right when
// opened via the BrainstormToggleButton. Glass-primitive styled to
// match the rest of the design system.
//
// Each toggle row shows:
//   - Icon + name
//   - One-line description
//   - Toggle switch
//   - Status badge (active / coming soon / needs Sources)
//
// When the master switch is off, individual toggles are disabled
// visually (not mutated) so the user's preferences persist across
// pauses. Flipping master on re-activates everything in its last
// stored state.

import React, { useState } from "react";
import {
  Sparkles,
  Zap,
  Search,
  ArrowUpRight,
  Clock,
  Layers,
  Download,
  X,
  RotateCw,
  Brain,
  Globe,
  Target,
  Link2,
  HelpCircle,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassPanel } from "@/components/ui/glass-panel";
import { AccentChip } from "@/components/ui/accent-chip";
import type { UseBrainstormSettings } from "@/lib/brainstorm/use-brainstorm-settings";
import {
  PRESETS,
  TOGGLE_STATUS,
  type BrainstormSettings,
  type ToggleStatus,
  type MemorySettings,
} from "@/lib/brainstorm/brainstorm-settings";
import type { HudRailContext, HudRailEntity } from "./canvas-hud-rail";

export interface BrainstormPanelProps {
  open: boolean;
  onClose: () => void;
  settings: UseBrainstormSettings;
  /** Live ambient context from the selected sticky / entity. When set,
   *  an "Active context" section renders at the top of the panel before
   *  the settings — keeping everything in one place. */
  hudCtx?: HudRailContext;
  onDecompose?: () => void;
  onJumpToEntity?: (e: HudRailEntity) => void;
  onAppendQuestion?: (q: string) => void;
  /** Open the deep-dive panel for the given question instead of appending it. */
  onDeepDive?: (q: string) => void;
}

const ACCENT = "#8B5CF6"; // Brainstorm's signature violet.

export function BrainstormPanel({
  open,
  onClose,
  settings: ctl,
  hudCtx,
  onDecompose,
  onJumpToEntity,
  onAppendQuestion,
  onDeepDive,
}: BrainstormPanelProps) {
  const { settings, update, applyPreset, activePresetId, resetToDefaults } =
    ctl;

  // Settings section collapses when ambient context is active so the
  // user's current context gets prime real estate at the top.
  const [settingsExpanded, setSettingsExpanded] = useState(!hudCtx?.activeShape && !hudCtx?.selectedEntity);

  const hasAmbient =
    !!hudCtx &&
    (hudCtx.activeShape ||
      hudCtx.selectedEntity ||
      hudCtx.relatedEntities.length > 0 ||
      hudCtx.suggestedQuestions.length > 0);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto absolute right-4 z-30"
      style={{
        top: 72,
        maxHeight: "calc(100vh - 88px)",
      }}
    >
      <GlassPanel
        tier="float"
        radius={16}
        accent={settings.enabled ? ACCENT : null}
        className="flex w-[320px] flex-col overflow-hidden"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--glass-hairline)" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
              style={{
                background: settings.enabled
                  ? `color-mix(in srgb, ${ACCENT} 18%, transparent)`
                  : "rgba(15,23,42,0.05)",
              }}
            >
              <Sparkles
                className={cn(
                  "h-3.5 w-3.5 transition-colors",
                  settings.enabled && "animate-pulse",
                )}
                style={{ color: settings.enabled ? ACCENT : "#64748b" }}
                strokeWidth={1.75}
              />
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-900">
                AI Companion
              </div>
              <div className="text-[10px] font-medium text-gray-500">
                {hudCtx?.loading
                  ? "Thinking…"
                  : hasAmbient
                    ? "Context active"
                    : settings.enabled
                      ? "Partner active"
                      : "Partner paused"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <MasterSwitch
              checked={settings.enabled}
              onChange={(v) => update({ enabled: v })}
              accent={ACCENT}
            />
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="Close"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* ── Ambient context section (top, always visible when active) ── */}
        {hasAmbient && (
          <div
            className="flex flex-col gap-2 overflow-y-auto px-3 py-3"
            style={{
              maxHeight: settingsExpanded ? "45vh" : "65vh",
              borderBottom: "1px solid var(--glass-hairline)",
            }}
          >
            {/* Active sticky preview */}
            {hudCtx!.activeShape && (
              <AmbientSection
                icon={<Sparkles className="h-3 w-3" />}
                label="Active sticky"
                accent="from-blue-50 to-purple-50"
              >
                <div className="rounded-lg bg-white px-3 py-2 text-[12px] font-medium text-gray-800 shadow-sm">
                  {hudCtx!.activeShape.props.text || (
                    <span className="italic text-gray-400">Empty…</span>
                  )}
                </div>
                {hudCtx!.canDecompose && (
                  <button
                    onClick={onDecompose}
                    disabled={hudCtx!.loading}
                    className={cn(
                      "mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-[11.5px] font-semibold text-white shadow-sm transition-colors hover:bg-blue-700",
                      hudCtx!.loading && "opacity-60",
                    )}
                  >
                    <Zap className="h-3 w-3" />
                    Decompose into nodes
                  </button>
                )}
              </AmbientSection>
            )}

            {/* Related entities */}
            {hudCtx!.relatedEntities.length > 0 && (
              <AmbientSection
                icon={<Link2 className="h-3 w-3" />}
                label={`${hudCtx!.relatedEntities.length} related in KG`}
                accent="from-emerald-50 to-teal-50"
              >
                <ul className="flex flex-col gap-1">
                  {hudCtx!.relatedEntities.slice(0, 5).map((entity) => (
                    <li key={entity.id}>
                      <button
                        onClick={() => onJumpToEntity?.(entity)}
                        className="group flex w-full items-center gap-2 rounded-lg bg-white px-3 py-2 text-left shadow-sm transition-shadow hover:shadow"
                      >
                        <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11.5px] font-semibold text-gray-900">
                            {entity.name}
                          </div>
                          {entity.space_name && (
                            <div className="truncate text-[9.5px] text-gray-400">
                              {entity.space_name}
                            </div>
                          )}
                        </div>
                        <ChevronRight className="h-3 w-3 flex-shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500" />
                      </button>
                    </li>
                  ))}
                </ul>
              </AmbientSection>
            )}

            {/* Probe questions */}
            {hudCtx!.suggestedQuestions.length > 0 && (
              <AmbientSection
                icon={<HelpCircle className="h-3 w-3" />}
                label="Probe further"
                accent="from-amber-50 to-orange-50"
              >
                <ul className="flex flex-col gap-1">
                  {hudCtx!.suggestedQuestions.slice(0, 4).map((q, i) => (
                    <li key={i}>
                      <button
                        onClick={() =>
                          onDeepDive ? onDeepDive(q) : onAppendQuestion?.(q)
                        }
                        className="w-full rounded-lg bg-white px-3 py-2 text-left text-[11.5px] text-gray-700 shadow-sm transition-all hover:bg-violet-50/50 hover:shadow hover:text-gray-900"
                        title="Click to deep-dive this question"
                      >
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </AmbientSection>
            )}
          </div>
        )}

        {/* ── Settings section (collapsible) ─────────────────────────── */}
        {/* Collapse toggle row — only shows when ambient content is present */}
        {hasAmbient && (
          <button
            onClick={() => setSettingsExpanded((v) => !v)}
            className="flex items-center justify-between px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-3 w-3" />
              AI settings
            </div>
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform",
                settingsExpanded && "rotate-90",
              )}
            />
          </button>
        )}

        {settingsExpanded && (
        <div
          className={cn(
            "flex flex-col gap-3 overflow-y-auto px-3 py-3 transition-opacity",
            !settings.enabled && "opacity-50",
          )}
        >
          {/* Presets */}
          <div className="flex flex-col gap-1.5">
            <div className="px-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-gray-400">
              Presets
            </div>
            <div className="flex gap-1.5">
              {PRESETS.map((p) => {
                const active = activePresetId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.id)}
                    disabled={!settings.enabled}
                    title={p.description}
                    className={cn(
                      "flex-1 rounded-lg border px-2 py-1.5 text-[10.5px] font-semibold transition-all",
                      active
                        ? "text-white"
                        : "border-gray-200 bg-white/60 text-gray-600 hover:bg-white",
                      !settings.enabled && "cursor-not-allowed",
                    )}
                    style={
                      active
                        ? {
                            background: ACCENT,
                            borderColor: ACCENT,
                          }
                        : undefined
                    }
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-1">
            <div className="px-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-gray-400">
              Features
            </div>

            <ToggleRow
              icon={Zap}
              accent={ACCENT}
              label="Auto-connect"
              description="Pair-scan each new sticky against existing ones."
              status={TOGGLE_STATUS.autoConnect}
              value={settings.autoConnect}
              onChange={(v) => update({ autoConnect: v })}
              disabled={!settings.enabled}
            />

            <ToggleRow
              icon={Search}
              accent={ACCENT}
              label="Deep search"
              description="Background research on sticky content."
              status={TOGGLE_STATUS.deepSearch}
              value={settings.deepSearch}
              onChange={(v) => update({ deepSearch: v })}
              disabled={!settings.enabled}
            />

            <ToggleRow
              icon={ArrowUpRight}
              accent={ACCENT}
              label="Manual connect"
              description="Draw arrows; AI labels edges on release."
              status={TOGGLE_STATUS.manualConnect}
              value={settings.manualConnect}
              onChange={(v) => update({ manualConnect: v })}
              disabled={!settings.enabled}
            />

            <ToggleRow
              icon={Clock}
              accent={ACCENT}
              label="Scheduled scan"
              description={`Batch scan every ${settings.scheduledConnectIntervalMin} min.`}
              status={TOGGLE_STATUS.scheduledConnect}
              value={settings.scheduledConnect}
              onChange={(v) => update({ scheduledConnect: v })}
              disabled={!settings.enabled}
              extra={
                settings.scheduledConnect ? (
                  <IntervalField
                    value={settings.scheduledConnectIntervalMin}
                    onChange={(n) =>
                      update({ scheduledConnectIntervalMin: n })
                    }
                    disabled={!settings.enabled}
                  />
                ) : null
              }
            />

            <ToggleRow
              icon={Layers}
              accent={ACCENT}
              label="Cluster to canvas"
              description="Auto-group nearby stickies, materialize as KG."
              status={TOGGLE_STATUS.clusterToCanvas}
              value={settings.clusterToCanvas}
              onChange={(v) => update({ clusterToCanvas: v })}
              disabled={!settings.enabled}
            />

            <ToggleRow
              icon={Download}
              accent={ACCENT}
              label="Cluster from notes"
              description="Ingest items from connected Source folders."
              status={TOGGLE_STATUS.clusterFromNotes}
              value={settings.clusterFromNotes}
              onChange={(v) => update({ clusterFromNotes: v })}
              disabled={!settings.enabled}
            />
          </div>

          {/* Memory & Context */}
          <MemorySection
            memory={settings.memory}
            onChange={(patch) => update({ memory: { ...settings.memory, ...patch } })}
            disabled={!settings.enabled}
            accent={ACCENT}
          />
        </div>
        )}

        {/* Footer — reset + activity hint */}
        <div
          className="flex items-center justify-between px-3 py-2.5"
          style={{ borderTop: "1px solid var(--glass-hairline)" }}
        >
          <button
            onClick={resetToDefaults}
            disabled={!settings.enabled}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCw className="h-2.5 w-2.5" />
            Reset
          </button>
          <span className="text-[9.5px] font-medium text-gray-400">
            settings saved per space
          </span>
        </div>
      </GlassPanel>
    </div>
  );
}

// ── Ambient section atom ───────────────────────────────────────────

function AmbientSection({
  icon,
  label,
  accent,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <div
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-md bg-gradient-to-br text-gray-600",
            accent,
          )}
        >
          {icon}
        </div>
        <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-gray-500">
          {label}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

// ── Atoms ──────────────────────────────────────────────────────────

function MasterSwitch({
  checked,
  onChange,
  accent,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  accent: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 rounded-full transition-all",
        checked ? "" : "bg-gray-200",
      )}
      style={
        checked
          ? { background: accent, boxShadow: `0 0 8px ${accent}66` }
          : undefined
      }
      title={checked ? "Pause brainstorm mode" : "Enable brainstorm mode"}
    >
      <span
        className="absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow-sm transition-all"
        style={{
          left: checked ? "calc(100% - 18px)" : "2px",
        }}
      />
    </button>
  );
}

function ToggleRow({
  icon: Icon,
  accent,
  label,
  description,
  status,
  value,
  onChange,
  disabled,
  extra,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  accent: string;
  label: string;
  description: string;
  status: ToggleStatus;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  extra?: React.ReactNode;
}) {
  const effectivelyOn = value && !disabled;
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg px-2 py-2 transition-colors",
        effectivelyOn && "bg-violet-50/50",
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors"
          style={{
            background: effectivelyOn
              ? `color-mix(in srgb, ${accent} 16%, transparent)`
              : "rgba(15,23,42,0.04)",
          }}
        >
          <Icon
            className="h-3 w-3"
            strokeWidth={1.75}
            // inline style so we can adapt color
            {...({
              style: { color: effectivelyOn ? accent : "#64748b" },
            } as { style: React.CSSProperties })}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "text-[11.5px] font-semibold",
                effectivelyOn ? "text-gray-900" : "text-gray-700",
              )}
            >
              {label}
            </span>
            <StatusBadge status={status} />
          </div>
          <div className="line-clamp-2 text-[10px] font-light leading-snug text-gray-500">
            {description}
          </div>
        </div>
        <RowSwitch
          checked={value}
          onChange={onChange}
          disabled={disabled}
          accent={accent}
        />
      </div>
      {extra && <div className="ml-8 mt-1">{extra}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: ToggleStatus }) {
  if (status === "active") {
    return (
      <AccentChip accent="#16a34a" size="xs" variant="soft">
        Live
      </AccentChip>
    );
  }
  if (status === "coming_soon") {
    return (
      <AccentChip accent="#64748b" size="xs" variant="ghost">
        Soon
      </AccentChip>
    );
  }
  return (
    <AccentChip accent="#64748b" size="xs" variant="ghost">
      Needs Sources
    </AccentChip>
  );
}

// ── Memory & Context Section ───────────────────────────────────────

function MemorySection({
  memory,
  onChange,
  disabled,
  accent,
}: {
  memory: MemorySettings;
  onChange: (patch: Partial<MemorySettings>) => void;
  disabled: boolean;
  accent: string;
}) {
  const effectivelyOn = memory.enabled && !disabled;

  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-gray-400">
        Memory &amp; Context
      </div>

      {/* Master memory toggle */}
      <div
        className={cn(
          "flex flex-col gap-2 rounded-lg px-2 py-2 transition-colors",
          effectivelyOn && "bg-indigo-50/50",
        )}
      >
        <div className="flex items-start gap-2">
          <div
            className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors"
            style={{
              background: effectivelyOn
                ? "color-mix(in srgb, #6366f1 16%, transparent)"
                : "rgba(15,23,42,0.04)",
            }}
          >
            <Brain
              className="h-3 w-3"
              strokeWidth={1.75}
              style={{ color: effectivelyOn ? "#6366f1" : "#64748b" }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className={cn("text-[11.5px] font-semibold", effectivelyOn ? "text-gray-900" : "text-gray-700")}>
                Draw on past work
              </span>
              {effectivelyOn && (
                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-600">
                  Active
                </span>
              )}
            </div>
            <div className="text-[10px] font-light leading-snug text-gray-500">
              Retrieve relevant context from previous spaces before analysing.
            </div>
          </div>
          <RowSwitch
            checked={memory.enabled}
            onChange={(v) => onChange({ enabled: v })}
            disabled={disabled}
            accent="#6366f1"
          />
        </div>

        {/* Expanded settings when memory is on */}
        {effectivelyOn && (
          <div className="ml-8 flex flex-col gap-2">
            {/* Scope */}
            <div className="flex flex-col gap-1">
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">
                Scope
              </div>
              <div className="flex gap-1">
                {(["this_space", "all_spaces"] as const).map((s) => {
                  const active = memory.scope === s;
                  return (
                    <button
                      key={s}
                      onClick={() => onChange({ scope: s })}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-all",
                        active
                          ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                          : "border-gray-200 bg-white/60 text-gray-500 hover:bg-white",
                      )}
                    >
                      {s === "all_spaces" ? (
                        <Globe className="h-2.5 w-2.5" strokeWidth={1.75} />
                      ) : (
                        <Target className="h-2.5 w-2.5" strokeWidth={1.75} />
                      )}
                      {s === "all_spaces" ? "All spaces" : "This space"}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sources */}
            <div className="flex flex-col gap-1">
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">
                Sources
              </div>
              <div className="flex flex-col gap-0.5">
                {(
                  [
                    { key: "priorDecompositions", label: "Prior analyses" },
                    { key: "synthesisInsights", label: "Synthesis insights" },
                    { key: "journalHistory", label: "Journal entries" },
                    { key: "objectives", label: "Objectives" },
                  ] as const
                ).map(({ key, label }) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-indigo-50/50"
                  >
                    <input
                      type="checkbox"
                      checked={memory.sources[key]}
                      onChange={(e) =>
                        onChange({
                          sources: { ...memory.sources, [key]: e.target.checked },
                        })
                      }
                      className="h-3 w-3 rounded accent-indigo-500"
                    />
                    <span className="text-[10px] font-medium text-gray-600">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Context limit */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9.5px] font-medium text-gray-500">
                Max items
              </span>
              <div className="flex items-center gap-1">
                {[5, 10, 20].map((n) => (
                  <button
                    key={n}
                    onClick={() => onChange({ maxContextItems: n })}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all",
                      memory.maxContextItems === n
                        ? "bg-indigo-500 text-white"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RowSwitch({
  checked,
  onChange,
  disabled,
  accent,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  accent: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        "relative mt-1 h-4 w-7 flex-shrink-0 rounded-full transition-all",
        checked && !disabled ? "" : "bg-gray-200",
        disabled && "cursor-not-allowed opacity-40",
      )}
      style={
        checked && !disabled ? { background: accent } : undefined
      }
    >
      <span
        className="absolute top-0.5 block h-3 w-3 rounded-full bg-white shadow-sm transition-all"
        style={{ left: checked ? "calc(100% - 14px)" : "2px" }}
      />
    </button>
  );
}

function IntervalField({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
      <span className="font-semibold uppercase tracking-wider text-gray-400">
        Interval
      </span>
      <input
        type="number"
        min={5}
        max={120}
        step={5}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 5 && n <= 120) onChange(n);
        }}
        disabled={disabled}
        className="w-12 rounded-md border border-gray-200 bg-white/70 px-1.5 py-0.5 text-center font-mono text-[10.5px] text-gray-700 focus:border-violet-400 focus:outline-none disabled:opacity-50"
      />
      <span>min</span>
    </div>
  );
}

// ── Derived helper ────────────────────────────────────────────────
//
// Useful for consumers that want to check whether any feature is
// currently having an effect (to e.g. show a live indicator on the
// toggle button).
export function hasAnyActiveFeature(s: BrainstormSettings): boolean {
  if (!s.enabled) return false;
  return (
    s.autoConnect ||
    s.deepSearch ||
    s.manualConnect ||
    s.scheduledConnect ||
    s.clusterToCanvas ||
    s.clusterFromNotes
  );
}
