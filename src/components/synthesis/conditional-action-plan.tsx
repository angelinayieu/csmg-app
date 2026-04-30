"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Zap, Users, RotateCcw, Clock, FlaskConical, ChevronDown, Link2 } from "lucide-react";
import { useExecutionBrief } from "@/lib/hooks/use-execution-brief";
import { ExecutionBriefPanel } from "@/components/strategy/execution-brief-panel";
import type { ActionItem } from "@/types";
import type { RichActionPlan, ActionItemRich } from "@/types/synthesis";

interface ConditionalActionPlanProps {
  actionItems: ActionItem[];
  richActionPlan?: RichActionPlan;
  sequencingRationale?: string;
  spaceId: string;
  onToggleActionDone?: (actionId: string, done: boolean) => void;
}

const paths = [
  { label: "Builder", key: "builder" as const, icon: <Zap className="h-3.5 w-3.5" />, desc: "Solo execution path", color: "#007AFF" },
  { label: "Team", key: "team" as const, icon: <Users className="h-3.5 w-3.5" />, desc: "With collaborators", color: "#34C759" },
  { label: "Pivot", key: "pivot" as const, icon: <RotateCcw className="h-3.5 w-3.5" />, desc: "If approach needs changing", color: "#FF9500" },
];

const timeframeLabels: Record<string, { label: string; badge: string }> = {
  today: { label: "Today", badge: "!" },
  this_week: { label: "This week", badge: "7" },
  this_month: { label: "This month", badge: "30" },
  after_validation: { label: "After validation", badge: "✓" },
};

const timeframeOrder = ["today", "this_week", "this_month", "after_validation"];

// ── Wrapper: DB action item + execution brief ──

function DbActionItemWithBrief({
  item,
  index,
  spaceId,
  onToggleActionDone,
}: {
  item: ActionItem;
  index: number;
  spaceId: string;
  onToggleActionDone?: (actionId: string, done: boolean) => void;
}) {
  const [briefOpen, setBriefOpen] = useState(false);
  const isDone = item.status === "completed";

  const { brief, loading, error, generate } = useExecutionBrief({
    spaceId,
    recommendationId: item.id ?? `action-${index}`,
    recommendationType: "action_item",
    recommendationTitle: item.action_text,
    recommendationText: [item.action_text, item.why_text].filter(Boolean).join(" — "),
    relatedEntityIds: item.derived_from_entity_id ? [item.derived_from_entity_id] : [],
  });

  const handleToggleBrief = () => {
    const opening = !briefOpen;
    setBriefOpen(opening);
    if (opening && !brief && !loading) generate();
  };

  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2">
        {/* Completion toggle */}
        {onToggleActionDone && item.id && (
          <button
            onClick={() => onToggleActionDone(item.id, !isDone)}
            className={cn(
              "mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors",
              isDone
                ? "border-green-400 bg-green-100 text-green-600"
                : "border-gray-300 bg-white text-transparent hover:border-gray-400"
            )}
          >
            {isDone && (
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className={cn(
            "text-[13px] font-medium leading-relaxed",
            isDone ? "text-gray-400 line-through" : "text-gray-800"
          )}>
            {item.action_text}
          </div>
          {item.why_text && (
            <div className={cn("mt-1 text-xs leading-relaxed", isDone ? "text-gray-300" : "text-gray-500")}>
              {item.why_text}
            </div>
          )}
          {isDone && item.completed_at && (
            <div className="mt-0.5 text-[9px] text-green-500">
              Done {new Date(item.completed_at).toLocaleDateString()}
            </div>
          )}
          {item.tags && Array.isArray(item.tags) && item.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(item.tags as { t: string; c: string }[]).map(
                (tag, ti) => (
                  <span
                    key={ti}
                    className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                    style={{
                      backgroundColor: `${tag.c}12`,
                      color: tag.c,
                    }}
                  >
                    {tag.t}
                  </span>
                )
              )}
            </div>
          )}
          {/* Execution brief toggle */}
          <button
            onClick={handleToggleBrief}
            className={cn(
              "mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
              briefOpen
                ? "bg-indigo-100 text-indigo-700"
                : "bg-gray-100 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600"
            )}
          >
            <FlaskConical className="h-3 w-3" />
            Execution brief
            <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", briefOpen && "rotate-180")} />
          </button>
        </div>
      </div>
      {/* Brief panel */}
      {briefOpen && (
        <div className="mt-2 ml-6">
          <ExecutionBriefPanel
            brief={brief}
            loading={loading}
            error={error}
            onGenerate={generate}
            testLabParams={{
              spaceId,
              recommendationId: item.id ?? `action-${index}`,
              recommendationTitle: item.action_text,
              recommendationText: [item.action_text, item.why_text].filter(Boolean).join(" — "),
              relatedEntityIds: item.derived_from_entity_id ? [item.derived_from_entity_id] : [],
            }}
          />
        </div>
      )}
    </div>
  );
}

export function ConditionalActionPlan({ actionItems, richActionPlan, sequencingRationale, spaceId, onToggleActionDone }: ConditionalActionPlanProps) {
  // Otherwise fall back to DB action items
  // Determine which paths have action items
  const availablePaths = paths.filter(
    (p) => actionItems.some((a) => a.path_label === p.key) || p.key === "builder"
  );

  // If there's only "default" path items, show them under "builder"
  const hasConditionalPaths = actionItems.some(
    (a) => a.path_label && a.path_label !== "default"
  );

  // useState must run before the rich-action-plan early return below
  // — when richActionPlan transitions from null → present, skipping
  // the hook here would crash React with a hook-count mismatch.
  const [activePath, setActivePath] = useState(availablePaths[0]?.key ?? "builder");

  // If we have rich action plan from Pass 3, render that
  if (richActionPlan?.paths?.length) {
    return <RichActionPlanRenderer paths={richActionPlan.paths} sequencingRationale={sequencingRationale} spaceId={spaceId} />;
  }

  // Filter items for active path
  const pathItems = actionItems.filter((a) => {
    if (hasConditionalPaths) {
      return a.path_label === activePath;
    }
    // If no conditional paths, show all items regardless of path_label
    return true;
  });

  // Group by timeframe
  const grouped = new Map<string, ActionItem[]>();
  for (const tf of timeframeOrder) {
    const items = pathItems.filter((a) => a.timeframe === tf);
    if (items.length > 0) {
      grouped.set(tf, items);
    }
  }

  if (actionItems.length === 0) return null;

  const activePathConfig = paths.find((p) => p.key === activePath) ?? paths[0];

  return (
    <div>
      {/* Path switcher — only show if there are conditional paths */}
      {hasConditionalPaths && (
        <div className="mb-4 flex gap-1.5">
          {availablePaths.map((p) => (
            <button
              key={p.key}
              onClick={() => setActivePath(p.key)}
              className={cn(
                "flex-1 rounded-xl border p-3 text-left transition-all duration-200",
                activePath === p.key
                  ? "border-opacity-40 bg-opacity-5"
                  : "border-gray-200 bg-gray-50/60"
              )}
              style={{
                borderColor:
                  activePath === p.key ? `${p.color}66` : undefined,
                backgroundColor:
                  activePath === p.key ? `${p.color}08` : undefined,
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="flex items-center">{p.icon}</span>
                <span
                  className="text-xs font-semibold"
                  style={{
                    color: activePath === p.key ? p.color : "#86868b",
                  }}
                >
                  {p.label}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-gray-400">{p.desc}</div>
            </button>
          ))}
        </div>
      )}

      {/* Time-sequenced groups */}
      <div className="space-y-3">
        {Array.from(grouped.entries()).map(([timeframe, items]) => {
          const tf = timeframeLabels[timeframe] ?? {
            label: timeframe,
            badge: "•",
          };
          return (
            <div
              key={timeframe}
              className="rounded-xl border border-gray-200 bg-gray-50/60 p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <div
                  className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold"
                  style={{
                    backgroundColor: `${activePathConfig.color}15`,
                    color: activePathConfig.color,
                  }}
                >
                  {tf.badge}
                </div>
                <span className="text-xs font-semibold text-gray-700">
                  {tf.label}
                </span>
              </div>
              <div className="divide-y divide-gray-200">
                {items.map((item, i) => (
                  <DbActionItemWithBrief
                    key={item.id ?? i}
                    item={item}
                    index={i}
                    spaceId={spaceId}
                    onToggleActionDone={onToggleActionDone}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const dynamicRoleConfig: Record<string, { bg: string; text: string; label: string }> = {
  clears_threshold: { bg: "bg-red-50", text: "text-red-600", label: "clears threshold" },
  starts_loop: { bg: "bg-green-50", text: "text-green-600", label: "starts loop" },
  accelerates_loop: { bg: "bg-blue-50", text: "text-blue-600", label: "accelerates loop" },
  linear_improvement: { bg: "bg-gray-100", text: "text-gray-500", label: "linear" },
  can_defer: { bg: "bg-gray-50", text: "text-gray-400", label: "can defer" },
};

// ── Wrapper: Rich action item + execution brief ──

function RichActionItemWithBrief({
  action,
  index,
  pathLabel,
  timeframeLabel,
  spaceId,
}: {
  action: ActionItemRich;
  index: number;
  pathLabel: string;
  timeframeLabel: string;
  spaceId: string;
}) {
  const [briefOpen, setBriefOpen] = useState(false);
  const [chainOpen, setChainOpen] = useState(false);
  const roleStyle = action.dynamic_role ? dynamicRoleConfig[action.dynamic_role] : null;
  const chain = action.supporting_chain;
  const chainHasRefs = chain && (
    (chain.axiom_ids?.length ?? 0) +
    (chain.leverage_entity_ids?.length ?? 0) +
    (chain.risk_entity_ids?.length ?? 0) +
    (chain.hidden_signal_refs?.length ?? 0) +
    (chain.cycle_refs?.length ?? 0) +
    (chain.insight_convergence_ids?.length ?? 0) +
    (chain.bottleneck_entity_id ? 1 : 0) > 0
  );

  const { brief, loading, error, generate } = useExecutionBrief({
    spaceId,
    recommendationId: `rich-action-${pathLabel}-${timeframeLabel}-${index}`,
    recommendationType: "action_item",
    recommendationTitle: action.text,
    recommendationText: [action.text, action.why].filter(Boolean).join(" — "),
  });

  const handleToggleBrief = () => {
    const opening = !briefOpen;
    setBriefOpen(opening);
    if (opening && !brief && !loading) generate();
  };

  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <div className="text-[13px] font-medium leading-relaxed text-gray-800">
          {action.text}
        </div>
        {roleStyle && (
          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium", roleStyle.bg, roleStyle.text)}>
            {roleStyle.label}
          </span>
        )}
      </div>
      {action.why && (
        <div className="mt-1 text-xs leading-relaxed text-gray-500">
          {action.why}
        </div>
      )}
      {action.cost_of_delay && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600">
          <Clock className="h-3 w-3" /> {action.cost_of_delay}
        </div>
      )}
      {action.tags?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {action.tags.map((tag, ti) => (
            <span
              key={ti}
              className="rounded px-1.5 py-0.5 text-[9px] font-medium"
              style={{
                backgroundColor: `${tag.c}12`,
                color: tag.c,
              }}
            >
              {tag.t}
            </span>
          ))}
        </div>
      )}
      {/* Toggle row: Why this action? + Execution brief */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {chainHasRefs && (
          <button
            onClick={() => setChainOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
              chainOpen
                ? "bg-purple-100 text-purple-700"
                : "bg-gray-100 text-gray-500 hover:bg-purple-50 hover:text-purple-600"
            )}
          >
            <Link2 className="h-3 w-3" />
            Why this action?
            <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", chainOpen && "rotate-180")} />
          </button>
        )}
        <button
          onClick={handleToggleBrief}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
            briefOpen
              ? "bg-indigo-100 text-indigo-700"
              : "bg-gray-100 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600"
          )}
        >
          <FlaskConical className="h-3 w-3" />
          Execution brief
          <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", briefOpen && "rotate-180")} />
        </button>
      </div>
      {/* Supporting chain panel */}
      {chainOpen && chain && (
        <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50/40 p-2.5 space-y-1.5">
          {chain.rationale && (
            <p className="text-[11px] leading-relaxed text-gray-700 italic">
              {chain.rationale}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {chain.bottleneck_entity_id && (
              <span className="rounded-full bg-red-50 border border-red-200 px-1.5 py-0.5 text-[9px] font-medium text-red-700">
                bottleneck: {chain.bottleneck_entity_id}
              </span>
            )}
            {chain.axiom_ids?.map((id) => (
              <span key={`ax-${id}`} className="rounded-full bg-purple-50 border border-purple-200 px-1.5 py-0.5 text-[9px] font-medium text-purple-700">
                axiom {id}
              </span>
            ))}
            {chain.leverage_entity_ids?.map((id) => (
              <span key={`lv-${id}`} className="rounded-full bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
                leverage: {id}
              </span>
            ))}
            {chain.risk_entity_ids?.map((id) => (
              <span key={`rk-${id}`} className="rounded-full bg-orange-50 border border-orange-200 px-1.5 py-0.5 text-[9px] font-medium text-orange-700">
                risk: {id}
              </span>
            ))}
            {chain.insight_convergence_ids?.map((id) => (
              <span key={`cv-${id}`} className="rounded-full bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[9px] font-medium text-indigo-700">
                cluster: {id}
              </span>
            ))}
            {chain.hidden_signal_refs?.map((s, i) => (
              <span key={`hs-${i}`} className="rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                signal: {s}
              </span>
            ))}
            {chain.cycle_refs?.map((c, i) => (
              <span key={`cy-${i}`} className="rounded-full bg-teal-50 border border-teal-200 px-1.5 py-0.5 text-[9px] font-medium text-teal-700">
                loop: {c}
              </span>
            ))}
          </div>
        </div>
      )}
      {/* Brief panel */}
      {briefOpen && (
        <div className="mt-2">
          <ExecutionBriefPanel
            brief={brief}
            loading={loading}
            error={error}
            onGenerate={generate}
            testLabParams={{
              spaceId,
              recommendationId: `rich-action-${pathLabel}-${timeframeLabel}-${index}`,
              recommendationTitle: action.text,
              recommendationText: [action.text, action.why].filter(Boolean).join(" — "),
            }}
          />
        </div>
      )}
    </div>
  );
}

// Rich action plan renderer for Pass 3 data
function RichActionPlanRenderer({ paths: actionPaths, sequencingRationale, spaceId }: { paths: RichActionPlan["paths"]; sequencingRationale?: string; spaceId: string }) {
  const [activePath, setActivePath] = useState(0);
  const currentPath = actionPaths[activePath];

  if (!currentPath) return null;

  return (
    <div>
      {/* Sequencing rationale callout */}
      {sequencingRationale && (
        <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
          <p className="text-[12px] italic leading-relaxed text-blue-700">
            {sequencingRationale}
          </p>
        </div>
      )}

      {/* Path switcher */}
      {actionPaths.length > 1 && (
        <div className="mb-4 flex gap-1.5">
          {actionPaths.map((p, pi) => (
            <button
              key={pi}
              onClick={() => setActivePath(pi)}
              className={cn(
                "flex-1 rounded-xl border p-3 text-left transition-all duration-200",
                activePath === pi
                  ? "border-opacity-40 bg-opacity-5"
                  : "border-gray-200 bg-gray-50/60"
              )}
              style={{
                borderColor:
                  activePath === pi ? `${p.color}66` : undefined,
                backgroundColor:
                  activePath === pi ? `${p.color}08` : undefined,
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="flex items-center">{p.icon}</span>
                <span
                  className="text-xs font-semibold"
                  style={{
                    color: activePath === pi ? p.color : "#86868b",
                  }}
                >
                  {p.label}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-gray-400 leading-snug">
                {p.description}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Time-sequenced groups */}
      <div className="space-y-3">
        {currentPath.timeframes.map((tf, tfi) => (
          <div
            key={tfi}
            className="rounded-xl border border-gray-200 bg-gray-50/60 p-4"
          >
            <div className="mb-3 flex items-center gap-2">
              <div
                className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold"
                style={{
                  backgroundColor: `${currentPath.color}15`,
                  color: currentPath.color,
                }}
              >
                {tf.badge}
              </div>
              <span className="text-xs font-semibold text-gray-700">
                {tf.label}
              </span>
            </div>
            <div className="divide-y divide-gray-200">
              {tf.actions.map((action, ai) => (
                <RichActionItemWithBrief
                  key={ai}
                  action={action}
                  index={ai}
                  pathLabel={currentPath.label}
                  timeframeLabel={tf.label}
                  spaceId={spaceId}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
