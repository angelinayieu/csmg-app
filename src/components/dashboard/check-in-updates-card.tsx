"use client";

// ── Check-in Updates card ──────────────────────────────────────────────
//
// Left column of the dashboard CommandCenterRow. Per-app activity feed.
// Each app row shows app name, intervention progress, last activity.
// Click a row to expand inline detail within the card (no cross-card
// popover — avoids the overlap problem with the middle card and respects
// the user's "no awkward positioning" requirement).
//
// Data: /api/apps?spaceId=X. Polls every 12s while tab visible.

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import {
  ChevronRight,
  Inbox,
  Sparkles,
  Activity,
  Clock,
  ChevronDown,
  CheckCircle2,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReadyToShipMeter } from "@/components/strategy/ready-to-ship-meter";

interface StrategySummary {
  title: string;
  confidence: number;
  strategic_posture?: string;
  tactic_count: number;
  proposed_app_count: number;
  ranked_alternatives_count: number;
  provenance_score?: number;
  coverage_pct?: number;
  // Phase 0/1a readiness wiring — see /api/apps/route.ts for population.
  coherence_score?: number;
  coherence_issue_count?: number;
  coherence_critical_count?: number;
  open_questions_count?: number;
  degraded_steps?: string[];
  blind_spots?: string[];
  generated_at?: string;
  has_user_constraint?: boolean;
}

interface AppRow {
  id: string;
  name: string;
  description: string | null;
  app_type: string;
  status: string;
  intervention_count: number;
  interventions_completed: number;
  sub_space_name: string | null;
  sub_space_id: string | null;
  health_score: number | null;
  stale_reason: string | null;
  last_refreshed_at: string | null;
  updated_at: string;
  approval_state: "approved" | "pending" | "legacy";
}

interface Props {
  spaceId: string;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const POLL_MS = 12000;

export function CheckInUpdatesCard({ spaceId }: Props) {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [strategySummary, setStrategySummary] = useState<StrategySummary | null>(null);
  const [strategyStatus, setStrategyStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/apps?spaceId=${encodeURIComponent(spaceId)}`, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data: { apps?: AppRow[]; strategy_summary?: StrategySummary | null; strategy_status?: string | null }) => {
          if (cancelled) return;
          // Exclude retired apps; keep approved + pending + legacy active.
          const sorted = (data.apps ?? [])
            .filter((a) => a.status !== "retired")
            .sort((a, b) => {
              const ta = new Date(a.last_refreshed_at ?? a.updated_at).getTime();
              const tb = new Date(b.last_refreshed_at ?? b.updated_at).getTime();
              return tb - ta;
            });
          setApps(sorted);
          setStrategySummary(data.strategy_summary ?? null);
          setStrategyStatus(data.strategy_status ?? null);
          setError(null);
          setLoading(false);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setError(e.message);
          setLoading(false);
        });

    void load();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void load();
    }, POLL_MS);
    // Fix #3 (auto-refresh): also refresh when the tab becomes visible again
    // (user navigating back from /strategy after confirm) and when the window
    // regains focus. Covers the "just approved, nothing visible yet" gap.
    const visibilityHandler = () => {
      if (typeof document !== "undefined" && !document.hidden) void load();
    };
    const focusHandler = () => void load();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibilityHandler);
    if (typeof window !== "undefined") window.addEventListener("focus", focusHandler);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibilityHandler);
      if (typeof window !== "undefined") window.removeEventListener("focus", focusHandler);
    };
  }, [spaceId]);

  const visible = apps.slice(0, 6);

  return (
    <GlassCard variant="dashboard" className="flex flex-col h-[380px] p-5">
      <header className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-50 to-indigo-100 ring-1 ring-white">
            <Inbox className="h-3.5 w-3.5 text-indigo-600" />
          </span>
          <div>
            <h3 className="text-[13px] font-semibold text-gray-900 leading-tight">
              Check-in Updates
            </h3>
            <p className="text-[10.5px] text-gray-500 leading-tight">
              Per-app activity since last visit
            </p>
          </div>
        </div>
        {apps.length > 0 && (
          <span className="text-[10px] tabular-nums text-gray-500 bg-white/60 ring-1 ring-black/5 rounded-full px-2 py-0.5">
            {apps.length} {apps.length === 1 ? "app" : "apps"}
          </span>
        )}
      </header>

      <div className="flex-1 -mx-2 overflow-y-auto overscroll-contain">
        {loading && (
          <div className="px-2 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-11 rounded-lg bg-white/40 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && error && visible.length === 0 && (
          <div className="h-full grid place-items-center text-center px-4">
            <p className="text-[11px] text-red-600/80">
              Couldn&apos;t load apps. {error}
            </p>
          </div>
        )}

        {!loading && !error && visible.length === 0 && strategySummary && (strategyStatus === "generated" || strategyStatus === "reviewing") && (
          // ── Strategy-awaiting-approval state (Fix #1 of dashboard wiring) ──
          // A generated strategy exists but the user hasn't confirmed. Surface
          // the hidden state instead of the generic "No apps yet". Shows title,
          // confidence, tactic + app counts, provenance score, and a prominent
          // Review & Approve CTA.
          <div className="h-full flex flex-col px-3 py-3">
            <div className="rounded-xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/70 to-white shadow-[0_1px_3px_rgba(99,102,241,0.08)] p-3 flex-1 flex flex-col">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap className="h-3 w-3 text-indigo-500" />
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-indigo-600">
                  Strategy ready for review
                </span>
              </div>
              <div className="text-[12.5px] font-semibold text-gray-900 leading-snug line-clamp-2">
                {strategySummary.title}
              </div>

              {/* Composite readiness meter — replaces the single conf pill +
                  prov/cov footer. Shows confidence as one of FOUR weighted
                  factors so the user sees the whole epistemic posture, not
                  just an LLM-self-reported integer. Compact mode keeps it
                  inside the narrow card slot; the ring + sub-bars give the
                  full breakdown without needing the hover tooltip (which
                  would clip against the card's overflow-y-auto wrapper). */}
              <div className="mt-2">
                <ReadyToShipMeter
                  inputs={{
                    confidence: strategySummary.confidence,
                    coverage_pct: strategySummary.coverage_pct ?? null,
                    provenance_score: strategySummary.provenance_score ?? null,
                    coherence_score: strategySummary.coherence_score ?? null,
                  }}
                  compact
                  className="w-full"
                />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-600">
                {strategySummary.tactic_count > 0 && (
                  <span className="tabular-nums">
                    <span className="font-semibold text-gray-700">{strategySummary.tactic_count}</span> tactics
                  </span>
                )}
                {strategySummary.proposed_app_count > 0 && (
                  <span className="tabular-nums">
                    <span className="font-semibold text-gray-700">{strategySummary.proposed_app_count}</span> proposed apps
                  </span>
                )}
                {strategySummary.ranked_alternatives_count > 0 && (
                  <span className="tabular-nums">
                    +{strategySummary.ranked_alternatives_count} alt
                  </span>
                )}
              </div>

              {/* Honest-failure markers. The meter shows a number; these chips
                  explain WHY it might be lower than the user expects, without
                  forcing them into the drawer (Phase 2). Both are no-ops when
                  the strategy ran clean. */}
              {(strategySummary.coherence_critical_count || strategySummary.degraded_steps?.length) && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {strategySummary.coherence_critical_count ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 ring-1 ring-red-200 px-1.5 py-[1px] text-[9px] font-medium text-red-700">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {strategySummary.coherence_critical_count} critical
                    </span>
                  ) : null}
                  {strategySummary.degraded_steps?.length ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-amber-50 ring-1 ring-amber-200 px-1.5 py-[1px] text-[9px] font-medium text-amber-800"
                      title={`Pipeline steps that fell back: ${strategySummary.degraded_steps.join(", ")}`}
                    >
                      <AlertTriangle className="h-2.5 w-2.5" />
                      degraded
                    </span>
                  ) : null}
                </div>
              )}

              <div className="flex-1" />
              <Link
                href={`/app/space/${spaceId}/strategy`}
                className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1.5 text-[11px] font-semibold shadow-sm transition-colors"
              >
                <CheckCircle2 className="h-3 w-3" />
                Review &amp; Approve
                <ChevronRight className="h-3 w-3" />
              </Link>
              <p className="mt-1.5 text-[9.5px] text-gray-400 text-center leading-tight">
                Apps will materialize after you approve.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && visible.length === 0 && !(strategySummary && (strategyStatus === "generated" || strategyStatus === "reviewing")) && (
          // True empty state — no strategy exists yet
          <div className="h-full grid place-items-center text-center px-4">
            <div className="space-y-2">
              <Sparkles className="h-5 w-5 text-gray-300 mx-auto" />
              <p className="text-[11.5px] text-gray-500 max-w-[200px]">
                {strategyStatus === "confirmed"
                  ? "Strategy confirmed but no apps materialized yet. Check the strategy page to regenerate."
                  : "No apps yet. Generate a strategy to spawn your first apps."}
              </p>
              <Link
                href={`/app/space/${spaceId}/strategy`}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
              >
                Open Strategy
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <ul className="space-y-1 px-2">
            {visible.map((app) => (
              <CheckInRow
                key={app.id}
                app={app}
                spaceId={spaceId}
                isExpanded={expandedId === app.id}
                onToggle={() => setExpandedId((prev) => (prev === app.id ? null : app.id))}
              />
            ))}
          </ul>
        )}

        {!loading && apps.length > visible.length && (
          <div className="px-2 pt-1.5 text-[10px] text-gray-400 italic">
            +{apps.length - visible.length} more apps
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function CheckInRow({
  app,
  spaceId,
  isExpanded,
  onToggle,
}: {
  app: AppRow;
  spaceId: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const completedPct =
    app.intervention_count > 0
      ? Math.round((app.interventions_completed / app.intervention_count) * 100)
      : null;

  const href = `/app/space/${spaceId}/app/${app.id}`;

  return (
    <li className="rounded-lg ring-1 ring-transparent hover:ring-black/5 hover:bg-white/70 transition-colors">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-white/90 to-indigo-50 ring-1 ring-black/5 shrink-0">
          <Activity className="h-3 w-3 text-indigo-500" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium text-gray-800 truncate">
              {app.name}
            </span>
            {app.stale_reason && (
              <span className="text-[9px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-full px-1.5 py-[1px] shrink-0">
                stale
              </span>
            )}
            {app.approval_state === "pending" && (
              <span className="text-[9px] text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200 rounded-full px-1.5 py-[1px] shrink-0">
                pending
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10.5px] text-gray-500 leading-tight">
            {completedPct !== null && (
              <span className="tabular-nums">
                {app.interventions_completed}/{app.intervention_count} done
              </span>
            )}
            <span className="inline-flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {relTime(app.last_refreshed_at ?? app.updated_at)}
            </span>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-gray-300 transition-transform shrink-0",
            isExpanded && "rotate-180 text-gray-500",
          )}
        />
      </button>

      {/* Inline expand — no cross-card popover, no layout overflow. */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2.5 pt-0.5 space-y-2">
              {app.description && (
                <p className="text-[10.5px] text-gray-600 leading-snug">
                  {app.description}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                <dt className="text-gray-500">Type</dt>
                <dd className="text-gray-800 capitalize">{app.app_type}</dd>
                <dt className="text-gray-500">Status</dt>
                <dd className="text-gray-800 capitalize">{app.status}</dd>
                {typeof app.health_score === "number" && (
                  <>
                    <dt className="text-gray-500">Health</dt>
                    <dd className="text-gray-800 tabular-nums">
                      {Math.round(app.health_score)}/100
                    </dd>
                  </>
                )}
                {app.sub_space_name && (
                  <>
                    <dt className="text-gray-500">Whiteboard</dt>
                    <dd className="text-gray-800 truncate">{app.sub_space_name}</dd>
                  </>
                )}
                {app.stale_reason && (
                  <>
                    <dt className="text-amber-700">Stale</dt>
                    <dd className="text-amber-700 capitalize">
                      {app.stale_reason.replace(/_/g, " ")}
                    </dd>
                  </>
                )}
              </dl>
              <Link
                href={href}
                className="inline-flex items-center gap-1 text-[10.5px] font-medium text-indigo-600 hover:text-indigo-700"
              >
                Open app
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
