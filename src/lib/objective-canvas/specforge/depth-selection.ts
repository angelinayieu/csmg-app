// ── SpecForge · Depth Selection Controller ──────────────────────────
//
// A deterministic first version of the Depth Selection Controller. It runs
// immediately after Prompt Power-Up, decides how much reasoning depth the idea
// deserves, renders a visible "Depth Badge" card, and threads the decision into
// downstream engines. This keeps the module cheap and reliable while preserving
// the existing full SpecForge autopilot path.

import type { PowerUpResult, SpecForgeCard } from "./types";

export type SpecForgeDepthLevel = 1 | 2 | 3 | 4 | 5;

export interface DepthScores {
  ambiguity: number;
  target_user_uncertainty: number;
  causal_complexity: number;
  desired_result_vagueness: number;
  differentiation_uncertainty: number;
  decision_stakes: number;
  implementation_cost: number;
  confidence_risk: number;
  research_need: number;
  user_requested_depth: number;
}

export interface DepthSelectionResult {
  depth_level: SpecForgeDepthLevel;
  depth_name: string;
  reason: string;
  scores: DepthScores;
  required_modules: string[];
  modules_to_skip_or_delay: string[];
  risk_if_too_shallow: string;
  risk_if_too_deep: string;
  escalation_conditions: string[];
  user_override_options: string[];
  confidence: number;
}

const clean = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const clampScore = (value: number): number => Math.max(1, Math.min(5, value));

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function scoreFromText(text: string, groups: string[][], base = 1): number {
  return clampScore(
    base + groups.reduce((score, words) => score + (includesAny(text, words) ? 1 : 0), 0),
  );
}

function depthName(level: SpecForgeDepthLevel): string {
  switch (level) {
    case 1:
      return "Surface clarification";
    case 2:
      return "Structured product model";
    case 3:
      return "Multifactor causal model";
    case 4:
      return "Research-backed strategic model";
    case 5:
      return "Iterative validation model";
  }
}

function modulesForDepth(level: SpecForgeDepthLevel): string[] {
  if (level === 1) {
    return [
      "Prompt Power-Up",
      "Light target user guess",
      "Light desired result guess",
      "Quick recommendation",
    ];
  }
  if (level === 2) {
    return [
      "Prompt Power-Up",
      "Target User Layering",
      "Basic Problem Cause Model",
      "Desired Result Stack",
      "Basic Differentiation",
      "MVP App Directions",
    ];
  }
  const level3 = [
    "Prompt Power-Up",
    "Target User Layering",
    "Multifactor Causal Model",
    "Desired Result Stack",
    "Convergence",
    "Differentiation",
    "Solution Families",
    "MVP App Directions",
    "Evaluation",
    "Quality Critic",
  ];
  if (level === 3) return level3;
  if (level === 4) {
    return [
      ...level3,
      "Research triggers",
      "Evidence confidence scoring",
      "Competitor verification",
      "Validation plan",
    ];
  }
  return [
    ...level3,
    "Experimentation Lab",
    "Feedback Loop Tracker",
    "Iteration Timeline",
    "Recommendation recalculation",
  ];
}

function delayedForDepth(level: SpecForgeDepthLevel): string[] {
  if (level <= 2) {
    return [
      "Full causal-loop tournament",
      "External research",
      "Validation lab",
      "Iteration timeline",
    ];
  }
  if (level === 3) {
    return [
      "External competitor verification",
      "Automated validation lab",
      "Iteration timeline",
    ];
  }
  if (level === 4) {
    return ["Iteration timeline", "Model versioning"];
  }
  return ["Nothing material; use iterative validation mode"];
}

function chooseLevel(total: number, text: string): SpecForgeDepthLevel {
  if (
    includesAny(text, [
      "feedback",
      "iteration",
      "iterative",
      "validated",
      "validation data",
      "user testing",
      "experiment results",
    ])
  ) {
    return 5;
  }
  if (
    includesAny(text, [
      "competitor",
      "market",
      "current products",
      "public launch",
      "pricing",
      "fundraising",
      "investment",
    ])
  ) {
    return 4;
  }
  if (
    total >= 24 ||
    includesAny(text, [
      "first principles",
      "causal",
      "world class",
      "agent",
      "multi-module",
      "deep",
      "sophisticated",
    ])
  ) {
    return 3;
  }
  if (total >= 16) return 2;
  return 1;
}

export function selectSpecForgeDepth(args: {
  idea: string;
  powerUp: PowerUpResult;
}): DepthSelectionResult {
  const idea = clean(args.idea).toLowerCase();
  const p = args.powerUp;
  const allText = [
    idea,
    p.clean_summary,
    p.root_intent,
    p.desired_result_guess,
    p.target_user_guess,
    p.core_problem_guess,
    ...(p.ambiguities ?? []),
    p.powered_up_prompt,
  ]
    .map(clean)
    .join(" ")
    .toLowerCase();

  const ambiguityCount = Array.isArray(p.ambiguities) ? p.ambiguities.length : 0;
  const scores: DepthScores = {
    ambiguity: clampScore(1 + Math.ceil(ambiguityCount / 2)),
    target_user_uncertainty: clampScore(
      clean(p.target_user_guess).length < 18 ? 4 : includesAny(allText, ["everyone", "users", "people"]) ? 3 : 2,
    ),
    causal_complexity: scoreFromText(
      allText,
      [
        ["causal", "root cause", "why", "system", "loop"],
        ["behavior", "incentive", "trust", "friction", "workflow"],
        ["agent", "multi-module", "automation", "platform", "marketplace"],
        ["strategy", "positioning", "differentiation", "mvp"],
      ],
      1,
    ),
    desired_result_vagueness: clampScore(
      includesAny(allText, ["better", "improve", "optimize", "clarity", "growth"]) ? 4 : 2,
    ),
    differentiation_uncertainty: scoreFromText(
      allText,
      [
        ["competitor", "alternative", "different", "unique"],
        ["market", "category", "positioning", "advantage"],
      ],
      2,
    ),
    decision_stakes: scoreFromText(
      allText,
      [
        ["launch", "funding", "enterprise", "revenue", "pricing"],
        ["hire", "team", "roadmap", "investment"],
      ],
      2,
    ),
    implementation_cost: scoreFromText(
      allText,
      [
        ["build", "prototype", "spec", "architecture"],
        ["integration", "backend", "database", "workflow"],
        ["agent", "ai", "automation", "multi-step"],
      ],
      1,
    ),
    confidence_risk: scoreFromText(
      allText,
      [
        ["assumption", "uncertain", "unknown", "maybe"],
        ["risk", "validate", "test", "evidence"],
      ],
      ambiguityCount >= 3 ? 3 : 2,
    ),
    research_need: scoreFromText(
      allText,
      [
        ["competitor", "market", "current", "today"],
        ["pricing", "public company", "trend", "benchmark"],
      ],
      1,
    ),
    user_requested_depth: scoreFromText(
      allText,
      [
        ["deep", "first principles", "causal", "world class"],
        ["quick", "simple", "summary"],
      ],
      2,
    ),
  };

  if (includesAny(allText, ["quick", "simple summary", "lightweight"])) {
    scores.user_requested_depth = 1;
  }

  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const depth_level = chooseLevel(total, allText);
  const required_modules = modulesForDepth(depth_level);
  const modules_to_skip_or_delay = delayedForDepth(depth_level);

  return {
    depth_level,
    depth_name: depthName(depth_level),
    reason:
      depth_level >= 4
        ? "The idea appears to need evidence-aware strategy before downstream product bets are trusted."
        : depth_level === 3
          ? "The idea has enough ambiguity, causal interaction, or build consequence to justify the full causal SpecForge run."
          : depth_level === 2
            ? "The idea needs structure and MVP direction, but not the heaviest research or validation layers yet."
            : "The idea can be clarified quickly before deeper modeling is worth the cost.",
    scores,
    required_modules,
    modules_to_skip_or_delay,
    risk_if_too_shallow:
      depth_level >= 3
        ? "If this stays shallow, SpecForge may generate generic features instead of attacking the root constraint."
        : "If this stays too shallow, the next recommendation may optimize for an imaginary average user.",
    risk_if_too_deep:
      depth_level <= 2
        ? "If this runs too deep immediately, the workspace may feel slow or academic before the user sees value."
        : "If this goes deeper than this badge recommends, research and validation may outrun the current product thesis.",
    escalation_conditions: [
      "Quality critic flags shallow or generic output",
      "Root constraint remains vague",
      "MVP candidates look interchangeable",
      "User asks for deeper reasoning or current-market evidence",
    ],
    user_override_options: ["Quick mode", "Full causal run", "Research-backed run"],
    confidence: Math.max(58, Math.min(92, 58 + Math.round(total * 0.8))),
  };
}

export function depthSelectionToCard(depth: DepthSelectionResult): SpecForgeCard {
  const topScores = Object.entries(depth.scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, score]) => `${key.replaceAll("_", " ")} ${score}/5`);

  return {
    stage: "depth",
    eyebrow: `Depth · level ${depth.depth_level}`,
    title: depth.depth_name,
    subtitle: depth.reason,
    body: [
      `• Drivers: ${topScores.join(" · ")}`,
      `• Run: ${depth.required_modules.slice(0, 4).join(", ")}${depth.required_modules.length > 4 ? "..." : ""}`,
      `• Delay: ${depth.modules_to_skip_or_delay.slice(0, 3).join(", ")}`,
      `• Confidence: ${depth.confidence}/100`,
    ].join("\n"),
    layout: "spine",
  };
}

export function summarizeDepthForContext(depth: DepthSelectionResult): string {
  return [
    `Depth level: ${depth.depth_level} — ${depth.depth_name}`,
    `Depth reason: ${depth.reason}`,
    `Required modules: ${depth.required_modules.join("; ")}`,
    `Delay or skip: ${depth.modules_to_skip_or_delay.join("; ")}`,
    `Risk if too shallow: ${depth.risk_if_too_shallow}`,
  ].join("\n");
}
