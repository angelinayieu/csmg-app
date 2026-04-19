"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Lock, ChevronRight, LayoutGrid, FlaskConical, BookOpen, Database } from "lucide-react";
import {
  IconDashboard,
  IconTarget,
  IconGraph,
  IconCurve,
  IconPulse,
  IconLayers,
  IconCubes,
  IconCompass,
  IconRadar,
  IconBook,
  IconConverge,
  IconFunnel,
  IconLever,
  IconWarn,
  IconLoop,
  IconBranches,
  IconCheckList,
  IconSynth,
  IconSparkles,
  IconGauge,
  IconBars,
} from "@/components/dashboard/glass-glyphs";

interface SectionItem {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  lockReason?: string;
  group: "overview" | "workspace" | "core" | "intelligence" | "library";
  // Only shown when the space's use_case_template_id matches one of these
  // (or always when omitted)
  show_for_templates?: string[];
}

interface SpaceSectionNavProps {
  spaceId: string;
  hasSynthesis: boolean;
  entityCount: number;
  hasStrategy: boolean;
  hasGoal: boolean;
  /** Set when the space was created from a use-case template — unlocks template-specific routes like /journal */
  useCaseTemplateId?: string | null;
}

export function SpaceSectionNav({
  spaceId,
  hasSynthesis,
  entityCount,
  hasStrategy,
  hasGoal,
  useCaseTemplateId,
}: SpaceSectionNavProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const base = `/app/space/${spaceId}`;
  const needsSynthesis = "Run synthesis to unlock";

  const sections: SectionItem[] = [
    // ── OVERVIEW ──
    {
      id: "dashboard",
      label: "Dashboard",
      href: base,
      icon: <IconDashboard className="h-4 w-4" />,
      group: "overview",
    },
    {
      id: "objectives",
      label: "Objectives",
      href: `${base}/objectives`,
      icon: <IconTarget className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "overview",
    },

    // ── WORKSPACE (interactive surfaces) ──
    // These are reachable immediately — no synthesis gate, no entity minimum.
    // They're how the user ACTIVELY works on their space.
    {
      id: "whiteboard",
      label: "Whiteboard",
      href: `${base}/whiteboard`,
      icon: <LayoutGrid className="h-4 w-4" />,
      group: "workspace",
    },
    {
      id: "whiteboard-brainstorm",
      label: "Brainstorm",
      href: `${base}/whiteboard/brainstorm`,
      icon: <IconSparkles className="h-4 w-4" />,
      group: "workspace",
    },
    {
      id: "interventions",
      label: "Interventions",
      href: `${base}/interventions`,
      icon: <IconCheckList className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "workspace",
    },
    {
      id: "lab",
      label: "Lab",
      href: `${base}/lab`,
      icon: <FlaskConical className="h-4 w-4" />,
      group: "workspace",
    },
    // Journal — only shown for journaling-template spaces
    {
      id: "journal",
      label: "Journal",
      href: `${base}/journal`,
      icon: <BookOpen className="h-4 w-4" />,
      group: "workspace",
      show_for_templates: ["journal_self_discovery", "relationship_dynamics"],
    },

    // ── CORE ──
    {
      id: "graph",
      label: "Knowledge Graph",
      href: `${base}/graph`,
      icon: <IconGraph className="h-4 w-4" />,
      lockReason: entityCount > 0 ? undefined : "Add entities first",
      group: "core",
    },
    {
      id: "inventory",
      label: "Entity Inventory",
      href: `${base}/inventory`,
      icon: <IconCubes className="h-4 w-4" />,
      lockReason: entityCount > 0 ? undefined : "Add entities first",
      group: "core",
    },
    {
      id: "probability",
      label: "Probability Spaces",
      href: `${base}/probability`,
      icon: <IconCurve className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "core",
    },
    {
      id: "twin",
      label: "Twin",
      href: `${base}/twin`,
      icon: <IconGauge className="h-4 w-4" />,
      lockReason: entityCount >= 3 ? undefined : "Need 3+ entities",
      group: "core",
    },
    {
      id: "strategy",
      label: "Strategy",
      href: `${base}/strategy`,
      icon: <IconCompass className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "core",
    },
    ...(hasSynthesis && entityCount >= 5
      ? [
          {
            id: "layers",
            label: "Knowledge Layers",
            href: `${base}/layers`,
            icon: <IconLayers className="h-4 w-4" />,
            group: "core" as const,
          },
        ]
      : []),
    {
      id: "causal-chains",
      label: "Causal Chains",
      href: `${base}/causal-chains`,
      icon: <IconSparkles className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "core",
    },

    // ── INTELLIGENCE (analysis outputs from synthesis) ──
    {
      id: "synthesis",
      label: "Synthesis",
      href: `${base}/synthesis`,
      icon: <IconSynth className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "intelligence",
    },
    {
      id: "radar",
      label: "Intelligence Radar",
      href: `${base}/radar`,
      icon: <IconRadar className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "intelligence",
    },
    {
      id: "convergence",
      label: "Convergence",
      href: `${base}/convergence`,
      icon: <IconConverge className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "intelligence",
    },
    {
      id: "loops",
      label: "Feedback Loops",
      href: `${base}/loops`,
      icon: <IconLoop className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "intelligence",
    },
    {
      id: "scenarios",
      label: "Scenarios",
      href: `${base}/scenarios`,
      icon: <IconBranches className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "intelligence",
    },
    {
      id: "leverage",
      label: "Leverage Points",
      href: `${base}/leverage`,
      icon: <IconLever className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "intelligence",
    },
    {
      id: "risks",
      label: "Risk Points",
      href: `${base}/risks`,
      icon: <IconWarn className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "intelligence",
    },
    {
      id: "bottleneck",
      label: "Bottleneck",
      href: `${base}/bottleneck`,
      icon: <IconFunnel className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "intelligence",
    },
    {
      id: "insights",
      label: "Insights",
      href: `${base}/insights`,
      icon: <IconBook className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "intelligence",
    },
    {
      id: "agents",
      label: "Agents",
      href: `${base}/agents`,
      icon: <IconCubes className="h-4 w-4" />,
      lockReason: hasSynthesis ? undefined : needsSynthesis,
      group: "intelligence",
    },

    // ── LIBRARY (shared / global resources reachable from the space) ──
    {
      id: "patterns",
      label: "Pattern Library",
      href: `/patterns`, // global — per-space version removed in route consolidation
      icon: <Database className="h-4 w-4" />,
      group: "library",
    },
  ];

  const isActive = (href: string) => {
    if (href === base) return pathname === base;
    return pathname.startsWith(href);
  };

  // Filter out template-specific items when this space isn't that template
  const templateFiltered = sections.filter((s) => {
    if (!s.show_for_templates) return true;
    return useCaseTemplateId ? s.show_for_templates.includes(useCaseTemplateId) : false;
  });

  const overviewSections = templateFiltered.filter((s) => s.group === "overview");
  const workspaceSections = templateFiltered.filter((s) => s.group === "workspace");
  const coreSections = templateFiltered.filter((s) => s.group === "core");
  const intelligenceSections = templateFiltered.filter((s) => s.group === "intelligence");
  const librarySections = templateFiltered.filter((s) => s.group === "library");

  const renderSection = (section: SectionItem) => {
    const active = isActive(section.href);
    const locked = !!section.lockReason;

    if (locked) {
      return (
        <div
          key={section.id}
          className="group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium text-gray-300 cursor-not-allowed w-full"
          title={section.lockReason}
        >
          <span className="flex-shrink-0 text-gray-300">
            <Lock className="h-3 w-3" />
          </span>
          {!collapsed && <span className="truncate">{section.label}</span>}
        </div>
      );
    }

    return (
      <Link
        key={section.id}
        href={section.href}
        className={cn(
          "group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all w-full text-left",
          active
            ? "bg-interaxis-50 text-interaxis-700"
            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
        )}
      >
        <span
          className={cn(
            "flex-shrink-0 transition-colors",
            active ? "text-interaxis-500" : "text-gray-400"
          )}
        >
          {section.icon}
        </span>
        {!collapsed && <span className="truncate">{section.label}</span>}
        {active && !collapsed && (
          <ChevronRight className="h-3 w-3 ml-auto text-interaxis-400 flex-shrink-0" />
        )}
      </Link>
    );
  };

  const renderGroup = (label: string, items: SectionItem[]) => {
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

  const unlockedCount = templateFiltered.filter((s) => !s.lockReason).length;
  const totalVisible = templateFiltered.length;

  return (
    <div
      className={cn(
        "flex-shrink-0 flex flex-col border-r border-gray-200 bg-white/95 transition-all overflow-y-auto",
        collapsed ? "w-10 p-1" : "w-44 p-2"
      )}
    >
      {/* Header / collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 transition-colors"
      >
        <IconLayers className="h-3 w-3 flex-shrink-0" />
        {!collapsed && <span>Sections</span>}
      </button>

      <div className="mt-1 space-y-1">
        {renderGroup("Overview", overviewSections)}
        {renderGroup("Workspace", workspaceSections)}
        {renderGroup("Core", coreSections)}
        {renderGroup("Intelligence", intelligenceSections)}
        {renderGroup("Library", librarySections)}
      </div>

      {/* Progress indicator */}
      {!collapsed && (
        <div className="mt-3 px-2 py-1.5 border-t border-gray-100">
          <div className="flex items-center justify-between text-[9px] text-gray-400">
            <span>Active</span>
            <span>
              {unlockedCount}/{totalVisible}
            </span>
          </div>
          <div className="mt-1 h-1 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-interaxis-400 transition-all"
              style={{
                width: `${totalVisible > 0 ? (unlockedCount / totalVisible) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
