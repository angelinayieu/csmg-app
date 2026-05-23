import type { UserIntent } from "@/types/analysis";
import type { ImprovementGoal } from "@/types/goals";

// ── Human-readable label maps ──

const ROLE_LABELS: Record<string, string> = {
  solo_founder: "a solo founder building independently",
  founding_team: "a founding team making collective decisions",
  investor: "an investor evaluating an opportunity",
  advisor: "an advisor guiding strategy",
  researcher: "a researcher investigating a system",
  student: "a student learning and exploring",
  operator: "an operator running day-to-day execution",
  executive: "an executive making high-level decisions",
};

const GOAL_LABELS: Record<string, string> = {
  make_decision: "make a specific decision between options",
  understand_system: "deeply understand how a system works",
  build_plan: "build an actionable execution plan",
  evaluate_risk: "evaluate risks and failure modes",
  explore_options: "explore the option space before committing",
  validate_assumptions: "validate or challenge key assumptions",
};

const CONTEXT_LABELS: Record<string, string> = {
  startup: "startup / new venture",
  research: "research / academic",
  career: "career / professional development",
  strategy: "strategic planning",
  operations: "operations / execution",
  investment: "investment / evaluation",
  education: "education / learning",
};

function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

function formatGoal(goal: string): string {
  return GOAL_LABELS[goal] ?? goal.replace(/_/g, " ");
}

function formatContext(ctx: string): string {
  return CONTEXT_LABELS[ctx] ?? ctx.replace(/_/g, " ");
}

// ── Core intent block (used by most prompts) ──

export function buildIntentBlock(intent?: UserIntent | null): string {
  if (!intent?.user_role && !intent?.primary_goal && !intent?.context_type) {
    return "";
  }

  const parts: string[] = ["--- INTENT CONTEXT ---"];
  if (intent.user_role) parts.push(`USER ROLE: ${formatRole(intent.user_role)}`);
  if (intent.primary_goal) parts.push(`PRIMARY GOAL: ${formatGoal(intent.primary_goal)}`);
  if (intent.context_type) parts.push(`SITUATION TYPE: ${formatContext(intent.context_type)}`);
  parts.push("Weight your analysis toward what serves this specific user's goal.");
  parts.push("---");

  return "\n\n" + parts.join("\n");
}

// ── Decomposition-specific intent guidance ──

export function buildDecompIntentBlock(intent?: UserIntent | null): string {
  const base = buildIntentBlock(intent);
  if (!base) return "";

  const goalGuidance: Record<string, string> = {
    make_decision:
      "ENTITY PRIORITIZATION: Prioritize tradeoffs, decision points, constraints, and options. Weight relationships that clarify which option dominates under which conditions.",
    understand_system:
      "ENTITY PRIORITIZATION: Prioritize structural relationships, feedback loops, and causal chains. Extract the full mechanism — how inputs propagate to outputs.",
    build_plan:
      "ENTITY PRIORITIZATION: Prioritize actionable resources, dependencies, sequences, and milestones. Weight relationships by execution order and blocking dependencies.",
    evaluate_risk:
      "ENTITY PRIORITIZATION: Prioritize risk factors, failure modes, dependencies, and unknowns. Weight relationships by failure propagation and blast radius.",
    explore_options:
      "ENTITY PRIORITIZATION: Prioritize the option space — alternatives, tradeoffs, and their boundary conditions. Extract what makes each option viable or not.",
    validate_assumptions:
      "ENTITY PRIORITIZATION: Prioritize assumptions (mark as [ASSUMED]), the evidence for/against each, and the consequences if they're wrong.",
  };

  const guidance = intent?.primary_goal ? goalGuidance[intent.primary_goal] ?? "" : "";

  return base.replace("---\n", guidance ? `${guidance}\n---\n` : "---\n");
}

// ── Scope-specific intent guidance ──

export function buildScopeIntentBlock(intent?: UserIntent | null): string {
  const base = buildIntentBlock(intent);
  if (!base) return "";

  const goalGuidance: Record<string, string> = {
    make_decision:
      "Design spaces around the decision axes — one space per major tradeoff or option the user faces.",
    understand_system:
      "Design spaces around system layers or feedback domains — each space should reveal a different mechanism.",
    build_plan:
      "Design spaces around execution phases or resource categories — each space maps to a workstream.",
    evaluate_risk:
      "Design spaces around risk domains or failure mode categories — each space covers a distinct threat surface.",
    explore_options:
      "Design spaces around the major option clusters — each space represents a qualitatively different path.",
    validate_assumptions:
      "Design spaces around the assumption categories — group related assumptions that would fail together.",
  };

  const guidance = intent?.primary_goal ? goalGuidance[intent.primary_goal] ?? "" : "";

  return base.replace(
    "Weight your analysis toward what serves this specific user's goal.",
    guidance
      ? `${guidance}\nSpace names should reflect the user's actual decision/goal, not generic business categories.`
      : "Space names should reflect the user's actual decision/goal, not generic business categories."
  );
}

// ── Synthesis-specific intent addendum ──

export function buildSynthesisIntentBlock(intent?: UserIntent | null): string {
  if (!intent?.user_role && !intent?.primary_goal && !intent?.context_type) {
    return "";
  }

  const roleParts: string[] = [];
  if (intent.user_role) roleParts.push(formatRole(intent.user_role));
  if (intent.primary_goal) roleParts.push(`trying to ${formatGoal(intent.primary_goal)}`);
  if (intent.context_type) roleParts.push(`in a ${formatContext(intent.context_type)} context`);

  const roleStr = roleParts.join(" ");

  return `

--- INTENT CONTEXT ---
The user is ${roleStr}.

ACTION PLAN CONDITIONING:
- The 3 action_plan paths MUST be tailored to this user's ACTUAL situation:
  - Paths represent the user's real options or approaches, not generic personas ("Solo builder" / "Team" / "Pivot" are BANNED unless they match the user's actual situation)
  - Path labels and descriptions reflect their stated role and goal
  - Action items are things THIS role can actually do (a solo founder can't "hire a VP of Sales" as a Today action; an investor can't "refactor the codebase")
- Example: An investor evaluating risk gets paths like "Invest now / Conditional invest / Pass"
- Example: A founder deciding between markets gets paths named after the actual market options

LEVERAGE/RISK FRAMING:
- Frame leverage points in terms of what THIS role can act on
- Frame risks in terms of what THIS role should worry about
- An investor cares about different risks than an operator

OPEN QUESTIONS:
- Surface unknowns that matter for THIS user's specific goal
- A researcher needs different answers than a founder
---`;
}

// ── Research-specific intent guidance ──

export function buildResearchIntentBlock(intent?: UserIntent | null): string {
  const base = buildIntentBlock(intent);
  if (!base) return "";

  const goalGuidance: Record<string, string> = {
    make_decision:
      "RESEARCH BIAS: Focus on decision-relevant precedents, success/failure rates of comparable decisions, and data that clarifies which option dominates.",
    understand_system:
      "RESEARCH BIAS: Focus on established frameworks that explain this system's dynamics, empirical data on similar systems, and academic research on the mechanisms involved.",
    build_plan:
      "RESEARCH BIAS: Focus on implementation patterns, resource benchmarks, timeline data from comparable projects, and common execution pitfalls.",
    evaluate_risk:
      "RESEARCH BIAS: Focus on failure modes in analogous situations, risk statistics, cautionary precedents, and known blind spots in this domain.",
    explore_options:
      "RESEARCH BIAS: Focus on the full option landscape — alternatives the user may not have considered, and precedents showing which options worked in similar contexts.",
    validate_assumptions:
      "RESEARCH BIAS: Focus on data that confirms or challenges the user's key assumptions. Find empirical evidence, counter-examples, and boundary conditions.",
  };

  const guidance = intent?.primary_goal ? goalGuidance[intent.primary_goal] ?? "" : "";

  return base.replace("---\n", guidance ? `${guidance}\n---\n` : "---\n");
}

// ── Chat-specific intent line (legacy, used when no focus stack) ──

export function buildChatIntentLine(intent?: UserIntent | null): string {
  if (!intent?.user_role && !intent?.primary_goal) return "";

  const parts: string[] = [];
  if (intent.user_role) parts.push(formatRole(intent.user_role));
  if (intent.primary_goal) parts.push(`trying to ${formatGoal(intent.primary_goal)}`);

  return `\n\nUSER CONTEXT: The user is ${parts.join(" ")}. Tailor your responses to their specific role, expertise level, and goal. Use language and recommendations appropriate for their situation.`;
}

// ── Shell-aware intent block (intent × shell level → field emphasis) ──

type ShellType = "space" | "entity" | "edge" | "insight";

/** Role-specific emphasis at each shell level */
const ROLE_SHELL_EMPHASIS: Record<string, Partial<Record<ShellType, string>>> = {
  solo_founder: {
    space: "Emphasize actionable levers this person can pull themselves. Flag resource constraints and single-point-of-failure risks. Prioritize time-to-impact.",
    entity: "For this concept, explain what a solo operator can realistically do about it. Flag if it requires resources they likely don't have. Suggest scrappy alternatives.",
    edge: "Explain this relationship's practical impact on execution. Highlight if this dependency is a bottleneck a solo operator should worry about.",
    insight: "Frame this finding in terms of immediate solo execution: what to do today, what to defer, what to delegate or automate.",
  },
  founding_team: {
    space: "Emphasize team alignment implications and decision-making velocity. Flag areas where team disagreement could stall progress.",
    entity: "Explain who on the team should own this. Highlight coordination costs and handoff risks.",
    edge: "Explain how this relationship affects team dynamics — does it create a dependency between roles? A communication bottleneck?",
    insight: "Frame findings in terms of team strategy: who owns what, where to parallelize, where to synchronize.",
  },
  investor: {
    space: "Emphasize market dynamics, defensibility, and risk-adjusted returns. Flag deal-breakers vs. acceptable risks.",
    entity: "Explain this factor's impact on investment thesis viability. Quantify where possible — TAM impact, competitive moat contribution, failure probability.",
    edge: "Explain how this relationship affects the investment case — does it strengthen or weaken the thesis? What's the downside exposure?",
    insight: "Frame in terms of investment decision: is this a go/no-go signal, a condition to negotiate, or a monitoring metric?",
  },
  advisor: {
    space: "Emphasize strategic leverage and second-order effects. Identify what the advisee is likely missing.",
    entity: "Explain the non-obvious implications. What would an expert notice that the advisee might not?",
    edge: "Explain the mechanism and dynamics — help the advisor articulate WHY this relationship matters in a way that educates the advisee.",
    insight: "Frame as coaching guidance: what question should the advisor ask, what reframe would shift the advisee's thinking?",
  },
  researcher: {
    space: "Emphasize mechanisms, evidence quality, and methodological rigor. Flag where the analysis is inferring vs. where it has strong evidence.",
    entity: "Provide deep mechanistic explanation. Cite what's established vs. speculative. Flag confidence levels and evidence gaps.",
    edge: "Explain the causal mechanism and evidence basis. Distinguish correlation from causation. Note confounders.",
    insight: "Frame in terms of research questions: what's confirmed, what needs investigation, what methodology would resolve the uncertainty?",
  },
  student: {
    space: "Use clear explanations and build understanding incrementally. Define technical terms. Connect to foundational concepts.",
    entity: "Explain what this is and why it matters in accessible language. Use analogies. Build from simple to complex.",
    edge: "Explain this connection clearly — what causes what and why. Use concrete examples to illustrate the mechanism.",
    insight: "Frame as a learning opportunity: what principle does this illustrate? What should the student take away?",
  },
  operator: {
    space: "Emphasize operational metrics, process efficiency, and execution risk. Flag things that need monitoring or intervention.",
    entity: "Explain the operational impact: what breaks if this fails? What KPIs does it affect? What's the SLA/SLO?",
    edge: "Explain the operational dependency — latency, failure propagation, monitoring needs. Is this automated or manual?",
    insight: "Frame as an ops action: what to monitor, what threshold triggers action, what runbook to follow.",
  },
  executive: {
    space: "Emphasize strategic positioning, resource allocation tradeoffs, and competitive dynamics. Focus on the 2-3 things that matter most.",
    entity: "Explain the strategic significance. How does this factor affect long-term positioning? What are the board-level implications?",
    edge: "Explain how this relationship affects strategic options — does it create lock-in, open new possibilities, or constrain future moves?",
    insight: "Frame as an executive decision: what needs a decision now, what can be delegated, what needs more information?",
  },
};

/** Goal-specific field emphasis at each shell level */
const GOAL_SHELL_EMPHASIS: Record<string, Partial<Record<ShellType, string>>> = {
  make_decision: {
    space: "Surface the decision-relevant tradeoffs. For each key entity, clarify which option it favors and under what conditions.",
    entity: "Explain how this factor tips the decision. Does it favor one option over another? Under what conditions does it change?",
    edge: "Explain how this relationship creates a tradeoff or dependency that constrains the decision space.",
    insight: "Frame as decision input: does this finding change which option dominates? What condition would flip the recommendation?",
  },
  understand_system: {
    space: "Map the causal chain: inputs → mechanisms → outputs. Explain feedback loops and emergent behaviors.",
    entity: "Explain the role this plays in the system's dynamics. What happens when it changes? What does it depend on?",
    edge: "Explain the mechanism: how does information/force/change propagate through this link? What's the time constant?",
    insight: "Frame as system understanding: what mechanism does this reveal? What prediction does it enable?",
  },
  build_plan: {
    space: "Sequence the work. Identify critical path, parallel tracks, and blocking dependencies.",
    entity: "Is this a deliverable, a dependency, a resource, or a milestone? What's its position in the execution sequence?",
    edge: "Is this a blocking dependency or a nice-to-have? What's the lag time? Can work proceed in parallel?",
    insight: "Frame as a planning input: does this change the critical path, add a new dependency, or de-risk a step?",
  },
  evaluate_risk: {
    space: "Map the threat surface. For each entity, assess likelihood × impact. Identify correlated risks.",
    entity: "What are the failure modes? What's the blast radius? Is this risk mitigatable, transferable, or must be accepted?",
    edge: "How does failure propagate through this link? Is it a single point of failure? What's the cascade potential?",
    insight: "Frame as risk assessment: severity, probability, mitigation options, and residual risk after mitigation.",
  },
  explore_options: {
    space: "Map the full option landscape. Surface alternatives the user may not have considered.",
    entity: "How does this factor enable or constrain different options? What new options does it suggest?",
    edge: "Does this relationship lock you into a path, or does it preserve optionality?",
    insight: "Frame as option analysis: what new paths does this open? What does it rule out? What keeps options open longest?",
  },
  validate_assumptions: {
    space: "Flag every assumption. Rate evidence strength. Identify which assumptions, if wrong, would invalidate the analysis.",
    entity: "Is this entity factual, assumed, or speculative? What evidence supports it? What would disprove it?",
    edge: "Is this relationship established or assumed? What evidence would confirm or refute it? How sensitive are conclusions to this assumption?",
    insight: "Frame as assumption validation: does this confirm or challenge a key assumption? What's the implication if wrong?",
  },
};

export function buildShellIntentBlock(
  intent?: UserIntent | null,
  focusStack?: Array<{ type: string; [key: string]: unknown }> | null,
): string {
  if (!intent?.user_role && !intent?.primary_goal) return "";

  // Determine current shell level from focus stack
  const shellType: ShellType = (() => {
    if (!focusStack || focusStack.length === 0) return "space";
    const top = focusStack[focusStack.length - 1];
    if (top.type === "entity" || top.type === "edge" || top.type === "insight") return top.type as ShellType;
    return "space";
  })();

  const depth = focusStack?.length ?? 0;

  // Build identity line
  const identityParts: string[] = [];
  if (intent.user_role) identityParts.push(formatRole(intent.user_role));
  if (intent.primary_goal) identityParts.push(`trying to ${formatGoal(intent.primary_goal)}`);
  if (intent.context_type) identityParts.push(`in a ${formatContext(intent.context_type)} context`);

  const lines: string[] = [
    `\n\n--- PERSONALIZATION (Intent × Shell Level) ---`,
    `USER: ${identityParts.join(" ")}`,
    `FOCUS DEPTH: ${depth === 0 ? "top-level (overview)" : `${depth} level(s) deep (${shellType})`}`,
  ];

  // Role emphasis for this shell level
  const roleEmphasis = intent.user_role
    ? ROLE_SHELL_EMPHASIS[intent.user_role]?.[shellType]
    : undefined;
  if (roleEmphasis) {
    lines.push(`\nROLE EMPHASIS (${intent.user_role} at ${shellType} level):`);
    lines.push(roleEmphasis);
  }

  // Goal emphasis for this shell level
  const goalEmphasis = intent.primary_goal
    ? GOAL_SHELL_EMPHASIS[intent.primary_goal]?.[shellType]
    : undefined;
  if (goalEmphasis) {
    lines.push(`\nGOAL EMPHASIS (${intent.primary_goal} at ${shellType} level):`);
    lines.push(goalEmphasis);
  }

  // Depth-adaptive detail level
  if (depth === 0) {
    lines.push(`\nDETAIL LEVEL: High-level overview. Summarize the 2-3 most important things for this user. Don't go deep — they can drill in.`);
  } else if (depth === 1) {
    lines.push(`\nDETAIL LEVEL: Focused analysis. Go deeper than overview but stay on this specific ${shellType}. Explain mechanisms and implications.`);
  } else {
    lines.push(`\nDETAIL LEVEL: Deep dive. User has drilled ${depth} levels — they want maximum detail and specificity on this exact point.`);
  }

  lines.push(`---`);

  return lines.join("\n");
}

// ── Domain-adaptive prompt blocks ──
// These switch the analytical FRAMEWORK based on what domain the input belongs to.
// Unlike intent blocks (which adjust emphasis), these change what gets extracted.

const DOMAIN_SCOPING: Record<string, string> = {
  startup: `DOMAIN LENS — STARTUP/VENTURE:
Design spaces around: product-market fit dynamics, go-to-market strategy forks, resource constraints vs. ambition, competitive moat/defensibility. Spaces should surface the startup-specific tensions: build vs. buy, speed vs. quality, growth vs. burn, current traction vs. target market.`,

  research: `DOMAIN LENS — RESEARCH/ACADEMIC:
Design spaces around: methodology validity vs. practical constraints, evidence hierarchy and confidence levels, theoretical framework vs. empirical findings, reproducibility and generalizability. Spaces should surface research-specific tensions: rigor vs. feasibility, novelty vs. incrementalism, specificity vs. generalizability.`,

  career: `DOMAIN LENS — CAREER/PROFESSIONAL:
Design spaces around: skill-market fit, opportunity cost of current path, network leverage, positioning relative to career trajectory. Spaces should surface career-specific tensions: specialization vs. breadth, stability vs. growth, compensation vs. learning, current role vs. aspirational role.`,

  strategy: `DOMAIN LENS — STRATEGIC PLANNING:
Design spaces around: competitive positioning, resource allocation tradeoffs, timing and sequencing of strategic moves, optionality preservation vs. commitment. Spaces should surface strategy-specific tensions: short-term vs. long-term, offensive vs. defensive, concentrate vs. diversify.`,

  operations: `DOMAIN LENS — OPERATIONS/EXECUTION:
Design spaces around: process bottlenecks, capacity constraints, quality vs. throughput, automation candidates. Spaces should surface ops-specific tensions: reliability vs. speed, standardization vs. flexibility, cost reduction vs. capability building.`,

  investment: `DOMAIN LENS — INVESTMENT/EVALUATION:
Design spaces around: thesis validation, risk-adjusted return assessment, deal structure considerations, portfolio fit. Spaces should surface investment-specific tensions: upside potential vs. downside protection, conviction vs. diversification, timing vs. valuation.`,

  education: `DOMAIN LENS — EDUCATION/LEARNING:
Design spaces around: learning objectives vs. current knowledge gaps, pedagogical approach, motivation and engagement mechanics, assessment and feedback loops. Spaces should surface education-specific tensions: depth vs. breadth, theory vs. practice, structured vs. exploratory, individual vs. collaborative.`,
};

const DOMAIN_DECOMP: Record<string, string> = {
  startup: `DOMAIN-SPECIFIC EXTRACTION — STARTUP:
ENTITY PRIORITIES: Extract business model components (revenue model, unit economics, CAC/LTV), market entities (TAM segment, ICP, competitors by name), product entities (core feature, differentiator, technical moat), resource constraints (runway, team size, key hires needed), traction metrics (current users, growth rate, retention).
EDGE PRIORITIES: Causal edges between product → traction → funding loops. Temporal edges for runway-constrained sequencing. Functional edges between team capabilities and execution requirements.
FLAG: Any entity that represents a "chicken-and-egg" problem (needs X to get Y, needs Y to get X). These become cycle candidates.`,

  research: `DOMAIN-SPECIFIC EXTRACTION — RESEARCH:
ENTITY PRIORITIES: Extract variables (independent, dependent, confounding, controlled), methodology components (study design, sample, measurement instruments), evidence entities (data sources, statistical findings, effect sizes), theoretical constructs (frameworks, models, hypotheses), limitations and boundary conditions.
EDGE PRIORITIES: Epistemic edges (supports, contradicts, is evidence for). Logical edges (implies, depends on, assumes). Causal edges with explicit confidence levels. Comparative edges between competing explanations.
FLAG: Any entity tagged [ASSUMED] that the research conclusions depend on. These are critical for validity assessment.`,

  career: `DOMAIN-SPECIFIC EXTRACTION — CAREER:
ENTITY PRIORITIES: Extract skills (current vs. required), opportunities (roles, companies, industries), network nodes (mentors, sponsors, communities), positioning factors (brand, reputation, credentials), constraints (location, compensation needs, family, timeline).
EDGE PRIORITIES: Temporal edges for career sequencing (A enables B after N months). Comparative edges between options. Functional edges between skills and opportunities. Causal edges between positioning and access.
FLAG: Any entity that represents optionality (keeps multiple paths open) vs. commitment (closes off alternatives).`,

  strategy: `DOMAIN-SPECIFIC EXTRACTION — STRATEGY:
ENTITY PRIORITIES: Extract competitive forces (rivals, substitutes, barriers), resources (capabilities, assets, relationships), strategic options (possible moves, partnerships, pivots), timing factors (windows of opportunity, competitor moves, market shifts), metrics (KPIs, milestones, decision triggers).
EDGE PRIORITIES: Causal edges for strategic cause-and-effect. Temporal edges for move sequencing. Comparative edges between strategic options. Agentive edges for competitive dynamics (their move triggers our response).
FLAG: Any entity that represents irreversible commitment or point-of-no-return.`,

  operations: `DOMAIN-SPECIFIC EXTRACTION — OPERATIONS:
ENTITY PRIORITIES: Extract processes (workflows, handoffs, bottlenecks), resources (capacity, tooling, headcount), metrics (throughput, quality, latency, cost), dependencies (upstream/downstream, external vendors, SLAs), failure modes (single points of failure, cascade triggers).
EDGE PRIORITIES: Functional edges for process flows. Temporal edges for sequencing and latency. Causal edges for failure propagation. Structural edges for system architecture dependencies.
FLAG: Any entity where failure_consequence = catastrophic AND actionability = observable_only (monitoring-only risks).`,

  investment: `DOMAIN-SPECIFIC EXTRACTION — INVESTMENT:
ENTITY PRIORITIES: Extract thesis components (market opportunity, competitive advantage, team quality, timing), risk factors (market risk, execution risk, technology risk, regulatory risk), financial metrics (valuation, projected returns, comparable deals), deal structure elements (terms, governance, milestones).
EDGE PRIORITIES: Causal edges for thesis validation logic (if A is true, then B holds). Correlational edges for risk co-movement. Comparative edges with comparable investments. Temporal edges for value creation sequencing.
FLAG: Any entity that, if wrong, would invalidate the investment thesis entirely (thesis-critical assumptions).`,

  education: `DOMAIN-SPECIFIC EXTRACTION — EDUCATION:
ENTITY PRIORITIES: Extract learning objectives (knowledge, skills, dispositions), knowledge components (concepts, procedures, mental models), pedagogical elements (activities, assessments, feedback mechanisms), learner factors (prerequisites, motivation, constraints), outcomes (competencies, credentials, capabilities).
EDGE PRIORITIES: Structural edges for prerequisite chains. Causal edges for learning mechanism (activity → understanding). Temporal edges for curriculum sequencing. Epistemic edges for knowledge dependencies (must understand X before Y).
FLAG: Any entity that represents a common misconception or learning barrier.`,
};

/** Domain-specific space design guidance for the scope route */
export function buildDomainScopingBlock(contextType?: string | null): string {
  if (!contextType || !DOMAIN_SCOPING[contextType]) return "";
  return `\n\n${DOMAIN_SCOPING[contextType]}`;
}

/** Domain-specific entity/edge extraction guidance for the decompose route */
export function buildDomainDecompBlock(contextType?: string | null): string {
  if (!contextType || !DOMAIN_DECOMP[contextType]) return "";
  return `\n\n${DOMAIN_DECOMP[contextType]}`;
}

// ── Goal-aware synthesis block ──

export function buildGoalBlock(goal?: ImprovementGoal | null): string {
  if (!goal) return "";

  const gap = Number(goal.target_value) - Number(goal.current_value);
  const deadlineStr = goal.deadline
    ? `\nDEADLINE: ${new Date(goal.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "";

  return `

--- IMPROVEMENT GOAL ---
The user has set a measurable improvement goal. ALL findings should be evaluated through the lens of advancing this goal.

GOAL: ${goal.title}${goal.description ? `\nDESCRIPTION: ${goal.description}` : ""}
METRIC: ${goal.metric_name}${goal.metric_unit ? ` (${goal.metric_unit})` : ""}
CURRENT VALUE: ${goal.current_value} → TARGET: ${goal.target_value} (gap: ${gap}${goal.metric_unit ? ` ${goal.metric_unit}` : ""})${deadlineStr}

GOAL-CONDITIONING INSTRUCTIONS:
- Leverage points: prioritize those with the most direct causal path to moving "${goal.metric_name}" from ${goal.current_value} to ${goal.target_value}
- Risk points: prioritize risks that could BLOCK progress toward the target or cause regression
- Action plans: sequence actions by expected impact on the goal metric, not just general importance
- Feedback loops: highlight loops that accelerate or decelerate progress toward the target
- Open questions: surface unknowns that, if answered, would change the strategy for reaching the target

Additionally, include a "goal_trajectory_estimate" field in your JSON output:
{
  "goal_trajectory_estimate": {
    "estimated_weeks": number,
    "confidence": "high" | "moderate" | "low",
    "critical_path": ["string — key milestone or blocker on the path to the target"]
  }
}
---`;
}

// ── Role-adaptive action path templates (Gap 4) ──

export interface ActionPathGuidance {
  labels: string[];
  badges: string[];
  instruction: string;
}

const ROLE_PATH_TEMPLATES: Record<string, Record<string, ActionPathGuidance>> = {
  solo_founder: {
    startup: {
      labels: ["Validate today", "Build this week", "Launch this month", "Scale after traction"],
      badges: ["!", "7", "30", "++"],
      instruction: "Sequence for a solo founder: validate assumptions before building, build before launching, don't scale until traction. Actions must be achievable by ONE person.",
    },
    _default: {
      labels: ["Do today", "Build this week", "Ship this month", "Grow after validation"],
      badges: ["!", "7", "30", "✓"],
      instruction: "Sequence for a solo operator: prioritize what you can do alone today, build incrementally, ship before perfecting, grow only after validation.",
    },
  },
  investor: {
    investment: {
      labels: ["Due diligence now", "Conditions for investment", "Post-investment monitoring", "Exit triggers"],
      badges: ["DD", "IF", "PM", "EX"],
      instruction: "Sequence for an investor: investigate before committing, define conditions, set monitoring triggers, plan exit criteria. Actions are evaluation and governance tasks, not execution tasks.",
    },
    _default: {
      labels: ["Investigate now", "Decision criteria", "Monitor after decision", "Revisit triggers"],
      badges: ["DD", "DC", "MT", "RV"],
      instruction: "Sequence for an evaluator: gather information, define decision criteria, set monitoring metrics, plan revisit triggers.",
    },
  },
  student: {
    education: {
      labels: ["Study today", "Practice this week", "Test readiness", "Exam preparation"],
      badges: ["RD", "PR", "TS", "EX"],
      instruction: "Sequence for a student: understand core concepts first, practice application, test yourself, then prepare for formal assessment. Actions should build understanding incrementally.",
    },
    _default: {
      labels: ["Learn today", "Practice this week", "Apply this month", "Master over time"],
      badges: ["RD", "PR", "AP", "MS"],
      instruction: "Sequence for a learner: grasp fundamentals, practice with examples, apply to real problems, build mastery through repetition.",
    },
  },
  researcher: {
    research: {
      labels: ["Hypothesis test", "Data collection", "Analysis phase", "Publication readiness"],
      badges: ["HT", "DC", "AN", "PB"],
      instruction: "Sequence for a researcher: formulate testable hypotheses, design data collection, run analysis, prepare findings for review. Actions should be methodologically sound.",
    },
    _default: {
      labels: ["Investigate now", "Gather evidence", "Analyze findings", "Draw conclusions"],
      badges: ["HT", "DC", "AN", "FN"],
      instruction: "Sequence for investigation: start with the most uncertain questions, gather evidence systematically, analyze before concluding.",
    },
  },
  operator: {
    operations: {
      labels: ["Quick win today", "Process change this week", "Team rollout this month", "Measurement cycle"],
      badges: ["QW", "PC", "TR", "MC"],
      instruction: "Sequence for an operator: capture quick wins to build momentum, redesign the process, roll out to the team, measure and iterate. Actions must be operationally concrete.",
    },
    _default: {
      labels: ["Fix today", "Improve this week", "Standardize this month", "Optimize ongoing"],
      badges: ["FX", "IM", "ST", "OP"],
      instruction: "Sequence for execution: fix urgent issues, improve processes, standardize what works, continuously optimize.",
    },
  },
  executive: {
    strategy: {
      labels: ["Signal to watch", "Decision to make", "Resource to allocate", "Milestone to hit"],
      badges: ["SG", "DC", "RA", "MS"],
      instruction: "Sequence for an executive: identify leading indicators, frame the key decisions, allocate resources, set success milestones. Actions are strategic, not tactical — delegate execution details.",
    },
    _default: {
      labels: ["Assess now", "Decide this week", "Allocate this month", "Review next quarter"],
      badges: ["SG", "DC", "RA", "RV"],
      instruction: "Sequence for a decision-maker: assess the situation, make the key call, allocate resources accordingly, review outcomes.",
    },
  },
  founding_team: {
    startup: {
      labels: ["Align the team today", "Divide and execute this week", "Integrate this month", "Review and pivot"],
      badges: ["AL", "EX", "IN", "RV"],
      instruction: "Sequence for a founding team: get alignment on priorities, divide work across founders, integrate results, review progress and adjust. Flag coordination risks.",
    },
    _default: {
      labels: ["Align today", "Execute this week", "Integrate this month", "Review cycle"],
      badges: ["AL", "EX", "IN", "RV"],
      instruction: "Sequence for a team: align on priorities, execute in parallel, integrate, review. Highlight where coordination overhead matters.",
    },
  },
  advisor: {
    _default: {
      labels: ["Observe and diagnose", "Recommend this week", "Guide implementation", "Measure impact"],
      badges: ["DX", "RC", "GD", "MI"],
      instruction: "Sequence for an advisor: diagnose the root cause, provide actionable recommendations, support implementation, measure whether guidance worked.",
    },
  },
};

/**
 * Get role-adaptive action path template.
 * Returns timeframe labels and instructions tailored to the user's role and context.
 * When a goal with deadline exists, overrides labels with goal-relative periods.
 */
export function getActionPathTemplate(
  role: string | null,
  goal: ImprovementGoal | null,
  contextType: string | null,
): ActionPathGuidance {
  // Default fallback
  const defaultGuidance: ActionPathGuidance = {
    labels: ["Today", "This week", "This month", "After validation"],
    badges: ["!", "7", "30", "✓"],
    instruction: "Sequence actions by compounding leverage: threshold-clearing first, then loop-starting, then acceleration, then linear improvements.",
  };

  // Look up role-specific template
  let guidance = defaultGuidance;
  if (role && ROLE_PATH_TEMPLATES[role]) {
    const roleTemplates = ROLE_PATH_TEMPLATES[role];
    guidance = (contextType && roleTemplates[contextType]) || roleTemplates._default || defaultGuidance;
  }

  // Goal deadline override — replace generic timeframes with goal-relative periods
  if (goal?.deadline) {
    const now = new Date();
    const deadline = new Date(goal.deadline);
    const msUntil = deadline.getTime() - now.getTime();
    const weeksUntil = msUntil / (7 * 24 * 60 * 60 * 1000);
    const deadlineStr = deadline.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    if (weeksUntil < 2) {
      guidance = {
        ...guidance,
        labels: ["Today", "Tomorrow", "This week", `Before ${deadlineStr}`],
        badges: ["!", "→", "7", "DL"],
      };
    } else if (weeksUntil < 12) {
      guidance = {
        ...guidance,
        labels: ["This week", "This month", "Next month", `Before ${deadlineStr}`],
        badges: ["7", "30", "60", "DL"],
      };
    } else {
      guidance = {
        ...guidance,
        labels: ["This quarter", "Next quarter", "H2", `Before ${deadlineStr}`],
        badges: ["Q", "Q+1", "H2", "DL"],
      };
    }
  }

  return guidance;
}

// Re-export labels for UI use
export const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "solo_founder", label: "Solo Founder" },
  { value: "founding_team", label: "Founding Team" },
  { value: "investor", label: "Investor / Evaluator" },
  { value: "advisor", label: "Advisor" },
  { value: "researcher", label: "Researcher" },
  { value: "student", label: "Student" },
  { value: "operator", label: "Operator" },
  { value: "executive", label: "Executive" },
];

export const GOAL_OPTIONS: { value: string; label: string }[] = [
  { value: "make_decision", label: "Make a Decision" },
  { value: "understand_system", label: "Understand a System" },
  { value: "build_plan", label: "Build a Plan" },
  { value: "evaluate_risk", label: "Evaluate Risk" },
  { value: "explore_options", label: "Explore Options" },
  { value: "validate_assumptions", label: "Validate Assumptions" },
];

export const CONTEXT_OPTIONS: { value: string; label: string }[] = [
  { value: "startup", label: "Startup" },
  { value: "research", label: "Research" },
  { value: "career", label: "Career" },
  { value: "strategy", label: "Strategy" },
  { value: "operations", label: "Operations" },
  { value: "investment", label: "Investment" },
  { value: "education", label: "Education" },
];

// ── Guardrail-answers injection ────────────────────────────────────
// Re-exports buildGuardrailBlock so callers can interpolate it into
// any prompt the same way they already interpolate buildIntentBlock /
// buildGoalBlock. The pattern every prompt-builder should follow:
//
//   const intent = buildSynthesisIntentBlock(intent);
//   const goal   = buildGoalBlock(goal);
//   const guard  = buildGuardrailBlock(space.guardrail_answers);
//   const prompt = `${BASE_PROMPT}\n${intent}\n${goal}\n${guard}\n...`;
//
// Guardrail block goes LAST so its constraints override any softer
// language earlier in the prompt — the LLM sees the user's hard
// constraints right before the task.

export { buildGuardrailBlock } from "./guardrail-questions";
export type { GuardrailAnswer } from "./guardrail-questions";
