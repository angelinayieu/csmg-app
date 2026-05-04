"use client";

// ── Tactic provenance chips ─────────────────────────────────────────────
//
// Renders the four provenance backlinks every micro-tactic carries — which
// axioms it respects, which insight convergences it addresses, which
// strategy-coverage gaps it closes, and which assumption inversions it
// stress-tests. The strategy LLM populates these arrays under the Phase 4
// "every signal has a UI surface" rule; before this component existed they
// were produced + validated + persisted but never rendered.
//
// Visual rules:
//   - All four chips are always rendered, even when the array is empty.
//     A "0" chip is informational — a tactic that respects no axioms is a
//     quality signal worth seeing, not noise to hide.
//   - Hover surfaces the resolved labels (axiom claim, convergence concern,
//     gap label, inverted assumption) when synthData is available; falls
//     back to the raw IDs when it isn't.
//   - Empty chips render in muted gray; populated chips pick up a category
//     accent color. No emoji — chips read like data, not decoration.
//
// Cross-linking back to the convergence-gallery / axiom-list views is a v2
// polish item; v1 just surfaces the data.

import type { MicroTactic } from "@/types/strategy";
import type { SynthesisData } from "@/types/synthesis";

interface TacticProvenanceChipsProps {
  tactic: MicroTactic;
  /** When provided, chips show resolved label text on hover. Without it,
   *  hover falls back to the raw ID list — still useful for debugging
   *  but less readable. */
  synthData?: SynthesisData | null;
}

interface ChipConfig {
  label: string;
  ids: string[];
  resolveLabel: (id: string) => string;
  /** Color for the populated state (count > 0). Empty state is always muted. */
  accentClass: string;
}

export function TacticProvenanceChips({ tactic, synthData }: TacticProvenanceChipsProps) {
  const axiomRespectedIds = tactic.axiom_ids_respected ?? [];
  const axiomChallengedIds = tactic.axiom_ids_challenged ?? [];
  const convIds = tactic.convergence_ids_addressed ?? [];
  const gapIds = tactic.coverage_gap_ids_closed ?? [];
  const invIds = tactic.inversion_ids_tested ?? [];
  const hiddenSignalIds = tactic.hidden_signal_refs ?? [];

  // If the tactic has no provenance fields at all, skip rendering — likely a
  // legacy strategy generated before comprehensive mode landed. We don't
  // want to spam zeros across every legacy row.
  const hasAnyField =
    tactic.axiom_ids_respected !== undefined ||
    tactic.axiom_ids_challenged !== undefined ||
    tactic.convergence_ids_addressed !== undefined ||
    tactic.coverage_gap_ids_closed !== undefined ||
    tactic.inversion_ids_tested !== undefined ||
    tactic.hidden_signal_refs !== undefined;
  if (!hasAnyField) return null;

  const truncate = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  const resolveAxiom = (id: string) => {
    const a = synthData?.axioms?.find((x) => x.axiom_id === id);
    return a ? `${id}: ${truncate(a.claim)}` : id;
  };
  const resolveConvergence = (id: string) => {
    const c = synthData?.insight_convergences?.find((x) => x.cluster_id === id);
    return c ? `${id}: ${truncate(c.concern_label)}` : id;
  };
  const resolveGap = (id: string) => {
    const g = synthData?.strategy_coverage?.gaps?.find((x) => x.id === id);
    return g ? `${id}: ${truncate(g.label)}` : id;
  };
  const resolveInversion = (id: string) => {
    // Inversion IDs use the format "inv0", "inv1", ... — positional indices
    // into synthData.assumption_inversions. We parse the index and resolve
    // by array position rather than a string id field on the inversion.
    const m = id.match(/^inv(\d+)$/i);
    if (!m) return id;
    const idx = parseInt(m[1], 10);
    const inv = synthData?.assumption_inversions?.[idx];
    return inv ? `${id}: ${truncate(inv.original_assumption)}` : id;
  };
  const resolveHiddenSignal = (slug: string) => {
    // hidden_signal_refs are slugs of HiddenSignalData.signal_name. We try a
    // direct signal_name match first, then a normalized comparison (lowercase,
    // non-alphanum collapsed) so an LLM that emitted "missing-metric-x"
    // resolves against signal_name "Missing metric X".
    const signals = synthData?.hidden_signals;
    if (!signals?.length) return slug;
    const direct = signals.find((s) => s.signal_name === slug);
    if (direct) return `${slug}: ${truncate(direct.description)}`;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const want = norm(slug);
    const fuzzy = signals.find((s) => norm(s.signal_name) === want);
    return fuzzy ? `${slug}: ${truncate(fuzzy.description)}` : slug;
  };

  const chips: ChipConfig[] = [
    {
      label: "axioms respected",
      ids: axiomRespectedIds,
      resolveLabel: resolveAxiom,
      accentClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    {
      label: "axioms challenged",
      ids: axiomChallengedIds,
      resolveLabel: resolveAxiom,
      accentClass: "bg-violet-50 text-violet-700 border-violet-200",
    },
    {
      label: "convergences addressed",
      ids: convIds,
      resolveLabel: resolveConvergence,
      accentClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    {
      label: "gaps closed",
      ids: gapIds,
      resolveLabel: resolveGap,
      accentClass: "bg-amber-50 text-amber-700 border-amber-200",
    },
    {
      label: "inversions tested",
      ids: invIds,
      resolveLabel: resolveInversion,
      accentClass: "bg-rose-50 text-rose-700 border-rose-200",
    },
    {
      label: "hidden signals",
      ids: hiddenSignalIds,
      resolveLabel: resolveHiddenSignal,
      accentClass: "bg-sky-50 text-sky-700 border-sky-200",
    },
  ];

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {chips.map(({ label, ids, resolveLabel, accentClass }) => {
        const populated = ids.length > 0;
        // Hover content: each ID on its own line with resolved label when
        // available. We use the native `title` attribute — multi-line is
        // supported via \n on most platforms and avoids a dependency on a
        // popover library. When the chip is empty we say so plainly.
        const title = populated
          ? `${label} (${ids.length}):\n${ids.map(resolveLabel).join("\n")}`
          : `No ${label} on this tactic — possibly a coverage gap`;
        return (
          <span
            key={label}
            title={title}
            className={
              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium " +
              (populated
                ? accentClass
                : "bg-gray-50 text-gray-400 border-gray-200")
            }
          >
            <span className="tabular-nums font-semibold">{ids.length}</span>
            <span>{label}</span>
          </span>
        );
      })}
    </div>
  );
}
