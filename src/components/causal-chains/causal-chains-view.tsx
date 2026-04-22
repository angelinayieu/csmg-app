"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Info, Filter, Share2, RefreshCw, Target, Zap, Network, List } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { useCausalChainsActions } from "@/lib/hooks/use-causal-chains-actions";
import type { CausalChain, CausalStageKind } from "@/types/causal-chains";
import type { SynthesisData } from "@/types/synthesis";
import { CausalChainGraph } from "./causal-chain-graph";

// Stage colors — mapped to the app's design tokens via CSS vars with inline fallback.
// Concept=purple, Research=green, Deliverable=blue (accent), Application=amber,
// Outcome=teal, Goal=red.
const STAGE_COLORS: Record<
  CausalStageKind,
  { bg: string; edge: string; text: string; stroke: string }
> = {
  concept: { bg: "#FAF5FF", edge: "#E9D5FF", text: "#5B21B6", stroke: "#7C3AED" },
  research: { bg: "#ECFDF5", edge: "#A7F3D0", text: "#065F46", stroke: "#047857" },
  deliverable: {
    bg: "var(--accent-50, #EEF2FF)",
    edge: "var(--accent-100, #C7D2FE)",
    text: "var(--accent-700, #3730A3)",
    stroke: "var(--accent-600, #4F46E5)",
  },
  application: { bg: "#FFFBEB", edge: "#FDE68A", text: "#92400E", stroke: "#B45309" },
  outcome: { bg: "#ECFEFF", edge: "#A5F3FC", text: "#155E75", stroke: "#0E7490" },
  goal: { bg: "#FEF2F2", edge: "#FECACA", text: "#991B1B", stroke: "#B91C1C" },
};

const STAGE_LABELS: Array<{ kind: CausalStageKind; name: string; sub: string }> = [
  { kind: "concept", name: "Concept", sub: "science says…" },
  { kind: "research", name: "Research", sub: "evidence proves…" },
  { kind: "deliverable", name: "Deliverable", sub: "therefore rule…" },
  { kind: "application", name: "Application", sub: "applied to asset" },
  { kind: "outcome", name: "Outcome", sub: "measured result" },
  { kind: "goal", name: "Goal", sub: "master objective" },
];

function parseSynthData(raw: unknown): SynthesisData | null {
  if (!raw) return null;
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as SynthesisData;
  } catch {
    return null;
  }
}

export function CausalChainsView() {
  const ctx = useSpaceData();
  const router = useRouter();
  const [chains, setChains] = useState<CausalChain[]>(() => {
    const sd = parseSynthData(ctx.space.synthesis_data);
    return sd?.causal_chains ?? [];
  });
  // Phase 3b: delegate regenerate to shared hook (keeps state parity with strategy banner).
  const chainsActions = useCausalChainsActions(ctx.space.id);
  const generating = chainsActions.regenerating;
  const error = chainsActions.error;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"contribution" | "confidence" | "recency">(
    "contribution",
  );
  // View mode: DAG-first (default, honest to the data) or legacy list.
  const [viewMode, setViewMode] = useState<"graph" | "list">("graph");
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep chains in sync with synthesis_data changes
  useEffect(() => {
    const sd = parseSynthData(ctx.space.synthesis_data);
    if (sd?.causal_chains) setChains(sd.causal_chains);
  }, [ctx.space.synthesis_data]);

  const sortedChains = useMemo(() => {
    const arr = [...chains];
    if (sortBy === "confidence") arr.sort((a, b) => b.confidence - a.confidence);
    else if (sortBy === "recency")
      arr.sort(
        (a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime(),
      );
    else arr.sort((a, b) => b.goal_contribution_pct - a.goal_contribution_pct);
    return arr;
  }, [chains, sortBy]);

  const combinedPct = useMemo(
    () =>
      Math.round(sortedChains.reduce((s, c) => s + c.goal_contribution_pct, 0) * 10) /
      10,
    [sortedChains],
  );

  const activeGoal = ctx.activeGoal;

  // Phase 3b: shared regen path — the hook POSTs, refreshes, and syncs state.
  // Local chains hydrate automatically via the `useEffect` watching synthesis_data.
  const generate = useCallback(
    () => chainsActions.regenerate(),
    [chainsActions],
  );

  // Auto-generate on first visit if no chains exist yet but synthesis does
  useEffect(() => {
    if (chains.length === 0 && ctx.hasSynthesis && !generating && !error) {
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChainClick = (chain: CausalChain, stageIndex?: number) => {
    // Click navigates to Calculation Trace page
    router.push(
      `/app/space/${ctx.space.id}/trace/${chain.id}${stageIndex != null ? `?step=${stageIndex}` : ""}`,
    );
  };

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto"
      style={{
        background: `radial-gradient(ellipse 60% 40% at 80% 20%, rgba(79,70,229,0.06) 0%, transparent 60%),
                     radial-gradient(ellipse 50% 35% at 15% 75%, rgba(147,51,234,0.05) 0%, transparent 60%),
                     linear-gradient(180deg,#FAFBFC 0%,#F4F5F8 100%)`,
      }}
    >
      <div className="max-w-[1440px] mx-auto p-6">
        {/* Topbar */}
        <div
          className="flex items-center justify-center gap-3.5 pb-5 text-[10.5px] font-semibold text-gray-500"
          style={{ letterSpacing: "0.22em", textTransform: "uppercase" }}
        >
          <span>Intelligence</span>
          <span className="w-[3px] h-[3px] rounded-full bg-gray-400" />
          <span>Causal Chains</span>
          <span className="w-[3px] h-[3px] rounded-full bg-gray-400" />
          <span>{activeGoal?.title ?? ctx.space.name}</span>
        </div>

        {/* Hero */}
        <div
          className="rounded-[14px] p-[22px_26px] mb-[18px] flex items-start justify-between gap-5"
          style={{
            background: "rgba(255,255,255,0.72)",
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            border: "1px solid rgba(11,13,18,0.14)",
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04), 0 12px 32px -16px rgba(11,30,80,0.1)",
          }}
        >
          <div className="flex-1 max-w-[820px]">
            <div
              className="inline-flex items-center gap-[7px] px-[10px] py-1 rounded-md mb-2.5 text-[11px] font-semibold"
              style={{
                background: "#F7F8FA",
                border: "1px solid rgba(11,13,18,0.14)",
                color: "rgba(11,13,18,0.92)",
              }}
            >
              <span
                className="w-[5px] h-[5px] rounded-full"
                style={{ background: "#047857" }}
              />
              Causal Propagation · L4 atoms → master goal
            </div>
            <h1
              className="font-semibold mb-2"
              style={{
                fontSize: 22,
                letterSpacing: "-0.02em",
                lineHeight: 1.3,
                color: "#0B0D12",
              }}
            >
              {chains.length > 0
                ? `${chains.length} insight${chains.length === 1 ? "" : "s"} actively propagating to your master goal`
                : "No causal chains yet"}
            </h1>
            <p
              className="max-w-[720px]"
              style={{
                fontSize: "12.5px",
                lineHeight: 1.55,
                color: "rgba(11,13,18,0.74)",
              }}
            >
              Each row is one <b className="font-semibold text-gray-900">causal trajectory</b> — a single L4 atomic invariant traced
              forward through research validation, deliverable rule, application,
              measurable outcome, and contribution to the master goal.{" "}
              <b className="font-semibold text-gray-900">Hover any chain</b> to isolate it, click any node to inspect its
              calculation trace.
            </p>

            <div
              className="flex flex-wrap gap-1.5 mt-3.5 pt-3 border-t"
              style={{ borderColor: "rgba(11,13,18,0.08)" }}
            >
              <StatChip color="#7C3AED" label={`${chains.length} atoms`} />
              <StatChip
                color="#047857"
                label={`${chains.filter((c) => (c.stages[1].source_url ?? c.stages[1].verified)).length} papers`}
              />
              <StatChip
                color="var(--accent-600, #4F46E5)"
                label={`${chains.reduce((s, c) => s + c.micro_tactic_ids.length, 0)} deliverables`}
                accent
              />
              <StatChip color="#B91C1C" label={activeGoal ? "1 master goal" : "0 master goals"} />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 mt-1">
            {/* View toggle — DAG (graph) vs legacy list */}
            <div className="flex p-[3px] bg-white/40 border border-[rgba(11,13,18,0.08)] rounded-[10px]">
              {[
                { key: "graph" as const, label: "DAG", icon: Network },
                { key: "list" as const, label: "List", icon: List },
              ].map((opt) => {
                const Icon = opt.icon;
                const active = viewMode === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setViewMode(opt.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-[11px] py-1.5 rounded-[7px] text-[11.5px] font-semibold transition-colors",
                      active
                        ? "bg-white text-gray-900"
                        : "text-gray-500 bg-transparent hover:text-gray-700",
                    )}
                    style={
                      active
                        ? {
                            boxShadow:
                              "0 1px 2px rgba(11,13,18,0.06), inset 0 0 0 1px rgba(11,13,18,0.14)",
                          }
                        : undefined
                    }
                  >
                    <Icon className="h-3 w-3" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div className="flex p-[3px] bg-white/40 border border-[rgba(11,13,18,0.08)] rounded-[10px]">
              {[
                { key: "contribution", label: "Goal contribution" },
                { key: "confidence", label: "Confidence" },
                { key: "recency", label: "Recency" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setSortBy(opt.key as typeof sortBy)}
                  className={cn(
                    "px-[11px] py-1.5 rounded-[7px] text-[11.5px] font-semibold transition-colors",
                    sortBy === opt.key
                      ? "bg-white text-gray-900"
                      : "text-gray-500 bg-transparent hover:text-gray-700",
                  )}
                  style={
                    sortBy === opt.key
                      ? {
                          boxShadow:
                            "0 1px 2px rgba(11,13,18,0.06), inset 0 0 0 1px rgba(11,13,18,0.14)",
                        }
                      : undefined
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              title="Regenerate"
              onClick={generate}
              disabled={generating}
              className="w-8 h-8 rounded-[9px] border border-[rgba(11,13,18,0.08)] bg-white/50 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-white disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", generating && "animate-spin")} />
            </button>
            <button
              title="Filter"
              className="w-8 h-8 rounded-[9px] border border-[rgba(11,13,18,0.08)] bg-white/50 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-white"
            >
              <Filter className="w-3.5 h-3.5" />
            </button>
            <button
              title="Share"
              className="w-8 h-8 rounded-[9px] border border-[rgba(11,13,18,0.08)] bg-white/50 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-white"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main glass container */}
        <div
          className="rounded-[14px] overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.72)",
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            border: "1px solid rgba(11,13,18,0.14)",
          }}
        >
          {/* Hint */}
          <div
            className="mx-5 my-3.5 px-5 py-2.5 rounded-lg flex items-center gap-2 text-[11.5px]"
            style={{
              background: "var(--accent-50, #EEF2FF)",
              border: "1px solid var(--accent-100, #C7D2FE)",
              color: "rgba(11,13,18,0.74)",
            }}
          >
            <Info className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--accent-600, #4F46E5)" }} />
            <span>
              <b className="font-semibold text-gray-900">Hover any chain</b> to isolate it. Click a node to inspect the
              calculation trace. Each{" "}
              <span className="font-bold" style={{ color: "var(--accent-600, #4F46E5)" }}>
                DELIVERABLE
              </span>{" "}
              node is what the system generates and applies to your assets.
            </span>
          </div>

          {/* Error banner */}
          {error && (
            <div
              className="mx-5 my-3 px-4 py-2 rounded-lg text-[12px]"
              style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B" }}
            >
              {error}
            </div>
          )}

          {/* DAG view — reactflow-powered graph. Takes over when viewMode==="graph". */}
          {viewMode === "graph" && sortedChains.length > 0 && (
            <div className="px-5 py-4">
              <CausalChainGraph
                spaceId={ctx.space.id}
                chains={sortedChains}
                goal={activeGoal}
              />
            </div>
          )}

          {/* Stage headers — only shown in list mode. */}
          {viewMode === "list" && (
          <div
            className="grid gap-0 py-3 px-5 border-b text-[10.5px]"
            style={{
              gridTemplateColumns: "140px repeat(6, 1fr)",
              background: "#F7F8FA",
              borderColor: "rgba(11,13,18,0.08)",
            }}
          >
            <div />
            {STAGE_LABELS.map((s, i) => {
              const c = STAGE_COLORS[s.kind];
              return (
                <div key={s.kind} className="px-1.5">
                  <div
                    className="font-bold uppercase mb-0.5"
                    style={{
                      fontSize: "8.5px",
                      letterSpacing: "0.14em",
                      color: c.stroke,
                    }}
                  >
                    STAGE {i + 1}
                  </div>
                  <div className="font-bold text-gray-900" style={{ fontSize: "10.5px" }}>
                    {s.name}
                  </div>
                  <div
                    className="font-medium mt-0.5"
                    style={{ fontSize: "9.5px", color: "rgba(11,13,18,0.34)" }}
                  >
                    {s.sub}
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {/* Chains */}
          <div
            className={cn("flex flex-col", hoveredId && "has-hover")}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* Empty + loading states: render once regardless of viewMode. */}
            {sortedChains.length === 0 && !generating && (
              <div className="px-6 py-12 text-center text-[13px] text-gray-500">
                No chains generated yet.{" "}
                {ctx.hasSynthesis ? (
                  <button
                    onClick={generate}
                    className="underline font-medium"
                    style={{ color: "var(--accent-600, #4F46E5)" }}
                  >
                    Generate now
                  </button>
                ) : (
                  "Run synthesis first to detect L4 invariants."
                )}
              </div>
            )}

            {generating && sortedChains.length === 0 && (
              <div className="px-6 py-12 text-center text-[13px] text-gray-500">
                Propagating L4 invariants to goal…
              </div>
            )}

            {/* Per-chain rows — legacy list view. Hidden in DAG mode. */}
            {viewMode === "list" && (
              <>


            {sortedChains.map((chain, chainIdx) => {
              const isDimmed = hoveredId !== null && hoveredId !== chain.id;
              return (
                <div
                  key={chain.id}
                  className="grid items-center cursor-pointer relative border-t px-5 py-4 transition-all"
                  style={{
                    gridTemplateColumns: "140px repeat(6, 1fr)",
                    borderColor: chainIdx === 0 ? "transparent" : "rgba(11,13,18,0.08)",
                    opacity: isDimmed ? 0.18 : 1,
                    background:
                      hoveredId === chain.id ? "rgba(255,255,255,0.85)" : "transparent",
                  }}
                  onMouseEnter={() => setHoveredId(chain.id)}
                  onClick={() => onChainClick(chain)}
                >
                  {/* Chain label */}
                  <div className="pr-3.5">
                    <div
                      className="w-7 h-7 rounded-[7px] flex items-center justify-center font-bold text-[11px] mb-1.5 transition-all"
                      style={{
                        background:
                          hoveredId === chain.id ? "var(--accent-600, #4F46E5)" : "#F7F8FA",
                        color: hoveredId === chain.id ? "#fff" : "rgba(11,13,18,0.48)",
                        border: "1px solid rgba(11,13,18,0.14)",
                        borderColor:
                          hoveredId === chain.id
                            ? "var(--accent-600, #4F46E5)"
                            : "rgba(11,13,18,0.14)",
                      }}
                    >
                      {String(chain.rank).padStart(2, "0")}
                    </div>
                    <div
                      className="font-bold mb-0.5"
                      style={{ fontSize: 12, letterSpacing: "-0.01em", lineHeight: 1.3 }}
                    >
                      {chain.name}
                    </div>
                    <div
                      className="font-bold mb-1"
                      style={{ fontSize: "10.5px", color: "#047857" }}
                    >
                      +{chain.goal_contribution_pct.toFixed(1)}% on goal
                    </div>
                    {/* Phase 3b: per-chain goal linkage pill */}
                    {(() => {
                      const cgid = chain.primary_goal_id;
                      if (!cgid) {
                        return (
                          <span
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold"
                            style={{
                              fontSize: 9.5,
                              background: "rgba(107,114,128,0.10)",
                              color: "#374151",
                              border: "1px solid rgba(107,114,128,0.20)",
                            }}
                          >
                            No goal linked
                          </span>
                        );
                      }
                      if (activeGoal && cgid === activeGoal.id) {
                        return (
                          <span
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold"
                            style={{
                              fontSize: 9.5,
                              background: "rgba(16,185,129,0.10)",
                              color: "#047857",
                              border: "1px solid rgba(16,185,129,0.25)",
                            }}
                            title={activeGoal.title}
                          >
                            Active goal
                          </span>
                        );
                      }
                      const linkedGoal = ctx.goalList?.find((g) => g.id === cgid);
                      return (
                        <span
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold"
                          style={{
                            fontSize: 9.5,
                            background: "rgba(245,158,11,0.12)",
                            color: "#92400E",
                            border: "1px solid rgba(245,158,11,0.30)",
                          }}
                          title={linkedGoal?.title ?? "Unknown goal"}
                        >
                          Stale · for {linkedGoal?.title
                            ? linkedGoal.title.length > 18
                              ? linkedGoal.title.slice(0, 17) + "…"
                              : linkedGoal.title
                            : "another goal"}
                        </span>
                      );
                    })()}
                  </div>

                  {/* Six stage cells */}
                  {chain.stages.map((stage, i) => {
                    const c = STAGE_COLORS[stage.kind];
                    return (
                      <div
                        key={i}
                        className="px-1.5 relative"
                        onClick={(e) => {
                          e.stopPropagation();
                          onChainClick(chain, i);
                        }}
                      >
                        <div
                          className="relative flex flex-col justify-center text-center transition-all rounded-lg border px-2.5 py-2"
                          style={{
                            background: c.bg,
                            borderColor: c.edge,
                            borderWidth: stage.kind === "deliverable" ? 1.5 : 1,
                            minHeight: 50,
                          }}
                        >
                          {stage.kind === "deliverable" && (
                            <div
                              className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-sm font-bold text-white"
                              style={{
                                background: c.stroke,
                                fontSize: "7.5px",
                                letterSpacing: "0.12em",
                                padding: "2px 6px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              DELIVERABLE
                            </div>
                          )}
                          <div
                            className="font-semibold"
                            style={{ fontSize: 11, lineHeight: 1.35, color: "#0B0D12" }}
                          >
                            {stage.title}
                          </div>
                          <div
                            className="font-medium mt-0.5"
                            style={{
                              fontSize: 9,
                              letterSpacing: "0.02em",
                              color:
                                stage.kind === "deliverable"
                                  ? c.text
                                  : "rgba(11,13,18,0.34)",
                              fontWeight: stage.kind === "deliverable" ? 600 : 500,
                            }}
                          >
                            {stage.meta}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
              </>
            )}
          </div>

          {/* Goal callout */}
          {activeGoal && chains.length > 0 && (
            <div
              className="m-5 px-5 py-4 rounded-[10px] flex items-center gap-4"
              style={{
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderLeft: "3px solid #B91C1C",
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-white"
                style={{ background: "#B91C1C" }}
              >
                <Target className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div
                  className="font-bold uppercase mb-0.5"
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.14em",
                    color: "#991B1B",
                  }}
                >
                  All {chains.length} chain{chains.length === 1 ? "" : "s"} converge here
                </div>
                <div
                  className="font-bold text-gray-900"
                  style={{ fontSize: 14, letterSpacing: "-0.01em" }}
                >
                  {activeGoal.title}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div
                  className="font-bold uppercase"
                  style={{
                    fontSize: 9,
                    color: "rgba(11,13,18,0.34)",
                    letterSpacing: "0.12em",
                  }}
                >
                  Combined contribution
                </div>
                <div
                  className="font-bold tabular-nums"
                  style={{
                    fontSize: 20,
                    color: "#B91C1C",
                    letterSpacing: "-0.03em",
                  }}
                >
                  +{combinedPct}%
                </div>
              </div>
            </div>
          )}

          {/* Footer legend */}
          <div
            className="px-5 py-3.5 border-t flex items-center gap-3.5 flex-wrap text-[10.5px] font-medium"
            style={{
              borderColor: "rgba(11,13,18,0.08)",
              color: "rgba(11,13,18,0.48)",
            }}
          >
            {STAGE_LABELS.map((s) => {
              const c = STAGE_COLORS[s.kind];
              return (
                <span key={s.kind} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-[9px] rounded-sm border"
                    style={{ background: c.bg, borderColor: c.edge }}
                  />
                  {s.name}
                </span>
              );
            })}
            <span
              className="inline-block w-px h-3.5"
              style={{ background: "rgba(11,13,18,0.08)" }}
            />
            <span style={{ color: "rgba(11,13,18,0.34)" }}>
              Each chain = one L4 atom propagating to master goal
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatChip({
  color,
  label,
  accent,
}: {
  color: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-semibold"
      style={{
        background: accent ? "var(--accent-50, #EEF2FF)" : "#fff",
        border: `1px solid ${accent ? "var(--accent-100, #C7D2FE)" : "rgba(11,13,18,0.08)"}`,
        color: accent ? "var(--accent-700, #3730A3)" : "rgba(11,13,18,0.74)",
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
