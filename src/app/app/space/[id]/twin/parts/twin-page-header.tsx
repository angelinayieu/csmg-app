"use client";

// ── Twin Page Header ────────────────────────────────────────────────
//
// Top of the Twin Detail Page. Three rows:
//
//   1. Back link + space name + Actions dropdown + Canvas link
//   2. Dual-metric line (health · pain reduction · entity count)
//   3. Tab bar (Overview · System · Outcomes · Operating)
//
// Pain reduction % is derived from bundle.pain_metrics — average of
// (baseline - current) / (baseline - target) clamped 0-1, expressed
// as a percentage. When direction === "maximize" the formula flips.
//
// Apple-minimalist. Custom twin icons (no emojis). Restraint.

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, MoveUpRight } from "lucide-react";
import {
  TwinIcon,
  PainReductionIcon,
  SnapshotIcon,
  PredictionIcon,
  ObservationIcon,
  VisualizationAppIcon,
} from "@/components/twin/icons/twin-icons";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";
import type { TwinTabKey } from "../twin-detail-client";

interface Props {
  spaceId: string;
  bundle: TwinPageBundle;
  activeTab: TwinTabKey;
  onTabChange: (next: TwinTabKey) => void;
  cached: boolean;
  cachedAt: string | null;
}

const TABS: { key: TwinTabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "system", label: "System" },
  { key: "outcomes", label: "Outcomes" },
  { key: "operating", label: "Operating" },
];

export function TwinPageHeader({
  spaceId,
  bundle,
  activeTab,
  onTabChange,
  cached: _cached,
  cachedAt: _cachedAt,
}: Props) {
  void _cached;
  void _cachedAt;

  const painReductionPct = useMemo(
    () => computePainReductionPct(bundle.pain_metrics),
    [bundle.pain_metrics],
  );

  const entityCount = bundle.twin_macro.coverage.entities_modeled;
  const operatingEnabled = bundle.space_metadata.has_active_labs;

  return (
    <header className="px-8 pt-7">
      {/* Row 1: navigation + actions */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/app/space/${spaceId}`}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-600 transition hover:text-gray-900"
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={1.75} />
          Back to space
        </Link>
        <div className="flex items-center gap-2">
          <TwinActionsMenu spaceId={spaceId} />
          <Link
            href={`/app/space/${spaceId}/whiteboard`}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:text-gray-900"
            style={{
              background: "var(--glass-card-bg)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <MoveUpRight className="h-3 w-3" strokeWidth={1.75} />
            Canvas
          </Link>
        </div>
      </div>

      {/* Row 2: title + dual-metric */}
      <div className="mt-5">
        <h1 className="font-display-tight text-[32px] font-semibold leading-[1.1] tracking-tight text-gray-900">
          {bundle.space_metadata.name}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <TwinIcon size={13} />
            health {bundle.twin_macro.health_score}
          </span>
          <span className="text-gray-300">·</span>
          <span className="inline-flex items-center gap-1.5">
            <PainReductionIcon size={13} />
            pain {painReductionPct === null ? "—" : `↓ ${painReductionPct}%`}
          </span>
          <span className="text-gray-300">·</span>
          <span>{entityCount} entities</span>
          {bundle.space_metadata.maturity && (
            <>
              <span className="text-gray-300">·</span>
              <span className="capitalize">
                {bundle.space_metadata.maturity.replace(/_/g, " ")}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Row 3: tab bar */}
      <div className="mt-6 border-b" style={{ borderColor: "var(--glass-hairline)" }}>
        <nav className="flex items-center gap-1">
          {TABS.map((tab) => {
            const disabled = tab.key === "operating" && !operatingEnabled;
            const active = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                onClick={() => !disabled && onTabChange(tab.key)}
                disabled={disabled}
                className={[
                  "relative px-3 py-2.5 text-[13px] font-medium transition-colors",
                  active
                    ? "text-gray-900"
                    : disabled
                      ? "cursor-not-allowed text-gray-300"
                      : "text-gray-500 hover:text-gray-900",
                ].join(" ")}
                title={
                  disabled
                    ? "Operating activates once you approve a strategy and labs start running"
                    : undefined
                }
              >
                {tab.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gray-900"
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

// ── Actions dropdown ───────────────────────────────────────────────

function TwinActionsMenu({ spaceId: _spaceId }: { spaceId: string }) {
  void _spaceId;
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:text-gray-900"
        style={{
          background: "var(--glass-card-bg)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        Actions
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl"
          style={{
            background: "var(--glass-float-bg)",
            boxShadow: "var(--shadow-float)",
            backdropFilter: "blur(var(--blur-float))",
            WebkitBackdropFilter: "blur(var(--blur-float))",
          }}
        >
          <ul className="py-1">
            <ActionMenuItem
              icon={<SnapshotIcon size={14} />}
              title="Capture snapshot"
              hint="Freeze current state for comparison"
              disabled
            />
            <ActionMenuItem
              icon={<PredictionIcon size={14} />}
              title="Run prediction"
              hint="Fresh p10/p50/p90 against goal"
              disabled
            />
            <ActionMenuItem
              icon={<ObservationIcon size={14} />}
              title="Log observation"
              hint="Coming in Phase 2"
              disabled
            />
            <ActionMenuItem
              icon={<VisualizationAppIcon size={14} />}
              title="Build visualization app"
              hint="Coming in Phase 2"
              disabled
            />
          </ul>
        </div>
      )}
    </div>
  );
}

function ActionMenuItem({
  icon,
  title,
  hint,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <li>
      <button
        disabled={disabled}
        onClick={onClick}
        className={[
          "flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition",
          disabled
            ? "cursor-not-allowed opacity-50"
            : "hover:bg-black/[0.025]",
        ].join(" ")}
      >
        <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-gray-600">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-gray-900">{title}</div>
          <div className="text-[10.5px] text-gray-500">{hint}</div>
        </div>
      </button>
    </li>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

/** Compute the average pain-reduction percentage across all pain
 *  metrics. Returns null if there are none. Handles both "minimize"
 *  and "maximize" direction. */
function computePainReductionPct(
  metrics: TwinPageBundle["pain_metrics"],
): number | null {
  if (metrics.length === 0) return null;
  let total = 0;
  let count = 0;
  for (const m of metrics) {
    const baseline = m.baseline_value;
    const target = m.target_value;
    const current = m.current_value;
    const span = target - baseline; // signed
    if (span === 0) continue;
    let progress = (current - baseline) / span;
    progress = Math.max(0, Math.min(1, progress));
    total += progress;
    count++;
  }
  if (count === 0) return null;
  return Math.round((total / count) * 100);
}
