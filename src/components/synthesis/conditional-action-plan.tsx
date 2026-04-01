"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ActionItem } from "@/types";

interface ConditionalActionPlanProps {
  actionItems: ActionItem[];
}

const paths = [
  { label: "Builder", key: "builder", icon: "⚡", desc: "Solo execution path", color: "#007AFF" },
  { label: "Team", key: "team", icon: "👥", desc: "With collaborators", color: "#34C759" },
  { label: "Pivot", key: "pivot", icon: "🔄", desc: "If approach needs changing", color: "#FF9500" },
] as const;

const timeframeLabels: Record<string, { label: string; badge: string }> = {
  today: { label: "Today", badge: "!" },
  this_week: { label: "This week", badge: "7" },
  this_month: { label: "This month", badge: "30" },
  after_validation: { label: "After validation", badge: "✓" },
};

const timeframeOrder = ["today", "this_week", "this_month", "after_validation"];

export function ConditionalActionPlan({ actionItems }: ConditionalActionPlanProps) {
  // Determine which paths have action items
  const availablePaths = paths.filter(
    (p) => actionItems.some((a) => a.path_label === p.key) || p.key === "builder"
  );

  // If there's only "default" path items, show them under "builder"
  const hasConditionalPaths = actionItems.some(
    (a) => a.path_label && a.path_label !== "default"
  );

  const [activePath, setActivePath] = useState(availablePaths[0]?.key ?? "builder");

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
                <span className="text-sm">{p.icon}</span>
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
                  <div key={item.id ?? i} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="text-[13px] font-medium leading-relaxed text-gray-800">
                      {item.action_text}
                    </div>
                    {item.why_text && (
                      <div className="mt-1 text-xs leading-relaxed text-gray-500">
                        {item.why_text}
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
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
