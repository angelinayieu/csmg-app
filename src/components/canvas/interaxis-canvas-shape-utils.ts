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
// v3 — Step 19. The whiteboard representation of a Claude-composed
// mechanism artifact (sourced from library_objects.object_type ===
// "mechanism"). Distinct from MechanismCardShapeUtil which is keyed
// to the legacy `mechanisms` table — both coexist by namespacing
// their tldraw shape `type` string.
import { MechanismSpecCardShapeUtil } from "./shapes/mechanism-spec-card-shape";
import { SubjectCardShapeUtil } from "./shapes/subject-card-shape";
import { FinalPlanCardShapeUtil } from "./shapes/final-plan-card-shape";
import { AxiomStoneShapeUtil } from "./shapes/axiom-stone-shape";
import { ConvergentFanShapeUtil } from "./shapes/convergent-fan-shape";
import { SignalFlagShapeUtil } from "./shapes/signal-flag-shape";
// Hidden signal shapes (2026-05-19) — first-class canvas surfaces for
// structural-analysis findings (cascade vulns, structural holes, hidden
// mediators, flip-prone loops) that were previously invisible outside
// the strategy hero card's tactic chips. Painter spawns one per
// signal_detected event; the cluster shape aggregates the suppressed
// long tail into one chip in the canvas margin.
import {
  HiddenSignalShapeUtil,
  HiddenSignalClusterShapeUtil,
} from "./shapes/hidden-signal-shape";
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
import { WorkspaceRoomShapeUtil } from "./shapes/workspace-room-shape";
import { RoomTransitionShapeUtil } from "./shapes/room-transition-shape";
import { ProbeTrailShapeUtil } from "./shapes/probe-trail-shape";
import { MechanismCardShapeUtil } from "./shapes/mechanism-card-shape";
import { LayerStackShapeUtil } from "./shapes/layer-stack-shape";
import { HypothesisLadderShapeUtil } from "./shapes/hypothesis-ladder-shape";
import { TrajectoryFanShapeUtil } from "./shapes/trajectory-fan-shape";
import { ForestPlotShapeUtil } from "./shapes/forest-plot-shape";
import { EdgeDriftHeatmapShapeUtil } from "./shapes/edge-drift-heatmap-shape";
import { SeedCardShapeUtil } from "./shapes/seed-card-shape";

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
  // v3 — Step 19. Mechanism spec card sourced from library_objects.
  // Distinct from the legacy MechanismCardShapeUtil which is keyed
  // to the `mechanisms` table — both coexist by namespacing their
  // tldraw shape `type` string ("mechanism-spec-card" vs
  // "mechanism-card"). User drags from the LibraryPanel; landed
  // card carries title + design caption + accent band + evidence
  // chip + section count from the embedded DesignArtifact.
  MechanismSpecCardShapeUtil,
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
  // Hidden signal shapes (2026-05-19) — surfaces structural findings
  // (cascade vulnerabilities, structural holes, hidden mediating
  // variables, flip-prone loops) from extractSignals() as live
  // canvas shapes anchored near their source entities. The cluster
  // shape aggregates the suppressed lower-priority tail.
  HiddenSignalShapeUtil,
  HiddenSignalClusterShapeUtil,
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
  // Universal-canvas Phase A — hosts arbitrary user artifacts as
  // canvas rooms (brainstorm sessions, strategy docs, twin sessions,
  // probe transcripts). Discriminated by `kind` prop. First step
  // toward making this canvas the universal workspace surface.
  WorkspaceRoomShapeUtil,
  // B1 — directional flow connector between consecutive cascade rooms.
  // Spawned by canvas-room-transition-spawner once both endpoint rooms
  // exist on the canvas. Pulse re-fires the dash-march animation when
  // the source stage emits an event.
  RoomTransitionShapeUtil,
  // Probe rabbit-hole trail (2026-07-04) — spatial unfurl of a probe
  // question, spawned by the dock:probe event listener (or per-card
  // (+) menu's Probe action). Renders the agent's question-decomp
  // tree using TrailNode + TrailEdge primitives.
  ProbeTrailShapeUtil,
  // A2 — Mechanism cards inside the twin room. One card per row in
  // the `mechanisms` table; spawned by canvas-operational-seed-spawner
  // by reading /api/spaces/[id]/mechanisms after the twin room exists.
  // Surfaces the cycle pattern + agent count + app count + status —
  // closes the gap where mechanisms were first-class in the DB but
  // invisible on the canvas.
  MechanismCardShapeUtil,
  // A3 — Layer ontology stack inside the KG room. One vertical card
  // per space, listing the domain's layer hierarchy (e.g. for Cognitive
  // Performance: Exogenous → Behaviors → ... → Composite). Spawned by
  // canvas-operational-seed-spawner reading /api/spaces/[id]/layer-
  // ontology. The ontology already drives entity-card color badges via
  // useLayerOntology; this surfaces the FULL hierarchy.
  LayerStackShapeUtil,
  // T2 — Hypothesis ladder cards inside the proposal room. One card
  // per row in the `hypothesis_ladders` table; spawned by canvas-
  // operational-seed-spawner reading /api/spaces/[id]/hypothesis-
  // ladders. Renders the strategy's pre_mortem entries as 4-rung
  // claim → mechanism → falsifier → verdict cards — closes the rigor
  // gap that variable_proposals didn't (variables = metrics; ladders
  // = the falsifiable claims those metrics test).
  HypothesisLadderShapeUtil,
  // T5a — Trajectory fan cards inside the twin room. One card per
  // recent trajectory prediction (`prediction_ledger` rows where
  // `prediction_kind="trajectory"`). Renders the per-week p10/p50/p90
  // fan as a compact SVG chart so users see the simulator's forward
  // projection right next to the twin-snapshot, instead of having
  // to navigate to the standalone TrajectoryPanel side-page.
  TrajectoryFanShapeUtil,
  // T4a — Forest plot inside the kg room. One card per space
  // (singleton; aggregates top N evidence_registries rows by
  // |effect_size|). Renders effect sizes with confidence intervals
  // ranked vertically — the meta-analysis-style viz. Closes the
  // "where do I see findings ranked by confidence?" gap.
  ForestPlotShapeUtil,
  // T6 — Edge drift heatmap inside the reflexive room. One card per
  // space (singleton; aggregates `edge_calibrations` over the last
  // N weeks). Visualizes which edges drifted, in which direction,
  // and how recently as a rows × cols heatmap. The reflexive room's
  // primary content — closes the audit-loop visualization gap.
  EdgeDriftHeatmapShapeUtil,
  // Phase C (typed-clarifier) — seed cards spawned on first canvas
  // mount for quiet modes (brain_probe / brainstorm_speed). One card
  // per typed MCQ answer in synthesis_data.user_assertions. Each
  // exposes a "Promote to entity" CTA that materializes the seed as
  // a real Entity with provenance=user_asserted so downstream expand
  // calls can pick it up.
  SeedCardShapeUtil,
];
