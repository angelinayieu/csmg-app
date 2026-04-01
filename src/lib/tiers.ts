export type AnalysisTier = "quick" | "standard" | "deep" | "comprehensive";

export interface TierConfig {
  credits: number;
  label: string;
  icon: string;
  time: string;
  description: string;
  agents: string[];
  multiSpace: boolean;
  model: {
    decompose: string;
    structure: string;
    critique?: string;
    augment?: string;
    weave?: string;
    synthesize?: string;
    reason?: string;
  };
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
    model: {
      decompose: "claude-sonnet-4-20250514",
      structure: "claude-sonnet-4-20250514",
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
    model: {
      decompose: "claude-sonnet-4-20250514",
      structure: "claude-sonnet-4-20250514",
      critique: "claude-haiku-3-20250307",
      augment: "claude-haiku-3-20250307",
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
    model: {
      decompose: "claude-sonnet-4-20250514",
      structure: "claude-sonnet-4-20250514",
      critique: "claude-haiku-3-20250307",
      augment: "claude-haiku-3-20250307",
      weave: "claude-sonnet-4-20250514",
      synthesize: "claude-sonnet-4-20250514",
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
    model: {
      decompose: "claude-sonnet-4-20250514",
      structure: "claude-sonnet-4-20250514",
      critique: "claude-haiku-3-20250307",
      augment: "claude-haiku-3-20250307",
      weave: "claude-sonnet-4-20250514",
      synthesize: "claude-sonnet-4-20250514",
      reason: "claude-sonnet-4-20250514",
    },
  },
} as const;
