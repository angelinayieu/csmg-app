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
      pulse: number;
      accent: string;
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
    };
  }
}

// Ensure module is treated as a module
export {};
