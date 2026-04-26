"use client";

// ── Objective Tree widget (VP Project — "what we're steering toward") ─────
//
// Renders the `improvement_goals` hierarchy as a recursive tree: a single
// ultimate goal at the root, sub-objectives nested beneath. Each node
// shows status (active/achieved/paused/abandoned), objective_type
// (maximize/minimize/maintain/explore/avoid), baseline → current → target
// progress, and optional deadline. Clicking a node toggles expand/collapse.
//
// Data source: `goal_tree` resolver returns a `GoalTreeNode` — the space's
// ultimate goal already composed with its children. The widget does zero
// tree-building at render time; the page-level resolver memoizes the
// composition from the flat improvement_goals array.
//
// When no parent exists (space without an explicit ultimate goal) the
// widget renders the full set of root-level goals as sibling trees.

import { useState } from "react";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import type { GoalTreeNode, GoalStatus, ObjectiveType } from "@/types/goals";
import { Surface, WidgetTitle, WidgetEmpty } from "./shared";
import { cn } from "@/lib/utils";

interface ObjectiveTreeConfig {
  title?: string;
  /** Default depth to auto-expand. Default 2 (root + immediate children). */
  defaultExpandDepth?: number;
}

// Status → dot color. Matches the status lexicon used across the goals UI.
const STATUS_DOT: Record<GoalStatus, string> = {
  active: "#10b981",
  achieved: "#0ea5e9",
  paused: "#f59e0b",
  abandoned: "#94a3b8",
};

// Objective type → glyph. Micro-iconography kept text-based so it
// renders cleanly at every zoom level without asset loading.
const TYPE_GLYPH: Record<ObjectiveType, string> = {
  maximize: "↑",
  minimize: "↓",
  maintain: "=",
  explore: "?",
  avoid: "⊘",
};

const TYPE_COLOR: Record<ObjectiveType, string> = {
  maximize: "#10b981",
  minimize: "#ef4444",
  maintain: "#6366f1",
  explore: "#a855f7",
  avoid: "#f59e0b",
};

export function ObjectiveTree({
  instance,
  context,
}: WidgetComponentProps<ObjectiveTreeConfig>) {
  const cfg = instance.config ?? {};
  const treeRes = context.resolve<GoalTreeNode | GoalTreeNode[] | null>(
    instance.bindings?.tree,
  );
  const tree = treeRes.value ?? null;

  // Normalize to an array of root nodes — handles both single-root
  // (ultimate goal) and multi-root (no parent synthesized yet) cases
  // without the caller having to branch at binding time.
  const roots: GoalTreeNode[] = Array.isArray(tree)
    ? tree
    : tree
      ? [tree]
      : [];

  if (roots.length === 0) {
    return (
      <Surface density="comfortable">
        <WidgetTitle
          eyebrow="Objectives"
          title={cfg.title ?? "Objective tree"}
        />
        <WidgetEmpty>
          No objectives captured yet. These land after the user accepts
          suggested objectives from the synthesis review.
        </WidgetEmpty>
      </Surface>
    );
  }

  // Quick top-level summary: total, achieved, active
  const allNodes = roots.flatMap((r) => flattenTree(r));
  const activeCount = allNodes.filter((n) => n.status === "active").length;
  const achievedCount = allNodes.filter((n) => n.status === "achieved").length;

  return (
    <Surface density="comfortable">
      <WidgetTitle
        eyebrow="Objectives"
        title={cfg.title ?? "Objective tree"}
        subtitle={`${allNodes.length} goals — ${activeCount} active · ${achievedCount} achieved`}
      />
      <div className="mt-3 space-y-2.5">
        {roots.map((root) => (
          <TreeNode
            key={root.id}
            node={root}
            depth={0}
            defaultExpandDepth={cfg.defaultExpandDepth ?? 2}
          />
        ))}
      </div>
    </Surface>
  );
}

// ── Recursive node ───────────────────────────────────────────────────

function TreeNode({
  node,
  depth,
  defaultExpandDepth,
}: {
  node: GoalTreeNode;
  depth: number;
  defaultExpandDepth: number;
}) {
  const [expanded, setExpanded] = useState(depth < defaultExpandDepth);
  const hasChildren = node.children.length > 0;
  const statusColor = STATUS_DOT[node.status];
  const typeGlyph = TYPE_GLYPH[node.objective_type];
  const typeColor = TYPE_COLOR[node.objective_type];

  // Progress fraction: 0..1 from baseline → target, clamped. Handles both
  // maximize ("higher is better") and minimize ("lower is better") by
  // flipping the numerator when target < baseline.
  const progress = computeProgress(
    node.baseline_value,
    node.current_value,
    node.target_value,
  );
  const progressPct = Math.round(progress * 100);

  // Indentation bar — a single subtle vertical line per depth level.
  const indent = depth * 16;

  return (
    <div>
      <div
        className={cn(
          "group/node flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors",
          "hover:bg-gray-50/70",
        )}
        style={{ paddingLeft: `${indent + 8}px` }}
      >
        {/* Expand chevron / leaf spacer */}
        <button
          type="button"
          onClick={() => hasChildren && setExpanded((v) => !v)}
          className={cn(
            "mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[10px] text-gray-400",
            hasChildren
              ? "cursor-pointer hover:bg-gray-200/60 hover:text-gray-700"
              : "cursor-default opacity-30",
          )}
          aria-label={hasChildren ? (expanded ? "Collapse" : "Expand") : "Leaf"}
        >
          {hasChildren ? (expanded ? "▾" : "▸") : "·"}
        </button>

        {/* Status dot */}
        <span
          className="mt-1 h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: statusColor }}
          title={`Status: ${node.status}`}
        />

        <div className="min-w-0 flex-1">
          {/* Row 1: type glyph + title + current/target */}
          <div className="flex items-center gap-1.5">
            <span
              className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-sm text-[10px] font-bold"
              style={{ background: `${typeColor}22`, color: typeColor }}
              title={`Objective type: ${node.objective_type}`}
            >
              {typeGlyph}
            </span>
            <span className="truncate text-[12.5px] font-semibold text-gray-900">
              {node.title}
            </span>
          </div>

          {/* Row 2: metric + progress bar + progress % */}
          <div className="mt-1 flex items-center gap-2 text-[10.5px] text-gray-500">
            <span className="truncate font-medium text-gray-600">
              {node.metric_name}
            </span>
            <div className="h-1 min-w-[48px] flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progressPct}%`,
                  background: typeColor,
                  opacity: node.status === "achieved" ? 0.6 : 1,
                }}
              />
            </div>
            <span className="flex-shrink-0 tabular-nums font-semibold text-gray-700">
              {progressPct}%
            </span>
            <span className="hidden flex-shrink-0 text-gray-400 md:inline">
              {formatValue(node.current_value, node.metric_unit)}
              <span className="mx-0.5 text-gray-300">→</span>
              {formatValue(node.target_value, node.metric_unit)}
            </span>
          </div>

          {/* Deadline pill, only if set */}
          {node.deadline && (
            <div className="mt-0.5 text-[9.5px] text-gray-400">
              Due {formatDate(node.deadline)}
            </div>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="mt-0.5 space-y-0.5 border-l border-gray-200/60" style={{ marginLeft: `${indent + 16}px` }}>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function flattenTree(node: GoalTreeNode): GoalTreeNode[] {
  return [node, ...node.children.flatMap((c) => flattenTree(c))];
}

function computeProgress(
  baseline: number,
  current: number,
  target: number,
): number {
  // Edge case: baseline === target. Avoid divide-by-zero; report 1 if
  // current reached, else 0.
  if (baseline === target) {
    return current === target ? 1 : 0;
  }
  const total = target - baseline;
  const progressed = current - baseline;
  // Normalize direction: dividing by total flips the sign correctly for
  // minimize objectives (target < baseline).
  const ratio = progressed / total;
  return Math.max(0, Math.min(1, ratio));
}

function formatValue(v: number, unit: string | null): string {
  const formatted =
    Math.abs(v) >= 1000
      ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit ? `${formatted}${unit}` : formatted;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
