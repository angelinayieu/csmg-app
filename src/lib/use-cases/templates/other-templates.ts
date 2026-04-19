// ── Other use-case templates (stubs) ──
//
// Defined enough to appear in the gallery, route to the right surface, and
// frame decomposition correctly. Their question libraries + seed graphs
// are deliberately lighter than the exemplar journaling template — they
// can be fleshed out in subsequent passes without breaking the system.

import type { UseCaseTemplate } from "@/types/use-case";

// ── Startup strategy ──

export const startupStrategyTemplate: UseCaseTemplate = {
  id: "startup_strategy",
  name: "Startup Strategy",
  tagline: "Map the structural forces shaping your company",
  description:
    "Decompose your business into the systems (market, product, team, capital, regulatory) that govern it. Surface the fulcrum tension whose resolution would most move the company forward. Best for founders thinking through a pivot, fundraise, or strategic bet.",
  icon: "Rocket",
  accent_color: "#0051ff",
  accent_color_light: "#eef2ff",
  category: "professional",
  context_type: "startup",
  default_surface: "whiteboard_overview",
  default_space_name: "Strategy for {{companyName}}",
  default_description: "The systems, tensions, and decisions shaping this company.",
  seed_entities: [
    { seed_id: "S_market", name: "Market & Positioning", description: "The market you're playing in and how you're positioned vs competitors.", entity_category: "abstract", entity_type: "system", layer: "system", importance: "fundamental" },
    { seed_id: "S_product", name: "Product & Engineering", description: "What you're building, how, and at what quality.", entity_category: "process", entity_type: "system", layer: "system", importance: "fundamental" },
    { seed_id: "S_gtm", name: "Go-to-market", description: "How you find, convert, and retain customers.", entity_category: "process", entity_type: "system", layer: "system", importance: "fundamental" },
    { seed_id: "S_team", name: "Team & Org", description: "Who's on the team, roles, culture, org design.", entity_category: "concrete", entity_type: "system", layer: "system", importance: "critical" },
    { seed_id: "S_capital", name: "Capital & Runway", description: "Burn, funding, unit economics, financial health.", entity_category: "abstract", entity_type: "system", layer: "system", importance: "critical" },
  ],
  seed_edges: [
    { source_seed_id: "S_product", target_seed_id: "S_market", relationship_type: "addresses", dimension: "functional" },
    { source_seed_id: "S_gtm", target_seed_id: "S_market", relationship_type: "accesses", dimension: "functional" },
    { source_seed_id: "S_capital", target_seed_id: "S_team", relationship_type: "enables", dimension: "functional" },
    { source_seed_id: "S_capital", target_seed_id: "S_product", relationship_type: "enables", dimension: "functional" },
    { source_seed_id: "S_team", target_seed_id: "S_product", relationship_type: "produces", dimension: "causal" },
  ],
  decomposition_frame: {
    system_prefix:
      "You are analyzing strategic material for a startup. Extract tradeoffs, dependencies, and structural tensions between the company's systems. Prioritize specificity over generic business advice.",
    preferred_entity_categories: ["relational", "process", "abstract"],
    preferred_entity_types: ["tradeoff", "constraint", "mechanism", "bottleneck", "advantage"],
  },
  synthesis_frame: {
    fulcrum_definition: "The one system whose reorganization would most change the company's trajectory.",
    outcome_criterion: "A specific bet the founder can commit to this quarter.",
  },
  question_library: [
    { id: "s_constraint", kind: "opener", text: "What's the constraint you'd most want to relax — and why haven't you?" },
    { id: "s_tradeoff", kind: "tension_prober", text: "Name the most expensive tradeoff you're currently making. Is it still the right call?" },
    { id: "s_leverage", kind: "future_scope", text: "If you had one extra engineer, one extra salesperson, or one extra $50k, which would move the company most?" },
  ],
};

// ── Research project ──

export const researchProjectTemplate: UseCaseTemplate = {
  id: "research_project",
  name: "Research Project",
  tagline: "Map your hypothesis, evidence, and next experiments",
  description:
    "Decompose a research question into its theoretical framework, experimental setup, evidence chain, and publication strategy. Surface where your claims are weakest and which experiment would resolve the most uncertainty.",
  icon: "Microscope",
  accent_color: "#5856d6",
  accent_color_light: "#eef2ff",
  category: "research",
  context_type: "research",
  default_surface: "whiteboard_overview",
  default_space_name: "Research: {{question}}",
  default_description: "Hypothesis, evidence, and open questions for a research project.",
  seed_entities: [
    { seed_id: "R_question", name: "Research Question", description: "The central question being investigated.", entity_category: "epistemic", entity_type: "hypothesis", layer: "system", importance: "fundamental" },
    { seed_id: "R_framework", name: "Theoretical Framework", description: "The theories and models the work rests on.", entity_category: "abstract", entity_type: "framework", layer: "system", importance: "critical" },
    { seed_id: "R_method", name: "Methodology", description: "How the question is being investigated.", entity_category: "process", entity_type: "method", layer: "system", importance: "critical" },
    { seed_id: "R_evidence", name: "Evidence & Data", description: "What's been observed, measured, or collected.", entity_category: "epistemic", entity_type: "evidence", layer: "system", importance: "critical" },
  ],
  seed_edges: [
    { source_seed_id: "R_framework", target_seed_id: "R_question", relationship_type: "grounds", dimension: "logical" },
    { source_seed_id: "R_method", target_seed_id: "R_question", relationship_type: "addresses", dimension: "functional" },
    { source_seed_id: "R_evidence", target_seed_id: "R_question", relationship_type: "informs", dimension: "epistemic" },
  ],
  decomposition_frame: {
    system_prefix:
      "You are analyzing research material. Extract hypotheses, evidence, assumptions, mechanisms, and open questions. Mark epistemic status carefully — what's been shown vs inferred vs assumed matters more than elegance of prose.",
    preferred_entity_categories: ["epistemic", "process", "abstract"],
    preferred_entity_types: ["hypothesis", "evidence", "mechanism", "assumption", "method", "finding"],
  },
  synthesis_frame: {
    fulcrum_definition: "The single experiment or analysis that would resolve the most uncertainty about the central claim.",
    outcome_criterion: "A concrete next study with clear success/failure criteria.",
  },
  question_library: [
    { id: "r_uncertainty", kind: "opener", text: "Which of your claims is weakest — and what would strengthen it?" },
    { id: "r_alt_explanation", kind: "tension_prober", text: "What's the most plausible alternative explanation for your findings?" },
    { id: "r_gap", kind: "pattern_probe", text: "What assumption is most load-bearing for your argument — and is it tested?" },
  ],
};

// ── Career pivot ──

export const careerPivotTemplate: UseCaseTemplate = {
  id: "career_pivot",
  name: "Career Pivot",
  tagline: "Decompose the jump from where you are to where you want to be",
  description:
    "Map current role vs desired role, the skill gap between them, the optionality you preserve or foreclose with each move, and the real constraints (financial runway, identity fit, family commitments). Synthesis identifies the load-bearing risk in your plan.",
  icon: "TrendingUp",
  accent_color: "#16a34a",
  accent_color_light: "#ecfdf5",
  category: "personal",
  context_type: "career",
  default_surface: "whiteboard_overview",
  default_space_name: "Pivot: {{fromRole}} → {{toRole}}",
  default_description: "Mapping a career transition.",
  seed_entities: [
    { seed_id: "C_current", name: "Current Role", description: "What you do now — the actual day-to-day.", entity_category: "concrete", entity_type: "role", layer: "system", importance: "fundamental" },
    { seed_id: "C_target", name: "Target Role", description: "Where you're trying to get to.", entity_category: "concrete", entity_type: "role", layer: "system", importance: "fundamental" },
    { seed_id: "C_gap", name: "Skill Gap", description: "What you don't yet have that the target requires.", entity_category: "abstract", entity_type: "gap", layer: "domain", importance: "critical" },
    { seed_id: "C_runway", name: "Financial Runway", description: "How long you can fund a transition.", entity_category: "abstract", entity_type: "constraint", layer: "domain", importance: "critical" },
    { seed_id: "C_identity", name: "Identity Fit", description: "Whether the target role is something you can actually become, not just do.", entity_category: "epistemic", entity_type: "question", layer: "domain", importance: "critical" },
  ],
  seed_edges: [
    { source_seed_id: "C_current", target_seed_id: "C_target", relationship_type: "precedes", dimension: "temporal" },
    { source_seed_id: "C_gap", target_seed_id: "C_target", relationship_type: "constrains", dimension: "functional" },
    { source_seed_id: "C_runway", target_seed_id: "C_target", relationship_type: "constrains", dimension: "functional" },
  ],
  decomposition_frame: {
    system_prefix:
      "You are analyzing career transition material. Extract specific skill gaps, optionality tradeoffs, identity questions, and financial/temporal constraints. Be honest about what the person is actually optimizing for.",
    preferred_entity_categories: ["abstract", "relational", "epistemic"],
    preferred_entity_types: ["constraint", "gap", "skill", "tradeoff", "identity_question"],
  },
  synthesis_frame: {
    fulcrum_definition: "The single assumption in their transition plan whose failure would collapse everything else.",
    outcome_criterion: "A specific test they can run in the next 30 days to validate or invalidate that assumption cheaply.",
  },
  question_library: [
    { id: "c_why_now", kind: "opener", text: "Why now vs three years ago or three years from now?" },
    { id: "c_forced", kind: "tension_prober", text: "What are you running from vs running toward?" },
    { id: "c_smallest", kind: "future_scope", text: "What's the cheapest test that would tell you this is wrong?" },
  ],
};

// ── Reading synthesis ──

export const readingSynthesisTemplate: UseCaseTemplate = {
  id: "reading_synthesis",
  name: "Reading Notes",
  tagline: "Turn scattered reading into cross-book insight",
  description:
    "Upload notes from what you read. The system extracts claims, mechanisms, and evidence; links ideas that recur across sources; and surfaces cross-author synthesis you'd never catch reading linearly.",
  icon: "BookMarked",
  accent_color: "#0891b2",
  accent_color_light: "#ecfeff",
  category: "research",
  context_type: "education",
  default_surface: "whiteboard_overview",
  default_space_name: "My reading synthesis",
  default_description: "Cross-source insight extracted from reading notes.",
  seed_entities: [],
  seed_edges: [],
  decomposition_frame: {
    system_prefix:
      "You are analyzing notes from books, papers, or articles. Extract claims, mechanisms, evidence, and questions. Mark which source each claim came from. Prioritize finding ideas that repeat across sources — those are the canonical patterns worth keeping.",
    preferred_entity_categories: ["epistemic", "abstract", "process"],
    preferred_entity_types: ["claim", "mechanism", "evidence", "counterpoint", "author_idea"],
  },
  synthesis_frame: {
    fulcrum_definition: "The single cross-author insight that reshapes the user's understanding of the topic.",
    outcome_criterion: "A named synthesis claim the user can act on or teach.",
  },
  question_library: [
    { id: "rd_repeat", kind: "pattern_probe", text: "Which idea has shown up in more than one of your sources?" },
    { id: "rd_tension", kind: "tension_prober", text: "Which two authors disagree — and who do you think is right?" },
    { id: "rd_apply", kind: "future_scope", text: "How does this change what you'll do this month?" },
  ],
};

// ── Relationship dynamics ──

export const relationshipDynamicsTemplate: UseCaseTemplate = {
  id: "relationship_dynamics",
  name: "Relationship Dynamics",
  tagline: "Understand a specific relationship more clearly",
  description:
    "Map patterns in a specific relationship: recurring dynamics, unspoken contracts, tensions, points of growth. For the relationships that matter enough to think about clearly.",
  icon: "Users",
  accent_color: "#db2777",
  accent_color_light: "#fdf2f8",
  category: "relational",
  context_type: "strategy",
  default_surface: "journal",
  default_space_name: "My relationship with {{person}}",
  default_description: "Patterns, tensions, and growth in a specific relationship.",
  seed_entities: [
    { seed_id: "R_me", name: "Me in this relationship", description: "How you show up, what you bring, your typical responses.", entity_category: "relational", entity_type: "self_pattern", layer: "system", importance: "critical" },
    { seed_id: "R_them", name: "Them in this relationship", description: "What you observe about them, their patterns in this context.", entity_category: "relational", entity_type: "other_pattern", layer: "system", importance: "critical" },
    { seed_id: "R_dynamic", name: "The dynamic between us", description: "The pattern of interaction that emerges when we meet — often predictable.", entity_category: "relational", entity_type: "dynamic", layer: "domain", importance: "fundamental" },
  ],
  seed_edges: [
    { source_seed_id: "R_me", target_seed_id: "R_dynamic", relationship_type: "contributes_to", dimension: "causal" },
    { source_seed_id: "R_them", target_seed_id: "R_dynamic", relationship_type: "contributes_to", dimension: "causal" },
  ],
  decomposition_frame: {
    system_prefix:
      "You are analyzing material about a specific relationship. Extract interaction patterns, unspoken contracts, recurring tensions, triggers, and moments of growth. Stay specific — 'communication issues' is not specific; 'he goes quiet when I raise money topics' is.",
    preferred_entity_categories: ["relational", "process", "epistemic"],
    preferred_entity_types: ["dynamic", "trigger", "contract", "tension", "growth_moment"],
  },
  synthesis_frame: {
    fulcrum_definition: "The one dynamic that, if shifted, would change everything else about the relationship.",
    outcome_criterion: "A specific thing to try differently next time, small enough to actually do.",
  },
  question_library: [
    { id: "rl_predict", kind: "pattern_probe", text: "What pattern could you predict before your next interaction with them?" },
    { id: "rl_role", kind: "tension_prober", text: "What role do you take in this relationship that you don't take elsewhere?" },
    { id: "rl_contract", kind: "deepener", text: "What's an unspoken agreement between you two — whose idea was it?" },
  ],
};

// ── Team retro ──

export const teamRetroTemplate: UseCaseTemplate = {
  id: "team_retro",
  name: "Team Retrospective",
  tagline: "Decompose what happened and what to do differently",
  description:
    "Structure a team retro: what worked, what didn't, who owns what, and the specific process changes worth trying. Surfaces the accountability pattern most likely to break the next cycle.",
  icon: "Users2",
  accent_color: "#ea580c",
  accent_color_light: "#fff7ed",
  category: "professional",
  context_type: "operations",
  default_surface: "whiteboard_overview",
  default_space_name: "Retro: {{sprintOrProject}}",
  default_description: "Team retrospective mapping wins, misses, and changes.",
  seed_entities: [
    { seed_id: "T_what_worked", name: "What worked", description: "Things the team did well worth keeping.", entity_category: "process", entity_type: "success", layer: "system", importance: "important" },
    { seed_id: "T_what_didnt", name: "What didn't", description: "Things that broke or frustrated.", entity_category: "process", entity_type: "problem", layer: "system", importance: "critical" },
    { seed_id: "T_accountability", name: "Accountability", description: "Who owned what, and where ownership was unclear.", entity_category: "relational", entity_type: "ownership", layer: "domain", importance: "critical" },
  ],
  seed_edges: [],
  decomposition_frame: {
    system_prefix:
      "You are analyzing retrospective material for a team. Extract specific wins, specific misses, ownership patterns, and the accountability gaps underneath repeat problems. Don't reach for team-building platitudes.",
    preferred_entity_categories: ["process", "relational", "concrete"],
    preferred_entity_types: ["success", "problem", "ownership_gap", "process_change"],
  },
  synthesis_frame: {
    fulcrum_definition: "The single change in process or ownership that would have most changed the outcome.",
    outcome_criterion: "A named process change with an owner, a trigger, and a date for first use.",
  },
  question_library: [
    { id: "t_again", kind: "pattern_probe", text: "What would happen again next sprint if nothing changed?" },
    { id: "t_owner", kind: "tension_prober", text: "What went wrong because no one owned it?" },
    { id: "t_commit", kind: "future_scope", text: "What's the one change you'll commit to trying — with an owner — next cycle?" },
  ],
};
