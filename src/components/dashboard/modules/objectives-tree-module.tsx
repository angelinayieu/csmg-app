"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Loader2, AlertTriangle, HelpCircle, X, Check } from "lucide-react";
import type { SuggestedObjective } from "@/types/goals";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";

// ── Types ──

type DepthLayer = "fundamental" | "structural" | "surface";
type FilterMode = "all" | "tracked" | "surface";

interface ObjectivesTreeModuleProps {
  suggestedObjectives: SuggestedObjective[];
  goals: ImprovementGoal[];
  onAcceptObjective: (objective: SuggestedObjective) => void | Promise<void>;
  synthesisData: SynthesisData | null;
  objectiveAutoLoading?: boolean;
  objectiveAutoError?: string | null;
  onDetectObjectives?: () => void;
  needsRefresh?: boolean;
}

// ── Layer config ──

const layerConfig: Record<DepthLayer, {
  label: string;
  tag: string;
  chipBg: string;
  chipText: string;
  dotColor: string;
  markerBorder: string;
  markerBg: string;
  markerText: string;
  trackedBg: string;
  trackedText: string;
  trackedShadow: string;
  iconBg: string;
  iconText: string;
  classification: string;
}> = {
  fundamental: {
    label: "L1",
    tag: "Concept",
    chipBg: "bg-[rgba(0,122,255,0.1)]",
    chipText: "text-[#0066cc]",
    dotColor: "bg-[#007aff]",
    markerBorder: "border-[#007aff]",
    markerBg: "bg-white",
    markerText: "text-[#007aff]",
    trackedBg: "bg-[#007aff]",
    trackedText: "text-white",
    trackedShadow: "shadow-[0_2px_5px_rgba(0,122,255,0.3),0_0_0_4px_rgba(0,122,255,0.08)]",
    iconBg: "bg-[rgba(0,122,255,0.1)]",
    iconText: "text-[#0066cc]",
    classification: "Fundamental",
  },
  structural: {
    label: "L2",
    tag: "Relationship",
    chipBg: "bg-[rgba(88,86,214,0.1)]",
    chipText: "text-[#4a48b8]",
    dotColor: "bg-[#5856d6]",
    markerBorder: "border-[#5856d6]",
    markerBg: "bg-white",
    markerText: "text-[#5856d6]",
    trackedBg: "bg-[#5856d6]",
    trackedText: "text-white",
    trackedShadow: "shadow-[0_2px_5px_rgba(88,86,214,0.3),0_0_0_4px_rgba(88,86,214,0.08)]",
    iconBg: "bg-[rgba(88,86,214,0.1)]",
    iconText: "text-[#4a48b8]",
    classification: "Structural",
  },
  surface: {
    label: "L3",
    tag: "First-principle",
    chipBg: "bg-[rgba(255,149,0,0.12)]",
    chipText: "text-[#c77400]",
    dotColor: "bg-[#ff9500]",
    markerBorder: "border-[#ff9500]",
    markerBg: "bg-white",
    markerText: "text-[#c77400]",
    trackedBg: "bg-[#ff9500]",
    trackedText: "text-white",
    trackedShadow: "",
    iconBg: "bg-[rgba(255,149,0,0.12)]",
    iconText: "text-[#c77400]",
    classification: "Tactic",
  },
};

const sourceTypeLabels: Record<string, { label: string; variant: "user" | "concept" | "research" }> = {
  leverage_point: { label: "Leverage point", variant: "concept" },
  risk_point: { label: "Risk signal", variant: "research" },
  feedback_loop: { label: "Feedback loop", variant: "concept" },
  scenario: { label: "Scenario", variant: "research" },
  open_question: { label: "Open question", variant: "research" },
  bottleneck: { label: "Bottleneck", variant: "concept" },
  external_insight: { label: "External insight", variant: "research" },
  cross_context: { label: "Cross-context", variant: "concept" },
  worth_considering: { label: "Worth considering", variant: "research" },
};

// ── SVG Icons ──

function DecompositionTreeIcon({ className }: { className?: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <circle cx="12" cy="4.5" r="2" fill="white" stroke="none" />
      <path d="M12 7v2.5" />
      <path d="M12 9.5h-5v1" />
      <path d="M12 9.5h5v1" />
      <circle cx="7" cy="12" r="1.5" fill="white" stroke="none" opacity="0.85" />
      <circle cx="17" cy="12" r="1.5" fill="white" stroke="none" opacity="0.85" />
      <path d="M7 13.5v2.5" opacity="0.7" />
      <path d="M7 16h-2.5v1.2" opacity="0.7" />
      <path d="M7 16h2.5v1.2" opacity="0.7" />
      <path d="M17 13.5v3.5" opacity="0.7" />
      <circle cx="4.5" cy="18.5" r="1.1" fill="white" stroke="none" opacity="0.6" />
      <circle cx="9.5" cy="18.5" r="1.1" fill="white" stroke="none" opacity="0.6" />
      <circle cx="17" cy="18.5" r="1.1" fill="white" stroke="none" opacity="0.6" />
    </svg>
  );
}

function TriangulationGlyph({ chains }: { chains: number }) {
  // Generate line endpoints based on chain count (radiate from center)
  const endpoints = useMemo(() => {
    const pts: Array<{ x: number; y: number }> = [];
    const count = Math.min(chains, 6);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
      pts.push({
        x: 8 + Math.cos(angle) * 6.5,
        y: 8 + Math.sin(angle) * 6.5,
      });
    }
    return pts;
  }, [chains]);

  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="2.2" fill="#007aff" />
      {endpoints.map((pt, i) => (
        <g key={i}>
          <line x1="8" y1="8" x2={pt.x} y2={pt.y} stroke="#007aff" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
          <circle cx={pt.x} cy={pt.y} r="1" fill="#007aff" opacity="0.7" />
        </g>
      ))}
    </svg>
  );
}

function LayerIcon({ layer }: { layer: DepthLayer }) {
  if (layer === "fundamental") {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9" /></svg>
    );
  }
  if (layer === "structural") {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" />
        <path d="M8 7l3 9M16 7l-3 9" />
      </svg>
    );
  }
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function SourceIcon({ variant }: { variant: "user" | "concept" | "research" }) {
  if (variant === "user") {
    return (
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="12" cy="8" r="4" /><path d="M4 21v-2a6 6 0 016-6h4a6 6 0 016 6v2" />
      </svg>
    );
  }
  if (variant === "concept") {
    return (
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" />
        <path d="M8 7l3 9M16 7l-3 9" />
      </svg>
    );
  }
  return (
    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" />
    </svg>
  );
}

// ── Onboarding Modal ──

const ONBOARDING_KEY = "interaxis:objectives-tree-onboarded";

const onboardingItems = [
  { title: "L1 · Fundamental", desc: "Core concepts that everything else depends on. These are the root objectives." },
  { title: "L2 · Structural", desc: "Relationship-level objectives that bridge fundamentals to tactics." },
  { title: "L3 · Tactic", desc: "Concrete first-principle actions you can execute directly." },
  { title: "Triangulation", desc: "How many independent reasoning chains arrived at the same conclusion. Higher = more confident." },
  { title: "Track", desc: "Accept an objective and start measuring progress against it." },
];

function OnboardingModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#1d1d1f] via-[#2a2238] to-[#3a2c4a]">
            <DecompositionTreeIcon />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[#1d1d1f] tracking-tight">Decomposition Tree</h3>
            <p className="text-xs text-[#86868b]">How your objectives are structured</p>
          </div>
        </div>
        <div className="space-y-3">
          {onboardingItems.map((item) => (
            <div key={item.title} className="flex gap-3 items-start">
              <div className="mt-0.5 h-1.5 w-1.5 rounded-full bg-[#007aff] flex-shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-[#1d1d1f]">{item.title}</p>
                <p className="text-xs text-[#6e6e73] leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-[#007aff] py-2.5 text-sm font-medium text-white hover:bg-[#0066cc] transition-colors shadow-sm"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

// ── Help Tooltip (question mark) ──

function HelpTooltipButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      className="flex h-5 w-5 items-center justify-center rounded-full text-[#86868b] hover:bg-black/[0.04] hover:text-[#424245] transition-colors"
      title="What does this mean?"
    >
      <HelpCircle className="h-3.5 w-3.5" />
    </button>
  );
}

// ── Confidence Bar ──

function ConfidenceBar({ value }: { value: "high" | "moderate" | "low" | number }) {
  const numVal = typeof value === "number"
    ? value
    : value === "high" ? 90 : value === "moderate" ? 65 : 40;
  const label = typeof value === "number" ? `${value}%` : `${numVal}%`;
  const isMed = numVal < 80;

  return (
    <div className="flex items-center gap-1.5">
      <div className="w-8 h-[3px] rounded-full bg-black/[0.06] overflow-hidden">
        <div
          className={cn("h-full rounded-full", isMed ? "bg-[#ff9500]" : "bg-[#34c759]")}
          style={{ width: `${numVal}%` }}
        />
      </div>
      <span className="text-[11px] text-[#86868b]">{label}</span>
    </div>
  );
}

// ── Track Button ──

function TrackButton({
  tracked,
  onTrack,
}: {
  tracked: boolean;
  onTrack: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (tracked || loading) return;
    setLoading(true);
    try {
      await onTrack();
    } finally {
      setLoading(false);
    }
  }

  if (tracked) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-[rgba(52,199,89,0.12)] px-2.5 py-1 text-[11px] font-medium text-[#248a3d]">
        <Check className="h-2.5 w-2.5" />
        Tracked
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded-lg bg-[#007aff] px-2.5 py-1 text-[11px] font-medium text-white shadow-[0_2px_6px_rgba(0,122,255,0.3)] hover:shadow-[0_3px_10px_rgba(0,122,255,0.4)] hover:scale-105 transition-all disabled:opacity-60"
    >
      {loading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "+ Track"}
    </button>
  );
}

// ── Source Tag ──

function SourceTag({ sourceType }: { sourceType: string }) {
  const config = sourceTypeLabels[sourceType] ?? { label: sourceType, variant: "research" as const };
  const variantClasses = {
    user: "bg-[rgba(52,199,89,0.1)] text-[#248a3d]",
    concept: "bg-[rgba(0,122,255,0.08)] text-[#0066cc]",
    research: "bg-[rgba(175,82,222,0.08)] text-[#8e3bb8]",
  };

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-medium", variantClasses[config.variant])}>
      <SourceIcon variant={config.variant} />
      {config.label}
    </span>
  );
}

// ── Objective Card ──

function ObjectiveCard({
  objective,
  layer,
  isTracked,
  compact,
  onTrack,
  markerContent,
}: {
  objective: SuggestedObjective;
  layer: DepthLayer;
  isTracked: boolean;
  compact?: boolean;
  onTrack: () => void;
  markerContent: React.ReactNode;
}) {
  const lc = layerConfig[layer];
  const convergence = objective.convergence_score ?? 0;

  return (
    <div className="relative pl-11 mb-2.5 last:mb-2">
      {/* Marker */}
      <div
        className={cn(
          "absolute left-0 top-[18px] flex items-center justify-center rounded-full z-[3] text-[10px] font-bold",
          layer === "surface" ? "h-6 w-6" : "h-7 w-7",
          isTracked
            ? cn(lc.trackedBg, lc.trackedText, lc.trackedShadow)
            : cn(lc.markerBg, lc.markerText, layer === "structural" ? "border-[1.5px] border-dashed" : "border-[1.5px]", lc.markerBorder)
        )}
      >
        {isTracked ? (
          <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
        ) : (
          markerContent
        )}
      </div>

      {/* Card */}
      <div className={cn(
        "rounded-xl border border-black/[0.07] bg-white transition-all hover:border-black/[0.14] hover:shadow-[0_1px_2px_rgba(0,0,0,0.03),0_6px_14px_rgba(0,0,0,0.04)]",
        compact ? "px-3.5 py-3" : "px-4 py-3.5"
      )}>
        {/* Card head */}
        <div className="flex items-center justify-between mb-2 gap-2.5">
          <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#424245]">
            <span className={cn("flex h-[18px] w-[18px] items-center justify-center rounded-[5px]", lc.iconBg, lc.iconText)}>
              <LayerIcon layer={layer} />
            </span>
            {lc.label} · {lc.tag}
            <span className="text-[#86868b] font-medium before:content-['·'] before:mx-1.5 before:text-[#c7c7cc]">
              {lc.classification}
            </span>
          </div>
          <ConfidenceBar value={objective.confidence} />
        </div>

        {/* Title + description */}
        <h4 className={cn("font-semibold text-[#1d1d1f] tracking-[-0.2px] mb-1", compact ? "text-[13.5px]" : "text-[15px]")}>
          {objective.title}
        </h4>
        <p className={cn("text-[#6e6e73] leading-relaxed", compact ? "text-xs" : "text-[12.5px]")}>
          {objective.description}
        </p>

        {/* Key Action (propellant) — only for non-compact */}
        {!compact && objective.propellant && (
          <div className="mt-3 flex gap-2.5 items-start rounded-lg bg-[rgba(255,149,0,0.06)] border border-[rgba(255,149,0,0.2)] px-3 py-2.5">
            <div className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-[rgba(255,149,0,0.16)] text-[#c77400] flex-shrink-0">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9.5px] font-bold text-[#c77400] uppercase tracking-[0.6px] mb-0.5">Key Action</p>
              <p className="text-[12.5px] font-semibold text-[#1d1d1f] leading-snug">{objective.propellant.action}</p>
              <p className="text-[11px] text-[#6e6e73] mt-0.5 leading-snug">{objective.propellant.why}</p>
            </div>
          </div>
        )}

        {/* Card footer */}
        <div className="flex items-center gap-2.5 mt-3 pt-2.5 border-t border-black/[0.06] flex-wrap">
          <SourceTag sourceType={objective.source_type} />

          {convergence > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md bg-[rgba(0,122,255,0.06)] px-2 py-0.5 text-[10.5px] font-semibold text-[#0066cc] tabular-nums"
              title={`${convergence} reasoning chains independently arrived at this objective`}
            >
              <TriangulationGlyph chains={convergence} />
              {convergence}-chain
              <span className="text-[#6e6e73] font-medium">triangulation</span>
            </span>
          )}

          <span className="flex-1" />
          <TrackButton tracked={isTracked} onTrack={onTrack} />
        </div>
      </div>
    </div>
  );
}

// ── Tree Branch (recursive nesting) ──

function TreeBranch({
  objectives,
  trackedKeys,
  onTrack,
  nested,
  parentIndex,
}: {
  objectives: SuggestedObjective[];
  trackedKeys: Set<string>;
  onTrack: (obj: SuggestedObjective) => void;
  nested?: boolean;
  parentIndex?: number;
}) {
  if (objectives.length === 0) return null;

  return (
    <div className={cn(
      "relative",
      nested && "ml-[26px] mt-1 pt-2"
    )}>
      {/* Vertical connector line */}
      <div className="absolute left-[13px] top-8 bottom-8 border-l-[1.5px] border-dashed border-black/[0.18] z-0" />

      {/* Nested branch connector */}
      {nested && (
        <div className="absolute left-[-13px] top-[-22px] w-[26px] h-[50px] border-l-[1.5px] border-b-[1.5px] border-dashed border-black/[0.18] rounded-bl-[10px] z-0" />
      )}

      {objectives.map((obj, idx) => {
        const layer = (obj.depth ?? "surface") as DepthLayer;
        const isTracked = trackedKeys.has(obj.key);
        const compact = layer === "surface";
        const lc = layerConfig[layer];

        // Marker content for non-tracked nodes
        let markerContent: React.ReactNode;
        if (layer === "fundamental") {
          markerContent = <span>{lc.label}</span>;
        } else if (layer === "structural") {
          markerContent = <span>{parentIndex != null ? `${parentIndex}.${idx + 1}` : `2.${idx + 1}`}</span>;
        } else {
          // Surface: letter markers a, b, c...
          markerContent = <span>{String.fromCharCode(97 + idx)}</span>;
        }

        // Find children: structural objectives that could be children of this fundamental,
        // or surface objectives that could be children of this structural
        // For now we render flat — the tree nesting is driven by depth levels
        return (
          <ObjectiveCard
            key={obj.key}
            objective={obj}
            layer={layer}
            isTracked={isTracked}
            compact={compact}
            onTrack={() => onTrack(obj)}
            markerContent={markerContent}
          />
        );
      })}
    </div>
  );
}

// ── Build hierarchical tree from flat objectives ──

interface TreeNode {
  objective: SuggestedObjective;
  children: TreeNode[];
}

function buildObjectiveTree(objectives: SuggestedObjective[]): TreeNode[] {
  // Group by depth
  const fundamental = objectives.filter((o) => o.depth === "fundamental").sort((a, b) => a.priority - b.priority);
  const structural = objectives.filter((o) => o.depth === "structural").sort((a, b) => a.priority - b.priority);
  const surface = objectives.filter((o) => o.depth === "surface" || !o.depth).sort((a, b) => a.priority - b.priority);

  // If we have a clear hierarchy, build tree
  if (fundamental.length > 0) {
    return fundamental.map((f) => ({
      objective: f,
      children: structural.map((s) => ({
        objective: s,
        children: surface.map((t) => ({ objective: t, children: [] })),
      })),
    }));
  }

  // If only structural + surface, structural is root
  if (structural.length > 0) {
    return structural.map((s) => ({
      objective: s,
      children: surface.map((t) => ({ objective: t, children: [] })),
    }));
  }

  // Flat: all at root
  return objectives.sort((a, b) => a.priority - b.priority).map((o) => ({ objective: o, children: [] }));
}

// ── Recursive tree renderer ──

function TreeNodeRenderer({
  node,
  trackedKeys,
  onTrack,
  parentIndex,
  index,
  nested,
}: {
  node: TreeNode;
  trackedKeys: Set<string>;
  onTrack: (obj: SuggestedObjective) => void;
  parentIndex?: number;
  index: number;
  nested?: boolean;
}) {
  const layer = (node.objective.depth ?? "surface") as DepthLayer;
  const isTracked = trackedKeys.has(node.objective.key);
  const compact = layer === "surface";

  let markerContent: React.ReactNode;
  if (layer === "fundamental") {
    markerContent = <span>L1</span>;
  } else if (layer === "structural") {
    markerContent = <span>{index + 1}.{parentIndex != null ? parentIndex + 1 : 1}</span>;
  } else {
    markerContent = <span>{String.fromCharCode(97 + index)}</span>;
  }

  return (
    <div className="relative">
      <ObjectiveCard
        objective={node.objective}
        layer={layer}
        isTracked={isTracked}
        compact={compact}
        onTrack={() => onTrack(node.objective)}
        markerContent={markerContent}
      />

      {node.children.length > 0 && (
        <div className="ml-[26px] mt-1 pt-2 relative">
          {/* Nested branch connector */}
          <div className="absolute left-[-13px] top-[-22px] w-[26px] h-[50px] border-l-[1.5px] border-b-[1.5px] border-dashed border-black/[0.18] rounded-bl-[10px] z-0" />
          {/* Vertical connector */}
          {node.children.length > 1 && (
            <div className="absolute left-[13px] top-8 bottom-8 border-l-[1.5px] border-dashed border-black/[0.18] z-0" />
          )}
          {node.children.map((child, ci) => (
            <TreeNodeRenderer
              key={child.objective.key}
              node={child}
              trackedKeys={trackedKeys}
              onTrack={onTrack}
              parentIndex={index}
              index={ci}
              nested
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Module ──

export function ObjectivesTreeModule({
  suggestedObjectives,
  goals,
  onAcceptObjective,
  synthesisData,
  objectiveAutoLoading = false,
  objectiveAutoError = null,
  onDetectObjectives,
  needsRefresh = false,
}: ObjectivesTreeModuleProps) {
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [trackedKeys, setTrackedKeys] = useState<Set<string>>(new Set());

  // Check first-time visit
  useEffect(() => {
    try {
      const seen = localStorage.getItem(ONBOARDING_KEY);
      if (!seen && suggestedObjectives.length > 0) {
        setShowOnboarding(true);
        localStorage.setItem(ONBOARDING_KEY, "true");
      }
    } catch {
      // localStorage unavailable
    }
  }, [suggestedObjectives.length]);

  // Top-level objectives only
  const topLevelObjectives = useMemo(
    () => suggestedObjectives.filter((o) => !o.parent_goal_id),
    [suggestedObjectives]
  );

  // Build tree
  const tree = useMemo(() => buildObjectiveTree(topLevelObjectives), [topLevelObjectives]);

  // Track which objectives have been accepted as goals
  const acceptedTitles = useMemo(
    () => new Set(goals.map((g) => g.title)),
    [goals]
  );

  // Merge tracked state: goals that exist + locally tracked
  const allTracked = useMemo(() => {
    const set = new Set(trackedKeys);
    for (const obj of topLevelObjectives) {
      if (acceptedTitles.has(obj.title)) set.add(obj.key);
    }
    return set;
  }, [trackedKeys, acceptedTitles, topLevelObjectives]);

  const handleTrack = useCallback(async (obj: SuggestedObjective) => {
    await onAcceptObjective(obj);
    setTrackedKeys((prev) => new Set(prev).add(obj.key));
  }, [onAcceptObjective]);

  // Filter objectives
  const filteredTree = useMemo(() => {
    if (filter === "all") return tree;
    if (filter === "tracked") {
      // Only nodes that are tracked (at any level)
      function filterTracked(nodes: TreeNode[]): TreeNode[] {
        return nodes
          .map((n) => ({
            ...n,
            children: filterTracked(n.children),
          }))
          .filter((n) => allTracked.has(n.objective.key) || n.children.length > 0);
      }
      return filterTracked(tree);
    }
    if (filter === "surface") {
      // Only L3 tactics
      function collectSurface(nodes: TreeNode[]): TreeNode[] {
        const result: TreeNode[] = [];
        for (const n of nodes) {
          if (!n.objective.depth || n.objective.depth === "surface") {
            result.push({ ...n, children: [] });
          }
          result.push(...collectSurface(n.children));
        }
        return result;
      }
      return collectSurface(tree);
    }
    return tree;
  }, [tree, filter, allTracked]);

  // Layer counts
  const layerCounts = useMemo(() => {
    const counts = { fundamental: 0, structural: 0, surface: 0 };
    for (const obj of topLevelObjectives) {
      const d = (obj.depth ?? "surface") as DepthLayer;
      counts[d]++;
    }
    return counts;
  }, [topLevelObjectives]);

  // Aggregate stats
  const trackedCount = allTracked.size;
  const avgTriangulation = useMemo(() => {
    const scores = topLevelObjectives
      .map((o) => o.convergence_score ?? 0)
      .filter((s) => s > 0);
    if (scores.length === 0) return 0;
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10);
  }, [topLevelObjectives]);

  // Primary objective (highest priority fundamental, or just highest priority)
  const primaryObjective = useMemo(() => {
    const fundamental = topLevelObjectives.filter((o) => o.depth === "fundamental");
    if (fundamental.length > 0) return fundamental.sort((a, b) => a.priority - b.priority)[0];
    return topLevelObjectives.sort((a, b) => a.priority - b.priority)[0] ?? null;
  }, [topLevelObjectives]);

  // Progress (tracked / total)
  const progressPct = topLevelObjectives.length > 0
    ? Math.round((trackedCount / topLevelObjectives.length) * 100)
    : 0;

  // ── Loading state ──
  if (objectiveAutoLoading && topLevelObjectives.length === 0) {
    return (
      <div className="rounded-[18px] border border-black/[0.07] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03),0_8px_24px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="flex items-center gap-4 px-6 py-5">
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-gradient-to-br from-[#1d1d1f] via-[#2a2238] to-[#3a2c4a] relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(175,82,222,0.45),transparent_60%)]" />
            <DecompositionTreeIcon className="relative z-[1]" />
          </div>
          <div>
            <p className="text-[10.5px] font-semibold text-[#86868b] uppercase tracking-[0.6px]">Detecting objectives...</p>
            <div className="flex items-center gap-2 mt-1">
              <Loader2 className="h-4 w-4 text-[#007aff] animate-spin" />
              <p className="text-sm text-[#6e6e73]">Tracing causal chains through your knowledge graph</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (objectiveAutoError && topLevelObjectives.length === 0) {
    return (
      <div className="rounded-[18px] border border-black/[0.07] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03),0_8px_24px_rgba(0,0,0,0.04)] overflow-hidden p-6 text-center">
        <AlertTriangle className="h-5 w-5 text-red-400 mx-auto mb-2" />
        <p className="text-sm font-medium text-[#1d1d1f]">Objective detection failed</p>
        <p className="text-xs text-red-400 mt-1">{objectiveAutoError}</p>
        {onDetectObjectives && (
          <button onClick={onDetectObjectives} className="mt-3 rounded-lg bg-[#007aff] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0066cc] transition-colors">
            Try again
          </button>
        )}
      </div>
    );
  }

  // ── Empty state ──
  if (topLevelObjectives.length === 0) {
    return (
      <div className="rounded-[18px] border border-black/[0.07] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03),0_8px_24px_rgba(0,0,0,0.04)] overflow-hidden p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1d1d1f] via-[#2a2238] to-[#3a2c4a] mx-auto mb-3 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(175,82,222,0.45),transparent_60%)]" />
          <DecompositionTreeIcon className="relative z-[1]" />
        </div>
        <p className="text-sm font-semibold text-[#1d1d1f]">
          {synthesisData ? "No objectives detected yet" : "Run synthesis first"}
        </p>
        <p className="mt-1.5 text-xs text-[#6e6e73] max-w-[340px] mx-auto leading-relaxed">
          {synthesisData
            ? "Click below to detect objectives from your analysis."
            : "Synthesis is required before objectives can be detected."}
        </p>
        {onDetectObjectives && synthesisData && (
          <button
            onClick={onDetectObjectives}
            disabled={objectiveAutoLoading}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#007aff] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#0066cc] transition-colors disabled:opacity-50 shadow-sm"
          >
            {objectiveAutoLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DecompositionTreeIcon className="h-3.5 w-3.5" />}
            {objectiveAutoLoading ? "Detecting..." : "Detect Objectives"}
          </button>
        )}
      </div>
    );
  }

  // ── Main tree view ──

  return (
    <>
      {showOnboarding && <OnboardingModal onClose={() => setShowOnboarding(false)} />}

      <div className={cn(
        "rounded-[18px] border border-black/[0.07] bg-white overflow-hidden transition-shadow duration-300",
        expanded
          ? "shadow-[0_1px_3px_rgba(0,0,0,0.03),0_16px_40px_rgba(0,0,0,0.06)]"
          : "shadow-[0_1px_3px_rgba(0,0,0,0.03),0_8px_24px_rgba(0,0,0,0.04)]"
      )}>
        {/* ── Collapsed header ── */}
        <div
          className="grid items-center gap-[18px] px-[22px] py-[18px] cursor-pointer transition-colors hover:bg-black/[0.015]"
          style={{ gridTemplateColumns: "auto 1fr auto auto" }}
          onClick={() => setExpanded(!expanded)}
        >
          {/* Icon */}
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-gradient-to-br from-[#1d1d1f] via-[#2a2238] to-[#3a2c4a] relative overflow-hidden flex-shrink-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(175,82,222,0.45),transparent_60%)] pointer-events-none" />
            <DecompositionTreeIcon className="relative z-[1]" />
          </div>

          {/* Content */}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-[#86868b] uppercase tracking-[0.6px] mb-0.5">
              <span className="h-[5px] w-[5px] rounded-full bg-[#34c759] shadow-[0_0_0_2.5px_rgba(52,199,89,0.18)]" />
              Main objective · {topLevelObjectives.length} detected · {trackedCount} tracked
            </div>
            <h3 className="text-[17px] font-semibold text-[#1d1d1f] tracking-[-0.3px] leading-tight truncate">
              {primaryObjective?.title ?? "Detected Objectives"}
            </h3>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-[18px]">
            {/* Layer preview chips */}
            <div className="flex gap-1 items-center">
              {layerCounts.fundamental > 0 && (
                <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums", layerConfig.fundamental.chipBg, layerConfig.fundamental.chipText)}>
                  <span className={cn("h-[5px] w-[5px] rounded-full", layerConfig.fundamental.dotColor)} />
                  {layerCounts.fundamental}
                </span>
              )}
              {layerCounts.structural > 0 && (
                <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums", layerConfig.structural.chipBg, layerConfig.structural.chipText)}>
                  <span className={cn("h-[5px] w-[5px] rounded-full", layerConfig.structural.dotColor)} />
                  {layerCounts.structural}
                </span>
              )}
              {layerCounts.surface > 0 && (
                <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums", layerConfig.surface.chipBg, layerConfig.surface.chipText)}>
                  <span className={cn("h-[5px] w-[5px] rounded-full", layerConfig.surface.dotColor)} />
                  {layerCounts.surface}
                </span>
              )}
            </div>

            {/* Divider */}
            <div className="w-px h-6 bg-black/[0.08]" />

            {/* Triangulation stat */}
            {avgTriangulation > 0 && (
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-base font-semibold text-[#1d1d1f] tracking-[-0.3px] leading-none tabular-nums">
                  {avgTriangulation}<span className="text-[11px] text-[#86868b] font-medium ml-0.5">%</span>
                </span>
                <span className="text-[10.5px] text-[#86868b] font-medium">triangulation</span>
              </div>
            )}

            {/* Help button */}
            <HelpTooltipButton onOpen={() => setShowOnboarding(true)} />
          </div>

          {/* Expand button */}
          <button
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#007aff] text-white shadow-[0_2px_6px_rgba(0,122,255,0.3)] hover:scale-105 hover:shadow-[0_3px_10px_rgba(0,122,255,0.4)] transition-all flex-shrink-0"
            aria-label={expanded ? "Collapse" : "Expand"}
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              className={cn("transition-transform duration-300", expanded && "rotate-180")}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-[3px] bg-black/[0.04] relative">
          <div
            className="h-full bg-gradient-to-r from-[#007aff] to-[#5856d6] transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* ── Expanded body ── */}
        <div className={cn(
          "overflow-hidden transition-all duration-[450ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
          expanded ? "max-h-[4000px]" : "max-h-0"
        )}>
          <div className={cn(
            "px-7 pb-6 pt-2 border-t border-black/[0.06] transition-all duration-300 delay-100",
            expanded ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
          )}>
            {/* Staleness nudge */}
            {needsRefresh && onDetectObjectives && (
              <button
                onClick={onDetectObjectives}
                disabled={objectiveAutoLoading}
                className="flex w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2 text-left transition-colors hover:bg-amber-50 mb-3"
              >
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                <span className="text-[11px] font-medium text-amber-700 flex-1">
                  Structural changes detected — objectives may need updating
                </span>
                {objectiveAutoLoading && <Loader2 className="h-3 w-3 flex-shrink-0 text-amber-400 animate-spin" />}
              </button>
            )}

            {/* Subhead + filters */}
            <div className="flex items-center justify-between py-4 pb-2">
              <span className="text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.6px]">
                Decomposition tree
              </span>
              <div className="flex gap-1.5">
                {(["all", "tracked", "surface"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors",
                      filter === f
                        ? "bg-[rgba(0,122,255,0.1)] text-[#0066cc]"
                        : "bg-black/[0.04] text-[#424245] hover:bg-black/[0.07]"
                    )}
                  >
                    {f === "all" ? "All layers" : f === "tracked" ? "Tracked only" : "L3 tactics"}
                  </button>
                ))}
              </div>
            </div>

            {/* Tree */}
            <div className="relative">
              {/* Main vertical line */}
              {filteredTree.length > 1 && (
                <div className="absolute left-[13px] top-8 bottom-8 border-l-[1.5px] border-dashed border-black/[0.18] z-0" />
              )}

              {filteredTree.map((node, i) => (
                <TreeNodeRenderer
                  key={node.objective.key}
                  node={node}
                  trackedKeys={allTracked}
                  onTrack={handleTrack}
                  index={i}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
