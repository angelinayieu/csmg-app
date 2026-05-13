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
  | "describe";

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

export interface ClarifyResult {
  // 3-4 questions the AI thinks are most worth asking the user to
  // tighten before drafting a plan. Each carries an optional hint
  // explaining why the question matters.
  questions: Array<{ question: string; hint: string }>;
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
  | { mode: "describe"; result: AugmentResult };

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

export interface PlanStepMeta {
  title?: string;
  // AI-op-produced sub-steps via /expand
  sub_steps?: SubStep[];
  // AI-op-produced adversarial weaknesses via /challenge
  challenges?: ChallengeItem[];
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
