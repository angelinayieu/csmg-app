export interface SpaceOption {
  name: string;
  prefix: string;
  description: string;
  key_concepts: string[];
  priority: number;
  selected: boolean;
}

export type ReasoningDepth = "quick" | "standard" | "deep";

export interface CrossSpaceConfig {
  weave: boolean;
  synthesis: boolean;
  externalKnowledge: boolean;
}

export interface AnalysisConfig {
  spaces: SpaceOption[];
  reasoningDepth: ReasoningDepth;
  crossSpace: CrossSpaceConfig;
}

// Credit costs per component
const CREDITS = {
  perSpace: { quick: 1, standard: 2, deep: 3 },
  weave: 2,
  synthesis: 2,
  externalKnowledge: 3,
} as const;

export function calculateCredits(config: AnalysisConfig): {
  breakdown: Array<{ label: string; credits: number }>;
  total: number;
  estimatedTime: number; // seconds
} {
  const selectedCount = config.spaces.filter((s) => s.selected).length;
  const perSpace = CREDITS.perSpace[config.reasoningDepth];
  const breakdown: Array<{ label: string; credits: number }> = [];

  // Space costs
  if (selectedCount > 0) {
    breakdown.push({
      label: `${selectedCount} area${selectedCount > 1 ? "s" : ""} × ${config.reasoningDepth} depth`,
      credits: selectedCount * perSpace,
    });
  }

  // Cross-space costs (only if 2+ spaces)
  if (selectedCount >= 2) {
    if (config.crossSpace.weave) {
      breakdown.push({ label: "Cross-area connections", credits: CREDITS.weave });
    }
    if (config.crossSpace.synthesis) {
      breakdown.push({ label: "Strategic synthesis", credits: CREDITS.synthesis });
    }
  } else if (selectedCount === 1 && config.crossSpace.synthesis) {
    // Single-space synthesis is cheaper
    breakdown.push({ label: "Synthesis", credits: 1 });
  }

  if (config.crossSpace.externalKnowledge) {
    breakdown.push({ label: "Field research", credits: CREDITS.externalKnowledge });
  }

  const total = breakdown.reduce((sum, b) => sum + b.credits, 0);

  // Estimate time
  const timePerSpace = config.reasoningDepth === "quick" ? 10 : config.reasoningDepth === "standard" ? 20 : 25;
  const baseTime = selectedCount * timePerSpace;
  const weaveTime = config.crossSpace.weave && selectedCount >= 2 ? 8 : 0;
  const synthTime = config.crossSpace.synthesis ? 10 : 0;
  const estimatedTime = baseTime + weaveTime + synthTime;

  return { breakdown, total, estimatedTime };
}

export function getSmartDefaults(textLength: number): AnalysisConfig {
  if (textLength < 200) {
    return {
      spaces: [{ name: "Analysis", prefix: "C", description: "", key_concepts: [], priority: 1, selected: true }],
      reasoningDepth: "quick",
      crossSpace: { weave: false, synthesis: false, externalKnowledge: false },
    };
  }
  if (textLength < 800) {
    return {
      spaces: [], // Will be filled by scope mapper
      reasoningDepth: "standard",
      crossSpace: { weave: true, synthesis: true, externalKnowledge: false },
    };
  }
  return {
    spaces: [], // Will be filled by scope mapper
    reasoningDepth: "standard",
    crossSpace: { weave: true, synthesis: true, externalKnowledge: false },
  };
}
