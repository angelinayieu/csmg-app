"use client";

// ── Twin Flow Hub ──────────────────────────────────────────────────────
//
// Condensed representation of THIS USER'S SPECIFIC TWIN — not a generic
// pipeline chart. Renders:
//
//   • Core node   = the user's ultimate goal title (what they're working
//                   toward), with current pipeline state as subtitle.
//   • Input       = entity count + cycles — what the twin consumes.
//   • Insights    = count + most recent convergence concern_label on hover.
//   • Strategy    = the approved recommendation's title + tactic count.
//   • Apps        = count + the top N app names on hover.
//
// Below the SVG a "Latest insight" strip surfaces the actual content of
// the freshest insight_convergence so the user sees substance, not just
// numerals. All nodes deep-link to the page where that output lives.
//
// Data sources (all pulled from the ALREADY-APPROVED twin, not generic
// pipeline metadata):
//   • activeGoal                                  → core identity
//   • synthesis_data.strategic_recommendation     → strategy title
//   • synthesis_data.insight_convergences         → concern labels
//   • /api/apps payload (parent poll)             → app names + counts
//   • liveCounts                                  → entities + cycles

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { Space } from "@/types";
import type { ImprovementGoal } from "@/types/goals";
import type { SynthesisData, InsightConvergence } from "@/types/synthesis";
import {
  Layers,
  Zap,
  Sparkles,
  Target,
  Rocket,
} from "lucide-react";

export type TwinCoreState =
  | "live"
  | "confirmed"
  | "strategy_ready"
  | "apps_building"
  | "idle";

export interface AppBrief {
  id: string;
  name: string;
  status?: string;
  serves_goal_id?: string | null;
}

interface Props {
  space: Space;
  liveCounts: { entities: number; edges: number; cycles: number };
  state: TwinCoreState;
  /** Parent already polled /api/apps — pass the full list so we can use names. */
  apps: AppBrief[];
  /** The user's ultimate goal (activeGoal from SpaceData context). */
  activeGoal: ImprovementGoal | null;
  spaceId: string;
  /** Whole-card click handler — opens the expand modal. */
  onExpand: () => void;
}

// ── Palette ─────────────────────────────────────────────────────────────

const PALETTE = {
  scope:    { stroke: "#9CA3AF", text: "#374151", glow: "rgba(107,114,128,0.16)" },
  core:     { stroke: "#2F4BD4", text: "#FFFFFF", glow: "rgba(59,91,219,0.35)" },
  insights: { stroke: "#0E7490", text: "#164E63", glow: "rgba(14,116,144,0.18)" },
  strategy: { stroke: "#4F46E5", text: "#3730A3", glow: "rgba(79,70,229,0.18)" },
  apps:     { stroke: "#059669", text: "#065F46", glow: "rgba(5,150,105,0.18)" },
} as const;

// ── Derive user-specific data ───────────────────────────────────────────

interface HubData {
  core: {
    title: string;    // ultimate goal title OR "Twin not initialized"
    subtitle: string; // state label like "Approved" / "Running"
    hasGoal: boolean;
  };
  scope: {
    count: number;
    cycles: number;
  };
  insights: {
    count: number;
    strong: number;
    /** Top 3 concern labels — shown in tooltip + latest-insight strip. */
    samples: string[];
  };
  strategy: {
    title: string | null; // approved strategy title (or null when none)
    tactics: number;
    perspectives: number;
    approved: boolean;
  };
  apps: {
    count: number;
    /** Top 3 app names — shown in tooltip. */
    samples: string[];
  };
}

function parseSynth(raw: unknown): SynthesisData | null {
  if (!raw) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as any;
  } catch {
    return null;
  }
}

function stateLabel(state: TwinCoreState): string {
  switch (state) {
    case "live": return "Running";
    case "apps_building": return "Building apps";
    case "confirmed": return "Approved";
    case "strategy_ready": return "Review pending";
    default: return "Not initialized";
  }
}

function deriveData(
  space: Space,
  liveCounts: { entities: number; edges: number; cycles: number },
  apps: AppBrief[],
  activeGoal: ImprovementGoal | null,
  state: TwinCoreState,
): HubData {
  const synth = parseSynth(space.synthesis_data);
  // Core identity: prefer the user's ultimate goal, fall back to space name.
  const core = activeGoal
    ? {
        title: activeGoal.title,
        subtitle: stateLabel(state),
        hasGoal: true,
      }
    : {
        title: space.name,
        subtitle: stateLabel(state),
        hasGoal: false,
      };

  const convergences = (synth?.insight_convergences ?? []) as InsightConvergence[];
  const strong = convergences.filter((c) => c.strength === "strong");
  // Prefer strong convergences first in the samples, then any others.
  const orderedSamples = [...strong, ...convergences.filter((c) => c.strength !== "strong")]
    .map((c) => c.concern_label)
    .slice(0, 3);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stratRec = (synth as any)?.strategic_recommendation as any;
  const rec = stratRec?.recommendation ?? stratRec ?? null;
  const stratTitle = typeof rec?.title === "string" ? rec.title : null;
  const tactics = Array.isArray(rec?.micro_tactics) ? rec.micro_tactics.length : 0;
  const perspectives = Array.isArray(rec?.perspectives) ? rec.perspectives.length : 0;
  const approved = stratRec?.status === "confirmed";

  return {
    core,
    scope: { count: liveCounts.entities, cycles: liveCounts.cycles },
    insights: {
      count: convergences.length,
      strong: strong.length,
      samples: orderedSamples,
    },
    strategy: { title: stratTitle, tactics, perspectives, approved },
    apps: {
      count: apps.length,
      samples: apps.slice(0, 3).map((a) => a.name),
    },
  };
}

// ── Activity (same as before — drives flow intensity) ───────────────────

interface LaneActivity {
  scope: number;
  insights: number;
  strategy: number;
  apps: number;
}

function deriveActivity(state: TwinCoreState, data: HubData): LaneActivity {
  const base: LaneActivity = {
    scope: data.scope.count > 0 ? 0.4 : 0.15,
    insights: data.insights.count > 0 ? 0.35 : 0.08,
    strategy: data.strategy.tactics > 0 ? 0.35 : 0.08,
    apps: data.apps.count > 0 ? 0.35 : 0.08,
  };
  switch (state) {
    case "live":
      return { ...base, insights: Math.max(base.insights, 0.75), strategy: Math.max(base.strategy, 0.55) };
    case "strategy_ready":
      return { ...base, strategy: 0.95 };
    case "apps_building":
      return { ...base, apps: 0.95, strategy: Math.max(base.strategy, 0.5) };
    case "confirmed":
      return { scope: 0.55, insights: Math.max(base.insights, 0.55), strategy: 0.75, apps: Math.max(base.apps, 0.7) };
    default:
      return base;
  }
}

// ── Layout ──────────────────────────────────────────────────────────────

const VIEW = { w: 360, h: 240 };
const CORE = { cx: 150, cy: 120, r: 38 };
const SCOPE_NODE = { cx: 42, cy: 120, r: 24 };
const OUT = {
  insights: { cx: 306, cy: 50,  r: 22 },
  strategy: { cx: 326, cy: 120, r: 22 },
  apps:     { cx: 306, cy: 190, r: 22 },
} as const;

function flowPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

// Truncate a long label to fit inside a node or strip.
function trunc(s: string, max: number): string {
  if (!s) return "—";
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ── Component ───────────────────────────────────────────────────────────

export function TwinFlowHub({
  space,
  liveCounts,
  state,
  apps,
  activeGoal,
  spaceId,
  onExpand,
}: Props) {
  const router = useRouter();
  const data = useMemo(
    () => deriveData(space, liveCounts, apps, activeGoal, state),
    [space, liveCounts, apps, activeGoal, state],
  );
  const activity = useMemo(() => deriveActivity(state, data), [state, data]);

  // Rotate through insight samples every 4s in the bottom strip.
  const [insightIdx, setInsightIdx] = useState(0);
  useEffect(() => {
    if (data.insights.samples.length < 2) return;
    const id = setInterval(() => {
      setInsightIdx((i) => (i + 1) % data.insights.samples.length);
    }, 4000);
    return () => clearInterval(id);
  }, [data.insights.samples.length]);
  const currentInsight =
    data.insights.samples[insightIdx % Math.max(1, data.insights.samples.length)] ?? null;

  // Router helpers — each endpoint deep-links to its page.
  const goto = (href: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(href);
  };

  return (
    <div
      className="relative w-full h-full flex flex-col"
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onExpand();
      }}
      aria-label="Open full twin view"
    >
      {/* Header strip — identifies whose twin this is */}
      <div className="flex items-start justify-between gap-2 px-1 pb-1">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] uppercase tracking-wider font-semibold text-gray-400">
            {data.core.hasGoal ? "Your twin" : "Twin draft"}
          </p>
          <p className="text-[11px] font-semibold text-gray-800 truncate leading-tight">
            {trunc(data.core.title, 52)}
          </p>
        </div>
        <p className="text-[9px] text-gray-400 pt-[2px] whitespace-nowrap">
          Attention flow
        </p>
      </div>

      <svg
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        className="w-full flex-1 min-h-0"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Twin flow hub"
      >
        <defs>
          <radialGradient id="tfh-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3B5BDB" stopOpacity="0.32" />
            <stop offset="60%" stopColor="#3B5BDB" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#3B5BDB" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="tfh-core-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4F6BE6" />
            <stop offset="100%" stopColor="#2F4BD4" />
          </linearGradient>
          <linearGradient id="tfh-node-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#F3F4F6" />
          </linearGradient>
        </defs>

        <circle cx={CORE.cx} cy={CORE.cy} r={CORE.r + 26} fill="url(#tfh-core-glow)" />

        {/* Flow lines */}
        <FlowLine
          d={flowPath(SCOPE_NODE.cx + SCOPE_NODE.r, SCOPE_NODE.cy, CORE.cx - CORE.r, CORE.cy)}
          color={PALETTE.scope.stroke}
          activity={activity.scope}
          direction="in"
        />
        <FlowLine
          d={flowPath(CORE.cx + CORE.r, CORE.cy, OUT.insights.cx - OUT.insights.r, OUT.insights.cy)}
          color={PALETTE.insights.stroke}
          activity={activity.insights}
          direction="out"
        />
        <FlowLine
          d={flowPath(CORE.cx + CORE.r, CORE.cy, OUT.strategy.cx - OUT.strategy.r, OUT.strategy.cy)}
          color={PALETTE.strategy.stroke}
          activity={activity.strategy}
          direction="out"
        />
        <FlowLine
          d={flowPath(CORE.cx + CORE.r, CORE.cy, OUT.apps.cx - OUT.apps.r, OUT.apps.cy)}
          color={PALETTE.apps.stroke}
          activity={activity.apps}
          direction="out"
        />

        {/* Scope input — shows entity count */}
        <EndpointNode
          cx={SCOPE_NODE.cx}
          cy={SCOPE_NODE.cy}
          r={SCOPE_NODE.r}
          palette={PALETTE.scope}
          icon="layers"
          label="Scope"
          value={`${data.scope.count}`}
          sublabel={`${data.scope.cycles} cycles`}
          tooltip={`${data.scope.count} entities · ${data.scope.cycles} cycles in scope`}
          onClick={goto(`/app/space/${spaceId}/inventory`)}
        />

        {/* Core — the user's specific goal */}
        <motion.g
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <circle
            cx={CORE.cx}
            cy={CORE.cy}
            r={CORE.r}
            fill="url(#tfh-core-fill)"
            stroke={PALETTE.core.stroke}
            strokeWidth={1.5}
            style={{ filter: `drop-shadow(0 6px 12px ${PALETTE.core.glow})` }}
          />
          {/* Inner highlight */}
          <path
            d={`M ${CORE.cx - CORE.r * 0.6} ${CORE.cy - CORE.r * 0.4}
                Q ${CORE.cx} ${CORE.cy - CORE.r * 0.95}
                  ${CORE.cx + CORE.r * 0.6} ${CORE.cy - CORE.r * 0.4}`}
            fill="none"
            stroke="white"
            strokeOpacity={0.35}
            strokeWidth={1.2}
          />
          <Zap
            x={CORE.cx - 9}
            y={CORE.cy - 20}
            width={18}
            height={18}
            color="white"
            strokeWidth={2.2}
          />
          {/* Core SUBTITLE = pipeline state */}
          <text
            x={CORE.cx}
            y={CORE.cy + 2}
            textAnchor="middle"
            fontSize={8.5}
            fontWeight={700}
            fill="rgba(255,255,255,0.78)"
            style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            {data.core.subtitle}
          </text>
          {/* Core IDENTITY = first 2 lines of the ultimate goal title, wrapped */}
          <foreignObject
            x={CORE.cx - CORE.r + 6}
            y={CORE.cy + 6}
            width={CORE.r * 2 - 12}
            height={CORE.r - 10}
            style={{ pointerEvents: "none" }}
          >
            <div
              style={{
                color: "white",
                fontSize: "8.5px",
                fontWeight: 600,
                textAlign: "center",
                lineHeight: 1.15,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                padding: "0 2px",
              }}
            >
              {trunc(data.core.title, 32)}
            </div>
          </foreignObject>
          <title>
            {data.core.hasGoal
              ? `Ultimate goal: ${data.core.title}`
              : "No ultimate goal set — approve intake to initialize the twin."}
          </title>
        </motion.g>

        {/* Insights output — samples in tooltip */}
        <EndpointNode
          cx={OUT.insights.cx}
          cy={OUT.insights.cy}
          r={OUT.insights.r}
          palette={PALETTE.insights}
          icon="sparkles"
          label="Insights"
          value={data.insights.count === 0 ? "—" : `${data.insights.count}`}
          sublabel={
            data.insights.strong > 0
              ? `${data.insights.strong} strong`
              : data.insights.count > 0
                ? "convergences"
                : "awaiting"
          }
          tooltip={
            data.insights.samples.length > 0
              ? `Convergences:\n${data.insights.samples.map((s) => `• ${s}`).join("\n")}`
              : "No insight convergences yet."
          }
          onClick={goto(`/app/space/${spaceId}/convergence`)}
        />

        {/* Strategy output — shows the approved strategy's title in tooltip */}
        <EndpointNode
          cx={OUT.strategy.cx}
          cy={OUT.strategy.cy}
          r={OUT.strategy.r}
          palette={PALETTE.strategy}
          icon="target"
          label="Strategy"
          value={data.strategy.tactics === 0 ? "—" : `${data.strategy.tactics}`}
          sublabel={data.strategy.approved ? "approved" : "tactics"}
          tooltip={
            data.strategy.title
              ? `${data.strategy.approved ? "Approved" : "Drafted"} strategy: ${data.strategy.title}\n${data.strategy.tactics} tactics · ${data.strategy.perspectives} perspectives`
              : "No strategy drafted yet."
          }
          onClick={goto(`/app/space/${spaceId}/strategy`)}
        />

        {/* Apps output — app names in tooltip */}
        <EndpointNode
          cx={OUT.apps.cx}
          cy={OUT.apps.cy}
          r={OUT.apps.r}
          palette={PALETTE.apps}
          icon="rocket"
          label="Apps"
          value={data.apps.count === 0 ? "—" : `${data.apps.count}`}
          sublabel="materialized"
          tooltip={
            data.apps.samples.length > 0
              ? `Your apps:\n${data.apps.samples.map((s) => `• ${s}`).join("\n")}${data.apps.count > data.apps.samples.length ? `\n…and ${data.apps.count - data.apps.samples.length} more` : ""}`
              : "Approve a strategy to materialize apps."
          }
          onClick={goto(`/app/space/${spaceId}/apps`)}
        />
      </svg>

      {/* Latest insight / strategy strip — the CONTENT layer, not just counts.
          Rotates every 4s when multiple insights exist. If no insights but
          an approved strategy exists, show the strategy title instead. */}
      <LatestStrip
        insight={currentInsight}
        strategyTitle={data.strategy.title}
        strategyApproved={data.strategy.approved}
        hasInsights={data.insights.samples.length > 0}
        activeKey={insightIdx}
      />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function FlowLine({
  d,
  color,
  activity,
  direction,
}: {
  d: string;
  color: string;
  activity: number;
  direction: "in" | "out";
}) {
  const strokeWidth = 1 + activity * 2.5;
  const opacity = 0.25 + activity * 0.55;
  const duration = Math.max(1.5, 6 - activity * 4.5);
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeOpacity={0.14}
        strokeWidth={strokeWidth + 0.5}
        strokeLinecap="round"
      />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeOpacity={opacity}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray="4 6"
      >
        <animate
          attributeName="stroke-dashoffset"
          from={direction === "in" ? "10" : "0"}
          to={direction === "in" ? "0" : "-10"}
          dur={`${duration}s`}
          repeatCount="indefinite"
        />
      </path>
    </g>
  );
}

function EndpointNode({
  cx,
  cy,
  r,
  palette,
  icon,
  label,
  value,
  sublabel,
  tooltip,
  onClick,
}: {
  cx: number;
  cy: number;
  r: number;
  palette: { stroke: string; text: string; glow: string };
  icon: "layers" | "sparkles" | "target" | "rocket";
  label: string;
  value: string;
  sublabel: string;
  tooltip: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const Icon =
    icon === "layers" ? Layers :
    icon === "sparkles" ? Sparkles :
    icon === "target" ? Target :
    Rocket;
  return (
    <motion.g
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      style={{ cursor: "pointer", transformBox: "fill-box", transformOrigin: "center" }}
      onClick={onClick}
    >
      <circle cx={cx} cy={cy} r={r + 6} fill={palette.glow} opacity={0.4} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="url(#tfh-node-fill)"
        stroke={palette.stroke}
        strokeOpacity={0.55}
        strokeWidth={1.5}
        style={{ filter: `drop-shadow(0 2px 4px ${palette.glow})` }}
      />
      <circle
        cx={cx}
        cy={cy}
        r={r - 1}
        fill="none"
        stroke={palette.stroke}
        strokeOpacity={0.18}
        strokeWidth={1}
      />
      <Icon
        x={cx - 7}
        y={cy - 13}
        width={14}
        height={14}
        color={palette.stroke}
        strokeWidth={2}
      />
      <text
        x={cx}
        y={cy + 8}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill={palette.text}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </text>
      <text
        x={cx}
        y={cy + r + 11}
        textAnchor="middle"
        fontSize={9}
        fontWeight={600}
        fill={palette.text}
      >
        {label}
      </text>
      <text
        x={cx}
        y={cy + r + 21}
        textAnchor="middle"
        fontSize={8}
        fontWeight={500}
        fill="#9CA3AF"
      >
        {sublabel}
      </text>
      <title>{tooltip}</title>
    </motion.g>
  );
}

function LatestStrip({
  insight,
  strategyTitle,
  strategyApproved,
  hasInsights,
  activeKey,
}: {
  insight: string | null;
  strategyTitle: string | null;
  strategyApproved: boolean;
  hasInsights: boolean;
  activeKey: number;
}) {
  // Decide what to show: insight content when available; else strategy title
  // when we have an approved/drafted strategy; else a "pre-intake" placeholder.
  let kind: "insight" | "strategy" | "empty";
  let text: string;
  if (hasInsights && insight) {
    kind = "insight";
    text = insight;
  } else if (strategyTitle) {
    kind = "strategy";
    text = strategyTitle;
  } else {
    kind = "empty";
    text = "Run synthesis to generate your specific twin.";
  }

  const accent =
    kind === "insight"
      ? { dot: "#0E7490", bg: "rgba(14,116,144,0.06)", ring: "rgba(14,116,144,0.2)" }
      : kind === "strategy"
        ? { dot: "#4F46E5", bg: "rgba(79,70,229,0.06)", ring: "rgba(79,70,229,0.2)" }
        : { dot: "#9CA3AF", bg: "rgba(107,114,128,0.05)", ring: "rgba(107,114,128,0.18)" };

  const label =
    kind === "insight"
      ? "Latest convergent insight"
      : kind === "strategy"
        ? strategyApproved
          ? "Your approved strategy"
          : "Draft strategy"
        : "Status";

  return (
    <div
      className="mt-1 rounded-lg px-2.5 py-1.5 ring-1 flex items-center gap-2"
      style={{ background: accent.bg, borderColor: accent.ring }}
    >
      <span className="flex items-center gap-1 shrink-0">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: accent.dot }}
        />
        <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </span>
      </span>
      <div className="flex-1 min-w-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.p
            key={`${kind}-${activeKey}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="text-[10.5px] text-gray-800 truncate"
          >
            {text}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
