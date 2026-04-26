"use client";

/**
 * ConditionalGatePanel — audit surface for the heuristic gate resolver.
 *
 * Phase 4 §5.4 added a heuristic that reads each conditional edge's
 * prose `conditions` text and converts it to a numeric Bernoulli gate
 * (always→1.0, usually→0.78, sometimes→0.5, rarely→0.22, never→0.05,
 * etc.). The Monte Carlo engine consumes the gate; the user otherwise
 * never sees the verdict.
 *
 * This component closes that loop. When the per-app simulation pass
 * ran on at least one conditional edge, app.state.simulation_distribution
 * .gate_decisions[] contains the per-edge audit rows. We render them
 * here as a collapsed accordion under the app's twin slice — small
 * footprint, opt-in detail.
 *
 * Rendered with `null` (no panel) when:
 *   - simulation_distribution is missing
 *   - gate_decisions is missing or empty
 * — i.e. no rigor to audit, so no panel.
 *
 * Entity-name lookup is optional. Without it we fall back to short
 * uuids. Names come from the same signatureEntities source the
 * SpacePlanDrawer uses, so re-uses the existing fetch on the page.
 */

import { useState } from "react";

type GateSource =
  | "always"
  | "usually"
  | "sometimes"
  | "rarely"
  | "never"
  | "conditional"
  | "confidence_fallback"
  | "default_neutral";

interface GateRow {
  source_id: string;
  target_id: string;
  gate: number;
  source: GateSource;
  certainty: number;
  condition_text: string | null;
}

interface ConditionalGatePanelProps {
  decisions: GateRow[] | null | undefined;
  /** Optional id→name map; falls back to `node abc12345` style. */
  entityNamesById?: Record<string, string>;
}

// Color palette matched to the gate ranges. We render the source label
// (always/usually/etc.) as a coloured chip so the user can scan a
// long list of edges and immediately see the high-firing ones in green
// and the rarely-firing ones in red — without doing arithmetic on the
// gate number.
const SOURCE_PALETTE: Record<GateSource, { bg: string; fg: string; label: string }> = {
  always: { bg: "rgba(52,199,89,0.16)", fg: "#1f7a3a", label: "Always" },
  usually: { bg: "rgba(48,176,199,0.16)", fg: "#0a6577", label: "Usually" },
  sometimes: { bg: "rgba(255,159,10,0.18)", fg: "#7a4400", label: "Sometimes" },
  rarely: { bg: "rgba(255,69,58,0.16)", fg: "#892017", label: "Rarely" },
  never: { bg: "rgba(120,120,128,0.18)", fg: "#3a3a3c", label: "Never" },
  conditional: { bg: "rgba(120,120,255,0.18)", fg: "#2a2a8a", label: "Conditional" },
  confidence_fallback: {
    bg: "rgba(120,120,128,0.10)",
    fg: "#6b6b6f",
    label: "Confidence fallback",
  },
  default_neutral: {
    bg: "rgba(120,120,128,0.08)",
    fg: "#86868b",
    label: "Default neutral",
  },
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

function labelFor(id: string, names?: Record<string, string>): string {
  return names?.[id] ?? `node ${shortId(id)}`;
}

export function ConditionalGatePanel({
  decisions,
  entityNamesById,
}: ConditionalGatePanelProps) {
  const [open, setOpen] = useState(false);

  const rows = Array.isArray(decisions) ? decisions : [];
  if (rows.length === 0) return null;

  // Sort by gate ascending — shaky/rare gates first, since those are
  // the ones the user most needs to interrogate ("does this edge really
  // only fire 22% of the time?"). High-confidence always-gates rarely
  // need scrutiny.
  const sorted = [...rows].sort((a, b) => a.gate - b.gate);

  return (
    <div className="rounded-2xl border border-black/5 bg-white/60 p-4">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-fg,#6b7280)]">
            Conditional gates · {rows.length}
          </div>
          <div className="mt-0.5 text-[13px] font-medium text-[color:var(--fg,#1d1d1f)]">
            How often does each conditional edge fire in this chain?
          </div>
        </div>
        <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-1.5">
          {sorted.map((row, i) => {
            const palette = SOURCE_PALETTE[row.source];
            const pct = Math.round(row.gate * 100);
            const lowCertainty = row.certainty < 0.8;
            return (
              <div
                key={`${row.source_id}-${row.target_id}-${i}`}
                className="rounded-lg border border-black/5 bg-white px-3 py-2"
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
                    style={{ background: palette.bg, color: palette.fg }}
                  >
                    {palette.label}
                  </span>
                  <span className="text-[12px] font-semibold tabular-nums text-[color:var(--fg,#1d1d1f)]">
                    {pct}%
                  </span>
                  {lowCertainty && (
                    <span
                      className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-medium text-amber-800"
                      title={`Resolver certainty ${row.certainty.toFixed(2)} — verdict came from a fallback path, treat with care`}
                    >
                      low certainty
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11.5px] text-[color:var(--fg,#1d1d1f)]">
                  <span className="font-medium">
                    {labelFor(row.source_id, entityNamesById)}
                  </span>
                  <span className="mx-1.5 text-[color:var(--muted-fg,#86868b)]">→</span>
                  <span className="font-medium">
                    {labelFor(row.target_id, entityNamesById)}
                  </span>
                </div>
                {row.condition_text && (
                  <div className="mt-1 text-[10.5px] italic text-[color:var(--muted-fg,#6b7280)]">
                    “{row.condition_text}”
                  </div>
                )}
              </div>
            );
          })}
          <div className="pt-1 text-[10px] text-[color:var(--muted-fg,#86868b)]">
            Verdicts come from a heuristic resolver (lexical hedging tokens
            like “usually”, “only if”, “rarely”). Low-certainty rows
            fell back to edge confidence.
          </div>
        </div>
      )}
    </div>
  );
}
