"use client";

// ── Item Detail Drawer ──────────────────────────────────────────────
//
// Slides in from the right when the user clicks "Open detail" on a
// lane card. Five sections:
//
//   1. Definition           — LLM-deepened 2-3 sentence meaning
//   2. Inspiration          — per-item Tavily sources (real web)
//   3. Variations           — 3-5 alternative implementations
//   4. Planning             — assumes / depends on / risks
//   5. Linked chains        — which chains this item participates in
//
// Both LLM (expand) + Tavily (research) are lazy-loaded on first
// open and cached forever (entities.{expanded_detail,
// detail_research}). Re-opening is instant.
//
// ESC / backdrop / X all close. Width 480px on desktop, full-screen
// on mobile.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Compass,
  ExternalLink,
  FileCode,
  FlaskConical,
  Highlighter,
  Layers,
  Link2,
  Maximize2,
  Minimize2,
  Pause,
  Plus,
  Radar,
  RefreshCw,
  Shield,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { CanonicalConceptDrawer } from "@/components/canonical/canonical-concept-drawer";
import { ThumbsRating } from "@/components/objective/thumbs-rating";
import type { VariationScoreEnvelope } from "@/lib/objective-canvas/score-variation-effectiveness";
import type { MechanismSpec } from "@/lib/objective-canvas/enrich-mechanism-spec";
import {
  DecisionSurface,
  DECISION_ANCHORS,
} from "@/components/objective/decision-surface";
import { VariationDeliverablesModal } from "@/components/objective/variation-deliverables-modal";
import { IndicatorValidityMatrix } from "@/components/objective/indicator-validity-matrix";
import { GoodhartPairingsPanel } from "@/components/objective/goodhart-pairings-panel";

interface DefinitionHighlight {
  phrase: string;
  start_offset: number;
  end_offset: number;
  why: string;
}

/** Cross-room finding shaped for the drawer's "Analysis signals"
 *  subsection. Mirrors the route's DisplayableFinding shape — the
 *  drawer renders these AS THE WORKBENCH SEES THEM, so the user has
 *  a clear mental model: "these are the structural signals the
 *  system has detected on this item, and your disposition shapes
 *  what the next regen does with each." */
interface DrawerCrossRoomFinding {
  id: string;
  kind:
    | "pain_uncovered"
    | "pain_cross_addressed"
    | "contradiction"
    | "duplicate_variation"
    | "shared_mechanism"
    | "annotation_overlap";
  title: string;
  summary: string;
  hint?: string;
  disposition: "open" | "acknowledged" | "dismissed";
}

// ── Shared types (mirror the API contracts) ──

export interface ItemSource {
  title: string;
  url: string;
  snippet: string;
  score: number;
  informs: string;
}

interface ItemResearchBundle {
  sources?: ItemSource[];
  failed?: boolean;
  fetched_at?: string;
}

type VariationFacet =
  | "fragility"
  | "analogy"
  | "tension"
  | "dimension"
  | "inference"
  | "reading";

interface VariationProvenance {
  index: number;
  phrase: string;
  facet: VariationFacet;
}

type VariationKind = "alternative" | "additive" | "principle";

type VariationDisposition = "elected" | "rejected" | "deferred" | null;

interface ItemVariation {
  /** Stable id for disposition tracking + composition source ids. */
  id?: string;
  name: string;
  description: string;
  tradeoff: string;
  /** P2 — how to read this variation (pick-one / stack / cross-cut). */
  kind?: VariationKind;
  /** P2 (revised) — single impact axis: how directly does this
   *  variation counter the parent room's pains. The user's only
   *  rank-relevant signal. */
  addresses_pain?: number;
  /** B — 2-3 open questions whose answers would change whether
   *  this variation is the right call. Prototype lab triggers. */
  open_questions?: string[];
  /** P1 — annotation lens provenance. */
  derived_from_annotations?: VariationProvenance[];
  /** P3 — user election state, persisted on entity. */
  disposition?: VariationDisposition;
  /** Phase 4c — persisted mechanism effectiveness score (0..1).
   *  Written by /api/brainstorm/item/variation/score; read on
   *  drawer re-open so prior scoring runs survive close+reopen
   *  without re-spending MC budget. */
  effectiveness_score?: number;
  /** Phase 5b — R&D-iteration provenance flag. */
  provenance?: "rd_iteration";
  /** Phase 5b — root_cause this candidate was generated to address. */
  target_root_cause?: string;
  /** Phase 5b — constraint compliance score 0..1 for R&D candidates. */
  constraint_compliance?: number;
  /** Phase 12 — cached HTML mockup of the variation's interface. */
  mockup_html?: string;
  mockup_generated_at?: string;
  /** Phase 13 — cached exportable AI prompt for the variation. */
  export_prompt?: string;
  export_prompt_generated_at?: string;
  /** Op A — cached PR/FAQ description doc. */
  description_doc?: string;
  description_doc_generated_at?: string;
  /** Op B — round-trip prompt optimization history when present. */
  export_prompt_history?: {
    prompt_v1: string;
    preview_v1: {
      output: string;
      judge_score: number;
      judge_verdict: "ship" | "revise";
      judge_critique: string;
    };
    prompt_v2?: string;
    preview_v2?: {
      output: string;
      judge_score: number;
      judge_verdict: "ship" | "revise";
      judge_critique: string;
    };
    final_prompt: string;
    iterations: number;
  };
  /** Phase 11.2-11.8 — per-proxy-indicator audit (rubric/ensemble/MC/
   *  evidence/persona/empirical). Threaded into the drawer's local
   *  variation shape so the Validity Matrix section can render
   *  without an additional fetch. Optional — pre-Phase-11.2 variations
   *  won't have it. */
  indicator_scores?: Array<{
    indicator_text: string;
    outcome_id: string;
    outcome_name: string;
    score: number;
    reason: string;
    confidence: number;
    lens_scores?: Array<{
      lens:
        | "systems_analyst"
        | "skeptic"
        | "operator"
        | "engineer"
        | "historian";
      score: number;
      confidence: number;
      reason: string;
    }>;
    disagreement_score?: number;
    disagreement_confidence?: number;
    lens_agreement_count?: number;
    mediation_check?: "necessary" | "indirect" | "questionable";
    goodhart_risk?: "low" | "medium" | "high";
    lift_pct?: number;
    lift_band?: { p10: number; p50: number; p90: number };
    lift_band_method?: "mc_scaled" | "mc_direct";
    evidence_citations?: Array<{
      source_idx: number;
      source_title: string;
      source_url: string;
      source_snippet: string;
      source_lens?: string;
      classification: "supports" | "refutes" | "contextual";
      relevance: number;
      argument: string;
    }>;
    evidence_strength?: number;
    evidence_supports?: number;
    evidence_refutes?: number;
    evidence_contextual?: number;
    persona_scores?: Array<{
      persona_id: string;
      persona_name: string;
      score: number;
      matters: number;
      reason: string;
    }>;
    persona_consensus_score?: number;
    persona_disagreement_score?: number;
    persona_coverage_count?: number;
    persona_coverage_total?: number;
    empirical_overlay?: {
      observed_lift_pct: number | null;
      observed_direction:
        | "increased"
        | "decreased"
        | "no_change"
        | "inconsistent";
      methodology_rigor: number;
      sample_size_total: number | null;
      n_briefs: number;
      extraction_rationale: string;
      extracted_at: string;
    };
  }>;
}

interface ItemPlanning {
  assumes: string[];
  depends_on: string[];
  risks: string[];
}

interface ComposedDesign {
  description: string;
  integration_points: string[];
  conflicts_resolved: string[];
  conflicts_open: string[];
  source_variation_ids: string[];
  generated_at: string;
}

interface PrototypeBrief {
  id: string;
  variation_id: string;
  open_question: string;
  domain: string;
  hypothesis: string;
  signal_to_watch: string;
  kill_criteria: string;
  build_estimate: string;
  artifact_type: string;
  artifact_body: string;
  learning_target: string;
  generated_at: string;
}

/** E — local mirror of ExpansionNode persisted on
 *  entities.expanded_detail.expansion_tree[]. Drives the inline
 *  [+] Deepen behavior on every variation. */
interface ExpansionNodeLocal {
  id: string;
  parent_node_id: string | null;
  depth: number;
  lineage_titles: string[];
  attach_point: string;
  attach_ref: string;
  node_type: string;
  title: string;
  body: Record<string, unknown>;
  source: "ai_auto" | "user_manual";
  disposition: "kept" | "parked" | null;
  derived_from_annotations?: VariationProvenance[];
  generated_at: string;
}

interface ExpandedItemDetail {
  definition?: string;
  variations?: ItemVariation[];
  planning?: ItemPlanning;
  composed_design?: ComposedDesign | null;
  prototype_briefs?: PrototypeBrief[];
  expansion_tree?: ExpansionNodeLocal[];
  /** Phase 4c — persisted envelope-level signals from the last
   *  /api/brainstorm/item/variation/score run. Mirrors the lib
   *  type's effectiveness_envelope shape. Lets the drawer
   *  reconstruct the prior scoring banner on re-open. */
  effectiveness_envelope?: {
    target_entity_id: string | null;
    target_entity_name: string | null;
    target_edge_strength: number | null;
    lift_pct: number | null;
    lift_band: { p10: number; p50: number; p90: number } | null;
    placebo_verdict: "pass" | "fail" | "skip" | null;
    placebo_ratio: number | null;
    status:
      | "ok"
      | "no_target"
      | "no_variations"
      | "lever_unreachable"
      | "sim_failed"
      | "not_feature"
      | "no_expanded";
    status_detail: string | null;
    scored_at: string;
    /** Phase 11.3 — Goodhart counter-indicators proposed by the
     *  ensemble scorer. One per outcome that carried indicators.
     *  Surfaces in the Goodhart Pairings Panel (Phase 11.9b). */
    counter_indicators?: Array<{
      outcome_id: string;
      outcome_name: string;
      counter_indicator: string;
      rationale: string;
    }>;
    /** Phase 11.3 — REML τ²-pooled per-indicator confidence across
     *  variations. Used by the Forest Plot (Phase 11.9c, deferred).
     *  Threaded here so the data is locally available when that
     *  panel ships. */
    indicator_pool?: Array<{
      indicator_text: string;
      outcome_id: string;
      outcome_name: string;
      pooled_confidence: number;
      pooled_ci_lower: number;
      pooled_ci_upper: number;
      tau_squared: number;
      n_variations: number;
    }>;
  };
  generated_at?: string;
  /** Arc 3.1 — engineering-grade technical spec for FEATURE items.
   *  Generated on demand via the Mechanism section button (POST
   *  /api/brainstorm/item/[entityId]/mechanism-spec) or the canvas
   *  autopilot. Imported lib type — no local mirror needed. */
  mechanism_spec?: MechanismSpec | null;
}

const FACET_COLOR: Record<VariationFacet, string> = {
  fragility: "rgba(220,38,38,0.78)",
  analogy: "rgba(37,99,235,0.78)",
  dimension: "rgba(22,163,74,0.78)",
  tension: "rgba(217,119,6,0.78)",
  inference: "rgba(124,58,237,0.78)",
  reading: "rgba(15,23,42,0.45)",
};

const KIND_LABEL: Record<VariationKind, string> = {
  alternative: "Pick one",
  additive: "Stackable",
  principle: "Applies across",
};

const KIND_DESCRIPTION: Record<VariationKind, string> = {
  alternative: "Mutually exclusive — choose one design pattern.",
  additive: "Composable — stack any combination.",
  principle: "Cross-cutting design principle that applies regardless of choice.",
};

export interface LinkedChainRef {
  /** Display label for the linked chain — usually "Friction → Mechanism → Result". */
  label: string;
  /** Composite strength of the chain (0-100). */
  pct: number;
  /** Whether the chain is approved (both edges). */
  approved: boolean;
}

interface Props {
  /** The entity being shown. Pass null to close. */
  entityId: string | null;
  /** Item title (so the drawer renders instantly without waiting
   *  for the LLM expansion). */
  itemName: string;
  /** Which lane the item came from — drives the layer color band. */
  itemLayer: "pain" | "features" | "outcomes" | "objective";
  /** Cached existing detail, if any. Null = lazy-fetch on open. */
  initialExpandedDetail?: ExpandedItemDetail | null;
  initialDetailResearch?: ItemResearchBundle | null;
  /** Chains this item participates in (derived from edges by the
   *  parent room view). Empty array = item has no incoming or
   *  outgoing edges yet. */
  linkedChains: LinkedChainRef[];
  /** The current space's id — threaded into CanonicalConceptDrawer
   *  so the "+ Branch into current space" affordance can fire. When
   *  undefined, the branch button stays hidden (drawer-as-read-only). */
  spaceId?: string;
  onClose: () => void;
}

const LANE_COLORS: Record<Props["itemLayer"], string> = {
  pain: appleVibe.stage.pain,
  features: appleVibe.stage.features,
  outcomes: appleVibe.stage.outcomes,
  objective: appleVibe.stage.objective,
};

const LANE_LABELS: Record<Props["itemLayer"], string> = {
  pain: "Problem",
  features: "Mechanism",
  outcomes: "Result",
  objective: "Objective",
};

export function ItemDetailDrawer({
  entityId,
  itemName,
  itemLayer,
  initialExpandedDetail,
  initialDetailResearch,
  linkedChains,
  spaceId,
  onClose,
}: Props) {
  const reduce = useReducedMotion();
  const open = !!entityId;
  // Arc 1 — fullscreen toggle. Default false = floating rail-card
  // (margins from each edge, canvas visible + interactive behind).
  // true = expands to near-full-viewport for detail-heavy work.
  const [fullscreen, setFullscreen] = useState(false);

  // ── Detail state ──
  const [expanded, setExpanded] = useState<ExpandedItemDetail | null>(
    initialExpandedDetail && hasDefinition(initialExpandedDetail)
      ? initialExpandedDetail
      : null,
  );
  const [expandLoading, setExpandLoading] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  // Soft-staleness banner — populated from the /expand response's
  // upstream_staleness payload. When is_stale=true, renders an
  // affordance suggesting "refresh from upstream" so the user can
  // pull fresh upstream depth into this card's expansion. Cleared
  // on regenerate (force) since the fresh generation IS by
  // definition upstream-aware.
  const [staleness, setStaleness] = useState<{
    is_stale: boolean;
    last_upstream_change_at: string | null;
    changes: Array<{
      source_name: string;
      kind:
        | "expand"
        | "spawn"
        | "disposition"
        | "local_variations"
        | "local_composition";
      changed_at: string;
    }>;
  } | null>(null);
  // Composition + brief staleness — sourced from the same expand
  // response so the drawer can surface "Recompose" / "Regenerate
  // brief" banners on open WITHOUT requiring a subsequent compose/
  // prototype fetch. Subsequent force-regenerates clear these
  // (since the regen returns no staleness alongside the fresh data).
  type StaleShape = {
    is_stale: boolean;
    last_upstream_change_at: string | null;
    changes: Array<{
      source_name: string;
      kind:
        | "expand"
        | "spawn"
        | "disposition"
        | "local_variations"
        | "local_composition";
      changed_at: string;
    }>;
  };
  const [compositionStaleness, setCompositionStaleness] =
    useState<StaleShape | null>(null);
  const [briefStalenessMap, setBriefStalenessMap] = useState<Record<
    string,
    StaleShape
  > | null>(null);
  // Cross-room findings for THIS item — populated from /expand
  // response. Surfaced in the Analysis Signals section so the user
  // reads what the workbench has detected on this item and what
  // their disposition does downstream.
  const [crossRoomFindings, setCrossRoomFindings] = useState<
    DrawerCrossRoomFinding[]
  >([]);

  // ── Definition highlights (toggle) ──
  // Local-only cache: client requests once when the user first
  // toggles highlights on for a given definition. Resetting on
  // definition regenerate is handled by the regenerateExpansion
  // path below — it nulls the cache so the next toggle re-fetches.
  const [highlightsOn, setHighlightsOn] = useState(false);
  const [highlights, setHighlights] = useState<DefinitionHighlight[] | null>(
    null,
  );
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [highlightsError, setHighlightsError] = useState<string | null>(null);

  const [research, setResearch] = useState<ItemResearchBundle | null>(
    initialDetailResearch ?? null,
  );
  const [researchLoading, setResearchLoading] = useState(false);

  // ── Cross-space KG — canonical concepts from prior spaces that
  // /expand surfaces alongside the expansion. Captured on every
  // fetch (cache hit + fresh generation). Powers a small strip
  // above Variations + per-variation "↻ links to" badges so the
  // user sees the KG accumulating, not fragmenting. ──
  const [priorConcepts, setPriorConcepts] = useState<
    Array<{
      id: string;
      canonical_code: string;
      display_name: string;
      description: string | null;
      domain_tags: string[];
      space_count: number;
    }>
  >([]);
  // Click-to-open-drawer state for KG concept inspection. When set,
  // CanonicalConceptDrawer mounts at the right edge (slides OVER
  // the item detail drawer). All chip clicks feed this.
  const [openConceptCode, setOpenConceptCode] = useState<string | null>(null);

  // ── ESC to close ──
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ── Lazy-fetch detail on every open ──
  //
  // We ALWAYS hit /expand on entityId change, even when an
  // `initialExpandedDetail` prop is present. The prop comes from
  // the parent page's SSR snapshot taken at page mount — the
  // moment the user mutates anything inside the drawer (elects a
  // variation, defers/rejects, spawns an expansion node, composes
  // a design, generates a prototype brief), the prop goes stale
  // because the parent doesn't router.refresh() on every drawer
  // action. Re-using the stale prop on re-open is the exact bug
  // where "information isn't sustained from the last generation."
  //
  // The /expand route's cache check (entities.expanded_detail
  // already populated → single SELECT, no LLM call) makes the
  // round-trip cheap (~100-200ms). The prop still drives instant
  // first-paint so the user never sees a skeleton when we have
  // ANY content to render — the fetch upgrades the paint to fresh
  // state once it lands. If the fetch fails and we already have
  // prop-paint, we degrade silently rather than showing an error
  // overlay over usable (even if slightly stale) content.
  useEffect(() => {
    if (!entityId) return;

    // Optimistic first-paint from the prop. Authoritative state
    // arrives below via /expand.
    const propPaint =
      initialExpandedDetail && hasDefinition(initialExpandedDetail)
        ? initialExpandedDetail
        : null;
    setExpanded(propPaint);
    setResearch(initialDetailResearch ?? null);
    setExpandError(null);

    // /expand — always. Skeleton only when we have nothing to
    // paint yet (cold open of a never-expanded item).
    if (!propPaint) setExpandLoading(true);
    void fetch("/api/brainstorm/item/expand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityId }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          // Only surface the error when we have no fallback content.
          // With prop-paint, stale-but-readable beats a hard error.
          if (!propPaint) {
            setExpandError(json?.error ?? "Could not expand item.");
          }
          return;
        }
        setExpanded(json.expanded_detail ?? null);
        if (Array.isArray(json?.prior_concepts)) {
          setPriorConcepts(json.prior_concepts);
        }
        // Soft-staleness — surface upstream changes since this
        // detail was generated. Null-tolerant so older route
        // versions (pre-staleness) don't crash this branch.
        setStaleness(
          json?.upstream_staleness && typeof json.upstream_staleness === "object"
            ? json.upstream_staleness
            : null,
        );
        setCompositionStaleness(
          json?.composition_staleness &&
            typeof json.composition_staleness === "object"
            ? json.composition_staleness
            : null,
        );
        setBriefStalenessMap(
          json?.brief_staleness &&
            typeof json.brief_staleness === "object"
            ? json.brief_staleness
            : null,
        );
        setCrossRoomFindings(
          Array.isArray(json?.cross_room_findings)
            ? (json.cross_room_findings as DrawerCrossRoomFinding[])
            : [],
        );
      })
      .catch((err) => {
        if (!propPaint) {
          setExpandError(
            err instanceof Error ? err.message : "Network error.",
          );
        }
      })
      .finally(() => setExpandLoading(false));

    // /research — same pattern, gentler. Research is item-research
    // (lit + web), NOT mutated by drawer actions, so the prop is
    // less likely to be stale. We still re-fetch so retries on
    // prior failures resolve, and so cold opens populate. The
    // route is idempotent: cache hit returns the stored bundle.
    const hasResearchPaint =
      !!initialDetailResearch &&
      Array.isArray(initialDetailResearch.sources) &&
      (initialDetailResearch.sources.length > 0 ||
        initialDetailResearch.failed === true);
    if (!hasResearchPaint) setResearchLoading(true);
    void fetch("/api/brainstorm/item/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityId }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (res.ok) setResearch(json.detail_research ?? null);
      })
      .catch(() => {
        // Silent — research is optional; the drawer still renders.
      })
      .finally(() => setResearchLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  // ── Soft re-fetch (Phase 5b) ──
  // Light-weight refetch of the current entity's /expand payload
  // WITHOUT toggling the loading skeleton (we already have content
  // on screen — replacing it cleanly without flash is the goal).
  // Threaded into VariationScoringPanel so the experiment loop can
  // pull fresh state after writing new candidates / dispositions.
  const refetchExpandedSoft = useCallback(() => {
    if (!entityId) return;
    void fetch("/api/brainstorm/item/expand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityId }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        setExpanded(json.expanded_detail ?? null);
        if (Array.isArray(json?.prior_concepts)) {
          setPriorConcepts(json.prior_concepts);
        }
      })
      .catch(() => {
        // Soft refresh — failures are silent. The user keeps what
        // was on screen + can hit "Re-score" manually if needed.
      });
  }, [entityId]);

  // ── Regenerate (user-triggered) ──
  function regenerateExpansion() {
    if (!entityId) return;
    setExpandLoading(true);
    setExpandError(null);
    // Definition is about to change → drop any cached highlights so
    // the next toggle-on re-fetches against the fresh text.
    setHighlights(null);
    setHighlightsError(null);
    void fetch("/api/brainstorm/item/expand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityId, mode: "force" }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setExpandError(json?.error ?? "Could not regenerate.");
          return;
        }
        setExpanded(json.expanded_detail ?? null);
        if (Array.isArray(json?.prior_concepts)) {
          setPriorConcepts(json.prior_concepts);
        }
        // Force-regen returns NO_STALENESS from the server (the
        // fresh generation IS by definition upstream-aware), so
        // setting it here clears the banner cleanly.
        setStaleness(
          json?.upstream_staleness && typeof json.upstream_staleness === "object"
            ? json.upstream_staleness
            : null,
        );
        // Force-regen also resets composition + brief staleness —
        // the regenerated variations are the fresh baseline, so
        // existing composed_design and briefs are NOW stale relative
        // to them (the server returns the staleness payload that
        // reflects this for cache-hit shape, but force-regen reads
        // straight from the cache logic ABOVE the cache-hit branch).
        // Clearing here is safe because the next compose/brief load
        // will re-fetch the staleness when needed.
        setCompositionStaleness(
          json?.composition_staleness &&
            typeof json.composition_staleness === "object"
            ? json.composition_staleness
            : null,
        );
        setBriefStalenessMap(
          json?.brief_staleness &&
            typeof json.brief_staleness === "object"
            ? json.brief_staleness
            : null,
        );
        setCrossRoomFindings(
          Array.isArray(json?.cross_room_findings)
            ? (json.cross_room_findings as DrawerCrossRoomFinding[])
            : [],
        );
      })
      .catch((err) =>
        setExpandError(err instanceof Error ? err.message : "Network error."),
      )
      .finally(() => setExpandLoading(false));
  }

  // ── Highlights toggle ──
  function toggleHighlights() {
    const next = !highlightsOn;
    setHighlightsOn(next);
    // Lazy fetch on first toggle-on; cached for the lifetime of the
    // drawer-open session.
    if (
      next &&
      highlights === null &&
      !highlightsLoading &&
      expanded?.definition &&
      expanded.definition.length >= 40
    ) {
      setHighlightsLoading(true);
      setHighlightsError(null);
      void fetch("/api/brainstorm/item/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: expanded.definition,
          topic: itemName,
        }),
      })
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) {
            setHighlightsError(
              json?.error ?? "Could not generate highlights.",
            );
            return;
          }
          setHighlights(
            Array.isArray(json.highlights) ? json.highlights : [],
          );
        })
        .catch((err) =>
          setHighlightsError(
            err instanceof Error ? err.message : "Network error.",
          ),
        )
        .finally(() => setHighlightsLoading(false));
    }
  }

  // Build segmented text once per (definition, highlights) pair.
  const definitionSegments = useMemo(() => {
    const text = expanded?.definition ?? "";
    if (!text || !highlightsOn || !highlights || highlights.length === 0) {
      return null;
    }
    return buildHighlightSegments(text, highlights);
  }, [expanded?.definition, highlights, highlightsOn]);

  const laneColor = LANE_COLORS[itemLayer];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — only in fullscreen mode. Rail-card mode has no
              backdrop so the canvas behind stays interactive (the user
              can click/pan the room while the card floats). Fullscreen
              dims to focus. */}
          {fullscreen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.2 }}
              onClick={onClose}
              className="fixed inset-0 z-40"
              style={{ background: "rgba(15,23,42,0.32)" }}
              aria-hidden
            />
          )}

          {/* Drawer — floating rail-card (margins, rounded, shadow, no
              backdrop) by default; near-full-viewport when expanded.
              Matches the Lab Notebook's rail-card treatment so both
              side surfaces read as the same family. */}
          <motion.aside
            role="dialog"
            aria-label={`Detail for ${itemName}`}
            initial={
              reduce ? { x: 0, opacity: 0 } : { x: "100%", opacity: 0.8 }
            }
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: "100%", opacity: 0 }}
            transition={{
              duration: reduce ? 0 : 0.36,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="fixed z-50 flex flex-col overflow-hidden"
            style={{
              top: 16,
              right: 16,
              bottom: 16,
              left: fullscreen ? 16 : "auto",
              width: fullscreen ? "auto" : "min(440px, calc(100vw - 32px))",
              maxWidth: fullscreen ? undefined : "calc(100vw - 32px)",
              background: appleVibe.surface.card,
              border: `1px solid ${appleVibe.stroke.hairline}`,
              borderRadius: 20,
              boxShadow:
                "0 24px 64px -16px rgba(11,18,40,0.32), 0 4px 12px -4px rgba(11,18,40,0.10)",
              fontFamily: appleVibe.font.stack,
            }}
          >
            {/* Header */}
            <header
              className="flex items-center justify-between gap-3 px-5 py-4"
              style={{
                borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)",
                backdropFilter: "blur(12px)",
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: laneColor }}
                    aria-hidden
                  />
                  <span
                    className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: laneColor }}
                  >
                    {LANE_LABELS[itemLayer]}
                  </span>
                </div>
                <h2
                  className="mt-1 truncate text-[18px] font-semibold leading-tight tracking-tight"
                  style={{
                    color: appleVibe.text.primary,
                    fontFamily: appleVibe.font.display,
                    letterSpacing: "-0.015em",
                  }}
                  title={itemName}
                >
                  {itemName}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setFullscreen((v) => !v)}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--home-chrome-fill,rgba(15,23,42,0.04))]"
                aria-label={fullscreen ? "Collapse to side card" : "Expand to full screen"}
                title={fullscreen ? "Collapse to side card" : "Expand to full screen"}
                style={{ color: appleVibe.text.secondary }}
              >
                {fullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--home-chrome-fill,rgba(15,23,42,0.04))]"
                aria-label="Close detail"
                style={{ color: appleVibe.text.secondary }}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </header>

            {/* Scrollable body */}
            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              {/* Decision Surface — quiet aggregator of every pending
                  decision on this item (conflicts, staleness, pending
                  elections). Sits ABOVE the per-section banners; this
                  is the TOC, the banners are the inline actions. Renders
                  nothing when no decisions are pending so the drawer
                  stays clean for fresh items. */}
              <DecisionSurface
                itemStaleness={staleness}
                compositionStaleness={compositionStaleness}
                briefStalenessMap={briefStalenessMap}
                conflictsOpen={expanded?.composed_design?.conflicts_open ?? []}
                variations={expanded?.variations ?? []}
                briefs={expanded?.prototype_briefs ?? []}
                onJumpTo={(anchorId) => {
                  // Smooth-scroll the target section to the top of the
                  // drawer body. Section uses scrollMarginTop:12 so it
                  // doesn't land flush against the upper edge.
                  const target =
                    typeof document !== "undefined"
                      ? document.getElementById(anchorId)
                      : null;
                  if (target) {
                    target.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }
                }}
              />

              {/* Soft-staleness banner — surfaces upstream changes
                  since this card was last expanded. Click "Refresh
                  from upstream" → force-regenerate, which pulls
                  fresh upstream depth into the prompt context.
                  Renders nothing when staleness is null or not
                  stale, so the drawer stays clean for fresh items.
                  Kept in place ALONGSIDE the Decision Surface because
                  the banner owns the ACTION (refresh button); the
                  surface owns the NAV (one click to jump here). */}
              {staleness?.is_stale && (
                <UpstreamStalenessBanner
                  staleness={staleness}
                  onRefresh={regenerateExpansion}
                  busy={expandLoading}
                />
              )}

              {/* ── 1. DEFINITION ── */}
              <Section
                icon={<BookOpen className="h-3 w-3" />}
                title="Definition"
                anchorId={DECISION_ANCHORS.definition}
                action={
                  expanded ? (
                    <div className="flex items-center gap-1">
                      {/* Thumbs rating — quality feedback on this
                          item's LLM-generated expansion. Routes to
                          PATCH /api/llm/feedback which targets the
                          most-recent llm_call_log row for this
                          (expanded_detail, entityId) tuple. */}
                      {entityId && (
                        <ThumbsRating
                          artifactKind="expanded_detail"
                          artifactId={entityId}
                          size="sm"
                        />
                      )}
                      {/* Highlights toggle — only shows when there's
                          a definition long enough to be worth
                          highlighting (>= 40 chars). */}
                      {expanded.definition &&
                        expanded.definition.length >= 40 && (
                          <button
                            type="button"
                            onClick={toggleHighlights}
                            disabled={highlightsLoading}
                            className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9.5px] font-semibold transition-colors"
                            style={{
                              background: highlightsOn
                                ? "rgba(217,179,15,0.18)"
                                : appleVibe.surface.chip,
                              color: highlightsOn
                                ? "rgba(132,103,8,0.95)"
                                : appleVibe.text.tertiary,
                              cursor: highlightsLoading ? "wait" : "pointer",
                            }}
                            aria-pressed={highlightsOn}
                            title={
                              highlightsOn
                                ? "Hide key-part highlights"
                                : "Highlight the key parts to read"
                            }
                          >
                            <Highlighter
                              className={`h-2.5 w-2.5 ${
                                highlightsLoading ? "animate-pulse" : ""
                              }`}
                              strokeWidth={2}
                            />
                            Highlights {highlightsOn ? "on" : "off"}
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={regenerateExpansion}
                        disabled={expandLoading}
                        className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9.5px] font-semibold"
                        style={{
                          background: appleVibe.surface.chip,
                          color: appleVibe.text.tertiary,
                          cursor: expandLoading ? "wait" : "pointer",
                        }}
                        title="Regenerate the AI's interpretation"
                      >
                        <RefreshCw
                          className={`h-2.5 w-2.5 ${
                            expandLoading ? "animate-spin" : ""
                          }`}
                          strokeWidth={2}
                        />
                        Regenerate
                      </button>
                    </div>
                  ) : null
                }
              >
                {expandLoading && !expanded?.definition ? (
                  <SkeletonLines lines={3} />
                ) : expandError ? (
                  <ErrorRow message={expandError} />
                ) : expanded?.definition ? (
                  <>
                    <p
                      className="text-[13px] font-light leading-relaxed"
                      style={{ color: appleVibe.text.secondary }}
                    >
                      {definitionSegments ? (
                        definitionSegments.map((seg, i) =>
                          seg.kind === "mark" ? (
                            <mark
                              key={i}
                              title={seg.why || undefined}
                              style={{
                                background: "rgba(254,243,199,0.85)",
                                color: appleVibe.text.primary,
                                padding: "1px 2px",
                                borderRadius: 3,
                                boxDecorationBreak: "clone",
                                WebkitBoxDecorationBreak: "clone",
                              }}
                            >
                              {seg.value}
                            </mark>
                          ) : (
                            <span key={i}>{seg.value}</span>
                          ),
                        )
                      ) : (
                        expanded.definition
                      )}
                    </p>
                    {/* Inline status row for highlights loading / error */}
                    {highlightsOn && highlightsLoading && (
                      <p
                        className="mt-1.5 text-[10.5px] font-light italic"
                        style={{ color: appleVibe.text.tertiary }}
                      >
                        Picking the key parts…
                      </p>
                    )}
                    {highlightsOn && highlightsError && (
                      <ErrorRow message={highlightsError} />
                    )}
                  </>
                ) : (
                  <p
                    className="text-[12px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    No definition yet.
                  </p>
                )}
              </Section>

              {/* ── MECHANISM (Arc 3.1 — technical spec, feature-only) ──
                  The Definition above says WHAT this mechanism is in
                  plain language; this section says HOW it works as a
                  system: mechanism of action (priority), active
                  ingredients (priority), then collapsible procedure /
                  components / dosage / fidelity / research basis.
                  Only meaningful for the FEATURE lane — a pain or
                  outcome has no "mechanism" to spec. */}
              {itemLayer === "features" && entityId && (
                <MechanismSpecPanel
                  entityId={entityId}
                  spec={expanded?.mechanism_spec}
                  onSpecGenerated={(s) =>
                    setExpanded((prev) =>
                      prev
                        ? { ...prev, mechanism_spec: s }
                        : { mechanism_spec: s },
                    )
                  }
                />
              )}

              {/* ── 2. INSPIRATION (per-item research) ── */}
              <Section
                icon={<Compass className="h-3 w-3" strokeWidth={1.75} />}
                title="Inspiration"
                subtitle={
                  research?.sources && research.sources.length > 0
                    ? `${research.sources.length} sources`
                    : undefined
                }
              >
                {researchLoading && !research?.sources?.length ? (
                  <SkeletonLines lines={3} />
                ) : research?.failed ||
                  !research?.sources ||
                  research.sources.length === 0 ? (
                  <p
                    className="text-[12px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    No public sources found for this item. The
                    domain may be too specific.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {research.sources.map((s, i) => (
                      <li key={i}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex flex-col gap-1 rounded-2xl p-3 transition-colors hover:bg-[color:var(--home-chrome-fill,rgba(15,23,42,0.04))]"
                          style={{
                            border: `1px solid ${appleVibe.stroke.hairline}`,
                            background: "rgba(255,255,255,0.6)",
                            borderRadius: appleVibe.radius.md,
                          }}
                        >
                          <div className="flex items-baseline gap-1.5">
                            <span
                              className="line-clamp-1 flex-1 text-[12.5px] font-semibold"
                              style={{ color: appleVibe.text.primary }}
                            >
                              {s.title}
                            </span>
                            <ExternalLink
                              className="h-2.5 w-2.5 flex-shrink-0"
                              strokeWidth={2}
                              style={{ color: appleVibe.text.tertiary }}
                            />
                          </div>
                          {s.informs && (
                            <p
                              className="text-[11px] font-medium leading-snug"
                              style={{ color: laneColor }}
                            >
                              {s.informs}
                            </p>
                          )}
                          {s.snippet && (
                            <p
                              className="line-clamp-2 text-[11px] font-light leading-snug"
                              style={{ color: appleVibe.text.secondary }}
                            >
                              {s.snippet}
                            </p>
                          )}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* ── 3. ANALYSIS SIGNALS ──
                  The cross-room findings the workbench has detected
                  on this item / room. Surfaces the LLM's accumulated
                  context so the user reads what the next regen "sees"
                  — and what their disposition does downstream
                  (Dismissed → not re-raised; Open / Acknowledged →
                  will steer the next variation generation or
                  composition). Empty state when no findings. */}
              {(crossRoomFindings.length > 0 || expanded) && (
                <Section
                  icon={<Radar className="h-3 w-3" strokeWidth={1.75} />}
                  title="Analysis signals"
                  subtitle={
                    crossRoomFindings.length > 0
                      ? buildFindingsSubtitle(crossRoomFindings)
                      : undefined
                  }
                >
                  <AnalysisSignalsList findings={crossRoomFindings} />
                </Section>
              )}

              {/* ── 4. VARIATIONS (P1+P2+P3) ──
                  Grouped by kind (alternative / additive / principle),
                  sorted by composite rank desc inside each group, each
                  card carrying:
                    • a small composite score ring + #N rank
                    • annotation-lens chips (provenance)
                    • elect / defer / reject buttons (P3 disposition)
                  Followed by the COMPOSED DESIGN surface when ≥2 are
                  elected — conflicts_open render as a loud banner. */}
              <Section
                icon={
                  <Layers
                    className="h-3 w-3"
                    strokeWidth={1.75}
                  />
                }
                // Phase 5a — Section title per scientific role:
                //   pain     → "Manifestations" (observable shapes)
                //   features → "IV Candidates" (the manipulable lever
                //              settings — only the mechanism lane carries
                //              true scientific variations)
                //   outcomes → "Measurement strategies" (how the DV
                //              gets measured)
                //   objective → "Variations" (legacy fallback)
                // Underlying data structure unchanged.
                title={
                  itemLayer === "features"
                    ? "IV Candidates"
                    : itemLayer === "pain"
                      ? "Manifestations"
                      : itemLayer === "outcomes"
                        ? "Measurement strategies"
                        : "Variations"
                }
                anchorId={DECISION_ANCHORS.variations}
                subtitle={
                  expanded?.variations && expanded.variations.length > 0
                    ? variationsSubtitle(expanded.variations)
                    : undefined
                }
              >
                {/* Cross-space KG strip — surfaces canonical concepts
                    from the user's prior spaces that the system used
                    to ground variation generation. Each variation
                    that verbatim-references one of these gets its
                    own "↻ links to" badge inside the variation card. */}
                {priorConcepts.length > 0 && (
                  <DrawerPriorConceptsStrip
                    concepts={priorConcepts}
                    onConceptClick={setOpenConceptCode}
                  />
                )}

                {/* Phase 4b — Mechanism effectiveness scoring.
                    Only renders for feature cards with at least one
                    variation. Self-contained: own state, own fetch,
                    own UI. Score lives in component state until
                    user closes the drawer (no persistence yet — that's
                    Phase 4c). */}
                {itemLayer === "features" &&
                  expanded?.variations &&
                  expanded.variations.length > 0 &&
                  entityId && (
                    <VariationScoringPanel
                      entityId={entityId}
                      itemName={itemName}
                      variations={expanded.variations}
                      initialEnvelope={reconstructEnvelopeFromExpanded(
                        expanded,
                        entityId,
                        itemName,
                      )}
                      onRefreshExpanded={refetchExpandedSoft}
                    />
                  )}

                {expandLoading && !expanded?.variations?.length ? (
                  <SkeletonLines lines={3} />
                ) : !expanded?.variations || expanded.variations.length === 0 ? (
                  <p
                    className="text-[12px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    No alternative implementations identified.
                  </p>
                ) : (
                  <VariationsGroup
                    variations={expanded.variations}
                    entityId={entityId ?? ""}
                    priorConcepts={priorConcepts}
                    onConceptClick={setOpenConceptCode}
                    onLocalUpdate={(updated) =>
                      setExpanded((prev) =>
                        prev ? { ...prev, variations: updated } : prev,
                      )
                    }
                    onComposedDesignUpdate={(cd) =>
                      setExpanded((prev) =>
                        prev ? { ...prev, composed_design: cd } : prev,
                      )
                    }
                    composedDesign={expanded.composed_design ?? null}
                    briefs={expanded.prototype_briefs ?? []}
                    onBriefGenerated={(brief) =>
                      setExpanded((prev) => {
                        if (!prev) return prev;
                        const others = (prev.prototype_briefs ?? []).filter(
                          (b) => b.id !== brief.id,
                        );
                        return {
                          ...prev,
                          prototype_briefs: [...others, brief],
                        };
                      })
                    }
                    expansionTree={expanded.expansion_tree ?? []}
                    onTreeUpdate={(nextTree) =>
                      setExpanded((prev) =>
                        prev ? { ...prev, expansion_tree: nextTree } : prev,
                      )
                    }
                    compositionStaleness={compositionStaleness}
                    onCompositionStalenessChange={setCompositionStaleness}
                    briefStalenessMap={briefStalenessMap}
                    onBriefStalenessChange={(briefId, next) =>
                      setBriefStalenessMap((prev) => {
                        const out: Record<string, StaleShape> = {
                          ...(prev ?? {}),
                        };
                        if (next === null) {
                          delete out[briefId];
                        } else {
                          out[briefId] = next;
                        }
                        return out;
                      })
                    }
                  />
                )}
              </Section>

              {/* ── Phase 11.9a — INDICATOR VALIDITY MATRIX ── */}
              {/* Decision-stakes view of the rigor stack. Renders one
                  matrix per variation that has indicator_scores. When
                  no variation has been scored yet, the section hides
                  entirely (no value showing an empty grid). */}
              {expanded?.variations &&
                expanded.variations.some(
                  (v) =>
                    Array.isArray(v.indicator_scores) &&
                    v.indicator_scores.length > 0,
                ) && (
                  <Section
                    icon={<BarChart3 className="h-3 w-3" />}
                    title="Validity Matrix"
                  >
                    <div className="space-y-3">
                      {expanded.variations
                        .filter(
                          (v) =>
                            Array.isArray(v.indicator_scores) &&
                            v.indicator_scores.length > 0,
                        )
                        .map((v) => (
                          <IndicatorValidityMatrix
                            key={v.id}
                            variation={v}
                          />
                        ))}
                    </div>
                  </Section>
                )}

              {/* ── Phase 11.9b — GOODHART PAIRINGS PANEL ── */}
              {/* Counter-indicators ensemble proposed (Phase 11.3) but
                  no UI surface had been rendering. Surfaces the yang/yin
                  pairing per outcome so the user actually sees the
                  Goodhart antidote they should track alongside the
                  primary indicator set. Always rendered (use_case_mode
                  agnostic) when counter_indicators are present. */}
              {expanded?.effectiveness_envelope?.counter_indicators &&
                expanded.effectiveness_envelope.counter_indicators.length >
                  0 && (
                  <Section
                    icon={<Shield className="h-3 w-3" />}
                    title="Goodhart Pairings"
                  >
                    <GoodhartPairingsPanel
                      counterIndicators={
                        expanded.effectiveness_envelope.counter_indicators
                      }
                    />
                  </Section>
                )}

              {/* ── 4. PLANNING (assumes / depends_on / risks) ── */}
              <Section
                icon={<Shield className="h-3 w-3" strokeWidth={1.75} />}
                title="Planning"
              >
                {expandLoading && !expanded?.planning ? (
                  <SkeletonLines lines={3} />
                ) : !expanded?.planning ? (
                  <p
                    className="text-[12px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    No planning surface yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {expanded.planning.assumes.length > 0 && (
                      <PlanningGroup
                        label="Assumes"
                        items={expanded.planning.assumes}
                        tone="info"
                      />
                    )}
                    {expanded.planning.depends_on.length > 0 && (
                      <PlanningGroup
                        label="Depends on"
                        items={expanded.planning.depends_on}
                        tone="neutral"
                      />
                    )}
                    {expanded.planning.risks.length > 0 && (
                      <PlanningGroup
                        label="Risks"
                        items={expanded.planning.risks}
                        tone="warn"
                      />
                    )}
                  </div>
                )}
              </Section>

              {/* ── 5. LINKED CHAINS ── */}
              <Section
                icon={<Link2 className="h-3 w-3" strokeWidth={1.75} />}
                title="In chains"
                subtitle={
                  linkedChains.length > 0
                    ? `${linkedChains.length} ${
                        linkedChains.length === 1 ? "chain" : "chains"
                      }`
                    : undefined
                }
              >
                {linkedChains.length === 0 ? (
                  <p
                    className="text-[12px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Not yet part of a complete chain.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {linkedChains.slice(0, 8).map((c, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2"
                        style={{
                          background: c.approved
                            ? "rgba(22,163,74,0.04)"
                            : "rgba(255,255,255,0.6)",
                          border: `1px solid ${
                            c.approved
                              ? "rgba(22,163,74,0.22)"
                              : appleVibe.stroke.hairline
                          }`,
                          borderRadius: appleVibe.radius.md,
                        }}
                      >
                        <span
                          className="line-clamp-1 flex-1 text-[11.5px] font-medium"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {c.label}
                        </span>
                        <span
                          className="font-mono text-[10px]"
                          style={{ color: appleVibe.text.tertiary }}
                        >
                          {c.pct}%
                        </span>
                        <ChevronRight
                          className="h-3 w-3 flex-shrink-0"
                          strokeWidth={2}
                          style={{ color: appleVibe.text.tertiary }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* Footer — Commit B will add "Expand into sub-room" here */}
              <div
                className="pt-2"
                style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
              >
                <button
                  type="button"
                  disabled
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-2xl px-3 py-2.5 text-[12px] font-semibold opacity-60"
                  style={{
                    background: appleVibe.surface.chip,
                    color: appleVibe.text.tertiary,
                    borderRadius: appleVibe.radius.md,
                    cursor: "not-allowed",
                  }}
                  title="Coming in the next commit"
                >
                  <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
                  Expand into sub-room (Coming soon)
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
      {/* Cross-space KG drawer — opened by clicking any prior-concept
          chip. Mounted as a sibling of the item drawer so it can
          render its own slide-in (which will OVERLAY the item
          drawer; clicking close returns to it). */}
      {openConceptCode && (
        <CanonicalConceptDrawer
          canonicalCode={openConceptCode}
          onClose={() => setOpenConceptCode(null)}
          currentSpaceId={spaceId}
        />
      )}
    </AnimatePresence>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function hasDefinition(d: ExpandedItemDetail | null | undefined): boolean {
  return !!d?.definition && d.definition.length > 0;
}

/** Arc 2 — defensively strip a leading header line from a prototype
 *  brief's artifact_body. The prompt now instructs the LLM not to
 *  emit one, but older briefs (or the occasional drift) open with a
 *  markdown header ("## What you produce…") or an echoed intro line.
 *  Drops a single leading line when it's a markdown header or matches
 *  the boilerplate intro, so it doesn't double-print under the
 *  section label. Leaves normal content untouched. */
function stripLeadingHeader(body: string): string {
  const lines = body.split("\n");
  if (lines.length === 0) return body;
  const first = lines[0].trim();
  const looksLikeHeader =
    /^#{1,6}\s/.test(first) || // markdown header
    /^(here'?s\s+)?what\s+you('?ll|\s+will)?\s+produce/i.test(first) ||
    /^deliverable\b/i.test(first) ||
    /^artifact\b/i.test(first);
  if (looksLikeHeader) {
    // Drop the header line + any immediately-following blank line.
    let rest = lines.slice(1);
    while (rest.length > 0 && rest[0].trim() === "") rest = rest.slice(1);
    return rest.join("\n");
  }
  return body;
}

function Section({
  icon,
  title,
  subtitle,
  action,
  children,
  /** Optional id on the <section> element — set when this section
   *  is a smooth-scroll target from the Decision Surface (or any
   *  other in-drawer nav). Defaults to undefined so non-targeted
   *  sections stay tag-clean. scrollMarginTop keeps the header from
   *  being flush with the drawer top edge after jumping. */
  anchorId,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  anchorId?: string;
}) {
  return (
    <section id={anchorId} style={{ scrollMarginTop: 12 }}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span style={{ color: appleVibe.text.tertiary }}>{icon}</span>
          <h3
            className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            {title}
          </h3>
          {subtitle && (
            <span
              className="text-[10px] font-light"
              style={{ color: appleVibe.text.faint }}
            >
              · {subtitle}
            </span>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function PlanningGroup({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "info" | "neutral" | "warn";
}) {
  const tones: Record<
    typeof tone,
    { color: string; bg: string; border: string; icon?: React.ReactNode }
  > = {
    info: {
      color: "rgba(30,64,175,0.95)",
      bg: "rgba(37,99,235,0.06)",
      border: "rgba(37,99,235,0.18)",
    },
    neutral: {
      color: appleVibe.text.secondary,
      bg: "rgba(255,255,255,0.6)",
      border: appleVibe.stroke.hairline,
    },
    warn: {
      color: "rgba(127,29,29,0.95)",
      bg: "rgba(220,38,38,0.05)",
      border: "rgba(220,38,38,0.18)",
      icon: <AlertCircle className="h-2.5 w-2.5" strokeWidth={2} />,
    },
  };
  const t = tones[tone];
  return (
    <div>
      <div
        className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: t.color }}
      >
        {t.icon}
        {label}
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((it, i) => (
          <li
            key={i}
            className="rounded-xl px-2.5 py-1.5 text-[11.5px] font-light leading-snug"
            style={{
              background: t.bg,
              border: `1px solid ${t.border}`,
              color: appleVibe.text.primary,
            }}
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkeletonLines({ lines }: { lines: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded-md"
          style={{
            background: appleVibe.surface.chip,
            width: i === lines - 1 ? "70%" : "100%",
          }}
        />
      ))}
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl px-3 py-2 text-[11px]"
      style={{
        background: "rgba(220,38,38,0.06)",
        border: "1px solid rgba(220,38,38,0.18)",
        color: "rgba(127,29,29,0.95)",
      }}
    >
      {message}
    </div>
  );
}

// ── Highlight segment builder ────────────────────────────────────────
//
// Walks the source text + sorted highlight offsets and returns a flat
// list of segments (plain text | mark). Mirrors the buildSegments
// pattern in annotated-objective-card but for the simpler highlight
// shape (no annotation/popover machinery).

type HighlightSegment =
  | { kind: "text"; value: string }
  | { kind: "mark"; value: string; why: string };

function buildHighlightSegments(
  text: string,
  highlights: DefinitionHighlight[],
): HighlightSegment[] {
  if (highlights.length === 0) return [{ kind: "text", value: text }];
  const out: HighlightSegment[] = [];
  let cursor = 0;
  for (const h of highlights) {
    if (h.start_offset > cursor) {
      out.push({ kind: "text", value: text.slice(cursor, h.start_offset) });
    }
    out.push({
      kind: "mark",
      value: text.slice(h.start_offset, h.end_offset),
      why: h.why,
    });
    cursor = h.end_offset;
  }
  if (cursor < text.length) {
    out.push({ kind: "text", value: text.slice(cursor) });
  }
  return out;
}

// ── Variations subtitle ───────────────────────────────────────────────
//
// Counts elected + total so the section header reads
// "5 ways · 2 elected" when the user has started electing.
function variationsSubtitle(vs: ItemVariation[]): string {
  const total = vs.length;
  const elected = vs.filter((v) => v.disposition === "elected").length;
  if (elected === 0) return `${total} ways`;
  return `${total} ways · ${elected} elected`;
}

// ── Analysis signals subsection ───────────────────────────────────────
//
// Renders the cross_room_findings the route already filtered to THIS
// item / room. The user sees what the workbench has detected AND what
// their disposition does downstream — closing the mental-model gap
// where loop #3/#4/#5 LLM context was previously invisible.

function buildFindingsSubtitle(items: DrawerCrossRoomFinding[]): string {
  const open = items.filter((f) => f.disposition === "open").length;
  const ack = items.filter((f) => f.disposition === "acknowledged").length;
  const dis = items.filter((f) => f.disposition === "dismissed").length;
  const live = open + ack;
  if (live === 0 && dis === 0) return "";
  const parts: string[] = [];
  if (live > 0) parts.push(`${live} active`);
  if (dis > 0) parts.push(`${dis} dismissed`);
  return parts.join(" · ");
}

/** Order of kinds in the rendered list — most "loud" signals first
 *  so the user reads structural blockers before consistency hints. */
const FINDING_KIND_ORDER: Record<
  DrawerCrossRoomFinding["kind"],
  number
> = {
  pain_uncovered: 0,
  contradiction: 1,
  pain_cross_addressed: 2,
  duplicate_variation: 3,
  shared_mechanism: 4,
  annotation_overlap: 5,
};

const FINDING_KIND_LABEL: Record<DrawerCrossRoomFinding["kind"], string> = {
  pain_uncovered: "Uncovered pain",
  contradiction: "Cross-room contradiction",
  pain_cross_addressed: "Addressed elsewhere",
  duplicate_variation: "Duplicate variation",
  shared_mechanism: "Shared mechanism",
  annotation_overlap: "Annotation overlap",
};

/** Disposition microcopy — Apple-tier mental model. Each line says
 *  what the user's stance ACTUALLY does on the next regen. */
const DISPOSITION_HINT: Record<
  DrawerCrossRoomFinding["disposition"],
  string
> = {
  open: "Will steer the next regen — surfaces as a counter-variation or conflict_open.",
  acknowledged:
    "You've seen this; still actively shaping the next regen same as Open.",
  dismissed:
    "You declared this intentional. The next regen will NOT re-raise it as a conflict.",
};

function AnalysisSignalsList({
  findings,
}: {
  findings: DrawerCrossRoomFinding[];
}) {
  if (findings.length === 0) {
    return (
      <p
        className="text-[12px] font-light italic"
        style={{ color: appleVibe.text.tertiary }}
      >
        No cross-room signals yet on this item. Run an analysis from the
        workbench (Distill, Recommend next move) and any structural
        patterns it surfaces will appear here.
      </p>
    );
  }
  const sorted = [...findings].sort(
    (a, b) => FINDING_KIND_ORDER[a.kind] - FINDING_KIND_ORDER[b.kind],
  );
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((f) => (
        <AnalysisSignalCard key={f.id} finding={f} />
      ))}
    </ul>
  );
}

function AnalysisSignalCard({
  finding,
}: {
  finding: DrawerCrossRoomFinding;
}) {
  // Disposition palette — restrained, semantic. Open uses lane-color
  // family (system is "looking at this"), acknowledged uses amber
  // (user-noted, still active), dismissed uses neutral grey (closed,
  // quiet).
  const dispositionStyle: Record<
    DrawerCrossRoomFinding["disposition"],
    { bg: string; fg: string; border: string }
  > = {
    open: {
      bg: "rgba(15,23,42,0.05)",
      fg: appleVibe.text.primary,
      border: appleVibe.stroke.hairline,
    },
    acknowledged: {
      bg: "rgba(217,119,6,0.08)",
      fg: "rgba(146,64,14,0.92)",
      border: "rgba(217,119,6,0.18)",
    },
    dismissed: {
      bg: "rgba(15,23,42,0.03)",
      fg: appleVibe.text.tertiary,
      border: appleVibe.stroke.hairline,
    },
  };
  const ds = dispositionStyle[finding.disposition];
  const isDismissed = finding.disposition === "dismissed";

  return (
    <li>
      <div
        className="flex flex-col gap-1.5 p-3"
        style={{
          border: `1px solid ${appleVibe.stroke.hairline}`,
          background: isDismissed ? "rgba(15,23,42,0.02)" : "#ffffff",
          borderRadius: appleVibe.radius.md,
          // Dismissed cards visually recede — opacity, not strikethrough.
          opacity: isDismissed ? 0.7 : 1,
        }}
      >
        {/* Header row: kind label + disposition pill */}
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            {FINDING_KIND_LABEL[finding.kind]}
          </span>
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
            style={{
              background: ds.bg,
              color: ds.fg,
              border: `1px solid ${ds.border}`,
            }}
          >
            {finding.disposition}
          </span>
        </div>
        {/* Title — the workbench finding's headline */}
        <p
          className="text-[13px] font-semibold leading-snug"
          style={{
            color: isDismissed ? appleVibe.text.secondary : appleVibe.text.primary,
          }}
        >
          {finding.title}
        </p>
        {/* Body / hint — the substance the user reads */}
        {finding.hint && (
          <p
            className="text-[11px] font-medium leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {finding.hint}
          </p>
        )}
        <p
          className="text-[11px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {finding.summary}
        </p>
        {/* Disposition microcopy — load-bearing affordance:
            tells the user what their stance DOES downstream. */}
        <p
          className="border-t pt-1.5 text-[10px] font-light italic leading-snug"
          style={{
            borderColor: appleVibe.stroke.hairline,
            color: appleVibe.text.tertiary,
          }}
        >
          {DISPOSITION_HINT[finding.disposition]}
        </p>
      </div>
    </li>
  );
}

// ── Variations group ──────────────────────────────────────────────────
//
// Renders variations grouped by kind (alternative → additive →
// principle), each group sorted by composite rank desc. Handles all
// disposition mutations + composition fire-on-elect.

type StalenessShape = {
  is_stale: boolean;
  last_upstream_change_at: string | null;
  changes: Array<{
    source_name: string;
    kind:
      | "expand"
      | "spawn"
      | "disposition"
      | "local_variations"
      | "local_composition";
    changed_at: string;
  }>;
};

function VariationsGroup({
  variations,
  entityId,
  priorConcepts = [],
  onConceptClick,
  onLocalUpdate,
  onComposedDesignUpdate,
  composedDesign,
  briefs,
  onBriefGenerated,
  expansionTree,
  onTreeUpdate,
  compositionStaleness,
  onCompositionStalenessChange,
  briefStalenessMap,
  onBriefStalenessChange,
}: {
  variations: ItemVariation[];
  entityId: string;
  /** Cross-space KG concepts surfaced by the expand route — used to
   *  compute per-variation "↻ links to" badges via verbatim
   *  display_name substring match against name + description +
   *  tradeoff. */
  priorConcepts?: Array<{
    id: string;
    canonical_code: string;
    display_name: string;
    description: string | null;
    domain_tags: string[];
    space_count: number;
  }>;
  /** Click handler for the per-variation "↻ links to" badges —
   *  opens CanonicalConceptDrawer at the parent level. */
  onConceptClick?: (canonicalCode: string) => void;
  onLocalUpdate: (next: ItemVariation[]) => void;
  onComposedDesignUpdate: (cd: ComposedDesign | null) => void;
  composedDesign: ComposedDesign | null;
  briefs: PrototypeBrief[];
  onBriefGenerated: (brief: PrototypeBrief) => void;
  expansionTree: ExpansionNodeLocal[];
  onTreeUpdate: (next: ExpansionNodeLocal[]) => void;
  /** Composition + brief staleness — source of truth lives in the
   *  outer drawer (populated by the /expand response), passed here
   *  so the section renders banners on open without re-fetching.
   *  The setters let fireCompose / generateBrief overwrite the
   *  stored values after a force-regen returns no staleness. */
  compositionStaleness: StalenessShape | null;
  onCompositionStalenessChange: (next: StalenessShape | null) => void;
  briefStalenessMap: Record<string, StalenessShape> | null;
  onBriefStalenessChange: (
    briefId: string,
    next: StalenessShape | null,
  ) => void;
}) {
  // Optimistic disposition update — flips state immediately so the
  // UI feels instant, fires the PATCH in the background.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Group by kind, preserving stable order. Within group: sort desc
  // by composite rank, falling back to original order for items
  // without a rank.
  const grouped = useMemo(() => {
    const byKind: Record<VariationKind, ItemVariation[]> = {
      alternative: [],
      additive: [],
      principle: [],
    };
    variations.forEach((v) => {
      const k = (v.kind ?? "alternative") as VariationKind;
      byKind[k].push(v);
    });
    // Single-axis sort: addresses_pain desc.
    (Object.keys(byKind) as VariationKind[]).forEach((k) => {
      byKind[k].sort(
        (a, b) => (b.addresses_pain ?? 0.5) - (a.addresses_pain ?? 0.5),
      );
    });
    return byKind;
  }, [variations]);

  const electedCount = variations.filter((v) => v.disposition === "elected").length;
  const canCompose = electedCount >= 2;

  // Compose state — fires after election change crosses ≥2 threshold.
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  const updateDisposition = useCallback(
    async (variationId: string, disposition: VariationDisposition) => {
      if (!entityId || !variationId) return;
      setBusyId(variationId);
      setError(null);

      // Arc 2 — single-select enforcement for the "alternative" kind.
      // Alternatives are mutually exclusive by definition (the label
      // says "choose one design pattern"), so electing one clears any
      // sibling alternative that was already elected — radio-button
      // behavior. Additive + principle kinds stay multi-select (they
      // stack / apply across). This makes the behavior match the
      // subtitle the user flagged as a mismatch.
      const target = variations.find((v) => v.id === variationId);
      const siblingsToClear =
        disposition === "elected" && target?.kind === "alternative"
          ? variations.filter(
              (v) =>
                v.kind === "alternative" &&
                v.id !== variationId &&
                v.disposition === "elected" &&
                !!v.id,
            )
          : [];

      // Optimistic local mutation so the UI is instant — apply the
      // target's new disposition AND clear any displaced siblings.
      const clearIds = new Set(siblingsToClear.map((s) => s.id));
      const next = variations.map((v) => {
        if (v.id === variationId) return { ...v, disposition };
        if (v.id && clearIds.has(v.id))
          return { ...v, disposition: null as VariationDisposition };
        return v;
      });
      onLocalUpdate(next);

      try {
        const res = await fetch(
          "/api/brainstorm/item/variation/disposition",
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ entityId, variationId, disposition }),
          },
        );
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error ?? "Failed to save disposition.");
          onLocalUpdate(variations); // revert
          return;
        }
        // Persist the sibling clears too. Fire in parallel; soft-fail
        // per sibling so one network hiccup doesn't revert the whole
        // election. The optimistic local state already reflects them.
        if (siblingsToClear.length > 0) {
          await Promise.all(
            siblingsToClear.map((s) =>
              fetch("/api/brainstorm/item/variation/disposition", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  entityId,
                  variationId: s.id,
                  disposition: null,
                }),
              }).catch(() => undefined),
            ),
          );
        }
        // Election set changed — server invalidated composition.
        if (json?.composed_design_invalidated) {
          onComposedDesignUpdate(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
        onLocalUpdate(variations); // revert
      } finally {
        setBusyId(null);
      }
    },
    [entityId, variations, onLocalUpdate, onComposedDesignUpdate],
  );

  const fireCompose = useCallback(
    async (force = false) => {
      if (!entityId || electedCount < 2) return;
      setComposing(true);
      setComposeError(null);
      try {
        const res = await fetch("/api/brainstorm/item/compose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entityId,
            mode: force ? "force" : "default",
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setComposeError(json?.error ?? "Composition failed.");
          return;
        }
        if (json?.composed_design) {
          onComposedDesignUpdate(json.composed_design as ComposedDesign);
        }
        // Capture composition staleness when the server returned it
        // (only on cache-hits — fresh compositions are never stale).
        // Clear stale state on force-regen so the banner doesn't
        // linger after a refresh.
        if (
          json?.composition_staleness &&
          typeof json.composition_staleness === "object"
        ) {
          onCompositionStalenessChange(json.composition_staleness);
        } else {
          onCompositionStalenessChange(null);
        }
      } catch (err) {
        setComposeError(
          err instanceof Error ? err.message : "Network error.",
        );
      } finally {
        setComposing(false);
      }
    },
    [
      entityId,
      electedCount,
      onComposedDesignUpdate,
      onCompositionStalenessChange,
    ],
  );

  // Auto-fire compose when crossing into ≥2 elections AND no cache
  // matches. The /compose endpoint is idempotent against the elected
  // set, so this is safe to call as the user toggles.
  useEffect(() => {
    if (!canCompose) return;
    if (composedDesign) return; // already populated
    if (composing) return;
    void fireCompose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCompose, composedDesign]);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div
          className="rounded-xl px-3 py-2 text-[11.5px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "rgba(127,29,29,0.95)",
          }}
        >
          {error}
        </div>
      )}

      {(["alternative", "additive", "principle"] as VariationKind[]).map(
        (kind) => {
          const items = grouped[kind];
          if (items.length === 0) return null;
          return (
            <div key={kind} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {KIND_LABEL[kind]}
                </span>
                <span
                  className="text-[10.5px] font-light italic"
                  style={{ color: appleVibe.text.tertiary }}
                  title={KIND_DESCRIPTION[kind]}
                >
                  · {KIND_DESCRIPTION[kind]}
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {items.map((v, idx) => {
                  // Per-variation KG link badges — verbatim
                  // substring match between this variation's text
                  // (name + description + tradeoff) and each prior
                  // concept's display_name. Caps at 3 chips to keep
                  // the card dense.
                  const haystack = `${v.name} ${v.description} ${v.tradeoff}`
                    .toLowerCase();
                  const linkedConcepts = priorConcepts
                    .filter((c) => {
                      if (c.display_name.length < 4) return false;
                      return haystack.includes(c.display_name.toLowerCase());
                    })
                    .map((c) => ({
                      display_name: c.display_name,
                      space_count: c.space_count,
                      canonical_code: c.canonical_code,
                    }))
                    .sort((a, b) => b.space_count - a.space_count)
                    .slice(0, 3);
                  return (
                    <VariationCard
                      key={v.id ?? `${kind}-${idx}`}
                      variation={v}
                      rank={idx + 1}
                      total={items.length}
                      busy={busyId === v.id}
                      onElect={() => updateDisposition(v.id ?? "", "elected")}
                      onReject={() => updateDisposition(v.id ?? "", "rejected")}
                      onDefer={() => updateDisposition(v.id ?? "", "deferred")}
                      onClear={() => updateDisposition(v.id ?? "", null)}
                      entityId={entityId}
                      briefs={briefs}
                      onBriefGenerated={onBriefGenerated}
                      expansionTree={expansionTree}
                      onExpansionTreeUpdate={onTreeUpdate}
                      linkedConcepts={linkedConcepts}
                      onConceptClick={onConceptClick}
                      briefStalenessMap={briefStalenessMap}
                      onBriefStalenessChange={onBriefStalenessChange}
                    />
                  );
                })}
              </ul>
            </div>
          );
        },
      )}

      {/* ── Composed design surface (P3) ─────────────────────────── */}
      {(canCompose || composedDesign) && (
        <ComposedDesignBlock
          composedDesign={composedDesign}
          composing={composing}
          composeError={composeError}
          electedCount={electedCount}
          canCompose={canCompose}
          onRegenerate={() => fireCompose(true)}
          compositionStaleness={compositionStaleness}
        />
      )}
    </div>
  );
}

// ── Variation card ────────────────────────────────────────────────────

function VariationCard({
  variation: v,
  rank,
  total,
  busy,
  onElect,
  onReject,
  onDefer,
  onClear,
  entityId,
  briefs,
  onBriefGenerated,
  expansionTree,
  onExpansionTreeUpdate,
  linkedConcepts = [],
  onConceptClick,
  briefStalenessMap,
  onBriefStalenessChange,
}: {
  variation: ItemVariation;
  rank: number;
  total: number;
  busy: boolean;
  onElect: () => void;
  onReject: () => void;
  onDefer: () => void;
  onClear: () => void;
  entityId: string;
  briefs: PrototypeBrief[];
  onBriefGenerated: (brief: PrototypeBrief) => void;
  expansionTree: ExpansionNodeLocal[];
  onExpansionTreeUpdate: (next: ExpansionNodeLocal[]) => void;
  /** Cross-space KG link badges — canonical concepts this
   *  variation's text verbatim references. Pre-computed by the
   *  parent VariationsGroup against priorConcepts + the variation's
   *  name+description+tradeoff. Each chip carries display_name +
   *  cross-space evidence + canonical_code so the user feels their
   *  KG accumulating AND can drill in. */
  linkedConcepts?: Array<{
    display_name: string;
    space_count: number;
    canonical_code: string;
  }>;
  /** Chip click → opens CanonicalConceptDrawer at the parent. */
  onConceptClick?: (canonicalCode: string) => void;
  /** Brief staleness map + setter, threaded straight through to
   *  OpenQuestionsList. The card doesn't read it directly. */
  briefStalenessMap: Record<string, StalenessShape> | null;
  onBriefStalenessChange: (
    briefId: string,
    next: StalenessShape | null,
  ) => void;
}) {
  const elected = v.disposition === "elected";
  const rejected = v.disposition === "rejected";
  const deferred = v.disposition === "deferred";
  // Single-axis score: addresses_pain. The user pushed back on
  // multi-axis composites — alignment/evidence/tradeoff_severity
  // are LLM-internal production constraints, not visible scores.
  const score = v.addresses_pain ?? 0.5;

  // Border + opacity reflect disposition: elected glows green,
  // rejected fades, deferred stays neutral with a muted dot.
  const border = elected
    ? "rgba(22,163,74,0.45)"
    : appleVibe.stroke.hairline;
  const opacity = rejected ? 0.55 : 1;

  // Apple-tier nested elevation. Variations live INSIDE a lane-colored
  // drawer so they read as subordinate — neutral graphite alpha for
  // hover ring (not a lane color, which would compete). Elected ring
  // takes precedence as a stronger semantic signal.
  const restShadow = elected
    ? "0 0 0 3px rgba(22,163,74,0.12), 0 10px 24px -14px rgba(22,163,74,0.40)"
    : appleVibe.shadow.chip;
  const hoverShadow = elected
    ? "0 0 0 3px rgba(22,163,74,0.20), 0 14px 32px -14px rgba(22,163,74,0.55)"
    : "0 0 0 1px rgba(15,23,42,0.10), 0 14px 28px -14px rgba(11,18,40,0.22)";

  return (
    <motion.li
      layout
      initial={false}
      whileHover={
        rejected
          ? undefined
          : {
              y: -1,
              boxShadow: hoverShadow,
              transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
            }
      }
      whileTap={
        rejected
          ? undefined
          : { y: 0.5, transition: { duration: 0.08 } }
      }
      className="p-3"
      style={{
        border: `1px solid ${border}`,
        background: elected ? "rgba(240,253,244,0.75)" : "rgba(255,255,255,0.85)",
        borderRadius: appleVibe.radius.md,
        opacity,
        boxShadow: restShadow,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <RankRing value={score} />
            <span
              className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: appleVibe.text.tertiary }}
              title={`Addresses pain ${(score * 100).toFixed(0)}/100 · #${rank} of ${total} in this group`}
            >
              #{rank}
            </span>
            <div
              className="line-clamp-2 text-[12.5px] font-semibold"
              style={{ color: appleVibe.text.primary }}
            >
              {v.name}
            </div>
          </div>
        </div>
        <DispositionControls
          disposition={v.disposition ?? null}
          busy={busy}
          onElect={onElect}
          onReject={onReject}
          onDefer={onDefer}
          onClear={onClear}
        />
      </div>

      {v.description && (
        <p
          className="mt-1.5 text-[11.5px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {v.description}
        </p>
      )}
      {v.tradeoff && (
        <p
          className="mt-1.5 text-[11px] font-light leading-snug"
          style={{ color: appleVibe.text.tertiary }}
        >
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Tradeoff:
          </span>{" "}
          <span className="italic">{v.tradeoff}</span>
        </p>
      )}

      {/* Cross-space KG badges — canonical concepts this variation's
          text verbatim references. Pre-computed by the parent. */}
      {linkedConcepts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span
            className="text-[9px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: "rgba(91,33,182,0.95)" }}
          >
            ↻ links to
          </span>
          {linkedConcepts.map((c) =>
            onConceptClick ? (
              <button
                type="button"
                key={c.display_name}
                onClick={(e) => {
                  e.stopPropagation();
                  onConceptClick(c.canonical_code);
                }}
                className="inline-flex max-w-[200px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-[rgba(124,58,237,0.16)]"
                style={{
                  background: "rgba(124,58,237,0.08)",
                  color: "rgba(91,33,182,0.95)",
                  border: "1px solid rgba(124,58,237,0.18)",
                  cursor: "pointer",
                }}
                title={`Used in ${c.space_count} of your space${c.space_count === 1 ? "" : "s"} · click to open cross-space view`}
              >
                <span className="truncate">{c.display_name}</span>
                {c.space_count > 1 && (
                  <span
                    className="font-mono text-[8.5px]"
                    style={{ color: "rgba(91,33,182,0.75)" }}
                  >
                    {c.space_count}×
                  </span>
                )}
              </button>
            ) : (
              <span
                key={c.display_name}
                className="inline-flex max-w-[200px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background: "rgba(124,58,237,0.08)",
                  color: "rgba(91,33,182,0.95)",
                  border: "1px solid rgba(124,58,237,0.18)",
                }}
                title={`Used in ${c.space_count} of your space${c.space_count === 1 ? "" : "s"}`}
              >
                <span className="truncate">{c.display_name}</span>
                {c.space_count > 1 && (
                  <span
                    className="font-mono text-[8.5px]"
                    style={{ color: "rgba(91,33,182,0.75)" }}
                  >
                    {c.space_count}×
                  </span>
                )}
              </span>
            ),
          )}
        </div>
      )}

      {/* B — Open questions. The primary trigger for the prototype
          lab (L3): each becomes one constraint × variation ×
          open-question triple that yields a surgical experiment. */}
      {v.open_questions && v.open_questions.length > 0 && (
        <OpenQuestionsList
          variation={v}
          entityId={entityId ?? ""}
          briefs={briefs}
          onBriefGenerated={onBriefGenerated}
          briefStalenessMap={briefStalenessMap}
          onBriefStalenessChange={onBriefStalenessChange}
        />
      )}

      {/* Annotation lens chips. */}
      {v.derived_from_annotations && v.derived_from_annotations.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span
            className="text-[9px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            derived from
          </span>
          {v.derived_from_annotations.map((p) => (
            <span
              key={`${p.index}-${p.facet}`}
              className="inline-flex max-w-[150px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium"
              style={{
                background: "rgba(15,23,42,0.035)",
                color: appleVibe.text.secondary,
                border: `1px solid ${appleVibe.stroke.hairline}`,
              }}
              title={`${p.facet} · ${p.phrase}`}
            >
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: FACET_COLOR[p.facet] }}
                aria-hidden
              />
              <span className="truncate">{p.phrase}</span>
            </span>
          ))}
        </div>
      )}

      {deferred && (
        <div
          className="mt-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium"
          style={{
            background: "rgba(217,119,6,0.10)",
            color: "rgba(146,64,14,0.95)",
            border: "1px solid rgba(217,119,6,0.22)",
          }}
        >
          <Pause className="h-2.5 w-2.5" strokeWidth={2} />
          Deferred
        </div>
      )}

      {/* E — Variation expansion: [+] Deepen button + inline tree
          of L3+ children. Only renders when entityId + variation id
          are present (the route needs both). */}
      {entityId && v.id && (
        <ExpansionPanel
          entityId={entityId}
          attachPoint="variation"
          attachRef={v.id}
          parentTitle={v.name}
          parentDescription={`${v.description}${v.tradeoff ? `  (tradeoff: ${v.tradeoff})` : ""}`}
          expansionTree={expansionTree}
          onTreeUpdate={onExpansionTreeUpdate}
        />
      )}

      {/* Phase 12 + 13 — Deliverables affordance. Only shows on
          ELECTED variations (the user signaled they're committed to
          this direction) to avoid generating LLM mockups for
          variations the user is still browsing. Modal handles both
          HTML mockup + export prompt with lazy generation. */}
      {elected && entityId && v.id && (
        <VariationDeliverablesLauncher
          entityId={entityId}
          variation={v}
        />
      )}
    </motion.li>
  );
}

// ── Variation deliverables launcher — pill + modal ───────────────
//
// Tiny wrapper that owns the modal open state so we don't bloat
// VariationCard's signature. Lazy-imports VariationDeliverablesModal
// only when the user clicks — saves bundle weight on variation lists
// where most variations never get the modal opened.

function VariationDeliverablesLauncher({
  entityId,
  variation,
}: {
  entityId: string;
  variation: ItemVariation;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mt-2 flex items-center justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors hover:bg-[rgba(15,23,42,0.04)]"
          style={{
            background: "transparent",
            color: appleVibe.text.secondary,
            border: `1px solid ${appleVibe.stroke.medium}`,
          }}
          title="Generate HTML mockup + export prompt for this variation"
        >
          <FileCode className="h-2.5 w-2.5" strokeWidth={2.4} />
          Deliverables
        </button>
      </div>
      {open && variation.id && (
        <VariationDeliverablesModal
          open={open}
          onClose={() => setOpen(false)}
          entityId={entityId}
          variationId={variation.id}
          variationName={variation.name}
          initialMockupHtml={variation.mockup_html}
          initialExportPrompt={variation.export_prompt}
          initialDescriptionDoc={variation.description_doc}
          initialExportPromptHistory={variation.export_prompt_history}
        />
      )}
    </>
  );
}

// ── Disposition controls — three-state toggle (elect / defer / reject) ─

function DispositionControls({
  disposition,
  busy,
  onElect,
  onReject,
  onDefer,
  onClear,
}: {
  disposition: VariationDisposition;
  busy: boolean;
  onElect: () => void;
  onReject: () => void;
  onDefer: () => void;
  onClear: () => void;
}) {
  const elected = disposition === "elected";
  const rejected = disposition === "rejected";
  const deferred = disposition === "deferred";

  function btn(
    onClick: () => void,
    active: boolean,
    activeBg: string,
    activeColor: string,
    Icon: typeof Check,
    title: string,
  ) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          // Clicking the same active state CLEARS it (toggle off).
          if (active) onClear();
          else onClick();
        }}
        disabled={busy}
        title={title}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full transition-all"
        style={{
          background: active ? activeBg : "rgba(15,23,42,0.04)",
          color: active ? activeColor : appleVibe.text.tertiary,
          border: `1px solid ${active ? activeColor : appleVibe.stroke.hairline}`,
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
      </button>
    );
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      {btn(
        onElect,
        elected,
        "rgba(22,163,74,0.18)",
        "rgba(20,83,45,0.95)",
        Check,
        elected ? "Elected — click to clear" : "Elect this variation",
      )}
      {btn(
        onDefer,
        deferred,
        "rgba(217,119,6,0.18)",
        "rgba(146,64,14,0.95)",
        Pause,
        deferred ? "Deferred — click to clear" : "Defer",
      )}
      {btn(
        onReject,
        rejected,
        "rgba(220,38,38,0.18)",
        "rgba(127,29,29,0.95)",
        X,
        rejected ? "Rejected — click to clear" : "Reject",
      )}
    </div>
  );
}

// ── Composite score ring (svg) ─────────────────────────────────────────

function RankRing({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  const r = 7;
  const c = 2 * Math.PI * r;
  const filled = c * v;
  const color =
    v >= 0.7
      ? "rgba(22,163,74,0.85)"
      : v >= 0.4
        ? "rgba(217,119,6,0.85)"
        : "rgba(220,38,38,0.85)";
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      className="flex-shrink-0"
      aria-label={`Composite rank ${(v * 100).toFixed(0)} of 100`}
    >
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="rgba(15,23,42,0.08)"
        strokeWidth="2"
      />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={`${filled} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

// ── Composed design block (P3) ─────────────────────────────────────────

function ComposedDesignBlock({
  composedDesign,
  composing,
  composeError,
  electedCount,
  canCompose,
  onRegenerate,
  compositionStaleness,
}: {
  composedDesign: ComposedDesign | null;
  composing: boolean;
  composeError: string | null;
  electedCount: number;
  canCompose: boolean;
  onRegenerate: () => void;
  /** Staleness payload from the compose route on cache-hits.
   *  When is_stale, renders the banner above the composed_design
   *  body with a "Recompose" affordance. */
  compositionStaleness: {
    is_stale: boolean;
    last_upstream_change_at: string | null;
    changes: Array<{
      source_name: string;
      kind:
        | "expand"
        | "spawn"
        | "disposition"
        | "local_variations"
        | "local_composition";
      changed_at: string;
    }>;
  } | null;
}) {
  return (
    <div
      id={DECISION_ANCHORS.composedDesign}
      className="mt-2 rounded-2xl p-3"
      style={{
        background: "rgba(15,23,42,0.025)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
        scrollMarginTop: 12,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={2}
            style={{ color: appleVibe.text.tertiary }}
          />
          <span
            className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Composed design
          </span>
          <span
            className="text-[11px] font-light"
            style={{ color: appleVibe.text.tertiary }}
          >
            · {electedCount} variation{electedCount === 1 ? "" : "s"} elected
          </span>
        </div>
        {composedDesign && canCompose && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={composing}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.secondary,
              cursor: composing ? "wait" : "pointer",
            }}
          >
            <RefreshCw className="h-2.5 w-2.5" strokeWidth={2} />
            Regenerate
          </button>
        )}
      </div>

      {composing && !composedDesign && (
        <p
          className="mt-2 text-[11.5px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          Synthesizing the elected variations…
        </p>
      )}

      {composeError && (
        <p
          className="mt-2 text-[11.5px] font-light"
          style={{ color: "rgba(127,29,29,0.95)" }}
        >
          {composeError}
        </p>
      )}

      {/* Composition staleness banner — appears when the server's
          cache-hit response noted that the composed_design is older
          than the variations it was synthesized from (LOCAL signal)
          or older than upstream-room changes (UPSTREAM signals).
          The Recompose button force-regenerates the composition with
          current variation bodies + upstream chain. */}
      {composedDesign &&
        compositionStaleness?.is_stale &&
        !composing && (
          <div className="mt-2.5">
            <UpstreamStalenessBanner
              staleness={compositionStaleness}
              onRefresh={onRegenerate}
              busy={composing}
              headerLabel="Composition is stale"
              refreshLabel="Recompose"
              trailingNote="The current composed design doesn’t reflect these."
            />
          </div>
        )}

      {composedDesign && (
        <div className="mt-2 flex flex-col gap-2.5">
          {composedDesign.description && (
            <p
              className="text-[12.5px] font-light leading-snug"
              style={{ color: appleVibe.text.primary }}
            >
              {composedDesign.description}
            </p>
          )}

          {/* Conflicts open — LOUD banner, surfaced first so the
              user sees decisions they need to make before reading
              the rest. */}
          {composedDesign.conflicts_open.length > 0 && (
            <div
              className="rounded-xl p-2.5"
              style={{
                background: "rgba(220,38,38,0.06)",
                border: "1px solid rgba(220,38,38,0.22)",
              }}
            >
              <div className="flex items-center gap-1.5">
                <AlertCircle
                  className="h-3 w-3 flex-shrink-0"
                  strokeWidth={2}
                  style={{ color: "rgba(220,38,38,0.85)" }}
                />
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: "rgba(127,29,29,0.95)" }}
                >
                  Conflicts you need to resolve
                </span>
              </div>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                {composedDesign.conflicts_open.map((c, i) => (
                  <li
                    key={i}
                    className="text-[11.5px] font-light leading-snug"
                    style={{ color: "rgba(127,29,29,0.95)" }}
                  >
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {composedDesign.integration_points.length > 0 && (
            <div>
              <div
                className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Integration points
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {composedDesign.integration_points.map((p, i) => (
                  <li
                    key={i}
                    className="text-[11.5px] font-light leading-snug"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {composedDesign.conflicts_resolved.length > 0 && (
            <div>
              <div
                className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Conflicts resolved
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {composedDesign.conflicts_resolved.map((c, i) => (
                  <li
                    key={i}
                    className="text-[11.5px] font-light leading-snug"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Open questions list — each question is a prototype-lab trigger ──
//
// Per the constraint × variation × open-question formula: every
// open_question can compose with the variation + user constraints
// into one surgical experiment brief. Each question shows a "Design
// experiment" button that fires the /prototype route and renders
// the resulting brief inline beneath it.

function OpenQuestionsList({
  variation,
  entityId,
  briefs,
  onBriefGenerated,
  briefStalenessMap,
  onBriefStalenessChange,
}: {
  variation: ItemVariation;
  entityId: string;
  briefs: PrototypeBrief[];
  onBriefGenerated: (brief: PrototypeBrief) => void;
  /** Brief staleness map — keyed by brief.id. Source of truth lives
   *  on the outer drawer (sourced from /expand); each row reads its
   *  own entry to render a per-brief banner. Force-regen + fresh
   *  generation flow through onBriefStalenessChange to clear / set
   *  the map without bypassing the outer state. */
  briefStalenessMap: Record<string, StalenessShape> | null;
  onBriefStalenessChange: (
    briefId: string,
    next: StalenessShape | null,
  ) => void;
}) {
  const variationId = variation.id ?? "";
  const questions = variation.open_questions ?? [];

  // Per-question loading + error state. Keyed by question text so
  // rapid clicks don't cross-pollinate states.
  const [loadingQuestion, setLoadingQuestion] = useState<string | null>(null);
  const [errorByQuestion, setErrorByQuestion] = useState<
    Record<string, string>
  >({});

  // Brief lookup — find the cached brief for this variation+question.
  function briefFor(q: string): PrototypeBrief | undefined {
    return briefs.find(
      (b) => b.variation_id === variationId && b.open_question === q,
    );
  }

  async function generateBrief(q: string, force = false) {
    if (!entityId || !variationId) return;
    setLoadingQuestion(q);
    setErrorByQuestion((prev) => {
      const next = { ...prev };
      delete next[q];
      return next;
    });
    try {
      const res = await fetch(
        "/api/brainstorm/item/variation/prototype",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entityId,
            variationId,
            openQuestion: q,
            mode: force ? "force" : "default",
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setErrorByQuestion((prev) => ({
          ...prev,
          [q]: json?.error ?? "Failed to design experiment.",
        }));
        return;
      }
      if (json?.brief) {
        onBriefGenerated(json.brief as PrototypeBrief);
        // Capture brief staleness when the server returned it (cache-hit).
        // On force-regen the server returns no staleness → clear the
        // banner via setter(null). Keyed by the BRIEF id so the
        // staleness lives with the artifact even after a re-render
        // changes the row's React key.
        const briefId = (json.brief as PrototypeBrief).id;
        if (briefId) {
          const incoming =
            json?.brief_staleness && typeof json.brief_staleness === "object"
              ? (json.brief_staleness as StalenessShape)
              : null;
          onBriefStalenessChange(briefId, incoming);
        }
      }
    } catch (err) {
      setErrorByQuestion((prev) => ({
        ...prev,
        [q]: err instanceof Error ? err.message : "Network error.",
      }));
    } finally {
      setLoadingQuestion(null);
    }
  }

  return (
    <div className="mt-2.5">
      <div
        className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        Open questions
      </div>
      <ul className="mt-1 flex flex-col gap-2">
        {questions.map((q, i) => {
          const brief = briefFor(q);
          const loading = loadingQuestion === q;
          const error = errorByQuestion[q];
          return (
            <li
              key={i}
              className="flex flex-col gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-1.5">
                <span
                  className="flex-shrink-0 text-[12px] leading-snug"
                  style={{ color: appleVibe.text.tertiary }}
                  aria-hidden
                >
                  •
                </span>
                <div className="flex flex-1 flex-wrap items-start gap-1.5">
                  <span
                    className="flex-1 text-[11.5px] font-light leading-snug"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    {q}
                  </span>
                  {!brief && (
                    <button
                      type="button"
                      onClick={() => generateBrief(q)}
                      disabled={loading}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all"
                      style={{
                        background: loading
                          ? appleVibe.surface.chip
                          : appleVibe.accent.primary,
                        color: loading
                          ? appleVibe.text.tertiary
                          : appleVibe.text.onAccent,
                        cursor: loading ? "wait" : "pointer",
                        opacity: loading ? 0.7 : 1,
                      }}
                    >
                      <FlaskConical
                        className="h-2.5 w-2.5"
                        strokeWidth={2}
                      />
                      {loading ? "Designing…" : "Design experiment"}
                    </button>
                  )}
                </div>
              </div>
              {error && (
                <p
                  className="ml-3 text-[10.5px] font-light"
                  style={{ color: "rgba(127,29,29,0.95)" }}
                >
                  {error}
                </p>
              )}
              {brief && (
                <div className="ml-3">
                  <PrototypeBriefBlock
                    brief={brief}
                    busy={loading}
                    onRegenerate={() => generateBrief(q, true)}
                    staleness={briefStalenessMap?.[brief.id] ?? null}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Prototype brief block ─────────────────────────────────────────────
//
// Renders the constraint × variation × open-question experiment as
// a structured card. Hypothesis loud at top, signal + kill criteria
// as the operational pair, then the actual artifact body — what the
// user produces THIS WEEK. No theory, all "do this now."

function PrototypeBriefBlock({
  brief,
  busy,
  onRegenerate,
  staleness,
}: {
  brief: PrototypeBrief;
  busy: boolean;
  onRegenerate: () => void;
  /** Per-brief staleness emitted by /expand (drawer-open) or the
   *  prototype route (post-fetch cache-hit). When is_stale, renders
   *  the amber banner above the experiment body with a "Regenerate
   *  brief" affordance. Null when fresh or never-computed. */
  staleness: StalenessShape | null;
}) {
  return (
    <div
      className="rounded-2xl p-3"
      style={{
        background: "rgba(37,99,235,0.04)",
        border: "1px solid rgba(37,99,235,0.18)",
        borderRadius: appleVibe.radius.md,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <FlaskConical
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={2}
            style={{ color: "rgba(37,99,235,0.85)" }}
          />
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: "rgba(30,64,175,0.95)" }}
          >
            Experiment
          </span>
          <span
            className="text-[10.5px] font-medium"
            style={{ color: appleVibe.text.tertiary }}
          >
            · {brief.artifact_type}
          </span>
        </div>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            background: "transparent",
            color: appleVibe.text.tertiary,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          <RefreshCw className="h-2.5 w-2.5" strokeWidth={2} />
          {busy ? "…" : "Regenerate"}
        </button>
      </div>

      {/* Brief staleness banner — appears when the server's expand
          or prototype cache-hit response noted that this brief is
          older than the variations / composed_design / upstream it
          was generated from. The Regenerate-brief button force-
          regenerates with current dependencies. */}
      {staleness?.is_stale && !busy && (
        <div className="mt-2">
          <UpstreamStalenessBanner
            staleness={staleness}
            onRefresh={onRegenerate}
            busy={busy}
            headerLabel="Brief is stale"
            refreshLabel="Regenerate brief"
            trailingNote="The current experiment design doesn’t reflect these."
          />
        </div>
      )}

      {/* Hypothesis loud */}
      <p
        className="mt-2 text-[12px] font-medium leading-snug"
        style={{ color: appleVibe.text.primary }}
      >
        {brief.hypothesis}
      </p>

      {/* Signal + kill — the operational pair */}
      <div className="mt-2 flex flex-col gap-1.5 text-[11px] leading-snug">
        <div>
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Signal to watch
          </span>{" "}
          <span style={{ color: appleVibe.text.secondary }}>
            {brief.signal_to_watch}
          </span>
        </div>
        <div>
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Kill criteria
          </span>{" "}
          <span style={{ color: appleVibe.text.secondary }}>
            {brief.kill_criteria}
          </span>
        </div>
        <div>
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Build estimate
          </span>{" "}
          <span style={{ color: appleVibe.text.secondary }}>
            {brief.build_estimate}
          </span>
        </div>
      </div>

      {/* The actual artifact — what to do this week */}
      {brief.artifact_body && (
        <div
          className="mt-2.5 rounded-xl p-2.5"
          style={{
            background: "rgba(255,255,255,0.7)",
            border: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          {/* Header uses the specific artifact_type when present
              ("5-screen paper prototype") rather than the generic
              "What you produce this week" — more informative + avoids
              feeling boilerplate. */}
          <div
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.secondary }}
          >
            {brief.artifact_type
              ? `Deliverable · ${brief.artifact_type}`
              : "What you produce this week"}
          </div>
          <p
            className="mt-1 whitespace-pre-wrap text-[11.5px] leading-snug"
            style={{ color: appleVibe.text.primary }}
          >
            {/* Defensive strip — drop a leading markdown header / echoed
                "what you produce" line if the LLM still emits one
                despite the prompt instruction not to. */}
            {stripLeadingHeader(brief.artifact_body)}
          </p>
        </div>
      )}

      {/* Decision — the fork the result drives (Arc 2: reframed from
          "what you'll know" to the explicit if-pass / if-fail action,
          so it no longer echoes the hypothesis). Contrast bumped from
          tertiary to secondary for readability. */}
      {brief.learning_target && (
        <p
          className="mt-2 text-[11px] leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          <span
            className="font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Decision:
          </span>{" "}
          {brief.learning_target}
        </p>
      )}
    </div>
  );
}

// ── Expansion Panel — the [+] Deepen affordance + spawned tree ───────
//
// Wraps any L2 attach surface (variation, open_question, conflict, etc).
// Filters expansionTree[] to the children for THIS attach, renders them
// inline beneath the parent, and provides the spawn / regenerate
// affordance. Recursive — each spawned node card has its own
// ExpansionPanel for L4+ drill when the catalog supports it.

function ExpansionPanel({
  entityId,
  attachPoint,
  attachRef,
  parentTitle,
  parentDescription,
  parentNodeId = null,
  expansionTree,
  onTreeUpdate,
  depth = 3,
}: {
  entityId: string;
  attachPoint: string; // ExpansionAttachPoint
  attachRef: string;
  parentTitle: string;
  parentDescription: string;
  parentNodeId?: string | null;
  expansionTree: ExpansionNodeLocal[];
  onTreeUpdate: (next: ExpansionNodeLocal[]) => void;
  depth?: number;
}) {
  // Filter children for this exact attach slot. For L3, that's
  // (parent_node_id=null, attach_point, attach_ref). For L4+, it's
  // (parent_node_id=parentNodeId).
  const children = useMemo(() => {
    return expansionTree.filter((n) => {
      if (parentNodeId !== null) return n.parent_node_id === parentNodeId;
      return (
        n.parent_node_id === null &&
        n.attach_point === attachPoint &&
        n.attach_ref === attachRef
      );
    });
  }, [expansionTree, parentNodeId, attachPoint, attachRef]);

  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideOpen, setHideOpen] = useState(false);

  async function spawn(force = false) {
    if (!entityId) return;
    setSpawning(true);
    setError(null);
    try {
      const res = await fetch("/api/brainstorm/item/expansion/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId,
          attachPoint,
          attachRef,
          parentNodeId,
          parentTitle,
          parentDescription,
          mode: force ? "force" : "default",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        // 409 "no_catalog_entry" is expected when the (domain, lane,
        // parent) triple has no defined deepen path. Show the human
        // detail string instead of the typed error slug. The 500-tier
        // "expansion failed" path now ALSO surfaces detail when the
        // server provided one — the route attaches it for diagnostics
        // and it's no longer fair to swallow it (the user otherwise
        // sees a bare "expansion failed" with no actionable cue).
        const isNoCatalog =
          json?.error === "no_catalog_entry" ||
          json?.error === "no catalog entry for this depth surface";
        const baseError =
          typeof json?.error === "string" ? json.error : "Spawn failed.";
        const detail =
          typeof json?.detail === "string" && json.detail.trim().length > 0
            ? json.detail.trim()
            : null;
        const msg = isNoCatalog
          ? detail
            ? `Deepen not available for this card type yet — ${detail}`
            : "Deepen not available for this card type yet."
          : detail
            ? `${baseError} — ${detail}`
            : baseError;
        setError(msg);
        return;
      }
      if (Array.isArray(json?.tree)) {
        onTreeUpdate(json.tree as ExpansionNodeLocal[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSpawning(false);
    }
  }

  const hasChildren = children.length > 0;

  return (
    <div className="mt-2.5">
      {!hasChildren && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void spawn(false);
          }}
          disabled={spawning}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all"
          style={{
            background: spawning
              ? appleVibe.surface.chip
              : "rgba(15,23,42,0.06)",
            color: appleVibe.text.secondary,
            border: `1px solid ${appleVibe.stroke.hairline}`,
            cursor: spawning ? "wait" : "pointer",
            opacity: spawning ? 0.7 : 1,
          }}
        >
          <Plus className="h-2.5 w-2.5" strokeWidth={2} />
          {spawning ? "Deepening…" : "Deepen"}
        </button>
      )}
      {error && (
        <p
          className="mt-1 text-[10.5px] font-light"
          style={{ color: "rgba(127,29,29,0.95)" }}
        >
          {error}
        </p>
      )}
      {hasChildren && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: appleVibe.text.tertiary }}
            >
              Deepened · L{depth}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setHideOpen((v) => !v);
                }}
                className="inline-flex items-center gap-1 text-[10px] font-medium"
                style={{ color: appleVibe.text.tertiary }}
              >
                <ChevronRight
                  className="h-2.5 w-2.5 transition-transform"
                  strokeWidth={2}
                  style={{
                    transform: hideOpen ? "rotate(0deg)" : "rotate(90deg)",
                  }}
                />
                {hideOpen ? "show" : "hide"}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void spawn(true);
                }}
                disabled={spawning}
                className="inline-flex items-center gap-1 text-[10px] font-medium"
                style={{ color: appleVibe.text.tertiary }}
                title="Regenerate this depth surface"
              >
                <RefreshCw className="h-2.5 w-2.5" strokeWidth={2} />
                {spawning ? "…" : "regen"}
              </button>
            </div>
          </div>
          {!hideOpen &&
            children.map((node) => (
              <ExpansionNodeCard
                key={node.id}
                node={node}
                entityId={entityId}
                expansionTree={expansionTree}
                onTreeUpdate={onTreeUpdate}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ── Expansion node card — renders one spawned child + its own deepen ─

function ExpansionNodeCard({
  node,
  entityId,
  expansionTree,
  onTreeUpdate,
}: {
  node: ExpansionNodeLocal;
  entityId: string;
  expansionTree: ExpansionNodeLocal[];
  onTreeUpdate: (next: ExpansionNodeLocal[]) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className="rounded-2xl p-2.5"
      style={{
        background: "rgba(255,255,255,0.7)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((v) => !v);
          }}
          className="flex items-center gap-1.5 text-left"
        >
          <ChevronRight
            className="h-3 w-3 transition-transform"
            strokeWidth={2}
            style={{
              color: appleVibe.text.tertiary,
              transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
            }}
          />
          <span
            className="text-[12px] font-semibold"
            style={{ color: appleVibe.text.primary }}
          >
            {node.title}
          </span>
        </button>
        <span
          className="flex-shrink-0 text-[9px] font-medium uppercase tracking-[0.1em]"
          style={{ color: appleVibe.text.faint }}
        >
          {node.node_type.split(".").pop()}
        </span>
      </div>

      {!collapsed && (
        <>
          {/* Body — best-effort generic render. Per node_type we could
              ship specialized renderers later (e.g. data_model gets
              field tables), but the generic walk renders everything. */}
          <div className="mt-2">
            <NodeBodyRender body={node.body} />
          </div>

          {/* Annotation chips on the node. */}
          {node.derived_from_annotations &&
            node.derived_from_annotations.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span
                  className="text-[9px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  derived from
                </span>
                {node.derived_from_annotations.map((p) => (
                  <span
                    key={`${p.index}-${p.facet}`}
                    className="inline-flex max-w-[140px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium"
                    style={{
                      background: "rgba(15,23,42,0.035)",
                      color: appleVibe.text.secondary,
                      border: `1px solid ${appleVibe.stroke.hairline}`,
                    }}
                    title={`${p.facet} · ${p.phrase}`}
                  >
                    <span
                      className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                      style={{ background: FACET_COLOR[p.facet] }}
                      aria-hidden
                    />
                    <span className="truncate">{p.phrase}</span>
                  </span>
                ))}
              </div>
            )}

          {/* Recursive deepen — child panel attached to this node.
              Surface a generic "Drill into this" affordance; the route
              returns 409 with helpful error when no catalog entry
              exists for the node_type, and ExpansionPanel surfaces
              that as an inline error message. */}
          <ExpansionPanel
            entityId={entityId}
            attachPoint="expansion_node"
            attachRef={node.id}
            parentTitle={node.title}
            parentDescription={JSON.stringify(node.body).slice(0, 600)}
            parentNodeId={node.id}
            expansionTree={expansionTree}
            onTreeUpdate={onTreeUpdate}
            depth={node.depth + 1}
          />
        </>
      )}
    </div>
  );
}

// ── Generic body renderer ─────────────────────────────────────────────
//
// Each node_type ideally has a specialized renderer, but a generic
// walk lets the system ship before that — and serves as the fallback
// when the LLM emits unexpected keys.

function NodeBodyRender({ body }: { body: Record<string, unknown> }) {
  const keys = Object.keys(body);
  if (keys.length === 0) {
    return (
      <p
        className="text-[11px] font-light italic"
        style={{ color: appleVibe.text.tertiary }}
      >
        (empty)
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {keys.map((k) => (
        <BodyField key={k} fieldKey={k} value={body[k]} />
      ))}
    </div>
  );
}

function BodyField({
  fieldKey,
  value,
}: {
  fieldKey: string;
  value: unknown;
}) {
  const label = fieldKey.replace(/_/g, " ");
  if (typeof value === "string") {
    return (
      <div>
        <div
          className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          {label}
        </div>
        <p
          className="mt-0.5 whitespace-pre-wrap text-[11.5px] font-light leading-snug"
          style={{ color: appleVibe.text.primary }}
        >
          {value}
        </p>
      </div>
    );
  }
  if (Array.isArray(value)) {
    return (
      <div>
        <div
          className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          {label}
        </div>
        <ul className="mt-0.5 flex flex-col gap-1 pl-2">
          {value.map((item, i) => {
            if (typeof item === "string") {
              return (
                <li
                  key={i}
                  className="list-disc text-[11.5px] font-light leading-snug"
                  style={{ color: appleVibe.text.primary }}
                >
                  {item}
                </li>
              );
            }
            if (item && typeof item === "object") {
              return (
                <li
                  key={i}
                  className="rounded-lg p-1.5"
                  style={{
                    background: "rgba(15,23,42,0.03)",
                    border: `1px solid ${appleVibe.stroke.hairline}`,
                  }}
                >
                  {Object.entries(item as Record<string, unknown>).map(
                    ([k2, v2]) => (
                      <div key={k2} className="text-[11px] leading-snug">
                        <span
                          className="font-semibold"
                          style={{ color: appleVibe.text.secondary }}
                        >
                          {k2.replace(/_/g, " ")}:
                        </span>{" "}
                        <span
                          className="font-light"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {typeof v2 === "string"
                            ? v2
                            : JSON.stringify(v2).slice(0, 200)}
                        </span>
                      </div>
                    ),
                  )}
                </li>
              );
            }
            return (
              <li
                key={i}
                className="list-disc text-[11.5px] font-light"
                style={{ color: appleVibe.text.primary }}
              >
                {String(item)}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  if (value && typeof value === "object") {
    return (
      <div>
        <div
          className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          {label}
        </div>
        <div
          className="mt-0.5 rounded-lg p-1.5"
          style={{
            background: "rgba(15,23,42,0.03)",
            border: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          {Object.entries(value as Record<string, unknown>).map(([k2, v2]) => (
            <div key={k2} className="text-[11px] leading-snug">
              <span
                className="font-semibold"
                style={{ color: appleVibe.text.secondary }}
              >
                {k2.replace(/_/g, " ")}:
              </span>{" "}
              <span
                className="font-light"
                style={{ color: appleVibe.text.primary }}
              >
                {typeof v2 === "string"
                  ? v2
                  : JSON.stringify(v2).slice(0, 200)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

// ── Drawer prior-concepts strip ───────────────────────────────────
//
// Sits above the variations list, surfacing canonical concepts from
// the user's prior spaces that the system used to ground variation
// generation for this item. Collapsed by default; expand to see all
// concepts as chips with `display_name (N×)` evidence. Mirrors the
// picker's PriorConceptsStrip but scoped to the item-level KG read
// (smaller K, item-scoped query in the route).

function DrawerPriorConceptsStrip({
  concepts,
  onConceptClick,
}: {
  concepts: Array<{
    id: string;
    canonical_code: string;
    display_name: string;
    description: string | null;
    domain_tags: string[];
    space_count: number;
  }>;
  /** Click → open CanonicalConceptDrawer for cross-space inspection. */
  onConceptClick: (canonicalCode: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (concepts.length === 0) return null;

  return (
    <div
      className="mb-3 rounded-2xl border p-2.5"
      style={{
        background: "rgba(124,58,237,0.025)",
        borderColor: "rgba(124,58,237,0.18)",
        borderRadius: appleVibe.radius.md,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Link2
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={2}
            style={{ color: "rgba(91,33,182,0.9)" }}
          />
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "rgba(91,33,182,0.95)" }}
          >
            {concepts.length} prior concept{concepts.length === 1 ? "" : "s"}
          </span>
          <span
            className="text-[11px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            · grounded variations against your cross-space KG
          </span>
        </div>
        <span
          className="inline-flex items-center gap-0.5 text-[10px] font-medium"
          style={{ color: appleVibe.text.tertiary }}
        >
          {expanded ? (
            <ChevronUp className="h-3 w-3" strokeWidth={2} />
          ) : (
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          )}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 flex flex-wrap gap-1">
          {concepts.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={(e) => {
                e.stopPropagation();
                onConceptClick(c.canonical_code);
              }}
              className="inline-flex max-w-[200px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium transition-colors hover:bg-[rgba(124,58,237,0.10)]"
              style={{
                background: "rgba(255,255,255,0.92)",
                color: "rgba(91,33,182,0.95)",
                border: "1px solid rgba(124,58,237,0.20)",
                cursor: "pointer",
              }}
              title={
                c.description
                  ? `${c.description}${c.domain_tags.length > 0 ? `\n\nTags: ${c.domain_tags.join(", ")}` : ""}\n\nClick to open cross-space view.`
                  : `Click to open cross-space view${c.domain_tags.length > 0 ? `\nTags: ${c.domain_tags.join(", ")}` : ""}`
              }
            >
              <span className="truncate">{c.display_name}</span>
              <span
                className="font-mono text-[9px]"
                style={{ color: "rgba(91,33,182,0.65)" }}
              >
                {c.space_count}×
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Upstream staleness banner ──────────────────────────────────────
//
// Renders when /api/brainstorm/item/expand returns
// upstream_staleness.is_stale=true. Tells the user that cards FEEDING
// this one have mutated since this card's expanded_detail was
// generated, and offers a one-click refresh that calls expand with
// mode:"force" to pull fresh upstream depth.

function UpstreamStalenessBanner({
  staleness,
  onRefresh,
  busy,
  /** Header label — defaults to "Upstream changed" for expand
   *  staleness. Compose uses "Composition is stale"; brief uses
   *  "Brief is stale". */
  headerLabel = "Upstream changed",
  /** Button text — defaults to "Refresh from upstream". Compose
   *  uses "Recompose"; brief uses "Regenerate brief". */
  refreshLabel = "Refresh from upstream",
  /** Trailing sentence — overrides the default "Your last
   *  expansion of this card doesn't reflect these." */
  trailingNote = "Your last expansion of this card doesn’t reflect these.",
}: {
  staleness: {
    is_stale: boolean;
    last_upstream_change_at: string | null;
    changes: Array<{
      source_name: string;
      kind:
        | "expand"
        | "spawn"
        | "disposition"
        | "local_variations"
        | "local_composition";
      changed_at: string;
    }>;
  };
  onRefresh: () => void;
  busy: boolean;
  headerLabel?: string;
  refreshLabel?: string;
  trailingNote?: string;
}) {
  const lastAt = staleness.last_upstream_change_at;
  const relative = lastAt ? formatRelativeShort(lastAt) : null;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl px-3.5 py-3"
      style={{
        background: "rgba(217,119,6,0.06)",
        border: "1px solid rgba(217,119,6,0.22)",
        color: "rgba(120,53,15,0.95)",
      }}
    >
      <RefreshCw
        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
        strokeWidth={2}
        style={{ color: "rgba(146,64,14,0.85)" }}
      />
      <div className="min-w-0 flex-1">
        <div
          className="text-[11.5px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: "rgba(120,53,15,0.95)" }}
        >
          {headerLabel}
          {relative ? (
            <span
              className="ml-1.5 font-normal lowercase tracking-normal"
              style={{ color: "rgba(146,64,14,0.7)" }}
            >
              · {relative}
            </span>
          ) : null}
        </div>
        <p
          className="mt-1 text-[12px] leading-snug"
          style={{ color: "rgba(120,53,15,0.85)" }}
        >
          {staleness.changes.slice(0, 2).map((c, i) => (
            <span key={`${c.source_name}-${c.kind}-${i}`}>
              {i > 0 ? " · " : ""}
              <span style={{ fontWeight: 600 }}>{c.source_name}</span>{" "}
              {kindVerb(c.kind)}
            </span>
          ))}
          {staleness.changes.length > 2
            ? ` + ${staleness.changes.length - 2} more`
            : ""}
          . {trailingNote}
        </p>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
        style={{
          background: busy
            ? "rgba(217,119,6,0.10)"
            : "rgba(217,119,6,0.18)",
          color: "rgba(120,53,15,0.95)",
          border: "1px solid rgba(217,119,6,0.35)",
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? "Refreshing…" : refreshLabel}
      </button>
    </div>
  );
}

function kindVerb(
  kind:
    | "expand"
    | "spawn"
    | "disposition"
    | "local_variations"
    | "local_composition",
): string {
  switch (kind) {
    case "expand":
      return "was re-expanded";
    case "spawn":
      return "added a new deepening node";
    case "disposition":
      return "changed an election";
    case "local_variations":
      return "regenerated its variations";
    case "local_composition":
      return "regenerated its composed design";
  }
}

/** Compact relative time for the staleness banner header. Returns
 *  short forms like "just now", "5 min ago", "2 hr ago", "3 d ago".
 *  Stays format-agnostic — accepts any ISO string. */
function formatRelativeShort(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const deltaSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (deltaSec < 60) return "just now";
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin} min ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr} hr ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  return `${deltaDay} d ago`;
}

// ── Phase 4b — Variation Scoring Panel ────────────────────────────
//
// Self-contained UI for the mechanism-effectiveness scorer wired
// behind /api/brainstorm/item/variation/score. Renders nothing
// until the user clicks "Score variations" so the ~1-3s Monte Carlo
// cost is opt-in. After scoring, surfaces:
//
//   • A small banner with the structural ceiling (shared by all
//     siblings) + placebo verdict (specificity check) + target pain
//     the scorer chose
//   • A flat list of (variation name, score bar) for ranking
//
// Score lives in component state only — closes with the drawer.
// Phase 4c will persist into expanded_detail.variations[].effectiveness_score
// so scores survive re-opens. For now this is a working preview.

// ── Mechanism Spec Panel (Arc 3.1) ────────────────────────────────
//
// The engineering-grade technical depth layer for FEATURE items. The
// Definition (above) says what the mechanism IS in plain language;
// this says HOW it works as a system. Self-contained: own fetch, own
// loading/error state, own collapse. Priority-first per the user's
// directive — mechanism_of_action + active ingredients are always
// visible; the deeper spec (procedure / components / dosage / fidelity
// / research) lives behind a "Technical detail" toggle.
//
// Data comes from entities.expanded_detail.mechanism_spec, generated
// by POST /api/brainstorm/item/[entityId]/mechanism-spec.

const EVIDENCE_TONE: Record<
  MechanismSpec["research_basis"]["evidence_strength"],
  { label: string; color: string; bg: string }
> = {
  established: {
    label: "Established",
    color: "rgba(22,101,52,0.95)",
    bg: "rgba(22,163,74,0.12)",
  },
  plausible: {
    label: "Plausible",
    color: "rgba(146,64,14,0.95)",
    bg: "rgba(217,119,6,0.12)",
  },
  speculative: {
    label: "Speculative",
    color: "rgba(71,85,105,0.95)",
    bg: "rgba(100,116,139,0.12)",
  },
};

const MODE_LABEL: Record<MechanismSpec["use_case_mode"], string> = {
  consumer_app: "feature spec",
  personal_health: "intervention protocol",
  scientific: "experimental method",
};

function MechanismSpecPanel({
  entityId,
  spec,
  onSpecGenerated,
}: {
  entityId: string;
  spec: MechanismSpec | null | undefined;
  onSpecGenerated: (spec: MechanismSpec) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showEng, setShowEng] = useState(false);

  const generate = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/brainstorm/item/${entityId}/mechanism-spec`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.mechanism_spec) {
        setError(
          (json && typeof json.error === "string" && json.error) ||
            "Couldn't generate the mechanism spec — try again.",
        );
        return;
      }
      onSpecGenerated(json.mechanism_spec as MechanismSpec);
      setShowDetail(true);
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  }, [entityId, loading, onSpecGenerated]);

  const evidence = spec ? EVIDENCE_TONE[spec.research_basis.evidence_strength] : null;

  return (
    <Section
      icon={<FileCode className="h-3 w-3" strokeWidth={1.75} />}
      title="Mechanism"
      subtitle={spec ? MODE_LABEL[spec.use_case_mode] : undefined}
      action={
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9.5px] font-semibold"
          style={{
            background: appleVibe.surface.chip,
            color: appleVibe.text.tertiary,
            cursor: loading ? "wait" : "pointer",
          }}
          title={
            spec
              ? "Regenerate the technical spec"
              : "Generate the technical mechanism spec"
          }
        >
          {spec ? (
            <RefreshCw
              className={`h-2.5 w-2.5 ${loading ? "animate-spin" : ""}`}
              strokeWidth={2}
            />
          ) : (
            <Plus
              className={`h-2.5 w-2.5 ${loading ? "animate-pulse" : ""}`}
              strokeWidth={2}
            />
          )}
          {loading ? "Working…" : spec ? "Regenerate" : "Generate"}
        </button>
      }
    >
      {loading && !spec ? (
        <SkeletonLines lines={4} />
      ) : error ? (
        <ErrorRow message={error} />
      ) : !spec ? (
        <p
          className="text-[12px] font-light leading-snug"
          style={{ color: appleVibe.text.tertiary }}
        >
          No technical spec yet. Generate one to see how this mechanism
          actually works — its active ingredients, procedure, what to
          build, and how you&apos;d validate it.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* ── PRIORITY: mechanism of action ── */}
          <div
            className="rounded-2xl p-3"
            style={{
              background: "rgba(37,99,235,0.05)",
              border: `1px solid rgba(37,99,235,0.16)`,
            }}
          >
            <div
              className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
              style={{ color: "rgba(30,64,175,0.95)" }}
            >
              How it produces the effect
            </div>
            <p
              className="text-[12.5px] font-light leading-relaxed"
              style={{ color: appleVibe.text.primary }}
            >
              {spec.mechanism_of_action}
            </p>
          </div>

          {/* ── PRIORITY: what the user sees (mechanism → UI link) ── */}
          {spec.user_visible_behavior && (
            <div>
              <div
                className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                What the user sees
              </div>
              <p
                className="text-[12px] font-light leading-relaxed"
                style={{ color: appleVibe.text.secondary }}
              >
                {spec.user_visible_behavior}
              </p>
            </div>
          )}

          {/* ── Chips (evidence + quality gate) + tier toggles ── */}
          <div className="flex flex-wrap items-center gap-1.5">
            {evidence && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: evidence.bg, color: evidence.color }}
                title="How well-supported this mechanism is"
              >
                <Shield className="h-2.5 w-2.5" strokeWidth={2} />
                Evidence: {evidence.label}
              </span>
            )}
            {(() => {
              const axes = Object.values(spec.quality_score);
              const min = axes.length ? Math.min(...axes) : 1;
              const tone =
                min >= 0.75
                  ? { bg: "rgba(22,163,74,0.12)", color: "rgba(22,101,52,0.95)" }
                  : min >= 0.6
                    ? { bg: "rgba(217,119,6,0.12)", color: "rgba(146,64,14,0.95)" }
                    : { bg: "rgba(220,38,38,0.1)", color: "rgba(127,29,29,0.95)" };
              return (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: tone.bg, color: tone.color }}
                  title="Internal quality gate — lowest of 6 axes (specificity, technical depth, measurability, UI connection, feasibility, failure-mode clarity)"
                >
                  Quality {Math.round(min * 100)}
                </span>
              );
            })()}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold"
              style={{ color: appleVibe.text.tertiary }}
              aria-expanded={showDetail}
            >
              {showDetail ? (
                <ChevronUp className="h-3 w-3" strokeWidth={2} />
              ) : (
                <ChevronDown className="h-3 w-3" strokeWidth={2} />
              )}
              {showDetail ? "Hide mechanism" : "Mechanism"}
            </button>
            <button
              type="button"
              onClick={() => setShowEng((v) => !v)}
              className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold"
              style={{ color: appleVibe.text.tertiary }}
              aria-expanded={showEng}
            >
              {showEng ? (
                <ChevronUp className="h-3 w-3" strokeWidth={2} />
              ) : (
                <ChevronDown className="h-3 w-3" strokeWidth={2} />
              )}
              {showEng ? "Hide engineering spec" : "Engineering spec"}
            </button>
          </div>

          {/* ── TIER 2: Mechanism (showDetail) ── */}
          {showDetail && (
            <div className="flex flex-col gap-3">
              {(spec.mechanism_hypothesis.if_do ||
                spec.mechanism_hypothesis.then_improves) && (
                <div
                  className="rounded-xl px-2.5 py-2"
                  style={{
                    background: "rgba(255,255,255,0.6)",
                    border: `1px solid ${appleVibe.stroke.hairline}`,
                  }}
                >
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Hypothesis
                  </div>
                  <p
                    className="text-[11.5px] font-light leading-snug"
                    style={{ color: appleVibe.text.primary }}
                  >
                    <b style={{ color: appleVibe.text.tertiary }}>If</b>{" "}
                    {spec.mechanism_hypothesis.if_do}{" "}
                    <b style={{ color: appleVibe.text.tertiary }}>→ then</b>{" "}
                    {spec.mechanism_hypothesis.then_improves}{" "}
                    <b style={{ color: appleVibe.text.tertiary }}>because</b>{" "}
                    {spec.mechanism_hypothesis.because}
                  </p>
                </div>
              )}

              {spec.active_ingredients.length > 0 && (
                <div>
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Active ingredients
                  </div>
                  <ul className="flex flex-col gap-1">
                    {spec.active_ingredients.map((a, i) => (
                      <li
                        key={i}
                        className="rounded-xl px-2.5 py-1.5"
                        style={{
                          background: "rgba(255,255,255,0.6)",
                          border: `1px solid ${appleVibe.stroke.hairline}`,
                        }}
                      >
                        <span
                          className="text-[12px] font-semibold"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {a.name}
                        </span>
                        <span
                          className="text-[11.5px] font-light leading-snug"
                          style={{ color: appleVibe.text.secondary }}
                        >
                          {" "}
                          — {a.role}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {spec.input_data.length > 0 && (
                <div>
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Input data
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {spec.input_data.map((d, i) => (
                      <span
                        key={i}
                        className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                        style={{
                          background: appleVibe.surface.chip,
                          color: appleVibe.text.secondary,
                        }}
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {spec.how_it_works.length > 0 && (
                <div>
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    How it works (procedure)
                  </div>
                  <ol className="flex flex-col gap-1">
                    {spec.how_it_works.map((step, i) => (
                      <li
                        key={i}
                        className="flex gap-2 rounded-xl px-2.5 py-1.5 text-[11.5px] font-light leading-snug"
                        style={{
                          background: "rgba(255,255,255,0.6)",
                          border: `1px solid ${appleVibe.stroke.hairline}`,
                          color: appleVibe.text.primary,
                        }}
                      >
                        <span
                          className="flex-shrink-0 font-semibold"
                          style={{ color: appleVibe.text.tertiary }}
                        >
                          {i + 1}.
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {spec.fidelity_signals.length > 0 && (
                <PlanningGroup
                  label="Done right when"
                  items={spec.fidelity_signals}
                  tone="info"
                />
              )}
              {spec.kill_criteria.length > 0 && (
                <PlanningGroup
                  label="Abandon if"
                  items={spec.kill_criteria}
                  tone="warn"
                />
              )}
            </div>
          )}

          {/* ── TIER 3: Engineering spec (showEng) ── */}
          {showEng && (
            <div className="flex flex-col gap-3">
              {spec.runtime_flow.length > 0 && (
                <div>
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Runtime flow
                  </div>
                  <ol className="flex flex-col gap-1">
                    {spec.runtime_flow.map((r, i) => (
                      <li
                        key={i}
                        className="rounded-xl px-2.5 py-1.5"
                        style={{
                          background: "rgba(255,255,255,0.6)",
                          border: `1px solid ${appleVibe.stroke.hairline}`,
                        }}
                      >
                        <div
                          className="flex gap-2 text-[11.5px] font-light leading-snug"
                          style={{ color: appleVibe.text.primary }}
                        >
                          <span
                            className="flex-shrink-0 font-semibold"
                            style={{ color: appleVibe.text.tertiary }}
                          >
                            {i + 1}.
                          </span>
                          <span>{r.step}</span>
                        </div>
                        <div
                          className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 pl-5 text-[10px]"
                          style={{ color: appleVibe.text.faint }}
                        >
                          <span>⚙ {r.component}</span>
                          {r.data !== "—" && <span>· data: {r.data}</span>}
                          {r.user_sees !== "—" && <span>· sees: {r.user_sees}</span>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {spec.implementation_methods.length > 0 && (
                <div>
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Build methods
                  </div>
                  <ul className="flex flex-col gap-1">
                    {spec.implementation_methods.map((m, i) => {
                      const decTone =
                        m.decision === "use"
                          ? { bg: "rgba(22,163,74,0.12)", color: "rgba(22,101,52,0.95)" }
                          : m.decision === "reject"
                            ? { bg: "rgba(220,38,38,0.1)", color: "rgba(127,29,29,0.95)" }
                            : { bg: appleVibe.surface.chip, color: appleVibe.text.tertiary };
                      return (
                        <li
                          key={i}
                          className="rounded-xl px-2.5 py-1.5"
                          style={{
                            background: "rgba(255,255,255,0.6)",
                            border: `1px solid ${appleVibe.stroke.hairline}`,
                          }}
                        >
                          <div className="flex items-baseline justify-between gap-1.5">
                            <span
                              className="text-[12px] font-semibold"
                              style={{ color: appleVibe.text.primary }}
                            >
                              {m.name}
                            </span>
                            <span
                              className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]"
                              style={{ background: decTone.bg, color: decTone.color }}
                            >
                              {m.decision.replace("_", " ")} · {m.difficulty}
                            </span>
                          </div>
                          {m.how && (
                            <p
                              className="mt-0.5 text-[11px] font-light leading-snug"
                              style={{ color: appleVibe.text.secondary }}
                            >
                              {m.how}
                            </p>
                          )}
                          <div
                            className="mt-0.5 flex flex-col gap-0.5 text-[10.5px] font-light"
                            style={{ color: appleVibe.text.faint }}
                          >
                            {m.strength && <span>＋ {m.strength}</span>}
                            {m.weakness && <span>－ {m.weakness}</span>}
                            {m.risk && <span>⚠ {m.risk}</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {spec.decision_record.chosen && (
                <div>
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Decision (why this method)
                  </div>
                  <div
                    className="flex flex-col gap-1 rounded-xl px-2.5 py-2"
                    style={{
                      background: "rgba(255,255,255,0.6)",
                      border: `1px solid ${appleVibe.stroke.hairline}`,
                    }}
                  >
                    <p
                      className="text-[11.5px] leading-snug"
                      style={{ color: appleVibe.text.primary }}
                    >
                      <b style={{ color: appleVibe.text.tertiary }}>Chosen:</b>{" "}
                      {spec.decision_record.chosen}
                    </p>
                    {spec.decision_record.rationale && (
                      <p
                        className="text-[11px] font-light leading-snug"
                        style={{ color: appleVibe.text.secondary }}
                      >
                        {spec.decision_record.rationale}
                      </p>
                    )}
                    {spec.decision_record.alternatives_rejected.length > 0 && (
                      <div
                        className="text-[10.5px] font-light"
                        style={{ color: appleVibe.text.faint }}
                      >
                        {spec.decision_record.alternatives_rejected.map((a, i) => (
                          <div key={i}>
                            ✗ {a.name}
                            {a.why_not ? ` — ${a.why_not}` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                    {spec.decision_record.consequences && (
                      <p
                        className="text-[11px] font-light leading-snug"
                        style={{ color: appleVibe.text.secondary }}
                      >
                        <b style={{ color: appleVibe.text.tertiary }}>
                          Consequences:
                        </b>{" "}
                        {spec.decision_record.consequences}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {spec.system_components.length > 0 && (
                <div>
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    What to build
                  </div>
                  <ul className="flex flex-col gap-1">
                    {spec.system_components.map((c, i) => (
                      <li
                        key={i}
                        className="rounded-xl px-2.5 py-1.5"
                        style={{
                          background: "rgba(255,255,255,0.6)",
                          border: `1px solid ${appleVibe.stroke.hairline}`,
                        }}
                      >
                        <div className="flex items-baseline gap-1.5">
                          <span
                            className="text-[12px] font-semibold"
                            style={{ color: appleVibe.text.primary }}
                          >
                            {c.name}
                          </span>
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]"
                            style={{
                              background: appleVibe.surface.chip,
                              color: appleVibe.text.faint,
                            }}
                          >
                            {c.category}
                          </span>
                        </div>
                        <p
                          className="mt-0.5 text-[11.5px] font-light leading-snug"
                          style={{ color: appleVibe.text.secondary }}
                        >
                          {c.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {spec.dosage && (
                <div>
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Dosage
                  </div>
                  <p
                    className="rounded-xl px-2.5 py-1.5 text-[11.5px] font-light leading-snug"
                    style={{
                      background: "rgba(255,255,255,0.6)",
                      border: `1px solid ${appleVibe.stroke.hairline}`,
                      color: appleVibe.text.primary,
                    }}
                  >
                    {spec.dosage}
                  </p>
                </div>
              )}

              <div>
                <div
                  className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  <FlaskConical className="h-2.5 w-2.5" strokeWidth={2} />
                  Research basis
                </div>
                <div
                  className="flex flex-col gap-1.5 rounded-xl px-2.5 py-2"
                  style={{
                    background: "rgba(255,255,255,0.6)",
                    border: `1px solid ${appleVibe.stroke.hairline}`,
                  }}
                >
                  {spec.research_basis.basis && (
                    <p
                      className="text-[11.5px] font-light leading-snug"
                      style={{ color: appleVibe.text.secondary }}
                    >
                      {spec.research_basis.basis}
                    </p>
                  )}
                  {spec.research_basis.validation_experiment && (
                    <p
                      className="text-[11.5px] font-light leading-snug"
                      style={{ color: appleVibe.text.primary }}
                    >
                      <span
                        className="font-semibold"
                        style={{ color: appleVibe.text.tertiary }}
                      >
                        How to validate:{" "}
                      </span>
                      {spec.research_basis.validation_experiment}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <div
                  className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Quality (self-graded)
                </div>
                <div className="flex flex-col gap-0.5">
                  {(
                    Object.entries(spec.quality_score) as Array<[string, number]>
                  ).map(([axis, v]) => (
                    <div key={axis} className="flex items-center gap-2">
                      <span
                        className="w-[120px] flex-shrink-0 text-[10.5px] font-light"
                        style={{ color: appleVibe.text.secondary }}
                      >
                        {axis.replace(/_/g, " ")}
                      </span>
                      <div
                        className="h-1.5 flex-1 overflow-hidden rounded-full"
                        style={{ background: appleVibe.surface.chip }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round(v * 100)}%`,
                            background:
                              v >= 0.75
                                ? "rgba(22,163,74,0.8)"
                                : v >= 0.6
                                  ? "rgba(217,119,6,0.8)"
                                  : "rgba(220,38,38,0.7)",
                          }}
                        />
                      </div>
                      <span
                        className="w-[28px] flex-shrink-0 text-right text-[10px] font-medium"
                        style={{ color: appleVibe.text.faint }}
                      >
                        {Math.round(v * 100)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function VariationScoringPanel({
  entityId,
  itemName,
  variations,
  initialEnvelope = null,
  onRefreshExpanded,
}: {
  entityId: string;
  itemName: string;
  variations: ItemVariation[];
  /** Phase 4c — reconstructed envelope from persisted state on the
   *  entity's expanded_detail. When present, the panel boots up in
   *  "scored" mode so the user sees the prior run immediately
   *  without re-spending the ~1-3s MC budget. */
  initialEnvelope?: VariationScoreEnvelope | null;
  /** Phase 5b — callback the parent provides so the panel can ask
   *  for a fresh /expand fetch after writing new R&D candidates +
   *  dispositions. Without this the experiment section would have
   *  to maintain a parallel copy of variations, which is brittle.
   *  Optional — older callers still work but won't see refinement
   *  output flow into the main variations list. */
  onRefreshExpanded?: () => void;
}) {
  const [envelope, setEnvelope] = useState<VariationScoreEnvelope | null>(
    initialEnvelope,
  );
  const [scoredAtIso, setScoredAtIso] = useState<string | null>(
    // Initial scored_at sourced from the persisted envelope's
    // optional carry-on field (passed in by parent via
    // buildEnvelopeFromExpanded). Set fresh on each successful
    // re-scoring run below.
    typeof (initialEnvelope as VariationScoreEnvelope & { scored_at?: string } | null)
      ?.scored_at === "string"
      ? (initialEnvelope as VariationScoreEnvelope & { scored_at: string }).scored_at
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 5b — R&D experiment state. Tracked separately from the
  // scoring flow so the user can re-run experiments without
  // affecting their prior scoring envelope.
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  // After a successful refine, this is the root_cause the agent
  // targeted — displayed in the "Candidates from experiment"
  // section header so the user knows WHY these candidates exist.
  const [refineTargetRootCause, setRefineTargetRootCause] = useState<
    string | null
  >(null);
  // Optimistic dispatch tracking — when the user elects/rejects a
  // candidate, we hide it from the local panel immediately even
  // before the disposition route returns. Keeps the experiment
  // section feeling responsive.
  const [dispatchedCandidateIds, setDispatchedCandidateIds] = useState<
    Set<string>
  >(new Set());

  async function runScoring() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/brainstorm/item/variation/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId }),
      });
      const json = (await res.json()) as
        | VariationScoreEnvelope
        | { error?: string; detail?: string };
      if (!res.ok) {
        const e = json as { error?: string; detail?: string };
        const detail =
          typeof e.detail === "string" && e.detail.trim().length > 0
            ? ` — ${e.detail.trim()}`
            : "";
        setError(`${e.error ?? "Scoring failed."}${detail}`);
        return;
      }
      setEnvelope(json as VariationScoreEnvelope);
      setScoredAtIso(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  // Phase 5b — R&D experiment trigger. Posts to the refine endpoint
  // which proposes 3 new candidates targeting the weakest root_cause
  // of the prior-scored target pain, scores them bi-directionally
  // (incl. constraint compliance), and appends them to expanded_detail.
  // We then ask the parent to re-fetch /expand so the new candidates
  // appear in `variations` and our pendingCandidates filter picks
  // them up.
  async function runRefine() {
    setRefining(true);
    setRefineError(null);
    try {
      const res = await fetch("/api/brainstorm/item/variation/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId }),
      });
      const json = (await res.json()) as {
        status?: string;
        status_detail?: string;
        target_root_cause?: string | null;
        envelope?: VariationScoreEnvelope;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        const detail =
          typeof json.detail === "string" && json.detail.trim().length > 0
            ? ` — ${json.detail.trim()}`
            : "";
        setRefineError(`${json.error ?? "Refinement failed."}${detail}`);
        return;
      }
      // Non-ok status codes are soft-fails (no_envelope etc).
      // Surface them in the error slot too so the user sees what
      // happened.
      if (json.status && json.status !== "ok") {
        setRefineError(
          json.status_detail ?? `Refinement: ${json.status}`,
        );
        return;
      }
      setRefineTargetRootCause(json.target_root_cause ?? null);
      // Bump scored_at to reflect the fresh scoring pass that the
      // refine route does internally as its last step. The panel
      // header's "scored Xm ago" should read "just now."
      setScoredAtIso(new Date().toISOString());
      // Clear any prior dispatch state — fresh experiment, fresh
      // candidate set.
      setDispatchedCandidateIds(new Set());
      // Ask the parent to re-fetch /expand. Without this, the
      // candidates exist on disk but our `variations` prop is stale.
      onRefreshExpanded?.();
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setRefining(false);
    }
  }

  // Phase 5b — elect/reject a candidate via the existing disposition
  // route. Optimistic dispatch ID tracking so the candidate row
  // hides immediately while the POST is in flight. After success
  // we ask the parent to refresh so the variation moves into the
  // main list (elected) or persists as rejected.
  async function dispatchCandidate(
    candidateId: string,
    disposition: "elected" | "rejected",
  ) {
    setDispatchedCandidateIds((prev) => {
      const next = new Set(prev);
      next.add(candidateId);
      return next;
    });
    try {
      await fetch("/api/brainstorm/item/variation/disposition", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId,
          variationId: candidateId,
          disposition,
        }),
      });
      onRefreshExpanded?.();
    } catch {
      // Disposition is non-critical; the optimistic remove already
      // ran. If the POST genuinely fails, the next /expand refetch
      // will surface the un-disposed candidate again — the user can
      // re-click.
    }
  }

  async function discardAllPending(pendingIds: string[]) {
    setDispatchedCandidateIds((prev) => {
      const next = new Set(prev);
      for (const id of pendingIds) next.add(id);
      return next;
    });
    await Promise.all(
      pendingIds.map((id) =>
        fetch("/api/brainstorm/item/variation/disposition", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entityId,
            variationId: id,
            disposition: "rejected",
          }),
        }).catch(() => undefined),
      ),
    );
    onRefreshExpanded?.();
  }

  // Look up score by variation id for inline rendering.
  const scoreById = useMemo(() => {
    const m = new Map<string, number>();
    if (envelope?.variation_scores) {
      for (const s of envelope.variation_scores) {
        m.set(s.variation_id, s.effectiveness_score);
      }
    }
    return m;
  }, [envelope]);

  // The envelope's "status" field surfaces friendly diagnostics
  // when scoring couldn't run — render those as the result-area
  // body instead of a fake score.
  const statusBanner =
    envelope && envelope.status !== "ok"
      ? `${diagnosticTitle(envelope.status)}${
          envelope.status_detail ? ` — ${envelope.status_detail}` : ""
        }`
      : null;

  // Stage color for the feature lane — the panel scores feature
  // variations, so we visually anchor in the features stage color
  // (blue) rather than introducing a foreign accent. Matches the
  // rest of the canvas language: each surface reads as belonging
  // to its lane.
  const FEATURES = appleVibe.stage.features;

  return (
    <div
      className="mt-3 overflow-hidden transition-shadow duration-300 ease-out"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.soft}`,
        borderRadius: appleVibe.radius.lg,
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Header strip — restrained chrome, lane-color accent only on
          the leading sparkle so the eye finds the row without it
          shouting. */}
      <div
        className="flex items-center justify-between gap-2 px-3.5 py-2.5"
        style={{
          borderBottom: envelope
            ? `1px solid ${appleVibe.stroke.hairline}`
            : "none",
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <Radar
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={2}
            style={{ color: FEATURES }}
          />
          <span
            className="text-[10.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.secondary }}
          >
            Mechanism effectiveness
          </span>
          <span
            className="hidden truncate text-[10.5px] font-light italic sm:inline"
            style={{ color: appleVibe.text.tertiary }}
          >
            · structural lift × specificity × addresses_pain
          </span>
          {scoredAtIso && (
            <span
              className="hidden text-[10px] font-light sm:inline"
              style={{ color: appleVibe.text.faint }}
              title={`Scored at ${new Date(scoredAtIso).toLocaleString()}`}
            >
              · scored {formatRelativeShort(scoredAtIso)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            void runScoring();
            void itemName; // referenced in tooltip below — silence unused lint
          }}
          title={`Re-run mechanism scoring against the room's mechanism graph for "${itemName}"`}
          disabled={busy}
          className="inline-flex flex-shrink-0 items-center gap-1.5 transition-all duration-150 ease-out active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: appleVibe.accent.primary,
            color: appleVibe.text.onAccent,
            borderRadius: appleVibe.radius.pill,
            padding: "5px 12px",
            fontSize: "10.5px",
            fontWeight: 600,
            letterSpacing: "0.02em",
            boxShadow: appleVibe.shadow.chip,
          }}
        >
          {busy ? "Scoring…" : envelope ? "Re-score" : "Score variations"}
        </button>
      </div>

      {error && (
        <div
          className="px-3.5 py-2"
          style={{
            background: "rgba(220,38,38,0.04)",
            borderTop: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          <p
            className="text-[11px] leading-snug"
            style={{ color: "rgba(127,29,29,0.95)" }}
          >
            {error}
          </p>
        </div>
      )}

      {envelope && !error && (
        <div className="space-y-2 px-3.5 py-3">
          {/* Diagnostic banner — soft amber surface, no harsh borders. */}
          {statusBanner && (
            <div
              className="px-3 py-2"
              style={{
                background: "rgba(245,158,11,0.06)",
                border: "1px solid rgba(245,158,11,0.20)",
                borderRadius: appleVibe.radius.sm,
              }}
            >
              <p
                className="text-[11.5px] leading-snug"
                style={{ color: "rgba(120,53,15,0.92)" }}
              >
                {statusBanner}
              </p>
            </div>
          )}

          {/* Result banner — chrome-on-chrome, faint lane-color tint
              so the eye reads it as "the feature lane's verdict." */}
          {envelope.status === "ok" && (
            <div
              className="px-3 py-2"
              style={{
                background: `linear-gradient(135deg, ${FEATURES}08 0%, transparent 60%)`,
                border: `1px solid ${appleVibe.stroke.hairline}`,
                borderRadius: appleVibe.radius.sm,
              }}
            >
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px]">
                <span className="inline-flex items-center gap-1">
                  <span
                    className="text-[9.5px] font-semibold uppercase tracking-[0.10em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    target
                  </span>
                  <span
                    className="font-medium"
                    style={{ color: appleVibe.text.primary }}
                  >
                    {envelope.target_entity_name ?? "?"}
                  </span>
                </span>
                <span
                  className="inline-block h-3 w-px"
                  style={{ background: appleVibe.stroke.hairline }}
                />
                <span className="inline-flex items-center gap-1">
                  <span
                    className="text-[9.5px] font-semibold uppercase tracking-[0.10em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    lift
                  </span>
                  <span
                    className="font-mono font-semibold tabular-nums"
                    style={{ color: appleVibe.text.primary }}
                  >
                    {envelope.lift_pct !== null
                      ? `${(envelope.lift_pct * 100).toFixed(0)}%`
                      : "—"}
                  </span>
                </span>
                <span
                  className="inline-block h-3 w-px"
                  style={{ background: appleVibe.stroke.hairline }}
                />
                <span className="inline-flex items-center gap-1">
                  <span
                    className="text-[9.5px] font-semibold uppercase tracking-[0.10em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    placebo
                  </span>
                  <PlaceboChip verdict={envelope.placebo_verdict} />
                </span>
              </div>
            </div>
          )}

          {/* Per-variation flat list — sorted by score desc. Bars use
              the features lane color so they read as belonging to
              the mechanism lane. */}
          {envelope.status === "ok" && scoreById.size > 0 && (
            <ul className="space-y-1">
              {[...variations]
                .map((v) => ({
                  v,
                  score: v.id ? scoreById.get(v.id) ?? 0 : 0,
                }))
                .sort((a, b) => b.score - a.score)
                .map(({ v, score }, i) => (
                  <li
                    key={v.id}
                    className="flex items-center gap-2.5 px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-[rgba(15,23,42,0.025)]"
                    style={{ borderRadius: appleVibe.radius.sm }}
                  >
                    <span
                      className="w-3.5 flex-shrink-0 font-mono text-[10px] font-semibold tabular-nums"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      #{i + 1}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-[12px] font-medium"
                      style={{ color: appleVibe.text.primary }}
                    >
                      {v.name}
                    </span>
                    <div className="flex w-28 flex-shrink-0 items-center gap-2">
                      <div
                        className="relative h-[5px] flex-1 overflow-hidden"
                        style={{
                          background: `${FEATURES}1F`,
                          borderRadius: appleVibe.radius.pill,
                        }}
                      >
                        <div
                          className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
                          style={{
                            width: `${Math.max(3, Math.min(100, score * 100))}%`,
                            background: `linear-gradient(90deg, ${FEATURES}D9 0%, ${FEATURES} 100%)`,
                            borderRadius: appleVibe.radius.pill,
                            boxShadow: `0 0 8px -1px ${FEATURES}55`,
                          }}
                        />
                      </div>
                      <span
                        className="w-7 flex-shrink-0 text-right font-mono text-[10.5px] font-semibold tabular-nums"
                        style={{ color: appleVibe.text.primary }}
                      >
                        {(score * 100).toFixed(0)}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          )}

          {/* Phase 5b — Experiment trigger + candidates section.
              Only renders when scoring succeeded (envelope.status === "ok")
              so the user has a target pain + gap to refine against.
              The trigger is intentionally subtle — a thin separator
              with a small graphite button. The candidates section
              below it surfaces only after a successful run, with
              an Apple-style "appeared from below" feel via the
              CSS transition on max-height. */}
          {envelope.status === "ok" && (
            <ExperimentTrigger
              busy={refining}
              error={refineError}
              onRun={runRefine}
            />
          )}

          {/* Pending candidates — variations with provenance="rd_iteration"
              + no disposition, minus any we just optimistically dispatched. */}
          {(() => {
            const pending = variations.filter(
              (v) =>
                v.id &&
                v.provenance === "rd_iteration" &&
                !v.disposition &&
                !dispatchedCandidateIds.has(v.id),
            );
            if (pending.length === 0) return null;
            return (
              <ExperimentCandidatesSection
                candidates={pending}
                targetRootCause={
                  refineTargetRootCause ??
                  pending[0]?.target_root_cause ??
                  null
                }
                featureColor={FEATURES}
                onElect={(id) =>
                  void dispatchCandidate(id, "elected")
                }
                onReject={(id) =>
                  void dispatchCandidate(id, "rejected")
                }
                onDiscardAll={() =>
                  void discardAllPending(
                    pending.map((c) => c.id!).filter(Boolean),
                  )
                }
              />
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── Experiment trigger sub-component ─────────────────────────────
//
// The thin separator + graphite "Run experiment on weakest gap"
// button. Visible only when a prior scoring run succeeded. Subtle
// by intent — we don't want to compete with the actual variation
// list above it, just offer the next action.

function ExperimentTrigger({
  busy,
  error,
  onRun,
}: {
  busy: boolean;
  error: string | null;
  onRun: () => void;
}) {
  return (
    <div className="mt-2 pt-3" style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}>
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10.5px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          Run an experiment — propose 3 new variants targeting the weakest gap
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          className="inline-flex flex-shrink-0 items-center gap-1.5 transition-all duration-150 ease-out active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: "transparent",
            color: appleVibe.text.secondary,
            border: `1px solid ${appleVibe.stroke.medium}`,
            borderRadius: appleVibe.radius.pill,
            padding: "4px 11px",
            fontSize: "10.5px",
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          {busy ? "Running…" : "Run experiment"}
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-[11px]" style={{ color: "rgba(127,29,29,0.95)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ── Experiment candidates section ────────────────────────────────
//
// Renders the new candidate IV settings as a dedicated section with
// the gap they target labeled at the top. Each row carries: name,
// description (truncated), compliance badge, score bar, Elect/Reject.
// Visually distinct from the existing variation list — narrower
// surface, faint lane-color tint, "candidates" framing — so the
// user understands these are PROPOSALS not committed variations.

function ExperimentCandidatesSection({
  candidates,
  targetRootCause,
  featureColor,
  onElect,
  onReject,
  onDiscardAll,
}: {
  candidates: ItemVariation[];
  targetRootCause: string | null;
  featureColor: string;
  onElect: (id: string) => void;
  onReject: (id: string) => void;
  onDiscardAll: () => void;
}) {
  return (
    <div
      className="mt-3 overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${featureColor}08 0%, transparent 70%)`,
        border: `1px solid ${appleVibe.stroke.soft}`,
        borderRadius: appleVibe.radius.sm,
      }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${appleVibe.stroke.hairline}` }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: featureColor }}
          >
            Candidates from experiment
          </span>
          {targetRootCause && (
            <span
              className="truncate text-[10.5px] font-light italic"
              style={{ color: appleVibe.text.tertiary }}
              title={`Each candidate targets: ${targetRootCause}`}
            >
              · targets: &ldquo;{targetRootCause}&rdquo;
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onDiscardAll}
          className="flex-shrink-0 text-[10px] font-medium underline-offset-2 hover:underline"
          style={{ color: appleVibe.text.tertiary }}
        >
          discard all
        </button>
      </div>
      <ul className="divide-y" style={{ borderColor: appleVibe.stroke.hairline }}>
        {candidates.map((c) => (
          <ExperimentCandidateRow
            key={c.id}
            candidate={c}
            featureColor={featureColor}
            onElect={() => c.id && onElect(c.id)}
            onReject={() => c.id && onReject(c.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function ExperimentCandidateRow({
  candidate: c,
  featureColor,
  onElect,
  onReject,
}: {
  candidate: ItemVariation;
  featureColor: string;
  onElect: () => void;
  onReject: () => void;
}) {
  const score =
    typeof c.effectiveness_score === "number"
      ? c.effectiveness_score
      : 0;
  const compliance =
    typeof c.constraint_compliance === "number"
      ? c.constraint_compliance
      : 1;
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="text-[12px] font-medium truncate"
              style={{ color: appleVibe.text.primary }}
            >
              {c.name}
            </span>
            {compliance < 0.9 && (
              <span
                className="inline-flex flex-shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  background: "rgba(245,158,11,0.10)",
                  color: "rgba(146,64,14,0.95)",
                  border: "1px solid rgba(245,158,11,0.22)",
                }}
                title={`Constraint compliance ${(compliance * 100).toFixed(0)}%`}
              >
                ⚠ strained
              </span>
            )}
          </div>
          <p
            className="mt-0.5 text-[11px] leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {c.description}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <div
              className="relative h-[4px] w-24 overflow-hidden"
              style={{
                background: `${featureColor}1F`,
                borderRadius: appleVibe.radius.pill,
              }}
            >
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${Math.max(3, Math.min(100, score * 100))}%`,
                  background: `linear-gradient(90deg, ${featureColor}D9 0%, ${featureColor} 100%)`,
                  borderRadius: appleVibe.radius.pill,
                }}
              />
            </div>
            <span
              className="font-mono text-[10px] font-semibold tabular-nums"
              style={{ color: appleVibe.text.tertiary }}
            >
              {(score * 100).toFixed(0)}
            </span>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onReject}
            className="rounded-full px-2 py-1 text-[10px] font-medium transition-colors duration-150 ease-out"
            style={{
              background: "transparent",
              color: appleVibe.text.tertiary,
              border: `1px solid ${appleVibe.stroke.hairline}`,
            }}
          >
            reject
          </button>
          <button
            type="button"
            onClick={onElect}
            className="rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all duration-150 ease-out active:translate-y-px"
            style={{
              background: appleVibe.accent.primary,
              color: appleVibe.text.onAccent,
              boxShadow: appleVibe.shadow.chip,
            }}
          >
            elect
          </button>
        </div>
      </div>
    </li>
  );
}

/** Placebo verdict chip — semantic color (green/red/slate) but
 *  rendered with appleVibe-style alpha overlays so it doesn't read
 *  as a foreign UI library color. */
function PlaceboChip({
  verdict,
}: {
  verdict: "pass" | "fail" | "skip" | null;
}) {
  const tone =
    verdict === "pass"
      ? { bg: "rgba(22,163,74,0.10)", fg: "rgba(20,83,45,0.95)" }
      : verdict === "fail"
      ? { bg: "rgba(220,38,38,0.10)", fg: "rgba(127,29,29,0.95)" }
      : { bg: "rgba(15,23,42,0.06)", fg: "rgba(15,23,42,0.62)" };
  return (
    <span
      className="inline-flex items-center text-[9.5px] font-bold uppercase tracking-[0.10em]"
      style={{
        background: tone.bg,
        color: tone.fg,
        padding: "2px 7px",
        borderRadius: appleVibe.radius.pill,
      }}
    >
      {verdict ?? "—"}
    </span>
  );
}

/** Friendly title for each non-OK scoring status. */
function diagnosticTitle(
  status: VariationScoreEnvelope["status"],
): string {
  switch (status) {
    case "no_target":
      return "No target pain — generate correlations first";
    case "no_variations":
      return "No variations to score";
    case "lever_unreachable":
      return "Lever isn't connected to a pain within the simulation depth";
    case "sim_failed":
      return "Simulation failed";
    case "not_feature":
      return "Scoring only applies to feature cards";
    case "no_expanded":
      return "Item not expanded yet";
    default:
      return "Scoring unavailable";
  }
}

/** Phase 4c — reconstruct the VariationScoreEnvelope from the
 *  persisted expanded_detail.effectiveness_envelope + per-variation
 *  effectiveness_score fields written by /api/brainstorm/item/variation/score.
 *
 *  Returns null when the entity has never been scored. The shared
 *  signals (target / lift / placebo / status) live on the envelope
 *  field; per-variation scores live on each variation row. We splice
 *  them back together so the panel can render its prior run on
 *  drawer re-open without re-spending the MC budget.
 *
 *  Note: structural_signal + specificity_multiplier are NOT persisted
 *  per-row (they're shared across siblings of the same feature).
 *  We reconstruct them defensively from the envelope's lift_pct +
 *  placebo_verdict so the per-row VariationScore type stays whole,
 *  but the per-row fields aren't surfaced in the UI anyway — only
 *  the final effectiveness_score drives the bar. */
function reconstructEnvelopeFromExpanded(
  expanded: ExpandedItemDetail | null,
  entityId: string,
  itemName: string,
): VariationScoreEnvelope | null {
  if (!expanded?.effectiveness_envelope) return null;
  const env = expanded.effectiveness_envelope;
  // Reconstruct shared structural+specificity for the per-row shape.
  const structuralSignal =
    typeof env.lift_pct === "number"
      ? Math.min(1, Math.abs(env.lift_pct))
      : 0;
  const specificity =
    env.placebo_verdict === "pass"
      ? 1.0
      : env.placebo_verdict === "fail"
        ? 0.2
        : 0.5;
  const variationScores = (expanded.variations ?? [])
    .filter(
      (v): v is ItemVariation & { id: string; effectiveness_score: number } =>
        typeof v.id === "string" &&
        typeof v.effectiveness_score === "number",
    )
    .map((v) => ({
      variation_id: v.id,
      variation_name: v.name,
      addresses_pain:
        typeof v.addresses_pain === "number" ? v.addresses_pain : 0.5,
      effectiveness_score: v.effectiveness_score,
      structural_signal: structuralSignal,
      specificity_multiplier: specificity,
    }));
  // Carry the scored_at timestamp through so the panel can render
  // "scored Xm ago" — VariationScoreEnvelope doesn't have a field
  // for it, so we attach as an extra property the panel knows about.
  return {
    lever_entity_id: entityId,
    lever_entity_name: itemName,
    target_entity_id: env.target_entity_id,
    target_entity_name: env.target_entity_name,
    target_edge_strength: env.target_edge_strength,
    variation_scores: variationScores,
    lift_pct: env.lift_pct,
    lift_band: env.lift_band,
    placebo_verdict: env.placebo_verdict,
    placebo_ratio: env.placebo_ratio,
    status: env.status,
    status_detail: env.status_detail,
    // Stash scored_at on the envelope object — the panel reads it
    // off via an `as` cast (see initialEnvelope handling in
    // VariationScoringPanel). Not on the canonical type because the
    // canonical envelope is the API response shape, which doesn't
    // round-trip a persisted timestamp.
    ...({ scored_at: env.scored_at } as Record<string, unknown>),
  } as VariationScoreEnvelope;
}
