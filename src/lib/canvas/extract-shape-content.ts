// ── Unified shape-content extractor ───────────────────────────────────
//
// Used by lasso-driven actions (Summarize, Systemize, etc.) to turn a
// tldraw selection into structured items the backend can feed an LLM.
// Each registered shape type contributes:
//   - oneLiner: a tight, LLM-friendly description
//   - content:  the full semantic props (text, ids, counts, etc.)
//   - backendId/backendKind: link back to the canonical record if any
//
// Shapes not in the registry get a generic fallback (still safe to
// summarize — just less specific). This is the single seam where new
// shape types announce themselves to AI features. Adding a new shape
// type? Add an entry below.

import type { TLShape } from "tldraw";

export interface ExtractedItem {
  /** tldraw shape id — stable across the editor session */
  shapeId: string;
  /** Shape type discriminator (e.g. "kg-node", "sticky-note") */
  shapeType: string;
  /** Backend record id if any (entityId, snapshotId, appId, ...) */
  backendId: string | null;
  /** Backend kind label ("entity", "strategy", "app", ...) — null for ephemeral shapes */
  backendKind: string | null;
  /** Short LLM-friendly one-liner describing the shape */
  oneLiner: string;
  /** Full semantic content for deep summarization (JSON-serializable) */
  content: Record<string, unknown>;
  /** Bounding box in page coordinates — used by callers for arrow routing & summary placement */
  bounds: { x: number; y: number; w: number; h: number };
}

export interface ExtractedSelection {
  items: ExtractedItem[];
  /** Count of items by shape type */
  counts: Record<string, number>;
  /** True when the selection has at least one item with extractable content */
  summarizable: boolean;
  /** Backend ids grouped by kind — handy for downstream features that
   *  want to call e.g. "decompose all entities" on the result. */
  backendIdsByKind: Record<string, string[]>;
  /** Selection bounding box (page coords) — the box around all items */
  selectionBounds: { x: number; y: number; w: number; h: number } | null;
}

// ── Per-shape extractors ──────────────────────────────────────────────
//
// Each function receives the shape's props and must return a pick of
// the ExtractedItem fields that aren't bookkeeping. We don't reach into
// tldraw shape types directly — props are typed `unknown` and the
// extractors do their own narrowing. This keeps the file independent
// of the tldraw type imports that would otherwise pull in 40 shape
// type modules.

type PerShapePick = Omit<ExtractedItem, "shapeId" | "shapeType" | "bounds">;

type Props = Record<string, unknown>;

function s(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return fallback;
}

function n(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pct(v: unknown): string {
  const num = n(v);
  if (num == null) return "—";
  // Auto-detect 0–1 vs 0–100
  return num <= 1 && num >= 0
    ? `${Math.round(num * 100)}%`
    : `${Math.round(num)}%`;
}

const EXTRACTORS: Record<string, (props: Props) => PerShapePick> = {
  // ── Graph nodes ─────────────────────────────────────────────────────
  "kg-node": (p) => ({
    backendId: s(p.entityId) || null,
    backendKind: "entity",
    oneLiner: `Entity '${s(p.name, "Unnamed")}' (tier ${s(p.tier, "?")}): ${s(p.description, "no description")}`.slice(0, 240),
    content: {
      name: s(p.name),
      tier: s(p.tier),
      category: s(p.category),
      description: s(p.description),
      entityId: s(p.entityId),
    },
  }),

  // ── Sticky / freeform thinking ──────────────────────────────────────
  "sticky-note": (p) => ({
    backendId: s(p.entityId) || null,
    backendKind: s(p.entityId) ? "entity" : null,
    oneLiner: `Sticky [${s(p.dimension, "note")}]: ${s(p.text, "(empty)")}`.slice(0, 240),
    content: {
      text: s(p.text),
      dimension: s(p.dimension),
      color: s(p.color),
      aiTagged: p.aiTagged === true,
    },
  }),

  "thread-note": (p) => ({
    backendId: s(p.threadId) || null,
    backendKind: "thread",
    oneLiner: `Comment @ depth ${s(p.depth, "0")}: ${s(p.text, "(empty)")}`.slice(0, 240),
    content: {
      text: s(p.text),
      threadId: s(p.threadId),
      parentShapeId: s(p.parentShapeId),
      depth: n(p.depth) ?? 0,
    },
  }),

  // ── Synthesis / summary cards ───────────────────────────────────────
  "synthesis-card": (p) => ({
    backendId: null,
    backendKind: null,
    oneLiner: `${s(p.kind, "synthesis")} card '${s(p.title, "")}': ${s(p.body, "")}`.slice(0, 240),
    content: {
      kind: s(p.kind),
      title: s(p.title),
      body: s(p.body),
      sourceEntityIds: Array.isArray(p.sourceEntityIds) ? p.sourceEntityIds : [],
    },
  }),

  "summary-card": (p) => ({
    backendId: s(p.summaryId) || null,
    backendKind: "summary",
    oneLiner: `AI summary '${s(p.title, "")}': ${s(p.body, "").slice(0, 180)}`,
    content: {
      summaryId: s(p.summaryId),
      title: s(p.title),
      body: s(p.body),
      sourceShapeIds: Array.isArray(p.sourceShapeIds) ? p.sourceShapeIds : [],
      sourceCount: n(p.sourceCount) ?? 0,
    },
  }),

  // ── Strategy family ─────────────────────────────────────────────────
  "strategy-card": (p) => ({
    backendId: s(p.snapshotId) || null,
    backendKind: "strategy_snapshot",
    oneLiner: `Strategy v${s(p.version, "?")} (${s(p.status, "?")}): ${s(p.title, "")} — ${s(p.tacticCount, "0")} tactics, ready=${pct(p.readyScore)}`,
    content: {
      snapshotId: s(p.snapshotId),
      version: n(p.version),
      title: s(p.title),
      status: s(p.status),
      readyScore: n(p.readyScore),
      tacticCount: n(p.tacticCount),
      confidence: n(p.confidence),
    },
  }),

  "strategy-hero-card": (p) => ({
    backendId: null,
    backendKind: "strategy_active",
    oneLiner: `Active strategy: ${s(p.activeTitle, "")} (${s(p.activePosture, "?")}, ${pct(p.activeConfidence)} confidence)`,
    content: {
      spaceId: s(p.spaceId),
      title: s(p.activeTitle),
      summary: s(p.activeSummary),
      confidence: n(p.activeConfidence),
      posture: s(p.activePosture),
    },
  }),

  "strategy-alternative-card": (p) => ({
    backendId: null,
    backendKind: "strategy_alternative",
    oneLiner: `Alternative #${s(p.entryRank, "?")} (${s(p.posture, "?")}): ${s(p.title, "")} — ${s(p.summary, "").slice(0, 120)}`,
    content: {
      rank: n(p.entryRank),
      posture: s(p.posture),
      title: s(p.title),
      summary: s(p.summary),
      confidence: n(p.confidence),
      wasPrimary: p.wasPrimary === true,
    },
  }),

  // ── App + downstream cards ──────────────────────────────────────────
  "app-card": (p) => ({
    backendId: s(p.appId) || null,
    backendKind: "app",
    oneLiner: `App '${s(p.name, "")}' (${s(p.appType, "?")}): ${s(p.status, "?")}, health=${pct(p.healthScore)}`,
    content: {
      appId: s(p.appId),
      name: s(p.name),
      appType: s(p.appType),
      status: s(p.status),
      healthScore: n(p.healthScore),
    },
  }),

  "downstream-reality": (p) => ({
    backendId: s(p.appId) || null,
    backendKind: "app",
    oneLiner: `Downstream reality '${s(p.title, "")}' for app — variant×outcome heatmap`,
    content: { appId: s(p.appId), title: s(p.title) },
  }),

  "iv-decomposition": (p) => ({
    backendId: s(p.appId) || null,
    backendKind: "app",
    oneLiner: `IV decomposition '${s(p.title, "")}' for app`,
    content: { appId: s(p.appId), title: s(p.title) },
  }),

  "variant-carousel": (p) => ({
    backendId: s(p.appId) || null,
    backendKind: "app",
    oneLiner: `Variant carousel '${s(p.title, "")}' for app`,
    content: { appId: s(p.appId), title: s(p.title) },
  }),

  "variant-card": (p) => ({
    backendId: s(p.variantId) || null,
    backendKind: "variant",
    oneLiner: `Variant [${s(p.status, "?")}]: ${s(p.label, "")} — ${s(p.summary, "").slice(0, 120)}`,
    content: {
      variantId: s(p.variantId),
      label: s(p.label),
      status: s(p.status),
      summary: s(p.summary),
      aggregateQuality: n(p.aggregateQuality),
      aggregateLift: n(p.aggregateLift),
    },
  }),

  "experiment-design-card": (p) => ({
    backendId: s(p.proposalId) || null,
    backendKind: "experiment",
    oneLiner: `Experiment: ${s(p.hypothesis, "").slice(0, 140)}. IV=${s(p.ivNames, "?")}, DV=${s(p.dvName, "?")}`,
    content: {
      proposalId: s(p.proposalId),
      appId: s(p.appId),
      hypothesis: s(p.hypothesis),
      ivNames: s(p.ivNames),
      dvName: s(p.dvName),
      controlLabel: s(p.controlLabel),
      p50: n(p.p50),
    },
  }),

  // ── Reactions / cycles / bridges / claims / axioms ──────────────────
  "reaction-card": (p) => ({
    backendId: s(p.reactionId) || null,
    backendKind: "reaction",
    oneLiner: `${s(p.name, "Reaction")} (${s(p.reactionType, "?")}): ${pct(p.probability)} prob, ${s(p.entityCount, "0")} participants`,
    content: {
      reactionId: s(p.reactionId),
      name: s(p.name),
      reactionType: s(p.reactionType),
      probability: n(p.probability),
      entityCount: n(p.entityCount),
    },
  }),

  "cycle-loop": (p) => ({
    backendId: s(p.cycleId) || null,
    backendKind: "cycle",
    oneLiner: `${s(p.classification, "Loop")} '${s(p.name, "")}': ${s(p.nodeCount, "?")} nodes`,
    content: {
      cycleId: s(p.cycleId),
      name: s(p.name),
      classification: s(p.classification),
      entityNames: s(p.entityNames),
      nodeCount: n(p.nodeCount),
    },
  }),

  "bridge-link": (p) => ({
    backendId: s(p.bridgeId) || null,
    backendKind: "bridge",
    oneLiner: `Bridge '${s(p.sharedVariable, "")}': ${s(p.sourceLabel, "")} ↔ ${s(p.targetLabel, "")}`,
    content: {
      bridgeId: s(p.bridgeId),
      sharedVariable: s(p.sharedVariable),
      sourceLabel: s(p.sourceLabel),
      targetLabel: s(p.targetLabel),
      couplingStrength: s(p.couplingStrength),
    },
  }),

  "claim-chip": (p) => ({
    backendId: s(p.claimId) || null,
    backendKind: "claim",
    oneLiner: `Claim [${s(p.claimType, "?")}, ${s(p.status, "?")}]: ${s(p.claimText, "")} (${pct(p.confidence)} conf)`,
    content: {
      claimId: s(p.claimId),
      claimText: s(p.claimText),
      claimType: s(p.claimType),
      status: s(p.status),
      confidence: n(p.confidence),
    },
  }),

  "axiom-stone": (p) => ({
    backendId: s(p.axiomId) || null,
    backendKind: "axiom",
    oneLiner: `Axiom [${s(p.loadBearing, "?")}]: ${s(p.claim, "")}. If false → ${s(p.ifFalse, "")}`,
    content: {
      axiomId: s(p.axiomId),
      claim: s(p.claim),
      ifFalse: s(p.ifFalse),
      loadBearing: s(p.loadBearing),
      confidence: n(p.confidence),
    },
  }),

  "convergent-fan": (p) => ({
    backendId: s(p.pointId) || null,
    backendKind: "convergent_point",
    oneLiner: `${s(p.focalName, "")} + ${s(p.interactorNames, "")} → ${s(p.outcome, "")} [${s(p.polarity, "?")}] (${pct(p.probability)})`,
    content: {
      pointId: s(p.pointId),
      focalName: s(p.focalName),
      interactorNames: s(p.interactorNames),
      outcome: s(p.outcome),
      polarity: s(p.polarity),
      probability: n(p.probability),
    },
  }),

  // ── Signals / proposals / sources ───────────────────────────────────
  "signal-flag": (p) => ({
    backendId: s(p.signalId) || null,
    backendKind: "signal",
    oneLiner: `Signal [${s(p.severity, "?")}, ${s(p.status, "?")}]: ${s(p.description, "").slice(0, 160)}`,
    content: {
      signalId: s(p.signalId),
      signalType: s(p.signalType),
      description: s(p.description),
      severity: s(p.severity),
      status: s(p.status),
    },
  }),

  "proposal-snapshot": (p) => ({
    backendId: s(p.proposalId) || null,
    backendKind: "proposal",
    oneLiner: `${s(p.kind, "Proposal")}: ${s(p.title, "")} — ${s(p.headline, "").slice(0, 140)} [p50=${n(p.p50) ?? "?"}]`,
    content: {
      proposalId: s(p.proposalId),
      kind: s(p.kind),
      title: s(p.title),
      headline: s(p.headline),
      targetEntityId: s(p.targetEntityId),
      p50: n(p.p50),
    },
  }),

  "proposal-chain-ribbon": (p) => ({
    backendId: s(p.proposalId) || null,
    backendKind: "proposal_chain",
    oneLiner: `Chain ${s(p.shortId, "?")} (${s(p.kind, "")}): ${s(p.nodeNames, "")} → target, lift=${n(p.lift) ?? "?"}`,
    content: {
      proposalId: s(p.proposalId),
      kind: s(p.kind),
      nodeNames: s(p.nodeNames),
      lift: n(p.lift),
      constraintLabel: s(p.constraintLabel),
    },
  }),

  "source-card": (p) => ({
    backendId: s(p.sourceId) || null,
    backendKind: "source",
    oneLiner: `${s(p.sourceType, "Source")}: ${s(p.title, "")} — ${s(p.snippet, "").slice(0, 160)}`,
    content: {
      sourceId: s(p.sourceId),
      title: s(p.title),
      snippet: s(p.snippet),
      url: s(p.url),
      sourceType: s(p.sourceType),
    },
  }),

  "file-card": (p) => {
    // Two-phase image ingest (2026-05-01): when the file-card is an
    // image AND vision phase 2 has completed, surface the cached
    // description + entity/relationship counts so downstream
    // consumers (LLM summarize) see the rich extraction without
    // re-running vision. Falls back to the OCR/preview text for
    // non-image files or unanalyzed images.
    const visionStatus = s(p.visionStatus, "idle");
    const visionDescription = s(p.visionDescription, "");
    const isImageReady =
      visionStatus === "ready" && visionDescription.length > 0;
    const oneLiner = isImageReady
      ? `Image '${s(p.sourceName, "")}': ${visionDescription}`
      : `File [${s(p.sourceType, "?")}]: ${s(p.sourceName, "")} (${n(p.charCount) ?? 0} chars) — ${s(p.preview, "").slice(0, 120)}`;
    return {
      backendId: s(p.fileId) || null,
      backendKind: "file",
      oneLiner: oneLiner.slice(0, 280),
      content: {
        fileId: s(p.fileId),
        sourceName: s(p.sourceName),
        sourceType: s(p.sourceType),
        mimeType: s(p.mimeType),
        preview: s(p.preview),
        charCount: n(p.charCount),
        // Vision-pass fields — only meaningful when visionStatus is
        // "ready". Empty strings / 0s otherwise.
        visionStatus,
        visionDescription,
        visionEntityCount: n(p.visionEntityCount) ?? 0,
        visionRelationshipCount: n(p.visionRelationshipCount) ?? 0,
      },
    };
  },

  "asset-card": (p) => ({
    backendId: s(p.assetId) || null,
    backendKind: "asset",
    oneLiner: `${s(p.assetClass, "Asset")} '${s(p.sourceName, "")}' (${n(p.charCount) ?? 0} chars): ${s(p.extractionStatus, "?")}`,
    content: {
      assetId: s(p.assetId),
      sourceName: s(p.sourceName),
      assetClass: s(p.assetClass),
      charCount: n(p.charCount),
      extractionStatus: s(p.extractionStatus),
    },
  }),

  // ── Goals / objectives / subjects ───────────────────────────────────
  "objective-tree": (p) => ({
    backendId: s(p.goalId) || null,
    backendKind: "goal",
    oneLiner: `Objective '${s(p.title, "")}' (${s(p.status, "?")}): ${pct(p.progress)} progress, ${s(p.nodeCount, "0")} nodes, depth ${s(p.depth, "0")}`,
    content: {
      goalId: s(p.goalId),
      title: s(p.title),
      status: s(p.status),
      progress: n(p.progress),
      nodeCount: n(p.nodeCount),
      depth: n(p.depth),
    },
  }),

  "subject-card": (p) => ({
    backendId: s(p.subjectId) || null,
    backendKind: "subject",
    oneLiner: `Subject '${s(p.name, "")}' (${s(p.focusKind, "?")}): ${s(p.scopeSummary, "").slice(0, 160)}`,
    content: {
      subjectId: s(p.subjectId),
      name: s(p.name),
      focusKind: s(p.focusKind),
      scopeSummary: s(p.scopeSummary),
      conditionCount: n(p.conditionCount),
    },
  }),

  "twin-snapshot": (p) => ({
    backendId: s(p.spaceId) || null,
    backendKind: "twin",
    oneLiner: `Twin of '${s(p.spaceName, "")}': ${s(p.healthLabel, "?")} (${s(p.healthScore, "?")}/100), ${s(p.cyclesCount, "0")} cycles`,
    content: {
      spaceId: s(p.spaceId),
      spaceName: s(p.spaceName),
      healthScore: n(p.healthScore),
      healthLabel: s(p.healthLabel),
      maturity: s(p.maturity),
      cyclesCount: n(p.cyclesCount),
    },
  }),

  // ── Meta / orchestration ────────────────────────────────────────────
  "stage-node": (p) => ({
    backendId: s(p.entityId) || null,
    backendKind: "stage",
    oneLiner: `Stage ${s(p.stageIndex, "?")}: ${s(p.kind, "?")} '${s(p.title, "")}' — ${s(p.valueLabel, "")}`,
    content: {
      stageIndex: n(p.stageIndex),
      kind: s(p.kind),
      title: s(p.title),
      valueLabel: s(p.valueLabel),
      chainName: s(p.chainName),
    },
  }),

  "taxonomy-card": (p) => ({
    backendId: s(p.taxonomyId) || null,
    backendKind: "taxonomy",
    oneLiner: `${s(p.domainKey, "?")} taxonomy: artifact='${s(p.artifactNoun, "")}', variant='${s(p.variantNoun, "")}' (conf ${pct(p.confidence)})`,
    content: {
      taxonomyId: s(p.taxonomyId),
      domainKey: s(p.domainKey),
      artifactNoun: s(p.artifactNoun),
      variantNoun: s(p.variantNoun),
      confidence: n(p.confidence),
    },
  }),

  "situation-card": (p) => ({
    backendId: s(p.spaceId) || null,
    backendKind: "situation",
    oneLiner: `Situation: uncertainty=${pct(p.uncertaintyScore)}, ${s(p.inputsCount, "0")} inputs, ${s(p.processStepsCount, "0")} steps, ${s(p.outputsCurrentCount, "0")}/${s(p.outputsTargetCount, "0")} outputs`,
    content: {
      uncertaintyScore: n(p.uncertaintyScore),
      inputsCount: n(p.inputsCount),
      processStepsCount: n(p.processStepsCount),
      outputsCurrentCount: n(p.outputsCurrentCount),
      outputsTargetCount: n(p.outputsTargetCount),
    },
  }),

  "synthesis-intersection-card": (p) => {
    let rowCount = 0;
    let entityIds: string[] = [];
    try {
      const parsed = JSON.parse(s(p.rowsJson, "[]"));
      if (Array.isArray(parsed)) {
        rowCount = parsed.length;
        entityIds = parsed
          .map((r: { entityId?: unknown }) => (typeof r?.entityId === "string" ? r.entityId : null))
          .filter((id): id is string => !!id);
      }
    } catch {
      /* skip */
    }
    return {
      backendId: null,
      backendKind: "synthesis",
      oneLiner: `Synthesis intersection '${s(p.title, "")}': ${rowCount} rows × ${s(p.totalAxes, "0")} axes (${s(p.appsProposedCount, "0")} apps proposed)`,
      content: {
        title: s(p.title),
        totalAxes: n(p.totalAxes),
        rowCount,
        entityIds,
        appsProposedCount: n(p.appsProposedCount),
      },
    };
  },

  "probability-space-shell": (p) => {
    let entityCount = 0;
    let entityIds: string[] = [];
    try {
      const parsed = JSON.parse(s(p.entitiesJson, "[]"));
      if (Array.isArray(parsed)) {
        entityCount = parsed.length;
        entityIds = parsed
          .map((e: { entityId?: unknown }) => (typeof e?.entityId === "string" ? e.entityId : null))
          .filter((id): id is string => !!id);
      }
    } catch {
      /* skip */
    }
    return {
      backendId: null,
      backendKind: "probability_space",
      oneLiner: `Probability axis '${s(p.axis, "")}': ${s(p.label, "")}, ${entityCount} entities, score=${n(p.scoreJson) ?? "?"}`,
      content: {
        axis: s(p.axis),
        label: s(p.label),
        entityCount,
        entityIds,
      },
    };
  },

  "kg-formation": (p) => ({
    backendId: null,
    backendKind: "kg_snapshot",
    oneLiner: `KG live snapshot: ${s(p.entityCount, "0")} entities, ${s(p.edgeCount, "0")} edges`,
    content: {
      entityCount: n(p.entityCount),
      edgeCount: n(p.edgeCount),
    },
  }),

  "kg-overview-card": (p) => ({
    backendId: s(p.spaceId) || null,
    backendKind: "kg_overview",
    oneLiner: `KG overview '${s(p.title, "")}': ${s(p.entityCount, "0")} entities, ${s(p.edgeCount, "0")} edges`,
    content: {
      title: s(p.title),
      entityCount: n(p.entityCount),
      edgeCount: n(p.edgeCount),
    },
  }),

  "root-cause-tree": (p) => ({
    backendId: null,
    backendKind: "root_cause_tree",
    oneLiner: `Root-cause tree '${s(p.title, "")}': ${s(p.reachableCount, "0")} reachable, ${s(p.convergencePoints, "0")} convergence points`,
    content: {
      title: s(p.title),
      goalNames: s(p.goalNames),
      reachableCount: n(p.reachableCount),
      convergencePoints: n(p.convergencePoints),
    },
  }),

  "thread-snapshot": (p) => ({
    backendId: s(p.threadId) || null,
    backendKind: "thread",
    oneLiner: `Thread on ${s(p.rootShapeId, "?")}: '${s(p.rootContent, "").slice(0, 140)}' (${s(p.replyCount, "0")} replies)`,
    content: {
      threadId: s(p.threadId),
      rootContent: s(p.rootContent),
      replyCount: n(p.replyCount),
      latestReply: s(p.latestReply),
    },
  }),

  "cluster-frame": (p) => ({
    backendId: null,
    backendKind: "cluster",
    oneLiner: `Cluster '${s(p.title, "")}'${p.collapsed ? " (collapsed)" : ""}`,
    content: {
      title: s(p.title),
      collapsed: p.collapsed === true,
      childCount: Array.isArray(p.childShapeIds) ? p.childShapeIds.length : 0,
    },
  }),

  "origin-prompt": (p) => ({
    backendId: null,
    backendKind: "prompt",
    oneLiner: `User prompt: ${s(p.promptText, "(empty)").slice(0, 200)}`,
    content: { promptText: s(p.promptText) },
  }),
};

// Shapes that exist on the canvas but carry no actionable semantic
// content for an LLM (decorative / spatial-only). We still include them
// in the items array with a generic one-liner so the count is right,
// but the caller can choose to filter by `backendKind != null` if they
// want only actionable items.
const DECORATIVE_TYPES = new Set<string>(["room"]);

// ── Generic fallback ──
//
// Used for tldraw built-ins (geo, arrow, text, draw, line) and any new
// custom shape type that hasn't been registered above. Tries to surface
// any obvious text/title/label prop so it isn't an opaque "<shape>".
function genericExtract(type: string, props: Props): PerShapePick {
  const candidate =
    s(props.text) ||
    s(props.title) ||
    s(props.label) ||
    s(props.name) ||
    s(props.body) ||
    s(props.summary) ||
    "";
  const trimmed = candidate.length > 200 ? `${candidate.slice(0, 197)}…` : candidate;
  return {
    backendId: null,
    backendKind: null,
    oneLiner: trimmed ? `${type}: ${trimmed}` : `${type} shape (no extractable content)`,
    content: trimmed ? { text: trimmed, type } : { type },
  };
}

// ── Public API ─────────────────────────────────────────────────────────

interface ShapeLike {
  id: string;
  type: string;
  x: number;
  y: number;
  props: Props;
}

function shapeBounds(shape: ShapeLike): ExtractedItem["bounds"] {
  const w = n(shape.props.w) ?? 200;
  const h = n(shape.props.h) ?? 120;
  return { x: shape.x, y: shape.y, w, h };
}

export function extractShapeContent(
  shapes: ReadonlyArray<TLShape>,
): ExtractedSelection {
  const items: ExtractedItem[] = [];
  const counts: Record<string, number> = {};
  const backendIdsByKind: Record<string, string[]> = {};
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const raw of shapes) {
    const shape = raw as unknown as ShapeLike;
    const type = shape.type;
    counts[type] = (counts[type] ?? 0) + 1;
    if (DECORATIVE_TYPES.has(type)) continue; // record count but skip extraction

    const extractor = EXTRACTORS[type];
    const pick = extractor
      ? extractor(shape.props ?? {})
      : genericExtract(type, shape.props ?? {});
    const bounds = shapeBounds(shape);
    items.push({
      shapeId: shape.id,
      shapeType: type,
      bounds,
      ...pick,
    });

    if (pick.backendId && pick.backendKind) {
      const list = backendIdsByKind[pick.backendKind] ?? [];
      if (!list.includes(pick.backendId)) list.push(pick.backendId);
      backendIdsByKind[pick.backendKind] = list;
    }

    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
  }

  const selectionBounds =
    items.length > 0 && Number.isFinite(minX)
      ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
      : null;

  // Summarizable means the selection has at least one item with either
  // a backend kind or a non-empty oneLiner text payload. Pure decoration
  // doesn't qualify.
  const summarizable = items.some(
    (i) => i.backendKind != null || (i.oneLiner && i.oneLiner.length > 8),
  );

  return {
    items,
    counts,
    summarizable,
    backendIdsByKind,
    selectionBounds,
  };
}

// ── Helpers for callers ───────────────────────────────────────────────

/** Build a short label like "5 entities + 2 strategies" for UI chips. */
export function describeSelection(sel: ExtractedSelection): string {
  const parts: string[] = [];
  const grouped: Record<string, number> = {};
  for (const item of sel.items) {
    const key = item.backendKind ?? item.shapeType;
    grouped[key] = (grouped[key] ?? 0) + 1;
  }
  for (const [k, c] of Object.entries(grouped)) {
    parts.push(`${c} ${k}${c === 1 ? "" : "s"}`);
  }
  return parts.length ? parts.join(" + ") : `${sel.items.length} items`;
}
