"use client";

// ── Experiment Twin card ───────────────────────────────────────────────
//
// Center column of CommandCenterRow. Shows a CONDENSED view of the
// digital twin as a flow hub — SCOPE (input) → TWIN CORE → INSIGHTS /
// STRATEGY / APPS (outputs). Designed to fit the 380px card perfectly
// without the cropping you get from embedding the full agent DAG here.
//
// The full agent orchestration DAG is still accessible via the expand
// modal (click the card or the maximize chip). Inside the modal the
// twin renders at natural `density="full"` with pan/scroll, and a CTA
// button routes to the user's generated + approved strategy page.

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { TwinSurface } from "@/components/twin/twin-surface";
import { TwinFlowHub, type TwinCoreState, type AppBrief } from "./twin-flow-hub";
import { useAgents } from "@/lib/hooks/use-agents";
import { useSpaceData } from "@/contexts/space-data-context";
import { Maximize2, X, ArrowUpRight } from "lucide-react";

interface Props {
  spaceId: string;
}

const STATE_CONFIG: Record<
  TwinCoreState,
  { label: string; dot: string; pulse: boolean; hint: string }
> = {
  live: {
    label: "Live",
    dot: "bg-indigo-500",
    pulse: true,
    hint: "Agents are actively running.",
  },
  confirmed: {
    label: "Approved",
    dot: "bg-emerald-500",
    pulse: false,
    hint: "Your strategy is approved and wired up.",
  },
  apps_building: {
    label: "Building apps",
    dot: "bg-indigo-500",
    pulse: true,
    hint: "Apps are being materialized after strategy confirmation.",
  },
  strategy_ready: {
    label: "Strategy ready",
    dot: "bg-amber-500",
    pulse: true,
    hint: "A strategy is generated but awaiting your approval.",
  },
  idle: {
    label: "Idle",
    dot: "bg-gray-300",
    pulse: false,
    hint: "No pipeline activity yet — run synthesis to start.",
  },
};

function hrefFor(spaceId: string, state: TwinCoreState): string {
  if (state === "confirmed" || state === "strategy_ready") {
    return `/app/space/${spaceId}/strategy`;
  }
  if (state === "live" || state === "apps_building") {
    return `/app/space/${spaceId}/twin?tab=live`;
  }
  return `/app/space/${spaceId}/twin`;
}

export function ExperimentTwinCard({ spaceId }: Props) {
  const ctx = useSpaceData();
  const { data } = useAgents(spaceId);
  const anyRunning =
    data?.agents.some((a) => a.status === "running" || a.status === "queued") ?? false;

  const [strategyStatus, setStrategyStatus] = useState<string | null>(null);
  const [appProgress, setAppProgress] = useState<
    "running" | "complete" | "failed" | "idle"
  >("idle");
  const [appsList, setAppsList] = useState<AppBrief[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchState = async () => {
      try {
        const [appsRes, progRes] = await Promise.all([
          fetch(`/api/apps?spaceId=${encodeURIComponent(spaceId)}`, { cache: "no-store" }),
          fetch(
            `/api/apps/generation-progress?spaceId=${encodeURIComponent(spaceId)}`,
            { cache: "no-store" },
          ),
        ]);
        if (appsRes.ok) {
          const j = await appsRes.json();
          if (!cancelled) {
            setStrategyStatus((j?.strategy_status as string | null) ?? null);
            // Store a small subset of fields so the hub can render names
            // alongside counts — not just numerals.
            const list: AppBrief[] = Array.isArray(j?.apps)
              ? j.apps.map((a: Record<string, unknown>) => ({
                  id: String(a.id ?? ""),
                  name: String(a.name ?? "Untitled app"),
                  status: typeof a.status === "string" ? a.status : undefined,
                  serves_goal_id: (a.serves_goal_id as string | null) ?? null,
                }))
              : [];
            setAppsList(list);
          }
        }
        if (progRes.ok) {
          const p = await progRes.json();
          if (!cancelled) setAppProgress((p?.status as typeof appProgress) ?? "idle");
        }
      } catch {
        /* non-critical */
      }
    };
    void fetchState();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void fetchState();
    }, 8000);
    const vis = () => {
      if (typeof document !== "undefined" && !document.hidden) void fetchState();
    };
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", vis);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", vis);
    };
  }, [spaceId]);

  const pipelineState: TwinCoreState =
    appProgress === "running"
      ? "apps_building"
      : anyRunning
        ? "live"
        : strategyStatus === "generated" || strategyStatus === "reviewing"
          ? "strategy_ready"
          : strategyStatus === "confirmed"
            ? "confirmed"
            : "idle";

  const s = STATE_CONFIG[pipelineState];
  const href = hrefFor(spaceId, pipelineState);

  return (
    <>
      <GlassCard
        variant="dashboard"
        className="relative flex flex-col h-[380px] p-4 overflow-hidden group"
      >
        {/* Corner overlay — state badge + expand affordance */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-700 bg-white/80 ring-1 ring-black/5 backdrop-blur rounded-full px-2 py-0.5"
            title={s.hint}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? "animate-pulse" : ""}`}
            />
            {s.label}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
            className="inline-flex items-center gap-0.5 text-[10px] font-medium text-indigo-600 hover:text-indigo-700 bg-white/80 ring-1 ring-black/5 backdrop-blur rounded-full px-2 py-0.5 transition-colors"
            aria-label="Expand twin preview"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>

        {/* Condensed hub — replaces the old cropped mini-twin */}
        <div className="flex-1 min-h-0 pt-5">
          <TwinFlowHub
            space={ctx.space}
            liveCounts={ctx.liveCounts}
            state={pipelineState}
            apps={appsList}
            activeGoal={ctx.activeGoal}
            spaceId={spaceId}
            onExpand={() => setExpanded(true)}
          />
        </div>

        {/* Subtle footer cue — tells the user the card is clickable */}
        <div className="absolute bottom-3 right-3 z-10 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          Click any node · or expand ⌘↗
        </div>
      </GlassCard>

      {/* Expand modal — the FULL twin at natural size */}
      <TwinExpandModal
        open={expanded}
        onClose={() => setExpanded(false)}
        href={href}
        state={pipelineState}
      />
    </>
  );
}

// ── Expand modal ────────────────────────────────────────────────────────

function TwinExpandModal({
  open,
  onClose,
  href,
  state,
}: {
  open: boolean;
  onClose: () => void;
  href: string;
  state: TwinCoreState;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const s = STATE_CONFIG[state];
  const ctaLabel =
    state === "strategy_ready"
      ? "Review & approve strategy"
      : state === "confirmed"
        ? "Open approved strategy"
        : state === "live" || state === "apps_building"
          ? "Open live twin"
          : "Open twin";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-[1100px] h-[min(820px,92vh)] rounded-[24px] bg-white/92 backdrop-blur-xl ring-1 ring-black/8 shadow-[0_40px_80px_-24px_rgba(8,30,80,0.28),0_12px_32px_-14px_rgba(8,30,80,0.16),inset_0_1px_0_rgba(255,255,255,1)] overflow-hidden flex flex-col"
          >
            <header className="flex items-center justify-between px-5 py-4 border-b border-black/5">
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/70 ring-1 ring-black/5 px-2.5 py-1 text-[10.5px] font-medium text-gray-700"
                  title={s.hint}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? "animate-pulse" : ""}`}
                  />
                  {s.label}
                </span>
                <div>
                  <h2 className="text-[14px] font-semibold text-gray-900 leading-tight">
                    Digital twin — experiment layer
                  </h2>
                  <p className="text-[11px] text-gray-500 leading-tight">
                    {state === "confirmed"
                      ? "Your approved strategy, rendered live."
                      : state === "strategy_ready"
                        ? "Strategy drafted — review and approve to wire it up."
                        : "Agent orchestration graph for this space."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={href}
                  className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-[11.5px] font-semibold px-3 py-1.5 transition-colors"
                  onClick={onClose}
                >
                  {ctaLabel}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full p-1.5 text-gray-400 hover:bg-black/5 hover:text-gray-700 transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-auto p-5 bg-gradient-to-br from-white/40 via-white/20 to-transparent">
              <TwinSurface layers={["experiment"]} density="full" />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
