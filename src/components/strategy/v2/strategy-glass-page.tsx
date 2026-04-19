"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Trophy, Zap, RefreshCw, AlertTriangle, X } from "lucide-react";
import { useStrategyViewModel } from "@/lib/hooks/use-strategy-view-model";
import { useCausalChainsActions } from "@/lib/hooks/use-causal-chains-actions";
import { useSpaceData } from "@/contexts/space-data-context";
import { StrategyHeroGlass } from "./hero/strategy-hero-glass";
import { CascadeSection } from "./cascade/cascade-section";
import { InfrastructureSection } from "./infrastructure/infrastructure-section";
import { TrackersPanel } from "./trackers/trackers-panel";
import { ConvergenceBridge } from "./bridge/convergence-bridge";
import { VariantsSection } from "./variants/variants-section";
import { EvidenceStrip } from "./evidence/evidence-strip";
import { WhiteboardView } from "./whiteboard/whiteboard-view";
import { DeliverablesView } from "./deliverables/deliverables-view";
import type { ViewKind } from "./view-kind";
import type { Entity } from "@/types";

export function StrategyGlassPage() {
  const ctx = useSpaceData();
  const { vm, synthData, recommendation, flags, actions, strategyData, chainsStaleness, lastConfirm } =
    useStrategyViewModel();

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
            recommendation={recommendation}
            cascade={vm.cascade}
          />
        )}

        {view === "deliverables" && (
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
        )}

        {(view === "flow" || view === "table") && (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-center">
            <p className="text-sm font-medium text-gray-700 capitalize">{view} view</p>
            <p className="text-xs text-gray-500 max-w-sm">
              Coming soon — for now, try the new{" "}
              <button
                onClick={() => setView("whiteboard")}
                className="font-semibold text-interaxis-600 hover:underline"
              >
                Whiteboard
              </button>{" "}
              view to see the full system flow, or switch back to{" "}
              <button
                onClick={() => setView("cascade")}
                className="font-semibold text-interaxis-600 hover:underline"
              >
                Cascade
              </button>
              .
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
