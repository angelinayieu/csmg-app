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

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Pause,
  RefreshCw,
  Sparkles,
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
import { CanonicalConceptDrawer } from "@/components/canonical/canonical-concept-drawer";

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

  // ── Auto-propose on mount if nothing is cached ──
  useEffect(() => {
    if (block !== null) return;
    void runAction("propose", { mode: "initial" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          if (!block || electedIds.size === 0) return;
          const res = await fetch("/api/brainstorm/sub-objectives/confirm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              spaceId,
              pickedProposalIds: Array.from(electedIds),
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

  const recommendedCount = allProposals.filter((p) => p.recommended).length;
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

      {/* Cluster CTA / view toggle ──────────────────────────────────
          - When no clustering has been run yet AND there are ≥5
            proposals, show a "Detect clusters" CTA so the user can
            collapse redundancy before forking.
          - When clustering exists, show a small view toggle between
            "by generation" (default batch view) and "by theme"
            (cluster view).
          - When clustering is stale (new batch since last run),
            offer a refresh inside the toggle. */}
      {canCluster && (
        <ClusterControlBar
          hasClusters={hasClusters}
          clusterCount={clusterAnalysis?.clusters?.length ?? 0}
          stale={!!clusterIsStale}
          viewMode={viewMode}
          onViewMode={setViewMode}
          onRun={() => runCluster(false)}
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
        />
      )}
    </Shell>
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
          <Sparkles
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
                      ? "rgba(124,58,237,0.35)"
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
                    style={{ color: "rgba(91,33,182,0.95)" }}
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

function ProposalRow({
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

  return (
    <li>
      <div
        className="flex w-full items-start gap-3 rounded-2xl p-3.5 text-left transition-all"
        style={{
          background: isElected
            ? "rgba(240,253,244,0.7)"
            : rejected
              ? "rgba(255,255,255,0.45)"
              : "rgba(255,255,255,0.7)",
          border: `1px solid ${
            isElected
              ? "rgba(22,163,74,0.35)"
              : rejected
                ? appleVibe.stroke.hairline
                : appleVibe.stroke.hairline
          }`,
          borderRadius: appleVibe.radius.md,
          opacity: rejected ? 0.55 : 1,
          boxShadow: isElected
            ? "0 0 0 3px rgba(22,163,74,0.10)"
            : undefined,
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
                  background: "rgba(124,58,237,0.08)",
                  color: "rgba(91,33,182,0.95)",
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
          </div>

          {proposal.summary && (
            <p
              className="mt-1 line-clamp-2 text-[12px] font-light leading-snug"
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
            {proposal.rationale && (
              <>
                <span
                  className="text-[10px]"
                  style={{ color: appleVibe.text.faint }}
                >
                  ·
                </span>
                <span
                  className="line-clamp-1 text-[11px] font-light italic"
                  style={{ color: appleVibe.text.tertiary }}
                  title={proposal.rationale}
                >
                  {proposal.rationale}
                </span>
              </>
            )}
          </div>

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

function ClusterControlBar({
  hasClusters,
  clusterCount,
  stale,
  viewMode,
  onViewMode,
  onRun,
  onRerun,
  busy,
  error,
}: {
  hasClusters: boolean;
  clusterCount: number;
  stale: boolean;
  viewMode: "batches" | "clusters";
  onViewMode: (m: "batches" | "clusters") => void;
  onRun: () => void;
  onRerun: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div
      className="mt-4 rounded-2xl border p-3"
      style={{
        background: "rgba(124,58,237,0.025)",
        borderColor: hasClusters
          ? "rgba(124,58,237,0.18)"
          : appleVibe.stroke.hairline,
        borderRadius: appleVibe.radius.md,
      }}
    >
      {!hasClusters && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles
              className="h-3 w-3 flex-shrink-0"
              strokeWidth={2}
              style={{ color: "rgba(91,33,182,0.9)" }}
            />
            <span
              className="text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "rgba(91,33,182,0.95)" }}
            >
              Detect clusters
            </span>
            <span
              className="text-[11.5px] font-light"
              style={{ color: appleVibe.text.tertiary }}
            >
              · groups proposals by theme so you can spot redundancy
              before forking
            </span>
          </div>
          <button
            type="button"
            onClick={onRun}
            disabled={busy}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
            style={{
              background: busy
                ? appleVibe.surface.chip
                : "rgba(124,58,237,0.92)",
              color: busy ? appleVibe.text.tertiary : "#fff",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2} />
                Clustering…
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" strokeWidth={2} />
                Detect clusters
              </>
            )}
          </button>
        </div>
      )}

      {hasClusters && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles
              className="h-3 w-3 flex-shrink-0"
              strokeWidth={2}
              style={{ color: "rgba(91,33,182,0.9)" }}
            />
            <span
              className="text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "rgba(91,33,182,0.95)" }}
            >
              {clusterCount} clusters
            </span>
            {stale && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  background: "rgba(217,119,6,0.12)",
                  color: "rgba(146,64,14,0.95)",
                }}
              >
                stale
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle — "by generation" / "by theme" */}
            <div
              className="inline-flex rounded-full p-0.5"
              style={{
                background: "rgba(15,23,42,0.05)",
              }}
            >
              <button
                type="button"
                onClick={() => onViewMode("batches")}
                className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                style={{
                  background:
                    viewMode === "batches"
                      ? "#fff"
                      : "transparent",
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
                    viewMode === "clusters"
                      ? "#fff"
                      : "transparent",
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
            {/* Refresh — visible always, prominent when stale */}
            <button
              type="button"
              onClick={onRerun}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold"
              style={{
                background: stale
                  ? "rgba(217,119,6,0.15)"
                  : appleVibe.surface.chip,
                color: stale
                  ? "rgba(146,64,14,0.95)"
                  : appleVibe.text.tertiary,
                cursor: busy ? "wait" : "pointer",
              }}
              title={stale ? "Re-cluster — proposals changed" : "Re-cluster"}
            >
              <RefreshCw
                className={
                  busy ? "h-2.5 w-2.5 animate-spin" : "h-2.5 w-2.5"
                }
                strokeWidth={2}
              />
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-2 rounded-xl px-2.5 py-1.5 text-[11.5px]"
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
                  style={{ color: "rgba(91,33,182,0.95)" }}
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
      className="mt-4 rounded-2xl border p-3"
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
          <Sparkles
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={2}
            style={{ color: "rgba(91,33,182,0.9)" }}
          />
          <span
            className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "rgba(91,33,182,0.95)" }}
          >
            {concepts.length} concept{concepts.length === 1 ? "" : "s"} from
            your prior spaces
          </span>
          <span
            className="text-[11.5px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            · proposals can link or diverge from these
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1 text-[10.5px] font-medium"
          style={{ color: appleVibe.text.tertiary }}
        >
          {expanded ? (
            <>
              hide <ChevronUp className="h-3 w-3" strokeWidth={2} />
            </>
          ) : (
            <>
              show <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </>
          )}
        </span>
      </button>

      {expanded && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {concepts.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => onConceptClick(c.canonical_code)}
              className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[rgba(124,58,237,0.10)]"
              style={{
                background: "rgba(255,255,255,0.92)",
                color: "rgba(91,33,182,0.95)",
                border: "1px solid rgba(124,58,237,0.20)",
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
                className="font-mono text-[9.5px]"
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
