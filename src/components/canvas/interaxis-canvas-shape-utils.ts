// SHAPE_UTILS aggregation extracted from interaxis-canvas.tsx. Adding
// a new tldraw shape util means importing the class here and dropping
// it into the array — interaxis-canvas.tsx itself no longer cares.
//
// Order matters for stack-z fallbacks but most painter shapes are
// explicitly z-ordered via meta.zIndex; the array order below is a
// historical/narrative grouping (intake → KG → app → synthesis →
// proposals → catalog) and not load-bearing.

import { KGNodeShapeUtil } from "./shapes/kg-node-shape";
import { KGFormationShapeUtil } from "./shapes/kg-formation-shape";
import { KgOverviewCardShapeUtil } from "./shapes/kg-overview-card-shape";
import { OriginPromptShapeUtil } from "./shapes/origin-prompt-shape";
import { ProbabilitySpaceShellShapeUtil } from "./shapes/probability-space-shell-shape";
import { StickyNoteShapeUtil } from "./shapes/sticky-note-shape";
import { SynthesisCardShapeUtil } from "./shapes/synthesis-card-shape";
import { SummaryCardShapeUtil } from "./shapes/summary-card-shape";
import { ClusterFrameShapeUtil } from "./shapes/cluster-frame-shape";
import { StrategyShapeUtil } from "./shapes/strategy-shape";
import { ThreadNoteShapeUtil } from "./shapes/thread-note-shape";
import { ReactionCardShapeUtil } from "./shapes/reaction-card-shape";
import { AppCardShapeUtil } from "./shapes/app-card-shape";
import { BridgeLinkShapeUtil } from "./shapes/bridge-link-shape";
import { CycleLoopShapeUtil } from "./shapes/cycle-loop-shape";
import { ClaimChipShapeUtil } from "./shapes/claim-chip-shape";
import { SubjectCardShapeUtil } from "./shapes/subject-card-shape";
import { FinalPlanCardShapeUtil } from "./shapes/final-plan-card-shape";
import { AxiomStoneShapeUtil } from "./shapes/axiom-stone-shape";
import { ConvergentFanShapeUtil } from "./shapes/convergent-fan-shape";
import { SignalFlagShapeUtil } from "./shapes/signal-flag-shape";
import { TwinSnapshotShapeUtil } from "./shapes/twin-snapshot-shape";
import { ObjectiveTreeShapeUtil } from "./shapes/objective-tree-shape";
import { SourceCardShapeUtil } from "./shapes/source-card-shape";
import { FileCardShapeUtil } from "./shapes/file-card-shape";
import { ThreadSnapshotShapeUtil } from "./shapes/thread-snapshot-shape";
import { ProposalSnapshotShapeUtil } from "./shapes/proposal-snapshot-shape";
import { RootCauseTreeShapeUtil } from "./shapes/root-cause-tree-shape";
import { ProposalChainRibbonShapeUtil } from "./shapes/proposal-chain-ribbon-shape";
import { TaxonomyCardShapeUtil } from "./shapes/taxonomy-card-shape";
import { VariantCardShapeUtil } from "./shapes/variant-card-shape";
import { DownstreamRealityShapeUtil } from "./shapes/downstream-reality-shape";
import { IVDecompositionShapeUtil } from "./shapes/iv-decomposition-shape";
import { VariantCarouselShapeUtil } from "./shapes/variant-carousel-shape";
import { StageNodeShapeUtil } from "./shapes/stage-node-shape";
import { ExperimentDesignCardShapeUtil } from "./shapes/experiment-design-card-shape";
import { SynthesisIntersectionCardShapeUtil } from "./shapes/synthesis-intersection-card-shape";
import { AssetCardShapeUtil } from "./shapes/asset-card-shape";
import { SituationCardShapeUtil } from "./shapes/situation-card-shape";
import { StrategyHeroCardShapeUtil } from "./shapes/strategy-hero-card-shape";
import { StrategyAlternativeShapeUtil } from "./shapes/strategy-alternative-shape";
import { StrategyObjectiveShapeUtil } from "./shapes/strategy-objective-shape";
import { RoomShapeUtil } from "./shapes/room-shape";

export const SHAPE_UTILS = [
  KGNodeShapeUtil,
  // Project-Overview design pass — live landscape overview during a run
  KGFormationShapeUtil,
  // Persistent companion — spawned once for template-seeded spaces;
  // survives sessions; clickable Browse-entities / Edges CTAs.
  KgOverviewCardShapeUtil,
  // Lineage root — the user's intake prompt as a real tldraw shape so
  // kg-formation (and everything below it) can tether UP to it,
  // turning the canvas into a readable "thought → landscape →
  // branches" tree. Replaces the prior chrome CanvasOriginCard.
  OriginPromptShapeUtil,
  // Per-axis intake lens cards. Painted by the pipeline painter on
  // `space_opened`, updated on entity_added / edge_added / merge /
  // scored events, tethered up to origin-prompt. Replaces the prior
  // chrome ProbabilitySpaceRail — shells now pan with the canvas and
  // drags land on tldraw so the whiteboard isn't "stuck" anymore.
  ProbabilitySpaceShellShapeUtil,
  StickyNoteShapeUtil,
  SynthesisCardShapeUtil,
  // Lasso → Summarize output card. Carries an LLM-generated paragraph
  // plus an inline header chip with Regenerate / Decompose / Pin
  // actions. Created by CanvasLassoSummarizeButton; arrows back to the
  // source shapes are emitted at the same time and tagged via
  // shape.meta.summarySourceFor so the canvas can dim them when the
  // owning summary card isn't selected.
  SummaryCardShapeUtil,
  ClusterFrameShapeUtil,
  StrategyShapeUtil,
  ThreadNoteShapeUtil,
  // Phase A1.1 — universal asset catalog: reaction cards
  ReactionCardShapeUtil,
  // Phase A1.2 — universal asset catalog: app cards
  AppCardShapeUtil,
  // Phase A1.3 — universal asset catalog: bridge + cycle
  BridgeLinkShapeUtil,
  CycleLoopShapeUtil,
  // Phase A1.4a — universal asset catalog: claim + axiom
  ClaimChipShapeUtil,
  AxiomStoneShapeUtil,
  // Phase 4 — Subject card primitive (manual authoring + lab bridge).
  // Created via the +Subject button or accepted from the lab proposal
  // wizard. "Open Lab" footer routes to /lab?subjectId=X.
  SubjectCardShapeUtil,
  // Phase 2 (final-plan card) — auto-spawned PRD-style document on
  // strategy approval. Renders execution-brief data with a (+) menu
  // for switching between PRD / Flowchart / Prototype / Summary modes.
  FinalPlanCardShapeUtil,
  // Phase A1.4b — universal asset catalog: convergent + signal
  ConvergentFanShapeUtil,
  SignalFlagShapeUtil,
  // Phase A1.4c — universal asset catalog: twin snapshot
  TwinSnapshotShapeUtil,
  // Phase A1.7 — universal asset catalog: objective tree
  ObjectiveTreeShapeUtil,
  // Phase 2D — universal asset catalog: source card (external inputs)
  SourceCardShapeUtil,
  // Phase 2D — universal asset catalog: ingested file card
  FileCardShapeUtil,
  // Phase 2D — universal asset catalog: thread conversation snapshot
  ThreadSnapshotShapeUtil,
  // Phase 2E · PR 4 — forked proposal snapshot card painted live by
  // the pipeline event painter when proposal_ready events arrive
  ProposalSnapshotShapeUtil,
  // Root-cause fan-in tree painted by the event painter on
  // root_cause_identified / updated on why_chain_deepened. Single
  // shape per space; upserts on re-emission.
  RootCauseTreeShapeUtil,
  // Project-Overview design pass — reasoning chain ribbon painted
  // directly below each proposal snapshot. Breadcrumb of upstream
  // entity names → target + signed lift chip.
  ProposalChainRibbonShapeUtil,
  // VP Project report (Phase 3) — independent-variable taxonomy card,
  // painted at end of intake once the domain-inferrer emits. Drives
  // the DecomposedPromptViz widget downstream.
  TaxonomyCardShapeUtil,
  // VP Project report (Phase 3, Batch 2e) — variant flashcards painted
  // live when the writer-path's variant_factory emits variant_proposed.
  VariantCardShapeUtil,
  // Sprint A — wrap-what-exists pass: the four pre-built widgets that
  // were previously only reachable from the App detail page. Now first-
  // class canvas shapes so the painter can drop them during the
  // downstream / experiment / root-cause bands of the unfurl. Each one
  // takes JSON-serialized payloads on the shape and re-hydrates
  // internally via the standalone widget context (no AppRenderer).
  DownstreamRealityShapeUtil,
  IVDecompositionShapeUtil,
  VariantCarouselShapeUtil,
  StageNodeShapeUtil,
  // 5-column experiment-design card (IV / DV / Control / Process /
  // Results + editable hypothesis). Painted by pipeline-event-painter
  // when a proposal_ready event fires with kind="experiment".
  ExperimentDesignCardShapeUtil,
  // Synthesis intersection card — the canvas's final-ranking anchor.
  SynthesisIntersectionCardShapeUtil,
  // Input layer — asset chips + situation/baseline card.
  AssetCardShapeUtil,
  SituationCardShapeUtil,
  // Phase B (intake redesign) — persistent on-canvas hero card for the
  // top-ranked strategy. Painter drops one when the first proposal_ready
  // (is_primary) event lands, keeps it pinned through the run, and
  // updates its preview props in place when the user swaps ranks via
  // the inline chips. Click-to-detail navigates to /app/space/[id]/strategy.
  StrategyHeroCardShapeUtil,
  // Strategy alternative — a single ranked alternative dropped from the
  // hero bar onto the canvas as a frozen working surface. Distinct from
  // the singular swap-aware StrategyHeroCard above.
  StrategyAlternativeShapeUtil,
  // Strategy objective — one CascadeObjective dragged from the strategy
  // drawer's cascade view onto the canvas. Stays mounted in the drawer;
  // this shape is a frozen pin of the objective's state at drop time.
  StrategyObjectiveShapeUtil,
  // Phase C (cascade rooms) — wide translucent stage backdrops. Painter
  // spawns one per pipeline stage on stage_boundary(enter) and
  // sends it to back so subsequent painted shapes (entities, axes,
  // proposals) layer on top, reading as "inside" the room.
  RoomShapeUtil,
];
