"use client";

// ── Sub-Objective Room View (v2) ──
//
// Renders the 4 lanes (Pain → Features → Outcomes → Objective)
// using the new causal-chain card components. Adds:
//
//   • Shared-cause pill strip above the Pain lane (with count badges)
//   • Influence-rank sort + Root ⭐ badge on the top pain
//   • Keystone badge on the feature countering the most pains
//   • Inline expand-on-click cards with root causes / first principles
//   • Cross-lane cause↔pain highlight when hovering a shared pill
//
// Correlation side panel still lives on the right; edges feed
// the "addressed by" / "counters pains" lists inside expanded cards.

import { useRouter } from "next/navigation";
import { ProblemResultReview } from "./problem-result-review";
import { useBackgroundDeepen } from "./use-background-deepen";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { deployArtifactCard } from "@/components/objective/board-bus";
import {
  consumePendingCardFocus,
  onCardFocus,
  type CardFocusRequest,
} from "@/lib/objective-canvas/notebook-focus";
import { CorrelationSidePanel } from "./correlation-side-panel";
import { PainCard, type PainCardItem } from "./cards/pain-card";
import { FeatureCard, type FeatureCardItem } from "./cards/feature-card";
import { OutcomeCard, type OutcomeCardItem } from "./cards/outcome-card";
import {
  ItemDetailDrawer,
  type LinkedChainRef,
} from "./item-detail-drawer";
import { ResearchSourcesSheet } from "./research-sources-sheet";
import { SharedCausesStrip } from "./cards/shared-causes-strip";
import { PortfolioStrip } from "./cards/portfolio-strip";
import { AnnotationLensStrip } from "./cards/annotation-lens-strip";
import { BrainstormPanel } from "./brainstorm/brainstorm-panel";
import { ConstraintsStrip } from "./cards/constraints-strip";
import { PriorityStrip } from "./cards/priority-strip";
import type { PriorityVector } from "@/lib/objective-canvas/priority-vector";
import { CategoryCardsView } from "./category-cards-view";
import { AutopilotRunner } from "./autopilot-runner";
// Phase 11.0b — LabNotebookPanel is mounted at the layout level
// (app/objective/[spaceId]/layout.tsx) as a persistent right rail.
// The per-room Notebook button + panel mount moved out so the panel
// renders once. Room-scoped events surface there in room mode
// (detected from the URL by the layout).
import { RoomEdgesOverlay } from "./room-edges-overlay";
// Phase 12.A.4 — the room-altitude Causal Loop Diagram. A third room
// view alongside Categories / Variables; reads the same lanes + edges.
import { RoomAltitudeMap } from "./causal-map/altitudes/RoomAltitudeMap";
import { MechanismSubsystemView } from "./mechanism-subsystem-view";
import { buildMechanismSubsystems } from "@/lib/objective-canvas/build-mechanism-subsystems";
// Phase 12.A.8 — remember the room's view choice per sub-objective.
import { useLocalPref } from "./causal-map/hooks/useLocalPref";
import type { OperationalConstraints } from "@/lib/objective-canvas/constraints";
import { computeChains } from "@/lib/objective-canvas/compute-chains";
import {
  normalizeRoomCategories,
  type RoomCategories,
} from "@/lib/objective-canvas/generate-categories";
import type { PipelineMode } from "./mode-pill";
import type { ObjectiveAnnotation } from "./annotated-objective-card";
import { AnnotatedHeading } from "./annotated-heading";

/** Provenance entry persisted on each entity's causal_chain.
 *  Resolved at generation time from the LLM's {index, facet} pairs
 *  into a full record with the verbatim phrase so the UI can render
 *  chips without re-fetching the annotation list. Stays in sync
 *  with AnnotationProvenance in src/lib/objective-canvas/layered-generation.ts. */
export interface ItemAnnotationProvenance {
  index: number;
  phrase: string;
  facet:
    | "fragility"
    | "analogy"
    | "tension"
    | "dimension"
    | "inference"
    | "reading";
}

export interface LayerItem {
  id: string;
  name: string;
  description: string | null;
  entity_type: string;
  /** v2 — pain: { negative_outcome, root_causes[], influence_rank }
   *        feature: { positive_outcome, first_principles[] }
   *        outcome: { measured_by }
   *  Tier 3 — every layer item also carries `sub_category` here
   *  (a slug into room_categories[lane]) when categorization is
   *  enabled for this room.
   *  Falls through to description-only rendering for legacy
   *  entities that pre-date the migration. */
  causal_chain?: Record<string, unknown> | null;
  /** Persisted expanded_detail blob (variations[] + effectiveness
   *  envelope + definition). Only the room loader threads this for
   *  FEATURE items — it hydrates the CategoryCard mechanism lineup so
   *  it renders without a /expand round-trip. Absent for pain/outcome
   *  items (their drawers still lazy-load) to keep the payload lean. */
  expanded_detail?: Record<string, unknown> | null;
}

export interface RoomEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  strength: number | null;
  polarity: string | null;
  conditions: string | null;
  approved_at?: string | null;
  /** LLM-named mechanism (specific lever) lives under
   *  agent_feedback.mechanism. Optional — surfaces in the side
   *  panel as a small pill above the rationale. */
  agent_feedback?: Record<string, unknown> | null;
}

export interface RoomLane {
  slug: "pain" | "features" | "outcomes" | "objective";
  label: string;
  color: string;
  items: LayerItem[];
}

interface Props {
  spaceId: string;
  subObjectiveId: string;
  lanes: RoomLane[];
  edges: RoomEdge[];
  generatedAt: string | null;
  pipelineMode: PipelineMode;
  /** Tier 3 — adaptive sub-categories generated by the pre-room
   *  step. Drives lane card chips, chain archetype labels, and
   *  the portfolio strip. Empty `{}` is tolerated — categories
   *  just won't render. */
  roomCategoriesRaw?: unknown;
  /** Annotation Lens — the parent objective's annotations (weight-
   *  sorted by the generator). Renders the lens header strip and
   *  feeds the hover-to-link interaction between annotation chips
   *  and items derived from them. Empty array hides the strip. */
  annotations?: ObjectiveAnnotation[];
  /** O3 — Cross-room coverage counts (annotation 1-based index →
   *  number of items in SIBLING rooms that derive from it). When
   *  present, the lens strip renders a "+N" subscript next to the
   *  in-room coverage count so the user can see when an annotation
   *  is load-bearing elsewhere even when it looks orphaned here. */
  crossRoomCoverageByIndex?: Record<number, number>;
  /** Phase 5a — operational constraints the user set at intake (or
   *  the inferred set). Rendered as a CONTROL VARIABLES strip above
   *  the lanes so the user always sees which conditions are held
   *  fixed when the R&D engine runs mechanism experiments. Null
   *  hides the strip (no constraints captured yet). */
  constraints?: OperationalConstraints | null;
  /** Per-sub-objective priority vector — soft trade-off weights
   *  (speed / durability / reversibility / certainty / leverage).
   *  Rendered as the Priorities strip just below the constraints
   *  strip. Null = column unset; PriorityStrip auto-infers on mount
   *  via GET /priorities. Distinct semantic role from constraints:
   *  those are hard-fixed gates, these are soft weights. */
  priorityVector?: PriorityVector | null;
  /** Hero prose, relocated from the page header so it shares one
   *  two-column row with the portfolio (left: Definition + The problem +
   *  coverage; right: hypotheses). Plain frameless text — the
   *  title + its inline annotations stay in the header. */
  description?: string | null;
  /** Phase 1 — the sub-objective's own annotations whose offsets fall
   *  within the description text (re-based to description-local by
   *  splitAnnotationsByTitle). Rendered as frameless stage-colored
   *  underlines on the Definition prose with hover-to-reveal readings —
   *  the same annotation engine as the objective title, glossary-
   *  consistent because the glossary is seeded from these readings. */
  descriptionAnnotations?: ObjectiveAnnotation[];
  topNegativeOutcome?: string | null;
}

export function SubObjectiveRoomView({
  spaceId,
  subObjectiveId,
  lanes,
  edges,
  generatedAt,
  pipelineMode,
  roomCategoriesRaw,
  annotations = [],
  crossRoomCoverageByIndex = {},
  constraints = null,
  priorityVector = null,
  description = null,
  descriptionAnnotations = [],
  topNegativeOutcome = null,
}: Props) {
  const roomCategories: RoomCategories = useMemo(
    () => normalizeRoomCategories(roomCategoriesRaw),
    [roomCategoriesRaw],
  );

  /** Resolve sub_category slug → { label, color } for chip rendering. */
  function categoryFor(
    lane: keyof RoomCategories,
    slug: string | null | undefined,
  ): { label: string; color: string } | null {
    if (!slug) return null;
    const hit = roomCategories[lane].find((c) => c.slug === slug);
    return hit ? { label: hit.label, color: hit.color } : null;
  }
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  // Phase 6b — Deepen-lens panel open state. Mounts the BrainstormPanel
  // in annotation mode, which orchestrates a single generateDeepenedAnnotations
  // call and presents the v2 annotations as candidates with elect/refuse.
  const [lensBrainstormOpen, setLensBrainstormOpen] = useState(false);
  const [highlightedCauses, setHighlightedCauses] = useState<Set<string>>(
    new Set(),
  );
  // Hover-to-link: which card is currently hovered (or null). Linked
  // ids are derived from this + the edges map.
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  // Phase 6 — ref for the lanes-grid container. Threaded into the
  // SVG wire overlay so it can query card positions via data-entity-id
  // selectors + observe layout changes via ResizeObserver. The ref
  // must be on the SAME element that hosts the cards as descendants
  // (the grid) so the rect math + selector queries see the right
  // bounding box.
  const lanesContainerRef = useRef<HTMLDivElement | null>(null);
  // Room view mode — read as an altitude ladder, not three peer tabs:
  //   map        → SYSTEM (default). Orient: every stage, item, and
  //                feedback loop in one causal-loop diagram. The
  //                "what am I looking at" surface.
  //   categories → CHAINS. Decide: one (Problem × Mechanism × Result)
  //                experiment frame at a time; approve happens here.
  //   variables  → GRID (escape hatch). The legacy 3-lane layout +
  //                correlation side panel — kept for the data-rigorous
  //                power user, not the default.
  // All three read the same lanes + edges; the toggle only re-groups
  // the rendering. Default to Map so the room opens on the system view
  // (the clearest "these are distinct stages" communication we have).
  const [roomView, setRoomView] = useLocalPref<
    "categories" | "variables" | "map" | "subsystems"
  >(`room:view:${subObjectiveId}`, "map");
  // Phase 9 — Lab Notebook panel open state. The notebook reads the
  // sub_objective_decisions feed for this room and renders the
  // decision timeline (elections / experiments / approvals /
  // compositions). Closed by default; opens via a top-chrome button.
  // Phase 11.0b — notebookOpen removed; layout-level rail owns state.
  // Phase 7c — autopilot refresh signal. Bumped after each
  // chain that autopilot processes so the corresponding CategoryCard
  // re-fetches its expanded_detail and the new candidates show up
  // in the lineup immediately. A single counter is enough because
  // CategoryCards individually decide whether they need to refetch
  // based on their own chain.featureId. (Each card re-fetches on
  // every bump — cheap because the /expand cache returns instantly.)
  const [autopilotRefreshKey, setAutopilotRefreshKey] = useState(0);
  // Layer 2 — currently-open item detail drawer entity id. Null
  // means closed.
  const [detailEntityId, setDetailEntityId] = useState<string | null>(null);
  // Altitude 2 — chain focus token. Set when the user clicks a chain
  // edge on the Map; switches to the Chains view focused on that bet.
  // The nonce lets re-clicking the same chain re-focus it.
  const [chainFocus, setChainFocus] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  // Sources sheet — opened by CitationBadge's "See all sources"
  // footer and any future "Open research" affordances.
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // Annotation Lens hover state — which annotation index (1-based)
  // the user is hovering. When set, every card whose provenance
  // includes this index lights up with a subtle ring; non-matching
  // cards dim. Set via the lens strip + each card's chip strip.
  const [hoveredAnnotationIndex, setHoveredAnnotationIndex] = useState<
    number | null
  >(null);
  const [approvedEdgeIds, setApprovedEdgeIds] = useState<Set<string>>(() => {
    return new Set(
      edges.filter((e) => e.approved_at != null).map((e) => e.id),
    );
  });

  /** Provenance map: entity id → resolved ItemAnnotationProvenance[].
   *  Read from each item's causal_chain.derived_from_annotations
   *  (persisted by the route at generation time). Empty array when
   *  the item pre-dates the lens or no annotations seeded it. */
  const provenanceByItemId = useMemo(() => {
    const map = new Map<string, ItemAnnotationProvenance[]>();
    for (const lane of lanes) {
      for (const item of lane.items) {
        const cc = (item.causal_chain ?? {}) as Record<string, unknown>;
        const raw = cc.derived_from_annotations;
        if (!Array.isArray(raw)) {
          map.set(item.id, []);
          continue;
        }
        const out: ItemAnnotationProvenance[] = [];
        for (const v of raw) {
          if (!v || typeof v !== "object") continue;
          const r = v as Record<string, unknown>;
          const index =
            typeof r.index === "number" && Number.isFinite(r.index)
              ? r.index
              : null;
          const phrase = typeof r.phrase === "string" ? r.phrase : "";
          const facet =
            typeof r.facet === "string"
              ? (r.facet as ItemAnnotationProvenance["facet"])
              : "reading";
          if (index === null || phrase.length === 0) continue;
          out.push({ index, phrase, facet });
        }
        map.set(item.id, out);
      }
    }
    return map;
  }, [lanes]);

  /** Reverse index: annotation index → set of item ids derived from it.
   *  Powers the lens-strip hover → highlight-cards behavior. */
  const itemIdsByAnnotationIndex = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const [itemId, provs] of provenanceByItemId.entries()) {
      for (const p of provs) {
        const set = map.get(p.index) ?? new Set<string>();
        set.add(itemId);
        map.set(p.index, set);
      }
    }
    return map;
  }, [provenanceByItemId]);

  const isEmpty = lanes.every(
    (l) =>
      l.items.length === 0 ||
      (l.items.length === 1 && l.slug === "objective"),
  );

  // ── Index every entity by id so panel hover can map id → layer
  // Tier 3 — also includes the sub_category slug so compute-chains
  // can populate the per-chain category triple → archetype labels.
  const entityIndex = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        layer: "pain" | "features" | "outcomes" | "objective";
        subCategorySlug?: string | null;
      }
    >();
    for (const lane of lanes) {
      for (const item of lane.items) {
        const cc = (item.causal_chain ?? {}) as Record<string, unknown>;
        const slug =
          typeof cc.sub_category === "string" && cc.sub_category.length > 0
            ? cc.sub_category
            : null;
        map.set(item.id, {
          id: item.id,
          name: item.name,
          layer: lane.slug,
          subCategorySlug: slug,
        });
      }
    }
    return map;
  }, [lanes]);

  // Notebook tie-back — open the detail drawer for the card a clicked
  // notebook event produced and scroll its lane card into view. Same-
  // room clicks arrive live via the focus event; a cross-room hand-off
  // is parked by the notebook host and consumed here on mount. We only
  // act on entities that live in THIS room — events with no entity, or
  // whose entity belongs to a sibling room / a higher altitude (e.g. a
  // sub-objective proposal election), simply don't focus a card here.
  useEffect(() => {
    const focus = (req: CardFocusRequest) => {
      const id = req.entityId;
      if (!id || !entityIndex.has(id)) return;
      setDetailEntityId(id);
      // Defer the scroll until the drawer-open re-render settles.
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-entity-id="${CSS.escape(id)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    };
    const parked = consumePendingCardFocus();
    if (parked) focus(parked);
    return onCardFocus(focus);
  }, [entityIndex, subObjectiveId]);

  // ── Derive typed lane items from causal_chain payloads ──
  // Each item's sub_category slug is captured here so the card
  // chip + portfolio strip + chain archetype derivation share one
  // source of truth.
  function readSlug(cc: Record<string, unknown>): string | null {
    return typeof cc.sub_category === "string" && cc.sub_category.length > 0
      ? cc.sub_category
      : null;
  }

  // Read citations[] off causal_chain — populated by Commit 2's
  // room/generate route. Each citation is a resolved source record
  // (title, url, snippet, lens) — not just an index — so the
  // CitationBadge popover renders immediately without extra fetch.
  function readCitations(
    cc: Record<string, unknown>,
  ): Array<{ title: string; url: string; snippet?: string; lens?: string }> {
    if (!Array.isArray(cc.citations)) return [];
    const out: Array<{
      title: string;
      url: string;
      snippet?: string;
      lens?: string;
    }> = [];
    for (const v of cc.citations) {
      if (!v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      const url = typeof r.url === "string" ? r.url : "";
      const title = typeof r.title === "string" ? r.title : url;
      if (url.length === 0) continue;
      out.push({
        title,
        url,
        snippet: typeof r.snippet === "string" ? r.snippet : undefined,
        lens: typeof r.lens === "string" ? r.lens : undefined,
      });
    }
    return out;
  }

  const painItems = useMemo(
    () =>
      lanes
        .find((l) => l.slug === "pain")!
        .items.map((it) => {
          const cc = (it.causal_chain ?? {}) as Record<string, unknown>;
          return {
            id: it.id,
            name: it.name,
            negative_outcome:
              typeof cc.negative_outcome === "string"
                ? cc.negative_outcome
                : it.description ?? undefined,
            root_causes: Array.isArray(cc.root_causes)
              ? (cc.root_causes as unknown[])
                  .filter((s): s is string => typeof s === "string")
                  .slice(0, 4)
              : [],
            influence_rank:
              typeof cc.influence_rank === "number"
                ? cc.influence_rank
                : 2.5,
            sub_category_slug: readSlug(cc),
            citations: readCitations(cc),
          };
        })
        .sort((a, b) => b.influence_rank - a.influence_rank),
    [lanes],
  );

  const featureItems = useMemo(
    () =>
      lanes
        .find((l) => l.slug === "features")!
        .items.map((it) => {
          const cc = (it.causal_chain ?? {}) as Record<string, unknown>;
          return {
            id: it.id,
            name: it.name,
            positive_outcome:
              typeof cc.positive_outcome === "string"
                ? cc.positive_outcome
                : it.description ?? undefined,
            first_principles: Array.isArray(cc.first_principles)
              ? (cc.first_principles as unknown[])
                  .filter((s): s is string => typeof s === "string")
                  .slice(0, 4)
              : [],
            sub_category_slug: readSlug(cc),
            citations: readCitations(cc),
            // Hydrates the CategoryCard mechanism lineup (see LayerItem).
            expanded_detail: it.expanded_detail ?? null,
          };
        }),
    [lanes],
  );

  const outcomeItems = useMemo(
    () =>
      lanes
        .find((l) => l.slug === "outcomes")!
        .items.map((it) => {
          const cc = (it.causal_chain ?? {}) as Record<string, unknown>;
          // Phase 8 — observable criteria mirroring pain.root_causes.
          // Backward-compat fallback: when indicators[] missing,
          // synthesize from measured_by so legacy rooms still render
          // (Category Card's outcome panel handles the fallback too).
          const indicatorsRaw = Array.isArray(cc.indicators)
            ? (cc.indicators as unknown[]).filter(
                (s): s is string => typeof s === "string" && s.length > 0,
              )
            : [];
          return {
            id: it.id,
            name: it.name,
            measured_by:
              typeof cc.measured_by === "string"
                ? cc.measured_by
                : it.description ?? undefined,
            indicators: indicatorsRaw,
            sub_category_slug: readSlug(cc),
            citations: readCitations(cc),
          };
        }),
    [lanes],
  );

  const objectiveItems = useMemo(
    () => lanes.find((l) => l.slug === "objective")?.items ?? [],
    [lanes],
  );

  // ── Shared root-cause counts across pains ──
  const painSharedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of painItems) {
      for (const c of p.root_causes) {
        counts[c] = (counts[c] ?? 0) + 1;
      }
    }
    return counts;
  }, [painItems]);

  const sharedPainsList = useMemo(
    () =>
      Object.entries(painSharedCounts)
        .filter(([, count]) => count >= 2)
        .map(([cause, count]) => ({ cause, count }))
        .sort((a, b) => b.count - a.count),
    [painSharedCounts],
  );

  // ── Same for feature first-principles ──
  const featureSharedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of featureItems) {
      for (const p of f.first_principles) {
        counts[p] = (counts[p] ?? 0) + 1;
      }
    }
    return counts;
  }, [featureItems]);
  const [highlightedPrinciples, setHighlightedPrinciples] = useState<
    Set<string>
  >(new Set());

  // ── Edge-derived addressed-by / counters maps ──
  // Pain → list of features that address it (sorted by strength).
  const addressedByMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{ id: string; name: string; pct: number }>
    >();
    for (const e of edges) {
      const src = entityIndex.get(e.source_entity_id);
      const tgt = entityIndex.get(e.target_entity_id);
      if (!src || !tgt) continue;
      // pain → feature OR feature → pain both count
      const pain =
        src.layer === "pain" ? src : tgt.layer === "pain" ? tgt : null;
      const feat =
        src.layer === "features"
          ? src
          : tgt.layer === "features"
            ? tgt
            : null;
      if (!pain || !feat) continue;
      const list = map.get(pain.id) ?? [];
      list.push({
        id: feat.id,
        name: feat.name,
        pct: Math.round((e.strength ?? 0) * 100),
      });
      map.set(pain.id, list);
    }
    for (const v of map.values()) v.sort((a, b) => b.pct - a.pct);
    return map;
  }, [edges, entityIndex]);

  // Feature → list of pains it counters.
  const countersPainsMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{ id: string; name: string; pct: number }>
    >();
    for (const e of edges) {
      const src = entityIndex.get(e.source_entity_id);
      const tgt = entityIndex.get(e.target_entity_id);
      if (!src || !tgt) continue;
      const pain =
        src.layer === "pain" ? src : tgt.layer === "pain" ? tgt : null;
      const feat =
        src.layer === "features"
          ? src
          : tgt.layer === "features"
            ? tgt
            : null;
      if (!pain || !feat) continue;
      const list = map.get(feat.id) ?? [];
      list.push({
        id: pain.id,
        name: pain.name,
        pct: Math.round((e.strength ?? 0) * 100),
      });
      map.set(feat.id, list);
    }
    for (const v of map.values()) v.sort((a, b) => b.pct - a.pct);
    return map;
  }, [edges, entityIndex]);

  // Outcome → list of features that produce it (feature → outcome edges).
  const producedByMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{ id: string; name: string; pct: number }>
    >();
    for (const e of edges) {
      const src = entityIndex.get(e.source_entity_id);
      const tgt = entityIndex.get(e.target_entity_id);
      if (!src || !tgt) continue;
      const out =
        src.layer === "outcomes" ? src : tgt.layer === "outcomes" ? tgt : null;
      const feat =
        src.layer === "features"
          ? src
          : tgt.layer === "features"
            ? tgt
            : null;
      if (!out || !feat) continue;
      const list = map.get(out.id) ?? [];
      list.push({
        id: feat.id,
        name: feat.name,
        pct: Math.round((e.strength ?? 0) * 100),
      });
      map.set(out.id, list);
    }
    for (const v of map.values()) v.sort((a, b) => b.pct - a.pct);
    return map;
  }, [edges, entityIndex]);

  // Outcome → list of pains it dissolves (pain → outcome edges).
  const outcomeDissolvesMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{ id: string; name: string; pct: number }>
    >();
    for (const e of edges) {
      const src = entityIndex.get(e.source_entity_id);
      const tgt = entityIndex.get(e.target_entity_id);
      if (!src || !tgt) continue;
      const out =
        src.layer === "outcomes" ? src : tgt.layer === "outcomes" ? tgt : null;
      const pain =
        src.layer === "pain" ? src : tgt.layer === "pain" ? tgt : null;
      if (!out || !pain) continue;
      const list = map.get(out.id) ?? [];
      list.push({
        id: pain.id,
        name: pain.name,
        pct: Math.round((e.strength ?? 0) * 100),
      });
      map.set(out.id, list);
    }
    for (const v of map.values()) v.sort((a, b) => b.pct - a.pct);
    return map;
  }, [edges, entityIndex]);

  // Outcomes that have an edge to the objective anchor → "rolls up".
  const rollsUpSet = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) {
      const src = entityIndex.get(e.source_entity_id);
      const tgt = entityIndex.get(e.target_entity_id);
      if (!src || !tgt) continue;
      if (src.layer === "outcomes" && tgt.layer === "objective")
        set.add(src.id);
      else if (tgt.layer === "outcomes" && src.layer === "objective")
        set.add(tgt.id);
    }
    return set;
  }, [edges, entityIndex]);

  // Identify the keystone feature (counters most pains).
  const keystoneFeatureId = useMemo(() => {
    let best: string | null = null;
    let bestCount = 0;
    for (const f of featureItems) {
      const cnt = (countersPainsMap.get(f.id) ?? []).length;
      if (cnt > bestCount) {
        bestCount = cnt;
        best = f.id;
      }
    }
    return bestCount >= 2 ? best : null;
  }, [featureItems, countersPainsMap]);

  // Top pain by influence (root).
  const rootPainId = painItems[0]?.id ?? null;

  // ── Linked entities derived from hover (chain-transitive) ──
  // Single-hop edge traversal misses a critical user need: when you
  // hover a Result, you want to see the upstream Mechanism AND the
  // root Problem that the chain runs through — not just the directly
  // adjacent node.
  //
  // Strategy: compute the full chain triples for the room, then for
  // any hovered entity, light up every node in every chain that
  // touches it. We ALSO union with the 1-hop edges so half-chains
  // (e.g., a Problem with a Mechanism edge but no Result yet) still
  // highlight what they're connected to.
  const allChains = useMemo(
    () => computeChains(edges, entityIndex),
    [edges, entityIndex],
  );
  const linkedIds = useMemo(() => {
    if (!hoveredEntityId) return new Set<string>();
    const out = new Set<string>([hoveredEntityId]);
    // Chain-transitive: any chain (Problem → Mechanism → Result)
    // that contains the hovered id lights up all three nodes.
    for (const c of allChains) {
      if (
        c.painId === hoveredEntityId ||
        c.featureId === hoveredEntityId ||
        c.outcomeId === hoveredEntityId
      ) {
        out.add(c.painId);
        out.add(c.featureId);
        out.add(c.outcomeId);
      }
    }
    // 1-hop fallback: half-chains + edges that don't compose into a
    // full triple (e.g., Outcome → Objective) still highlight.
    for (const e of edges) {
      if (e.source_entity_id === hoveredEntityId) out.add(e.target_entity_id);
      else if (e.target_entity_id === hoveredEntityId)
        out.add(e.source_entity_id);
    }
    return out;
  }, [hoveredEntityId, edges, allChains]);
  const hoverActive = hoveredEntityId !== null;

  /** Combined edge-hover + lens-hover linking. When the user
   *  hovers an annotation chip, items derived from that annotation
   *  light up the same way edge-linked items do. When neither
   *  signal is active, returns the no-op state. */
  const lensActive = hoveredAnnotationIndex !== null;
  const lensLinkedIds = useMemo(() => {
    if (hoveredAnnotationIndex === null) return new Set<string>();
    return (
      itemIdsByAnnotationIndex.get(hoveredAnnotationIndex) ??
      new Set<string>()
    );
  }, [hoveredAnnotationIndex, itemIdsByAnnotationIndex]);
  const anyHoverActive = hoverActive || lensActive;
  function linkingFor(id: string): { linked: boolean; dim: boolean } {
    const edgeLinked = hoverActive && linkedIds.has(id);
    const lensLinked = lensActive && lensLinkedIds.has(id);
    const isLinked = edgeLinked || lensLinked;
    return { linked: isLinked, dim: anyHoverActive && !isLinked };
  }

  // ── Autopilot auto-fire ──
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (pipelineMode !== "autopilot") return;
    if (generatedAt) return;
    autoFiredRef.current = true;
    void generate("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineMode, generatedAt]);

  // Arc 3.6 — phase defaults to "all" (one-shot) so the autopilot
  // auto-fire stays unchanged. Manual Generate / Regenerate pass
  // "define" so the room stops at the problem/result checkpoint.
  function generate(
    mode: "initial" | "regenerate",
    phase: "define" | "all" = "all",
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/brainstorm/room/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, subObjectiveId, mode, phase }),
        });
        const json = await res.json();
        if (!res.ok) {
          const base = json?.error ?? "Generation failed. Try again.";
          setError(json?.detail ? `${base} — ${json.detail}` : base);
          return;
        }
        // Surface correlation soft-fail as a non-fatal warning so
        // the user knows to retry from the side panel instead of
        // discovering the empty correlation state by accident.
        if (typeof json?.correlation_warning === "string") {
          setError(`Heads up — ${json.correlation_warning}`);
        }
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Network error. Try again.",
        );
      }
    });
  }

  function handleApprovalChange(edgeId: string, approved: boolean) {
    setApprovedEdgeIds((prev) => {
      const next = new Set(prev);
      if (approved) next.add(edgeId);
      else next.delete(edgeId);
      return next;
    });
  }

  function handleSharedCauseHover(cause: string | null) {
    setHighlightedCauses(cause ? new Set([cause]) : new Set());
  }

  // Altitude 2 — a Map edge was clicked. An edge is one chain hop, so
  // resolve it to the chain that owns it (either the pain→mechanism or
  // mechanism→result edge), then zoom into the Chains frame focused on
  // that bet. No-op if the edge isn't part of a complete chain (a lone
  // half-edge); the user stays on the Map.
  function handleOpenChainForEdge(edgeId: string) {
    const chain = allChains.find(
      (c) =>
        c.painFeatureEdge.id === edgeId || c.featureOutcomeEdge.id === edgeId,
    );
    if (!chain) return;
    setChainFocus({ id: chain.id, nonce: Date.now() });
    setRoomView("categories");
  }

  const hasEdges = edges.length > 0;
  const approvedCount = approvedEdgeIds.size;

  // Arc 3.6 — checkpoint state: problems (pain) + results (outcome)
  // have been generated, but mechanisms (features) have NOT, and the
  // room isn't marked complete. Derived purely from props — no new
  // prop / schema. When true the review surface renders so the user
  // can edit / sharpen before generating mechanisms.
  const isCheckpoint =
    !generatedAt &&
    painItems.length > 0 &&
    outcomeItems.length > 0 &&
    featureItems.length === 0;

  // Arc 3.3 — fast shell + background deepen. Once the room is fully
  // generated, pre-warm every card's deep detail (definition /
  // variations / planning) via /item/expand in the background so
  // opening a card is instant instead of spinning on first open.
  // /item/expand short-circuits already-deep cards, so this is cheap
  // on repeat visits. Gated on generatedAt so it never runs at the
  // checkpoint (mechanisms don't exist yet there).
  const allCardIds = useMemo(
    () => [
      ...painItems.map((p) => p.id),
      ...featureItems.map((f) => f.id),
      ...outcomeItems.map((o) => o.id),
    ],
    [painItems, featureItems, outcomeItems],
  );
  useBackgroundDeepen(allCardIds, Boolean(generatedAt));

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* Pre-generation header — the empty-state prompt + Generate CTA.
          Once the room is generated this whole band collapses; the
          Regenerate control + approved-count move into the working
          control row just above the view, so the top of the room
          isn't an orphan near-empty bar. */}
      {!generatedAt && (
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <p
              className="text-[13px] font-light"
              style={{ color: appleVibe.text.secondary }}
            >
              We&rsquo;ll spin out pain points first, then outcomes, then
              the features that bridge them. Cross-layer correlations
              live in the side panel.
            </p>
          </div>
          {!isCheckpoint && (
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => generate("initial", "define")}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-[13px] font-semibold"
                style={{
                  background: appleVibe.accent.primary,
                  color: appleVibe.text.onAccent,
                  borderRadius: appleVibe.radius.md,
                  cursor: busy ? "wait" : "pointer",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                <Sparkle className="h-3.5 w-3.5" />
                <span>{busy ? "Generating…" : "Generate the room"}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl px-3.5 py-2.5 text-[13px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "rgba(127,29,29,0.95)",
          }}
        >
          {error}
        </div>
      )}

      {/* Arc 3.6 — problem/result checkpoint. When the room has been
          DEFINED (problems + results) but mechanisms aren't generated
          yet, the review surface lets the user edit / sharpen the
          problems + results, then generate mechanisms against them —
          the declared-primary chains reflect those edits. */}
      {isCheckpoint && (
        <div className="mb-6">
          <ProblemResultReview
            spaceId={spaceId}
            subObjectiveId={subObjectiveId}
            pains={painItems.map((p) => ({
              id: p.id,
              name: p.name,
              negative_outcome: p.negative_outcome ?? "",
              root_causes: p.root_causes,
            }))}
            outcomes={outcomeItems.map((o) => ({
              id: o.id,
              name: o.name,
              measured_by: o.measured_by ?? "",
              indicators: o.indicators,
            }))}
            onComplete={() => router.refresh()}
          />
        </div>
      )}

      {/* Hero row — one two-column band so the upper viewport reads as
          one composed header instead of a stack of thin full-width bars.
          LEFT: the context stack (Definition + Counters + objective
          coverage). RIGHT: the strategic-bets portfolio. The split only
          engages once the room is generated (the portfolio is
          meaningless before then); pre-generation the prose flows in a
          single readable column. */}
      {(description?.trim() ||
        topNegativeOutcome ||
        (generatedAt && annotations.length > 0)) && (
        <div
          className={
            generatedAt
              ? "mb-4 grid grid-cols-1 items-start gap-x-10 gap-y-6 lg:grid-cols-2"
              : "mb-4"
          }
        >
          {/* Left — context stack */}
          <div className="flex flex-col gap-5">
            {description?.trim() && (
              <HeroProse
                label="Definition"
                dotColor={appleVibe.stage.objective}
                text={description ?? ""}
                annotations={descriptionAnnotations}
              />
            )}
            {topNegativeOutcome && (
              <HeroProse
                label="The problem"
                dotColor={appleVibe.stage.pain}
                text={topNegativeOutcome}
              />
            )}
            {generatedAt && annotations.length > 0 && (
              <AnnotationLensStrip
                annotations={annotations}
                coverageByIndex={itemIdsByAnnotationIndex}
                crossRoomCoverageByIndex={crossRoomCoverageByIndex}
                hoveredIndex={hoveredAnnotationIndex}
                onHoverIndex={setHoveredAnnotationIndex}
                onDeepenLens={() => setLensBrainstormOpen(true)}
              />
            )}
          </div>

          {/* Right — hypotheses portfolio. Self-hides when the room has no
              categories, so generated rooms always fill this column. */}
          {generatedAt && (
            <PortfolioStrip
              categories={roomCategories}
              painItems={painItems.map((p) => ({
                id: p.id,
                subCategorySlug: p.sub_category_slug,
              }))}
              featureItems={featureItems.map((f) => ({
                id: f.id,
                subCategorySlug: f.sub_category_slug,
              }))}
              outcomeItems={outcomeItems.map((o) => ({
                id: o.id,
                subCategorySlug: o.sub_category_slug,
              }))}
              chains={computeChains(edges, entityIndex)}
              approvedEdgeIds={approvedEdgeIds}
              spaceId={spaceId}
              subObjectiveId={subObjectiveId}
              onGapsClick={() => {
                const el = document.getElementById(
                  "correlation-side-panel-anchor",
                );
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
            />
          )}
        </div>
      )}

      {/* Phase 5a — Control variables strip. Surfaces the user's
          operational constraints between the Portfolio (Tier 3 macro
          diagnostic) and the lanes themselves. Reads from
          space.synthesis_data.constraints; renders nothing when
          unset. Edit affordance not wired here — left for future
          when an inline constraints editor lands. */}
      <ConstraintsStrip constraints={constraints} spaceId={spaceId} />

      {/* Priority Strip — per-sub-objective soft trade-off weights.
          Sibling to ConstraintsStrip (hard-fixed control variables);
          paired here so the user reads them together as "the rules
          for THIS room": fixed conditions + tunable preferences. */}
      <PriorityStrip
        initialVector={priorityVector}
        subObjectiveId={subObjectiveId}
      />

      {/* Always-on instrument legend — orients the user to the room's
          4 causal stages + their variable roles, above every view
          (Categories / Variables / Map). Only meaningful once the room
          has generated items. */}
      {generatedAt && (
        <RoomInstrumentLegend lanes={lanes} />
      )}

      {/* Phase 7a + 7c — top-right chrome: view toggle + autopilot.
          Both align right so the eye reads them as room-level controls
          rather than canvas content. ViewToggle is structural (which
          layout); Autopilot is operational (run experiments). They
          share the same row so the toggle doesn't feel orphaned and
          the autopilot has a recognizable home next to the most
          relevant view.
          The runner bumps autopilotRefreshKey after each completed
          chain — CategoryCards observe it as refreshSignal and
          re-fetch their expanded_detail so new candidates appear
          inline without user interaction. */}
      <div className="mb-3 flex items-center justify-between gap-2">
        {/* Left — room-state controls: approved count + Regenerate.
            Folded here from the old top header band so the working
            controls sit together directly above the view. */}
        <div className="flex min-w-0 items-center gap-3">
          {generatedAt && approvedCount > 0 && (
            <span
              className="truncate text-[12px] font-light"
              style={{ color: appleVibe.text.secondary }}
            >
              {approvedCount} correlation{approvedCount === 1 ? "" : "s"}{" "}
              approved
            </span>
          )}
          {generatedAt && (
            <button
              type="button"
              onClick={() => generate("regenerate", "define")}
              disabled={busy}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
              style={{
                background: appleVibe.surface.chip,
                color: appleVibe.text.secondary,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              <RefreshCw className="h-3 w-3" strokeWidth={2} />
              Regenerate
            </button>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <AutopilotRunner
            chains={allChains}
            spaceId={spaceId}
            subObjectiveId={subObjectiveId}
            onChainComplete={() =>
              setAutopilotRefreshKey((k) => k + 1)
            }
            onAllComplete={() => setAutopilotRefreshKey((k) => k + 1)}
          />
          {/* Phase 11.0b — Notebook button removed. Layout-level rail
              owns the notebook UI; this room's events stream into it
              via the URL-detected room mode. */}
          <ViewToggleInline value={roomView} onChange={setRoomView} />
        </div>
      </div>

      {/* Three-column layout — Objective lane removed (it just
          duplicated the sub-objective title rendered in the page
          header). The "rolls up to" rollup banner on the page
          header carries the parent-objective link instead.
          Phase 7a: gated on roomView === "variables" — only the
          Variables view shows the 3-lane layout. */}
      {roomView === "categories" && (
        <CategoryCardsView
          chains={allChains}
          painById={
            new Map(painItems.map((p) => [p.id, p]))
          }
          featureById={
            new Map(featureItems.map((f) => [f.id, f]))
          }
          outcomeById={
            new Map(outcomeItems.map((o) => [o.id, o]))
          }
          approvedEdgeIds={approvedEdgeIds}
          spaceId={spaceId}
          subObjectiveId={subObjectiveId}
          roomCategories={roomCategories}
          edges={edges}
          onApprovalChange={handleApprovalChange}
          onOpenItemDetail={setDetailEntityId}
          refreshSignal={autopilotRefreshKey}
          focusChain={chainFocus}
        />
      )}
      {roomView === "map" && (
        <RoomAltitudeMap
          spaceId={spaceId}
          lanes={lanes}
          edges={edges}
          onOpenItem={setDetailEntityId}
          onOpenChainForEdge={handleOpenChainForEdge}
        />
      )}
      {roomView === "subsystems" && (
        <MechanismSubsystemView
          {...buildMechanismSubsystems({ lanes, edges, roomCategories })}
        />
      )}
      {roomView === "variables" && (
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div
            ref={lanesContainerRef}
            className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            // Dim non-linked cards while hovering one — gives the
            // glow ring its companion contrast cue.
            style={{
              opacity: 1,
            }}
            data-hover-active={anyHoverActive ? "true" : undefined}
          >
            {/* Phase 6 — SVG wire overlay drawn UNDER the cards (cards
                sit in their own stacking context above the absolute
                overlay). Pointer-events: none so cards remain
                interactive. Wires highlight when either endpoint card
                is hovered, driven by the existing hoveredEntityId. */}
            <RoomEdgesOverlay
              containerRef={lanesContainerRef}
              edges={edges}
              hoveredEntityId={hoveredEntityId}
            />
            {/* PAIN lane */}
            <Lane
              slug="pain"
              label={lanes.find((l) => l.slug === "pain")!.label}
              color={lanes.find((l) => l.slug === "pain")!.color}
              count={painItems.length}
              loading={busy && isEmpty}
            >
              <SharedCausesStrip
                shared={sharedPainsList}
                highlighted={highlightedCauses}
                onHover={handleSharedCauseHover}
              />
              {painItems.length === 0 && !busy && <EmptyHint />}
              <ul className="flex flex-col gap-2">
                {painItems.map((p, i) => {
                  const { linked, dim } = linkingFor(p.id);
                  return (
                    <LaneItem
                      key={p.id}
                      entityId={p.id}
                      dim={dim}
                      index={i}
                      isLast={i === painItems.length - 1}
                    >
                      <PainCard
                        item={p}
                        isRoot={p.id === rootPainId}
                        sharedCounts={painSharedCounts}
                        highlightedCauses={highlightedCauses}
                        onHoverCause={handleSharedCauseHover}
                        addressedBy={addressedByMap.get(p.id) ?? []}
                        linked={linked}
                        onHover={setHoveredEntityId}
                        indent={0}
                        subCategory={categoryFor("friction", p.sub_category_slug)}
                        citations={p.citations}
                        onSeeAllSources={() => setSourcesOpen(true)}
                        derivedFromAnnotations={
                          provenanceByItemId.get(p.id) ?? []
                        }
                        hoveredAnnotationIndex={hoveredAnnotationIndex}
                        onHoverAnnotation={setHoveredAnnotationIndex}
                        onOpenDetail={() => setDetailEntityId(p.id)}
                        onSendToBoard={() =>
                          deployArtifactCard({
                            kind: "pain",
                            entityId: p.id,
                            title: p.name,
                            subtitle: p.negative_outcome ?? "",
                            color: appleVibe.stage.pain,
                            roomId: subObjectiveId,
                          })
                        }
                      />
                    </LaneItem>
                  );
                })}
              </ul>
            </Lane>

            {/* FEATURE lane */}
            <Lane
              slug="features"
              label={lanes.find((l) => l.slug === "features")!.label}
              color={lanes.find((l) => l.slug === "features")!.color}
              count={featureItems.length}
              loading={busy && isEmpty}
            >
              {featureItems.length === 0 && !busy && <EmptyHint />}
              <ul className="flex flex-col gap-2">
                {featureItems.map((f, i) => {
                  const { linked, dim } = linkingFor(f.id);
                  return (
                    <LaneItem
                      key={f.id}
                      entityId={f.id}
                      dim={dim}
                      index={i}
                      isLast={i === featureItems.length - 1}
                    >
                      <FeatureCard
                        item={f}
                        isKeystone={f.id === keystoneFeatureId}
                        sharedCounts={featureSharedCounts}
                        highlightedPrinciples={highlightedPrinciples}
                        onHoverPrinciple={(p) =>
                          setHighlightedPrinciples(
                            p ? new Set([p]) : new Set(),
                          )
                        }
                        countersPains={countersPainsMap.get(f.id) ?? []}
                        linked={linked}
                        onHover={setHoveredEntityId}
                        subCategory={categoryFor(
                          "mechanism",
                          f.sub_category_slug,
                        )}
                        citations={f.citations}
                        onSeeAllSources={() => setSourcesOpen(true)}
                        derivedFromAnnotations={
                          provenanceByItemId.get(f.id) ?? []
                        }
                        hoveredAnnotationIndex={hoveredAnnotationIndex}
                        onHoverAnnotation={setHoveredAnnotationIndex}
                        onOpenDetail={() => setDetailEntityId(f.id)}
                        onSendToBoard={() =>
                          deployArtifactCard({
                            kind: "feature",
                            entityId: f.id,
                            title: f.name,
                            subtitle: f.positive_outcome ?? "",
                            color: appleVibe.stage.features,
                            roomId: subObjectiveId,
                          })
                        }
                      />
                    </LaneItem>
                  );
                })}
              </ul>
            </Lane>

            {/* OUTCOME lane */}
            <Lane
              slug="outcomes"
              label={lanes.find((l) => l.slug === "outcomes")!.label}
              color={lanes.find((l) => l.slug === "outcomes")!.color}
              count={outcomeItems.length}
              loading={busy && isEmpty}
            >
              {outcomeItems.length === 0 && !busy && <EmptyHint />}
              <ul className="flex flex-col gap-2">
                {outcomeItems.map((o, i) => {
                  const { linked, dim } = linkingFor(o.id);
                  return (
                    <LaneItem
                      key={o.id}
                      entityId={o.id}
                      dim={dim}
                      index={i}
                      isLast={i === outcomeItems.length - 1}
                    >
                      <OutcomeCard
                        item={o}
                        linked={linked}
                        onHover={setHoveredEntityId}
                        producedBy={producedByMap.get(o.id) ?? []}
                        dissolves={outcomeDissolvesMap.get(o.id) ?? []}
                        rollsUp={rollsUpSet.has(o.id)}
                        subCategory={categoryFor("result", o.sub_category_slug)}
                        citations={o.citations}
                        onSeeAllSources={() => setSourcesOpen(true)}
                        derivedFromAnnotations={
                          provenanceByItemId.get(o.id) ?? []
                        }
                        hoveredAnnotationIndex={hoveredAnnotationIndex}
                        onHoverAnnotation={setHoveredAnnotationIndex}
                        onOpenDetail={() => setDetailEntityId(o.id)}
                        onSendToBoard={() =>
                          deployArtifactCard({
                            kind: "outcome",
                            entityId: o.id,
                            title: o.name,
                            subtitle: o.measured_by ?? "",
                            color: appleVibe.stage.outcomes,
                            roomId: subObjectiveId,
                          })
                        }
                      />
                    </LaneItem>
                  );
                })}
              </ul>
            </Lane>
          </div>
        </div>

        {/* Always render the side panel — even with 0 edges. The
            empty state inside the panel surfaces a "Generate
            correlations" CTA so a soft-failed correlation step is
            recoverable without regenerating the entire room. */}
        {generatedAt && (
          <CorrelationSidePanel
            spaceId={spaceId}
            subObjectiveId={subObjectiveId}
            edges={edges}
            entityIndex={entityIndex}
            approvedEdgeIds={approvedEdgeIds}
            onApprovalChange={handleApprovalChange}
            // Panel→cards hover-to-link: panel sets the same
            // hoveredEntityId state the cards do, so linkedIds
            // derivation works in both directions.
            onHoverEntity={setHoveredEntityId}
            laneLabels={{
              pain: lanes.find((l) => l.slug === "pain")!.label,
              features: lanes.find((l) => l.slug === "features")!.label,
              outcomes: lanes.find((l) => l.slug === "outcomes")!.label,
              objective: lanes.find((l) => l.slug === "objective")!.label,
            }}
            detail={{
              rootCausesById: new Map(
                painItems.map((p) => [p.id, p.root_causes]),
              ),
              firstPrinciplesById: new Map(
                featureItems.map((f) => [f.id, f.first_principles]),
              ),
              measuredByById: new Map(
                outcomeItems.map((o) => [o.id, o.measured_by ?? null]),
              ),
            }}
            roomCategories={roomCategories}
            hoveredAnnotationIndex={hoveredAnnotationIndex}
            onHoverAnnotation={setHoveredAnnotationIndex}
          />
        )}
      </div>
      )}

      {/* Research sources sheet — opened by CitationBadge "See all
          sources" footer on any card. Mounted at room-view root so
          AnimatePresence in/out transitions render correctly. */}
      <ResearchSourcesSheet
        spaceId={spaceId}
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
      />

      {/* Item detail drawer (Layer 2) — slides in when any lane
          card's "Open detail" link is clicked. Lazy-fetches the
          LLM expansion + per-item research on first open, cached
          forever. Linked chains derived from the existing chain
          graph so the drawer shows the user where this item
          participates. */}
      {(() => {
        if (!detailEntityId) return null;
        // Resolve the active item: name + layer + linked chains.
        const entity = entityIndex.get(detailEntityId);
        if (!entity) return null;
        const linkedChains: LinkedChainRef[] = allChains
          .filter(
            (c) =>
              c.painId === detailEntityId ||
              c.featureId === detailEntityId ||
              c.outcomeId === detailEntityId,
          )
          .map((c) => ({
            label: `${c.painName} → ${c.featureName} → ${c.outcomeName}`,
            pct: Math.round(c.composite * 100),
            approved:
              approvedEdgeIds.has(c.painFeatureEdge.id) &&
              approvedEdgeIds.has(c.featureOutcomeEdge.id),
          }))
          .sort((a, b) => b.pct - a.pct);
        return (
          <ItemDetailDrawer
            entityId={detailEntityId}
            itemName={entity.name}
            itemLayer={entity.layer}
            linkedChains={linkedChains}
            spaceId={spaceId}
            subObjectiveId={subObjectiveId}
            onClose={() => setDetailEntityId(null)}
          />
        );
      })()}

      {/* Phase 6b — Deepen-lens panel. Mode='annotation' triggers the
          single-pass deepen runner; elect appends the chosen v2
          annotation into improvement_goals[core].annotations + the
          router refresh repaints the lens strip with the new readings. */}
      <BrainstormPanel
        open={lensBrainstormOpen}
        onClose={() => setLensBrainstormOpen(false)}
        spaceId={spaceId}
        mode="annotation"
        onElected={() => {
          startTransition(() => {
            router.refresh();
          });
        }}
      />
    </div>
  );
}

// ── Hero prose block ───────────────────────────────────────────────
//
// Frameless label + paragraph used for the hero's Definition and
// Counters columns. No box, no spine — a small lane-colored dot + the
// standard sentence-case label, then the prose. Mirrors the canvas
// hero language so the two read as a matched pair.

function HeroProse({
  label,
  dotColor,
  text,
  annotations,
}: {
  label: string;
  dotColor: string;
  text: string;
  /** When present, the prose renders with frameless stage-colored
   *  underlines + hover-to-reveal readings (same engine as the title).
   *  Offsets are description-local, so `text` must be the RAW
   *  (untrimmed) description for the underlines to land correctly. */
  annotations?: ObjectiveAnnotation[];
}) {
  const proseClass = "max-w-[70ch] text-[13.5px] font-light leading-relaxed";
  const proseStyle = { color: appleVibe.text.secondary };
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: dotColor }}
          aria-hidden
        />
        <span
          className="text-[15px] font-semibold leading-tight"
          style={{
            color: appleVibe.text.primary,
            letterSpacing: "-0.015em",
            fontFamily: appleVibe.font.display,
          }}
        >
          {label}
        </span>
      </div>
      {annotations && annotations.length > 0 ? (
        <AnnotatedHeading
          as="p"
          text={text}
          annotations={annotations}
          className={proseClass}
          style={proseStyle}
        />
      ) : (
        <p className={proseClass} style={proseStyle}>
          {text.trim()}
        </p>
      )}
    </div>
  );
}

// ── Lane shell ─────────────────────────────────────────────────────

/** Scientific role per lane — captures the variable type + the
 *  optimization direction so the user reads "↓ minimize THIS" or
 *  "↑ maximize THIS" at a glance instead of just a layer label.
 *
 *  This is the centerpiece of Phase 5a: turn the room from a
 *  flat 3-column grid into an EXPERIMENT INSTRUMENT where each
 *  column is structurally distinct.
 *
 *  Variable roles match the digital-twin model:
 *    PROBLEMS  = dependent variables we want to MINIMIZE
 *    MECHANISMS = independent variables (manipulable levers)
 *    RESULTS   = dependent variables we want to MAXIMIZE
 *    OBJECTIVE = roll-up anchor (not part of the IV/DV system) */
const LANE_ROLE: Record<
  "pain" | "features" | "outcomes" | "objective",
  {
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    roleLabel: string;
    direction: string;
  }
> = {
  pain: {
    icon: TrendingDown,
    roleLabel: "Dependent",
    direction: "minimize",
  },
  features: {
    icon: ArrowLeftRight,
    roleLabel: "Independent",
    direction: "test",
  },
  outcomes: {
    icon: TrendingUp,
    roleLabel: "Dependent",
    direction: "maximize",
  },
  objective: {
    icon: Target,
    roleLabel: "Anchor",
    direction: "roll-up",
  },
};

// ── Room instrument legend ─────────────────────────────────────────
//
// Always-on orientation strip rendered above every room view
// (Categories / Variables / Map). Lifts the per-lane LANE_ROLE framing
// — previously only visible inside the Variables view — to a
// persistent header so the room's experiment-instrument structure is
// communicated no matter which view is active.
//
// Reads left-to-right as the causal chain itself:
//   Problems ─addressed by→ Mechanisms ─produce→ Results ··roll up·· Objective
// The connector verbs are what tell the user these are sequential
// STAGES of one chain, not four parallel buckets — the "layers aren't
// communicated" gap. We reserve the word "layer" for the canvas
// altitude stack; in the room the strata are causal STAGES.

const FLOW_VERB: Partial<
  Record<"pain" | "features" | "outcomes" | "objective", string>
> = {
  pain: "addressed by",
  features: "produce",
  outcomes: "roll up",
};

export function RoomInstrumentLegend({ lanes }: { lanes: RoomLane[] }) {
  const order: Array<"pain" | "features" | "outcomes" | "objective"> = [
    "pain",
    "features",
    "outcomes",
    "objective",
  ];
  const bySlug = new Map(lanes.map((l) => [l.slug, l] as const));

  return (
    <div
      className="mb-3 flex items-start gap-1 overflow-x-auto px-5 py-4"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.lg,
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
      }}
      aria-label="Causal stages in this room"
    >
      {order.map((slug, i) => {
        const lane = bySlug.get(slug);
        if (!lane) return null;
        const role = LANE_ROLE[slug];
        const RoleIcon = role.icon;
        const color = lane.color;
        const next = order[i + 1];
        const verb = next ? FLOW_VERB[slug] : null;
        // The objective is the anchor — not part of the IV/DV flow, so
        // its lead-in connector is a faint "roll up" rather than a
        // solid causal arrow.
        const isAnchorHop = next === "objective";
        return (
          <div
            key={slug}
            className={
              next
                ? "flex flex-1 items-start gap-1"
                : "flex flex-shrink-0 items-start gap-1"
            }
          >
            <div className="flex min-w-0 flex-col items-center gap-1.5 px-2 text-center">
              {/* Icon as the station glyph; count rides its lower-right
                  corner as an iOS-style badge so there's no competing
                  pill on the title row. */}
              <div className="relative flex-shrink-0">
                <span
                  className="grid place-items-center rounded-full"
                  style={{
                    width: 36,
                    height: 36,
                    background: `${color}1F`,
                    color,
                  }}
                  aria-hidden
                >
                  <RoleIcon className="h-[18px] w-[18px]" strokeWidth={2} />
                </span>
                <span
                  className="absolute -bottom-1 -right-1 grid min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums"
                  style={{
                    height: 18,
                    background: appleVibe.surface.card,
                    color,
                    boxShadow: `0 0 0 1px ${color}33, 0 1px 3px -1px rgba(15,23,42,0.18)`,
                  }}
                >
                  {lane.items.length}
                </span>
              </div>
              <span
                className="text-[12.5px] font-semibold leading-tight"
                style={{
                  color: appleVibe.text.primary,
                  fontFamily: appleVibe.font.display,
                  letterSpacing: "-0.01em",
                }}
              >
                {lane.label}
              </span>
              <span
                className="text-[10px] font-medium tracking-[0.01em]"
                style={{ color }}
              >
                {role.roleLabel} · {role.direction}
              </span>
            </div>

            {verb && (
              // Connector height matches the icon (36px); items-center puts
              // the line at the icon's vertical midpoint so it reads as one
              // continuous pipeline icon→icon, with the title/descriptor
              // hanging below. Verb floats just above the line.
              <div
                className="relative flex flex-1 items-center"
                style={{ height: 36, minWidth: 44 }}
              >
                <span
                  className="absolute whitespace-nowrap text-[8.5px] font-medium lowercase tracking-wide"
                  style={{
                    color: appleVibe.text.faint,
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%, -150%)",
                  }}
                >
                  {verb}
                </span>
                <div className="flex w-full items-center">
                  <div
                    className="h-px flex-1"
                    style={{
                      background: isAnchorHop
                        ? `${appleVibe.text.faint}`
                        : `linear-gradient(90deg, ${color}55, ${
                            bySlug.get(next!)?.color ?? color
                          }55)`,
                      opacity: isAnchorHop ? 0.4 : 1,
                    }}
                  />
                  <ArrowRight
                    className="-ml-0.5 h-2.5 w-2.5 flex-shrink-0"
                    style={{ color: appleVibe.text.faint }}
                    strokeWidth={2.4}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Tree-fork wrapper for the Variables (Grid) lanes. The first card in a
// lane is the trunk (flush, full width); every card after it branches
// beneath with a neutral vertical spine + horizontal elbow and a left
// indent — the "fork out like a tree" arrangement chosen in
// /preflight/room-clarity. The connectors are absolutely positioned in
// the left gutter and anchored to each card so variable card heights
// stay aligned; the spine stops at the last child's elbow so it never
// dangles. Preserves the data-entity-id + relative/z-index the SVG edge
// overlay relies on to anchor cross-lane wires.
function LaneItem({
  entityId,
  dim,
  index,
  isLast,
  children,
}: {
  entityId: string;
  dim: boolean;
  /** 0-based position in the lane. Index 0 is the trunk. */
  index: number;
  /** Last card in the lane — the spine stops at its elbow. */
  isLast: boolean;
  children: React.ReactNode;
}) {
  const isTrunk = index === 0;
  return (
    <div
      data-entity-id={entityId}
      style={{
        opacity: dim ? 0.35 : 1,
        transition: "opacity 180ms ease-out",
        // Stack above the SVG wire overlay (z-index 0 in the grid
        // container), else absolute wires paint over static card siblings.
        position: "relative",
        zIndex: 1,
        marginLeft: isTrunk ? 0 : 28,
      }}
    >
      {!isTrunk && (
        <>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: -16,
              top: -10,
              width: 1,
              height: isLast ? 36 : "calc(100% + 18px)",
              background: appleVibe.stroke.medium,
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: -16,
              top: 26,
              width: 16,
              height: 1,
              background: appleVibe.stroke.medium,
            }}
          />
        </>
      )}
      {children}
    </div>
  );
}

function Lane({
  slug,
  label,
  color,
  count,
  loading,
  children,
}: {
  slug: "pain" | "features" | "outcomes" | "objective";
  label: string;
  color: string;
  count: number;
  loading: boolean;
  children: React.ReactNode;
}) {
  const role = LANE_ROLE[slug];
  const RoleIcon = role.icon;
  return (
    <div
      className="flex min-h-[260px] flex-col p-5 transition-shadow duration-300 ease-out"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.xl,
        // Apple-tier ambient elevation on the lane shell itself.
        // Cards inside already have their own shadows — this adds a
        // softer outer halo so the lane reads as one cohesive layer
        // rather than a flat grid column. The lane-color tint is
        // ultra-subtle (3% alpha) so it whispers "this is the X lane"
        // without competing with the cards inside.
        boxShadow: `${appleVibe.shadow.card}, 0 0 0 1px ${color}0F`,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Header — two stacked rows so the title gets the visual
          weight + the scientific role line gets its own breathing room.
          Phase 5a: this header turns the lane from a "things in a
          column" container into a labeled experiment role. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Row 1 — role icon + variable type chip. Lane-color
              anchored so each lane reads as a distinct kind of
              variable, not "another column." */}
          <div className="flex items-center gap-1.5">
            <RoleIcon
              className="h-3.5 w-3.5 flex-shrink-0"
              strokeWidth={2}
            />
            <span
              className="text-[10px] font-semibold tracking-[0.02em]"
              style={{ color }}
            >
              {role.roleLabel} var · {role.direction}
            </span>
          </div>
          {/* Row 2 — the lane title, big and centered like before. */}
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{
                background: color,
                // Lane-color dot gets a small glow so it reads as a
                // status pip, not a decoration.
                boxShadow: `0 0 0 3px ${color}1A`,
              }}
              aria-hidden
            />
            <h3
              className="text-[15px] font-semibold tracking-tight"
              style={{
                color: appleVibe.text.primary,
                letterSpacing: "-0.01em",
                fontFamily: appleVibe.font.display,
              }}
            >
              {label}
            </h3>
          </div>
        </div>
        <span
          className="mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
          style={{
            background: appleVibe.surface.chip,
            color: appleVibe.text.tertiary,
          }}
        >
          {count}
        </span>
      </div>

      <div className="mt-3 flex-1">
        {loading ? (
          <div className="flex flex-col gap-2">
            <SkeletonItem />
            <SkeletonItem />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function SkeletonItem() {
  // Subtle pulse keeps the skeleton from feeling dead. matches the
  // ambient card shadow at rest so the transition from loading →
  // real card doesn't visually jump.
  return (
    <div
      className="h-14 animate-pulse"
      style={{
        background: appleVibe.surface.chip,
        borderRadius: appleVibe.radius.md,
        boxShadow: appleVibe.shadow.chip,
      }}
    />
  );
}

function EmptyHint() {
  return (
    <div
      className="border border-dashed px-3 py-3 text-center text-[11.5px] font-light italic"
      style={{
        borderColor: appleVibe.stroke.hairline,
        color: appleVibe.text.faint,
        borderRadius: appleVibe.radius.md,
        background: "rgba(15,23,42,0.015)",
      }}
    >
      Nothing here yet
    </div>
  );
}

// ── Phase 7a — View Toggle ────────────────────────────────────────
//
// Segmented pill that switches between Categories (chain-centric
// experiment frame view) and Variables (legacy 3-lane view).
// Right-aligned so it doesn't shout — the room's primary surface is
// still whichever view is selected, and the toggle is a quiet
// affordance for switching when needed.

function ViewToggleInline({
  value,
  onChange,
}: {
  value: "categories" | "variables" | "map" | "subsystems";
  onChange: (next: "categories" | "variables" | "map" | "subsystems") => void;
}) {
  // Ordered as an altitude ladder, left → right: the system overview
  // first (where the room opens), then the per-chain decision frame,
  // then the raw grid as a power-user escape hatch.
  const options: Array<{
    key: "categories" | "variables" | "map" | "subsystems";
    label: string;
    hint: string;
  }> = [
    {
      key: "map",
      label: "Map",
      hint: "The system — every stage, item, and feedback loop in one causal-loop diagram",
    },
    {
      key: "categories",
      label: "Chains",
      hint: "One Problem → Mechanism → Result experiment frame at a time — approve here",
    },
    {
      key: "variables",
      label: "Grid",
      hint: "The raw 3-lane layout + correlations — for the data-rigorous power user",
    },
    {
      key: "subsystems",
      label: "Subsystems",
      hint: "How the mechanisms interlock — composition + conflicts grouped into subsystems",
    },
  ];
  return (
      <div
        className="inline-flex items-center"
        style={{
          background: appleVibe.surface.chip,
          border: `1px solid ${appleVibe.stroke.hairline}`,
          borderRadius: appleVibe.radius.pill,
          padding: 2,
          fontFamily: appleVibe.font.stack,
        }}
      >
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              title={opt.hint}
              className="inline-flex items-center px-3 py-1 text-[11px] font-semibold transition-all duration-150 ease-out"
              style={{
                background: active ? appleVibe.surface.card : "transparent",
                color: active
                  ? appleVibe.text.primary
                  : appleVibe.text.tertiary,
                borderRadius: appleVibe.radius.pill,
                boxShadow: active ? appleVibe.shadow.chip : "none",
                letterSpacing: "0.02em",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
  );
}
