"use client";

// ── Goodhart Pairings Panel (Phase 11.9b) ─────────────────────────
//
// Surfaces the counter-indicators ensemble scoring (Phase 11.3) has
// been computing and persisting — but which had no UI surface until
// now. The Goodhart antidote is "pair every yang with a yin": when
// your primary indicator measures activity (sessions, time), the
// counter-indicator should measure something the variation could
// degrade if it Goodharted the primary (session quality, value-per-
// session). Watching both side-by-side resists the "metric gaming"
// failure mode.
//
// Per the 2026 balanced-scorecard literature: multi-objective
// optimization prevents proxy collapse. The ensemble proposes the
// counter; this panel makes it visible so the user can actually
// track both alongside the primary indicator set.
//
// Always rendered (use_case_mode agnostic) because Goodhart resistance
// matters for consumer apps, scientific designs, and personal-health
// interventions equally — anywhere optimization is happening.
//
// Mount: Item Detail Drawer after the Validity Matrix section.
// Future: also in Strategy Brief as part of the "Counter-indicators"
// subsection per elected variation.

import { appleVibe } from "@/lib/apple-vibe-tokens";

// ── Public types ──────────────────────────────────────────────────

export interface CounterIndicatorEntry {
  outcome_id: string;
  outcome_name: string;
  counter_indicator: string;
  rationale: string;
}

/** Optional per-outcome primary indicators (from causal_chain).
 *  When provided, the panel renders the "yang vs yin" pairing with
 *  primary set on the left, counter on the right. When omitted,
 *  panel still renders the counter side standalone. */
export interface PrimaryIndicatorSet {
  outcome_id: string;
  outcome_name: string;
  primary_indicators: string[];
}

interface Props {
  /** Counter-indicators from effectiveness_envelope. Empty array
   *  hides the panel entirely (don't render an empty surface). */
  counterIndicators: CounterIndicatorEntry[];
  /** Optional primary-indicator context per outcome — when present
   *  the panel renders the side-by-side "primary | counter" pairing.
   *  Caller pulls these from outcome entities' causal_chain.indicators. */
  primarySets?: PrimaryIndicatorSet[];
  /** Compact mode for embedding in the Strategy Brief. */
  compact?: boolean;
}

// ── Component ─────────────────────────────────────────────────────

export function GoodhartPairingsPanel({
  counterIndicators,
  primarySets,
  compact = false,
}: Props) {
  if (counterIndicators.length === 0) return null;

  // Group by outcome — there's typically one counter per outcome but
  // we group defensively so future expansions (multiple counters per
  // outcome) render cleanly without restructuring.
  const byOutcome = new Map<
    string,
    {
      outcome_id: string;
      outcome_name: string;
      counters: CounterIndicatorEntry[];
      primary?: string[];
    }
  >();
  for (const c of counterIndicators) {
    const entry = byOutcome.get(c.outcome_id) ?? {
      outcome_id: c.outcome_id,
      outcome_name: c.outcome_name,
      counters: [],
    };
    entry.counters.push(c);
    byOutcome.set(c.outcome_id, entry);
  }
  // Cross-reference primary sets if provided.
  for (const p of primarySets ?? []) {
    const entry = byOutcome.get(p.outcome_id);
    if (entry) entry.primary = p.primary_indicators;
  }

  const pad = compact ? "px-2.5 py-2" : "px-3.5 py-3";
  const headerSize = compact ? "10.5px" : "11px";
  const bodySize = compact ? "11.5px" : "12.5px";

  return (
    <div
      className="rounded-2xl border"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        fontFamily: appleVibe.font.stack,
      }}
    >
      <div
        className={`border-b ${pad}`}
        style={{ borderColor: appleVibe.stroke.hairline }}
      >
        <div className="flex items-baseline gap-1.5">
          <span aria-hidden style={{ fontSize: "13px" }}>
            ⚖️
          </span>
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Goodhart Pairings
          </span>
          <span
            className="ml-1.5 text-[9.5px] italic"
            style={{ color: appleVibe.text.faint }}
          >
            counter-indicators to track alongside the primary set
          </span>
        </div>
        <p
          className="mt-1 text-[11px] font-light italic leading-snug"
          style={{ color: appleVibe.text.tertiary }}
        >
          Optimizing a single proxy invites gaming. Each outcome gets one
          opposing measure that should hold steady or improve alongside
          the primary set — when the counter degrades while the primary
          climbs, you're Goodharting.
        </p>
      </div>

      <div className={`space-y-3 ${pad}`}>
        {Array.from(byOutcome.values()).map((entry) => (
          <div
            key={entry.outcome_id}
            className="rounded-xl"
            style={{
              background: appleVibe.surface.chip,
              border: `1px solid ${appleVibe.stroke.hairline}`,
              padding: compact ? "8px 10px" : "10px 12px",
            }}
          >
            <div
              className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: appleVibe.text.secondary }}
            >
              Outcome: {entry.outcome_name}
            </div>

            {/* Primary | Counter pairing. Two columns when primary is
                known; single counter column otherwise. */}
            <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
              {entry.primary && entry.primary.length > 0 && (
                <div
                  className="flex-1 rounded-lg"
                  style={{
                    background: appleVibe.surface.cardElevated,
                    border: `1px solid ${appleVibe.stroke.hairline}`,
                    padding: compact ? "6px 8px" : "8px 10px",
                  }}
                >
                  <div
                    className="mb-1 text-[9px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Primary indicators
                  </div>
                  <ul className="space-y-0.5">
                    {entry.primary.map((p, i) => (
                      <li
                        key={`${entry.outcome_id}-p-${i}`}
                        className="flex items-start gap-1.5"
                        style={{
                          fontSize: bodySize,
                          color: appleVibe.text.primary,
                          fontWeight: 500,
                        }}
                      >
                        <span
                          className="mt-1.5 inline-block h-1 w-1 flex-shrink-0 rounded-full"
                          style={{ background: appleVibe.stage.outcomes }}
                          aria-hidden
                        />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* The pairing-glyph divider. Renders only when both
                  sides are present. Subtle "↔" between columns so
                  the yang/yin relationship is visually load-bearing. */}
              {entry.primary && entry.primary.length > 0 && (
                <div
                  className="flex flex-shrink-0 items-center justify-center"
                  style={{ minWidth: "20px", fontSize: headerSize }}
                  aria-hidden
                >
                  <span
                    style={{
                      color: appleVibe.text.faint,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                    }}
                  >
                    ↔
                  </span>
                </div>
              )}

              <div
                className="flex-1 rounded-lg"
                style={{
                  background: `${appleVibe.stage.objective}10`,
                  border: `1px solid ${appleVibe.stage.objective}30`,
                  padding: compact ? "6px 8px" : "8px 10px",
                }}
              >
                <div
                  className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  <span aria-hidden>🎯</span>
                  <span>Counter-indicator</span>
                </div>
                <ul className="space-y-1.5">
                  {entry.counters.map((c, i) => (
                    <li
                      key={`${entry.outcome_id}-c-${i}`}
                      className="flex flex-col"
                    >
                      <span
                        style={{
                          fontSize: bodySize,
                          color: appleVibe.text.primary,
                          fontWeight: 600,
                        }}
                      >
                        {c.counter_indicator}
                      </span>
                      {c.rationale && (
                        <span
                          className="mt-0.5 italic leading-snug"
                          style={{
                            fontSize: compact ? "11px" : "12px",
                            color: appleVibe.text.secondary,
                          }}
                        >
                          {c.rationale}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
