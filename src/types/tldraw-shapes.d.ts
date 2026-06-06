// Register the canvas's custom shapes with tldraw's type registry so
// `editor.updateShape<MyShape>`, `editor.createShape<MyShape>`, and
// `shape.type === "kg-node"` all narrow correctly.
//
// tldraw v4 exposes the global `TLGlobalShapePropsMap` interface as the
// extension point — augmenting it with our shape's prop shapes makes them
// members of the `TLShape` union.

import type { LayerId } from "@/lib/whiteboard/layer-config";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    // Decomposition group frame — wraps a systems graph into one artifact.
    "sys-frame": {
      w: number;
      h: number;
      label: string;
      accent: string;
    };
    "kg-node": {
      w: number;
      h: number;
      entityId: string;
      name: string;
      description: string;
      layer: LayerId;
      category: string;
      tier: "hero" | "key" | "support" | "peripheral";
      weight: number;
      isLeverage: boolean;
      isRisk: boolean;
      isBottleneck: boolean;
      isConvergence: boolean;
      isGhost: boolean;
      // P0 #4 — monotonic counter the painter bumps when a preview
      // (Pass 1 speculative) kg-node upgrades to a real entity. The
      // view component plays a one-shot saturate+scale pulse so the
      // transition reads as "confirmed" without moving the card.
      confirmedPulse: number;
    };
    "sticky-note": {
      w: number;
      h: number;
      text: string;
      color: "yellow" | "pink" | "blue" | "green" | "purple";
      dimension:
        | "problem"
        | "solution"
        | "question"
        | "insight"
        | "risk"
        | "evidence"
        | null;
      aiTagged: boolean;
      entityId: string | null;
    };
    "synthesis-card": {
      w: number;
      h: number;
      kind: "leverage" | "risk" | "cycle" | "bridge" | "insight";
      title: string;
      body: string;
      sourceEntityIds: string[];
    };
    "cluster-frame": {
      w: number;
      h: number;
      title: string;
      collapsed: boolean;
      childShapeIds: string[];
      stashedPositions: Array<{ id: string; x: number; y: number }>;
      accent: string;
      previewLabels: string[];
    };
    // Arc 4 Phase B: draggable strategy snapshot artifact
    "strategy-card": {
      w: number;
      h: number;
      snapshotId: string;
      version: number;
      label: string;
      title: string;
      status: "generated" | "reviewing" | "confirmed" | "superseded";
      readyScore: number | null;
      tacticCount: number | null;
      confidence: number | null;
      expanded: boolean;
    };
    // Arc 5A: comment thread note (sub-branching on any shape)
    "thread-note": {
      w: number;
      h: number;
      threadId: string;
      text: string;
      parentShapeId: string | null;
      rootShapeId: string;
      depth: number;
      accentHex: string;
      authorDisplay: string;
      createdAtIso: string;
      pending: boolean;
    };
    // Phase A1.1 — universal asset catalog: reaction card.
    "reaction-card": {
      w: number;
      h: number;
      reactionId: string;
      spaceId: string;
      name: string;
      reactionType: "emergent" | "reinforcing" | "tension" | "trivial";
      probability: number;
      entityCount: number;
      accent: string;
    };
    // Phase 2D — universal asset catalog: ingested file card.
    "file-card": {
      w: number;
      h: number;
      fileId: string;
      spaceId: string;
      sourceName: string;
      sourceType: "file" | "url" | "text";
      mimeType: string | null;
      sourceUrl: string | null;
      preview: string;
      charCount: number;
      analyzed: boolean;
      accent: string;
      // Two-phase image ingest (2026-05-01) — populated for image
      // MIME cards by the ingest hook + the image_extracted SSE
      // event listener. Non-image cards leave these at defaults.
      visionStatus: "idle" | "analyzing" | "ready" | "error";
      visionDescription: string;
      visionEntityCount: number;
      visionRelationshipCount: number;
      visionError: string | null;
    };
    // Phase 2D — universal asset catalog: thread snapshot card.
    "thread-snapshot": {
      w: number;
      h: number;
      threadId: string;
      spaceId: string;
      rootShapeId: string;
      rootContent: string;
      authorDisplay: string;
      replyCount: number;
      latestReply: string | null;
      latestAt: string;
      accent: string;
    };
    // Phase 2E · PR 4 — forked proposal snapshot card. Paints
    // side-of-entity when a `proposal_ready` event carrying a
    // targetEntityId fires during a pipeline run.
    "proposal-snapshot": {
      w: number;
      h: number;
      proposalId: string;
      kind: "strategy" | "experiment" | "variant";
      title: string;
      headline: string;
      targetEntityId: string | null;
      p10: number | null;
      p50: number | null;
      p90: number | null;
      accent: string;
    };
    // Project-Overview design pass — reasoning chain ribbon docked
    // below a proposal-snapshot. Breadcrumb of upstream entity names
    // → target + signed lift chip. Not persisted; painted live by the
    // pipeline event painter when proposal_ready events carry a
    // `chain` field, and cleaned up alongside the snapshot on run
    // completion.
    "proposal-chain-ribbon": {
      w: number;
      h: number;
      proposalId: string;
      kind: "strategy" | "experiment" | "variant";
      shortId: string;
      nodeNames: string[];
      lift: number | null;
      constraintLabel: string | null;
      accent: string;
    };
    // Phase 2D — universal asset catalog: source card (external
    // inputs: evidence, files, URLs, integrations).
    "source-card": {
      w: number;
      h: number;
      sourceId: string;
      spaceId: string;
      title: string;
      snippet: string;
      url: string | null;
      domain: string | null;
      sourceType: "evidence" | "external_entity" | "file" | "url" | "integration_placeholder";
      provider: string | null;
      reliability: number | null;
      accent: string;
    };
    // Phase A1.7 — universal asset catalog: objective tree.
    "objective-tree": {
      w: number;
      h: number;
      goalId: string;
      spaceId: string;
      title: string;
      status: string;
      objectiveType: string;
      progress: number;
      nodeCount: number;
      depth: number;
      proposedCount: number;
      treeJson: string;
      expanded: boolean;
    };
    // Phase A1.4c — universal asset catalog: twin snapshot.
    "twin-snapshot": {
      w: number;
      h: number;
      spaceId: string;
      spaceName: string;
      snappedAt: string;
      healthScore: number;
      healthLabel: "strong" | "developing" | "fragile" | "critical";
      maturity:
        | "actionable_now"
        | "waiting_on_dependency"
        | "theoretical"
        | "blocked";
      entitiesCount: number;
      edgesCount: number;
      cyclesCount: number;
      leveragePoints: number;
      riskPoints: number;
      reinforcingPositive: number;
      reinforcingNegative: number;
      balancing: number;
      bottleneckName: string | null;
      bottleneckShare: number | null;
    };
    // Phase A1.4b — universal asset catalog: convergent fan.
    "convergent-fan": {
      w: number;
      h: number;
      pointId: string;
      spaceId: string;
      focalEntityId: string;
      focalName: string;
      interactorNames: string[];
      outcome: string;
      polarity: "positive" | "negative" | "neutral" | "conditional";
      probability: number;
      confidence: number;
    };
    // Phase A1.4b — universal asset catalog: signal flag.
    "signal-flag": {
      w: number;
      h: number;
      signalId: string;
      spaceId: string;
      signalType: string;
      category: string;
      description: string;
      severity: "high" | "medium" | "low";
      status:
        | "active"
        | "dismissed"
        | "investigating"
        | "escalated"
        | "resolved";
      entityName: string;
      relatedInternalIds: string[];
      detectedAt: string;
    };
    // Hidden signal (2026-05-19) — structural-analysis findings from
    // extractSignals() surfaced as first-class canvas shapes near the
    // entities they concern. Distinct from signal-flag (radar/external
    // intel) — these are about the graph's own internal structure.
    "hidden-signal": {
      w: number;
      h: number;
      signalId: string;
      spaceId: string;
      signalType:
        | "cascade_vulnerability"
        | "structural_hole"
        | "hidden_variable"
        | "flip_prone_loop";
      signalName: string;
      description: string;
      trajectoryImpact: number;
      confidence: number;
      severity: "critical" | "moderate" | "low";
      primaryEntityIds: string[];
      secondaryEntityIds: string[];
      reasoning: string;
      validationAction: string;
      status: "active" | "dismissed" | "investigating" | "resolved";
      emittedAt: string;
      expanded: number;
    };
    // Hidden signal cluster — aggregates the long tail of suppressed
    // lower-priority signals. One per space per run; click expands
    // a side-panel listing the suppressed signals.
    "hidden-signal-cluster": {
      w: number;
      h: number;
      clusterId: string;
      spaceId: string;
      suppressedCount: number;
      topTypes: string[];
    };
    // Phase A1.4a — universal asset catalog: claim chip.
    "claim-chip": {
      w: number;
      h: number;
      claimId: string;
      spaceId: string;
      claimText: string;
      claimType:
        | "mechanism"
        | "assertion"
        | "prediction"
        | "assumption"
        | "finding";
      status: "proposed" | "supported" | "contested" | "refuted";
      confidence: number;
      sourceEntityId: string | null;
      sourceEntityName: string | null;
    };
    // Phase A1.4a — universal asset catalog: axiom stone.
    "axiom-stone": {
      w: number;
      h: number;
      axiomId: string;
      spaceId: string;
      claim: string;
      ifFalse: string;
      visibility: "EXPLICIT" | "IMPLICIT" | "HIDDEN";
      loadBearing: "critical" | "important" | "moderate";
      scope: "node" | "edge" | "chain" | "frame";
      confidence: "high" | "medium" | "low";
      restsOn: string[];
    };
    // Phase A1.3 — universal asset catalog: bridge link.
    "bridge-link": {
      w: number;
      h: number;
      bridgeId: string;
      spaceId: string;
      sharedVariable: string;
      sourceLabel: string;
      targetLabel: string;
      couplingStrength: "strong" | "moderate" | "weak";
      couplingDirection: "source_to_target" | "target_to_source" | "bidirectional";
      confidence: number;
      partnerEntityId: string | null;
      partnerSpaceId: string | null;
    };
    // Phase A1.3 — universal asset catalog: cycle loop.
    "cycle-loop": {
      w: number;
      h: number;
      cycleId: string;
      spaceId: string;
      name: string;
      classification: "reinforcing_positive" | "reinforcing_negative" | "balancing";
      entityNames: string[];
      nodeCount: number;
      multiplier: number | null;
      firstEntityId: string | null;
    };
    // Lineage root — the user's intake prompt painted as a tldraw shape
    // so kg-formation (and everything downstream) can tether UP to it.
    // Replaces the prior chrome CanvasOriginCard so arrows actually
    // terminate on the prompt and the canvas reads as a tree.
    "origin-prompt": {
      w: number;
      h: number;
      promptText: string;
      runActive: boolean;
      accent: string;
    };
    // Per-axis intake lens card (ACTORS / TIMELINE / CULTURAL / …).
    // Painted by the pipeline painter on `space_opened` and updated on
    // entity_added / edge_added / merge / scored events. Replaces the
    // prior chrome ProbabilitySpaceRail so shells pan with the canvas
    // and stop eating drags that should have reached tldraw.
    "probability-space-shell": {
      w: number;
      h: number;
      spaceKey: string;
      axis: string;
      label: string;
      tagline: string;
      accent: string;
      rationale: string;
      orderIndex: number;
      entitiesJson: string;
      edgesJson: string;
      merging: boolean;
      scoreJson: string;
      pulse: number;
    };
    // Project-Overview design pass — live KG formation card. Painted at
    // top of canvas during a run; mutated in place as entity/edge events
    // stream; deleted on run completion.
    "kg-formation": {
      w: number;
      h: number;
      entityCount: number;
      edgeCount: number;
      hubCount: number;
      hubsJson: string;
      hubEdgesJson: string;
      pulse: number;
      accent: string;
    };
    // Persistent KG overview card — spawned once for template-seeded
    // spaces (no pipeline run needed). Same mini-graph viz as
    // kg-formation but with explicit click-through CTAs to the entity
    // browser + edges browser. Carries spaceId for the buttons to
    // build their hrefs.
    "kg-overview-card": {
      w: number;
      h: number;
      spaceId: string;
      entityCount: number;
      edgeCount: number;
      hubCount: number;
      layerCount: number;
      hubsJson: string;
      hubEdgesJson: string;
      title: string;
      accent: string;
    };
    // VP Project report (Phase 3, Batch 2e) — variant flashcard painted
    // live by the pipeline-event-painter when a `variant_proposed` event
    // fires from the writer-path run. Run-scoped ghost; canonical row
    // lives in `experiment_variants`.
    "variant-card": {
      w: number;
      h: number;
      variantId: string;
      spaceId: string;
      appId: string | null;
      label: string;
      status: string;
      summary: string | null;
      shortId: string | null;
      situationKey: string | null;
      aggregateQuality: number | null;
      aggregateLift: number | null;
      accent: string;
    };
    // VP Project report (Phase 3) — independent-variable taxonomy card.
    // Painted once per run at tail of intake when the domain-inferrer
    // emits `taxonomy_inferred`. Cleared on run completion alongside
    // the other ghost shapes.
    "taxonomy-card": {
      w: number;
      h: number;
      taxonomyId: string | null;
      spaceId: string;
      domainKey: string;
      artifactNoun: string;
      variantNoun: string;
      situationNoun: string;
      slotsJson: string;
      confidence: number;
      accent: string;
    };
    // Root-cause tree — Kaufman-style fan-in diagram painted live by the
    // pipeline event painter on `root_cause_identified` (backward BFS from
    // goals) and updated on `why_chain_deepened` (driver counter refresh).
    // One per space — upserts on re-emission. Nodes + edges packed as JSON
    // strings so tldraw's prop validation stays flat.
    "root-cause-tree": {
      w: number;
      h: number;
      spaceId: string;
      title: string;
      goalEntityIds: string[];
      goalNames: string[];
      nodesJson: string;
      edgesJson: string;
      reachableCount: number;
      convergencePoints: number;
      rootCandidates: number;
      driversTotal: number;
      userControllableCount: number;
      accent: string;
      version: number;
    };
    // Sprint A — wrap-what-exists pass: downstream reality heatmap.
    // Pre-built widget from /apps/widgets wrapped as a tldraw shape so
    // the painter can drop it during the downstream band of the unfurl.
    "downstream-reality": {
      w: number;
      h: number;
      spaceId: string;
      appId: string | null;
      title: string | null;
      realityJson: string;
      variantsJson: string;
      taxonomyJson: string;
      accent: string;
      version: number;
    };
    // Sprint A — wrap-what-exists pass: IV decomposition rings.
    "iv-decomposition": {
      w: number;
      h: number;
      spaceId: string;
      appId: string | null;
      title: string | null;
      dense: boolean;
      variantJson: string;
      taxonomyJson: string;
      accent: string;
      version: number;
    };
    // Sprint A — wrap-what-exists pass: variant carousel (3D coverflow).
    "variant-carousel": {
      w: number;
      h: number;
      spaceId: string;
      appId: string | null;
      title: string | null;
      variantsJson: string;
      taxonomyJson: string;
      accent: string;
      version: number;
    };
    // Sprint A — wrap-what-exists pass: single causal-chain stage card.
    // Painter drops one per stage; arrows between them form the chain.
    "stage-node": {
      w: number;
      h: number;
      spaceId: string;
      chainId: string;
      chainName: string;
      chainRank: number;
      stageIndex: number;
      kind:
        | "concept"
        | "research"
        | "deliverable"
        | "application"
        | "outcome"
        | "goal";
      title: string;
      meta: string;
      confidence: number | null;
      verified: boolean;
      valueLabel: string | null;
      entityId: string | null;
      isTerminal: boolean;
      convergingCount: number | null;
    };
    // Asset card — chip per ingested file painted at top-of-canvas
    // alongside the origin-prompt. Spawned from `asset_added` events.
    "asset-card": {
      w: number;
      h: number;
      assetId: string;
      spaceId: string;
      sourceName: string;
      assetClass:
        | "research_pdf"
        | "internal_doc"
        | "dataset"
        | "image_diagram"
        | "prior_analysis"
        | "spec_sheet"
        | "web_article"
        | "pasted_text";
      charCount: number;
      accent: string;
      uploadedAt: string;
    };
    // Situation card — current-state baseline. Five-section render
    // (inputs / process / outputs / knowns / unknowns) plus an
    // uncertainty pill. Spawned from `situation_analyzed` events.
    "situation-card": {
      w: number;
      h: number;
      spaceId: string;
      uncertaintyScore: number;
      inputsCount: number;
      processStepsCount: number;
      outputsCurrentCount: number;
      outputsTargetCount: number;
      knownsCount: number;
      unknownsCount: number;
      assetCount: number;
      skippedReason: string;
      accent: string;
      version: number;
    };
    // Synthesis intersection card — the canvas's final-ranking
    // anchor. Painted once per run after axes complete; proposals
    // fork off this card instead of off individual entity ghosts.
    // Data is derived from painter state (axis shells × entities)
    // so no extra DB query is needed.
    "synthesis-intersection-card": {
      w: number;
      h: number;
      spaceId: string;
      title: string;
      totalAxes: number;
      rowsJson: string;
      appsProposedCount: number;
      isComputing: boolean;
      accent: string;
      version: number;
    };
    // 5-column experiment-design card. Painted alongside the
    // proposal-snapshot for kind="experiment" proposal_ready events.
    // Lays out IV / DV / Control / Process / Results columns plus an
    // editable hypothesis row, giving the canvas a single cohesive
    // surface in experimental-design vocabulary. Run-scoped ghost —
    // cleaned up alongside the snapshot + chain ribbon on run
    // completion.
    "experiment-design-card": {
      w: number;
      h: number;
      proposalId: string;
      appId: string | null;
      title: string;
      hypothesis: string;
      ivNames: string[];
      dvName: string | null;
      controlLabel: string;
      processChain: string[];
      identifyKind: string;
      refuteVerdict: string;
      p10: number | null;
      p50: number | null;
      p90: number | null;
      distributionProvenance: string;
      distributionSampleCount: number | null;
      accent: string;
    };
    // Phase C (cascade rooms) — STAGE ROOM.
    //
    // A wide translucent backdrop that visually groups the painter's
    // shapes into a top-down cascade by pipeline stage. Each room
    // carries its stage identifier + cached counts so its header can
    // render the live "X entities · Y edges so far" subtitle without
    // re-deriving from the event log on every render.
    //
    // Spawned by the painter on `stage_boundary(enter)` events; their
    // header subtitle updates live as artifacts land in their bands.
    // Sent to back on creation so subsequent shapes naturally sit on
    // top — the room reads as a container without us needing to
    // explicitly nest tldraw children.
    //
    // The (+) extension button on each room fires a window event
    // (`canvas-room:extend`) the parent canvas can listen on to open
    // a popover with the four verbs (add info / ask query / sub-objective
    // / generate more). Decoupled this way so the shape stays purely
    // visual and the popover lives in chrome.
    "room": {
      w: number;
      h: number;
      /** PipelineStage enum value — drives title, accent, glyph. */
      stage:
        | "intake"
        | "landscape"
        | "kg"
        | "proposal"
        | "lab"
        | "results";
      /** Stage state — drives the active glow + completion checkmark. */
      state: "active" | "complete" | "pending";
      /** Live subtitle (e.g., "23 entities · 45 edges"). Painter
       *  updates this in place as count-bumping events arrive. */
      subtitle: string;
      /** Bumped each time the room's contents change so the view
       *  component can play a subtle pulse on count update. */
      pulse: number;
      /** Spawned-at timestamp (ms epoch) — drives the entrance
       *  animation; the view component plays a one-shot fade+scale
       *  transition for ~600ms after spawn. */
      spawnedAt: number;
      /** Space UUID for the (+) extension verbs that need a server
       *  endpoint (add info, ask query, sub-objective). */
      spaceId: string;
    };
    // Universal-canvas Phase A — workspace room shape. Hosts arbitrary
    // user artifacts (brainstorm sessions, strategy docs, twin
    // construction sessions, probe transcripts) as canvas rooms. The
    // `kind` prop discriminates the renderer; `artifact_id` links to
    // the underlying database row. First step toward making this
    // canvas the universal workspace surface.
    "workspace-room": {
      w: number;
      h: number;
      /** Discriminator — which artifact this room hosts. */
      kind: "brainstorm" | "strategy" | "twin" | "probe" | "space";
      /** UUID FK to the underlying row (brainstorm_sessions.id,
       *  synergy_strategies.id, etc.). Resolved client-side by the
       *  per-kind renderer. */
      artifact_id: string;
      /** Cached title for instant render before the artifact fetch
       *  completes. */
      cached_title: string;
      /** ms timestamp at spawn — gates the entrance animation. */
      spawnedAt: number;
      /** When true the renderer shows a larger card with richer detail.
       *  Toggle lives in the card's header. Same shape, two states. */
      expanded: boolean;
    };
    // Probe rabbit-hole trail (2026-07-04) — spatial unfurl of a probe
    // question into 2-4 sub-questions. Spawned by the dock:probe event
    // listener (or per-card (+) menu's Probe action) right after the
    // /api/canvas/probe-rabbit-hole endpoint returns. Renders the
    // agent's question-decomp tree using TrailNode + TrailEdge
    // primitives. Trail data lives as a stringified ProbeTrail JSON in
    // the trailJson prop because tldraw's prop validators require
    // scalar fields; the shape util parses on render.
    "probe-trail": {
      w: number;
      h: number;
      /** Stringified ProbeTrail (see probe-orchestrator.ts). Mutating
       *  the trail (e.g., flipping a sub-question to 'working' while
       *  research-deep runs) updates this prop in place. */
      trailJson: string;
      /** Source kg-node entity id — the card the trail tethers to. */
      sourceEntityId: string;
      sourceEntityName: string;
      rootQuestion: string;
      /** Spawned-at ms epoch — drives the one-shot entrance animation. */
      spawnedAt: number;
      /** Compact pill mode — when true, the shape collapses to a
       *  220×40 'Probe · N branches' chip the user can drag around as
       *  a permanent canvas marker. Toggled by clicking the result
       *  terminal (expanded → collapsed) or the chevron (collapsed →
       *  expanded). The trail data stays intact in `trailJson` either
       *  way. */
      collapsed: boolean;
    };
    // Phase B (intake redesign) — STRATEGY HERO CARD.
    //
    // The single persistent on-canvas surface for the user's top-ranked
    // strategy. Anchored bottom-center of the whiteboard during a run +
    // remains pinned after the run completes so the strategy is always
    // visible without scrolling.
    //
    // Data shape: lightweight summary (title, summary, posture,
    // confidence + the rank chips for #2/#3 swap). The shape FETCHES
    // its full strategy_batch from /api/spaces/[id]/twin-proposal on
    // mount so a tldraw-document reload (which doesn't carry the full
    // recommendation) can re-hydrate. This keeps the shape's tldraw
    // props minimal — the full StrategicRecommendation lives in the DB
    // (synthesis_data.strategy_batch).
    //
    // Click on a non-primary rank chip → POST swap-rank → re-fetch.
    // Click "Open" → navigate to the existing /strategy detail page.
    "strategy-hero-card": {
      w: number;
      h: number;
      spaceId: string;
      /** Total ranks generated this run (1..5). Drives the chip row count. */
      totalRanks: number;
      /** Currently displayed rank (1-indexed). 1 = primary. */
      activeRank: number;
      /** Cached preview — title of the active rank for instant render
       *  before the on-mount fetch lands. Updated by the swap handler. */
      activeTitle: string;
      /** Cached one-line summary of the active rank. */
      activeSummary: string;
      /** Confidence 0-100 for the active rank, or null if not computed. */
      activeConfidence: number | null;
      /** Strategic posture label (cautious_validation / aggressive_growth / …). */
      activePosture: string;
      /** Monotonic counter — bumped on every successful swap or refresh
       *  so the view component re-fetches the latest batch. */
      pulse: number;
    };
    // Strategy alternative — one ranked alternative pinned from the
    // hero bar onto the canvas as a frozen working surface. Distinct
    // from the singular swap-aware "strategy-hero-card" above.
    "strategy-alternative-card": {
      w: number;
      h: number;
      spaceId: string;
      entryRank: number;
      posture: string;
      title: string;
      summary: string;
      confidence: number | null;
      wasPrimary: boolean;
      pinnedAt: string;
      expanded: boolean;
    };
    // Strategy objective — one CascadeObjective dragged out of the
    // strategy drawer's cascade view onto the canvas. Frozen pin of
    // the objective's state at drop time; deduped by (spaceId,
    // objectiveId) so re-dragging focuses the existing card.
    "strategy-objective-card": {
      w: number;
      h: number;
      spaceId: string;
      objectiveId: string;
      title: string;
      description: string | null;
      progressPct: number;
      tag: "lead" | "lag";
      valueLabel: string | null;
      paletteKey: "finance" | "customers" | "internal" | "learning";
      perspectiveLabel: string;
      pinnedAt: string;
    };
    // Phase A1.2 — universal asset catalog: app card.
    "app-card": {
      w: number;
      h: number;
      appId: string;
      spaceId: string;
      name: string;
      appType: "dashboard" | "workflow" | "tool" | "monitor" | "integration";
      status: "proposed" | "approved" | "active" | "paused" | "retired";
      healthScore: number | null;
      staleReason:
        | "kg_changed"
        | "new_research"
        | "user_feedback"
        | "strategy_regen"
        | "whiteboard_edit"
        | null;
      hasInterventions: boolean;
      interventionCount: number;
      accent: string;
      expanded: boolean;
      p10: number | null;
      p50: number | null;
      p90: number | null;
      cardSpecJson: string | null;
    };
    // Phase 4 — Subject card primitive. First-class whiteboard
    // representation of a subjects row. Created via the +Subject
    // manual-authoring button or accepted from the lab proposal
    // wizard. "Open Lab" footer routes to /lab?subjectId=X.
    "subject-card": {
      w: number;
      h: number;
      subjectId: string;
      spaceId: string;
      name: string;
      focusKind:
        | "person"
        | "document"
        | "product"
        | "topic"
        | "environment"
        | "system"
        | "data"
        | "reaction"
        | "other";
      focusLabel: string;
      scopeSummary: string | null;
      conditionCount: number;
      artifactState:
        | "bare_topic"
        | "partial_artifact"
        | "complete_artifact";
      needsReview: boolean;
    };
    // Lasso → Summarize output card. Carries the AI-generated body +
    // an inline action header (Regenerate / Decompose / Pin). Source
    // shape ids drive the connector arrows the canvas paints back at
    // each input. summaryId is stable across regenerations so retries
    // land on the same surface instead of stacking new shapes.
    "summary-card": {
      w: number;
      h: number;
      summaryId: string;
      kind: "summary";
      title: string;
      body: string;
      sourceShapeIds: string[];
      sourceCount: number;
      sourceLabel: string;
      status: "fresh" | "regenerating" | "stale" | "error";
      errorMessage: string | null;
      generatedAt: string;
    };
    // Phase 2 — final-plan card. Auto-spawned below the strategy
    // hero on approval. Renders execution-brief data as a multi-
    // section PRD-style document with a (+) menu that switches
    // between PRD / Flowchart / Prototype / Summary modes.
    "final-plan-card": {
      w: number;
      h: number;
      planId: string;
      spaceId: string;
      recommendationId: string;
      title: string;
      viewMode: "prd" | "flowchart" | "prototype" | "summary";
      briefJson: string;
      evidenceCount: number;
      confidence: "high" | "moderate" | "low" | null;
      status: "fresh" | "regenerating" | "stale" | "error";
      errorMessage: string | null;
      generatedAt: string;
    };
    // Objective canvas — "collapse-to-card" target. When a room (the
    // objective itself or a sub-objective) is collapsed out of its
    // floating window, the shell drops one of these onto the focused
    // objective whiteboard base. Self-contained (no app context) so it
    // mounts safely outside SpaceDataProvider. `roomId` is "__obj" for
    // the objective or a sub-objective id; the Expand button fires
    // `objective-board:open-room` to re-inflate the window.
    "room-card": {
      w: number;
      h: number;
      title: string;
      subtitle: string;
      color: string;
      roomId: string;
      chips: string[];
    };
    // Objective board — AI "Connect"/"Synthesize" result. Lands as a
    // proposed (ghost) card with Keep/Dismiss; accepting persists it as a
    // first-class board artifact. `sourceIds` are the tldraw ids of the
    // cards it links to (tethered by arrows tagged meta.proposalFor).
    "insight-card": {
      w: number;
      h: number;
      status: "proposed" | "accepted";
      kind: "connect" | "synthesize";
      headline: string;
      body: string;
      color: string;
      sourceIds: string[];
    };
    // Objective board — a single room item (pain/feature/outcome) sent to
    // the board so it can be Connect/Synthesize'd with items from OTHER
    // rooms. "Open room" reopens the source room (roomId). `mechanism` is
    // the runtime-flow step kind emitted by the make_technical / data_flow
    // ops (1. Collect → 2. Update …, with consumes/produces tokens) so the
    // resulting cards read as a mechanism chain instead of generic "Lab".
    "artifact-card": {
      w: number;
      h: number;
      kind:
        | "pain"
        | "feature"
        | "outcome"
        | "lab"
        | "mechanism"
        | "factor"
        | "decision"
        | "question";
      title: string;
      subtitle: string;
      color: string;
      entityId: string;
      roomId: string;
    };
    // Objective board — one mechanism's "specialized knowledge graph": its
    // scoped problem → mechanism → solution triad, dropped on the board as a
    // standalone card. Carries a lightweight snapshot (chip labels + counts,
    // never the full MechanismSpec). "Open in room" fires open-room with the
    // mechanism id as a focus hint (RoomAltitudeMap `?focus=` seam).
    "subsystem-kg": {
      w: number;
      h: number;
      mechanismId: string;
      mechanismName: string;
      roomId: string;
      spaceId: string;
      color: string;
      problemLabels: string[];
      solutionLabels: string[];
      problemCount: number;
      solutionCount: number;
      hasSpec: boolean;
      stepCount: number;
    };
    // Objective unfurl — a translucent backdrop band, one per ObjectiveStack
    // layer. Sub-objective cards sit on top of their layer's band.
    "layer-band": {
      w: number;
      h: number;
      ordinal: number;
      name: string;
      archetype: string;
      uncovered: boolean;
      accent: string;
    };
    // SpecForge — one decision card in a causal-spec unfurl (idea → clean
    // summary → target user → problem cause tree → root constraint →
    // first-principles need → desired result → product thesis →
    // alternatives → differentiation → solution families → top MVPs →
    // recommended first build). `stage` drives the accent; `body` carries
    // "\n"-delimited bullet lines. Run by the SpecForge runner off a
    // selected idea; ephemeral board artifacts (saveable to Library).
    "specforge-card": {
      w: number;
      h: number;
      stage: string;
      eyebrow: string;
      title: string;
      subtitle: string;
      body: string;
      modelJson: string;
      entityId: string;
      /** specforge_engine_runs.id — KG state-model provenance (migration 20260924). */
      engineRunId: string;
    };
    // SpecForge → Tech Spec — the engineering-grade spec generated at the end
    // of a forge run (Opus + UI agent skill). Holds the spec as JSON + the
    // rendered markdown; "Open spec" fires objective-board:open-tech-spec to
    // mount the full-screen TechSpecPanel. When `expanded=true`, the card
    // grows in place and renders all sections inline with per-section refine
    // + Ask/Variations/Improve chips. `sectionMeta` is a JSON-stringified
    // Partial<Record<TechSpecSectionId, SectionMeta>> tracking pending
    // improvements + per-section version history (see lib/objective-canvas/
    // tech-spec/sections.ts). `lastChangedSection` flashes a diff highlight.
    "tech-spec-card": {
      w: number;
      h: number;
      title: string;
      specJson: string;
      markdown: string;
      featureCount: number;
      phaseCount: number;
      expanded: boolean;
      sectionMeta: string;
      lastChangedSection: string;
      lastChangedAt: number;
    };
    // Objective board — one UI-plan variant forked from any selected card
    // (objective-board:build-ui-plans). Holds a TechSpecUiPlan + the source
    // text; the card's "Build prototype" button fires BUILD_PROTOTYPE_EVENT
    // with a stub TechSpec wrapping just this plan.
    "ui-plan-card": {
      w: number;
      h: number;
      title: string;
      variantLabel: string;
      overview: string;
      sourceText: string;
      uiPlanJson: string;
      status: "generating" | "ready" | "error";
      objectId: string;
    };
    // Objective board — spec-feedback-card. Output of an inline op (Ask /
    // Variations / Improve) on a tech-spec section. Anchors back to the
    // source spec card + section; the "Attach to §section" button queues
    // this card's content as a pending improvement on the spec (drained
    // by per-section refine). Fires objective-board:attach-to-section.
    "spec-feedback-card": {
      w: number;
      h: number;
      kind: "ask" | "variations" | "improve";
      sectionLabel: string;
      sectionId: string;
      specCardId: string;
      selection: string;
      content: string;
      attached: boolean;
    };
    // Objective board — interactive Claude prototype: self-contained HTML/CSS
    // (no JS, sanitized) rendered in a sandboxed iframe and iterated in place
    // via the feedback box (objective-board:prototype-refine).
    "prototype-card": {
      w: number;
      h: number;
      title: string;
      html: string;
      status: "generating" | "ready" | "error";
      version: number;
      specJson: string;
    };
    // T2 — multi-file React prototype rendered in Sandpack (claude-artifact-
    // runner template). Distinct from prototype-card (T0/T1, HTML) because the
    // runtime + sanitizer + state shape (files map vs html string) all differ.
    // See sandpack-template.ts for boot files; sanitize-react-t2.ts for the
    // import allowlist + banned-API rules.
    "prototype-react": {
      w: number;
      h: number;
      title: string;
      entry: string;
      files: Record<string, string>;
      status: "generating" | "ready" | "error";
      errorReason: string | null;
      version: number;
      specJson: string | null;
    };
    // Objective board — Prompt Sharpening Card (the first intake
    // intelligence object). Collapsed: distilled title + sharpened prompt +
    // top ambiguity chips. Expanded: the 10-zone ambiguity heatmap +
    // Explore/Distill. Forking an ambiguity spawns an insight-card.
    "prompt-sharpening": {
      w: number;
      h: number;
      expanded: boolean;
      spaceId: string;
      title: string;
      sharpenedPrompt: string;
      chips: string[];
      heatmapJson: string;
      rankedJson: string;
      color: string;
    };
    // Forked-out square card showing the 10-zone ambiguity heatmap as its own
    // surface. Each zone is tap-to-fork (insight-card) — the bezier overlay
    // routes the fork from this card back to its source sharpening card.
    "ambiguity-heatmap-card": {
      w: number;
      h: number;
      sourceId: string;
      spaceId: string;
      heatmapJson: string;
      color: string;
    };
    // Forked-out card mirroring the "Optimize for" salience priority map.
    // Each row tap-to-fork; lineage drawn back to the source sharpening card.
    "priority-map-card": {
      w: number;
      h: number;
      sourceId: string;
      spaceId: string;
      salienceJson: string;
      color: string;
    };
    // Objective board — downstream decomposition card (Feature / Variable).
    // The face shows only the AI-refined name + description/definition; the
    // metadata library + knowledge graph live behind a double-click
    // (objective-board:open-card-detail). `objectId` is the backing
    // library_objects row; `metaCount` drives the footer.
    "oc-card": {
      w: number;
      h: number;
      kind: "feature" | "variable";
      name: string;
      body: string;
      objectId: string;
      metaCount: number;
    };
    // Objective board — analyzed pasted image. Renders the stored image +
    // a green "analyzed" light, expandable to the AI description + entities.
    "objective-image-card": {
      w: number;
      h: number;
      expanded: boolean;
      imageFileId: string;
      imageName: string;
      imageUrl: string;
      description: string;
      entityCount: number;
      entitiesJson: string;
      color: string;
      objectId: string;
    };
    // Whiteboard-native intake — the chatbox AS a card (live textarea). On
    // submit it transforms in place into an objective-card.
    "chatbox-card": {
      w: number;
      h: number;
      spaceId: string;
      seedText: string;
      color: string;
    };
    // The objective on the board (its own card type, replaces the reused
    // room-card "__obj"). Heart favorites it (meta.favorited); press opens it.
    "objective-card": {
      w: number;
      h: number;
      spaceId: string;
      title: string;
      objective: string;
      color: string;
    };
    // Voice journal — a spoken entry committed to the board (profile +
    // transcript). The durable note; the board snapshot is its store.
    "voice-note-card": {
      w: number;
      h: number;
      voiceNoteId: string;
      spaceId: string;
      authorName: string;
      transcript: string;
      createdAtIso: string;
      /** Length of the recording in ms (0 = unknown). */
      durationMs: number;
      /** AI analysis, JSON-encoded ({ status, points: [{title, subtitle}] }). */
      analysisJson: string;
      /** Expanded → editable transcript + analysis + metadata. */
      expanded: boolean;
      color: string;
    };
    // Voice journal — the synthesized note-page / 3D-booklet artifact that
    // aggregates all voice notes + re-synthesizes as more are added.
    "journal-card": {
      w: number;
      h: number;
      spaceId: string;
      title: string;
      /** synthesized sections, JSON-encoded ([{ heading, body }]). */
      sectionsJson: string;
      pageCount: number;
      status: "fresh" | "regenerating" | "stale";
      open: boolean;
      color: string;
    };
    // Comment — a human annotation tied to the comments DB row. Carries
    // strands to its target shape IDs (drawn by CommentStrandsOverlay).
    "comment-card": {
      w: number;
      h: number;
      commentId: string;
      spaceId: string;
      authorName: string;
      authorAvatarUrl: string;
      body: string;
      targetShapeIds: string[];
      status: "open" | "resolved" | "analyzed";
      createdAtIso: string;
      color: string;
    };
    // Objective board — REAL bound flow connector (the dark flow-builder look):
    // a bezier wire with a circular green-out / pink-in port pair + a green→pink
    // gradient, locked to two cards via fromId/toId. A board reactor keeps its
    // geometry synced to the endpoints so it MOVES with the cards — a true scene
    // shape, NOT an SVG overlay.
    "flow-connector": {
      w: number;
      h: number;
      fromId: string;
      toId: string;
      color: string;
    };
    // Merged "AI resolve" action pill below the heatmap + priority fork.
    "resolve-pill": {
      w: number;
      h: number;
      spaceId: string;
      sourceIds: string;
      color: string;
    };
  }
}

// Ensure module is treated as a module
export {};
