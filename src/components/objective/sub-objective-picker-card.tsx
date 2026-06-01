"use client";

// ── Sub-Objective Picker Card ──
//
// Apple-vibe multi-select carousel of AI-generated sub-objectives.
// Recommended top-3 are pre-checked. User can toggle picks, ask for
// a regeneration, then Confirm to advance the canvas into "main"
// stage (Phase 4 forks them onto the whiteboard).
//
// Variant Lab additions:
//   • Lens coverage strip at top — surfaces which parent-objective
//     readings are covered by elected proposals (orphans flagged)
//   • Per-proposal disposition (elect/defer/reject) replaces the
//     binary checkbox. "Picked" = "elected".
//   • Batch dividers when multiple generation passes have run
//   • Variant Lab bar below proposals — primary "Generate 3 variants"
//     button + expandable intent palette

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Pause,
  RefreshCw,
  X,
} from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  SubObjectiveBatch,
  SubObjectiveBlock,
  SubObjectiveDisposition,
  SubObjectiveIntent,
  SubObjectiveProposal,
} from "@/lib/objective-canvas/sub-objective-state";
import type { IntentPreference } from "@/lib/objective-canvas/decision-log";
import type {
  ClusterAnalysis,
  ProposalCluster,
} from "@/lib/objective-canvas/cluster-proposals";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";
import { CONNECTOR_INK } from "@/lib/objective-canvas/connector-tokens";
import { CanonicalConceptDrawer } from "@/components/canonical/canonical-concept-drawer";
import { LayerPositionChip } from "@/components/objective/layer-position-chip";
import { BrainstormButton } from "@/components/objective/brainstorm/brainstorm-button";
import { BrainstormPanel } from "@/components/objective/brainstorm/brainstorm-panel";

interface ObjectiveAnnotationLite {
  phrase: string;
  reading?: string;
  weight?: number;
  layer_tag?: string | null;
}

interface Props {
  spaceId: string;
  /** Server-rendered initial block (if proposals already exist). */
  initial: SubObjectiveBlock | null;
  /** Parent objective annotations (Variant Lab lens). When non-empty
   *  the lens coverage strip renders + the variant lab can fire
   *  gap_fill intent. */
  annotations?: ObjectiveAnnotationLite[];
  /** Variant Lab — user's top-preferred intent computed from prior
   *  decisions. Used as the "Suggested" affordance when no lens
   *  gap exists. Null for new users → falls back to "creative". */
  preferredIntent?: SubObjectiveIntent | null;
  /** Source of the preferred intent — drives the user-facing label
   *  on the suggestion ("matches your past picks" vs "popular with
   *  similar users"). */
  preferenceSource?: "user" | "global" | "none";
  /** Per-intent breakdown for the retrospective mini-panel. Empty
   *  array → panel hides. Drives transparency on what the system
   *  has learned. */
  userPrefs?: IntentPreference[];
  /** The decomposed layer stack. Its layers become the picker's category
   *  folders (tabs) in the immersive view, ordering the features by layer.
   *  Null before decomposition lands → the view falls back to one group. */
  objectiveStack?: ObjectiveStack | null;
  /** Called when confirm succeeds. Parent flips into "main" stage. */
  onConfirmed: () => void;
}

const INTENT_LABEL: Record<SubObjectiveIntent, string> = {
  initial: "Initial",
  creative: "Creative",
  concrete: "Concrete",
  contrarian: "Contrarian",
  gap_fill: "Fill gaps",
  ambitious: "Ambitious",
  wildcard: "Wildcard",
};

const INTENT_DESCRIPTION: Record<SubObjectiveIntent, string> = {
  initial: "Default decomposition.",
  creative: "Distant-domain analogies; surprising cuts.",
  concrete: "Implementation-anchored, ship-in-2-weeks.",
  contrarian: "Inverts a shared assumption of the existing set.",
  gap_fill: "Targets lens readings nothing else covers.",
  ambitious: "6+ month horizon, compounding payoff.",
  wildcard: "One deliberately-weird cut + reasoned justification.",
};

export function SubObjectivePickerCard({
  spaceId,
  initial,
  annotations = [],
  preferredIntent = null,
  preferenceSource = "none",
  userPrefs = [],
  objectiveStack = null,
  onConfirmed,
}: Props) {
  const [block, setBlock] = useState<SubObjectiveBlock | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [loading, setLoading] = useState(initial === null);
  const [variantInFlight, setVariantInFlight] =
    useState<SubObjectiveIntent | null>(null);
  // Cluster view state — the LLM clustering pass groups proposals
  // into themes (~5-8 clusters from 15-25 proposals). When loaded,
  // the picker offers a toggle between the default batch view and
  // the clustered view so the user can see the deduplicated
  // conceptual structure.
  const [viewMode, setViewMode] = useState<"batches" | "clusters">("batches");
  const [clusterBusy, setClusterBusy] = useState(false);
  const [clusterError, setClusterError] = useState<string | null>(null);
  // Cross-space KG — canonical concepts the user has explored across
  // other spaces, semantically related to this objective. Returned by
  // /propose alongside sub_objectives. Powers the per-proposal "links
  // to" badges + the top-level "Concepts reused" strip.
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
  // CanonicalConceptDrawer mounts as a right-edge slide-in. Chips in
  // both the PriorConceptsStrip + per-proposal "↻ links to" badges
  // fire this. Null = closed.
  const [openConceptCode, setOpenConceptCode] = useState<string | null>(null);
  // Brainstorm panel (Phase 4 of BRAINSTORM_MODULE_SPEC.md) — autopilot
  // version of the variant lab. The "Generate better" bar stays for
  // single-intent manual presses; this opens the orchestrated 3-intent
  // → cleanup → critique → rank flow in a rail-card panel.
  //
  // Phase 7-Consolidate: the prior BrainstormLibraryPopover + Library
  // button + rehydrate state were removed. Past sessions live as
  // canonical library_objects of type='brainstorm_cluster' surfaced
  // through the existing LibraryPanel — one library, one storage layer.
  const [brainstormOpen, setBrainstormOpen] = useState(false);
  // Immersive presentation: lead with the recommended ≤3 as a read-and-
  // confirm Vision Pro view. "See all options" flips this true to reveal
  // the full power-user picker (dispositions, clustering, variant lab).
  const [showAll, setShowAll] = useState(false);

  // ── Auto-propose on mount if nothing is cached ──
  useEffect(() => {
    if (block !== null) return;
    void runAction("propose", { mode: "initial" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Materialize the recommended trio as explicit picks ──
  // electedIds otherwise FALLS BACK to the recommended set when no
  // dispositions exist — so unticking a recommended (in the immersive view
  // OR the full list) wouldn't "stick": the fallback would re-elect it.
  // Materializing them as real "elected" dispositions once, on first load,
  // makes selection explicit and keeps the immersive view + "See all"
  // perfectly in sync. Optimistic local + persisted (soft-fail).
  const materializedRef = useRef(false);
  useEffect(() => {
    if (materializedRef.current || !block) return;
    const proposals = block.proposals ?? [];
    if (proposals.length === 0) return;
    const hasExplicit =
      proposals.some((p) => p.disposition) ||
      (block.picked_proposal_ids?.length ?? 0) > 0;
    if (hasExplicit) {
      materializedRef.current = true;
      return;
    }
    const recIds = proposals.filter((p) => p.recommended).map((p) => p.id);
    materializedRef.current = true;
    if (recIds.length === 0) return;
    const idSet = new Set(recIds);
    const elect = (p: SubObjectiveProposal): SubObjectiveProposal =>
      idSet.has(p.id) ? { ...p, disposition: "elected" } : p;
    setBlock((prev) =>
      prev
        ? {
            ...prev,
            proposals: prev.proposals.map(elect),
            batches: prev.batches?.map((b) => ({
              ...b,
              proposals: b.proposals.map(elect),
            })),
          }
        : prev,
    );
    void Promise.all(
      recIds.map((id) =>
        fetch("/api/brainstorm/sub-objectives/disposition", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            proposalId: id,
            disposition: "elected",
          }),
        }).catch(() => null),
      ),
    );
  }, [block, spaceId]);

  // Auto-clustering — fingerprint of the most-recent fired set so we
  // don't re-fire while a result is still in flight or already saved
  // for the same proposal set. Reset on /propose so a new variant
  // batch can re-cluster automatically.
  const lastAutoClusterKeyRef = useRef<string | null>(null);

  // Silent auto-cluster — fires whenever there are ≥5 proposals and
  // either no analysis exists yet or the current analysis is stale
  // (a new variant batch arrived since the last run). The user no
  // longer needs to click "Detect clusters"; it just happens. View
  // mode is NOT switched automatically — the batch view remains the
  // default so users see what each generation pass produced; the
  // toggle to "by theme" stays available.
  useEffect(() => {
    if (!block) return;
    const proposals = block.proposals ?? [];
    if (proposals.length < 5) return;
    if (clusterBusy) return;
    const key = proposals.map((p) => p.id).sort().join("|");
    const existing = block.cluster_analysis as ClusterAnalysis | undefined;
    const existingKey =
      existing && Array.isArray(existing.clusters)
        ? existing.clusters
            .flatMap((c) => c.proposal_ids)
            .sort()
            .join("|")
        : null;
    const isFresh = existingKey !== null && existingKey === key;
    if (isFresh) return;
    if (lastAutoClusterKeyRef.current === key) return;
    lastAutoClusterKeyRef.current = key;
    setClusterBusy(true);
    setClusterError(null);
    void (async () => {
      try {
        const res = await fetch("/api/brainstorm/sub-objectives/cluster", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, mode: "default" }),
        });
        const json = await res.json();
        if (!res.ok) {
          setClusterError(json?.error ?? "Clustering failed.");
          lastAutoClusterKeyRef.current = null; // allow retry on next change
          return;
        }
        setBlock((prev) =>
          prev ? { ...prev, cluster_analysis: json.cluster_analysis } : prev,
        );
      } catch (err) {
        setClusterError(
          err instanceof Error ? err.message : "Network error.",
        );
        lastAutoClusterKeyRef.current = null;
      } finally {
        setClusterBusy(false);
      }
    })();
  }, [block, clusterBusy, spaceId]);

  // Top-8 weight-sorted lens — matches the prompt projection so
  // lens_coverage indices line up with the chips we render.
  const lens = useMemo(() => {
    return [...annotations]
      .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
      .slice(0, 8);
  }, [annotations]);

  /** All proposals across batches, in batch order. Derived from
   *  block.proposals (which the backend already flattens). Memoized
   *  so its identity is stable for the downstream useMemo deps. */
  const allProposals = useMemo(
    () => block?.proposals ?? [],
    [block],
  );

  /** Disposition-driven election state. "picked" = "elected".
   *  Falls back to recommended trio when no dispositions exist yet
   *  (first render / legacy block). */
  const electedIds = useMemo(() => {
    if (!block) return new Set<string>();
    const explicit = allProposals
      .filter((p) => p.disposition === "elected")
      .map((p) => p.id);
    if (explicit.length > 0) return new Set(explicit);
    // Back-compat: legacy block with picked_proposal_ids
    if (block.picked_proposal_ids.length > 0) {
      return new Set(block.picked_proposal_ids);
    }
    // First render: pre-elect recommended trio
    return new Set(
      allProposals.filter((p) => p.recommended).map((p) => p.id),
    );
  }, [block, allProposals]);

  /** Lens coverage = which lens indices (1..lensSize) are touched
   *  by any ELECTED proposal. Powers the coverage strip + suggests
   *  gap_fill when there are uncovered entries. */
  const coverage = useMemo(() => {
    const covered = new Set<number>();
    for (const p of allProposals) {
      if (!electedIds.has(p.id)) continue;
      if (!Array.isArray(p.lens_coverage)) continue;
      for (const idx of p.lens_coverage) {
        if (idx >= 1 && idx <= lens.length) covered.add(idx);
      }
    }
    const uncovered: number[] = [];
    for (let i = 1; i <= lens.length; i++) {
      if (!covered.has(i)) uncovered.push(i);
    }
    return { covered, uncovered };
  }, [allProposals, electedIds, lens]);

  async function runAction(
    kind: "propose" | "confirm",
    payload?: {
      mode?: "initial" | "regenerate" | "variant";
      intent?: SubObjectiveIntent;
      /** Explicit pick set — used by the immersive presentation, which
       *  tracks selection locally rather than via server dispositions.
       *  Falls back to the disposition-derived electedIds when omitted. */
      pickedIds?: string[];
    },
  ) {
    setError(null);
    if (payload?.mode === "variant" && payload.intent) {
      setVariantInFlight(payload.intent);
    }
    startTransition(async () => {
      try {
        if (kind === "propose") {
          setLoading(block === null);
          const res = await fetch("/api/brainstorm/sub-objectives/propose", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              spaceId,
              mode: payload?.mode ?? "initial",
              intent: payload?.intent,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setError(json?.error ?? "Could not propose sub-objectives.");
            setLoading(false);
            setVariantInFlight(null);
            return;
          }
          const nextBlock = json.sub_objectives as SubObjectiveBlock;
          setBlock(nextBlock);
          // Capture cross-space prior concepts (returned on every
          // /propose response — initial cache hit, regenerate, and
          // variant batch). Empty array when no prior KG signal.
          if (Array.isArray(json?.prior_concepts)) {
            setPriorConcepts(json.prior_concepts);
          }
          setLoading(false);
          setVariantInFlight(null);
        } else if (kind === "confirm") {
          const ids = payload?.pickedIds ?? Array.from(electedIds);
          if (!block || ids.length === 0) return;
          const res = await fetch("/api/brainstorm/sub-objectives/confirm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              spaceId,
              pickedProposalIds: ids,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setError(json?.error ?? "Could not confirm picks.");
            return;
          }
          onConfirmed();
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Network error. Try again.",
        );
        setLoading(false);
        setVariantInFlight(null);
      }
    });
  }

  /** Optimistic disposition update — local mutation immediately,
   *  PATCH in the background. Reverts on failure. */
  async function setDisposition(
    proposalId: string,
    disposition: SubObjectiveDisposition,
  ) {
    if (!block) return;
    const prev = block;
    const apply = (p: SubObjectiveProposal) =>
      p.id === proposalId ? { ...p, disposition } : p;
    const optimistic: SubObjectiveBlock = {
      ...block,
      proposals: block.proposals.map(apply),
      batches: block.batches?.map((b) => ({
        ...b,
        proposals: b.proposals.map(apply),
      })),
    };
    setBlock(optimistic);
    try {
      const res = await fetch(
        "/api/brainstorm/sub-objectives/disposition",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, proposalId, disposition }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Could not save disposition.");
        setBlock(prev);
        return;
      }
      if (json?.sub_objectives) {
        setBlock(json.sub_objectives as SubObjectiveBlock);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setBlock(prev);
    }
  }

  /** Bulk disposition update — drives the Select-all toggle. Sets
   *  every proposal's disposition to the same value (elected to
   *  pick all, null to clear) optimistically, then fans out PATCHes
   *  in parallel. Reverts on any failure. */
  async function setAllDispositions(disposition: SubObjectiveDisposition) {
    if (!block) return;
    const prev = block;
    const apply = (p: SubObjectiveProposal) => ({ ...p, disposition });
    const optimistic: SubObjectiveBlock = {
      ...block,
      proposals: block.proposals.map(apply),
      batches: block.batches?.map((b) => ({
        ...b,
        proposals: b.proposals.map(apply),
      })),
    };
    setBlock(optimistic);
    try {
      const results = await Promise.all(
        prev.proposals.map((p) =>
          fetch("/api/brainstorm/sub-objectives/disposition", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              spaceId,
              proposalId: p.id,
              disposition,
            }),
          }),
        ),
      );
      const failed = results.find((r) => !r.ok);
      if (failed) {
        setError("Could not update all picks.");
        setBlock(prev);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setBlock(prev);
    }
  }

  // ── Render ──
  if (loading) {
    return (
      <Shell>
        <SkeletonRows />
      </Shell>
    );
  }

  if (!block || allProposals.length === 0) {
    return (
      <Shell>
        <Eyebrow>Sub-objectives</Eyebrow>
        <Heading>Nothing proposed yet</Heading>
        <p
          className="mt-2 text-[13.5px] font-light"
          style={{ color: appleVibe.text.secondary }}
        >
          Generate proposals from your refined objective.
        </p>
        <Primary
          label="Propose sub-objectives"
          onClick={() => runAction("propose", { mode: "initial" })}
          busy={busy}
        />
        {error && <ErrorRow message={error} />}
      </Shell>
    );
  }

  // ── Immersive recommended presentation (default lead view) ──
  // Lead with the recommended ≤3 in a clear, read-and-confirm Vision Pro
  // layout. "See all options" reveals the full power-user picker below.
  const recommended = allProposals.filter((p) => p.recommended);
  if (!showAll && recommended.length > 0) {
    return (
      <RecommendedPresentation
        recommended={recommended}
        allProposals={allProposals}
        totalCount={allProposals.length}
        electedCount={electedIds.size}
        category={block.category}
        clusterAnalysis={block.cluster_analysis as ClusterAnalysis | undefined}
        objectiveStack={objectiveStack}
        busy={busy}
        error={error}
        isElected={(id) => electedIds.has(id)}
        onToggle={(id) =>
          setDisposition(id, electedIds.has(id) ? "rejected" : "elected")
        }
        onConfirm={() => runAction("confirm")}
        onSeeAll={() => setShowAll(true)}
        onRegenerate={() => runAction("propose", { mode: "regenerate" })}
      />
    );
  }

  const recommendedCount = recommended.length;
  const batches: SubObjectiveBatch[] = block.batches ?? [];
  const hasBatches = batches.length > 1; // only show dividers when >1
  const totalElected = electedIds.size;

  // Cluster analysis — present when the user has run the Tier-2 LLM
  // pass at least once. Stale when proposals_hash doesn't match the
  // current set (user has added a batch since clustering ran).
  const clusterAnalysis = block.cluster_analysis as
    | ClusterAnalysis
    | undefined;
  const proposalIdsKey = allProposals.map((p) => p.id).sort().join("|");
  const clusterIsStale =
    clusterAnalysis &&
    Array.isArray(clusterAnalysis.clusters) &&
    clusterAnalysis.clusters.length > 0 &&
    !clusterAnalysis.clusters
      .flatMap((c) => c.proposal_ids)
      .sort()
      .join("|")
      .startsWith(proposalIdsKey.slice(0, 50)); // cheap staleness check
  // Show the cluster CTA when there are enough proposals for
  // clustering to be useful (5+). Show the cluster VIEW toggle when
  // analysis exists.
  const canCluster = allProposals.length >= 5;
  const hasClusters =
    !!clusterAnalysis &&
    Array.isArray(clusterAnalysis.clusters) &&
    clusterAnalysis.clusters.length > 0;

  /** Find canonical concepts whose display_name appears verbatim in
   *  a proposal's title + summary. Case-insensitive substring match
   *  is cheap and works well enough for "did the LLM link to this
   *  concept" detection — the prompt rule asks the LLM to use the
   *  display_name verbatim when linking. Returns sorted by space_count
   *  desc (loudest cross-space evidence first).
   *
   *  Includes canonical_code so chip clicks can open
   *  CanonicalConceptDrawer for cross-space inspection. */
  function linkedConceptsForProposal(p: SubObjectiveProposal) {
    if (priorConcepts.length === 0) return [];
    const haystack = `${p.title} ${p.summary}`.toLowerCase();
    const matches: Array<{
      display_name: string;
      space_count: number;
      canonical_code: string;
    }> = [];
    for (const c of priorConcepts) {
      if (c.display_name.length < 4) continue; // skip noise matches
      if (haystack.includes(c.display_name.toLowerCase())) {
        matches.push({
          display_name: c.display_name,
          space_count: c.space_count,
          canonical_code: c.canonical_code,
        });
      }
    }
    matches.sort((a, b) => b.space_count - a.space_count);
    return matches.slice(0, 3); // cap per-row to keep dense
  }

  async function runCluster(force = false) {
    setClusterError(null);
    setClusterBusy(true);
    try {
      const res = await fetch("/api/brainstorm/sub-objectives/cluster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          mode: force ? "force" : "default",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setClusterError(json?.error ?? "Clustering failed.");
        return;
      }
      // Merge the analysis into the local block so the toggle appears
      // and the cluster view renders without a full page refresh.
      setBlock((prev) =>
        prev ? { ...prev, cluster_analysis: json.cluster_analysis } : prev,
      );
      setViewMode("clusters");
    } catch (err) {
      setClusterError(
        err instanceof Error ? err.message : "Network error.",
      );
    } finally {
      setClusterBusy(false);
    }
  }

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <Eyebrow>
          {allProposals.length} {block.category || "proposed"}
          {hasBatches && ` · ${batches.length} generations`}
        </Eyebrow>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              setAllDispositions(
                totalElected === allProposals.length ? null : "elected",
              )
            }
            disabled={busy || allProposals.length === 0}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.secondary,
              cursor: busy ? "wait" : "pointer",
            }}
            title={
              totalElected === allProposals.length
                ? "Clear all picks"
                : "Pick every proposal"
            }
          >
            <Check className="h-3 w-3" strokeWidth={2} />
            {totalElected === allProposals.length ? "Clear all" : "Select all"}
          </button>
          <button
            type="button"
            onClick={() => runAction("propose", { mode: "regenerate" })}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.secondary,
              cursor: busy ? "wait" : "pointer",
            }}
            title="Wipe everything and regenerate from scratch"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={2} />
            Reset
          </button>
        </div>
      </div>

      <Heading>Pick the ones you want to fork</Heading>
      <p
        className="mt-1.5 text-[12.5px] font-light"
        style={{ color: appleVibe.text.secondary }}
      >
        Top {recommendedCount} are pre-checked — feel free to swap or add
        more. Each pick becomes its own room with a Pain → Features →
        Outcomes → Objective layered analysis.
      </p>

      {/* Lens coverage strip — only when annotations exist */}
      {lens.length > 0 && (
        <LensCoverageStrip
          lens={lens}
          covered={coverage.covered}
          uncovered={coverage.uncovered}
          electedCount={totalElected}
        />
      )}

      {/* Cross-space KG strip — concepts the user has explored across
          OTHER spaces, semantically related to this objective. Renders
          when prior_concepts came back non-empty from /propose.
          Each chip = "↻ Concept (N spaces)" + click opens
          CanonicalConceptDrawer for the full cross-space view. */}
      {priorConcepts.length > 0 && (
        <PriorConceptsStrip
          concepts={priorConcepts}
          onConceptClick={setOpenConceptCode}
        />
      )}

      {/* Cluster bar — auto-fires on the proposal set; renders only
          when there's something to surface (in-flight, results, or
          error). View toggle flips between batch view and theme
          view; user can manually re-cluster from the bar. */}
      {canCluster && (
        <ClusterControlBar
          hasClusters={hasClusters}
          clusterCount={clusterAnalysis?.clusters?.length ?? 0}
          stale={!!clusterIsStale}
          viewMode={viewMode}
          onViewMode={setViewMode}
          onRerun={() => runCluster(true)}
          busy={clusterBusy}
          error={clusterError}
        />
      )}

      {/* Proposals — three view modes:
            1. clusters (when hasClusters && viewMode === "clusters")
            2. batches  (when hasBatches)
            3. flat     (single batch, legacy) */}
      <div className="mt-5">
        {viewMode === "clusters" && hasClusters && clusterAnalysis ? (
          <ClusterView
            clusters={clusterAnalysis.clusters}
            proposalsById={
              new Map(allProposals.map((p) => [p.id, p] as const))
            }
            electedIds={electedIds}
            setDisposition={setDisposition}
            disabled={busy}
            linkedConceptsForProposal={linkedConceptsForProposal}
            onConceptClick={setOpenConceptCode}
          />
        ) : hasBatches ? (
          batches.map((b, batchIdx) => (
            <BatchSection
              key={b.id}
              batch={b}
              isFirst={batchIdx === 0}
              electedIds={electedIds}
              setDisposition={setDisposition}
              disabled={busy}
              linkedConceptsForProposal={linkedConceptsForProposal}
              onConceptClick={setOpenConceptCode}
            />
          ))
        ) : (
          <ul className="flex flex-col gap-2">
            {allProposals.map((p) => (
              <ProposalRow
                key={p.id}
                proposal={p}
                disposition={p.disposition ?? null}
                isElected={electedIds.has(p.id)}
                onSetDisposition={(d) => setDisposition(p.id, d)}
                disabled={busy}
                lens={lens}
                linkedConcepts={linkedConceptsForProposal(p)}
                onConceptClick={setOpenConceptCode}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Brainstorm — autopilot version of the variant lab. Sits above
          the manual "Generate better" bar so the orchestrated flow is
          the primary affordance. Phase 7-Consolidate removed the
          parallel Library popover — saved sessions appear in the
          canonical LibraryPanel (library_objects of type 'brainstorm_cluster'). */}
      <div className="mt-5 flex items-center justify-between gap-2">
        <BrainstormButton
          onClick={() => setBrainstormOpen(true)}
          disabled={busy || !block || allProposals.length === 0}
        />
        <span
          className="text-[10.5px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          or steer one intent at a time below ↓
        </span>
      </div>

      {/* Variant Lab bar — generate more, layered onto existing.
          Suggested-intent priority:
            1. gap_fill when there are uncovered lens entries (most
               specific signal — fill the actual holes)
            2. the user's revealed preference from prior dispositions
               (per-user personalization, no extra LLM cost)
            3. population-wide preference from the cross-user
               flywheel (bootstraps new users with the community's
               discovered patterns)
            4. "creative" as a generic divergence fallback */}
      <VariantLabBar
        intentInFlight={variantInFlight}
        suggestedIntent={
          coverage.uncovered.length > 0
            ? "gap_fill"
            : preferredIntent ?? "creative"
        }
        suggestedIntentSource={
          coverage.uncovered.length > 0
            ? "lens_gap"
            : preferenceSource === "user"
              ? "user_preference"
              : preferenceSource === "global"
                ? "community_preference"
                : "default"
        }
        onGenerate={(intent) =>
          runAction("propose", { mode: "variant", intent })
        }
        disabled={busy}
      />

      {/* Retrospective mini-panel — shows the user the per-intent
          pattern the system has learned. Only renders when there's
          actually signal (≥1 elect or reject). Transparency for
          personalization. */}
      <RetrospectivePanel userPrefs={userPrefs} />


      <div
        className="mt-5 flex items-center justify-between border-t pt-4"
        style={{ borderColor: appleVibe.stroke.hairline }}
      >
        <span
          className="text-[11px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          {totalElected} of {allProposals.length} elected
        </span>
        <button
          type="button"
          onClick={() => runAction("confirm")}
          disabled={busy || totalElected === 0}
          className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-[13px] font-semibold"
          style={{
            background:
              totalElected > 0 && !busy
                ? appleVibe.accent.primary
                : appleVibe.surface.chip,
            color:
              totalElected > 0 && !busy
                ? appleVibe.text.onAccent
                : appleVibe.text.tertiary,
            borderRadius: appleVibe.radius.md,
            cursor:
              totalElected > 0 && !busy ? "pointer" : "not-allowed",
          }}
        >
          <span>{busy ? "Working…" : "Fork onto canvas"}</span>
          {!busy && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.25} />}
        </button>
      </div>

      {error && <ErrorRow message={error} />}

      {/* Cross-space KG drawer — opened by clicking any prior-concept
          chip (in the strip OR on a proposal). Single mount handles
          all chip clicks across the picker. */}
      {openConceptCode && (
        <CanonicalConceptDrawer
          canonicalCode={openConceptCode}
          onClose={() => setOpenConceptCode(null)}
          currentSpaceId={spaceId}
        />
      )}

      {/* Brainstorm panel (BRAINSTORM_MODULE_SPEC.md Phase 4). Rail-card
          chrome — fixed-positioned, canvas-underneath stays interactive.
          onElected mirrors disposition locally so the picker's lens
          coverage strip + total counter reflect the change without a
          server re-fetch (the elect-candidate route already wrote it). */}
      <BrainstormPanel
        open={brainstormOpen}
        onClose={() => setBrainstormOpen(false)}
        spaceId={spaceId}
        onElected={(proposalId) => {
          setBlock((prev) => {
            if (!prev) return prev;
            const electOne = (p: SubObjectiveProposal): SubObjectiveProposal =>
              p.id === proposalId
                ? { ...p, disposition: "elected" }
                : p;
            return {
              ...prev,
              proposals: prev.proposals.map(electOne),
              batches: (prev.batches ?? []).map((b) => ({
                ...b,
                proposals: b.proposals.map(electOne),
              })),
            };
          });
        }}
      />
    </Shell>
  );
}

// ── Immersive recommended presentation ──────────────────────────────
//
// The default lead view: the recommended ≤3 proposals as large, frosted,
// read-and-confirm cards (Apple Vision Pro vibe — depth, glow, generous
// space, lead-with-the-recommendation). The user reads, optionally drops
// one, and confirms; "See all options" opens the full power-user picker.
// Selection is tracked LOCALLY (init = all recommended) and handed to the
// parent's confirm as an explicit id set, so it never depends on the
// server-side disposition fallback.

export function RecommendedPresentation({
  recommended,
  allProposals,
  totalCount,
  electedCount,
  clusterAnalysis,
  objectiveStack,
  busy,
  error,
  isElected,
  onToggle,
  onConfirm,
  onSeeAll,
  onRegenerate,
}: {
  recommended: SubObjectiveProposal[];
  allProposals: SubObjectiveProposal[];
  totalCount: number;
  electedCount: number;
  category?: string | null;
  clusterAnalysis?: ClusterAnalysis;
  objectiveStack?: ObjectiveStack | null;
  busy: boolean;
  error: string | null;
  isElected: (id: string) => boolean;
  onToggle: (id: string) => void;
  onConfirm: () => void;
  onSeeAll: () => void;
  onRegenerate: () => void;
}) {
  const moreCount = Math.max(0, totalCount - recommended.length);

  // The category folders the user tabs between. PRIMARY: the decomposed
  // layer stack — each layer (L1…Ln) is a folder, ordered top-down, so the
  // features lay out by layer (this replaces the standalone Objective Stack
  // widget). FALLBACK: cluster themes, then a single "All" group before
  // decomposition/clustering have landed.
  type PickerGroup = {
    label: string;
    ordinal?: number;
    recommended: SubObjectiveProposal[];
    variations: SubObjectiveProposal[];
  };
  const categories = useMemo<PickerGroup[]>(() => {
    // Within a layer: the recommended picks are the complementary set
    // (shown); the rest are its variations (alternatives — revealed via
    // "See N variations in this layer").
    const split = (members: SubObjectiveProposal[]) => ({
      recommended: members.filter((p) => p.recommended),
      variations: members.filter((p) => !p.recommended),
    });
    // Primary — by layer. Group ALL proposals so each layer carries both
    // its picks and its alternatives.
    const layers = [...(objectiveStack?.layers ?? [])].sort(
      (a, b) => b.ordinal - a.ordinal,
    );
    if (layers.length > 0) {
      const byOrd = new Map<number, SubObjectiveProposal[]>();
      const unplaced: SubObjectiveProposal[] = [];
      for (const p of allProposals) {
        const ord =
          Array.isArray(p.layer_ordinals) && p.layer_ordinals.length > 0
            ? p.layer_ordinals[0]
            : null;
        if (ord == null) {
          unplaced.push(p);
          continue;
        }
        const arr = byOrd.get(ord) ?? [];
        arr.push(p);
        byOrd.set(ord, arr);
      }
      const layerGroups: PickerGroup[] = layers
        .map((l) => ({
          label: l.name,
          ordinal: l.ordinal,
          ...split(byOrd.get(l.ordinal) ?? []),
        }))
        .filter((g) => g.recommended.length + g.variations.length > 0);
      if (unplaced.length > 0) {
        layerGroups.push({ label: "More", ...split(unplaced) });
      }
      if (layerGroups.length > 0) return layerGroups;
    }

    // Fallback — by cluster theme, else one "All" group.
    const byId = new Map(allProposals.map((p) => [p.id, p]));
    const groups: PickerGroup[] = [];
    const seen = new Set<string>();
    for (const c of clusterAnalysis?.clusters ?? []) {
      const members = (c.proposal_ids ?? [])
        .map((id) => byId.get(id))
        .filter((p): p is SubObjectiveProposal => Boolean(p));
      if (members.length === 0) continue;
      members.forEach((m) => seen.add(m.id));
      groups.push({ label: c.label, ...split(members) });
    }
    const rest = allProposals.filter((p) => !seen.has(p.id));
    if (rest.length > 0) {
      groups.push({
        label: groups.length === 0 ? "All" : "More",
        ...split(rest),
      });
    }
    return groups.length > 0
      ? groups
      : [{ label: "All", ...split(allProposals) }];
  }, [allProposals, clusterAnalysis, objectiveStack]);

  const [activeTab, setActiveTab] = useState(0);
  const [expandedLayers, setExpandedLayers] = useState<Set<number>>(new Set());
  const activeIdx = Math.min(activeTab, categories.length - 1);
  const active = categories[activeIdx];

  return (
    <div
      className="relative mx-auto w-full max-w-2xl"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      {/* Ambient depth glow behind the floating cards — the spatial cue. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-10 -z-10 mx-auto h-72 max-w-xl"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 30%, rgba(120,150,255,0.18), rgba(120,150,255,0) 70%)",
          filter: "blur(12px)",
        }}
      />

      {/* Translucent glass base hosting the category tabs + the cards. */}
      <div
        className="overflow-hidden rounded-[28px]"
        style={{
          background: "rgba(255,255,255,0.55)",
          backdropFilter: "blur(28px) saturate(170%)",
          WebkitBackdropFilter: "blur(28px) saturate(170%)",
          border: "1px solid rgba(255,255,255,0.7)",
          boxShadow:
            "0 24px 70px -28px rgba(15,23,42,0.35), inset 0 1px 0 rgba(255,255,255,0.7)",
        }}
      >
        {/* Tab section — one concise label + a tab per category. */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pb-3 pt-4"
          style={{ borderBottom: "1px solid rgba(15,23,42,0.06)" }}
        >
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Recommended features
          </span>
          {categories.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {categories.map((c, i) => {
                const isActive = i === activeIdx;
                const all = [...c.recommended, ...c.variations];
                const sel = all.filter((p) => isElected(p.id)).length;
                return (
                  <button
                    key={`${c.label}-${i}`}
                    type="button"
                    onClick={() => setActiveTab(i)}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all"
                    style={{
                      background: isActive
                        ? appleVibe.accent.primary
                        : "rgba(15,23,42,0.045)",
                      color: isActive
                        ? appleVibe.text.onAccent
                        : appleVibe.text.secondary,
                    }}
                  >
                    <span>
                      {c.ordinal != null && (
                        <span
                          className="mr-1 font-semibold"
                          style={{ opacity: 0.6 }}
                        >
                          L{c.ordinal}
                        </span>
                      )}
                      {c.label}
                    </span>
                    <span
                      className="font-mono text-[10px]"
                      style={{ opacity: 0.7 }}
                    >
                      {sel}/{all.length}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Cards for the active category — threaded by a black node line.
            Recommended = the complementary set; "See N variations" reveals
            the layer's alternatives inline (pick one). */}
        <div className="px-5 py-5">
          <div className="flex flex-col">
            {active.recommended.map((p, i) => (
              <div key={p.id}>
                {i > 0 && <CardConnector />}
                <HeroProposalCard
                  proposal={p}
                  index={i}
                  selected={isElected(p.id)}
                  onToggle={() => onToggle(p.id)}
                  disabled={busy}
                />
              </div>
            ))}
          </div>

          {active.variations.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() =>
                  setExpandedLayers((prev) => {
                    const next = new Set(prev);
                    if (next.has(activeIdx)) next.delete(activeIdx);
                    else next.add(activeIdx);
                    return next;
                  })
                }
                className="inline-flex items-center gap-1 text-[12px] font-medium underline-offset-4 hover:underline"
                style={{ color: appleVibe.text.secondary }}
              >
                {expandedLayers.has(activeIdx) ? "Hide" : "See"}{" "}
                {active.variations.length} variation
                {active.variations.length === 1 ? "" : "s"} in this layer
              </button>

              {expandedLayers.has(activeIdx) && (
                <div className="mt-3">
                  <div
                    className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Variations · alternatives (pick one)
                  </div>
                  <div className="flex flex-col" style={{ opacity: 0.94 }}>
                    {active.variations.map((p, i) => (
                      <div key={p.id}>
                        {i > 0 && <CardConnector />}
                        <HeroProposalCard
                          proposal={p}
                          index={i}
                          selected={isElected(p.id)}
                          onToggle={() => onToggle(p.id)}
                          disabled={busy}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Primary confirm — glowing, unmistakable. */}
      <div className="mt-8 flex flex-col items-center gap-3.5">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || electedCount === 0}
          className="inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-[14px] font-semibold transition-all"
          style={{
            background:
              busy || electedCount === 0
                ? appleVibe.surface.chip
                : appleVibe.accent.primary,
            color:
              busy || electedCount === 0
                ? appleVibe.text.tertiary
                : appleVibe.text.onAccent,
            boxShadow:
              busy || electedCount === 0
                ? "none"
                : "0 8px 30px -6px rgba(99,102,241,0.55), inset 0 0 0 1px rgba(255,255,255,0.12)",
            cursor: busy || electedCount === 0 ? "not-allowed" : "pointer",
          }}
        >
          <span>
            {busy
              ? "Building…"
              : electedCount === 0
                ? "Select at least one"
                : `Confirm ${electedCount} → build the canvas`}
          </span>
          {!busy && electedCount > 0 && (
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          )}
        </button>

        <div className="flex items-center gap-5">
          {moreCount > 0 && (
            <button
              type="button"
              onClick={onSeeAll}
              disabled={busy}
              className="text-[12px] font-medium underline-offset-4 hover:underline"
              style={{ color: appleVibe.text.secondary }}
            >
              See all {totalCount} options
            </button>
          )}
          <button
            type="button"
            onClick={onRegenerate}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[12px] font-medium"
            style={{ color: appleVibe.text.tertiary }}
          >
            <RefreshCw className="h-3 w-3" strokeWidth={2} />
            Regenerate
          </button>
        </div>
      </div>

      {error && <ErrorRow message={error} />}
    </div>
  );
}

// Black node-thread drawn between stacked cards — the picker's take on the
// shared connector language (curved black lines + node dots, image-ref).
// Vertical here; the same grammar applies to the canvas graphs.
function CardConnector() {
  // A real, STRAIGHT connector between two vertically-aligned cards — built
  // from DOM elements, not an SVG path: a 2px ink wire + a port socket on
  // each card edge. The cards share an x-axis, so the wire is straight;
  // curvature only belongs where endpoints are offset (e.g. the whiteboard).
  const socket = {
    position: "absolute" as const,
    left: "50%",
    transform: "translateX(-50%)",
    width: 9,
    height: 9,
    borderRadius: 999,
    background: CONNECTOR_INK,
    border: "2px solid #FFFFFF",
    boxSizing: "border-box" as const,
  };
  return (
    <div className="relative z-10" style={{ height: 32 }} aria-hidden>
      {/* the wire — a straight vertical line bridging the two card edges */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: -4,
          bottom: -4,
          width: 2,
          transform: "translateX(-50%)",
          background: CONNECTOR_INK,
        }}
      />
      {/* sockets sit ON the adjacent card edges */}
      <div style={{ ...socket, top: -6 }} />
      <div style={{ ...socket, bottom: -6 }} />
    </div>
  );
}

function HeroProposalCard({
  proposal,
  index,
  selected,
  onToggle,
  disabled,
}: {
  proposal: SubObjectiveProposal;
  index: number;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const pct = Math.round(proposal.confidence * 100);
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="group relative w-full overflow-hidden text-left transition-all"
      style={{
        background: selected
          ? "rgba(255,255,255,0.86)"
          : "rgba(255,255,255,0.62)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        border: `1px solid ${
          selected ? "rgba(99,102,241,0.45)" : "rgba(255,255,255,0.6)"
        }`,
        boxShadow: selected
          ? "0 12px 40px -10px rgba(99,102,241,0.40), 0 0 0 3px rgba(99,102,241,0.10)"
          : "0 8px 30px -12px rgba(15,23,42,0.25)",
        borderRadius: 24,
        opacity: disabled ? 0.7 : 1,
        cursor: disabled ? "wait" : "pointer",
      }}
    >
      <div className="flex items-start gap-4 p-6">
        {/* Selection medallion */}
        <div
          className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-semibold transition-all"
          style={{
            background: selected
              ? appleVibe.accent.primary
              : "rgba(15,23,42,0.05)",
            color: selected ? appleVibe.text.onAccent : appleVibe.text.tertiary,
            boxShadow: selected
              ? "0 4px 12px -2px rgba(99,102,241,0.5)"
              : "none",
          }}
        >
          {selected ? <Check className="h-4 w-4" strokeWidth={2.5} /> : index + 1}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3
              className="text-[18px] font-semibold leading-snug tracking-tight"
              style={{
                color: appleVibe.text.primary,
                letterSpacing: "-0.01em",
              }}
            >
              {proposal.title}
            </h3>
            <ConfidenceRing pct={pct} />
          </div>

          {proposal.summary && (
            <p
              className="mt-2 text-[13.5px] font-light leading-relaxed"
              style={{ color: appleVibe.text.secondary }}
            >
              {proposal.summary}
            </p>
          )}

          {proposal.rationale && (
            <p
              className="mt-3 text-[12.5px] font-light italic leading-relaxed"
              style={{ color: appleVibe.text.tertiary }}
            >
              Why this: {proposal.rationale}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function ConfidenceRing({ pct }: { pct: number }) {
  const color =
    pct >= 75 ? "#6366F1" : pct >= 50 ? "#8B5CF6" : "rgba(100,116,139,0.85)";
  return (
    <div
      className="flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1"
      style={{ background: "rgba(99,102,241,0.08)" }}
      title={`${pct}% model confidence`}
    >
      <span
        className="block h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span
        className="font-mono text-[10.5px] font-semibold"
        style={{ color: appleVibe.text.secondary }}
      >
        {pct}%
      </span>
    </div>
  );
}

// ── Batch section divider + rows ────────────────────────────────────

function BatchSection({
  batch,
  isFirst,
  electedIds,
  setDisposition,
  disabled,
  linkedConceptsForProposal,
  onConceptClick,
}: {
  batch: SubObjectiveBatch;
  isFirst: boolean;
  electedIds: Set<string>;
  setDisposition: (
    proposalId: string,
    d: SubObjectiveDisposition,
  ) => void;
  disabled: boolean;
  linkedConceptsForProposal?: (
    p: SubObjectiveProposal,
  ) => Array<{
    display_name: string;
    space_count: number;
    canonical_code: string;
  }>;
  onConceptClick?: (canonicalCode: string) => void;
}) {
  return (
    <div className={isFirst ? "" : "mt-5 border-t pt-4"} style={{
      borderColor: isFirst ? undefined : appleVibe.stroke.hairline,
    }}>
      <div className="mb-2 flex items-baseline gap-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Generation {batch.generation_number} · {INTENT_LABEL[batch.intent]}
        </span>
        <span
          className="text-[10.5px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          {INTENT_DESCRIPTION[batch.intent]}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {batch.proposals.map((p) => (
          <ProposalRow
            key={p.id}
            proposal={p}
            disposition={p.disposition ?? null}
            isElected={electedIds.has(p.id)}
            onSetDisposition={(d) => setDisposition(p.id, d)}
            disabled={disabled}
            lens={[]} /* lens chips render once at the strip, not per-row */
            linkedConcepts={
              linkedConceptsForProposal ? linkedConceptsForProposal(p) : []
            }
            onConceptClick={onConceptClick}
          />
        ))}
      </ul>
    </div>
  );
}

// ── Lens coverage strip ─────────────────────────────────────────────

function LensCoverageStrip({
  lens,
  covered,
  uncovered,
  electedCount,
}: {
  lens: ObjectiveAnnotationLite[];
  covered: Set<number>;
  uncovered: number[];
  electedCount: number;
}) {
  const pct = lens.length > 0 ? Math.round((covered.size / lens.length) * 100) : 0;
  return (
    <div
      className="mt-4 rounded-2xl border px-3 py-2.5"
      style={{
        background: "rgba(255,255,255,0.7)",
        borderColor: appleVibe.stroke.hairline,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkle
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={2}
            style={{ color: appleVibe.text.tertiary }}
          />
          <span
            className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Lens coverage
          </span>
          <span
            className="text-[11px] font-light"
            style={{ color: appleVibe.text.tertiary }}
          >
            · {covered.size}/{lens.length} readings covered by {electedCount}{" "}
            elected proposal{electedCount === 1 ? "" : "s"}
          </span>
        </div>
        <span
          className="font-mono text-[10px] font-semibold"
          style={{ color: pct >= 75 ? "rgba(22,163,74,0.85)" : pct >= 40 ? "rgba(217,119,6,0.85)" : "rgba(220,38,38,0.85)" }}
        >
          {pct}%
        </span>
      </div>
      {/* Progress bar */}
      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full"
        style={{ background: "rgba(15,23,42,0.06)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background:
              pct >= 75
                ? "rgba(22,163,74,0.7)"
                : pct >= 40
                  ? "rgba(217,119,6,0.7)"
                  : "rgba(220,38,38,0.7)",
          }}
        />
      </div>
      {uncovered.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: "rgba(146,64,14,0.95)" }}
          >
            uncovered
          </span>
          {uncovered.slice(0, 5).map((idx) => {
            const a = lens[idx - 1];
            if (!a) return null;
            return (
              <span
                key={idx}
                className="inline-flex max-w-[180px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background: "rgba(245,158,11,0.10)",
                  color: "rgba(146,64,14,0.95)",
                  border: "1px solid rgba(245,158,11,0.22)",
                }}
                title={a.reading || a.phrase}
              >
                <AlertCircle className="h-2.5 w-2.5" strokeWidth={2.5} />
                <span className="truncate">{a.phrase}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Variant Lab bar ─────────────────────────────────────────────────

const ALL_INTENTS: SubObjectiveIntent[] = [
  "creative",
  "concrete",
  "contrarian",
  "gap_fill",
  "ambitious",
  "wildcard",
];

type SuggestedIntentSource =
  | "lens_gap"
  | "user_preference"
  | "community_preference"
  | "default";

const SUGGESTED_SOURCE_LABEL: Record<SuggestedIntentSource, string> = {
  lens_gap: "fills your uncovered readings",
  user_preference: "matches your past picks",
  community_preference: "popular with similar users",
  default: "good for divergent exploration",
};

function VariantLabBar({
  intentInFlight,
  suggestedIntent,
  suggestedIntentSource,
  onGenerate,
  disabled,
}: {
  intentInFlight: SubObjectiveIntent | null;
  suggestedIntent: SubObjectiveIntent;
  suggestedIntentSource: SuggestedIntentSource;
  onGenerate: (intent: SubObjectiveIntent) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const busy = intentInFlight !== null;

  return (
    <div
      className="mt-5 rounded-2xl border p-3"
      style={{
        background: "rgba(15,23,42,0.02)",
        borderColor: appleVibe.stroke.hairline,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkle className="h-3 w-3" />
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.secondary }}
          >
            Generate better
          </span>
          <span
            className="text-[11px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            · keep existing, layer on more
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-[10.5px] font-medium"
          style={{ color: appleVibe.text.tertiary }}
        >
          {expanded ? (
            <>
              hide intents <ChevronUp className="h-3 w-3" strokeWidth={2} />
            </>
          ) : (
            <>
              pick intent <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </>
          )}
        </button>
      </div>

      {/* Default action — single click, uses the suggested intent.
          Source label explains WHY this intent: lens gap, user pref,
          or generic default. Builds trust in the suggestion. */}
      {!expanded && (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span
            className="text-[11.5px] font-light"
            style={{ color: appleVibe.text.tertiary }}
          >
            Suggested: <span className="font-semibold" style={{ color: appleVibe.text.secondary }}>
              {INTENT_LABEL[suggestedIntent]}
            </span>{" "}
            <span className="italic">
              ({SUGGESTED_SOURCE_LABEL[suggestedIntentSource]})
            </span>{" "}
            — {INTENT_DESCRIPTION[suggestedIntent]}
          </span>
          <button
            type="button"
            onClick={() => onGenerate(suggestedIntent)}
            disabled={disabled || busy}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
            style={{
              background:
                disabled || busy
                  ? appleVibe.surface.chip
                  : appleVibe.accent.primary,
              color:
                disabled || busy
                  ? appleVibe.text.tertiary
                  : appleVibe.text.onAccent,
              cursor: disabled || busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Generating…" : `Generate ${INTENT_LABEL[suggestedIntent]}`}
          </button>
        </div>
      )}

      {/* Advanced — pick a specific intent */}
      {expanded && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ALL_INTENTS.map((intent) => {
            const inFlight = intentInFlight === intent;
            return (
              <button
                key={intent}
                type="button"
                onClick={() => onGenerate(intent)}
                disabled={disabled || busy}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all"
                style={{
                  background: inFlight
                    ? "rgba(15,23,42,0.10)"
                    : "rgba(255,255,255,0.85)",
                  color: appleVibe.text.secondary,
                  border: `1px solid ${
                    intent === suggestedIntent
                      ? "rgba(71,85,105,0.35)"
                      : appleVibe.stroke.hairline
                  }`,
                  cursor: disabled || busy ? "wait" : "pointer",
                  opacity: disabled || busy ? 0.6 : 1,
                }}
                title={INTENT_DESCRIPTION[intent]}
              >
                {INTENT_LABEL[intent]}
                {intent === suggestedIntent && (
                  <span
                    className="ml-0.5 text-[9px] font-semibold"
                    style={{ color: "rgba(71,85,105,0.95)" }}
                  >
                    ★
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Row with disposition controls ───────────────────────────────────

export function ProposalRow({
  proposal,
  disposition,
  isElected,
  onSetDisposition,
  disabled,
  representativeBadge = false,
  linkedConcepts = [],
  onConceptClick,
}: {
  proposal: SubObjectiveProposal;
  disposition: SubObjectiveDisposition;
  isElected: boolean;
  onSetDisposition: (d: SubObjectiveDisposition) => void;
  disabled: boolean;
  lens: ObjectiveAnnotationLite[];
  /** Cluster view — true when this proposal is its cluster's
   *  representative. Renders a small "Representative" badge so the
   *  user sees the LLM-nominated strongest member at a glance. */
  representativeBadge?: boolean;
  /** Cross-space KG — canonical concepts this proposal's text
   *  verbatim references (computed by the parent picker). Each
   *  renders as a small "↻ Concept (N spaces)" badge so the user
   *  sees their KG accumulating. Empty array → no chips. */
  linkedConcepts?: Array<{
    display_name: string;
    space_count: number;
    canonical_code: string;
  }>;
  /** Click handler for the KG badges — opens CanonicalConceptDrawer
   *  with the chip's canonical_code. */
  onConceptClick?: (canonicalCode: string) => void;
}) {
  const confidencePct = Math.round(proposal.confidence * 100);
  const confidenceDot =
    confidencePct >= 75 ? "#16A34A" : confidencePct >= 50 ? "#D97706" : "#DC2626";
  const rejected = disposition === "rejected";
  const deferred = disposition === "deferred";
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hasMore =
    Boolean(proposal.rationale) || (proposal.summary?.length ?? 0) > 100;

  // Surface treatment — all states sit on solid white; emphasis comes
  // from a soft accent glow + ring, never a flat tint or hard border.
  // Elected = emerald glow, deferred = amber glow, otherwise the neutral
  // card shadow (lifting slightly on hover).
  const boxShadow = isElected
    ? "0 1px 0 rgba(255,255,255,0.9) inset, 0 0 0 1px rgba(22,163,74,0.22), 0 12px 30px -12px rgba(22,163,74,0.30)"
    : deferred
      ? "0 1px 0 rgba(255,255,255,0.9) inset, 0 0 0 1px rgba(217,119,6,0.20), 0 12px 30px -12px rgba(217,119,6,0.24)"
      : hovered
        ? appleVibe.shadow.cardHover
        : appleVibe.shadow.card;

  return (
    <li>
      <div
        className="flex w-full items-start gap-3 rounded-2xl p-3.5 text-left transition-all duration-200"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(15,23,42,0.05)",
          borderRadius: appleVibe.radius.md,
          opacity: rejected ? 0.55 : 1,
          boxShadow,
        }}
      >
        <DispositionControls
          disposition={disposition}
          disabled={disabled}
          onElect={() => onSetDisposition("elected")}
          onDefer={() => onSetDisposition("deferred")}
          onReject={() => onSetDisposition("rejected")}
          onClear={() => onSetDisposition(null)}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <h3
              className="text-[14px] font-semibold leading-snug tracking-tight"
              style={{ color: appleVibe.text.primary, letterSpacing: "-0.005em" }}
            >
              {proposal.title}
            </h3>
            {proposal.recommended && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  background: "rgba(71,85,105,0.08)",
                  color: "rgba(71,85,105,0.95)",
                }}
                title="LLM-picked as load-bearing in its batch"
              >
                <Sparkle className="h-2 w-2" />
                Top
              </span>
            )}
            {representativeBadge && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  background: "rgba(22,163,74,0.10)",
                  color: "rgba(20,83,45,0.95)",
                  border: "1px solid rgba(22,163,74,0.22)",
                }}
                title="LLM-nominated strongest member of this cluster"
              >
                Rep
              </span>
            )}
            {/* Phase 11.A.6 — layer position chip. Renders only when
                the proposer tagged this proposal with layer_ordinals
                (requires the space's ObjectiveStack to exist at gen
                time). Compact mode so the title doesn't get crowded
                — full label still readable on hover via title attr. */}
            {proposal.layer_ordinals && proposal.layer_ordinals.length > 0 && (
              <LayerPositionChip
                ordinals={proposal.layer_ordinals}
                positionLabel={proposal.layer_position_label}
                compact
              />
            )}
          </div>

          {proposal.summary && (
            <p
              className={`mt-1 text-[12px] font-light leading-snug${
                expanded ? "" : " line-clamp-2"
              }`}
              style={{ color: appleVibe.text.secondary }}
            >
              {proposal.summary}
            </p>
          )}

          {/* Cross-space KG badges — canonical concepts this proposal
              verbatim references. Each chip = "↻ Concept (N spaces)"
              so the user sees their KG accumulating, not fragmenting. */}
          {linkedConcepts.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span
                className="text-[9px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: "rgba(71,85,105,0.95)" }}
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
                    className="inline-flex max-w-[200px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-[rgba(71,85,105,0.16)]"
                    style={{
                      background: "rgba(71,85,105,0.08)",
                      color: "rgba(71,85,105,0.95)",
                      border: "1px solid rgba(71,85,105,0.18)",
                      cursor: "pointer",
                    }}
                    title={`Used in ${c.space_count} of your space${c.space_count === 1 ? "" : "s"} · click to open cross-space view`}
                  >
                    <span className="truncate">{c.display_name}</span>
                    {c.space_count > 1 && (
                      <span
                        className="font-mono text-[8.5px]"
                        style={{ color: "rgba(71,85,105,0.75)" }}
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
                      background: "rgba(71,85,105,0.08)",
                      color: "rgba(71,85,105,0.95)",
                      border: "1px solid rgba(71,85,105,0.18)",
                    }}
                    title={`Used in ${c.space_count} of your space${c.space_count === 1 ? "" : "s"}`}
                  >
                    <span className="truncate">{c.display_name}</span>
                    {c.space_count > 1 && (
                      <span
                        className="font-mono text-[8.5px]"
                        style={{ color: "rgba(71,85,105,0.75)" }}
                      >
                        {c.space_count}×
                      </span>
                    )}
                  </span>
                ),
              )}
            </div>
          )}

          {/* Meta row: confidence + lens coverage chips */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className="block h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ background: confidenceDot }}
              aria-hidden
            />
            <span
              className="font-mono text-[10px] font-medium"
              style={{ color: appleVibe.text.tertiary }}
            >
              {confidencePct}%
            </span>
            {proposal.lens_coverage && proposal.lens_coverage.length > 0 && (
              <>
                <span
                  className="text-[10px]"
                  style={{ color: appleVibe.text.faint }}
                >
                  ·
                </span>
                <span
                  className="text-[10px] font-medium"
                  style={{ color: appleVibe.text.tertiary }}
                  title={`Covers lens entries: ${proposal.lens_coverage.join(", ")}`}
                >
                  covers {proposal.lens_coverage.length} lens
                </span>
              </>
            )}
          </div>

          {/* Expand affordance — reveals the full summary + the
              rationale ("why this fits"). Collapsed by default so the
              row stays concise; the rationale no longer double-renders
              in the meta strip. */}
          {hasMore && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="mt-2 inline-flex items-center gap-0.5 text-[10.5px] font-medium transition-colors hover:opacity-70"
              style={{ color: appleVibe.text.tertiary }}
            >
              {expanded ? (
                <>
                  Less
                  <ChevronUp className="h-3 w-3" strokeWidth={2} />
                </>
              ) : (
                <>
                  More
                  <ChevronDown className="h-3 w-3" strokeWidth={2} />
                </>
              )}
            </button>
          )}

          {expanded && proposal.rationale && (
            <div className="mt-2">
              <div
                className="text-[9px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: appleVibe.text.faint }}
              >
                Why this fits
              </div>
              <p
                className="mt-0.5 text-[11.5px] font-light italic leading-snug"
                style={{ color: appleVibe.text.tertiary }}
              >
                {proposal.rationale}
              </p>
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
        </div>
      </div>
    </li>
  );
}

function DispositionControls({
  disposition,
  disabled,
  onElect,
  onDefer,
  onReject,
  onClear,
}: {
  disposition: SubObjectiveDisposition;
  disabled: boolean;
  onElect: () => void;
  onDefer: () => void;
  onReject: () => void;
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
          if (active) onClear();
          else onClick();
        }}
        disabled={disabled}
        title={title}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full transition-all"
        style={{
          background: active ? activeBg : "rgba(15,23,42,0.04)",
          color: active ? activeColor : appleVibe.text.tertiary,
          border: `1px solid ${active ? activeColor : appleVibe.stroke.hairline}`,
          cursor: disabled ? "wait" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
      </button>
    );
  }

  return (
    <div className="mt-0.5 flex flex-shrink-0 flex-col gap-1">
      {btn(
        onElect,
        elected,
        "rgba(22,163,74,0.18)",
        "rgba(20,83,45,0.95)",
        Check,
        elected ? "Elected — click to clear" : "Elect (include in fork)",
      )}
      {btn(
        onDefer,
        deferred,
        "rgba(217,119,6,0.18)",
        "rgba(146,64,14,0.95)",
        Pause,
        deferred ? "Deferred — click to clear" : "Defer for later",
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

// ── Shared primitives (lighter-weight than clarifying-questions
//     card; intentional to keep file independent). ──

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto w-full max-w-2xl rounded-3xl p-7"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: appleVibe.shadow.card,
        borderRadius: appleVibe.radius.xl,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: appleVibe.text.tertiary }}
    >
      {children}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mt-1.5 text-[22px] font-semibold leading-tight tracking-tight"
      style={{
        color: appleVibe.text.primary,
        fontFamily: appleVibe.font.display,
        letterSpacing: "-0.015em",
      }}
    >
      {children}
    </h2>
  );
}

function Primary({
  label,
  onClick,
  busy,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-[13.5px] font-semibold"
      style={{
        background: appleVibe.accent.primary,
        color: appleVibe.text.onAccent,
        borderRadius: appleVibe.radius.md,
        cursor: busy ? "wait" : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
    >
      <span>{busy ? "Working…" : label}</span>
      {!busy && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.25} />}
    </button>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3">
      <div
        className="h-3 w-32 rounded-full"
        style={{ background: appleVibe.stroke.hairline }}
      />
      <div
        className="h-7 w-3/4 rounded-lg"
        style={{ background: appleVibe.stroke.hairline }}
      />
      <div className="mt-4 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 w-full rounded-2xl"
            style={{ background: appleVibe.surface.chip }}
          />
        ))}
      </div>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-4 rounded-xl px-3.5 py-2.5 text-[12.5px]"
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

// ── Retrospective mini-panel ────────────────────────────────────────
//
// Shows the user the per-intent pattern the system has learned from
// their decisions. Collapsed by default — the user can click to see
// "I've elected Concrete 4×, rejected Wildcard 3×". Transparency for
// the personalization that drives the suggested-intent affordance.
//
// Hidden entirely when there's no signal at all (new user / no
// variant lab use yet). Hides "initial" since it's the baseline
// generation, not a user-chosen intent.

function RetrospectivePanel({
  userPrefs,
}: {
  userPrefs: IntentPreference[];
}) {
  const [expanded, setExpanded] = useState(false);
  // Filter to intents the user has touched (rate !== null) AND
  // exclude "initial" (baseline, not a user choice). Sort by total
  // touches desc.
  const touched = userPrefs
    .filter((p) => p.intent !== "initial" && p.rate !== null)
    .sort((a, b) => (b.elects + b.rejects) - (a.elects + a.rejects));
  if (touched.length === 0) return null;

  const totalElects = touched.reduce((sum, p) => sum + p.elects, 0);
  const totalRejects = touched.reduce((sum, p) => sum + p.rejects, 0);

  return (
    <div
      className="mt-3 rounded-2xl border px-3 py-2"
      style={{
        background: "rgba(255,255,255,0.5)",
        borderColor: appleVibe.stroke.hairline,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Your variant lab pattern
        </span>
        <span
          className="text-[10.5px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          {totalElects} elected · {totalRejects} rejected{" "}
          {expanded ? "▴" : "▾"}
        </span>
      </button>
      {expanded && (
        <ul className="mt-2 flex flex-col gap-1">
          {touched.map((p) => {
            const ratePct = p.rate !== null ? Math.round(p.rate * 100) : 0;
            return (
              <li
                key={p.intent}
                className="flex items-center justify-between gap-2"
              >
                <span
                  className="text-[11px] font-medium"
                  style={{ color: appleVibe.text.secondary }}
                >
                  {INTENT_LABEL[p.intent]}
                </span>
                <div
                  className="flex items-center gap-2 font-mono text-[10px]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  <span>
                    {p.elects}✓ {p.rejects}✕
                  </span>
                  <span
                    className="inline-flex h-1 w-12 overflow-hidden rounded-full"
                    style={{ background: "rgba(15,23,42,0.08)" }}
                  >
                    <span
                      className="h-full"
                      style={{
                        width: `${ratePct}%`,
                        background:
                          ratePct >= 60
                            ? "rgba(22,163,74,0.7)"
                            : ratePct >= 30
                              ? "rgba(217,119,6,0.7)"
                              : "rgba(220,38,38,0.7)",
                      }}
                    />
                  </span>
                  <span className="w-8 text-right">
                    {ratePct}%
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Cluster control bar ────────────────────────────────────────────
//
// Sits above the proposal list. Two phases:
//   • Pre-cluster: a single "Detect clusters" CTA explains why
//   • Post-cluster: a view toggle (by generation / by theme) +
//     refresh button when clustering is stale

// Cluster bar — auto-fires now, so the bar is silent until either
// (a) clustering is in flight (subtle status), or (b) clusters are
// ready (view toggle). The manual CTA branch has been removed.
function ClusterControlBar({
  hasClusters,
  clusterCount,
  stale,
  viewMode,
  onViewMode,
  onRerun,
  busy,
  error,
}: {
  hasClusters: boolean;
  clusterCount: number;
  stale: boolean;
  viewMode: "batches" | "clusters";
  onViewMode: (m: "batches" | "clusters") => void;
  onRerun: () => void;
  busy: boolean;
  error: string | null;
}) {
  // Suppress the bar entirely while clustering is silently running
  // for the first time — no clusters to toggle against yet, and the
  // status is non-blocking. Only render when there's something to
  // surface: clusters ready, busy + stale (re-cluster in flight), or
  // an error.
  if (!hasClusters && !error && !busy) return null;

  return (
    <div
      className="mt-4 flex items-center justify-between gap-3 rounded-2xl px-3 py-2"
      style={{
        background: "rgba(15,23,42,0.025)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
      }}
    >
      {/* Left: status / count */}
      <div className="flex min-w-0 items-center gap-2">
        {busy && !hasClusters ? (
          <>
            <RefreshCw
              className="h-3 w-3 animate-spin flex-shrink-0"
              strokeWidth={2}
              style={{ color: appleVibe.text.tertiary }}
            />
            <span
              className="text-[11.5px] font-medium"
              style={{ color: appleVibe.text.secondary }}
            >
              Grouping by theme…
            </span>
          </>
        ) : hasClusters ? (
          <>
            <span
              className="text-[11.5px] font-semibold"
              style={{ color: appleVibe.text.primary }}
            >
              {clusterCount} themes
            </span>
            <span
              className="text-[11.5px] font-light"
              style={{ color: appleVibe.text.tertiary }}
            >
              · auto-grouped
            </span>
            {stale && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9.5px] font-medium"
                style={{
                  background: "rgba(217,119,6,0.10)",
                  color: "rgba(146,64,14,0.95)",
                }}
              >
                refreshing
              </span>
            )}
          </>
        ) : null}
      </div>

      {/* Right: view toggle + re-cluster (only when clusters exist) */}
      {hasClusters && (
        <div className="flex items-center gap-2">
          <div
            className="inline-flex rounded-full p-0.5"
            style={{ background: "rgba(15,23,42,0.05)" }}
          >
            <button
              type="button"
              onClick={() => onViewMode("batches")}
              className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
              style={{
                background:
                  viewMode === "batches" ? "#fff" : "transparent",
                color:
                  viewMode === "batches"
                    ? appleVibe.text.primary
                    : appleVibe.text.tertiary,
                boxShadow:
                  viewMode === "batches"
                    ? "0 1px 2px rgba(15,23,42,0.08)"
                    : undefined,
              }}
            >
              by generation
            </button>
            <button
              type="button"
              onClick={() => onViewMode("clusters")}
              className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
              style={{
                background:
                  viewMode === "clusters" ? "#fff" : "transparent",
                color:
                  viewMode === "clusters"
                    ? appleVibe.text.primary
                    : appleVibe.text.tertiary,
                boxShadow:
                  viewMode === "clusters"
                    ? "0 1px 2px rgba(15,23,42,0.08)"
                    : undefined,
              }}
            >
              by theme
            </button>
          </div>
          <button
            type="button"
            onClick={onRerun}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.tertiary,
              cursor: busy ? "wait" : "pointer",
            }}
            title="Re-group by theme"
          >
            <RefreshCw
              className={busy ? "h-2.5 w-2.5 animate-spin" : "h-2.5 w-2.5"}
              strokeWidth={2}
            />
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="ml-2 rounded-xl px-2.5 py-1 text-[11px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "rgba(127,29,29,0.95)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

// ── Cluster view ───────────────────────────────────────────────────
//
// Renders proposals grouped by theme. Each cluster header carries
// its label + description + member count. The cluster's
// representative proposal renders first with a small badge. All
// other members render below, slightly indented.

function ClusterView({
  clusters,
  proposalsById,
  electedIds,
  setDisposition,
  disabled,
  linkedConceptsForProposal,
  onConceptClick,
}: {
  clusters: ProposalCluster[];
  proposalsById: Map<string, SubObjectiveProposal>;
  electedIds: Set<string>;
  setDisposition: (
    proposalId: string,
    d: SubObjectiveDisposition,
  ) => void;
  disabled: boolean;
  linkedConceptsForProposal?: (
    p: SubObjectiveProposal,
  ) => Array<{
    display_name: string;
    space_count: number;
    canonical_code: string;
  }>;
  onConceptClick?: (canonicalCode: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {clusters.map((c) => {
        const members = c.proposal_ids
          .map((id) => proposalsById.get(id))
          .filter((p): p is SubObjectiveProposal => !!p);
        if (members.length === 0) return null;
        // Render representative first; others after.
        const representative = members.find(
          (p) => p.id === c.representative_id,
        );
        const others = members.filter((p) => p.id !== c.representative_id);
        const ordered = representative ? [representative, ...others] : members;
        const electedInCluster = members.filter((p) =>
          electedIds.has(p.id),
        ).length;
        return (
          <div key={c.id}>
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2 min-w-0">
                <span
                  className="text-[11px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "rgba(71,85,105,0.95)" }}
                >
                  {c.label}
                </span>
                <span
                  className="text-[10.5px] font-light"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  · {members.length} proposal{members.length === 1 ? "" : "s"}
                  {electedInCluster > 0 && ` · ${electedInCluster} elected`}
                </span>
              </div>
            </div>
            {c.description && (
              <p
                className="mt-0.5 text-[11.5px] font-light italic leading-snug"
                style={{ color: appleVibe.text.tertiary }}
              >
                {c.description}
              </p>
            )}
            <ul className="mt-2 flex flex-col gap-2">
              {ordered.map((p, idx) => (
                <div
                  key={p.id}
                  style={
                    p.id !== c.representative_id && idx > 0
                      ? { marginLeft: 12 }
                      : undefined
                  }
                >
                  <ProposalRow
                    proposal={p}
                    disposition={p.disposition ?? null}
                    isElected={electedIds.has(p.id)}
                    onSetDisposition={(d) => setDisposition(p.id, d)}
                    disabled={disabled}
                    lens={[]}
                    representativeBadge={p.id === c.representative_id}
                    linkedConcepts={
                      linkedConceptsForProposal
                        ? linkedConceptsForProposal(p)
                        : []
                    }
                    onConceptClick={onConceptClick}
                  />
                </div>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ── Cross-space KG strip ────────────────────────────────────────────
//
// Shows the canonical concepts from the user's PRIOR spaces that the
// system surfaced as semantically related to the current objective.
// Two purposes:
//   1. Transparency — the user sees the KG read is happening, even
//      when no proposal verbatim-references a concept yet.
//   2. Affordance — chips serve as a reference list for the user to
//      look at while picking. Future: clicking opens the
//      CanonicalConceptDrawer for deeper inspection.
//
// Collapsed by default. Each chip = display_name + space_count badge.

// Auto-detected concepts strip — frosted, sparkle-free. Leads with
// a numeric badge + concise label; chips expand inline. Tinted
// purple surfaces removed in favor of a neutral Apple-vibe band so
// the strip reads as informational ambient memory, not as a CTA.
function PriorConceptsStrip({
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
  /** Click handler — fires with the chip's canonical_code so the
   *  parent picker can open CanonicalConceptDrawer. */
  onConceptClick: (canonicalCode: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (concepts.length === 0) return null;

  return (
    <div
      className="mt-4 rounded-2xl px-3 py-2.5"
      style={{
        background: "rgba(255,255,255,0.6)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
        borderRadius: appleVibe.radius.md,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums"
            style={{
              background: "rgba(15,23,42,0.06)",
              color: appleVibe.text.secondary,
            }}
          >
            {concepts.length}
          </span>
          <span
            className="text-[12px] font-medium"
            style={{ color: appleVibe.text.primary }}
          >
            Concepts from your prior spaces
          </span>
          <span
            className="hidden text-[11.5px] font-light sm:inline"
            style={{ color: appleVibe.text.tertiary }}
          >
            proposals can link or diverge
          </span>
        </div>
        <span
          className="inline-flex items-center gap-0.5 text-[10.5px] font-medium"
          style={{ color: appleVibe.text.tertiary }}
        >
          {expanded ? "hide" : "show"}
          {expanded ? (
            <ChevronUp className="h-3 w-3" strokeWidth={2} />
          ) : (
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          )}
        </span>
      </button>

      {expanded && (
        <div
          className="mt-3 flex flex-wrap gap-1.5 border-t pt-3"
          style={{ borderColor: appleVibe.stroke.hairline }}
        >
          {concepts.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => onConceptClick(c.canonical_code)}
              className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[rgba(15,23,42,0.04)]"
              style={{
                background: "#fff",
                color: appleVibe.text.primary,
                border: `1px solid ${appleVibe.stroke.hairline}`,
                cursor: "pointer",
              }}
              title={
                c.description
                  ? `${c.description}${c.domain_tags.length > 0 ? `\n\nTags: ${c.domain_tags.join(", ")}` : ""}\n\nClick to open across-spaces view.`
                  : `Click to open across-spaces view${c.domain_tags.length > 0 ? `\nTags: ${c.domain_tags.join(", ")}` : ""}`
              }
            >
              <span className="truncate">{c.display_name}</span>
              <span
                className="font-mono text-[9.5px] tabular-nums"
                style={{ color: appleVibe.text.tertiary }}
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
