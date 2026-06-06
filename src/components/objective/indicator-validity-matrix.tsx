"use client";

// ── Indicator Validity Matrix (Phase 11.9a) ───────────────────────
//
// The decision-stakes view of the rigor stack we built across
// Phase 11.2-11.8. The chip strip on the Category Card surfaces all
// six tiers at GLANCE resolution (one chip per indicator, with all
// signals compressed inline). This matrix is the COMMIT-STAKES view:
// a grid where every signal gets its own column so the user can see
// each tier's verdict cleanly, plus footer callouts when tiers
// disagree (load-bearing flags that something needs attention before
// shipping).
//
// Refinement A from the spec: the HEADLINE-DRIVING tier per row is
// highlighted (bold + tier-colored background). Tells the user
// "this is the number actually carrying the claim" — empirical when
// present, else ensemble lens when present, else rubric.
//
// Use-case modes: this component is mode-agnostic. The forest plot
// + persona heatmap + Goodhart pairings panels (Phase 11.9b/c/d)
// will gate on use_case_mode === "scientific" || "personal_health".
// The matrix itself ships everywhere because it's the universal
// "all the evidence in one place" surface.
//
// Soft-fail: any tier's absence renders as "—" rather than collapsing
// the column. Honest about coverage gaps — if only rubric ran, only
// the 📋 column populates; the user sees they have room to deepen.

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { appleVibe, withAlpha } from "@/lib/apple-vibe-tokens";
import type { ItemVariation } from "@/lib/objective-canvas/expand-item-detail";

// ── Public props ──────────────────────────────────────────────────

/** Minimal shape the matrix consumes from a variation. Accepts both
 *  the full ItemVariation (from expand-item-detail) AND drawer-local
 *  shapes that only thread the name + indicator_scores fields — so
 *  the matrix is callable from any component that has these fields
 *  without forcing a full type alignment. */
export interface MatrixVariationInput {
  /** Optional — matrix uses it only for header display + uniqueness;
   *  when omitted the matrix falls back to the variation's name. */
  id?: string;
  name: string;
  indicator_scores?: ItemVariation["indicator_scores"];
}

interface Props {
  /** The variation whose indicator_scores power the matrix. Caller
   *  passes the elected (or focused) variation; matrix renders the
   *  rigor audit for THIS variation's per-indicator grades. */
  variation: MatrixVariationInput;
  /** Optional override for the matrix title. Defaults to the
   *  variation's name. */
  title?: string;
  /** Compact mode shrinks padding + font sizes for embedding in the
   *  Strategy Brief (where many variations stack vertically). */
  compact?: boolean;
}

// ── Tier definitions ──────────────────────────────────────────────

type TierKey = "rubric" | "ensemble" | "simulation" | "evidence" | "persona" | "tested";

const TIER_HEADERS: Array<{
  key: TierKey;
  emoji: string;
  label: string;
  explainer: string;
}> = [
  {
    key: "rubric",
    emoji: "📋",
    label: "Rubric",
    explainer: "Single LLM grade on 5 criteria + confidence",
  },
  {
    key: "ensemble",
    emoji: "📊",
    label: "Ensemble",
    explainer: "5-lens consensus + REML τ² heterogeneity",
  },
  {
    key: "simulation",
    emoji: "🎲",
    label: "Simulation",
    explainer: "Monte Carlo lift propagation × consensus confidence",
  },
  {
    key: "evidence",
    emoji: "📚",
    label: "Evidence",
    explainer: "Research citation supports/refutes split",
  },
  {
    key: "persona",
    emoji: "👥",
    label: "Persona",
    explainer: "HCD per-persona coverage + disagreement",
  },
  {
    key: "tested",
    emoji: "🧪",
    label: "Tested",
    explainer: "Empirical results from concluded prototypes",
  },
];

// ── Headline-tier resolution (Refinement A) ────────────────────────
//
// The matrix bolds the CELL that is currently driving the
// indicator's headline confidence. Resolution order matches reality-
// over-theory hierarchy from the chip strip:
//
//   tested > ensemble (when lens_scores present) > rubric
//
// Evidence + simulation + persona are OVERLAYS on the underlying
// theoretical tier — they refine the confidence number but don't
// supplant the load-bearing scorer. So they're never the headline
// tier on their own; they're audit columns alongside the headline.

type IndicatorScore = NonNullable<MatrixVariationInput["indicator_scores"]>[number];

function headlineTier(ind: IndicatorScore): TierKey {
  if (ind.empirical_overlay) return "tested";
  if (Array.isArray(ind.lens_scores) && ind.lens_scores.length > 0) {
    return "ensemble";
  }
  return "rubric";
}

// ── Cell content resolvers ────────────────────────────────────────
//
// Each tier extracts its summary text from the indicator. Returns
// "—" when the tier's data is absent so missing-tier cells degrade
// gracefully without collapsing the grid.

function cellContent(ind: IndicatorScore, tier: TierKey): {
  text: string;
  /** Optional tone — positive ⇒ green, negative ⇒ red. */
  tone?: "positive" | "negative" | "neutral";
} {
  switch (tier) {
    case "rubric": {
      // Rubric is always present once any tier has run (it's the
      // base score). Show score + confidence.
      const tone =
        ind.score >= 0.65
          ? "positive"
          : ind.score < 0.4
            ? "negative"
            : "neutral";
      return { text: ind.score.toFixed(2), tone };
    }
    case "ensemble": {
      if (!Array.isArray(ind.lens_scores) || ind.lens_scores.length === 0) {
        return { text: "—" };
      }
      const count = ind.lens_agreement_count ?? 0;
      const total = ind.lens_scores.length;
      const tone =
        count >= total - 1 ? "positive" : count < 3 ? "negative" : "neutral";
      return { text: `${count}/${total}`, tone };
    }
    case "simulation": {
      if (typeof ind.lift_pct !== "number") return { text: "—" };
      const sign = ind.lift_pct >= 0 ? "+" : "";
      const tone =
        ind.lift_pct > 0.02
          ? "positive"
          : ind.lift_pct < -0.02
            ? "negative"
            : "neutral";
      return { text: `${sign}${(ind.lift_pct * 100).toFixed(0)}%`, tone };
    }
    case "evidence": {
      if (
        !Array.isArray(ind.evidence_citations) ||
        ind.evidence_citations.length === 0
      ) {
        return { text: "—" };
      }
      const s = ind.evidence_supports ?? 0;
      const r = ind.evidence_refutes ?? 0;
      const tone = r > s ? "negative" : s > 0 ? "positive" : "neutral";
      return {
        text: `${s}✓${r > 0 ? ` ${r}✗` : ""}`,
        tone,
      };
    }
    case "persona": {
      if (
        !Array.isArray(ind.persona_scores) ||
        ind.persona_scores.length === 0
      ) {
        return { text: "—" };
      }
      const count = ind.persona_coverage_count ?? 0;
      const total = ind.persona_coverage_total ?? 0;
      const disagreement = ind.persona_disagreement_score ?? 0;
      const tone =
        disagreement > 0.2
          ? "negative"
          : count >= Math.ceil(total * 0.6)
            ? "positive"
            : "neutral";
      return {
        text: `${count}/${total}${disagreement > 0.2 ? "÷" : ""}`,
        tone,
      };
    }
    case "tested": {
      if (!ind.empirical_overlay) return { text: "—" };
      const emp = ind.empirical_overlay;
      const dir = emp.observed_direction;
      if (emp.observed_lift_pct !== null) {
        const sign = emp.observed_lift_pct >= 0 ? "+" : "";
        const tone =
          emp.observed_lift_pct > 0
            ? "positive"
            : emp.observed_lift_pct < 0
              ? "negative"
              : "neutral";
        return {
          text: `${sign}${(emp.observed_lift_pct * 100).toFixed(0)}% (r${emp.methodology_rigor.toFixed(1)})`,
          tone,
        };
      }
      const glyph =
        dir === "increased"
          ? "↑"
          : dir === "decreased"
            ? "↓"
            : dir === "inconsistent"
              ? "≠"
              : "→";
      const tone =
        dir === "increased"
          ? "positive"
          : dir === "decreased" || dir === "inconsistent"
            ? "negative"
            : "neutral";
      return { text: `${glyph} (r${emp.methodology_rigor.toFixed(1)})`, tone };
    }
  }
}

// ── Diverge-callout detection ─────────────────────────────────────
//
// Footer callouts surface ROWS where multiple tiers disagree. These
// are the load-bearing flags before commit — a row where ensemble
// says 0.71 but evidence refutes is the canonical "looks rigorous
// but the literature pushes back" signal that the chip strip
// compresses too tightly to see at a glance.

interface DivergeCallout {
  indicator_text: string;
  outcome_name: string;
  message: string;
  severity: "critical" | "warning";
}

function detectCallouts(indicators: IndicatorScore[]): DivergeCallout[] {
  const callouts: DivergeCallout[] = [];
  for (const ind of indicators) {
    const reasons: string[] = [];
    let severity: DivergeCallout["severity"] = "warning";

    // High ensemble confidence + refuting evidence = "rigorous looking but
    // the literature pushes back" pattern. Critical.
    const supports = ind.evidence_supports ?? 0;
    const refutes = ind.evidence_refutes ?? 0;
    if (
      Array.isArray(ind.lens_scores) &&
      ind.lens_scores.length > 0 &&
      (ind.lens_agreement_count ?? 0) >= ind.lens_scores.length - 1 &&
      refutes > supports
    ) {
      reasons.push(
        `${refutes} refuting citation${refutes === 1 ? "" : "s"} despite ${ind.lens_agreement_count}/${ind.lens_scores.length} lens consensus`,
      );
      severity = "critical";
    }

    // Negative MC lift + positive ensemble = structural propagation
    // disagrees with qualitative grading. Warning.
    if (
      typeof ind.lift_pct === "number" &&
      ind.lift_pct < -0.02 &&
      ind.score >= 0.5
    ) {
      reasons.push(
        `MC simulation: ${(ind.lift_pct * 100).toFixed(0)}% lift contradicts qualitative score ${ind.score.toFixed(2)}`,
      );
      severity = "critical";
    }

    // High persona disagreement = polarizing variation.
    const personaDis = ind.persona_disagreement_score ?? 0;
    if (personaDis > 0.2) {
      reasons.push(
        `personas split (disagreement ${personaDis.toFixed(2)}) — works for some user types not others`,
      );
    }

    // Empirical negative when theory was positive = reality refutes.
    // Critical — overrides everything else.
    const emp = ind.empirical_overlay;
    if (
      emp &&
      ((emp.observed_lift_pct !== null && emp.observed_lift_pct < 0) ||
        emp.observed_direction === "decreased" ||
        emp.observed_direction === "inconsistent") &&
      ind.score >= 0.5
    ) {
      reasons.push(
        `🧪 empirical: ${emp.observed_direction}${emp.observed_lift_pct !== null ? ` (${(emp.observed_lift_pct * 100).toFixed(0)}%)` : ""} contradicts theoretical positive score`,
      );
      severity = "critical";
    }

    // Goodhart high-risk surfaces here too as a low-severity flag.
    if (ind.goodhart_risk === "high") {
      reasons.push("Goodhart risk: high — proxy is pure-volume / gameable");
    }

    // Prentice mediation questionable.
    if (ind.mediation_check === "questionable") {
      reasons.push(
        "Prentice mediation: questionable — proxy might invert under intervention",
      );
    }

    // Low lens count = shaky proxy validity in general.
    if (
      Array.isArray(ind.lens_scores) &&
      ind.lens_scores.length > 0 &&
      (ind.lens_agreement_count ?? 0) < 3
    ) {
      reasons.push(
        `only ${ind.lens_agreement_count ?? 0}/${ind.lens_scores.length} lenses agree the proxy is valid`,
      );
    }

    if (reasons.length === 0) continue;
    callouts.push({
      indicator_text: ind.indicator_text,
      outcome_name: ind.outcome_name,
      message: reasons.join("; "),
      severity,
    });
  }
  return callouts;
}

// ── Component ─────────────────────────────────────────────────────

export function IndicatorValidityMatrix({
  variation,
  title,
  compact = false,
}: Props) {
  const indicators = variation.indicator_scores ?? [];
  if (indicators.length === 0) {
    return (
      <div
        className="rounded-xl px-3 py-2.5 text-[11.5px] italic"
        style={{
          background: appleVibe.surface.chip,
          color: appleVibe.text.tertiary,
          border: `1px solid ${appleVibe.stroke.hairline}`,
          fontFamily: appleVibe.font.stack,
        }}
      >
        No indicator scores yet — run a scoring tier from the room.
      </div>
    );
  }

  // Group by outcome so the matrix reads "indicators of outcome A;
  // indicators of outcome B" — matches the chip strip's grouping.
  const byOutcome = new Map<string, IndicatorScore[]>();
  for (const ind of indicators) {
    const arr = byOutcome.get(ind.outcome_name) ?? [];
    arr.push(ind);
    byOutcome.set(ind.outcome_name, arr);
  }

  const callouts = detectCallouts(indicators);

  const cellPad = compact ? "px-1.5 py-1" : "px-2.5 py-1.5";
  const headerSize = compact ? "10.5px" : "11px";
  const cellSize = compact ? "11px" : "11.5px";

  return <ValidityMatrixShell
    title={title ?? variation.name}
    indicators={indicators}
    byOutcome={byOutcome}
    callouts={callouts}
    cellPad={cellPad}
    headerSize={headerSize}
    cellSize={cellSize}
    compact={compact}
  />;
}

// ── Shell — headline-first, collapsible (Arc 1) ───────────────────
//
// The grid is now EVIDENCE, surfaced behind a toggle. The headline
// (always visible) carries the prioritized signal: indicator count,
// overall alignment verdict, and any CRITICAL diverge flags (those
// stay visible even when collapsed — they're load-bearing warnings
// the user must see before committing). The full grid + all callouts
// expand on demand. Also fixes the 640px-min-width table cropping in
// the 480px drawer — the table only renders (and only scrolls) when
// the user expands it.

function ValidityMatrixShell({
  title,
  indicators,
  byOutcome,
  callouts,
  cellPad,
  headerSize,
  cellSize,
  compact,
}: {
  title: string;
  indicators: IndicatorScore[];
  byOutcome: Map<string, IndicatorScore[]>;
  callouts: DivergeCallout[];
  cellPad: string;
  headerSize: string;
  cellSize: string;
  compact: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const criticalCount = callouts.filter((c) => c.severity === "critical").length;
  const warningCount = callouts.length - criticalCount;
  // Headline verdict — prioritized signal the user reads first.
  const verdict =
    criticalCount > 0
      ? { text: `${criticalCount} critical flag${criticalCount === 1 ? "" : "s"}`, color: appleVibe.stage.pain }
      : warningCount > 0
        ? { text: `${warningCount} flag${warningCount === 1 ? "" : "s"}`, color: "rgba(217,119,6,0.95)" }
        : { text: "tiers aligned", color: appleVibe.stage.outcomes };

  return (
    <div
      className="rounded-2xl border"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Headline — always visible, click to expand the evidence grid. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`flex w-full items-center justify-between border-b text-left transition-colors hover:bg-[rgba(15,23,42,0.02)] ${cellPad}`}
        style={{ borderColor: appleVibe.stroke.hairline }}
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Validity Matrix
          </span>
          <span
            className="truncate font-semibold"
            style={{ color: appleVibe.text.primary, fontSize: headerSize }}
          >
            {title}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span
            className="text-[10px] font-medium"
            style={{ color: appleVibe.text.tertiary }}
          >
            {indicators.length} ind.
          </span>
          <span
            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ background: `${verdict.color}1A`, color: verdict.color }}
          >
            {verdict.text}
          </span>
          {expanded ? (
            <ChevronUp
              className="h-3 w-3"
              strokeWidth={2.4}
              style={{ color: appleVibe.text.tertiary }}
            />
          ) : (
            <ChevronDown
              className="h-3 w-3"
              strokeWidth={2.4}
              style={{ color: appleVibe.text.tertiary }}
            />
          )}
        </div>
      </button>

      {/* Critical callouts — ALWAYS visible (even collapsed) because
          they're the load-bearing "don't ship without reading this"
          warnings. Non-critical flags only show when expanded. */}
      {!expanded && criticalCount > 0 && (
        <div
          className={cellPad}
          style={{ background: `${withAlpha(appleVibe.stage.pain, "06")}` }}
        >
          <ul className="space-y-1">
            {callouts
              .filter((c) => c.severity === "critical")
              .map((c) => (
                <li
                  key={c.indicator_text}
                  className="text-[11px] leading-snug"
                  style={{ color: "rgba(127,29,29,0.95)" }}
                >
                  <span aria-hidden style={{ marginRight: "4px", color: appleVibe.stage.pain }}>
                    ⚠
                  </span>
                  <span style={{ fontWeight: 600 }}>&ldquo;{c.indicator_text}&rdquo;</span>
                  : {c.message}
                </li>
              ))}
          </ul>
        </div>
      )}

      {expanded && (
      <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: "640px" }}>
          <thead>
            <tr>
              <th
                className={`text-left ${cellPad}`}
                style={{
                  fontSize: headerSize,
                  fontWeight: 600,
                  color: appleVibe.text.secondary,
                  borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                }}
              >
                Indicator
              </th>
              {TIER_HEADERS.map((t) => (
                <th
                  key={t.key}
                  title={t.explainer}
                  className={`text-center ${cellPad}`}
                  style={{
                    fontSize: headerSize,
                    fontWeight: 600,
                    color: appleVibe.text.secondary,
                    borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                  }}
                >
                  <span aria-hidden style={{ marginRight: "3px" }}>
                    {t.emoji}
                  </span>
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(byOutcome.entries()).map(([outcomeName, list]) => (
              <>
                <tr key={`group-${outcomeName}`}>
                  <td
                    colSpan={TIER_HEADERS.length + 1}
                    className={`italic ${cellPad}`}
                    style={{
                      fontSize: "10px",
                      color: appleVibe.text.faint,
                      background: appleVibe.surface.chip,
                      borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                    }}
                  >
                    in {outcomeName}
                  </td>
                </tr>
                {list.map((ind) => {
                  const headline = headlineTier(ind);
                  const truncatedName =
                    ind.indicator_text.length > 44
                      ? `${ind.indicator_text.slice(0, 42)}…`
                      : ind.indicator_text;
                  // Match this indicator against the callouts so the
                  // row can flag itself with a ⚠ when applicable.
                  const flagged = callouts.find(
                    (c) => c.indicator_text === ind.indicator_text,
                  );
                  return (
                    <tr
                      key={`${ind.outcome_id}::${ind.indicator_text}`}
                      style={{
                        borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                      }}
                    >
                      <td
                        className={`text-left ${cellPad}`}
                        style={{
                          fontSize: cellSize,
                          color: appleVibe.text.primary,
                          fontWeight: 500,
                        }}
                        title={ind.indicator_text}
                      >
                        {truncatedName}
                        {flagged && (
                          <span
                            aria-hidden
                            style={{
                              marginLeft: "4px",
                              color:
                                flagged.severity === "critical"
                                  ? appleVibe.stage.pain
                                  : "rgba(217,119,6,0.85)",
                            }}
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                      {TIER_HEADERS.map((t) => {
                        const cell = cellContent(ind, t.key);
                        const isHeadline = headline === t.key;
                        const cellColor =
                          cell.tone === "positive"
                            ? appleVibe.stage.outcomes
                            : cell.tone === "negative"
                              ? appleVibe.stage.pain
                              : cell.text === "—"
                                ? appleVibe.text.faint
                                : appleVibe.text.primary;
                        return (
                          <td
                            key={t.key}
                            className={`text-center ${cellPad}`}
                            style={{
                              fontSize: cellSize,
                              color: cellColor,
                              fontWeight: isHeadline ? 700 : 500,
                              background: isHeadline
                                ? `${cellColor}12`
                                : "transparent",
                              borderLeft: isHeadline
                                ? `2px solid ${cellColor}50`
                                : "none",
                              borderRight: isHeadline
                                ? `2px solid ${cellColor}50`
                                : "none",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {cell.text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer callouts — diverge flags. Rendered as a list when
          present; absent when all rows are clean. */}
      {callouts.length > 0 && (
        <div
          className={`border-t ${cellPad}`}
          style={{
            borderColor: appleVibe.stroke.hairline,
            background: `${withAlpha(appleVibe.stage.pain, "06")}`,
          }}
        >
          <div
            className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.secondary }}
          >
            Diverge flags · {callouts.length}
          </div>
          <ul className="space-y-1">
            {callouts.map((c) => (
              <li
                key={c.indicator_text}
                className="text-[11px] leading-snug"
                style={{
                  color:
                    c.severity === "critical"
                      ? "rgba(127,29,29,0.95)"
                      : "rgba(146,64,14,0.95)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    marginRight: "4px",
                    color:
                      c.severity === "critical"
                        ? appleVibe.stage.pain
                        : "rgba(217,119,6,0.85)",
                  }}
                >
                  ⚠
                </span>
                <span style={{ fontWeight: 600 }}>"{c.indicator_text}"</span>
                <span style={{ color: appleVibe.text.tertiary }}>
                  {" "}
                  ({c.outcome_name})
                </span>
                : {c.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      </>
      )}
    </div>
  );
}
