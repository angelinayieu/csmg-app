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
  | "plan";

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
  parent?: string | null;
  meta?: string;
}

export interface ClientStroke {
  id: string;
  points: Array<[number, number]>;
  color: string;
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
  | "plan";

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
  | { mode: "plan"; result: PlanResult };

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
export interface PlanStepMeta {
  title?: string;
  sub_steps?: string[];
  evidence_urls?: string[];
}
export interface RiskMeta {
  title?: string;
  severity?: "high" | "medium" | "low";
  mitigation?: string;
}
export interface HypothesisMeta {
  rationale?: string;
  evidence_status?: "untested" | "supported" | "refuted";
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
