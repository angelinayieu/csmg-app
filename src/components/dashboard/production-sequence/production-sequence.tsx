"use client";

/**
 * Production Sequence — the per-project dashboard's causal production line.
 *
 *   Information ─▶ Sub-Objectives ─▶ Interventions ─▶ Apps
 *
 * Each stage is a glass pill showing its count. Clicking a stage expands a
 * horizontal strip of its items below. Only one stage is expanded at a time.
 *
 * Connectors between stages are SVG paths with a soft bend + animated stroke
 * that signal causal flow from left to right.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import { useApps } from "@/lib/hooks/use-apps";
import { useInterventions } from "@/lib/hooks/use-interventions";
import type { Intervention } from "@/types/intervention";
import type { AppView } from "@/lib/hooks/use-apps";
import type { ImprovementGoal } from "@/types/goals";

const EASE = [0.22, 1, 0.36, 1] as const;

type StageKey = "information" | "sub_objectives" | "interventions" | "apps";

interface StageSpec {
  key: StageKey;
  label: string;
  caption: string;
}

const STAGES: StageSpec[] = [
  { key: "information", label: "Information", caption: "synthesized" },
  { key: "sub_objectives", label: "Sub-Objectives", caption: "active" },
  { key: "interventions", label: "Interventions", caption: "assigned" },
  { key: "apps", label: "Apps", caption: "generated" },
];

export function ProductionSequence({
  spaceId,
  onAppClick,
}: {
  spaceId: string;
  onAppClick?: (appId: string) => void;
}) {
  const [expanded, setExpanded] = useState<StageKey | null>(null);
  const spaceData = useSpaceData();
  const { apps } = useApps(spaceId);
  const { interventions } = useInterventions({ spaceId });

  // Stage counts + items ──────────────────────────────────────────────
  const stageData = useMemo(() => {
    const synth = (spaceData.space?.synthesis_data as Record<string, unknown> | null) ?? null;
    const leverage = (synth?.leverage_points as unknown[] | undefined) ?? [];
    const risks = (synth?.risk_points as unknown[] | undefined) ?? [];
    const loops = (synth?.feedback_loops as unknown[] | undefined) ?? [];
    const infoItems = buildInfoItems(leverage, risks, loops);

    const childGoals = (spaceData.goals ?? []).filter(
      (g) => g.parent_goal_id === spaceData.activeGoal?.id
    );
    const subObjItems = buildSubObjectiveItems(childGoals);

    const interventionItems = buildInterventionItems(interventions);
    const appItems = buildAppItems(apps);

    return {
      information: { count: infoItems.length, items: infoItems },
      sub_objectives: { count: subObjItems.length, items: subObjItems },
      interventions: { count: interventionItems.length, items: interventionItems },
      apps: { count: appItems.length, items: appItems },
    } as const;
  }, [spaceData, apps, interventions]);

  const handleToggle = (key: StageKey) =>
    setExpanded((cur) => (cur === key ? null : key));

  const expandedData = expanded ? stageData[expanded] : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE, delay: 0.08 }}
      className="glass-card relative rounded-[18px] px-6 py-5"
      aria-label="Production sequence"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[color:var(--muted-fg,#6b7280)]">
            Production Sequence
          </span>
          <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
            · information → apps
          </span>
        </div>
        <button
          onClick={() => setExpanded(null)}
          disabled={expanded === null}
          className="rounded-full px-2.5 py-1 text-[11px] font-medium text-[color:var(--muted-fg,#86868b)] transition-colors hover:bg-black/5 disabled:opacity-0"
        >
          Collapse
        </button>
      </div>

      {/* Stage row — 4 pills with SVG connectors behind them */}
      <div className="relative">
        <StageConnectors />
        <div className="relative z-10 grid grid-cols-4 gap-4">
          {STAGES.map((stage) => {
            const data = stageData[stage.key];
            return (
              <StagePill
                key={stage.key}
                spec={stage}
                count={data.count}
                active={expanded === stage.key}
                onClick={() => handleToggle(stage.key)}
              />
            );
          })}
        </div>
      </div>

      {/* Expanded panel */}
      <AnimatePresence initial={false}>
        {expandedData ? (
          <motion.div
            key={expanded}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-5 border-t border-white/40 pt-4">
              <ExpandedList
                items={expandedData.items}
                emptyText={emptyTextForStage(expanded!)}
                onItemClick={
                  expanded === "apps" && onAppClick
                    ? (id) => onAppClick(id)
                    : undefined
                }
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}

// ── Stage pill ───────────────────────────────────────────────────────

function StagePill({
  spec,
  count,
  active,
  onClick,
}: {
  spec: StageSpec;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.2, ease: EASE }}
      className={`group relative flex flex-col items-start rounded-2xl px-5 py-4 text-left transition-all ${
        active
          ? "bg-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.06)] ring-1 ring-white/60"
          : "bg-white/40 hover:bg-white/55 ring-1 ring-white/40"
      }`}
      style={{
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
      }}
      aria-expanded={active}
      aria-label={`${spec.label}: ${count} ${spec.caption}`}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[color:var(--muted-fg,#6b7280)]">
          {spec.label}
        </span>
        <motion.svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          animate={{ rotate: active ? 180 : 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          className="text-[color:var(--muted-fg,#86868b)]"
        >
          <path d="M3.5 5.5 L7 9 L10.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </motion.svg>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[color:var(--fg,#1d1d1f)]">
          {count}
        </span>
        <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">{spec.caption}</span>
      </div>

      {/* Active state accent underline */}
      {active ? (
        <motion.div
          layoutId="stage-active-underline"
          className="absolute inset-x-4 bottom-1.5 h-[2px] rounded-full"
          style={{ background: "rgb(var(--accent-rgb))" }}
          transition={{ duration: 0.25, ease: EASE }}
        />
      ) : null}
    </motion.button>
  );
}

// ── Connectors (SVG overlay) ─────────────────────────────────────────

function StageConnectors() {
  // Draws 3 horizontal connector tubes between the 4 pills.
  // Positioned absolutely; pill grid sits above (z-10).
  // Each connector has a soft bend + an animated gradient stroke.
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-[32px] w-full"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="connector-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.05" />
          <stop offset="50%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.3" />
          <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      {/* 3 segments: between columns 1-2, 2-3, 3-4. 4 columns across viewBox width 100 = 25 each. */}
      {[0, 1, 2].map((i) => {
        const startX = 25 * (i + 1) - 4;
        const endX = 25 * (i + 1) + 4;
        const midX = 25 * (i + 1);
        return (
          <g key={i}>
            {/* Subtle bend — curve upward slightly in middle, landing flat on both ends */}
            <path
              d={`M ${startX} 5 C ${startX + 2} 5 ${midX - 2} 4.5 ${midX} 4.5 C ${midX + 2} 4.5 ${endX - 2} 5 ${endX} 5`}
              stroke="url(#connector-grad)"
              strokeWidth="0.5"
              fill="none"
              strokeLinecap="round"
            />
            {/* Flow dot animation */}
            <circle r="0.35" fill="rgb(var(--accent-rgb))" opacity="0.8">
              <animateMotion
                dur="2.8s"
                repeatCount="indefinite"
                begin={`${i * 0.6}s`}
                path={`M ${startX} 5 C ${startX + 2} 5 ${midX - 2} 4.5 ${midX} 4.5 C ${midX + 2} 4.5 ${endX - 2} 5 ${endX} 5`}
              />
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

// ── Expanded list ────────────────────────────────────────────────────

interface ListItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  accent?: "default" | "leverage" | "risk" | "loop" | "success";
}

function ExpandedList({
  items,
  emptyText,
  onItemClick,
}: {
  items: ListItem[];
  emptyText: string;
  onItemClick?: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-[13px] text-[color:var(--muted-fg,#86868b)]">{emptyText}</p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it, idx) => (
        <motion.button
          key={it.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: EASE, delay: idx * 0.02 }}
          whileHover={{ y: -1 }}
          onClick={onItemClick ? () => onItemClick(it.id) : undefined}
          disabled={!onItemClick}
          className={`group flex items-center gap-2 rounded-full border border-white/50 bg-white/40 px-3 py-1.5 text-[12px] backdrop-blur-md transition-colors hover:bg-white/60 ${
            onItemClick ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <AccentDot kind={it.accent ?? "default"} />
          <span className="max-w-[240px] truncate font-medium text-[color:var(--fg,#1d1d1f)]">
            {it.title}
          </span>
          {it.subtitle ? (
            <span className="text-[color:var(--muted-fg,#86868b)]">
              {"· "}
              {it.subtitle}
            </span>
          ) : null}
          {it.badge ? (
            <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted-fg,#6b7280)]">
              {it.badge}
            </span>
          ) : null}
        </motion.button>
      ))}
    </div>
  );
}

function AccentDot({ kind }: { kind: NonNullable<ListItem["accent"]> }) {
  const palette: Record<NonNullable<ListItem["accent"]>, string> = {
    default: "rgb(var(--accent-rgb))",
    leverage: "#0A84FF",
    risk: "#FF453A",
    loop: "#AF52DE",
    success: "#30D158",
  };
  return (
    <span
      className="h-[7px] w-[7px] shrink-0 rounded-full"
      style={{
        background: palette[kind],
        boxShadow: `0 0 6px ${palette[kind]}`,
      }}
    />
  );
}

// ── Item builders ────────────────────────────────────────────────────

function buildInfoItems(
  leverage: unknown[],
  risks: unknown[],
  loops: unknown[]
): ListItem[] {
  const items: ListItem[] = [];
  for (const lp of leverage.slice(0, 6)) {
    const r = lp as { entity_name?: string; reason?: string; id?: string; entity_id?: string };
    items.push({
      id: `lp:${r.id ?? r.entity_id ?? Math.random()}`,
      title: r.entity_name ?? "Leverage point",
      subtitle: truncate(r.reason, 60),
      accent: "leverage",
      badge: "lev",
    });
  }
  for (const rp of risks.slice(0, 6)) {
    const r = rp as { entity_name?: string; reason?: string; id?: string; entity_id?: string };
    items.push({
      id: `risk:${r.id ?? r.entity_id ?? Math.random()}`,
      title: r.entity_name ?? "Risk point",
      subtitle: truncate(r.reason, 60),
      accent: "risk",
      badge: "risk",
    });
  }
  for (const lp of loops.slice(0, 4)) {
    const r = lp as { name?: string; loop_type?: string; id?: string };
    items.push({
      id: `loop:${r.id ?? Math.random()}`,
      title: r.name ?? "Feedback loop",
      subtitle: r.loop_type,
      accent: "loop",
      badge: "loop",
    });
  }
  return items;
}

function buildSubObjectiveItems(childGoals: ImprovementGoal[]): ListItem[] {
  return childGoals.map((g) => {
    const progress =
      g.target_value !== g.baseline_value
        ? Math.max(
            0,
            Math.min(
              100,
              ((g.current_value - g.baseline_value) / (g.target_value - g.baseline_value)) * 100
            )
          )
        : null;
    return {
      id: g.id,
      title: g.title,
      subtitle: progress != null ? `${Math.round(progress)}% to target` : g.metric_name,
      accent: g.status === "achieved" ? "success" : "default",
      badge: g.status !== "active" ? g.status : undefined,
    };
  });
}

function buildInterventionItems(interventions: Intervention[]): ListItem[] {
  return interventions.slice(0, 20).map((iv) => ({
    id: iv.id,
    title: iv.title,
    subtitle:
      iv.target_entity_name ??
      iv.target_entity_code ??
      (iv.timeframe ? iv.timeframe.replace("_", " ") : undefined),
    accent:
      iv.status === "completed"
        ? "success"
        : iv.impact === "high"
          ? "leverage"
          : iv.impact === "low"
            ? "default"
            : "default",
    badge: iv.effort && iv.impact ? `${iv.effort}/${iv.impact}` : undefined,
  }));
}

function buildAppItems(apps: AppView[]): ListItem[] {
  return apps.map((a) => ({
    id: a.id,
    title: a.name,
    subtitle: a.app_type,
    accent:
      a.status === "active"
        ? "success"
        : a.status === "retired"
          ? "default"
          : "leverage",
    badge: a.intervention_count != null ? `${a.intervention_count} int` : undefined,
  }));
}

function emptyTextForStage(key: StageKey): string {
  switch (key) {
    case "information":
      return "No synthesis findings yet — run the pipeline to surface leverage, risk, and loop information.";
    case "sub_objectives":
      return "No sub-objectives — add them from the objectives panel to break the main goal into measurable pieces.";
    case "interventions":
      return "No interventions yet — they're generated from the strategy. Run strategy-refresh to materialize them.";
    case "apps":
      return "No apps yet — apps are materialized alongside interventions when the strategy runs.";
  }
}

function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  return s.length <= max ? s : s.slice(0, max) + "…";
}
