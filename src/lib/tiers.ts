export type AnalysisTier = "quick" | "standard" | "deep" | "comprehensive";
export type ReasoningDepth = "quick" | "standard" | "deep";

export interface TierPromptConfig {
  entityTarget: { min: number; max: number };
  edgeDensityMultiplier: number;
  reasoningDescription: string;
  synthesis: boolean;
}

export interface TierConfig {
  credits: number;
  label: string;
  icon: string;
  time: string;
  description: string;
  agents: string[];
  multiSpace: boolean;
  promptConfig: TierPromptConfig;
}

export const TIERS: Record<AnalysisTier, TierConfig> = {
  quick: {
    credits: 1,
    label: "Quick",
    icon: "⚡",
    time: "~10s",
    description: "Fast single-pass analysis. Good for quick explorations.",
    agents: ["decompose", "structure"],
    multiSpace: false,
    promptConfig: {
      entityTarget: { min: 8, max: 15 },
      edgeDensityMultiplier: 1.2,
      reasoningDescription: "Basic edge coverage, no synthesis.",
      synthesis: false,
    },
  },
  standard: {
    credits: 3,
    label: "Standard",
    icon: "🔍",
    time: "~25s",
    description:
      "Structural validation catches gaps. Better density and fewer blind spots.",
    agents: ["decompose", "structure", "critique", "augment"],
    multiSpace: false,
    promptConfig: {
      entityTarget: { min: 15, max: 25 },
      edgeDensityMultiplier: 2.0,
      reasoningDescription: "Dense edge network with critique pass.",
      synthesis: false,
    },
  },
  deep: {
    credits: 8,
    label: "Deep",
    icon: "🧠",
    time: "~45s",
    description:
      "Multi-space analysis with cross-domain connections and strategic synthesis.",
    agents: [
      "scope",
      "decompose",
      "structure",
      "critique",
      "augment",
      "weave",
      "synthesize",
    ],
    multiSpace: true,
    promptConfig: {
      entityTarget: { min: 20, max: 35 },
      edgeDensityMultiplier: 2.5,
      reasoningDescription: "Multi-space with critique, weave, and synthesis.",
      synthesis: true,
    },
  },
  comprehensive: {
    credits: 15,
    label: "Comprehensive",
    icon: "💎",
    time: "~90s",
    description:
      "Exhaustive analysis with automatic reasoning on every space. For high-stakes decisions.",
    agents: [
      "scope",
      "decompose",
      "structure",
      "critique",
      "augment",
      "weave",
      "synthesize",
      "reason_all",
    ],
    multiSpace: true,
    promptConfig: {
      entityTarget: { min: 25, max: 50 },
      edgeDensityMultiplier: 2.5,
      reasoningDescription:
        "Multi-space with critique, weave, synthesis, and reasoning pass on every space.",
      synthesis: true,
    },
  },
} as const;
