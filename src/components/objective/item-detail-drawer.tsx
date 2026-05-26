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
  Check,
  ChevronRight,
  Compass,
  ExternalLink,
  Highlighter,
  Layers,
  Link2,
  Pause,
  RefreshCw,
  Shield,
  Sparkles as SparklesLucide,
  X,
} from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface DefinitionHighlight {
  phrase: string;
  start_offset: number;
  end_offset: number;
  why: string;
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

interface ExpandedItemDetail {
  definition?: string;
  variations?: ItemVariation[];
  planning?: ItemPlanning;
  composed_design?: ComposedDesign | null;
  generated_at?: string;
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
  onClose,
}: Props) {
  const reduce = useReducedMotion();
  const open = !!entityId;

  // ── Detail state ──
  const [expanded, setExpanded] = useState<ExpandedItemDetail | null>(
    initialExpandedDetail && hasDefinition(initialExpandedDetail)
      ? initialExpandedDetail
      : null,
  );
  const [expandLoading, setExpandLoading] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);

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

  // ── ESC to close ──
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ── Lazy-fetch detail on first open ──
  useEffect(() => {
    if (!entityId) return;

    // Always rehydrate from props on entity change so switching
    // between items works.
    setExpanded(
      initialExpandedDetail && hasDefinition(initialExpandedDetail)
        ? initialExpandedDetail
        : null,
    );
    setResearch(initialDetailResearch ?? null);
    setExpandError(null);

    const needsExpansion =
      !initialExpandedDetail || !hasDefinition(initialExpandedDetail);
    const needsResearch =
      !initialDetailResearch ||
      !(
        Array.isArray(initialDetailResearch.sources) &&
        (initialDetailResearch.sources.length > 0 ||
          initialDetailResearch.failed === true)
      );

    if (needsExpansion) {
      setExpandLoading(true);
      void fetch("/api/brainstorm/item/expand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId }),
      })
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) {
            setExpandError(json?.error ?? "Could not expand item.");
            return;
          }
          setExpanded(json.expanded_detail ?? null);
        })
        .catch((err) => {
          setExpandError(
            err instanceof Error ? err.message : "Network error.",
          );
        })
        .finally(() => setExpandLoading(false));
    }

    if (needsResearch) {
      setResearchLoading(true);
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          {/* Backdrop */}
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

          {/* Drawer */}
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
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden md:w-[480px]"
            style={{
              background: appleVibe.surface.card,
              borderLeft: `1px solid ${appleVibe.stroke.hairline}`,
              fontFamily: appleVibe.font.stack,
              boxShadow: "0 0 40px -8px rgba(11,18,40,0.28)",
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
              {/* ── 1. DEFINITION ── */}
              <Section
                icon={<Sparkle className="h-3 w-3" />}
                title="Definition"
                action={
                  expanded ? (
                    <div className="flex items-center gap-1">
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

              {/* ── 3. VARIATIONS (P1+P2+P3) ──
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
                  <SparklesLucide
                    className="h-3 w-3"
                    strokeWidth={1.75}
                  />
                }
                title="Variations"
                subtitle={
                  expanded?.variations && expanded.variations.length > 0
                    ? variationsSubtitle(expanded.variations)
                    : undefined
                }
              >
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
                  />
                )}
              </Section>

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
    </AnimatePresence>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function hasDefinition(d: ExpandedItemDetail | null | undefined): boolean {
  return !!d?.definition && d.definition.length > 0;
}

function Section({
  icon,
  title,
  subtitle,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
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

// ── Variations group ──────────────────────────────────────────────────
//
// Renders variations grouped by kind (alternative → additive →
// principle), each group sorted by composite rank desc. Handles all
// disposition mutations + composition fire-on-elect.

function VariationsGroup({
  variations,
  entityId,
  onLocalUpdate,
  onComposedDesignUpdate,
  composedDesign,
}: {
  variations: ItemVariation[];
  entityId: string;
  onLocalUpdate: (next: ItemVariation[]) => void;
  onComposedDesignUpdate: (cd: ComposedDesign | null) => void;
  composedDesign: ComposedDesign | null;
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

      // Optimistic local mutation so the UI is instant.
      const next = variations.map((v) =>
        v.id === variationId ? { ...v, disposition } : v,
      );
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
      } catch (err) {
        setComposeError(
          err instanceof Error ? err.message : "Network error.",
        );
      } finally {
        setComposing(false);
      }
    },
    [entityId, electedCount, onComposedDesignUpdate],
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
                {items.map((v, idx) => (
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
                  />
                ))}
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
}: {
  variation: ItemVariation;
  rank: number;
  total: number;
  busy: boolean;
  onElect: () => void;
  onReject: () => void;
  onDefer: () => void;
  onClear: () => void;
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
    : rejected
      ? appleVibe.stroke.hairline
      : appleVibe.stroke.hairline;
  const opacity = rejected ? 0.55 : 1;
  const ring = elected
    ? "0 0 0 3px rgba(22,163,74,0.12), 0 8px 22px -12px rgba(22,163,74,0.4)"
    : undefined;

  return (
    <li
      className="rounded-2xl p-3 transition-all"
      style={{
        border: `1px solid ${border}`,
        background: elected ? "rgba(240,253,244,0.7)" : "rgba(255,255,255,0.7)",
        borderRadius: appleVibe.radius.md,
        opacity,
        boxShadow: ring,
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

      {/* B — Open questions. The primary trigger for the prototype
          lab (L3): each becomes one constraint × variation ×
          open-question triple that yields a surgical experiment. */}
      {v.open_questions && v.open_questions.length > 0 && (
        <div className="mt-2.5">
          <div
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Open questions
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {v.open_questions.map((q, i) => (
              <li
                key={i}
                className="text-[11px] font-light leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                {q}
              </li>
            ))}
          </ul>
        </div>
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
    </li>
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
}: {
  composedDesign: ComposedDesign | null;
  composing: boolean;
  composeError: string | null;
  electedCount: number;
  canCompose: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div
      className="mt-2 rounded-2xl p-3"
      style={{
        background: "rgba(15,23,42,0.025)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
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
