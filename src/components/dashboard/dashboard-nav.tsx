"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Target,
  Radar,
  Network,
  Layers,
  Database,
  Activity,
  Zap,
  AlertTriangle,
  RefreshCw,
  BarChart3,
  HelpCircle,
  BookOpen,
  ListChecks,
  Link2,
  ChevronRight,
  Lock,
  Map,
  Gauge,
  Compass,
  Clock,
  Package,
} from "lucide-react";

export interface DashboardSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  available: boolean;
  /** Reason this section is locked */
  lockReason?: string;
  /** Sub-group label — sections with same group are visually grouped */
  group?: "top" | "columns" | "synthesis";
}

interface DashboardNavProps {
  sections: DashboardSection[];
  className?: string;
}

export function DashboardNav({ sections, className }: DashboardNavProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredLock, setHoveredLock] = useState<string | null>(null);

  // Observe which section is in view
  useEffect(() => {
    const availableSections = sections.filter((s) => s.available);
    if (availableSections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the most visible section
        let bestEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
              bestEntry = entry;
            }
          }
        }
        if (bestEntry) {
          setActiveSection(bestEntry.target.id);
        }
      },
      { threshold: [0.1, 0.3, 0.5], rootMargin: "-80px 0px -40% 0px" }
    );

    for (const section of availableSections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [sections]);

  const scrollTo = useCallback((sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Group sections
  const topSections = sections.filter((s) => s.group === "top");
  const columnSections = sections.filter((s) => s.group === "columns");
  const synthesisSections = sections.filter((s) => s.group === "synthesis");

  const renderSection = (section: DashboardSection) => {
    const isActive = activeSection === section.id;
    const isLocked = !!section.lockReason;

    return (
      <button
        key={section.id}
        onClick={() => scrollTo(section.id)}
        onMouseEnter={() => isLocked && setHoveredLock(section.id)}
        onMouseLeave={() => setHoveredLock(null)}
        className={cn(
          "group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all w-full text-left",
          isActive && !isLocked
            ? "bg-interaxis-50 text-interaxis-700"
            : isLocked
              ? "text-gray-300 cursor-not-allowed"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
        )}
      >
        <span className={cn(
          "flex-shrink-0 transition-colors",
          isActive && !isLocked ? "text-interaxis-500" : isLocked ? "text-gray-300" : "text-gray-400"
        )}>
          {isLocked ? <Lock className="h-3 w-3" /> : section.icon}
        </span>
        {!collapsed && (
          <span className="truncate">{section.label}</span>
        )}
        {isActive && !isLocked && !collapsed && (
          <ChevronRight className="h-3 w-3 ml-auto text-interaxis-400 flex-shrink-0" />
        )}

        {/* Lock tooltip */}
        {hoveredLock === section.id && section.lockReason && !collapsed && (
          <div className="absolute left-full ml-2 top-0 z-50 w-48 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[10px] text-gray-500 shadow-md">
            {section.lockReason}
          </div>
        )}
      </button>
    );
  };

  const renderGroup = (label: string, items: DashboardSection[]) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-0.5">
        {!collapsed && (
          <p className="px-2 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-gray-300">
            {label}
          </p>
        )}
        {items.map(renderSection)}
      </div>
    );
  };

  return (
    <div
      className={cn(
        "sticky top-4 flex flex-col rounded-xl border border-gray-200 bg-white/95 backdrop-blur-sm shadow-sm transition-all z-10",
        collapsed ? "w-10 p-1" : "w-44 p-2",
        className
      )}
    >
      {/* Header / collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 transition-colors"
      >
        <Map className="h-3 w-3 flex-shrink-0" />
        {!collapsed && <span>Sections</span>}
      </button>

      <div className="mt-1 space-y-1">
        {renderGroup("Overview", topSections)}
        {renderGroup("Core", columnSections)}
        {renderGroup("Analysis", synthesisSections)}
      </div>

      {/* Progress indicator */}
      {!collapsed && (
        <div className="mt-3 px-2 py-1.5 border-t border-gray-100">
          <div className="flex items-center justify-between text-[9px] text-gray-400">
            <span>Active</span>
            <span>
              {sections.filter((s) => !s.lockReason).length}/{sections.length}
            </span>
          </div>
          <div className="mt-1 h-1 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-interaxis-400 transition-all"
              style={{
                width: `${(sections.filter((s) => !s.lockReason).length / sections.length) * 100}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Build the section definitions from current dashboard state.
 */
export function buildDashboardSections(opts: {
  hasSynthesis: boolean;
  hasStrategy: boolean;
  hasGoal: boolean;
  hasObjectives: boolean;
  entityCount: number;
  hasDecompositionQuality?: boolean;
}): DashboardSection[] {
  const { hasSynthesis, hasStrategy, hasGoal, hasObjectives, entityCount, hasDecompositionQuality } = opts;
  const needsSynthesis = "Run synthesis to unlock full content";

  return [
    // ── OVERVIEW (Row 1) ──
    {
      id: "section-objectives",
      label: "Objectives",
      icon: <Target className="h-3 w-3" />,
      available: true,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "top",
    },

    // ── CORE (Row 2: 3-column grid) ──
    {
      id: "section-graph",
      label: "Knowledge Graph",
      icon: <Network className="h-3 w-3" />,
      available: true,
      lockReason: entityCount > 0 ? undefined : "Add entities via chat to build the graph",
      group: "columns",
    },
    {
      id: "section-probability",
      label: "Probability Spaces",
      icon: <Network className="h-3 w-3" />,
      available: true,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "columns",
    },
    {
      id: "section-mechanism-map",
      label: "Digital Twin",
      icon: <Activity className="h-3 w-3" />,
      available: entityCount >= 3,
      group: "columns",
    },
    ...(hasSynthesis && entityCount >= 5 ? [{
      id: "section-layers" as const,
      label: "Knowledge Layers" as const,
      icon: <Layers className="h-3 w-3" /> as React.ReactNode,
      available: true,
      group: "columns" as const,
    }] : []),

    // ── Row 3: Inventory + Strategy ──
    {
      id: "section-inventory",
      label: "Entity Inventory",
      icon: <Database className="h-3 w-3" />,
      available: true,
      lockReason: entityCount > 0 ? undefined : "Add entities via chat first",
      group: "columns",
    },
    {
      id: "section-strategy",
      label: "Strategy",
      icon: <Zap className="h-3 w-3" />,
      available: true,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "columns",
    },

    // ── Row 4: Intelligence + Insights ──
    {
      id: "section-radar",
      label: "Intelligence Radar",
      icon: <Radar className="h-3 w-3" />,
      available: true,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "columns",
    },
    {
      id: "section-insights",
      label: "Insights",
      icon: <BookOpen className="h-3 w-3" />,
      available: true,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "columns",
    },

    // ── ANALYSIS (Strategy sections) ──
    {
      id: "section-bottleneck",
      label: "Bottleneck",
      icon: <AlertTriangle className="h-3 w-3" />,
      available: true,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "synthesis",
    },
    {
      id: "section-leverage",
      label: "Leverage Points",
      icon: <Zap className="h-3 w-3" />,
      available: true,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "synthesis",
    },
    {
      id: "section-risks",
      label: "Risk Points",
      icon: <AlertTriangle className="h-3 w-3" />,
      available: true,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "synthesis",
    },
    {
      id: "section-loops",
      label: "Feedback Loops",
      icon: <RefreshCw className="h-3 w-3" />,
      available: true,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "synthesis",
    },
    {
      id: "section-scenarios",
      label: "Scenarios",
      icon: <BarChart3 className="h-3 w-3" />,
      available: true,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "synthesis",
    },
    {
      id: "section-actions",
      label: "Action Plan",
      icon: <ListChecks className="h-3 w-3" />,
      available: true,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "synthesis",
    },

    // ── Quality (bottom) ──
    ...(hasDecompositionQuality ? [{
      id: "section-decomp-quality" as const,
      label: "Decomp Quality" as const,
      icon: <Gauge className="h-3 w-3" /> as React.ReactNode,
      available: true,
      group: "synthesis" as const,
    }] : []),
  ];
}
