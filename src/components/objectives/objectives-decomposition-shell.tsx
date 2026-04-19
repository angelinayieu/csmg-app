"use client";

import {
  useState,
  useMemo,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
  type CSSProperties,
} from "react";
import { cn } from "@/lib/utils";
import {
  Check,
  Plus,
  ChevronDown,
  Zap,
  User,
  Network,
  Search,
  Target,
} from "lucide-react";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";

export interface ObjectivesDecompositionShellProps {
  /** The active tracked goal (L1 root). If null, uses highest-priority pending objective as root. */
  primaryGoal: ImprovementGoal | null;
  /** Full flat list of accepted goals — used to walk the child tree. */
  allGoals: ImprovementGoal[];
  /** Pending suggestions from synthesis (not yet accepted). */
  suggestedObjectives: SuggestedObjective[];
  /** User accepts a suggestion — creates an ImprovementGoal. */
  onAccept?: (obj: SuggestedObjective) => void | Promise<void>;
  /** User requests sub-objective generation for an existing goal (LLM-driven). */
  onDecompose?: (goalId: string) => void | Promise<void>;
  /**
   * User wants to MANUALLY add a sub-goal under a parent. Opens the goal
   * setter with parent_goal_id prefilled. Distinct from onDecompose (which
   * is LLM-driven auto-decomposition).
   */
  onAddSubGoal?: (parentGoalId: string) => void;
  /** User drills into a dedicated sub-space for the goal. */
  onCreateSubSpace?: (goalId: string) => void | Promise<void>;
  /** Navigate to an existing space. */
  onNavigateToSpace?: (spaceId: string) => void;
  /** User clicks a goal card header to activate it. */
  onGoalClick?: (goal: ImprovementGoal) => void;
  /** "full" = header + body + tree. "compact" = header only (overview teaser). */
  variant?: "full" | "compact";
  /** Whether the body is open on mount. */
  initiallyExpanded?: boolean;
}

// ─── Types ──────────────────────────────────────────────────────────────
type TreeNode = {
  id: string;
  kind: "goal" | "suggestion";
  data: ImprovementGoal | SuggestedObjective;
  level: 1 | 2 | 3;
  label: string; // "2.1", "a", or "✓"
  children: TreeNode[];
  parentId: string | null;
};

type AnyObjective = ImprovementGoal | SuggestedObjective;

// ─── Style tokens ───────────────────────────────────────────────────────
const S = {
  missionIconBg:
    "linear-gradient(145deg, #0a1020 0%, #1f2d5a 55%, #0051ff 110%)",
  missionIconShadow:
    "inset 0 1px 0 rgba(255,255,255,0.25), 0 12px 32px rgba(0,30,140,0.35), 0 4px 12px rgba(0,30,140,0.2)",
  missionSweep:
    "conic-gradient(from 0deg, rgba(79,163,255,0) 0deg, rgba(79,163,255,0.5) 60deg, rgba(79,163,255,0) 120deg)",

  numberGradient: "linear-gradient(180deg, #0a56d6 20%, #1a7aff 100%)",
  numberDropshadow: "drop-shadow(0 2px 8px rgba(10,90,230,0.25))",

  expandBtnBg: "linear-gradient(180deg, #2d8cff, #0051ff)",
  expandBtnShadow:
    "0 10px 24px rgba(0,90,255,0.38), inset 0 1px 0 rgba(255,255,255,0.5)",

  trackedBg: "rgba(42,208,109,0.15)",
  trackedBorder: "rgba(42,208,109,0.35)",
  trackedColor: "#1a9553",

  trackBg: "linear-gradient(180deg, #2d8cff, #0051ff)",
  trackShadow:
    "0 6px 14px rgba(0,90,255,0.32), inset 0 1px 0 rgba(255,255,255,0.4)",

  progressFill:
    "linear-gradient(90deg, #4fa3ff 0%, #0051ff 60%, #5856d6 100%)",
  progressGlow: "0 0 16px rgba(26,122,255,0.5)",

  shellBg: "rgba(255, 255, 255, 0.82)",
  shellBorder: "1px solid rgba(255, 255, 255, 0.85)",
  shellShadow:
    "0 40px 100px -30px rgba(8,60,180,0.28), 0 18px 40px -18px rgba(8,60,180,0.18), inset 0 1.5px 0 rgba(255,255,255,1), inset 0 0 0 1px rgba(255,255,255,0.35)",
  shellShadowExpanded:
    "0 60px 140px -40px rgba(8,60,180,0.36), 0 24px 60px -24px rgba(8,60,180,0.24), inset 0 1.5px 0 rgba(255,255,255,1), inset 0 0 0 1px rgba(255,255,255,0.45)",
  shellInnerTint:
    "linear-gradient(180deg, rgba(240,245,255,0.5), rgba(255,255,255,0))",

  cardBg: "rgba(255,255,255,0.65)",
  cardBorder: "1px solid rgba(255,255,255,0.9)",
  cardShadow:
    "0 10px 28px -12px rgba(8,60,180,0.18), inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(255,255,255,0.3)",

  l1Bg: "rgba(26,122,255,0.15)",
  l1Color: "#0051ff",
  l2Bg: "rgba(88,86,214,0.15)",
  l2Color: "#3c44d9",
  l3Bg: "rgba(255,149,0,0.18)",
  l3Color: "#c77400",

  kaBg: "linear-gradient(180deg, rgba(255,220,175,0.55), rgba(255,200,150,0.42))",
  kaBorder: "1px solid rgba(230,160,90,0.35)",
  kaIconBg: "linear-gradient(180deg, #ffc07a, #e88e3a)",

  tagUserBg: "rgba(42,208,109,0.12)",
  tagUserBorder: "rgba(42,208,109,0.3)",
  tagUserText: "#1a9553",
  tagConceptBg: "rgba(26,122,255,0.1)",
  tagConceptBorder: "rgba(26,122,255,0.28)",
  tagConceptText: "#0051ff",
  tagResearchBg: "rgba(175,82,222,0.12)",
  tagResearchBorder: "rgba(175,82,222,0.28)",
  tagResearchText: "#8e3bb8",
};

// ─── Helpers ────────────────────────────────────────────────────────────
function confidenceToPct(c: "high" | "moderate" | "low" | undefined): number {
  return c === "high" ? 90 : c === "moderate" ? 75 : c === "low" ? 60 : 75;
}

function daysRemaining(deadline: string | null | undefined): number | null {
  if (!deadline) return null;
  const d = new Date(deadline).getTime();
  if (Number.isNaN(d)) return null;
  const now = Date.now();
  return Math.max(0, Math.ceil((d - now) / 86_400_000));
}

function parseTitleForNumber(title: string): {
  prefix: string;
  number: string | null;
  suffix: string;
} {
  const match = title.match(/(\$?[\d,]+(?:\.\d+)?[%Mk]?)/);
  if (!match) return { prefix: title, number: null, suffix: "" };
  const idx = title.indexOf(match[0]);
  return {
    prefix: title.slice(0, idx),
    number: match[0],
    suffix: title.slice(idx + match[0].length),
  };
}

function isSuggestion(o: AnyObjective): o is SuggestedObjective {
  return !("id" in o) || !("space_id" in (o as object));
}

function getDepth(o: AnyObjective): "surface" | "structural" | "fundamental" | undefined {
  if (isSuggestion(o)) return o.depth;
  return undefined;
}

function kindLabelForLevel(level: 1 | 2 | 3): string {
  if (level === 1) return "Concept";
  if (level === 2) return "Relationship";
  return "First-principle";
}

function kindSubLabel(objectiveType: string | undefined, level: 1 | 2 | 3): string {
  if (level === 1) return "Fundamental";
  if (level === 3) return "Tactic";
  // level 2
  if (objectiveType === "minimize" || objectiveType === "avoid") return "Risk";
  if (objectiveType === "explore") return "Hypothesis";
  return "Structural";
}

type SourceTag = {
  label: string;
  bg: string;
  border: string;
  text: string;
};

function sourceTagsFor(o: AnyObjective): SourceTag[] {
  const tags: SourceTag[] = [];
  if (isSuggestion(o)) {
    const st = o.source_type;
    if (st === "open_question") {
      tags.push({
        label: "User input",
        bg: S.tagUserBg,
        border: S.tagUserBorder,
        text: S.tagUserText,
      });
    } else if (
      st === "leverage_point" ||
      st === "risk_point" ||
      st === "feedback_loop" ||
      st === "bottleneck" ||
      st === "scenario"
    ) {
      tags.push({
        label: "Derived concept",
        bg: S.tagConceptBg,
        border: S.tagConceptBorder,
        text: S.tagConceptText,
      });
    } else if (
      st === "external_insight" ||
      st === "cross_context" ||
      st === "worth_considering"
    ) {
      tags.push({
        label: "Research",
        bg: S.tagResearchBg,
        border: S.tagResearchBorder,
        text: S.tagResearchText,
      });
    }
    if (
      o.external_evidence &&
      !tags.some((t) => t.label === "Research")
    ) {
      tags.push({
        label: "Research",
        bg: S.tagResearchBg,
        border: S.tagResearchBorder,
        text: S.tagResearchText,
      });
    }
  } else {
    tags.push({
      label: "User input",
      bg: S.tagUserBg,
      border: S.tagUserBorder,
      text: S.tagUserText,
    });
  }
  return tags;
}

function titleOf(o: AnyObjective): string {
  return o.title;
}

function descriptionOf(o: AnyObjective): string {
  return o.description ?? "";
}

function objectiveTypeOf(o: AnyObjective): string {
  return o.objective_type;
}

function keyOf(o: AnyObjective): string {
  if (isSuggestion(o)) return `sug:${o.key}`;
  return `goal:${o.id}`;
}

function convergenceOf(o: AnyObjective): number {
  if (isSuggestion(o)) return o.convergence_score ?? 0;
  return 0;
}

function confidenceOf(o: AnyObjective): "high" | "moderate" | "low" {
  if (isSuggestion(o)) return o.confidence;
  return "high";
}

function priorityOf(o: AnyObjective): number {
  if (isSuggestion(o)) return o.priority ?? 3;
  return 1;
}

function propellantOf(o: AnyObjective) {
  if (isSuggestion(o)) return o.propellant ?? null;
  return null;
}

// ─── MissionIcon ────────────────────────────────────────────────────────
function MissionIcon() {
  return (
    <div
      className="relative h-[58px] w-[58px] flex-shrink-0 rounded-[14px] overflow-hidden"
      style={{
        background: S.missionIconBg,
        boxShadow: S.missionIconShadow,
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 animate-[sweep_4s_linear_infinite] motion-reduce:animate-none"
        style={{ background: S.missionSweep }}
      />
      <svg
        className="absolute inset-0 m-auto"
        width="58"
        height="58"
        viewBox="0 0 58 58"
        fill="none"
      >
        <circle
          cx="29"
          cy="29"
          r="18"
          stroke="rgba(180,210,255,0.45)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <circle
          cx="29"
          cy="29"
          r="11"
          stroke="rgba(180,210,255,0.7)"
          strokeWidth="1"
        />
        <line x1="29" y1="7" x2="29" y2="15" stroke="rgba(180,210,255,0.8)" strokeWidth="1" />
        <line x1="29" y1="43" x2="29" y2="51" stroke="rgba(180,210,255,0.8)" strokeWidth="1" />
        <line x1="7" y1="29" x2="15" y2="29" stroke="rgba(180,210,255,0.8)" strokeWidth="1" />
        <line x1="43" y1="29" x2="51" y2="29" stroke="rgba(180,210,255,0.8)" strokeWidth="1" />
        <circle cx="29" cy="29" r="3" fill="#4fa3ff" />
        <circle cx="29" cy="29" r="1.5" fill="#fff" />
      </svg>
    </div>
  );
}

// ─── ConvergenceGauge ───────────────────────────────────────────────────
function ConvergenceGauge({ pct }: { pct: number }) {
  const R = 20;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - pct / 100);
  return (
    <div className="relative h-12 w-12 flex-shrink-0">
      <svg width="48" height="48" viewBox="0 0 48 48">
        <defs>
          <linearGradient id="convergeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4fa3ff" />
            <stop offset="100%" stopColor="#0051ff" />
          </linearGradient>
        </defs>
        <circle
          cx="24"
          cy="24"
          r={R}
          stroke="rgba(26,122,255,0.15)"
          strokeWidth="3"
          fill="none"
        />
        <circle
          cx="24"
          cy="24"
          r={R}
          stroke="url(#convergeGrad)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          transform="rotate(-90 24 24)"
          style={{ filter: "drop-shadow(0 0 6px rgba(26,122,255,0.5))" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-[#0051ff]">
        {pct}%
      </div>
    </div>
  );
}

// ─── NodeMarker ─────────────────────────────────────────────────────────
function NodeMarker({
  level,
  tracked,
  label,
}: {
  level: 1 | 2 | 3;
  tracked: boolean;
  label: string;
}) {
  const size = level === 3 ? 32 : 40;
  const bg = tracked
    ? "linear-gradient(180deg, #2d8cff, #0051ff)"
    : level === 1
      ? S.l1Bg
      : level === 2
        ? S.l2Bg
        : S.l3Bg;
  const color = tracked
    ? "#fff"
    : level === 1
      ? S.l1Color
      : level === 2
        ? S.l2Color
        : S.l3Color;
  const border = tracked ? "none" : `1.5px solid ${color}`;
  const shadow = tracked
    ? "0 6px 16px rgba(0,90,255,0.32), inset 0 1px 0 rgba(255,255,255,0.4)"
    : "0 2px 6px rgba(0,30,140,0.12)";
  return (
    <div
      className="relative z-10 flex items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        background: bg,
        border,
        color,
        boxShadow: shadow,
        fontSize: level === 3 ? 11 : 12,
      }}
    >
      {tracked ? <Check className="h-4 w-4" strokeWidth={3} /> : label}
    </div>
  );
}

// ─── ConvergenceDots ────────────────────────────────────────────────────
function ConvergenceDots({ score }: { score: number }) {
  const filled = Math.min(score, 4);
  const empty = Math.max(0, 4 - filled);
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: filled }).map((_, i) => (
          <span
            key={`f-${i}`}
            className="block h-1.5 w-1.5 rounded-full"
            style={{ background: "#0051ff" }}
          />
        ))}
        {Array.from({ length: empty }).map((_, i) => (
          <span
            key={`e-${i}`}
            className="block h-1.5 w-1.5 rounded-full"
            style={{ background: "rgba(26,122,255,0.2)" }}
          />
        ))}
      </div>
      <span className="text-[10px] text-gray-500">{score} chains</span>
    </div>
  );
}

// ─── ConfidenceMini bar ─────────────────────────────────────────────────
function ConfidenceMini({ pct }: { pct: number }) {
  const barColor =
    pct >= 80
      ? "linear-gradient(90deg, #2ad06d, #1aa055)"
      : pct >= 65
        ? "linear-gradient(90deg, #ffb43b, #ff9500)"
        : "linear-gradient(90deg, #d06d6d, #a04040)";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <span className="text-[10px] font-medium text-gray-600">{pct}%</span>
    </div>
  );
}

// ─── SourceTag chip ─────────────────────────────────────────────────────
function SourceTagChip({ tag }: { tag: SourceTag }) {
  const Icon =
    tag.label === "User input"
      ? User
      : tag.label === "Research"
        ? Search
        : Network;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{
        background: tag.bg,
        border: `1px solid ${tag.border}`,
        color: tag.text,
      }}
    >
      <Icon className="h-2.5 w-2.5" />
      {tag.label}
    </span>
  );
}

// ─── Build tree ─────────────────────────────────────────────────────────
function buildTree(
  primaryGoal: ImprovementGoal | null,
  allGoals: ImprovementGoal[],
  suggestions: SuggestedObjective[],
): TreeNode | null {
  // Root selection
  let rootData: AnyObjective | null = primaryGoal;
  let rootKind: "goal" | "suggestion" = "goal";
  if (!rootData) {
    // Pick highest-priority fundamental suggestion, else lowest-priority #
    const fundamentals = suggestions.filter((s) => s.depth === "fundamental");
    const pool = fundamentals.length > 0 ? fundamentals : suggestions;
    const sorted = [...pool].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
    if (sorted[0]) {
      rootData = sorted[0];
      rootKind = "suggestion";
    }
  }
  if (!rootData) return null;

  const rootId = keyOf(rootData);
  const root: TreeNode = {
    id: rootId,
    kind: rootKind,
    data: rootData,
    level: 1,
    label: "✓",
    children: [],
    parentId: null,
  };

  // Index accepted goals by id, by parent
  const goalsByParent = new Map<string | null, ImprovementGoal[]>();
  for (const g of allGoals) {
    const key = g.parent_goal_id ?? null;
    if (!goalsByParent.has(key)) goalsByParent.set(key, []);
    goalsByParent.get(key)!.push(g);
  }

  // Index suggestions by parent goal id (when set)
  const suggestionsByParent = new Map<string | null, SuggestedObjective[]>();
  for (const s of suggestions) {
    // Skip if this suggestion is the root itself
    if (rootKind === "suggestion" && (rootData as SuggestedObjective).key === s.key) continue;
    const key = s.parent_goal_id ?? null;
    if (!suggestionsByParent.has(key)) suggestionsByParent.set(key, []);
    suggestionsByParent.get(key)!.push(s);
  }

  // Walk: for an accepted goal root, children are goals with parent=root.id
  // plus suggestions with parent_goal_id=root.id; for a suggestion root, children
  // are the remaining suggestions (depth structural), except itself.
  function childrenOf(
    node: TreeNode,
    depthLevel: 1 | 2 | 3,
  ): TreeNode[] {
    const out: TreeNode[] = [];
    let siblingIdx = 0;
    const parentLevel = depthLevel;
    const nextLevel: 1 | 2 | 3 = Math.min(3, depthLevel + 1) as 1 | 2 | 3;

    if (node.kind === "goal") {
      const goalId = (node.data as ImprovementGoal).id;
      const childGoals = goalsByParent.get(goalId) ?? [];
      for (const cg of childGoals) {
        siblingIdx += 1;
        const childNode: TreeNode = {
          id: keyOf(cg),
          kind: "goal",
          data: cg,
          level: nextLevel,
          label: labelFor(nextLevel, parentLevel, siblingIdx, node.label),
          children: [],
          parentId: node.id,
        };
        childNode.children = childrenOf(childNode, nextLevel);
        out.push(childNode);
      }
      const childSuggestions = suggestionsByParent.get(goalId) ?? [];
      for (const cs of childSuggestions) {
        siblingIdx += 1;
        const childNode: TreeNode = {
          id: keyOf(cs),
          kind: "suggestion",
          data: cs,
          level: nextLevel,
          label: labelFor(nextLevel, parentLevel, siblingIdx, node.label),
          children: [],
          parentId: node.id,
        };
        childNode.children = childrenOf(childNode, nextLevel);
        out.push(childNode);
      }
    } else {
      // Suggestion node. Pull child suggestions by parent_goal_id === null
      // (i.e. orphan siblings) only for the root — deeper suggestions have no
      // clean structural pointer, so we surface depth=structural first then surface.
      if (node === root) {
        // top-level siblings: structurals
        const structurals = suggestions.filter(
          (s) =>
            s.depth === "structural" &&
            (rootKind !== "suggestion" ||
              (rootData as SuggestedObjective).key !== s.key),
        );
        for (const ss of structurals) {
          siblingIdx += 1;
          const childNode: TreeNode = {
            id: keyOf(ss),
            kind: "suggestion",
            data: ss,
            level: 2,
            label: labelFor(2, 1, siblingIdx, node.label),
            children: [],
            parentId: node.id,
          };
          // L3 = surface children (no clean parent in data, so we distribute)
          childNode.children = [];
          out.push(childNode);
        }
        // Distribute surface-depth suggestions round-robin as L3 leaves under the structurals
        const surfaces = suggestions.filter((s) => s.depth === "surface");
        if (out.length > 0) {
          surfaces.forEach((sf, i) => {
            const parent = out[i % out.length];
            const cSiblingIdx = parent.children.length + 1;
            parent.children.push({
              id: keyOf(sf),
              kind: "suggestion",
              data: sf,
              level: 3,
              label: labelFor(3, 2, cSiblingIdx, parent.label),
              children: [],
              parentId: parent.id,
            });
          });
        } else {
          // No structurals — surfaces become direct L2 children
          surfaces.forEach((sf) => {
            siblingIdx += 1;
            out.push({
              id: keyOf(sf),
              kind: "suggestion",
              data: sf,
              level: 2,
              label: labelFor(2, 1, siblingIdx, node.label),
              children: [],
              parentId: node.id,
            });
          });
        }
      }
    }
    return out;
  }

  root.children = childrenOf(root, 1);
  return root;
}

function labelFor(
  level: 1 | 2 | 3,
  _parentLevel: 1 | 2 | 3,
  siblingIdx: number,
  parentLabel: string,
): string {
  if (level === 1) return "✓";
  if (level === 2) {
    // parentLabel might be "✓" or a number; use parentLabel if numeric, else siblingIdx
    const parentNum = parentLabel === "✓" ? 1 : parseInt(parentLabel, 10) || 1;
    return `${parentNum + 1}.${siblingIdx}`;
  }
  // level 3 → letter
  return String.fromCharCode(96 + siblingIdx); // a, b, c, ...
}

// ─── Flatten tree, respect filter ───────────────────────────────────────
function flattenTree(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  function walk(n: TreeNode) {
    out.push(n);
    for (const c of n.children) walk(c);
  }
  walk(root);
  return out;
}

// ─── Main component ─────────────────────────────────────────────────────
export default function ObjectivesDecompositionShell(
  props: ObjectivesDecompositionShellProps,
) {
  const {
    primaryGoal,
    allGoals,
    suggestedObjectives,
    onAccept,
    onDecompose,
    onAddSubGoal,
    onCreateSubSpace: _onCreateSubSpace,
    onNavigateToSpace: _onNavigateToSpace,
    onGoalClick,
    variant = "full",
    initiallyExpanded = false,
  } = props;

  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [filter, setFilter] = useState<"all" | "tracked" | "l3">("all");
  const bodyRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [paths, setPaths] = useState<
    Array<{ d: string; level: 2 | 3; key: string }>
  >([]);

  // Build tree
  const tree = useMemo(
    () => buildTree(primaryGoal, allGoals, suggestedObjectives),
    [primaryGoal, allGoals, suggestedObjectives],
  );

  // Header stats
  const detectedCount = suggestedObjectives.length;
  const trackedCount = allGoals.filter((g) => g.status === "active").length;

  const allCombined: AnyObjective[] = useMemo(
    () => [...allGoals, ...suggestedObjectives],
    [allGoals, suggestedObjectives],
  );

  const layerCounts = useMemo(() => {
    let l1 = 0,
      l2 = 0,
      l3 = 0;
    for (const o of allCombined) {
      const isGoal = !isSuggestion(o);
      const depth = getDepth(o);
      if (isGoal) {
        const g = o as ImprovementGoal;
        if (!g.parent_goal_id) l1++;
        else {
          const parent = allGoals.find((x) => x.id === g.parent_goal_id);
          if (parent && !parent.parent_goal_id) l2++;
          else l3++;
        }
      } else {
        if (depth === "fundamental") l1++;
        else if (depth === "structural") l2++;
        else l3++;
      }
    }
    return { l1, l2, l3 };
  }, [allCombined, allGoals]);

  const avgConvergencePct = useMemo(() => {
    const convergences = suggestedObjectives
      .map((s) => s.convergence_score ?? 0)
      .filter((n) => n > 0);
    const avg =
      convergences.length > 0
        ? convergences.reduce((a, b) => a + b, 0) / convergences.length
        : 0;
    return Math.min(100, Math.round((avg / 4) * 100));
  }, [suggestedObjectives]);

  // Title
  const titleRaw = tree ? titleOf(tree.data) : "No objectives detected yet";
  const { prefix, number, suffix } = parseTitleForNumber(titleRaw);
  const deadline = primaryGoal?.deadline ?? null;
  const days = daysRemaining(deadline);

  // Filter tree → visible nodes
  const visibleNodes = useMemo(() => {
    if (!tree) return [];
    const all = flattenTree(tree);
    if (filter === "all") return all;
    if (filter === "l3") return all.filter((n) => n.level === 3);
    // tracked: active goals + ancestors
    const activeIds = new Set<string>();
    for (const n of all) {
      if (
        n.kind === "goal" &&
        (n.data as ImprovementGoal).status === "active"
      ) {
        activeIds.add(n.id);
      }
    }
    // include ancestors
    const byId = new Map(all.map((n) => [n.id, n]));
    const out = new Set<string>();
    for (const id of activeIds) {
      let cur: TreeNode | undefined = byId.get(id);
      while (cur) {
        out.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return all.filter((n) => out.has(n.id));
  }, [tree, filter]);

  // Compute SVG paths
  const computePaths = useCallback(() => {
    if (!treeRef.current) return;
    if (filter === "l3") {
      setPaths([]);
      return;
    }
    const rootRect = treeRef.current.getBoundingClientRect();
    const next: Array<{ d: string; level: 2 | 3; key: string }> = [];
    for (const n of visibleNodes) {
      if (!n.parentId) continue;
      const marker = markerRefs.current.get(n.id);
      const parent = markerRefs.current.get(n.parentId);
      if (!marker || !parent) continue;
      const p = parent.getBoundingClientRect();
      const c = marker.getBoundingClientRect();
      const startX = p.left - rootRect.left + p.width / 2;
      const startY = p.bottom - rootRect.top + 2;
      const endX = c.left - rootRect.left + c.width / 2;
      const endY = c.top - rootRect.top + c.height / 2;
      const R = 12;
      const turnY = endY - R;
      const d = `M ${startX} ${startY} L ${startX} ${turnY} Q ${startX} ${endY} ${startX + R} ${endY} L ${endX - 14} ${endY}`;
      next.push({
        d,
        level: (n.level === 3 ? 3 : 2) as 2 | 3,
        key: n.id,
      });
    }
    setPaths(next);
  }, [visibleNodes, filter]);

  useLayoutEffect(() => {
    computePaths();
  }, [computePaths, expanded]);

  useEffect(() => {
    if (!treeRef.current) return;
    const el = treeRef.current;
    const ro = new ResizeObserver(() => computePaths());
    ro.observe(el);
    const onResize = () => computePaths();
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [computePaths]);

  // Recompute after collapse/expand transitionend
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const handler = () => computePaths();
    el.addEventListener("transitionend", handler);
    return () => el.removeEventListener("transitionend", handler);
  }, [computePaths]);

  // Empty state: no tree at all
  const hasAnyData = tree !== null;

  // ─── Render ───────────────────────────────────────────────────────────
  const shellStyle: CSSProperties = {
    background: S.shellBg,
    border: S.shellBorder,
    boxShadow: expanded ? S.shellShadowExpanded : S.shellShadow,
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
  };

  const chip = (label: string, count: number, bg: string, color: string) => (
    <span
      key={label}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: bg, color }}
    >
      {label} · {count}
    </span>
  );

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 animate-[rise-fade_0.9s_0.2s_forwards_cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none opacity-0"
      style={shellStyle}
    >
      {/* Inner tint */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{ background: S.shellInnerTint }}
      />

      <div className="relative">
        {/* ─── Header row ───────────────────────────────────────────── */}
        <div className="flex items-start gap-4">
          <MissionIcon />

          <div className="flex-1 min-w-0">
            {/* Eyebrow */}
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <span
                aria-hidden
                className="block h-1.5 w-1.5 rounded-full bg-[#2ad06d] animate-[pulse-live-dot_2s_infinite] motion-reduce:animate-none"
              />
              <span>
                Primary Objective · {detectedCount} Detected · {trackedCount} Tracked
              </span>
            </div>

            {/* Title */}
            <h2 className="mt-1 text-[22px] font-semibold leading-tight text-gray-900">
              {prefix}
              {number && (
                <span
                  className="mx-0.5 font-bold"
                  style={{
                    backgroundImage: S.numberGradient,
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                    filter: S.numberDropshadow,
                  }}
                >
                  {number}
                </span>
              )}
              {suffix}
            </h2>

            {/* Layer chips */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {chip("L1", layerCounts.l1, S.l1Bg, S.l1Color)}
              {chip("L2", layerCounts.l2, S.l2Bg, S.l2Color)}
              {chip("L3", layerCounts.l3, S.l3Bg, S.l3Color)}
            </div>
          </div>

          {/* Stats */}
          {days !== null && (
            <div className="flex flex-col items-end">
              <span className="text-[20px] font-bold text-gray-900 leading-none">
                {days}d
              </span>
              <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-gray-500">
                Remaining
              </span>
            </div>
          )}

          {/* Convergence gauge */}
          <ConvergenceGauge pct={avgConvergencePct} />

          {/* Expand button */}
          {variant === "full" && hasAnyData && (
            <button
              type="button"
              onClick={() => setExpanded((s) => !s)}
              className="flex h-11 w-11 items-center justify-center rounded-full text-white transition-transform"
              style={{
                background: S.expandBtnBg,
                boxShadow: S.expandBtnShadow,
              }}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              <ChevronDown
                className={cn(
                  "h-5 w-5 transition-transform duration-300",
                  expanded && "rotate-180",
                )}
              />
            </button>
          )}
        </div>

        {/* ─── Progress strip ───────────────────────────────────────── */}
        {hasAnyData && variant === "full" && (
          <div className="relative mt-4 h-[5px] w-full overflow-hidden rounded-full bg-gray-200/70">
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${Math.max(8, avgConvergencePct)}%`,
                background: S.progressFill,
                boxShadow: S.progressGlow,
              }}
            />
            <div
              aria-hidden
              className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-white animate-[tracker-fade_3s_ease-in-out_infinite] motion-reduce:animate-none"
              style={{
                left: `${Math.max(8, avgConvergencePct)}%`,
                boxShadow: "0 0 6px rgba(26,122,255,0.8)",
              }}
            />
          </div>
        )}

        {/* ─── Body ──────────────────────────────────────────────────── */}
        {variant === "full" && hasAnyData && (
          <div
            ref={bodyRef}
            className={cn(
              "grid overflow-hidden transition-[grid-template-rows,opacity,margin-top] duration-500 ease-in-out",
              expanded ? "grid-rows-[1fr] opacity-100 mt-5" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="min-h-0">
              {/* Filter tabs */}
              <div className="flex gap-1 rounded-full bg-gray-100 p-1 text-[11px] font-medium w-fit">
                {(
                  [
                    ["all", "All"],
                    ["tracked", "Tracked"],
                    ["l3", "L3 tactics"],
                  ] as const
                ).map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilter(k)}
                    className={cn(
                      "rounded-full px-3 py-1 transition-colors",
                      filter === k
                        ? "bg-white text-[#0051ff] shadow-sm"
                        : "text-gray-500 hover:text-gray-700",
                    )}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Tree */}
              <div ref={treeRef} className="relative mt-4 pl-2">
                {filter !== "l3" && (
                  <svg
                    className="absolute inset-0 h-full w-full pointer-events-none z-0"
                    style={{ overflow: "visible" }}
                  >
                    <defs>
                      <linearGradient
                        id="pathL2"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#1a7aff"
                          stopOpacity="0.9"
                        />
                        <stop
                          offset="100%"
                          stopColor="#5856d6"
                          stopOpacity="0.7"
                        />
                      </linearGradient>
                      <linearGradient
                        id="pathL3"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#5856d6"
                          stopOpacity="0.8"
                        />
                        <stop
                          offset="100%"
                          stopColor="#ff9500"
                          stopOpacity="0.7"
                        />
                      </linearGradient>
                    </defs>
                    {paths.map((p) => (
                      <path
                        key={p.key}
                        d={p.d}
                        fill="none"
                        stroke={
                          p.level === 2 ? "url(#pathL2)" : "url(#pathL3)"
                        }
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeDasharray="4 5"
                        opacity={0.65}
                      />
                    ))}
                  </svg>
                )}

                {/* Nodes */}
                <div className="relative z-10 flex flex-col gap-3">
                  {visibleNodes.map((n) => (
                    <NodeRow
                      key={n.id}
                      node={n}
                      flat={filter === "l3"}
                      markerRefs={markerRefs}
                      onAccept={onAccept}
                      onGoalClick={onGoalClick}
                      onAddSubGoal={onAddSubGoal}
                    />
                  ))}
                </div>

                {/* Decompose CTA — L1 goal with no children, no pending subs */}
                {tree?.kind === "goal" &&
                  tree.children.length === 0 &&
                  onDecompose && (
                    <button
                      type="button"
                      onClick={() =>
                        onDecompose((tree.data as ImprovementGoal).id)
                      }
                      className="mt-4 w-full rounded-lg border border-dashed border-[#5a8ff0] bg-white/40 py-2 text-xs font-medium text-[#0051ff] hover:bg-white/60 transition"
                    >
                      + Decompose into sub-objectives
                    </button>
                  )}
              </div>
            </div>
          </div>
        )}

        {/* Empty state — no goal, no suggestions */}
        {!hasAnyData && (
          <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
            <Target className="h-3.5 w-3.5" />
            <span>Run detection to find objectives in your graph.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NodeRow (marker + card) ────────────────────────────────────────────
function NodeRow({
  node,
  flat,
  markerRefs,
  onAccept,
  onGoalClick,
  onAddSubGoal,
}: {
  node: TreeNode;
  flat: boolean;
  markerRefs: React.RefObject<Map<string, HTMLDivElement>>;
  onAccept?: (o: SuggestedObjective) => void | Promise<void>;
  onGoalClick?: (g: ImprovementGoal) => void;
  onAddSubGoal?: (parentGoalId: string) => void;
}) {
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      const map = markerRefs.current;
      if (!map) return;
      if (el) map.set(node.id, el);
      else map.delete(node.id);
    },
    [node.id, markerRefs],
  );

  const tracked =
    node.kind === "goal" &&
    (node.data as ImprovementGoal).status === "active";

  const pct = confidenceToPct(confidenceOf(node.data));
  const pri = priorityOf(node.data);
  // Small priority nudge per spec
  const confPct = Math.max(
    55,
    Math.min(94, pct + (node.kind === "suggestion" ? 6 - pri : 0)),
  );

  const indent = flat
    ? 0
    : node.level === 1
      ? 0
      : node.level === 2
        ? 32
        : 64;

  const propellant = propellantOf(node.data);
  const showKeyAction = node.level === 1 && propellant;

  const tags = sourceTagsFor(node.data);
  const conv = convergenceOf(node.data);

  const handleTrackClick = () => {
    if (node.kind === "suggestion" && onAccept) {
      onAccept(node.data as SuggestedObjective);
    } else if (node.kind === "goal" && onGoalClick) {
      onGoalClick(node.data as ImprovementGoal);
    }
  };

  return (
    <div
      className="flex items-start gap-3"
      style={{ marginLeft: indent }}
    >
      <div ref={setRef} className="flex-shrink-0 mt-1.5">
        <NodeMarker level={node.level} tracked={tracked} label={node.label} />
      </div>

      <div
        className="flex-1 min-w-0 rounded-xl p-3.5"
        style={{
          background: S.cardBg,
          border: S.cardBorder,
          boxShadow: S.cardShadow,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        {/* Card header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
              style={{
                background:
                  node.level === 1 ? S.l1Bg : node.level === 2 ? S.l2Bg : S.l3Bg,
                color:
                  node.level === 1
                    ? S.l1Color
                    : node.level === 2
                      ? S.l2Color
                      : S.l3Color,
              }}
            >
              L{node.level} · {kindLabelForLevel(node.level)}
            </span>
            <span className="text-gray-400 normal-case tracking-normal font-medium">
              {kindSubLabel(objectiveTypeOf(node.data), node.level)}
            </span>
          </div>
          <ConfidenceMini pct={confPct} />
        </div>

        {/* Title */}
        <h3
          className={cn(
            "mt-2 font-semibold text-gray-900",
            node.level === 1 ? "text-base" : node.level === 2 ? "text-sm" : "text-[13px]",
          )}
        >
          {titleOf(node.data)}
        </h3>

        {/* Description */}
        {descriptionOf(node.data) && (
          <p className="mt-1 text-xs leading-relaxed text-gray-600 line-clamp-3">
            {descriptionOf(node.data)}
          </p>
        )}

        {/* Key action (propellant) */}
        {showKeyAction && propellant && (
          <div
            className="mt-3 flex items-start gap-2.5 rounded-lg p-2.5"
            style={{ background: S.kaBg, border: S.kaBorder }}
          >
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md flex-shrink-0"
              style={{
                background: S.kaIconBg,
                boxShadow: "0 2px 6px rgba(220,130,40,0.3)",
              }}
            >
              <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#a85c1c]">
                Key action
              </div>
              <div className="mt-0.5 text-xs font-semibold text-gray-900">
                {propellant.action}
              </div>
              <div className="mt-0.5 text-[11px] text-gray-700 line-clamp-2">
                {propellant.why}
              </div>
            </div>
          </div>
        )}

        {/* Card foot */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {tags.map((t) => (
              <SourceTagChip key={t.label} tag={t} />
            ))}
            {conv > 0 && <ConvergenceDots score={conv} />}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Manual "+ Sub-goal" — only on accepted goals that aren't yet L3,
                so users can extend the hierarchy without waiting for LLM
                auto-decomposition. Complements the existing onDecompose CTA
                that appears below when a goal has no children yet. */}
            {node.kind === "goal" &&
              node.level < 3 &&
              onAddSubGoal && (
                <button
                  type="button"
                  onClick={() =>
                    onAddSubGoal((node.data as ImprovementGoal).id)
                  }
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/60 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-white hover:text-gray-900"
                  title="Add a sub-goal manually under this goal"
                >
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                  Sub-goal
                </button>
              )}

            <button
              type="button"
              onClick={handleTrackClick}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition"
              style={
                tracked
                  ? {
                      background: S.trackedBg,
                      border: `1px solid ${S.trackedBorder}`,
                      color: S.trackedColor,
                    }
                  : {
                      background: S.trackBg,
                      color: "#fff",
                      border: "none",
                      boxShadow: S.trackShadow,
                    }
              }
            >
              {tracked ? (
                <>
                  <Check className="h-3 w-3" strokeWidth={3} />
                  Tracked
                </>
              ) : node.kind === "suggestion" ? (
                <>
                  <Plus className="h-3 w-3" strokeWidth={3} />
                  {node.level === 1 ? "Accept" : "Track"}
                </>
              ) : (
                <>
                  <Plus className="h-3 w-3" strokeWidth={3} />
                  Track
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
