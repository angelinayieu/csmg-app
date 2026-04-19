export type { Database, Json } from "./database.types";

// Convenience aliases for row types
import type { Database } from "./database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Space = Database["public"]["Tables"]["spaces"]["Row"];
export type Entity = Database["public"]["Tables"]["entities"]["Row"];
export type Edge = Database["public"]["Tables"]["edges"]["Row"];
export type Cycle = Database["public"]["Tables"]["cycles"]["Row"];
export type Bridge = Database["public"]["Tables"]["bridges"]["Row"];
export type ReasoningResult =
  Database["public"]["Tables"]["reasoning_results"]["Row"];
export type Proposition = Database["public"]["Tables"]["propositions"]["Row"];
export type NovelConnection =
  Database["public"]["Tables"]["novel_connections"]["Row"];
export type Contradiction =
  Database["public"]["Tables"]["contradictions"]["Row"];
export type Scenario = Database["public"]["Tables"]["scenarios"]["Row"];
export type ActionItem = Database["public"]["Tables"]["action_items"]["Row"];
export type SpaceChangelog =
  Database["public"]["Tables"]["space_changelog"]["Row"];

// Claims table (added in 20260412_deep_research_evidence.sql)
// Not auto-generated in database.types.ts, defined manually:
export interface Claim {
  id: string;
  space_id: string;
  claim_text: string;
  claim_type: "mechanism" | "assertion" | "prediction" | "assumption" | "finding";
  status: "proposed" | "supported" | "contested" | "refuted";
  confidence: number;
  source_entity_id: string | null;
  source_edge_id: string | null;
  source_type: "deep_research" | "fast_research" | "synthesis" | "manual";
  /**
   * Verbatim/near-verbatim quote from the user's input that supports this claim,
   * OR "IMPLICIT: <1-line reason>" / "ASSUMED: <1-line reason>" for inferred entities.
   * NULL for legacy data or when the LLM failed to provide one.
   */
  source_quote: string | null;
  created_at: string;
  updated_at: string;
}

export type AnalysisJob = Database["public"]["Tables"]["analysis_jobs"]["Row"];
export type JobEvent = Database["public"]["Tables"]["job_events"]["Row"];
export type AnalysisAgent = Database["public"]["Tables"]["agents"]["Row"];
export type AgentRun = Database["public"]["Tables"]["agent_runs"]["Row"];
export type AgentKind = AnalysisAgent["kind"];
export type AgentStatus = AnalysisAgent["status"];
export type AgentRunStatus = AgentRun["status"];

// Sprint 0 — universal canvas substrate
// Tables not yet in database.types.ts; manual types live in the files below.
// Re-run Supabase codegen after Sprint 0 deploys to replace with Row types.
export type {
  Canvas,
  CanvasScope,
  CanvasScopeRefType,
  CanvasCardData,
  CreateCanvasInput,
  UpdateCanvasInput,
} from "./canvas-library";
export type {
  NoteEntitySpan,
  SpanStatus,
  SpanSource,
  CreateSpanInput,
} from "./note-span";
export type {
  ConceptProposal,
  ProposalStatus,
  ProposalSource,
  ProposalGroup,
  CreateProposalInput,
  ResolveProposalInput,
} from "./proposal";
export type {
  MemoryItem,
  MemoryKind,
  MemoryQuery,
  MemoryHit,
} from "./memory";
export type {
  BridgeOrigin,
  BridgeStatus,
  BridgeSprint0Additions,
  CreateManualBridgeInput,
  ResolveBridgeInput,
} from "./bridge-extended";
export type {
  CanvasFrame,
  CreateFrameInput,
  UpdateFrameInput,
  HydratedFrame,
  FrameBridge,
  FramesResponse,
} from "./canvas-frame";
