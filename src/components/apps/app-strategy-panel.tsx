"use client";

// ── App-strategy panel (Tier 3.5) ──────────────────────────────────────
//
// Visible surface for the per-app sub-strategy. Read-only in v1 (no
// inline editing) — shows what the sub-strategy says + the audit log of
// recent regenerations + a Regenerate button + (when applicable) a
// Promote-to-active control for drafts.
//
// Why visible at all (vs. just internally driving widget defaults):
//   - The sub-strategy is the app's "self-model." Users should see what
//     the system thinks the app is for.
//   - Drafts need surfacing — quality gate failures shouldn't be silent.
//   - Deviation-driven regens deserve a "what changed" view; the version
//     log gives the audit trail until the diff feature lands.
//
// Component scope: rendering only. State + actions live in the parent
// page (AppDetailPage) and are passed in as props — same pattern as
// AppRenderer.

import { useState } from "react";
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AppStrategy,
  AppStrategyVersionRow,
} from "@/types/app-strategy";

export interface AppStrategyPanelProps {
  strategy: AppStrategy | null;
  versions: AppStrategyVersionRow[];
  /** Auto-gen state — "Generating..." badge shown when no strategy yet but a request is in flight. */
  generating: boolean;
  /**
   * Tier 3.6: most recent generation failure to surface. Rendered inline
   * in the empty-state shell (or above the active spec when regen failed
   * but a prior active row is still visible). Null when no error.
   */
  lastError: string | null;
  /** Trigger reason is supplied by the caller — usually "Manual regeneration via panel". */
  onRegenerate: (triggerReason: string) => Promise<void>;
  /** Promote a draft sub-strategy to active. Only invoked when status === "draft". */
  onPromoteDraft: () => Promise<void>;
}

export function AppStrategyPanel(props: AppStrategyPanelProps) {
  const { strategy, versions, generating, lastError, onRegenerate, onPromoteDraft } = props;
  const [busyAction, setBusyAction] = useState<"regen" | "promote" | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const isDraft = strategy?.status === "draft";
  const errorIssues = (strategy?.quality?.issues ?? []).filter(
    (i) => i.severity === "error",
  );
  const warningIssues = (strategy?.quality?.issues ?? []).filter(
    (i) => i.severity === "warning",
  );

  const handleRegenerate = async () => {
    setBusyAction("regen");
    try {
      await onRegenerate("Manual regeneration via panel");
    } finally {
      setBusyAction(null);
    }
  };

  const handlePromote = async () => {
    setBusyAction("promote");
    try {
      await onPromoteDraft();
    } finally {
      setBusyAction(null);
    }
  };

  // ── Empty / generating shell ──
  // Renders when no sub-strategy exists yet. Either we're auto-generating
  // (show the spinning state) or the user can kick one off manually.
  // Tier 3.6: show lastError inline when a prior generation failed —
  // without this, auto-gen silently falls back to "No sub-strategy yet"
  // and the user thinks the button just didn't work.
  if (!strategy) {
    return (
      <div className="rounded-2xl border border-violet-200/60 bg-gradient-to-br from-violet-50/40 via-white/60 to-violet-50/30 px-5 py-4 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-violet-700/80">
              <Sparkles className="h-3 w-3" />
              App strategy
            </div>
            <div className="mt-1 text-[14px] font-semibold text-violet-900">
              {generating
                ? "Generating sub-strategy…"
                : lastError
                  ? "Generation failed"
                  : "No sub-strategy yet"}
            </div>
            <div className="mt-1 text-[12px] leading-snug text-violet-800/70">
              {generating
                ? "The model is producing a focused refinement of this app's parent strategy. Takes ~30-60s."
                : lastError
                  ? "The last attempt didn't complete. Try regenerating — LLM timeouts, rate limits, and JSON parse failures all land here."
                  : "Generate a focused spec describing what this app predicts, validates, simulates, and how its agents are tuned for this domain."}
            </div>
          </div>
          {generating ? (
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-violet-500" />
          ) : (
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={busyAction === "regen"}
              className="shrink-0 rounded-full bg-violet-600 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-40"
            >
              {busyAction === "regen" ? "Generating…" : lastError ? "Try again" : "Generate"}
            </button>
          )}
        </div>
        {/* Tier 3.6: inline error surface so failures aren't silent */}
        {lastError && !generating && (
          <div
            className="mt-3 rounded-lg border border-rose-200/70 bg-rose-50/40 px-3 py-2 text-[11.5px] text-rose-800"
            role="alert"
          >
            <span className="font-semibold">Error:</span>{" "}
            <span className="font-mono">{lastError}</span>
          </div>
        )}
      </div>
    );
  }

  // ── Active / draft summary ──
  const spec = strategy.spec;
  const focused = spec.focused_objective;
  const leadingIndicators = spec.learning_loop?.leading_indicators ?? [];
  const hypotheses = spec.validation_spec?.hypothesis_bank ?? [];
  const profiles = spec.simulation_spec?.perturbation_profiles ?? [];

  return (
    <div
      className={cn(
        "rounded-2xl border px-5 py-4 backdrop-blur-xl",
        isDraft
          ? "border-amber-200/70 bg-gradient-to-br from-amber-50/60 via-white/70 to-amber-50/30"
          : "border-violet-200/60 bg-gradient-to-br from-violet-50/40 via-white/60 to-violet-50/30",
      )}
    >
      {/* Tier 3.6: regen error banner — shown when a prior active row
          exists AND a regen attempt just failed. The active spec keeps
          rendering below so the user isn't left with nothing. */}
      {lastError && (
        <div
          className="mb-3 rounded-lg border border-rose-200/70 bg-rose-50/40 px-3 py-2 text-[11.5px] text-rose-800"
          role="alert"
        >
          <span className="font-semibold">Regeneration failed:</span>{" "}
          <span className="font-mono">{lastError}</span>{" "}
          <span className="text-rose-700/70">— current spec still active.</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]",
                isDraft ? "text-amber-700/80" : "text-violet-700/80",
              )}
            >
              <Sparkles className="h-3 w-3" />
              App strategy
            </span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]",
                isDraft
                  ? "bg-amber-100/80 text-amber-700"
                  : "bg-violet-100/80 text-violet-700",
              )}
            >
              v{strategy.version} · {strategy.status}
            </span>
            {strategy.last_deviation_trigger_at && (
              <span className="rounded-full bg-rose-100/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-rose-700">
                Deviation-triggered
              </span>
            )}
          </div>
          <div className="mt-1.5 truncate text-[15px] font-semibold tracking-tight text-gray-900">
            {focused?.metric ?? "(unspecified objective)"}
          </div>
          {focused?.rationale && (
            <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-gray-600">
              {focused.rationale}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={busyAction !== null}
            className="rounded-full border border-gray-200 bg-white/80 px-3 py-1 text-[11.5px] font-medium text-gray-700 hover:bg-white hover:border-gray-300 disabled:opacity-40"
          >
            {busyAction === "regen" ? "Regenerating…" : "Regenerate"}
          </button>
          {isDraft && (
            <button
              type="button"
              onClick={handlePromote}
              disabled={busyAction !== null || errorIssues.length > 0}
              className="rounded-full bg-amber-600 px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
              title={
                errorIssues.length > 0
                  ? "Resolve error-level issues before promoting"
                  : "Promote draft to active"
              }
            >
              {busyAction === "promote" ? "Promoting…" : "Promote to active"}
            </button>
          )}
        </div>
      </div>

      {/* Issues banner — only shown when issues exist */}
      {(errorIssues.length > 0 || warningIssues.length > 0) && (
        <div
          className={cn(
            "mt-3 rounded-lg border px-3 py-2 text-[11.5px]",
            errorIssues.length > 0
              ? "border-rose-200/70 bg-rose-50/40 text-rose-800"
              : "border-amber-200/60 bg-amber-50/40 text-amber-800",
          )}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3 w-3" />
            {errorIssues.length} {errorIssues.length === 1 ? "error" : "errors"}
            {warningIssues.length > 0 ? `, ${warningIssues.length} warning${warningIssues.length === 1 ? "" : "s"}` : ""}
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {[...errorIssues, ...warningIssues].slice(0, 4).map((i, idx) => (
              <li key={idx}>
                <span className="font-mono text-[10.5px] opacity-70">{i.field}</span>{" "}
                {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Spec preview — three compact rows */}
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SpecCell
          label="Predict"
          count={spec.prediction_spec?.metrics_to_track?.length ?? 0}
          itemNoun="metric"
          firstSummary={
            spec.prediction_spec?.metrics_to_track?.[0]?.label ?? null
          }
          subtitle={
            spec.prediction_spec
              ? `${spec.prediction_spec.default_horizon_days}d default · ${(spec.prediction_spec.default_confidence * 100).toFixed(0)}% conf`
              : null
          }
        />
        <SpecCell
          label="Validate"
          count={hypotheses.length}
          itemNoun="hypothesis"
          itemNounPlural="hypotheses"
          firstSummary={hypotheses[0]?.statement ?? null}
          subtitle={
            spec.validation_spec
              ? `${spec.validation_spec.experiment_horizon_days}d default horizon`
              : null
          }
        />
        <SpecCell
          label="Simulate"
          count={profiles.length}
          itemNoun="profile"
          firstSummary={profiles[0]?.label ?? null}
          subtitle={
            profiles.length > 0
              ? `${profiles.reduce((sum, p) => sum + p.perturbations.length, 0)} perturbations`
              : null
          }
        />
      </div>

      {/* Leading indicators — only shown when present */}
      {leadingIndicators.length > 0 && (
        <div className="mt-3 rounded-lg border border-gray-200/70 bg-white/50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
            Leading indicators
          </div>
          <ul className="mt-1 space-y-0.5 text-[11.5px]">
            {leadingIndicators.slice(0, 3).map((li, i) => (
              <li key={i} className="flex items-start gap-2 text-gray-700">
                <span className="font-medium text-gray-900">{li.metric_label}</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-500 truncate">
                  green: {li.green_reading}
                </span>
                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-[0.06em] text-gray-400">
                  {li.cadence}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Audit trail — collapsed by default */}
      {versions.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setAuditOpen((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700"
          >
            {auditOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Audit log · {versions.length} {versions.length === 1 ? "entry" : "entries"}
          </button>
          {auditOpen && (
            <ul className="mt-1.5 space-y-1 border-l border-gray-200 pl-3 text-[11px]">
              {versions.slice(0, 8).map((v) => {
                // Tier 7 (Gap #3): pull the structured diff out of the
                // version row's `diff` JSONB so the audit log can show
                // "no-op" regenerations in amber + list the specific
                // changes when the regen actually adapted something.
                // The generator persists this as { kind, is_noop, changes[], superseded? }.
                const diffRec = (v.diff ?? {}) as Record<string, unknown>;
                const diffChanges = Array.isArray(diffRec.changes)
                  ? (diffRec.changes as string[])
                  : [];
                const diffIsNoop = diffRec.is_noop === true;
                return (
                  <li key={v.id} className="flex items-start gap-2">
                    <Clock className="mt-0.5 h-2.5 w-2.5 shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <div className="text-gray-700">
                        <span className="font-mono text-[10px] uppercase text-gray-500">
                          {v.change_type}
                        </span>{" "}
                        {v.change_summary}
                        {diffIsNoop && (
                          <span className="ml-1.5 rounded-full bg-amber-100/80 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-amber-800">
                            no-op
                          </span>
                        )}
                      </div>
                      {/* Show the structured change list when the regen
                          actually modified something. Capped at 4 to
                          keep the audit list compact. */}
                      {!diffIsNoop && diffChanges.length > 0 && (
                        <ul className="mt-0.5 list-disc space-y-0.5 pl-3.5 text-[10.5px] text-gray-500">
                          {diffChanges.slice(0, 4).map((c, idx) => (
                            <li key={idx}>{c}</li>
                          ))}
                          {diffChanges.length > 4 && (
                            <li className="italic text-gray-400">
                              +{diffChanges.length - 4} more
                            </li>
                          )}
                        </ul>
                      )}
                      <div className="text-[10px] text-gray-400">
                        {new Date(v.changed_at).toLocaleString()} · {v.changed_by}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Confidence + completeness footer */}
      <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2 text-[10.5px] text-gray-500">
        <span>
          Confidence{" "}
          <span className="font-semibold text-gray-700">
            {((strategy.quality?.confidence ?? 0) * 100).toFixed(0)}%
          </span>
        </span>
        <span className="flex items-center gap-1">
          {strategy.quality?.is_complete ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              Complete
            </>
          ) : (
            <>
              <AlertTriangle className="h-3 w-3 text-amber-500" />
              Partial
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// ── Sub-component: Spec section preview ────────────────────────────────

interface SpecCellProps {
  label: string;
  count: number;
  itemNoun: string;
  itemNounPlural?: string;
  firstSummary: string | null;
  subtitle: string | null;
}

function SpecCell({
  label,
  count,
  itemNoun,
  itemNounPlural,
  firstSummary,
  subtitle,
}: SpecCellProps) {
  const noun = count === 1 ? itemNoun : (itemNounPlural ?? `${itemNoun}s`);
  return (
    <div className="rounded-lg border border-gray-200/70 bg-white/50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
        {label}
      </div>
      <div className="mt-0.5 text-[12.5px] font-semibold text-gray-900">
        {count} {noun}
      </div>
      {firstSummary && (
        <div className="mt-0.5 line-clamp-1 text-[11px] text-gray-500">
          {firstSummary}
        </div>
      )}
      {subtitle && (
        <div className="mt-0.5 text-[10px] text-gray-400">{subtitle}</div>
      )}
    </div>
  );
}
