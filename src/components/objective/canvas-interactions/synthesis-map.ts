// ── Deep Synthesize → fork an idea-map onto the board ──
//
// Takes the structured result of `/api/objective/[spaceId]/deep-synthesize`
// (a central insight + several web-grounded cross-links) and materializes it
// as a small MAP next to the user's selection: one `hub` insight-card, a fan
// of `branch` insight-cards (each carrying its web citations), and dashed
// arrows — hub → each branch, and each branch → the exact source shapes it
// draws on (the cross-links). Every node + arrow is tagged `meta.mapId =
// hubId` so the hub's Keep/Dismiss curates the whole cluster as one decision
// (see insight-card-shape.tsx). Models on `createInsightWithLinks` in
// whiteboard-base — same arrow/binding recipe, just a cluster instead of one.

import {
  createShapeId,
  type Editor,
  type TLArrowShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import type {
  InsightCardShape,
  InsightCitation,
} from "../shapes/insight-card-shape";

export interface SynthesisBranch {
  headline: string;
  body: string;
  /** 1-based indices into the numbered selection this branch draws on. */
  sourceRefs: number[];
  citations: InsightCitation[];
  /** Slug of the optimization factor this branch advances ("general" if
   *  the model couldn't tie it to a specific factor). Renders as the
   *  card's trace-back chip (v1 frame, and v2 fallback chip). */
  addressesFactor?: string;
  /** v2 — slug of the focus-card micro-objective this branch advances.
   *  When present, the micro chip is the PRIMARY trace-back (renders
   *  above the factor chip); factor becomes the ladder-under subchip. */
  addressesMicro?: string;
  /** v2 — ≤ 12-word first-principle the cross-link rests on. Italic
   *  line above the body. Optional; v1 + Connect output omit it. */
  principle?: string;
  /** v2 — 0..1 model confidence. Branches < 0.55 render at reduced
   *  opacity so a scan separates load-bearing from speculative. */
  confidence?: number;
}

export interface SynthesisMap {
  hub: {
    headline: string;
    body: string;
    /** Slug of the dominant factor the throughline most serves. */
    dominantFactor?: string;
    /** v2 — slug of the focus-card micro the throughline most advances. */
    dominantMicro?: string;
  };
  branches: SynthesisBranch[];
}

/** Server-supplied index keyed by factor slug → { label, kind }. Used to
 *  render the trace-back chip without re-reading prompt_sharpening on the
 *  client. Includes "general" as a passthrough. */
export type FactorIndex = Record<string, { label: string; kind: string }>;

/** v2 — server-supplied index keyed by micro-objective slug. `laddersTo`
 *  holds the factor slugs the micro inherits — the client resolves each
 *  to a label via the FactorIndex for the ghost ladder subchip. */
export type MicroIndex = Record<
  string,
  { label: string; laddersTo: string[]; confidence: number }
>;

const HUB_W = 264;
const HUB_H = 156;
const BRANCH_W = 230;
const BRANCH_H = 156;
const MAX_BRANCHES = 6;

/** Dashed, headless tether between two shapes, tagged into the map so the
 *  hub can solidify (Keep) or delete (Dismiss) the whole cluster at once. */
function tether(
  editor: Editor,
  fromId: TLShapeId,
  toId: TLShapeId,
  mapId: string,
): void {
  const arrowId = createShapeId();
  const arrow: TLShapePartial<TLArrowShape> = {
    id: arrowId,
    type: "arrow",
    props: { color: "grey", size: "s", dash: "dashed", arrowheadEnd: "none" },
    meta: { mapId, proposalFor: mapId },
  };
  editor.createShapes([arrow]);
  editor.createBindings([
    {
      fromId: arrowId,
      toId: fromId,
      type: "arrow",
      props: {
        terminal: "start",
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false,
        isPrecise: false,
      },
      meta: {},
    },
    {
      fromId: arrowId,
      toId: toId,
      type: "arrow",
      props: {
        terminal: "end",
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false,
        isPrecise: false,
      },
      meta: {},
    },
  ]);
}

/** Resolve a factor slug → display label via the server's factor index.
 *  Falls back to a title-cased slug for legacy responses that predate the
 *  factor wiring (so old maps still render something sensible). */
function factorLabelOf(
  slug: string | undefined,
  factorIndex: FactorIndex | undefined,
): string {
  if (!slug) return "";
  const hit = factorIndex?.[slug];
  if (hit?.label) return hit.label;
  if (slug === "general") return "General";
  return slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** v2 — resolve a micro-objective slug → display label + the labels of
 *  the factors it ladders into. Empty slug returns blanks. */
function microResolve(
  slug: string | undefined,
  microIndex: MicroIndex | undefined,
  factorIndex: FactorIndex | undefined,
): { label: string; laddersToSlugs: string[]; laddersToLabels: string[] } {
  if (!slug) return { label: "", laddersToSlugs: [], laddersToLabels: [] };
  const hit = microIndex?.[slug];
  if (!hit) return { label: "", laddersToSlugs: [], laddersToLabels: [] };
  return {
    label: hit.label,
    laddersToSlugs: hit.laddersTo,
    laddersToLabels: hit.laddersTo
      .map((fs) => factorLabelOf(fs, factorIndex))
      .filter(Boolean),
  };
}

/** Render a Deep Synthesize result as a proposed map beside the selection.
 *  Soft: silently no-ops on an empty map. */
export function forkSynthesisMap(
  editor: Editor,
  opts: {
    map: SynthesisMap;
    /** Ordered source shape ids = the numbered selection sent to the LLM. */
    sourceIds: TLShapeId[];
    color: string;
    /** Server-supplied { slug → label } so the trace-back chip can render
     *  the readable factor name. Optional for back-compat. */
    factorIndex?: FactorIndex;
    /** library_objects ids returned by the route — `hub` is the hub's id,
     *  `branches[i]` matches `map.branches[i]`. Stamped onto each shape's
     *  `objectId` prop so click opens the object-detail drawer. Soft: any
     *  null id (write failed) leaves that shape un-promoted (no drawer on
     *  click). Optional for back-compat. */
    objectIds?: { hub: string | null; branches: (string | null)[] };
    /** v2 — server-supplied { slug → { label, laddersTo[], confidence } }
     *  so the client renders the micro chip + ladder subchip without
     *  re-fetching the focus card's rubric. Optional: when absent, the
     *  v1 factor chip is the only trace-back. */
    microIndex?: MicroIndex;
    /** v2 — tldraw shape id of the focus card the synth was framed around.
     *  Stamped onto each shape's `focusCardId` prop for back-link UX. */
    focusCardId?: string;
  },
): void {
  const branches = (opts.map.branches ?? [])
    .filter((b) => b && (b.headline || b.body))
    .slice(0, MAX_BRANCHES);
  if (!opts.map.hub?.headline && branches.length === 0) return;

  // Bounding box of the (still-present) sources → place the map to their
  // right so it fans out without overlapping the originals.
  const sourceBounds = opts.sourceIds
    .map((id) => editor.getShapePageBounds(id))
    .filter((b): b is NonNullable<typeof b> => !!b);

  let selMidX: number;
  let selMidY: number;
  let selMaxX: number;
  if (sourceBounds.length > 0) {
    selMidY =
      sourceBounds.reduce((a, b) => a + b.midY, 0) / sourceBounds.length;
    selMidX =
      sourceBounds.reduce((a, b) => a + b.midX, 0) / sourceBounds.length;
    selMaxX = Math.max(...sourceBounds.map((b) => b.maxX));
  } else {
    const vp = editor.getViewportPageBounds();
    selMidX = vp.center.x;
    selMidY = vp.center.y;
    selMaxX = vp.center.x;
  }

  const hubCx = selMaxX + 340;
  const hubCy = selMidY;
  const radius = Math.max(220, 78 * branches.length);

  const hubId = createShapeId();
  const hubFactorSlug = opts.map.hub?.dominantFactor ?? "";
  const hubFactorLabel = factorLabelOf(hubFactorSlug, opts.factorIndex);
  const hubMicroSlug = opts.map.hub?.dominantMicro ?? "";
  const hubMicro = microResolve(hubMicroSlug, opts.microIndex, opts.factorIndex);
  editor.createShape<InsightCardShape>({
    id: hubId,
    type: "insight-card",
    x: hubCx - HUB_W / 2,
    y: hubCy - HUB_H / 2,
    props: {
      w: HUB_W,
      h: HUB_H,
      status: "proposed",
      kind: "synthesize",
      role: "hub",
      headline: opts.map.hub?.headline || "Synthesis",
      body: opts.map.hub?.body || "",
      color: opts.color,
      sourceIds: opts.sourceIds as string[],
      citations: [],
      factorSlug: hubFactorSlug,
      factorLabel: hubFactorLabel,
      objectId: opts.objectIds?.hub ?? "",
      microSlug: hubMicroSlug,
      microLabel: hubMicro.label,
      laddersToFactorSlugs: hubMicro.laddersToSlugs,
      laddersToFactorLabels: hubMicro.laddersToLabels,
      principle: "",
      // Hub confidence — left unset; the hub is always shown at full
      // opacity because it's the throughline (per-branch confidence
      // does the visual sorting for the slate underneath it).
      confidence: -1,
      focusCardId: opts.focusCardId ?? "",
    },
    // The hub tags itself so the cascade Keep/Dismiss includes it.
    meta: { mapId: hubId },
  });

  // Collect for the cluster-generated signal — the overlay needs every shape
  // id (to compute screen bounds for placement) and every objectId (to read
  // factor/role from library_objects when scoring recommendations).
  const branchShapeIds: TLShapeId[] = [];
  const branchObjectIds: string[] = [];
  const branchFactorSlugs: string[] = [];

  branches.forEach((b, i) => {
    // Right-hand arc from -68° to +68°; a lone branch sits straight out.
    const total = branches.length;
    const deg = total === 1 ? 0 : -68 + (136 * i) / (total - 1);
    const rad = (deg * Math.PI) / 180;
    const bx = hubCx + radius * Math.cos(rad);
    const by = hubCy + radius * Math.sin(rad);

    // Resolve 1-based refs → live source shape ids (skip any since deleted).
    const refIds = (b.sourceRefs ?? [])
      .map((r) => opts.sourceIds[r - 1])
      .filter((id): id is TLShapeId => !!id && !!editor.getShape(id));

    const branchId = createShapeId();
    const branchFactorSlug = b.addressesFactor ?? "";
    const branchFactorLabel = factorLabelOf(branchFactorSlug, opts.factorIndex);
    const branchMicroSlug = b.addressesMicro ?? "";
    const branchMicro = microResolve(
      branchMicroSlug,
      opts.microIndex,
      opts.factorIndex,
    );
    editor.createShape<InsightCardShape>({
      id: branchId,
      type: "insight-card",
      x: bx - BRANCH_W / 2,
      y: by - BRANCH_H / 2,
      props: {
        w: BRANCH_W,
        h: BRANCH_H,
        status: "proposed",
        kind: "synthesize",
        role: "branch",
        headline: b.headline || "Insight",
        body: b.body || "",
        color: opts.color,
        sourceIds: refIds as string[],
        citations: (b.citations ?? [])
          .filter((c) => c && c.url)
          .slice(0, 3)
          .map((c) => ({ title: c.title ?? "", url: c.url })),
        factorSlug: branchFactorSlug,
        factorLabel: branchFactorLabel,
        objectId: opts.objectIds?.branches?.[i] ?? "",
        microSlug: branchMicroSlug,
        microLabel: branchMicro.label,
        laddersToFactorSlugs: branchMicro.laddersToSlugs,
        laddersToFactorLabels: branchMicro.laddersToLabels,
        principle: b.principle ?? "",
        // -1 sentinel = unset (legacy / v1 frame). Renderer skips opacity
        // treatment unless confidence is a real 0..1 value.
        confidence:
          typeof b.confidence === "number" &&
          Number.isFinite(b.confidence) &&
          b.confidence >= 0 &&
          b.confidence <= 1
            ? b.confidence
            : -1,
        focusCardId: opts.focusCardId ?? "",
      },
      meta: { mapId: hubId },
    });

    // hub → branch (membership), then branch → each source (the cross-links).
    tether(editor, hubId, branchId, hubId);
    for (const sid of refIds) tether(editor, branchId, sid, hubId);

    branchShapeIds.push(branchId);
    const oid = opts.objectIds?.branches?.[i];
    if (oid) branchObjectIds.push(oid);
    if (branchFactorSlug) branchFactorSlugs.push(branchFactorSlug);
  });

  editor.select(hubId);
  editor.centerOnPoint(
    { x: (selMidX + hubCx) / 2, y: hubCy },
    { animation: { duration: 320 } },
  );

  // ── Cluster-generated signal — the "now what?" trigger ──
  // After the map lands, broadcast it so the recommendations overlay can pop
  // a translucent hover ("Converge to spec", "Decompose strongest branch",
  // …) anchored to the cluster's bounds. The overlay reads the cluster's
  // library_objects + uncovered salience factors to rank the moves. Soft —
  // only fire when we have at least the hub object id; without it, the
  // recommender can't read the cluster's factor coverage and would degrade
  // to generic advice. Listener: cluster-recommendations-overlay.tsx.
  if (
    typeof window !== "undefined" &&
    opts.objectIds?.hub &&
    branchObjectIds.length > 0
  ) {
    window.dispatchEvent(
      new CustomEvent(CLUSTER_GENERATED_EVENT, {
        detail: {
          kind: "synthesis",
          hubShapeId: hubId as string,
          branchShapeIds: branchShapeIds as string[],
          hubObjectId: opts.objectIds.hub,
          branchObjectIds,
          factorSlugs: Array.from(new Set(branchFactorSlugs)),
          color: opts.color,
        } as ClusterGeneratedDetail,
      }),
    );
  }
}

/** Event name for "a new generated cluster just landed on the board". The
 *  recommender overlay (cluster-recommendations-overlay.tsx) listens; the
 *  payload carries the shape ids (for bounds) + object ids (for factor
 *  coverage lookup) + the cluster kind so a follow-up consumer can branch
 *  on synthesis vs decompose vs make_plan output. */
export const CLUSTER_GENERATED_EVENT =
  "objective-board:cluster-generated" as const;

export interface ClusterGeneratedDetail {
  /** What produced the cluster — drives recommendation framing. */
  kind: "synthesis" | "decompose" | "make_plan" | "variations";
  /** The hub / source shape id (synthesis hub, decompose source card, …).
   *  Overlay uses this as the natural anchor for placement and as the
   *  default selection target when the user picks a recommended op. */
  hubShapeId: string;
  /** Every other shape in the cluster — used to compute screen bounds. */
  branchShapeIds: string[];
  /** library_objects.id for the hub. Required: without it the recommender
   *  can't read the cluster's content + factor coverage. */
  hubObjectId: string;
  /** library_objects.id for every branch. Filtered to non-null at emit. */
  branchObjectIds: string[];
  /** Unique factor slugs the cluster covers (drives gap analysis on the
   *  recommender — which intake factors are STILL uncovered). */
  factorSlugs: string[];
  /** Accent color of the originating cluster — overlay matches it so the
   *  hover reads as a sibling, not a foreign chrome. */
  color: string;
}
