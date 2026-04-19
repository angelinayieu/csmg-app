"use client";

import {
  Network,
  AppWindow,
  Wrench,
  LayoutDashboard,
  GitBranch,
  Link2,
  Activity,
  ArrowRight,
  CircleDot,
  Hammer,
  RefreshCcw,
  CheckCircle2,
  Lock,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { InfrastructureMap, InfrastructureProposal } from "@/types/strategy";
import type { Entity } from "@/types";
// Phase 4c-next: UPF wiring for consent-aware proposal ranking
import { proposalToDescriptor } from "@/lib/upf/score-tracker-proposals";
import { selectNextProxy } from "@/lib/upf/select-next";
import { useConsentMap } from "@/lib/hooks/use-consent-map";
import { DATA_CATEGORY_META, type DataCategory } from "@/types/consent";
// Phase 4c-final: posterior lookup so already-observed proposals sink in rank
import { makePosteriorLookup, type PosteriorMap } from "@/lib/upf/posterior";

interface InfrastructureSectionProps {
  infrastructureMap: InfrastructureMap | undefined;
  infrastructureProposals: InfrastructureProposal[];
  entityMap: Map<string, Entity>;
  spaceId: string;
  /** Phase 4c-final: per-construct posteriors from synthesis_data. Optional —
   *  when absent, the selector falls back to nominal info-bits. */
  posteriors?: PosteriorMap;
}

// ── Color / icon maps ──

const ROLE_COLOR: Record<string, { bg: string; border: string; fg: string; dot: string }> = {
  hub: { bg: "rgba(79,70,229,0.08)", border: "rgba(79,70,229,0.25)", fg: "#4338CA", dot: "#6366F1" },
  input: { bg: "rgba(14,165,233,0.08)", border: "rgba(14,165,233,0.25)", fg: "#0369A1", dot: "#0EA5E9" },
  output: { bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.25)", fg: "#047857", dot: "#10B981" },
  processor: { bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.25)", fg: "#6D28D9", dot: "#8B5CF6" },
  monitor: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", fg: "#B45309", dot: "#F59E0B" },
  gate: { bg: "rgba(244,63,94,0.08)", border: "rgba(244,63,94,0.25)", fg: "#BE123C", dot: "#F43F5E" },
};

const STATUS_META: Record<string, { label: string; bg: string; fg: string; icon: ReactNode }> = {
  exists: {
    label: "exists",
    bg: "rgba(107,114,128,0.10)",
    fg: "#374151",
    icon: <CheckCircle2 className="w-2.5 h-2.5" />,
  },
  needs_strengthening: {
    label: "strengthen",
    bg: "rgba(245,158,11,0.12)",
    fg: "#B45309",
    icon: <RefreshCcw className="w-2.5 h-2.5" />,
  },
  needs_building: {
    label: "build",
    bg: "rgba(234,88,12,0.12)",
    fg: "#C2410C",
    icon: <Hammer className="w-2.5 h-2.5" />,
  },
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "#EF4444",
  important: "#F59E0B",
  supporting: "#9CA3AF",
};

const CHANNEL_COLOR: Record<string, { fg: string; bg: string }> = {
  data_flow: { fg: "#1D4ED8", bg: "rgba(29,78,216,0.08)" },
  feedback: { fg: "#6D28D9", bg: "rgba(109,40,217,0.08)" },
  control: { fg: "#BE123C", bg: "rgba(190,18,60,0.08)" },
  dependency: { fg: "#374151", bg: "rgba(55,65,81,0.08)" },
  amplification: { fg: "#047857", bg: "rgba(4,120,87,0.08)" },
};

const PROPOSAL_ICON: Record<string, ReactNode> = {
  app: <AppWindow className="w-3 h-3" />,
  tool: <Wrench className="w-3 h-3" />,
  dashboard: <LayoutDashboard className="w-3 h-3" />,
  workflow: <GitBranch className="w-3 h-3" />,
  integration: <Link2 className="w-3 h-3" />,
  monitor: <Activity className="w-3 h-3" />,
};

const COMPLEXITY_COLOR: Record<string, { bg: string; fg: string }> = {
  low: { bg: "rgba(16,185,129,0.10)", fg: "#047857" },
  medium: { bg: "rgba(245,158,11,0.12)", fg: "#B45309" },
  high: { bg: "rgba(244,63,94,0.12)", fg: "#BE123C" },
};

// ── Helpers ──

function resolveEntityName(id: string, entityMap: Map<string, Entity>): string {
  if (!id) return "—";
  if (id === "NEW") return "(new)";
  const hit = entityMap.get(id);
  return hit?.name ?? id;
}

// ── Main ──

export function InfrastructureSection({
  infrastructureMap,
  infrastructureProposals,
  entityMap,
  spaceId,
  posteriors,
}: InfrastructureSectionProps) {
  const components = infrastructureMap?.core_components ?? [];
  const channels = infrastructureMap?.key_channels ?? [];
  const loops = infrastructureMap?.activated_loops ?? [];
  const proposals = infrastructureProposals ?? [];

  // Phase 4c-next: rank proposals by info-per-friction, honouring consent.
  // We compute this every render — cheap because it's a pure in-memory pass
  // over ~5-20 items — but memoise against consent + proposals for tidy
  // React updates when either changes.
  const { allowed_categories, loaded: consentLoaded } = useConsentMap();
  const proposalRanking = useMemo(() => {
    if (proposals.length === 0) {
      return {
        topId: null as string | null,
        scoreById: new Map<string, { infoBits: number; friction: number; vpf: number; rationale: string }>(),
        filteredIds: new Set<string>(),
        missingCategoriesById: new Map<string, DataCategory[]>(),
        unlockPayoffByCategory: new Map<DataCategory, { count: number; bits: number }>(),
      };
    }
    const ctx = { entityLookup: (id: string) => entityMap.get(id) };
    const descriptors = proposals.map((p) => proposalToDescriptor(p, spaceId, ctx));
    const posteriorLookup = makePosteriorLookup(posteriors);
    const { top, ranked } = selectNextProxy(
      descriptors,
      { allowed_categories },
      posteriorLookup
    );
    const scoreById = new Map<string, { infoBits: number; friction: number; vpf: number; rationale: string }>();
    const filteredIds = new Set<string>();
    const missingCategoriesById = new Map<string, DataCategory[]>();
    const allowedSet = new Set(allowed_categories);
    // Phase 4c-final-v2: per-category unlock-payoff — if the user allows X,
    // how many proposals come back online and how many info-bits do they
    // collectively carry? Used to build a concrete CTA in the consent gate.
    const unlockPayoffByCategory = new Map<DataCategory, { count: number; bits: number }>();
    for (const r of ranked) {
      const proposalId = (r.descriptor.metadata?.proposal_id as string | undefined) ?? "";
      if (!proposalId) continue;
      scoreById.set(proposalId, {
        infoBits: r.score.expected_info_bits,
        friction: r.score.friction_cost,
        vpf: r.score.value_per_friction,
        rationale: r.score.rationale,
      });
      if (r.score.filtered_by_consent) {
        filteredIds.add(proposalId);
        const missing = r.descriptor.data_categories.filter((c) => !allowedSet.has(c));
        missingCategoriesById.set(proposalId, missing);
        // Attribute the proposal's bits evenly across categories that gate it.
        if (missing.length > 0) {
          const bitsShare = r.score.expected_info_bits / missing.length;
          for (const cat of missing) {
            const prev = unlockPayoffByCategory.get(cat) ?? { count: 0, bits: 0 };
            unlockPayoffByCategory.set(cat, {
              count: prev.count + 1,
              bits: prev.bits + bitsShare,
            });
          }
        }
      }
    }
    const topId = top
      ? ((top.metadata?.proposal_id as string | undefined) ?? null)
      : null;
    return {
      topId,
      scoreById,
      filteredIds,
      missingCategoriesById,
      unlockPayoffByCategory,
    };
  }, [proposals, entityMap, spaceId, allowed_categories, posteriors]);

  const filteredCount = proposalRanking.filteredIds.size;
  // Rank categories by their unlock value — biggest info-bit payoff first.
  const unlockPayoffEntries = Array.from(
    proposalRanking.unlockPayoffByCategory.entries()
  ).sort((a, b) => b[1].bits - a[1].bits);

  const hasAny =
    components.length > 0 ||
    channels.length > 0 ||
    loops.length > 0 ||
    proposals.length > 0;

  if (!hasAny) return null;

  return (
    <div className="relative">
      {/* Section header */}
      <div className="flex items-center gap-2.5 mb-2.5 px-0.5">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
          style={{
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            border: "1px solid rgba(11,13,18,0.14)",
            fontSize: 11,
            fontWeight: 700,
            color: "#0B0D12",
            letterSpacing: "-0.005em",
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.8) inset, 0 2px 6px rgba(11,13,18,0.04)",
          }}
        >
          <Network className="w-2.5 h-2.5" style={{ color: "rgba(11,13,18,0.48)" }} />
          Infrastructure Architecture
        </span>
        <span
          style={{
            fontSize: 11,
            color: "rgba(11,13,18,0.48)",
            fontWeight: 500,
          }}
        >
          {components.length} component{components.length === 1 ? "" : "s"}
          {channels.length > 0 && ` · ${channels.length} channel${channels.length === 1 ? "" : "s"}`}
          {proposals.length > 0 && ` · ${proposals.length} proposal${proposals.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Glass card container */}
      <div
        className="relative overflow-hidden rounded-[14px] p-5"
        style={{
          background: "rgba(255, 255, 255, 0.72)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          border: "1px solid rgba(11,13,18,0.14)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04), 0 12px 32px -16px rgba(var(--accent-rgb), 0.1)",
        }}
      >
        {/* 1. CORE COMPONENTS */}
        {components.length > 0 && (
          <div className="mb-5">
            <SubHeader label="Core Components" count={components.length} hint="entities to build, strengthen, or leverage" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {components.map((c, i) => (
                <ComponentCard key={`${c.entity_id}-${i}`} component={c} entityMap={entityMap} />
              ))}
            </div>
          </div>
        )}

        {/* 2. KEY CHANNELS */}
        {channels.length > 0 && (
          <div className="mb-5">
            <SubHeader label="Key Channels" count={channels.length} hint="how components connect and pass signal" />
            <div className="flex flex-col gap-1.5">
              {channels.map((ch, i) => (
                <ChannelRow key={i} channel={ch} entityMap={entityMap} />
              ))}
            </div>
          </div>
        )}

        {/* 3. ACTIVATED LOOPS */}
        {loops.length > 0 && (
          <div className="mb-5">
            <SubHeader label="Activated Loops" count={loops.length} hint="feedback loops that switch on" />
            <div className="flex flex-wrap gap-1.5">
              {loops.map((l, i) => (
                <LoopChip key={i} loop={l} />
              ))}
            </div>
          </div>
        )}

        {/* 4. INFRASTRUCTURE PROPOSALS */}
        {proposals.length > 0 && (
          <div>
            <SubHeader
              label="Supporting Tools to Build"
              count={proposals.length}
              hint="concrete tools, dashboards, and workflows"
            />

            {/* Phase 4c-next + final-v2: consent gate — explains WHY proposals are hidden,
                and now also quantifies the UNLOCK PAYOFF per category so the user can make
                an informed trade. "Unlocking Health Signals activates 3 proposals · ~5.4 bits". */}
            {consentLoaded && filteredCount > 0 && (
              <div
                className="mb-2 flex flex-col gap-1 rounded-lg px-3 py-2 text-[11.5px]"
                style={{
                  background: "rgba(99,102,241,0.06)",
                  border: "1px solid rgba(99,102,241,0.22)",
                  color: "#3730A3",
                }}
              >
                <div className="flex items-start gap-2">
                  <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span className="flex-1">
                    <span className="font-semibold">
                      {filteredCount} of {proposals.length} proposal{filteredCount === 1 ? "" : "s"} hidden
                    </span>{" "}
                    — they require data categories you haven&apos;t opted in to.
                  </span>
                  <Link
                    href="/app/settings"
                    className="font-semibold underline"
                    style={{ color: "#4F46E5" }}
                  >
                    Review →
                  </Link>
                </div>
                {unlockPayoffEntries.length > 0 && (
                  <div className="pl-5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px]" style={{ color: "rgba(55,48,163,0.80)" }}>
                    {unlockPayoffEntries.slice(0, 3).map(([cat, payoff]) => (
                      <span key={cat} title={`Allowing ${DATA_CATEGORY_META[cat]?.label ?? cat} on Settings would activate ${payoff.count} proposal${payoff.count === 1 ? "" : "s"} (estimated ${payoff.bits.toFixed(1)} info-bits).`}>
                        Unlock <span className="font-semibold">{DATA_CATEGORY_META[cat]?.label ?? cat}</span> → +{payoff.count} probe{payoff.count === 1 ? "" : "s"} · ~{payoff.bits.toFixed(1)} bits
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {proposals
                .slice()
                // Phase 4c-next: selector pick floats to the top; within the
                // rest, fall back to the LLM's priority field, then to id.
                .sort((a, b) => {
                  const aFiltered = proposalRanking.filteredIds.has(a.id);
                  const bFiltered = proposalRanking.filteredIds.has(b.id);
                  if (aFiltered !== bFiltered) return aFiltered ? 1 : -1;
                  if (proposalRanking.topId) {
                    if (a.id === proposalRanking.topId && b.id !== proposalRanking.topId) return -1;
                    if (b.id === proposalRanking.topId && a.id !== proposalRanking.topId) return 1;
                  }
                  const aVpf = proposalRanking.scoreById.get(a.id)?.vpf ?? 0;
                  const bVpf = proposalRanking.scoreById.get(b.id)?.vpf ?? 0;
                  if (bVpf !== aVpf) return bVpf - aVpf;
                  return (a.priority ?? 99) - (b.priority ?? 99);
                })
                .map((p) => {
                  const score = proposalRanking.scoreById.get(p.id);
                  const isSpotlit = p.id === proposalRanking.topId;
                  const isFiltered = proposalRanking.filteredIds.has(p.id);
                  const missing = proposalRanking.missingCategoriesById.get(p.id) ?? [];
                  return (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      spotlight={
                        isSpotlit && score
                          ? {
                              info_bits: score.infoBits,
                              friction: score.friction,
                              value_per_friction: score.vpf,
                              rationale: score.rationale,
                            }
                          : null
                      }
                      filtered={isFiltered}
                      missingCategories={missing}
                    />
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function SubHeader({ label, count, hint }: { label: string; count: number; hint: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2 px-0.5">
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "rgba(11,13,18,0.64)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "rgba(11,13,18,0.34)",
        }}
      >
        {count}
      </span>
      <span style={{ fontSize: 11, color: "rgba(11,13,18,0.42)", fontWeight: 500 }}>
        · {hint}
      </span>
    </div>
  );
}

function ComponentCard({
  component,
  entityMap,
}: {
  component: InfrastructureMap["core_components"][number];
  entityMap: Map<string, Entity>;
}) {
  const role = ROLE_COLOR[component.role] ?? ROLE_COLOR.processor;
  const status = STATUS_META[component.status] ?? STATUS_META.exists;
  const priorityColor = PRIORITY_COLOR[component.priority] ?? "#9CA3AF";
  const isNew = component.entity_id === "NEW";

  return (
    <div
      className="rounded-[10px] p-3"
      style={{
        background: "rgba(255,255,255,0.85)",
        border: "1px solid rgba(11,13,18,0.08)",
        borderLeft: `3px solid ${priorityColor}`,
        boxShadow: "0 1px 2px rgba(11,13,18,0.03)",
      }}
    >
      {/* Header: role + status */}
      <div className="flex items-center justify-between gap-1.5 mb-1.5">
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider"
          style={{ background: role.bg, color: role.fg, border: `1px solid ${role.border}` }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: role.dot }} />
          {component.role}
        </span>
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold"
          style={{ background: status.bg, color: status.fg }}
        >
          {status.icon}
          {status.label}
        </span>
      </div>

      {/* Name */}
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="font-bold text-[12.5px] leading-tight"
          style={{ color: "#0B0D12", letterSpacing: "-0.01em" }}
        >
          {component.entity_name}
        </span>
        {isNew && (
          <span
            className="text-[8.5px] font-bold uppercase tracking-wider px-1 py-[1px] rounded"
            style={{ background: "rgba(79,70,229,0.10)", color: "#4338CA" }}
          >
            NEW
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-[11px] leading-[1.4] text-gray-600 mb-2 line-clamp-3">
        {component.description}
      </p>

      {/* Connections */}
      {(component.receives_from?.length > 0 || component.produces_for?.length > 0) && (
        <div className="pt-2 border-t border-gray-100 flex flex-col gap-0.5">
          {component.receives_from?.length > 0 && (
            <ConnRow
              label="receives"
              entityIds={component.receives_from}
              entityMap={entityMap}
              direction="in"
            />
          )}
          {component.produces_for?.length > 0 && (
            <ConnRow
              label="produces"
              entityIds={component.produces_for}
              entityMap={entityMap}
              direction="out"
            />
          )}
        </div>
      )}
    </div>
  );
}

function ConnRow({
  label,
  entityIds,
  entityMap,
  direction,
}: {
  label: string;
  entityIds: string[];
  entityMap: Map<string, Entity>;
  direction: "in" | "out";
}) {
  const names = entityIds.slice(0, 3).map((id) => resolveEntityName(id, entityMap));
  const more = entityIds.length - 3;
  return (
    <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "rgba(11,13,18,0.64)" }}>
      <span
        className="font-semibold uppercase tracking-wider"
        style={{ fontSize: 9, color: "rgba(11,13,18,0.42)", minWidth: 46 }}
      >
        {label}
      </span>
      <span className="flex-1 truncate">
        {direction === "in" ? names.join(", ") : names.join(", ")}
        {more > 0 && (
          <span className="text-gray-400">{" "}+{more}</span>
        )}
      </span>
    </div>
  );
}

function ChannelRow({
  channel,
  entityMap,
}: {
  channel: InfrastructureMap["key_channels"][number];
  entityMap: Map<string, Entity>;
}) {
  const color = CHANNEL_COLOR[channel.channel_type] ?? CHANNEL_COLOR.dependency;
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
      style={{
        background: "rgba(255,255,255,0.70)",
        border: "1px solid rgba(11,13,18,0.06)",
      }}
    >
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider flex-shrink-0"
        style={{ background: color.bg, color: color.fg }}
      >
        {channel.channel_type.replace("_", " ")}
      </span>
      <span
        className="font-semibold text-[11.5px] truncate"
        style={{ color: "#0B0D12" }}
      >
        {resolveEntityName(channel.from, entityMap)}
      </span>
      <ArrowRight className="w-3 h-3 flex-shrink-0" style={{ color: "rgba(11,13,18,0.34)" }} />
      <span
        className="font-semibold text-[11.5px] truncate"
        style={{ color: "#0B0D12" }}
      >
        {resolveEntityName(channel.to, entityMap)}
      </span>
      {channel.description && (
        <span
          className="flex-1 text-[10.5px] truncate"
          style={{ color: "rgba(11,13,18,0.54)" }}
        >
          — {channel.description}
        </span>
      )}
      {!channel.exists && (
        <span
          className="inline-flex items-center gap-0.5 flex-shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-bold"
          style={{ background: "rgba(234,88,12,0.12)", color: "#C2410C" }}
        >
          <Hammer className="w-2.5 h-2.5" />
          needs build
        </span>
      )}
      <span
        className="inline-flex items-center text-[9.5px] font-semibold flex-shrink-0"
        style={{ color: channel.strength_needed === "strong" ? "#BE123C" : "rgba(11,13,18,0.42)" }}
      >
        {channel.strength_needed}
      </span>
    </div>
  );
}

function LoopChip({ loop }: { loop: InfrastructureMap["activated_loops"][number] }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
      style={{
        background: "rgba(245,158,11,0.08)",
        border: "1px solid rgba(245,158,11,0.22)",
      }}
    >
      <CircleDot className="w-3 h-3" style={{ color: "#B45309" }} />
      <span className="text-[11.5px] font-bold" style={{ color: "#B45309" }}>
        {loop.name}
      </span>
      <span className="text-[10px]" style={{ color: "rgba(11,13,18,0.54)" }}>
        · {loop.activation_phase}
      </span>
      {loop.role_in_strategy && (
        <span className="text-[10px] italic" style={{ color: "rgba(11,13,18,0.42)" }}>
          — {loop.role_in_strategy}
        </span>
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  spotlight,
  filtered,
  missingCategories,
}: {
  proposal: InfrastructureProposal;
  spotlight?: {
    info_bits: number;
    friction: number;
    value_per_friction: number;
    rationale: string;
  } | null;
  filtered?: boolean;
  missingCategories?: DataCategory[];
}) {
  const icon = PROPOSAL_ICON[proposal.type] ?? <Wrench className="w-3 h-3" />;
  const complexity = COMPLEXITY_COLOR[proposal.complexity] ?? COMPLEXITY_COLOR.medium;
  const missing = missingCategories ?? [];

  return (
    <div
      className="rounded-[10px] p-3 flex flex-col"
      style={{
        background: filtered
          ? "rgba(245,245,248,0.70)"
          : spotlight
            ? "rgba(238,242,255,0.92)"
            : "rgba(255,255,255,0.88)",
        border: spotlight
          ? "1px solid rgba(79,70,229,0.45)"
          : "1px solid rgba(11,13,18,0.08)",
        boxShadow: spotlight
          ? "0 0 0 2px rgba(99,102,241,0.18), 0 2px 6px rgba(79,70,229,0.10)"
          : "0 1px 2px rgba(11,13,18,0.03)",
        opacity: filtered ? 0.68 : 1,
      }}
    >
      {/* Phase 4c-next: spotlight chip — visible only on the selector's top pick. */}
      {spotlight && !filtered && (
        <div
          className="inline-flex items-center gap-1 self-start mb-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
          style={{
            background: "rgba(79,70,229,0.10)",
            color: "#4338CA",
            border: "1px solid rgba(79,70,229,0.25)",
          }}
          title={`Info-gain: ${spotlight.info_bits.toFixed(2)} bits · Friction: ${spotlight.friction.toFixed(2)} · Score: ${spotlight.value_per_friction.toFixed(1)} · ${spotlight.rationale}`}
        >
          <span>🎯</span>
          <span>Top pick · {spotlight.value_per_friction.toFixed(1)}× v/f</span>
        </div>
      )}
      {filtered && (
        <div
          className="inline-flex items-center gap-1 self-start mb-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
          style={{
            background: "rgba(99,102,241,0.08)",
            color: "#3730A3",
            border: "1px solid rgba(99,102,241,0.20)",
          }}
          title={`Requires data you haven't opted in to: ${missing.map((c) => DATA_CATEGORY_META[c]?.label ?? c).join(", ")}`}
        >
          <Lock className="w-2.5 h-2.5" />
          <span>
            Needs consent
            {missing.length > 0
              ? ` · ${missing.map((c) => DATA_CATEGORY_META[c]?.label ?? c).join(", ")}`
              : ""}
          </span>
        </div>
      )}

      {/* Header: type + complexity */}
      <div className="flex items-center justify-between gap-1.5 mb-1.5">
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider"
          style={{ background: "rgba(79,70,229,0.08)", color: "#4338CA", border: "1px solid rgba(79,70,229,0.18)" }}
        >
          {icon}
          {proposal.type}
        </span>
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-semibold uppercase tracking-wider"
          style={{ background: complexity.bg, color: complexity.fg }}
        >
          {proposal.complexity}
        </span>
      </div>

      {/* Name */}
      <p
        className="font-bold text-[12.5px] leading-tight mb-1"
        style={{ color: "#0B0D12", letterSpacing: "-0.01em" }}
      >
        {proposal.name}
      </p>

      {/* Description */}
      <p className="text-[11px] leading-[1.4] text-gray-600 mb-2 line-clamp-3">
        {proposal.description}
      </p>

      {/* Source perspective */}
      {proposal.source_perspective && (
        <div className="mb-2">
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-semibold"
            style={{ background: "rgba(11,13,18,0.04)", color: "rgba(11,13,18,0.64)" }}
          >
            serves · {proposal.source_perspective}
          </span>
        </div>
      )}

      {/* Metrics tracked */}
      {proposal.metrics_tracked?.length > 0 && (
        <div className="mt-auto pt-2 border-t border-gray-100">
          <div
            className="text-[9px] font-bold uppercase tracking-wider mb-1"
            style={{ color: "rgba(11,13,18,0.42)" }}
          >
            Tracks
          </div>
          <div className="flex flex-wrap gap-1">
            {proposal.metrics_tracked.slice(0, 4).map((m, i) => (
              <span
                key={i}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold"
                style={{ background: "rgba(16,185,129,0.10)", color: "#047857" }}
              >
                {m}
              </span>
            ))}
            {proposal.metrics_tracked.length > 4 && (
              <span className="text-[10px] text-gray-400 font-semibold">
                +{proposal.metrics_tracked.length - 4}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
