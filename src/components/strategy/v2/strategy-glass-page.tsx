"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Trophy, Zap, RefreshCw, AlertTriangle, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useStrategyViewModel } from "@/lib/hooks/use-strategy-view-model";
import { useCausalChainsActions } from "@/lib/hooks/use-causal-chains-actions";
import { useSpaceData } from "@/contexts/space-data-context";
import { useHotkey } from "@/lib/hooks/use-hotkey";
import { StrategyHeroGlass } from "./hero/strategy-hero-glass";
import { TwinProposalReviewPanel } from "@/components/strategy/twin-proposal-review-panel";
import { CascadeSection } from "./cascade/cascade-section";
import { InfrastructureSection } from "./infrastructure/infrastructure-section";
import { TrackersPanel } from "./trackers/trackers-panel";
import { ConvergenceBridge } from "./bridge/convergence-bridge";
import { VariantsSection } from "./variants/variants-section";
import { EvidenceStrip } from "./evidence/evidence-strip";
import { WhiteboardView } from "./whiteboard/whiteboard-view";
import { DeliverablesView } from "./deliverables/deliverables-view";
import { StrategySwimlane } from "./strategy-swimlane";
import { ObjectiveRollupPanel } from "./deliverables/objective-rollup-panel";
import { SpacePulseCard } from "./deliverables/space-pulse-card";
import { ChangeProposalsBanner } from "@/components/strategy/change-proposals-banner";
import { ChangeProposalsPanel } from "@/components/strategy/change-proposals-panel";
import { StrategyVersionHistory } from "@/components/strategy/strategy-version-history";
import { PinnedSynthesesSection } from "./pinned-syntheses-section";
import { LeaderboardSection } from "./leaderboard-section";
import { useRouter } from "next/navigation";
import type { ViewKind } from "./view-kind";
import type { Entity } from "@/types";
import type {
  SpaceRollupResponse,
  ObjectiveRollup,
} from "@/app/api/spaces/[id]/rollup/route";
import type { BatchSubstrategiesResponse } from "@/app/api/spaces/[id]/substrategies/batch/route";

export function StrategyGlassPage() {
  const ctx = useSpaceData();
  const router = useRouter();

  // Tier 2.5: track which strategy_batch entry the user is viewing.
  // Defaults to 0 (primary). Switching is local state — no server round
  // trip — because the view model already has all entries in hand from
  // synthesis_data.strategy_batch.
  const [currentEntryIndex, setCurrentEntryIndex] = useState(0);

  // Arc 3 Phase 2: change-proposals banner expansion. Closed by default
  // so the page doesn't push everything down on load; clicking the banner
  // reveals the full review panel inline. Auto-collapses after the last
  // proposal is resolved.
  const [changeProposalsExpanded, setChangeProposalsExpanded] = useState(false);

  const {
    vm, synthData, recommendation, flags, actions, strategyData, chainsStaleness, lastConfirm,
    batch, entries, currentEntry,
  } = useStrategyViewModel({ currentEntryIndex });

  // Reset switcher to 0 when the batch_id changes (new refresh produced
  // a different entry set; the index from the prior batch may not align).
  useEffect(() => {
    setCurrentEntryIndex(0);
  }, [batch?.batch_id]);

  // ── Tier 4: cross-app rollup fetch ─────────────────────────────────
  // Loads once per space after approval. Re-fetched when the user pivots
  // to Deliverables view (below) so post-action state is fresh. Kept as
  // page-level state so switching objectives via the Tier 2.5 switcher
  // doesn't re-fetch — the same rollup contains all objectives.
  const [rollup, setRollup] = useState<SpaceRollupResponse | null>(null);
  const [rollupLoading, setRollupLoading] = useState(false);
  const [rollupError, setRollupError] = useState<string | null>(null);
  // Tier 4.5: batch sub-strategy pre-generation state. In-flight boolean
  // disables the button; last result persists so the user sees "X generated"
  // confirmation after the call completes. Reset when the batch_id changes
  // (new refresh → new apps possibly → stale result).
  const [preGenerating, setPreGenerating] = useState(false);
  const [preGenResult, setPreGenResult] = useState<{ generated: number; skipped: number } | null>(null);
  const [preGenError, setPreGenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Only fetch rollup after strategy is approved — nothing to roll up
    // before that since apps don't exist yet.
    if (!flags.confirmed) {
      setRollup(null);
      return;
    }
    async function loadRollup() {
      setRollupLoading(true);
      setRollupError(null);
      try {
        const res = await fetch(`/api/spaces/${ctx.space.id}/rollup`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as SpaceRollupResponse;
        if (!cancelled) setRollup(json);
      } catch (err) {
        if (!cancelled) {
          setRollupError(err instanceof Error ? err.message : "Failed to load rollup");
        }
      } finally {
        if (!cancelled) setRollupLoading(false);
      }
    }
    void loadRollup();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.space.id, flags.confirmed, batch?.batch_id]);

  // Compute the rollup for the current objective. Matches on objective_id
  // when present; falls back to the primary entry for pre-Tier-2 spaces
  // where currentEntry.objective_id may be null.
  const currentRollup: ObjectiveRollup | null = useMemo(() => {
    if (!rollup) return null;
    const targetId = currentEntry?.objective_id ?? null;
    const byId = rollup.objectives.find((o) => o.objective_id === targetId);
    if (byId) return byId;
    // No objective_id match — use primary bucket as fallback.
    return rollup.objectives.find((o) => o.is_primary) ?? rollup.objectives[0] ?? null;
  }, [rollup, currentEntry]);

  // Tier 4.5: clear pre-gen result when batch_id changes (stale state).
  useEffect(() => {
    setPreGenResult(null);
    setPreGenError(null);
  }, [batch?.batch_id]);

  // Tier 4.5: "Pre-generate all sub-strategies" handler.
  // Kicks off batch generation against the space, then refetches rollup
  // so the space pulse + objective panels reflect the new sub-strategy
  // counts without a full page reload.
  const handlePreGenerateAll = async () => {
    setPreGenerating(true);
    setPreGenError(null);
    try {
      const res = await fetch(`/api/spaces/${ctx.space.id}/substrategies/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as BatchSubstrategiesResponse;
      setPreGenResult({
        generated: json.generated,
        skipped: json.skipped,
      });
      // Re-fetch rollup to reflect new sub-strategy counts.
      try {
        const rollupRes = await fetch(`/api/spaces/${ctx.space.id}/rollup`, {
          cache: "no-store",
        });
        if (rollupRes.ok) {
          const rollupJson = (await rollupRes.json()) as SpaceRollupResponse;
          setRollup(rollupJson);
        }
      } catch {
        /* refetch is nice-to-have; don't fail the whole action on it */
      }
    } catch (err) {
      setPreGenError(err instanceof Error ? err.message : "Batch generation failed");
    } finally {
      setPreGenerating(false);
    }
  };

  // Default landing view: if the strategy is already approved (reloading a
  // post-approval space), start on Deliverables. Otherwise show Cascade so
  // the user can review + approve.
  const [view, setView] = useState<ViewKind>(() =>
    flags.confirmed ? "deliverables" : "cascade",
  );

  // Phase 3b: one-click chain regen from the staleness banner
  const chainsActions = useCausalChainsActions(ctx.space.id);
  const bannerDismissKey = `interaxis:dismissed:goal-mismatch-banner:${ctx.space.id}`;
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(bannerDismissKey) === "1";
  });
  // Re-arm banner if the staleness reason clears and re-surfaces for a different reason
  // (pure effect — no heavy deps). When staleness is no longer goal_mismatch, we clear the
  // dismiss flag so a new mismatch on a future goal-switch is visible.
  useEffect(() => {
    if (
      chainsStaleness.reason !== "goal_mismatch" &&
      typeof window !== "undefined" &&
      window.localStorage.getItem(bannerDismissKey) === "1"
    ) {
      window.localStorage.removeItem(bannerDismissKey);
      setBannerDismissed(false);
    }
  }, [chainsStaleness.reason, bannerDismissKey]);

  // Phase 3c: auto-regen on goal mismatch (once per space per tab session).
  // sessionStorage clears on tab close so subsequent goal switches in a new tab re-arm.
  const autoRegenAttemptKey = `interaxis:auto-regen-attempted:${ctx.space.id}`;
  const autoRegenAttemptedRef = useRef<boolean>(
    typeof window !== "undefined" &&
      window.sessionStorage.getItem(autoRegenAttemptKey) === "1",
  );
  const [autoRegenPending, setAutoRegenPending] = useState(false);

  useEffect(() => {
    if (autoRegenAttemptedRef.current) return;
    if (bannerDismissed) return;
    if (chainsStaleness.reason !== "goal_mismatch") return;
    if (chainsActions.regenerating) return;

    setAutoRegenPending(true);
    const timer = window.setTimeout(() => {
      autoRegenAttemptedRef.current = true;
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(autoRegenAttemptKey, "1");
      }
      setAutoRegenPending(false);
      void chainsActions.regenerate();
    }, 2000);

    return () => {
      window.clearTimeout(timer);
      setAutoRegenPending(false);
    };
  }, [
    chainsStaleness.reason,
    bannerDismissed,
    chainsActions,
    autoRegenAttemptKey,
  ]);

  // When staleness resolves (regen succeeded), clear the sessionStorage flag so a
  // FUTURE goal switch within the same tab re-arms auto-regen cleanly.
  useEffect(() => {
    if (chainsStaleness.reason !== "goal_mismatch" && autoRegenAttemptedRef.current) {
      autoRegenAttemptedRef.current = false;
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(autoRegenAttemptKey);
      }
    }
  }, [chainsStaleness.reason, autoRegenAttemptKey]);

  const entityMap = useMemo<Map<string, Entity>>(() => {
    const m = new Map<string, Entity>();
    for (const e of ctx.entities) {
      m.set(e.entity_id, e);
      // Also index by UUID so flowchart & chains can resolve both forms
      m.set(e.id, e);
    }
    return m;
  }, [ctx.entities]);

  const causalChains = synthData?.causal_chains ?? [];

  // Arc 3 Phase 2: change proposals from the engine's post-confirm delta
  // pass. Prefer the currently-viewed batch entry's proposals (each entry
  // may describe different deltas for its objective); fall back to the
  // top-level strategyData proposals for single-entry / pre-batch spaces.
  const changeProposals = useMemo(() => {
    const entryProposals = currentEntry?.change_proposals ?? null;
    if (entryProposals && entryProposals.length > 0) return entryProposals;
    return strategyData?.change_proposals ?? [];
  }, [currentEntry, strategyData]);

  // Auto-collapse when all proposals have been reviewed + cleared server-side.
  useEffect(() => {
    if (changeProposals.length === 0 && changeProposalsExpanded) {
      setChangeProposalsExpanded(false);
    }
  }, [changeProposals.length, changeProposalsExpanded]);

  // Arc 3 Phase 3: Cmd+Shift+R regenerates the strategy from anywhere on
  // this page. Only enabled when not already loading — the hook's
  // dispatcher swallows the keystroke, so no double-fire risk.
  useHotkey(
    "cmd+shift+r",
    () => {
      void actions.regenerate();
    },
    {
      scope: "strategy-page",
      enabled: !flags.loading,
      allowInInput: false,
    },
  );

  // Empty / generation states
  if (!flags.hasSynthesis) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Run synthesis to generate strategic recommendations
      </div>
    );
  }

  if (!recommendation || !vm) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 max-w-sm mx-auto">
        <Trophy className="h-8 w-8 text-amber-400" />
        <p className="text-sm font-medium text-gray-700">
          {flags.needsGeneration
            ? "Synthesis complete — ready to generate strategy"
            : "No strategy generated yet"}
        </p>
        <p className="text-xs text-gray-500">
          Generate ranked strategic recommendations with infrastructure proposals
        </p>
        <button
          onClick={actions.generate}
          disabled={flags.loading}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
          style={{ background: "var(--accent-600)" }}
        >
          {flags.loading ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" /> Generating...
            </>
          ) : (
            <>
              <Zap className="h-4 w-4" /> Generate Strategy
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: `
          radial-gradient(ellipse 60% 40% at 80% 20%, rgba(var(--accent-rgb), 0.06) 0%, transparent 60%),
          radial-gradient(ellipse 50% 35% at 15% 75%, rgba(var(--accent-rgb), 0.04) 0%, transparent 60%),
          linear-gradient(180deg, #FAFBFC 0%, #F4F5F8 100%)
        `,
      }}
    >
      <div
        className="relative max-w-[1440px] mx-auto px-6 pt-6 pb-12"
        style={{
          backgroundImage:
            "linear-gradient(rgba(11, 13, 18, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(11, 13, 18, 0.035) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          backgroundPosition: "center center",
        }}
      >
        {/* Top breadcrumb bar */}
        <div
          className="flex items-center justify-center gap-3.5 pb-5"
          style={{
            fontSize: "10.5px",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "rgba(11,13,18,0.34)",
            fontWeight: 600,
          }}
        >
          <span>Intelligence</span>
          <span className="w-[3px] h-[3px] rounded-full bg-gray-400" />
          <span>Strategies</span>
          <span className="w-[3px] h-[3px] rounded-full bg-gray-400" />
          <span className="text-gray-800">{ctx.space.name}</span>
        </div>

        {/* Arc 3 Phase 2: change-proposals banner + inline review panel.
            Only appears when the engine produced deltas after a prior
            confirm (status === "confirmed" + re-synthesis). Click the
            banner to expand; each card supports approve/skip with
            keyboard shortcuts (A/S/J/K). Applying or skipping calls
            ctx.refresh() so the banner count stays live. */}
        {changeProposals.length > 0 && (
          <div className="mb-4 space-y-3">
            <ChangeProposalsBanner
              proposals={changeProposals}
              expanded={changeProposalsExpanded}
              onToggle={() => setChangeProposalsExpanded((v) => !v)}
            />
            {changeProposalsExpanded && (
              <div id="change-proposals-panel">
                <ChangeProposalsPanel
                  spaceId={ctx.space.id}
                  proposals={changeProposals}
                  onChange={() => ctx.refresh()}
                />
              </div>
            )}
          </div>
        )}

        {/* Arc 4 Phase A: strategy version history. Self-hides when there's
            no history (single-snapshot spaces). "Open in canvas" navigates
            to /whiteboard with a ?place_strategy={snapshot_id} query param;
            the whiteboard's Phase C consumer reads that param on mount and
            drops the corresponding StrategyShape at the viewport center. */}
        {/* Pinned syntheses — surfaces summaries the user pinned from
            canvas SummaryCard shapes. Self-hides when there are no
            pins. The "Show on canvas" button on each row dispatches a
            `summary-card:focus` window event that the canvas catches
            to zoom + select the matching shape if it still exists. */}
        <div className="mb-4">
          <PinnedSynthesesSection spaceId={ctx.space.id} />
        </div>

        {/* Phase 4 — variant leaderboard. Self-hides when zero
            variants exist. Refreshes on focus + every 30s while
            expanded. Show-on-canvas dispatches a `variant:focus`
            event the canvas can pick up to zoom to the variant
            carousel for that variant's app. */}
        <div className="mb-4">
          <LeaderboardSection spaceId={ctx.space.id} />
        </div>

        <div className="mb-4">
          <StrategyVersionHistory
            spaceId={ctx.space.id}
            onSendToCanvas={(snapshot) => {
              router.push(
                `/app/space/${ctx.space.id}/whiteboard?place_strategy=${encodeURIComponent(
                  snapshot.id,
                )}`,
              );
            }}
          />
        </div>

        {/* HERO */}
        <div className="mb-5">
          <StrategyHeroGlass
            hero={vm.hero}
            spaceId={ctx.space.id}
            status={flags.status}
            onRegenerate={actions.regenerate}
            regenerating={flags.loading}
            view={view}
            onViewChange={setView}
          />
        </div>

        {/* Twin Proposal review — structured "why this workflow?" panel.
            Inline-passive: visible-but-not-blocking. Renders nothing when
            no strategy has been generated for this space yet. */}
        <div className="mb-5">
          <TwinProposalReviewPanel spaceId={ctx.space.id} />
        </div>

        {/* Tier 2.5: strategy switcher. Only renders when the batch has
            more than one entry — single-strategy spaces stay clean.
            Surfaces the per-objective fan-out so the user can tab through
            each focused strategy. The switcher mutates only local state
            (currentEntryIndex); no server round-trip per click. */}
        {entries.length > 1 && (
          <div
            className="mb-3 flex items-center gap-3 rounded-lg px-3.5 py-2"
            style={{
              background: "rgba(99,102,241,0.05)",
              border: "1px solid rgba(99,102,241,0.20)",
              fontSize: 12,
            }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-indigo-700/80 shrink-0">
              Strategy {currentEntryIndex + 1} of {entries.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentEntryIndex((i) => Math.max(0, i - 1))}
                disabled={currentEntryIndex === 0}
                className="rounded-full p-1 text-indigo-700 hover:bg-indigo-100/60 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label="Previous strategy"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setCurrentEntryIndex((i) => Math.min(entries.length - 1, i + 1))
                }
                disabled={currentEntryIndex === entries.length - 1}
                className="rounded-full p-1 text-indigo-700 hover:bg-indigo-100/60 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label="Next strategy"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-w-0 flex-1 truncate font-medium text-indigo-900">
              {currentEntry?.objective_title ?? "Strategy"}
              {currentEntry?.is_primary ? (
                <span className="ml-2 rounded-full bg-indigo-100/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-indigo-700">
                  Primary
                </span>
              ) : currentEntry?.parent_goal_id ? (
                <span className="ml-2 rounded-full bg-violet-100/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-violet-700">
                  Sub-objective
                </span>
              ) : null}
            </div>
            {/* Quick-jump pills — visual peek at what's in the batch. Stacks
                horizontally; truncates labels at sensible width via min-w-0. */}
            <div className="flex items-center gap-1 overflow-x-auto">
              {entries.map((e, i) => (
                <button
                  key={`${e.objective_id ?? "fallback"}-${i}`}
                  type="button"
                  onClick={() => setCurrentEntryIndex(i)}
                  className={
                    "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors " +
                    (i === currentEntryIndex
                      ? "bg-indigo-600 text-white"
                      : "bg-white/70 text-indigo-700 hover:bg-indigo-50")
                  }
                  title={e.objective_title}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tier 1 fix: error/success banner from approve / select-alternative.
            Without this both success and silent failure looked identical
            (the page just refreshed in place). Errors take precedence over
            success messages — if both were set this turn, the user needs
            to see the error. */}
        {flags.error && (
          <div
            className="mb-3 flex items-start gap-2 rounded-lg px-3.5 py-2"
            style={{
              background: "rgba(244,63,94,0.06)",
              border: "1px solid rgba(244,63,94,0.28)",
              color: "#9F1239",
              fontSize: 12,
            }}
            role="alert"
          >
            <span className="font-semibold shrink-0">⚠ Error:</span>
            <span className="flex-1">{flags.error}</span>
          </div>
        )}
        {!flags.error && flags.message && (
          <div
            className="mb-3 flex items-center gap-2 rounded-lg px-3.5 py-2"
            style={{
              background:
                flags.message.kind === "success"
                  ? "rgba(16,185,129,0.07)"
                  : "rgba(99,102,241,0.06)",
              border:
                flags.message.kind === "success"
                  ? "1px solid rgba(16,185,129,0.28)"
                  : "1px solid rgba(99,102,241,0.22)",
              color: flags.message.kind === "success" ? "#047857" : "#3730A3",
              fontSize: 12,
            }}
            role="status"
          >
            <span className="font-semibold shrink-0">
              {flags.message.kind === "success" ? "✓" : "ℹ"}
            </span>
            <span className="flex-1">{flags.message.text}</span>
          </div>
        )}

        {/* Phase 4a: consent-filter summary — shows after a confirm that filtered any trackers */}
        {lastConfirm && lastConfirm.trackers_filtered_by_consent > 0 && (
          <div
            className="mb-3 flex items-center gap-2 rounded-lg px-3.5 py-2"
            style={{
              background: "rgba(99,102,241,0.06)",
              border: "1px solid rgba(99,102,241,0.22)",
              color: "#3730A3",
              fontSize: 12,
            }}
          >
            <span className="flex-1">
              <span className="font-semibold">
                {lastConfirm.trackers_created} of{" "}
                {lastConfirm.trackers_created + lastConfirm.trackers_filtered_by_consent}{" "}
                proposed trackers active
              </span>{" "}
              · {lastConfirm.trackers_filtered_by_consent} filtered by your data
              preferences
              {(() => {
                const cats = Object.keys(lastConfirm.filtered_by_category ?? {});
                return cats.length > 0 ? ` (${cats.join(", ").replace(/_/g, " ")})` : "";
              })()}
              .
            </span>
            <Link
              href="/app/settings"
              className="underline font-semibold"
              style={{ color: "#4F46E5" }}
            >
              Review →
            </Link>
          </div>
        )}

        {/* Phase 4b: surface how many user-answered open questions informed this strategy */}
        {(() => {
          const rc = (strategyData as unknown as {
            refresh_context?: {
              resolved_open_question_count?: number;
              resolved_open_questions?: Array<{
                question: string;
                answer: string;
                priority?: string;
              }>;
            };
          } | null)?.refresh_context;
          const rqCount = rc?.resolved_open_question_count ?? 0;
          if (rqCount === 0) return null;
          const criticalCount = (rc?.resolved_open_questions ?? []).filter(
            (q) => q.priority === "critical"
          ).length;
          return (
            <div
              className="mb-3 flex items-center gap-2 rounded-lg px-3.5 py-2"
              style={{
                background: "rgba(16,185,129,0.06)",
                border: "1px solid rgba(16,185,129,0.25)",
                color: "#065F46",
                fontSize: 12,
              }}
            >
              <span className="flex-1">
                <span className="font-semibold">
                  {rqCount} user-supplied answer{rqCount === 1 ? "" : "s"} informed this strategy
                </span>
                {criticalCount > 0 && (
                  <>
                    {" "}
                    <span style={{ color: "#B91C1C" }}>
                      ({criticalCount} critical)
                    </span>
                  </>
                )}
                {" "}— factual anchors replaced speculation where available.
              </span>
            </div>
          );
        })()}

        {/* Phase 3 + 3b: chain staleness banner — active goal ≠ chain goal, with one-click regen */}
        {chainsStaleness.stale &&
          chainsStaleness.reason === "goal_mismatch" &&
          !bannerDismissed && (
            <div
              className="mb-4 flex items-center gap-2 rounded-lg px-3.5 py-2"
              style={{
                background: "#FFFBEB",
                border: "1px solid #FDE68A",
                color: "#92400E",
                fontSize: 12,
              }}
            >
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="flex-1">
                Causal chains were generated for a different goal
                {chainsStaleness.mismatchedChainCount
                  ? ` (${chainsStaleness.mismatchedChainCount} chain${chainsStaleness.mismatchedChainCount === 1 ? "" : "s"})`
                  : ""}
                .{" "}
                {chainsActions.error ? (
                  <span className="font-semibold" style={{ color: "#991B1B" }}>
                    {chainsActions.error}
                  </span>
                ) : chainsActions.regenerating ? (
                  "Auto-regenerating for active goal…"
                ) : autoRegenPending ? (
                  "Auto-regenerating in 2s. Dismiss to keep current chains."
                ) : (
                  "Regenerate to align with the active goal."
                )}{" "}
                <Link
                  href={`/app/space/${ctx.space.id}/causal-chains`}
                  className="underline"
                  style={{ color: "#92400E" }}
                >
                  View chains →
                </Link>
              </span>
              <button
                onClick={chainsActions.regenerate}
                disabled={chainsActions.regenerating || autoRegenPending}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: "#FDE68A",
                  color: "#78350F",
                  fontSize: 11,
                  border: "1px solid #FCD34D",
                }}
                title={
                  autoRegenPending
                    ? "Auto-regen starting in 2s — click to start now"
                    : chainsActions.regenerating
                      ? "Regeneration in progress"
                      : "Regenerate chains for the active goal"
                }
              >
                {chainsActions.regenerating ? (
                  <>
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Regenerating…
                  </>
                ) : autoRegenPending ? (
                  <>
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Queued
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3" />
                    Regenerate
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem(bannerDismissKey, "1");
                  }
                  setBannerDismissed(true);
                }}
                aria-label="Dismiss"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-amber-200/60"
                style={{ color: "#92400E" }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

        {/* Body switches by view mode */}
        {view === "cascade" && (
          <>
            {/* CASCADE */}
            <div className="mb-4">
              <CascadeSection
                cascade={vm.cascade}
                causalChains={causalChains}
                entityMap={entityMap}
                spaceId={ctx.space.id}
              />
            </div>

            {/* INFRASTRUCTURE ARCHITECTURE */}
            {vm.infrastructure && (
              <div className="mb-4">
                <InfrastructureSection
                  infrastructureMap={vm.infrastructure.map}
                  infrastructureProposals={vm.infrastructure.proposals}
                  entityMap={entityMap}
                  spaceId={ctx.space.id}
                  posteriors={
                    (synthData?.construct_posteriors as
                      | import("@/lib/upf/posterior").PosteriorMap
                      | undefined) ?? undefined
                  }
                />
              </div>
            )}

            {/* TRACKERS LAB — Phase 4c-final-v3: inline observation logging that drives the
                UPF posterior loop. Only meaningful after a strategy is confirmed (when
                metric_trackers rows exist); the panel self-hides when there are no
                trackers, so it's safe to always render. */}
            {flags.confirmed && (
              <div className="mb-4">
                <TrackersPanel
                  spaceId={ctx.space.id}
                  posteriors={
                    (synthData?.construct_posteriors as
                      | import("@/lib/upf/posterior").PosteriorMap
                      | undefined) ?? undefined
                  }
                />
              </div>
            )}

            {/* BRIDGE */}
            <ConvergenceBridge variantCount={vm.bridge.variantCount} />

            {/* VARIANTS */}
            <div className="mt-4 mb-5">
              <VariantsSection
                variants={vm.variants}
                causalChains={causalChains}
                entityMap={entityMap}
                spaceId={ctx.space.id}
                isConfirmed={flags.confirmed}
                loading={flags.loading}
                onConfirm={async () => {
                  // Flip UI state optimistically, then await the confirm so
                  // we navigate after the backend acknowledges the approval
                  // (metric_trackers seeded, changelog written, etc.).
                  ctx.setStrategyApproved(true);
                  try {
                    await actions.confirm();
                  } finally {
                    // Land the user on the Deliverables view regardless of
                    // success — if confirm failed, the view shows its own
                    // error states; the user still gets a consistent flow.
                    setView("deliverables");
                  }
                }}
                onSelectAlternative={actions.selectAlternative}
                onRegenerate={actions.regenerate}
              />
            </div>

            {/* EVIDENCE STRIP */}
            <EvidenceStrip
              recommendation={recommendation}
              entityMap={entityMap}
              synthData={synthData}
              entities={ctx.entities}
              cycles={ctx.cycles}
              scenarios={ctx.scenarios}
              spaceId={ctx.space.id}
              suggestedObjectives={ctx.pendingObjectives}
              activeGoal={ctx.activeGoal}
              goalRecommendations={
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ((strategyData as any)?.goal_recommendations ?? []) as Array<any>
              }
            />
          </>
        )}

        {view === "whiteboard" && (
          <WhiteboardView
            synthData={synthData}
            recommendation={strategyData}
            cascade={vm.cascade}
          />
        )}

        {view === "deliverables" && (
          <>
            {/* Tier 2.5: when the batch has multiple entries, surface a
                slim header so the user knows which objective's
                deliverables they're seeing. The strategy switcher above
                already controls the index — this is just a re-statement
                so the user doesn't have to scroll back to confirm. */}
            {entries.length > 1 && currentEntry && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-indigo-200/60 bg-indigo-50/30 px-3.5 py-2 text-[12px]">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-indigo-700/80">
                  Deliverables for
                </span>
                <span className="truncate font-semibold text-indigo-900">
                  {currentEntry.objective_title}
                </span>
                {currentEntry.is_primary ? (
                  <span className="rounded-full bg-indigo-100/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-indigo-700">
                    Primary
                  </span>
                ) : (
                  <span className="rounded-full bg-violet-100/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-violet-700">
                    Sub-objective
                  </span>
                )}
                <span className="ml-auto text-[11px] text-indigo-700/70">
                  Use ⟨ ⟩ above to switch · {entries.length} strategies in this batch
                </span>
              </div>
            )}
            {/* Tier 4.5: space pulse — top-level cross-objective totals.
                Appears above the per-objective rollup so users see
                everything-at-once first, then the per-objective breakdown.
                Also hosts the "Pre-generate all sub-strategies" button so
                users can warm every app's spec upfront instead of waiting
                for lazy per-open generation. */}
            {flags.confirmed && rollup && (
              <div className="mb-4">
                <SpacePulseCard
                  rollup={rollup}
                  onPreGenerateAll={handlePreGenerateAll}
                  preGenerating={preGenerating}
                  preGenResult={preGenResult}
                />
              </div>
            )}
            {preGenError && (
              <div
                className="mb-4 rounded-lg border border-rose-200/60 bg-rose-50/30 px-3 py-2 text-[11.5px] text-rose-800"
                role="alert"
              >
                <span className="font-semibold">Pre-generation error:</span>{" "}
                {preGenError}
              </div>
            )}

            {/* Tier 4: cross-app rollup for the current objective. Shows
                "did this objective's fan-out actually produce anything?"
                at a glance — app count, open predictions, surprises,
                experiments, sub-strategy health. Only rendered post-approval
                since rollup has nothing to aggregate before apps exist.
                Silent when rollup fails — the error goes to console and
                the panel simply doesn't render. */}
            {flags.confirmed && (rollupLoading || currentRollup) && (
              <div className="mb-4">
                <ObjectiveRollupPanel
                  rollup={currentRollup}
                  loading={rollupLoading && !currentRollup}
                />
              </div>
            )}
            {rollupError && !rollupLoading && (
              <div
                className="mb-4 rounded-lg border border-rose-200/60 bg-rose-50/30 px-3 py-2 text-[11.5px] text-rose-800"
                role="alert"
              >
                <span className="font-semibold">Rollup error:</span> {rollupError}
              </div>
            )}
            <DeliverablesView
              spaceId={ctx.space.id}
              synthData={synthData}
              recommendation={recommendation}
              approved={flags.confirmed}
              entityNames={Object.fromEntries(
                ctx.entities.map((e) => [e.entity_id, e.name]),
              )}
              entities={ctx.entities}
              edges={ctx.edges}
              cycles={ctx.cycles}
              activeGoal={ctx.activeGoal}
            />
          </>
        )}

        {view === "flow" && (
          <StrategySwimlane recommendation={recommendation} />
        )}

        {view === "table" && (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-center">
            <p className="text-sm font-medium text-gray-700 capitalize">Table view</p>
            <p className="text-xs text-gray-500 max-w-sm">
              Coming soon — for now, try{" "}
              <button
                onClick={() => setView("flow")}
                className="font-semibold text-interaxis-600 hover:underline"
              >
                Flow
              </button>{" "}
              for the execution timeline, or{" "}
              <button
                onClick={() => setView("cascade")}
                className="font-semibold text-interaxis-600 hover:underline"
              >
                Cascade
              </button>{" "}
              for the reasoning tree.
            </p>
          </div>
        )}

        {/* Error state */}
        {flags.error && (
          <div
            className="mt-6 px-4 py-2 rounded-lg text-[12px]"
            style={{
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              color: "#991B1B",
            }}
          >
            {flags.error}
          </div>
        )}
      </div>
    </div>
  );
}
