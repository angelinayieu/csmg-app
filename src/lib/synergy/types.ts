// ── Synergy whiteboard shared types ──
//
// Mirrors the `brainstorm_*` tables and the AI augmentation responses.
// Kept in one file so client + server can import without duplication.

export type NodeKind =
  | "core"
  | "branch"
  | "insight"
  | "question"
  | "action"
  | "user"
  | "variation"
  | "ranking"
  | "plan"
  // Synergy synthesize output — a polyhierarchy child of two source
  // cards capturing what they create together. Distinct from "insight"
  // because it represents a derived combination, not a fresh observation.
  | "synergy";

export interface BrainstormSession {
  id: string;
  owner_id: string;
  title: string;
  objective_statement: string | null;
  objective_constraints: string[];
  objective_success_criteria: string[];
  objective_detected_at: string | null;
  state: "drafting" | "processed" | "published" | "archived";
  created_at: string;
  updated_at: string;
}

export interface BrainstormNode {
  id: string;
  session_id: string;
  parent_id: string | null;
  kind: NodeKind;
  label: string;
  meta: string | null;
  x: number;
  y: number;
  created_at: string;
}

export interface BrainstormStroke {
  id: string;
  session_id: string;
  points: Array<[number, number]>;
  color: string;
  created_at: string;
}

// Client-side node representation: slimmer, no session_id, parent
// rather than parent_id, meta optional. This is what synergy-whiteboard
// holds in state and converts to/from BrainstormNode on save/load.
export interface ClientNode {
  id: string;
  x: number;
  y: number;
  label: string;
  kind: NodeKind;
  /**
   * Primary parent — drives the standard tree-edge render + radial
   * layout. Stable single source of truth for "where in the hierarchy
   * does this node live?"
   */
  parent?: string | null;
  /**
   * Synergy-synthesize introduces polyhierarchy: a "synergy" node has
   * two source cards as logical parents. `parent` keeps the primary
   * (for layout); `parents` carries the full lineage. The secondary
   * parents render as curved amber edges (same visual lexicon as
   * lateral edges) — primary stays a straight dashed tree edge.
   *
   * For non-synergy nodes this is omitted. V1 in-memory only; the
   * brainstorm_nodes table only has a single parent_id column.
   */
  parents?: string[];
  meta?: string;
}

export interface ClientStroke {
  id: string;
  points: Array<[number, number]>;
  color: string;
}

/**
 * Lateral (non-tree) edge between two nodes — drawn by the user via
 * the Connect tool. Distinct from parent-child edges (which are
 * implicit from `node.parent`) because lateral edges encode "these
 * two relate" without nesting one under the other.
 *
 * V1 has only one kind ("lateral"). Typed sub-kinds (reinforces /
 * conflicts / depends_on / synthesizes_with) come once we see what
 * users actually want to say with their connections.
 *
 * V1 is in-memory only — not persisted. Page reload loses lateral
 * edges. Persistence schema lands once the UX is validated.
 */
export interface ClientLateralEdge {
  id: string;
  from: string; // ClientNode.id
  to: string;   // ClientNode.id
}

// ── AI augmentation mode responses ──
//
// One union for the result of POST /api/synergy/augment. The mode
// determines the result shape; consumers narrow based on `mode`.

export type AugmentMode =
  | "augment"
  | "decompose"
  | "questions"
  | "research"
  | "variations"
  | "rank"
  | "clarify"
  | "plan"
  // Synergy synthesize: given two source cards, emit a single new
  // idea that captures what they create together. The new node is
  // wired as a polyhierarchy child of BOTH source cards.
  | "synthesize"
  // Describe: free-form user instruction scoped to one card. The
  // popover's "Or describe what you want…" field. Backed by the
  // AUGMENT_SCHEMA shape — emits 1-6 new child nodes that fulfill
  // the user's prompt against the card's rich context.
  | "describe"
  // ── Brainstorm-speedrun convergence (Wave 2) ──
  // Reads the seed + ALL its descendants (variations, branches,
  // research notes, ranking summaries) and clusters them into 2-3
  // MVP candidates with effort / impact / novelty scores, one of
  // which is "recommended" (the build-this-next pick). Used as the
  // final wave of the autopilot speedrun sequence — turns "we
  // expanded a fan of ideas" into "here's the smallest valuable
  // thing to build."
  | "converge";

export interface AugmentResult {
  nodes: Array<{
    id: string;
    label: string;
    kind: NodeKind;
    parent: string | null;
  }>;
  summary: string;
}

export interface DecomposeResult {
  upstream: string[];
  downstream: string[];
  first_principles: string[];
  variations: string[];
}

export interface QuestionsResult {
  questions: string[];
}

export interface SynthesizeResult {
  /** 4-10 word label for the new synergy card. */
  label: string;
  /** 1-3 sentence explanation of what the two sources create together. */
  why: string;
}

export interface ResearchDirection {
  angle: "validate" | "refute" | "extend" | "alternative";
  prompt: string;
  why: string;
}

export interface ResearchResult {
  directions: ResearchDirection[];
}

export interface VariationItem {
  label: string;
  rationale: string;
}

export interface VariationsResult {
  variations: VariationItem[];
}

export interface RankedItem {
  label: string;
  score: number;
  reason: string;
}

export interface RankResult {
  ranked: RankedItem[];
}

// ── 1.6d: Idea → Actionable Plan ──

export interface ClarifyOption {
  /** The option label rendered as a clickable card. 3-10 words. */
  label: string;
  /** Optional 1-sentence elaboration shown beneath the label on
   *  hover/focus. Helps the user pick without re-reading the question. */
  detail?: string;
}

export interface ClarifyQuestion {
  question: string;
  hint: string;
  /** 3-5 MCQ options the LLM proposes. The UI always appends an
   *  implicit "Other / custom" slot that reveals a textarea so the
   *  user is never forced into a preset answer. */
  options: ClarifyOption[];
}

export interface ClarifyResult {
  // 3-4 questions the AI thinks are most worth asking the user to
  // tighten before drafting a plan. Each carries a hint explaining why
  // the question matters AND 3-5 MCQ options to make the answer quick
  // — picking is faster than typing.
  questions: ClarifyQuestion[];
}

export interface PlanStep {
  label: string;
  rationale: string;
}

export interface PlanRisk {
  risk: string;
  mitigation: string;
}

export interface PlanResult {
  goal: string;
  steps: PlanStep[];
  resources: string[];
  success_criteria: string[];
  risks: PlanRisk[];
}

// ── Convergence cluster (Wave 2) ──
//
// One MVP-candidate cluster produced by the converge augment mode.
// The LLM groups descendants of the seed into 2-3 of these. The
// `recommended` field is true for at most one cluster — the build-
// this-next pick. The remaining clusters become deferred branches
// the user can come back to.
export type ConvergeEffort = "light" | "medium" | "heavy";

export interface ConvergeCluster {
  /** Human-readable name for the cluster, 3-6 words. e.g.
   *  "Working-memory loadout app". */
  name: string;
  /** 1-2 sentence pitch describing what this MVP would actually be. */
  pitch: string;
  /** brainstorm_nodes.id values of nodes this cluster groups
   *  together. The IDs come from the input context — the LLM
   *  echoes back the ones it considered for this cluster. */
  member_node_ids: string[];
  /** Build effort estimate. */
  effort: ConvergeEffort;
  /** Expected impact on the user's stated goal. 1 = marginal,
   *  10 = transformative. */
  impact: number;
  /** Novelty / surprise. 1 = obvious, 10 = genuinely new angle. */
  novelty: number;
  /** What's left OUT to keep scope tight ("we're deferring X
   *  because the MVP works without it"). 1-2 sentences. */
  scope_cut: string;
  /** Exactly one cluster has recommended=true. The build-this-next
   *  pick. The autopilot UI spotlights it post-convergence. */
  recommended: boolean;
}

export interface ConvergeResult {
  /** 2-3 candidate clusters. Exactly one has recommended=true. */
  clusters: ConvergeCluster[];
  /** 1-sentence rationale for which cluster the LLM recommended. */
  recommendation_rationale: string;
}

export type AugmentResponse =
  | { mode: "augment"; result: AugmentResult }
  | { mode: "decompose"; result: DecomposeResult }
  | { mode: "questions"; result: QuestionsResult }
  | { mode: "research"; result: ResearchResult }
  | { mode: "variations"; result: VariationsResult }
  | { mode: "rank"; result: RankResult }
  | { mode: "clarify"; result: ClarifyResult }
  | { mode: "plan"; result: PlanResult }
  | { mode: "synthesize"; result: SynthesizeResult }
  // Describe reuses AugmentResult — same shape (nodes[] + summary)
  // but the system prompt routes through DESCRIBE_SYSTEM to honor
  // the user's free-form instruction.
  | { mode: "describe"; result: AugmentResult }
  // Wave 2 — convergence into MVP-candidate clusters.
  | { mode: "converge"; result: ConvergeResult };

// ── History buckets (right rail dedup) ──
//
// When the user adds an AI-suggested item to the board, we mark it
// "picked" so the bucket filters it out — but the History card still
// retains it for one-click re-adding. Buckets are also used by
// addToHistory to dedupe within the same bucket.

export type HistoryBucket =
  | "upstream"
  | "downstream"
  | "first_principles"
  | "variations"
  | "question"
  | "research";

export interface HistoryItem {
  id: string;
  bucket: HistoryBucket;
  text: string;
  kind: NodeKind;
  meta?: string;
  picked: boolean;
  generatedAt: number;
}

// ── Phase 3 — processing page types ──

export type ComponentKind =
  | "core_idea"
  | "upstream"
  | "downstream"
  | "polished_product";
export type ComponentVisibility = "private" | "matchable_only" | "public";

export interface BrainstormComponent {
  id: string;
  kind: ComponentKind;
  subkind: string | null;
  label_public: string;
  description_public: string;
  description_private: string;
  visibility: ComponentVisibility;
  created_at: string;
  // Populated by GET /api/synergy/sessions/[id]/components. Counts
  // how many component_matches rows reference this component on
  // either side. Drives the "N collaborators · room-ready" badge
  // on the redesigned expandable card. May be undefined on cached
  // payloads pre-augmentation; treat as 0 in that case.
  match_count?: number;
}

export interface DetectedObjective {
  statement: string;
  constraints: string[];
  success_criteria: string[];
}

export interface PromiseScore {
  node_id: string;
  score: number;
  why: string;
  child_count: number;
  label: string;
  kind: NodeKind;
}

// ── Phase 3.5d — Strategy Doc types ──
//
// The converged artifact at the end of a brainstorm. One per session.
// Blocks render in fixed-type sections (plan_step / risk / hypothesis /
// evidence / note). Upstream + downstream sections aren't blocks — they
// reference brainstorm_components rows directly.

export type StrategyBlockType =
  | "plan_step"
  | "risk"
  | "hypothesis"
  | "evidence"
  | "note";

export interface SynergyStrategy {
  id: string;
  session_id: string;
  statement: string | null;
  pitch: string | null;
  status: "draft" | "published" | "archived";
  current_generation_id: string | null;
  created_at: string;
  updated_at: string;
}

// Block-type-specific structured fields live in `meta`. The unions below
// are non-exhaustive and not strictly enforced — they're hints for the
// renderer. The DB column is jsonb and additive.

export interface ChallengeItem {
  weakness: string;
  severity: "high" | "medium" | "low";
  suggestion: string;
}

export interface SubStep {
  title: string;
  detail: string;
}

export interface MitigationTactic {
  tactic: string;
  kind: "prevent" | "detect" | "respond";
}

// ── Phase 1: LLM-tagged plan-step categories ──
//
// Authored by the strategy-gen LLM at generation time so the UI can
// render activity glyphs + duration/effort pills + dependency arrows
// without falling back to client-side regex heuristics. The category
// list maps 1:1 to icons in src/lib/synergy/step-icons.ts.
export type PlanStepCategory =
  | "schedule"
  | "research"
  | "collaborate"
  | "build"
  | "publish"
  | "iterate"
  | "learn"
  | "other";

export type PlanStepEffort = "light" | "medium" | "heavy";

export type PlanStepStatus = "pending" | "in_progress" | "done";

export interface PlanStepMeta {
  title?: string;

  // ── Phase 1 LLM-tagged fields ──
  // All optional on the TYPE for backward compat with strategies
  // generated before the schema upgrade. The LLM schema marks them
  // required so new generations always include them.
  category?: PlanStepCategory;
  duration_estimate?: string; // "30 min/day", "2 weeks total", "ongoing"
  effort_level?: PlanStepEffort;
  /** Single concrete action the user can take in the next hour. */
  first_action?: string;
  /** 0-based indices of plan steps that must be completed first. */
  depends_on?: number[];
  /** Observable evidence this step is complete. Checkable in 30s. */
  success_signal?: string;

  // ── Phase 2 user-authored state (added separately) ──
  status?: PlanStepStatus;

  // ── Existing AI-op-produced fields ──
  sub_steps?: SubStep[]; // produced by /expand
  challenges?: ChallengeItem[]; // produced by /challenge
  evidence_urls?: string[];
}
export interface RiskMeta {
  title?: string;
  severity?: "high" | "medium" | "low";
  mitigation?: string;
  // AI-op-produced additional mitigations via /mitigate
  additional_mitigations?: MitigationTactic[];
}
export interface HypothesisMeta {
  rationale?: string;
  evidence_status?: "untested" | "supported" | "refuted";
  // AI-op-produced deeper rationales via /expand
  supporting_rationales?: string[];
  // AI-op-produced adversarial weaknesses via /challenge
  challenges?: ChallengeItem[];
  supporting_urls?: string[];
}
export interface EvidenceMeta {
  source_title?: string;
  url?: string;
  summary?: string;
  supports_block_id?: string;
}
export type StrategyBlockMeta =
  | PlanStepMeta
  | RiskMeta
  | HypothesisMeta
  | EvidenceMeta
  | Record<string, unknown>;

export interface SynergyStrategyBlock {
  id: string;
  block_type: StrategyBlockType;
  body: string;
  sort_order: number;
  meta: StrategyBlockMeta;
  created_at: string;
}

export interface StrategyBundle {
  strategy: SynergyStrategy | null;
  blocks: SynergyStrategyBlock[];
  components: BrainstormComponent[];
}

// ── Phase 5 — Parallel-Path Matching types ──
//
// A second axis of matching that pairs USERS WITH SIMILAR STRATEGIES
// (convergent goal, possibly divergent routine), not complementary
// components. The data shape here mirrors `component_matches` /
// `match_requests` / `synergy_rooms` but at the strategy granularity.

export type RoomKind = "collaboration" | "parallel_path";

export interface StrategyMatch {
  id: string;
  strategy_a: string;
  strategy_b: string;
  cosine_sim: number;
  rerank_score: number;
  shared_theme: string;
  shared_pillars: string[];
  divergence_summary: string | null;
  final_score: number;
  computed_at: string;
}

export interface ParallelPathRequest {
  id: string;
  from_user: string;
  to_user: string;
  from_strategy: string;
  to_strategy: string;
  message: string | null;
  status: "pending" | "accepted" | "declined" | "expired";
  created_at: string;
  expires_at: string;
  responded_at: string | null;
}

export interface PlanStepCheckin {
  id: string;
  room_id: string;
  user_id: string;
  step_block_id: string;
  marked_complete_at: string;
  reflection: string | null;
  updated_at: string;
}

export interface RoomDigest {
  id: string;
  room_id: string;
  week_starting: string;
  summary: string;
  user_a_completions: number;
  user_b_completions: number;
  created_at: string;
}

// Suggested-card payload — what the Rooms surface renders for each
// strategy that has at least one parallel-path candidate the user
// hasn't yet invited or been invited by.
export interface SuggestedParallelPath {
  match_id: string;
  my_strategy_id: string;
  my_strategy_statement: string | null;
  their_strategy_id: string;
  their_owner_seed: string; // for the anonymous abstract avatar
  shared_theme: string;
  shared_pillars: string[];
  final_score: number;
  their_progress_total: number; // # of plan_step blocks on their side
}
