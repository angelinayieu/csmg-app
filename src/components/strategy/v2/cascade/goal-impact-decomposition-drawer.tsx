"use client";

// ── Goal-impact decomposition drawer ─────────────────────────────────
//
// Opens when the user clicks the "X.X% goal impact" chip on a cascade
// objective. Renders the FULL audit trail behind the headline number:
// per-chain contributions, the exact arithmetic that produced each
// contribution, the per-edge effect sizes when evidence is loaded, and
// the composite-confidence breakdown.
//
// Inherits the app-tier design language from SpacePlanDrawer:
//   • Solid white surface (NOT glass — drawers are committed contexts)
//   • Right-side slide-over via framer-motion at the canonical EASE
//   • Section eyebrows in uppercase tracking (12px / 600 / 0.06em)
//   • Title 20/600/#111827, body 13/400/1.5/#374151, microtext 10.5/500/#6B7280
//   • Tabular numerals on every numeric readout
//   • Lucide icons only — zero emoji, zero ASCII decoration
//
// Traceability contract: every percentage in the drawer is hoverable
// to reveal its derivation. No bare numbers — each number includes a
// `title` attribute with the math behind it (e.g.,
// "18.6 % × 0.167 × 0.82 = 2.55 %"). Hover affordances are
// supplementary; the formula is ALSO printed inline in font-mono so
// keyboard-only users can read it without hovering.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, X, ExternalLink } from "lucide-react";
import type { StageImpact } from "@/lib/twin/impact-weighted-metric";
import type { CausalChain } from "@/types/causal-chains";
import type { Edge } from "@/types";
import type { EvidenceRegistryRow } from "@/types/evidence-registry";
import { RigorMark } from "@/components/canvas/shapes/rigor-mark";
import {
  RIGOR_TIERS,
  TIER_META,
  isAnchoredTier,
  type RigorTier,
} from "@/lib/evidence/rigor-tier";

// Canonical site-wide ease — exported from SpacePlanDrawer; copied here
// to avoid a circular import.
const EASE = [0.22, 1, 0.36, 1] as const;

export interface GoalImpactDecompositionDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Stage name surfaced in the header — e.g., "Sleep Logging". */
  stageName: string;
  /** Goal title — surfaced as "towards '...'". Null when no anchor. */
  goalTitle: string | null;
  /** The full impact computation (output of computeStageImpact). */
  impact: StageImpact;
  /** Stage's primary entity id — used to walk chain.entity_ids[]. */
  stageEntityId: string;
  /** All causal chains in the space — for per-chain edge walk. */
  causalChains: CausalChain[];
  /** All edges — for per-edge lookup during per-chain expansion. */
  edges: Edge[];
  /** Evidence rows pre-bucketed by edge_id (or attached entity id). */
  evidenceByEntity: Map<string, EvidenceRegistryRow[]>;
  /** Lookup of human-readable entity names by entity_id. */
  entityNameById?: Map<string, string>;
  /** Optional click handler for "Open forest plot →" links. */
  onOpenForestPlot?: (edgeId: string) => void;
}

export function GoalImpactDecompositionDrawer({
  open,
  onClose,
  stageName,
  goalTitle,
  impact,
  stageEntityId,
  causalChains,
  edges,
  evidenceByEntity,
  entityNameById,
  onOpenForestPlot,
}: GoalImpactDecompositionDrawerProps) {
  // Esc-to-close — focus trap is handled by the scrim's role + the
  // close button being the first focusable element on mount.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const confidenceDimmed = impact.confidence < 0.4;
  const headlinePctColor = confidenceDimmed ? "#6B7280" : "#111827";
  // Phase F: append calibration term when present so the headline
  // tooltip shows the same factor the drawer body breaks down below.
  const calibrationTitleSuffix = impact.calibration
    ? ` · prediction tracking ±${impact.calibration.mean_abs_delta_strength.toFixed(2)} (factor ${impact.calibration.factor.toFixed(2)}${impact.calibration.blended ? ", blended" : ", informational only"})`
    : "";
  const headlinePctTitle = `${impact.pct.toFixed(1)} % expected goal impact · composite confidence ${impact.confidence.toFixed(2)} · summed across ${impact.chains.length} causal chain${impact.chains.length === 1 ? "" : "s"}${calibrationTitleSuffix}`;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim — slightly more opaque than SpacePlanDrawer because
              this drawer is denser and benefits from stronger context dim. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            onClick={onClose}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.40)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
              zIndex: 1000,
            }}
            aria-hidden
          />

          {/* Drawer panel */}
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={`Goal impact decomposition for ${stageName}`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.35, ease: EASE }}
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "min(560px, 95vw)",
              background: "#FFFFFF",
              borderTopLeftRadius: 16,
              borderBottomLeftRadius: 16,
              boxShadow: "-12px 0 32px rgba(0,0,0,0.12)",
              display: "flex",
              flexDirection: "column",
              zIndex: 1001,
              overflow: "hidden",
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
              color: "#111827",
            }}
          >
            <Header
              stageName={stageName}
              goalTitle={goalTitle}
              pct={impact.pct}
              confidence={impact.confidence}
              pctColor={headlinePctColor}
              pctTitle={headlinePctTitle}
              onClose={onClose}
            />

            {/* Scrollable body */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "24px 28px 32px",
              }}
            >
              <HeadlineSection impact={impact} />
              <ChainsSection
                impact={impact}
                stageEntityId={stageEntityId}
                causalChains={causalChains}
                edges={edges}
                evidenceByEntity={evidenceByEntity}
                entityNameById={entityNameById}
                onOpenForestPlot={onOpenForestPlot}
              />
              <SourcingSection impact={impact} />
              <EvidenceSection impact={impact} />
              {impact.calibration && (
                <CalibrationSection impact={impact} />
              )}
              <ConfidenceSection impact={impact} />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Header ──────────────────────────────────────────────────────────

function Header({
  stageName,
  goalTitle,
  pct,
  confidence,
  pctColor,
  pctTitle,
  onClose,
}: {
  stageName: string;
  goalTitle: string | null;
  pct: number;
  confidence: number;
  pctColor: string;
  pctTitle: string;
  onClose: () => void;
}) {
  return (
    <header
      style={{
        flexShrink: 0,
        padding: "20px 28px",
        borderBottom: "1px solid #E5E7EB",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 24,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "#6B7280",
            lineHeight: 1,
          }}
        >
          Goal impact
        </p>
        <h2
          style={{
            margin: "6px 0 0",
            fontSize: 20,
            fontWeight: 600,
            lineHeight: 1.2,
            color: "#111827",
            letterSpacing: "-0.01em",
          }}
        >
          {stageName}
        </h2>
        {goalTitle && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              fontWeight: 400,
              lineHeight: 1.5,
              color: "#6B7280",
            }}
          >
            towards{" "}
            <span style={{ color: "#374151", fontWeight: 500 }}>
              &ldquo;{goalTitle}&rdquo;
            </span>
          </p>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div
          style={{ textAlign: "right", minWidth: 96 }}
          title={pctTitle}
        >
          <p
            style={{
              margin: 0,
              fontSize: 32,
              fontWeight: 600,
              lineHeight: 1,
              color: pctColor,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.02em",
            }}
          >
            {pct.toFixed(1)}%
          </p>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 10.5,
              fontWeight: 500,
              color: "#6B7280",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            confidence {confidence.toFixed(2)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close decomposition"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "1px solid #E5E7EB",
            background: "transparent",
            color: "#6B7280",
            cursor: "pointer",
            transition: "background 120ms ease-out, color 120ms ease-out",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#F3F4F6";
            e.currentTarget.style.color = "#111827";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "#6B7280";
          }}
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}

// ── Headline section ────────────────────────────────────────────────

function HeadlineSection({ impact }: { impact: StageImpact }) {
  const summary = (() => {
    if (impact.chains.length === 0) {
      return "This stage isn't currently part of a causal chain pointing at this goal. Regenerate the strategy to produce chains that include it.";
    }
    return `This stage is expected to contribute ${impact.pct.toFixed(1)} % of the goal's total movement, summed across the ${impact.chains.length} causal chain${impact.chains.length === 1 ? "" : "s"} it appears in.`;
  })();

  return (
    <Section eyebrow="Headline">
      <p
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 400,
          lineHeight: 1.55,
          color: "#374151",
        }}
      >
        {summary}
      </p>
    </Section>
  );
}

// ── Chains section ──────────────────────────────────────────────────

function ChainsSection({
  impact,
  stageEntityId,
  causalChains,
  edges,
  evidenceByEntity,
  entityNameById,
  onOpenForestPlot,
}: {
  impact: StageImpact;
  stageEntityId: string;
  causalChains: CausalChain[];
  edges: Edge[];
  evidenceByEntity: Map<string, EvidenceRegistryRow[]>;
  entityNameById?: Map<string, string>;
  onOpenForestPlot?: (edgeId: string) => void;
}) {
  if (impact.chains.length === 0) {
    return (
      <Section eyebrow="Chains" right="0 contributing">
        <EmptyCard>
          No causal chains pointing at this goal include this stage. The
          headline 0 % reflects this — no chains, no contribution.
        </EmptyCard>
      </Section>
    );
  }

  return (
    <Section
      eyebrow="Chains"
      right={`${impact.chains.length} contributing`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {impact.chains.map((c) => {
          const chain = causalChains.find((cc) => cc.id === c.chain_id);
          return (
            <ChainContributionCard
              key={c.chain_id}
              contribution={c}
              chain={chain ?? null}
              stageEntityId={stageEntityId}
              edges={edges}
              evidenceByEntity={evidenceByEntity}
              entityNameById={entityNameById}
              onOpenForestPlot={onOpenForestPlot}
            />
          );
        })}
      </div>
    </Section>
  );
}

// ── Per-chain card (with collapsible per-edge expansion) ───────────

function ChainContributionCard({
  contribution: c,
  chain,
  stageEntityId,
  edges,
  evidenceByEntity,
  entityNameById,
  onOpenForestPlot,
}: {
  contribution: StageImpact["chains"][number];
  chain: CausalChain | null;
  stageEntityId: string;
  edges: Edge[];
  evidenceByEntity: Map<string, EvidenceRegistryRow[]>;
  entityNameById?: Map<string, string>;
  onOpenForestPlot?: (edgeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Per-edge walk: find edges between consecutive entities in the chain.
  // chain.entity_ids[] is the canonical order.
  const perEdgeRows = (() => {
    if (!chain) return [];
    const rows: Array<{
      edge: Edge | null;
      fromName: string;
      toName: string;
      fromId: string;
      toId: string;
      evidence: EvidenceRegistryRow[];
    }> = [];
    const ids = chain.entity_ids;
    for (let i = 0; i < ids.length - 1; i++) {
      const fromId = ids[i];
      const toId = ids[i + 1];
      const edge =
        edges.find(
          (e) =>
            (e.source_entity_id === fromId && e.target_entity_id === toId) ||
            (e.source_entity_id === toId && e.target_entity_id === fromId),
        ) ?? null;
      // Evidence per edge = rows attached to EITHER endpoint entity,
      // deduped by row id. Mirrors the lookup in computeStageImpact
      // since the evidence_registries table FKs evidence to entities,
      // not edges directly.
      const evRows: EvidenceRegistryRow[] = [];
      const seen = new Set<string>();
      for (const eid of [fromId, toId]) {
        for (const r of evidenceByEntity.get(eid) ?? []) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          evRows.push(r);
        }
      }
      rows.push({
        edge,
        fromId,
        toId,
        fromName: entityNameById?.get(fromId) ?? fromId,
        toName: entityNameById?.get(toId) ?? toId,
        evidence: evRows,
      });
    }
    return rows;
  })();

  const formulaTitle = `${c.raw_chain_contribution.toFixed(1)} % × ${c.position_weight.toFixed(3)} × ${c.chain_confidence.toFixed(2)} = ${c.contribution_pct.toFixed(2)} %`;

  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid #E5E7EB",
        background: "#FFFFFF",
        overflow: "hidden",
      }}
    >
      {/* Clickable header — toggles expansion */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          width: "100%",
          padding: "14px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#111827",
              letterSpacing: "-0.005em",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.chain_name}
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#111827",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
              flexShrink: 0,
            }}
            title={formulaTitle}
          >
            + {c.contribution_pct.toFixed(2)} %
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "#6B7280",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          stage {c.stage_position} of {c.stage_total} · chain confidence{" "}
          {c.chain_confidence.toFixed(2)}
        </span>
        <span
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
            fontSize: 11,
            fontWeight: 400,
            color: "#6B7280",
            fontVariantNumeric: "tabular-nums",
          }}
          title={formulaTitle}
        >
          {c.raw_chain_contribution.toFixed(1)} % × {c.position_weight.toFixed(3)}{" "}
          × {c.chain_confidence.toFixed(2)} = {c.contribution_pct.toFixed(2)} %
        </span>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: 500,
            color: "#6B7280",
            marginTop: 4,
          }}
        >
          {expanded ? (
            <ChevronDown size={12} strokeWidth={2} />
          ) : (
            <ChevronRight size={12} strokeWidth={2} />
          )}
          {expanded ? "collapse path" : "expand path"}
        </div>
      </button>

      {/* Expanded body — per-edge rows */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                padding: "0 16px 14px",
                borderTop: "1px solid #F3F4F6",
                marginTop: 4,
                paddingTop: 14,
              }}
            >
              {perEdgeRows.length === 0 ? (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 400,
                    color: "#6B7280",
                    lineHeight: 1.5,
                  }}
                >
                  Chain entity sequence not available for per-edge breakdown.
                </p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {perEdgeRows.map((row, idx) => (
                    <EdgeRow
                      key={`${row.fromId}-${row.toId}-${idx}`}
                      fromName={row.fromName}
                      toName={row.toName}
                      edge={row.edge}
                      evidence={row.evidence}
                      isStageEdge={
                        row.fromId === stageEntityId ||
                        row.toId === stageEntityId
                      }
                      onOpenForestPlot={
                        row.edge && onOpenForestPlot
                          ? () => onOpenForestPlot(row.edge!.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Per-edge row inside an expanded chain ──────────────────────────

function EdgeRow({
  fromName,
  toName,
  edge,
  evidence,
  isStageEdge,
  onOpenForestPlot,
}: {
  fromName: string;
  toName: string;
  edge: Edge | null;
  evidence: EvidenceRegistryRow[];
  isStageEdge: boolean;
  onOpenForestPlot?: () => void;
}) {
  // Per-row evidence stats. Single-study handling kept honest:
  // we render the one study's effect with its own CI when present.
  const nStudies = evidence.length;
  const withEffect = evidence.filter(
    (r) => typeof r.effect_size === "number" && Number.isFinite(r.effect_size),
  );
  const dominantMetric = (() => {
    const counts = new Map<string, number>();
    for (const r of withEffect) {
      const m = r.effect_metric ?? "unknown";
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  })();
  const effectLabel = (() => {
    if (withEffect.length === 0) return null;
    if (withEffect.length === 1) {
      const r = withEffect[0];
      const main = (r.effect_size as number).toFixed(2);
      const ci =
        r.ci_lower !== null && r.ci_upper !== null
          ? ` [${r.ci_lower.toFixed(2)}, ${r.ci_upper.toFixed(2)}]`
          : "";
      return `${dominantMetric ?? "effect"} ${main}${ci}`;
    }
    return `${dominantMetric ?? "effect"} — ${withEffect.length} studies pool inline`;
  })();
  const strength = edge?.strength ?? null;
  const dimension = edge?.dimension ?? "—";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        // 2px accent rail on the LEFT for the edge that actually
        // includes this stage's entity (its position-anchor in the
        // chain). Other rows get a transparent rail of the same width
        // so content alignment stays identical across rows.
        paddingLeft: 10,
        borderLeft: isStageEdge
          ? "2px solid rgba(10,132,255,0.55)"
          : "2px solid transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "#111827",
            letterSpacing: "-0.005em",
          }}
        >
          {fromName}{" "}
          <span style={{ color: "#9CA3AF", fontWeight: 400 }}>→</span>{" "}
          {toName}
        </span>
        {strength !== null && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: "#6B7280",
              fontVariantNumeric: "tabular-nums",
            }}
            title={`Edge strength (LLM-stated): ${strength.toFixed(2)}`}
          >
            strength {strength.toFixed(2)}
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 10.5,
          fontWeight: 500,
          color: "#6B7280",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "1px 6px",
            borderRadius: 4,
            background: "#F3F4F6",
            color: "#374151",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "lowercase",
          }}
        >
          {dimension}
        </span>
        <span>
          n = {nStudies}{" "}
          {nStudies === 0 && (
            <span style={{ color: "#9CA3AF" }}>(no studies in registry)</span>
          )}
        </span>
        {effectLabel && <span>· {effectLabel}</span>}
      </div>
      {onOpenForestPlot && nStudies > 0 && (
        <button
          type="button"
          onClick={onOpenForestPlot}
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 0",
            background: "transparent",
            border: "none",
            fontSize: 11,
            fontWeight: 500,
            color: "#0A84FF",
            cursor: "pointer",
            letterSpacing: "-0.005em",
          }}
        >
          Open forest plot
          <ExternalLink size={11} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

// ── Sourcing section (Phase 0 rigor) ───────────────────────────────
//
// Per-tier breakdown of the evidence rows feeding the pooled estimate.
// Surfaces the same data that drives the cascade chip's glyph variant
// and the forest plot's row dimming, but laid out as an auditable
// table the user can scan in one glance.
//
// The section is hidden when n_studies === 0 — there's nothing to
// disclose and the absence is already covered by the Evidence
// section's empty state.

function SourcingSection({ impact }: { impact: StageImpact }) {
  const ev = impact.evidence;
  if (ev.n_studies === 0) return null;

  // Order: anchored tiers first (paper_reviewed > paper_extracted),
  // then drifted (web_deep_research > web_heuristic > legacy_unsourced).
  // Same order the forest plot uses for stability across surfaces.
  const ordered: RigorTier[] = [...RIGOR_TIERS].sort(
    (a, b) => TIER_META[b].rank - TIER_META[a].rank,
  );

  const lowRigor = ev.low_rigor_warning;
  const headerRight = lowRigor
    ? `${ev.n_drifted} drifted of ${ev.n_studies}`
    : `${ev.n_anchored} anchored of ${ev.n_studies}`;

  return (
    <Section eyebrow="Sourcing" right={headerRight}>
      <div
        style={{
          padding: "14px 16px",
          background: "#FFFFFF",
          border: "1px solid #E5E7EB",
          borderRadius: 10,
        }}
      >
        {lowRigor && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 10px",
              background: "rgba(180, 83, 9, 0.06)",
              border: "1px solid rgba(180, 83, 9, 0.22)",
              borderRadius: 6,
              fontSize: 11.5,
              color: "#92400E",
              lineHeight: 1.45,
            }}
            title="Low-rigor warning: the pooled estimate is built entirely from web-research or legacy rows. Treat the pooled effect as suggestive, not definitive."
          >
            Pool built entirely from web/legacy rows. No paper-sourced
            evidence anchors this estimate yet.
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            rowGap: 8,
            columnGap: 12,
            alignItems: "center",
          }}
        >
          {ordered.map((tier) => {
            const count = ev.n_per_tier[tier];
            const meta = TIER_META[tier];
            const anchored = isAnchoredTier(tier);
            const dim = count === 0;
            const color = dim
              ? "#D1D5DB"
              : anchored
                ? "#0F766E"
                : "#B45309";
            return (
              <SourcingRowFragment
                key={tier}
                tier={tier}
                count={count}
                color={color}
                label={meta.label}
                description={meta.description}
                dim={dim}
              />
            );
          })}
        </div>
      </div>
    </Section>
  );
}

function SourcingRowFragment({
  tier,
  count,
  color,
  label,
  description,
  dim,
}: {
  tier: RigorTier;
  count: number;
  color: string;
  label: string;
  description: string;
  dim: boolean;
}) {
  return (
    <>
      <span
        title={description}
        style={{
          color,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          opacity: dim ? 0.55 : 1,
        }}
      >
        <RigorMark tier={tier} size={12} showTitle={false} />
      </span>
      <span
        title={description}
        style={{
          fontSize: 12.5,
          fontWeight: 500,
          color: dim ? "#9CA3AF" : "#374151",
          letterSpacing: "-0.005em",
        }}
      >
        {label}
      </span>
      <span
        title={description}
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: dim ? "#9CA3AF" : "#111827",
        }}
      >
        {count}
      </span>
    </>
  );
}

// ── Evidence section ───────────────────────────────────────────────

function EvidenceSection({ impact }: { impact: StageImpact }) {
  const { evidence } = impact;
  if (evidence.n_studies === 0) {
    return (
      <Section eyebrow="Evidence" right="not yet aggregated">
        <EmptyCard>
          The edges this stage touches have no evidence rows in the
          registry yet. Headline confidence comes from chain trust alone.
        </EmptyCard>
      </Section>
    );
  }

  const rows: Array<[string, string, string]> = [];
  if (evidence.pooled_effect !== null) {
    rows.push([
      "Pooled effect size",
      `${evidence.pooled_effect.toFixed(2)} ${evidence.effect_metric ?? ""}`.trim(),
      `Inverse-variance-pooled across ${evidence.n_studies} studies${evidence.effect_metric ? ` (${evidence.effect_metric} metric)` : ""}.`,
    ]);
  }
  if (
    evidence.pooled_ci_lower !== null &&
    evidence.pooled_ci_upper !== null
  ) {
    rows.push([
      "95% CI",
      `[${evidence.pooled_ci_lower.toFixed(2)}, ${evidence.pooled_ci_upper.toFixed(2)}]`,
      "Confidence interval on the pooled estimate.",
    ]);
  }
  rows.push([
    "Heterogeneity",
    evidence.i_squared !== null
      ? `I² = ${Math.round(evidence.i_squared)}%`
      : "n/a (single study)",
    evidence.i_squared !== null
      ? "How much effects vary across studies; higher = more disagreement."
      : "Heterogeneity needs ≥2 studies.",
  ]);
  rows.push([
    "Evidence quality",
    `${evidence.evidence_quality.toFixed(2)} / 1.00`,
    "Weighted by study-design tier × extraction confidence × sample size.",
  ]);

  return (
    <Section
      eyebrow="Evidence"
      right={`${evidence.n_studies} studies pooled`}
    >
      <KeyValueTable rows={rows} />
    </Section>
  );
}

// ── Calibration section (Phase F) ──────────────────────────────────
//
// Surfaced ONLY when StageImpact.calibration is non-null — i.e., the
// stage has at least one resolved prediction in the last 90 days that
// touched one of its incident edges. Headline number is mean
// |Δ_strength| across those rows, presented as the user-facing
// "predictions tracking ±0.12" reading.
//
// When `calibration.blended` is true (n_rows >= 3), the row is
// "load-bearing": the same number is the third factor in composite
// confidence. When false, the row is "informational" — the user sees
// "1 prediction resolved so far" with a muted hint that 3+ are needed
// before this signal counts.

function relativeTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} wk${weeks === 1 ? "" : "s"} ago`;
  return `${Math.floor(days / 30)} mo ago`;
}

function CalibrationSection({ impact }: { impact: StageImpact }) {
  const c = impact.calibration!;
  const meanDelta = c.mean_abs_delta_strength;
  // The 0.30 number is the cliff: |Δ| >= 0.30 collapses factor to 0.
  // Display the "of 0.30" anchor so users understand the scale.
  const factorPctLabel = `${Math.round(c.factor * 100)}%`;
  const blendedLabel = c.blended
    ? `Blended at 30% into composite confidence (n=${c.n_rows} ≥ 3 threshold).`
    : `Informational only — need ${3 - c.n_rows} more resolved prediction${3 - c.n_rows === 1 ? "" : "s"} before this counts toward composite confidence.`;

  const right = c.last_at
    ? `last ${relativeTimeAgo(c.last_at)}`
    : null;

  return (
    <Section eyebrow="Prediction tracking" right={right ?? undefined}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "12px 14px",
          background: c.blended
            ? "rgba(15, 118, 110, 0.05)"
            : "rgba(107, 114, 128, 0.05)",
          border: `1px solid ${c.blended ? "rgba(15, 118, 110, 0.20)" : "rgba(107, 114, 128, 0.18)"}`,
          borderRadius: 8,
        }}
        title={`Mean |Δ_strength| = ${meanDelta.toFixed(3)} across ${c.n_rows} calibration row${c.n_rows === 1 ? "" : "s"}. Factor = clamp(1 - ${meanDelta.toFixed(3)} / 0.30, 0, 1) = ${c.factor.toFixed(2)}. ${blendedLabel}`}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: c.blended ? "#0F766E" : "#374151",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
            }}
          >
            ±{meanDelta.toFixed(2)}
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "#9CA3AF",
                marginLeft: 6,
              }}
            >
              avg edge-strength drift
            </span>
          </div>
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: "#6B7280",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            across {c.n_rows} calibration{c.n_rows === 1 ? "" : "s"}
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            columnGap: 10,
            rowGap: 4,
            fontSize: 11.5,
            color: "#6B7280",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span style={{ color: "#374151", fontWeight: 500 }}>
            Tracking factor
          </span>
          <span
            title={`clamp(1 − ${meanDelta.toFixed(3)} / 0.30, 0, 1) = ${c.factor.toFixed(3)}`}
          >
            <span
              style={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                fontSize: 10.5,
                color: "#6B7280",
              }}
            >
              clamp(1 − {meanDelta.toFixed(2)} / 0.30)
            </span>
          </span>
          <span
            style={{
              color: c.blended ? "#0F766E" : "#374151",
              fontWeight: 600,
            }}
          >
            {factorPctLabel}
          </span>
          <span style={{ color: "#374151", fontWeight: 500 }}>Status</span>
          <span style={{ gridColumn: "span 2", color: "#6B7280" }}>
            {blendedLabel}
          </span>
        </div>
      </div>
    </Section>
  );
}

// ── Confidence section ─────────────────────────────────────────────

function ConfidenceSection({ impact }: { impact: StageImpact }) {
  const avgChainConfidence =
    impact.chains.length > 0
      ? impact.chains.reduce((s, c) => s + c.chain_confidence, 0) /
        impact.chains.length
      : 0;
  const evidenceQuality = impact.evidence.evidence_quality;
  const hasEvidence = impact.evidence.n_studies >= 3;
  const cal = impact.calibration;
  const calBlended = cal?.blended === true;

  // Three weight modes — must mirror computeStageImpact Step 5 exactly
  // or the displayed math wouldn't equal the displayed composite.
  let chainWeight: number;
  let evidenceWeight: number;
  let calibrationWeight: number;
  if (calBlended) {
    if (hasEvidence) {
      chainWeight = 0.3;
      evidenceWeight = 0.4;
      calibrationWeight = 0.3;
    } else {
      chainWeight = 0.5;
      evidenceWeight = 0;
      calibrationWeight = 0.5;
    }
  } else {
    evidenceWeight = hasEvidence ? 0.6 : 0;
    chainWeight = 1 - evidenceWeight;
    calibrationWeight = 0;
  }

  const compositeFormulaParts: string[] = [];
  compositeFormulaParts.push(
    `${chainWeight.toFixed(1)} × ${avgChainConfidence.toFixed(2)}`,
  );
  if (evidenceWeight > 0) {
    compositeFormulaParts.push(
      `${evidenceWeight.toFixed(1)} × ${evidenceQuality.toFixed(2)}`,
    );
  }
  if (calibrationWeight > 0 && cal) {
    compositeFormulaParts.push(
      `${calibrationWeight.toFixed(1)} × ${cal.factor.toFixed(2)}`,
    );
  }

  const rows: Array<[string, string, string]> = [
    [
      "Chain trust (avg)",
      avgChainConfidence.toFixed(2),
      `Average confidence across the ${impact.chains.length} contributing chain${impact.chains.length === 1 ? "" : "s"}.`,
    ],
    [
      "Evidence quality",
      evidenceQuality.toFixed(2),
      hasEvidence
        ? "From pooled study quality across edges this stage touches."
        : "Not contributing yet — needs at least 3 studies to weight in.",
    ],
  ];
  if (cal) {
    rows.push([
      "Calibration factor",
      cal.factor.toFixed(2),
      calBlended
        ? `From your resolved predictions — closer to 1.0 means predictions tracked closer to expectation.`
        : `Informational only until ${3 - cal.n_rows} more prediction${3 - cal.n_rows === 1 ? "" : "s"} resolve.`,
    ]);
  }
  rows.push([
    "Chain weight",
    `${Math.round(chainWeight * 100)}%`,
    "Share of composite confidence from chain trust.",
  ]);
  rows.push([
    "Evidence weight",
    `${Math.round(evidenceWeight * 100)}%`,
    hasEvidence
      ? "Share of composite confidence from evidence quality."
      : "Drops to 0 below 3 studies.",
  ]);
  if (cal) {
    rows.push([
      "Calibration weight",
      `${Math.round(calibrationWeight * 100)}%`,
      calBlended
        ? "Share from your prediction-tracking signal."
        : "Drops to 0 below 3 resolved predictions.",
    ]);
  }
  rows.push([
    "Composite",
    impact.confidence.toFixed(2),
    compositeFormulaParts.join(" + "),
  ]);

  return (
    <Section
      eyebrow="Confidence"
      right={`${impact.confidence.toFixed(2)} / 1.00`}
    >
      <KeyValueTable rows={rows} />
    </Section>
  );
}

// ── Reusable primitives ────────────────────────────────────────────

function Section({
  eyebrow,
  right,
  children,
}: {
  eyebrow: string;
  right?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "#6B7280",
            lineHeight: 1,
          }}
        >
          {eyebrow}
        </h3>
        {right && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "#9CA3AF",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {right}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function KeyValueTable({
  rows,
}: {
  rows: Array<[label: string, value: string, hover: string]>;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        rowGap: 10,
        columnGap: 16,
        padding: "14px 16px",
        background: "#FFFFFF",
        border: "1px solid #E5E7EB",
        borderRadius: 10,
      }}
    >
      {rows.map(([label, value, hover]) => (
        <KvRowFragment key={label} label={label} value={value} hover={hover} />
      ))}
    </div>
  );
}

function KvRowFragment({
  label,
  value,
  hover,
}: {
  label: string;
  value: string;
  hover: string;
}) {
  return (
    <>
      <span
        title={hover}
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "#6B7280",
          letterSpacing: "-0.005em",
        }}
      >
        {label}
      </span>
      <span
        title={hover}
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "#111827",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.005em",
        }}
      >
        {value}
      </span>
    </>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "#F9FAFB",
        border: "1px dashed #E5E7EB",
        borderRadius: 10,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 12,
          fontWeight: 400,
          lineHeight: 1.5,
          color: "#6B7280",
        }}
      >
        {children}
      </p>
    </div>
  );
}
