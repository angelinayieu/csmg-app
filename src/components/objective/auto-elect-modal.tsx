"use client";

// ── Auto-elect Ambiguity Modal ─────────────────────────────────────
//
// Surfaces the mechanisms the AI flagged as "ambiguous, ask the user."
// Each section is one mechanism with side-by-side variation cards. The
// user picks (single or multi depending on the variation kinds), then
// clicks "Apply + generate" — the strip pipes the resolutions back
// through /auto-elect/apply, then chains into "Generate pending."
//
// Visuals: full-screen overlay with a centered card, scrollable body.
// Each variation card shows name + score + method badge + description
// + tradeoff, with a clear "Suggested" pill on the AI's default pick.
// Multi-select shows checkboxes, single-select shows radios.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  HelpCircle,
  Loader2,
  Wand2,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { Sparkle } from "@/components/objective/icons/sparkle";

interface AutoElectChoice {
  variation_id: string;
  variation_name: string;
  description: string;
  tradeoff: string;
  kind: "alternative" | "additive" | "principle";
  effectiveness_score?: number;
  evaluation_method?:
    | "heuristic"
    | "rubric"
    | "evidence"
    | "simulation"
    | "tested"
    | "ensemble";
}

export interface MechanismDecision {
  entity_id: string;
  entity_name: string;
  sub_objective_id: string;
  sub_objective_title: string;
  status: "confident" | "ambiguous" | "skipped";
  elections: string[];
  ambiguity?: {
    reason: "close_scores" | "low_confidence" | "mixed_kinds" | "unscored";
    explainer: string;
    choices: AutoElectChoice[];
    selection: "single" | "multi";
    suggested_default: string[];
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Confident auto-elections — folded into the final apply payload
   *  as-is, no user picking needed. Shown in the header summary. */
  confident: MechanismDecision[];
  /** Ambiguous decisions the user must resolve. */
  ambiguous: MechanismDecision[];
  /** Mechanisms with existing elections — surfaced as a small note so
   *  the user sees what's being skipped. */
  skipped: MechanismDecision[];
  /** Called when the user clicks "Apply + generate". Receives the
   *  final elections array (confident + user-resolved ambiguous).
   *  Modal closes itself after the callback resolves. */
  onApply: (
    elections: Array<{ entity_id: string; variation_ids: string[] }>,
  ) => Promise<void>;
}

export function AutoElectModal({
  open,
  onClose,
  confident,
  ambiguous,
  skipped,
  onApply,
}: Props) {
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  // Per-mechanism selection state — keyed by entity_id. Seeded with
  // the AI's suggested default on first render so the user can hit
  // "Apply" instantly to accept defaults.
  const [selections, setSelections] = useState<Record<string, Set<string>>>(
    () => {
      const initial: Record<string, Set<string>> = {};
      for (const a of ambiguous) {
        initial[a.entity_id] = new Set(a.ambiguity?.suggested_default ?? []);
      }
      return initial;
    },
  );

  // Re-seed when the ambiguous list changes (re-fetch).
  useEffect(() => {
    const next: Record<string, Set<string>> = {};
    for (const a of ambiguous) {
      next[a.entity_id] = new Set(a.ambiguity?.suggested_default ?? []);
    }
    setSelections(next);
  }, [ambiguous]);

  const toggle = useCallback(
    (entityId: string, variationId: string, selection: "single" | "multi") => {
      setSelections((prev) => {
        const curr = new Set(prev[entityId] ?? []);
        if (selection === "single") {
          curr.clear();
          curr.add(variationId);
        } else {
          if (curr.has(variationId)) curr.delete(variationId);
          else curr.add(variationId);
        }
        return { ...prev, [entityId]: curr };
      });
    },
    [],
  );

  const totalElectionsPlanned = useMemo(() => {
    const fromConfident = confident.reduce((n, d) => n + d.elections.length, 0);
    const fromUser = Object.values(selections).reduce(
      (n, set) => n + set.size,
      0,
    );
    return fromConfident + fromUser;
  }, [confident, selections]);

  const handleApply = useCallback(async () => {
    setBusy(true);
    try {
      const payload: Array<{ entity_id: string; variation_ids: string[] }> = [];
      // Confident → straight through.
      for (const d of confident) {
        if (d.elections.length > 0) {
          payload.push({
            entity_id: d.entity_id,
            variation_ids: d.elections,
          });
        }
      }
      // Ambiguous → use the user's resolution (or AI default if
      // they didn't touch it).
      for (const a of ambiguous) {
        const set = selections[a.entity_id] ?? new Set<string>();
        const ids = Array.from(set);
        if (ids.length > 0) {
          payload.push({ entity_id: a.entity_id, variation_ids: ids });
        }
      }
      await onApply(payload);
    } finally {
      setBusy(false);
    }
  }, [confident, ambiguous, selections, onApply]);

  // ── Render ──
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(15,23,42,0.36)", backdropFilter: "blur(4px)" }}
            aria-hidden
          />
          {/* Modal card */}
          <motion.div
            role="dialog"
            aria-label="Auto-elect — needs your input"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.985 }}
            transition={{ duration: reduce ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
          >
            <div
              className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl"
              style={{
                background: appleVibe.surface.card,
                border: `1px solid ${appleVibe.stroke.hairline}`,
                boxShadow: "0 30px 60px -12px rgba(11,18,40,0.32)",
                fontFamily: appleVibe.font.stack,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <header
                className="flex items-center justify-between gap-3 px-6 py-5"
                style={{
                  borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)",
                }}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    <Wand2
                      className="h-3 w-3"
                      strokeWidth={2.2}
                      style={{ color: appleVibe.accent.primary }}
                    />
                    Auto-elect — needs your input
                  </div>
                  <h2
                    className="mt-1 truncate text-[20px] font-semibold leading-tight tracking-tight"
                    style={{
                      color: appleVibe.text.primary,
                      fontFamily: appleVibe.font.display,
                      letterSpacing: "-0.015em",
                    }}
                  >
                    {confident.length} ready · {ambiguous.length} need your call
                    {skipped.length > 0 && ` · ${skipped.length} skipped`}
                  </h2>
                  <p
                    className="mt-1 text-[12.5px] font-light leading-snug"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    The AI is confident on {confident.length} mechanism
                    {confident.length === 1 ? "" : "s"} and wants your judgment on the rest.
                    Pick what to elect, then click apply — confident picks fold in automatically.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.04)]"
                  aria-label="Close"
                  style={{ color: appleVibe.text.secondary }}
                >
                  <X className="h-4 w-4" strokeWidth={2} />
                </button>
              </header>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {ambiguous.length === 0 ? (
                  <EmptyAmbiguousState confident={confident.length} />
                ) : (
                  <div className="flex flex-col gap-5">
                    {ambiguous.map((a) => (
                      <AmbiguousMechanismSection
                        key={a.entity_id}
                        mechanism={a}
                        selectedIds={selections[a.entity_id] ?? new Set<string>()}
                        onToggle={(vid) =>
                          toggle(
                            a.entity_id,
                            vid,
                            a.ambiguity?.selection ?? "single",
                          )
                        }
                      />
                    ))}
                  </div>
                )}

                {skipped.length > 0 && (
                  <div
                    className="mt-5 rounded-2xl px-4 py-3"
                    style={{
                      background: appleVibe.surface.cardElevated,
                      border: `1px dashed ${appleVibe.stroke.medium}`,
                    }}
                  >
                    <div
                      className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      <HelpCircle className="h-3 w-3" strokeWidth={2.2} />
                      Skipped — you already elected here ({skipped.length})
                    </div>
                    <ul
                      className="mt-1.5 text-[11.5px] font-light leading-snug"
                      style={{ color: appleVibe.text.secondary }}
                    >
                      {skipped.slice(0, 6).map((s) => (
                        <li key={s.entity_id}>
                          · {s.entity_name} · {s.sub_objective_title}
                        </li>
                      ))}
                      {skipped.length > 6 && (
                        <li className="italic">
                          + {skipped.length - 6} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>

              {/* Footer */}
              <footer
                className="flex items-center justify-between gap-3 px-6 py-4"
                style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
              >
                <span
                  className="text-[11.5px] font-light"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {totalElectionsPlanned} election
                  {totalElectionsPlanned === 1 ? "" : "s"} to apply (
                  {confident.reduce((n, d) => n + d.elections.length, 0)} auto +{" "}
                  {Object.values(selections).reduce((n, s) => n + s.size, 0)} chosen)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    className="inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold"
                    style={{
                      background: "transparent",
                      color: appleVibe.text.tertiary,
                      border: `1px solid ${appleVibe.stroke.medium}`,
                    }}
                  >
                    Cancel
                  </button>
                  <motion.button
                    type="button"
                    onClick={() => void handleApply()}
                    disabled={busy || totalElectionsPlanned === 0}
                    whileHover={busy ? undefined : { y: -1, transition: { duration: 0.15 } }}
                    whileTap={busy ? undefined : { y: 0.5, transition: { duration: 0.08 } }}
                    className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[11.5px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: appleVibe.accent.primary,
                      color: appleVibe.text.onAccent,
                      boxShadow: appleVibe.shadow.chip,
                    }}
                  >
                    {busy ? (
                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
                    ) : (
                      <Sparkle className="h-3 w-3" strokeWidth={2.4} />
                    )}
                    {busy ? "Applying…" : "Apply + generate"}
                  </motion.button>
                </div>
              </footer>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Sections ─────────────────────────────────────────────────────

function EmptyAmbiguousState({ confident }: { confident: number }) {
  return (
    <div
      className="rounded-2xl px-5 py-8 text-center"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px dashed ${appleVibe.stroke.medium}`,
      }}
    >
      <div
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full"
        style={{
          background: `${appleVibe.stage.outcomes}14`,
          color: appleVibe.stage.outcomes,
        }}
      >
        <Check className="h-5 w-5" strokeWidth={2.4} />
      </div>
      <p
        className="mt-3 text-[13px] font-semibold"
        style={{ color: appleVibe.text.primary }}
      >
        No ambiguous calls
      </p>
      <p
        className="mt-1 text-[11.5px] font-light"
        style={{ color: appleVibe.text.tertiary }}
      >
        The AI is confident on all {confident} mechanism{confident === 1 ? "" : "s"}. Click apply
        and it'll fire generation across the canvas.
      </p>
    </div>
  );
}

function AmbiguousMechanismSection({
  mechanism,
  selectedIds,
  onToggle,
}: {
  mechanism: MechanismDecision;
  selectedIds: Set<string>;
  onToggle: (variationId: string) => void;
}) {
  const choices = mechanism.ambiguity?.choices ?? [];
  const selection = mechanism.ambiguity?.selection ?? "single";
  const suggestedDefault = new Set(mechanism.ambiguity?.suggested_default ?? []);
  return (
    <section
      className="rounded-2xl px-4 py-3.5"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
      }}
    >
      <header className="mb-2">
        <h3
          className="text-[14px] font-semibold leading-tight tracking-tight"
          style={{ color: appleVibe.text.primary, letterSpacing: "-0.01em" }}
        >
          {mechanism.entity_name}
        </h3>
        <p
          className="mt-0.5 text-[11px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          {mechanism.sub_objective_title}
        </p>
        <p
          className="mt-1.5 text-[11.5px] leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {mechanism.ambiguity?.explainer}
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {choices.map((c) => (
          <VariationChoiceCard
            key={c.variation_id}
            choice={c}
            selected={selectedIds.has(c.variation_id)}
            suggested={suggestedDefault.has(c.variation_id)}
            selection={selection}
            onToggle={() => onToggle(c.variation_id)}
          />
        ))}
      </ul>
    </section>
  );
}

function VariationChoiceCard({
  choice,
  selected,
  suggested,
  selection,
  onToggle,
}: {
  choice: AutoElectChoice;
  selected: boolean;
  suggested: boolean;
  selection: "single" | "multi";
  onToggle: () => void;
}) {
  const accent = selected
    ? appleVibe.accent.primary
    : appleVibe.stroke.hairline;
  return (
    <li
      className="cursor-pointer transition-[background,border-color] duration-150 ease-out"
      onClick={onToggle}
      style={{
        background: selected
          ? `${appleVibe.accent.primary}06`
          : appleVibe.surface.cardElevated,
        border: `1px solid ${accent}${selected ? "" : "60"}`,
        borderLeft: `3px solid ${selected ? appleVibe.accent.primary : appleVibe.stroke.medium}`,
        borderRadius: appleVibe.radius.md,
        padding: "10px 12px",
      }}
    >
      <div className="flex items-start gap-3">
        <SelectionIndicator selected={selected} selection={selection} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span
              className="text-[12.5px] font-semibold"
              style={{ color: appleVibe.text.primary }}
            >
              {choice.variation_name}
            </span>
            {suggested && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.10em]"
                style={{
                  background: `${appleVibe.accent.primary}14`,
                  color: appleVibe.accent.primary,
                }}
              >
                <Sparkle className="h-2 w-2" strokeWidth={2.5} />
                Suggested
              </span>
            )}
            <span
              className="text-[9.5px] font-medium uppercase tracking-[0.10em]"
              style={{ color: appleVibe.text.tertiary }}
            >
              {choice.kind}
            </span>
            {typeof choice.effectiveness_score === "number" && (
              <span
                className="ml-auto text-[10.5px] font-mono font-semibold tabular-nums"
                style={{ color: appleVibe.text.secondary }}
              >
                {(choice.effectiveness_score * 100).toFixed(0)}/100
                {choice.evaluation_method ? ` · ${choice.evaluation_method}` : ""}
              </span>
            )}
          </div>
          {choice.description && (
            <p
              className="mt-1 text-[11.5px] leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              {choice.description}
            </p>
          )}
          {choice.tradeoff && (
            <p
              className="mt-1 text-[11px] font-light italic leading-snug"
              style={{ color: appleVibe.text.tertiary }}
            >
              Tradeoff: {choice.tradeoff}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function SelectionIndicator({
  selected,
  selection,
}: {
  selected: boolean;
  selection: "single" | "multi";
}) {
  if (selection === "single") {
    // Radio
    return (
      <div
        className="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full transition-colors"
        style={{
          background: selected ? appleVibe.accent.primary : "transparent",
          border: `1.5px solid ${selected ? appleVibe.accent.primary : appleVibe.stroke.medium}`,
        }}
      >
        {selected && (
          <span
            className="block h-1.5 w-1.5 rounded-full"
            style={{ background: "#ffffff" }}
          />
        )}
      </div>
    );
  }
  // Checkbox
  return (
    <div
      className="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center transition-colors"
      style={{
        background: selected ? appleVibe.accent.primary : "transparent",
        border: `1.5px solid ${selected ? appleVibe.accent.primary : appleVibe.stroke.medium}`,
        borderRadius: "4px",
      }}
    >
      {selected && (
        <Check className="h-2.5 w-2.5" strokeWidth={3} color="#ffffff" />
      )}
    </div>
  );
}
