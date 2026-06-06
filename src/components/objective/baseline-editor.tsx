"use client";

// ── Baseline Editor ───────────────────────────────────────────────
//
// Phase 11.6c — modal sheet for setting baseline + target values on
// an outcome's proxy indicators. Mounted from the OutcomeCard's
// expanded body (single mount point keeps the surface contained).
//
// One row per indicator. Each row has four inline fields:
//
//   • baseline_value     — current measurement (string, free-form)
//   • target_value       — where the user wants to land
//   • unit               — short label ("minutes/day", "bpm")
//   • measurement_method — how they'll measure it
//
// Why all four as strings: baselines can be numbers ("72"),
// percentages ("85%"), self-ratings ("8/10"), or qualitative
// ("low"). Forcing a numeric type would break the qualitative
// use case the user explicitly named (anxiety baseline as 8/10).
// The downstream scorer interprets the string in context of unit
// + measurement_method.
//
// Save semantics:
//   • One POST per row that the user touched (we track dirty state).
//   • Untouched rows skip the network round-trip.
//   • Each successful POST returns the canonical indicator name +
//     the persisted record; the local state mirrors that so reloads
//     hit cache.
//
// Soft-fail per row — if one indicator's save fails, the modal
// surfaces the error inline and lets the user retry. Other rows
// stay saved.

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { appleVibe, withAlpha } from "@/lib/apple-vibe-tokens";

interface IndicatorBaselineRecord {
  baseline_value?: string;
  target_value?: string;
  unit?: string;
  measurement_method?: string;
  source: "user" | "llm";
  updated_at: string;
}

interface RowState extends Partial<IndicatorBaselineRecord> {
  /** Whether this row has been changed since open. Skip-saves clean rows. */
  dirty: boolean;
  /** Per-row save status — drives the inline ✓ / spinner / error. */
  status: "idle" | "saving" | "saved" | "error";
  errorMessage?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The outcome entity id. */
  entityId: string;
  /** Outcome name — rendered as the modal header. */
  entityName: string;
  /** The outcome's proxy indicators (names only). */
  indicators: string[];
  /** Existing baseline records keyed by indicator name. Empty when
   *  no baselines have been set yet. The editor pre-fills inputs
   *  from this map. */
  existingBaselines?: Record<string, IndicatorBaselineRecord>;
  /** Called when the user saves any row successfully — caller can
   *  optimistically refresh their local copy of the outcome's
   *  causal_chain.indicator_baselines. */
  onSaved?: (indicatorName: string, record: IndicatorBaselineRecord) => void;
}

export function BaselineEditor({
  open,
  onClose,
  entityId,
  entityName,
  indicators,
  existingBaselines = {},
  onSaved,
}: Props) {
  const reduce = useReducedMotion();
  const [rows, setRows] = useState<Record<string, RowState>>({});

  // ── Seed local row state from existingBaselines on open ──
  // Re-runs when the modal opens OR the prop changes. Keeps the
  // editor's source of truth aligned with the outcome card's data
  // without forcing the user to re-enter values they already saved.
  useEffect(() => {
    if (!open) return;
    const seed: Record<string, RowState> = {};
    for (const name of indicators) {
      const existing = existingBaselines[name];
      seed[name] = {
        baseline_value: existing?.baseline_value,
        target_value: existing?.target_value,
        unit: existing?.unit,
        measurement_method: existing?.measurement_method,
        source: existing?.source ?? "user",
        dirty: false,
        status: "idle",
      };
    }
    setRows(seed);
  }, [open, indicators, existingBaselines]);

  // ── ESC closes the modal ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Edit a single field on a single row. Mark the row dirty so the
  // save loop knows to POST it.
  function patchRow(name: string, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [name]: {
        ...prev[name],
        ...patch,
        dirty: true,
      },
    }));
  }

  async function saveOne(name: string) {
    const row = rows[name];
    if (!row || !row.dirty) return;
    setRows((prev) => ({
      ...prev,
      [name]: { ...prev[name], status: "saving", errorMessage: undefined },
    }));
    try {
      const res = await fetch(
        `/api/brainstorm/item/${entityId}/baseline`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            indicator_name: name,
            baseline_value: row.baseline_value,
            target_value: row.target_value,
            unit: row.unit,
            measurement_method: row.measurement_method,
            source: "user",
          }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setRows((prev) => ({
          ...prev,
          [name]: {
            ...prev[name],
            status: "error",
            errorMessage: j.error ?? "Couldn't save.",
          },
        }));
        return;
      }
      const j = (await res.json()) as {
        indicator_name: string;
        record: IndicatorBaselineRecord;
      };
      setRows((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          status: "saved",
          dirty: false,
        },
      }));
      onSaved?.(j.indicator_name, j.record);
    } catch (err) {
      setRows((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          status: "error",
          errorMessage:
            err instanceof Error ? err.message : "Network error.",
        },
      }));
    }
  }

  // Save all dirty rows in parallel. Soft-fail per row — one row's
  // failure doesn't block the others (they each get their own
  // status indicator). Disabled when no dirty rows exist so the
  // button can't fire a no-op.
  async function saveAll() {
    const dirtyNames = Object.entries(rows)
      .filter(([, row]) => row.dirty)
      .map(([name]) => name);
    await Promise.all(dirtyNames.map((name) => saveOne(name)));
  }

  const dirtyCount = useMemo(
    () => Object.values(rows).filter((r) => r.dirty).length,
    [rows],
  );

  if (indicators.length === 0) {
    // The outcome has no indicators — guard against opening on an
    // outcome that wasn't generated with the Phase 8 indicators[]
    // field populated. Render nothing rather than an empty modal.
    return null;
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(15,23,42,0.32)" }}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-label={`Set baselines for ${entityName}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: reduce ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl"
            style={{
              background: appleVibe.surface.card,
              border: `1px solid ${appleVibe.stroke.hairline}`,
              boxShadow: "0 24px 64px -16px rgba(11,18,40,0.32)",
              fontFamily: appleVibe.font.stack,
            }}
          >
            {/* Header */}
            <header
              className="flex items-center justify-between gap-3 px-6 py-4"
              style={{ borderBottom: `1px solid ${appleVibe.stroke.hairline}` }}
            >
              <div className="min-w-0 flex-1">
                <div
                  className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Indicator baselines
                </div>
                <h2
                  className="mt-1 truncate text-[16px] font-semibold leading-tight tracking-tight"
                  style={{
                    color: appleVibe.text.primary,
                    fontFamily: appleVibe.font.display,
                    letterSpacing: "-0.015em",
                  }}
                  title={entityName}
                >
                  {entityName}
                </h2>
                <p
                  className="mt-0.5 text-[11px] font-light leading-snug"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Set the current measurement + target for each proxy.
                  The scorer reads these as ground truth when reasoning
                  about projected delta. Strings — numbers, percentages,
                  or self-ratings all work.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.04)]"
                aria-label="Close baseline editor"
                style={{ color: appleVibe.text.secondary }}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </header>

            {/* Scrollable body — one section per indicator */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <ul className="space-y-3">
                {indicators.map((name) => {
                  const row = rows[name];
                  if (!row) return null;
                  return (
                    <li
                      key={name}
                      className="rounded-xl p-3"
                      style={{
                        background: appleVibe.surface.chip,
                        border: `1px solid ${appleVibe.stroke.hairline}`,
                      }}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div
                          className="min-w-0 flex-1 truncate text-[12px] font-semibold"
                          style={{ color: appleVibe.text.primary }}
                          title={name}
                        >
                          {name}
                        </div>
                        {row.status === "saved" && !row.dirty && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em]"
                            style={{
                              background: `${withAlpha(appleVibe.stage.outcomes, "1F")}`,
                              color: appleVibe.stage.outcomes,
                            }}
                          >
                            <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
                            saved
                          </span>
                        )}
                        {row.status === "saving" && (
                          <span
                            className="inline-flex items-center gap-1 text-[9.5px] font-light italic"
                            style={{ color: appleVibe.text.tertiary }}
                          >
                            <Loader2
                              className="h-2.5 w-2.5 animate-spin"
                              strokeWidth={2}
                            />
                            saving
                          </span>
                        )}
                        {row.source === "llm" && row.status !== "saved" && (
                          <span
                            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-light italic"
                            style={{
                              background: `${withAlpha(appleVibe.stage.objective, "14")}`,
                              color: appleVibe.stage.objective,
                            }}
                            title="Auto-filled from an LLM expansion-tree calibration_baseline node. Override anytime."
                          >
                            LLM suggested
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <BaselineField
                          label="Baseline (today)"
                          placeholder="e.g. 8/10, 45 min, 72 bpm"
                          value={row.baseline_value ?? ""}
                          onChange={(v) =>
                            patchRow(name, { baseline_value: v })
                          }
                          onBlur={() => row.dirty && void saveOne(name)}
                        />
                        <BaselineField
                          label="Target"
                          placeholder="e.g. 4/10, 90 min, <65 bpm"
                          value={row.target_value ?? ""}
                          onChange={(v) =>
                            patchRow(name, { target_value: v })
                          }
                          onBlur={() => row.dirty && void saveOne(name)}
                        />
                        <BaselineField
                          label="Unit"
                          placeholder="e.g. minutes/day, score 1-10"
                          value={row.unit ?? ""}
                          onChange={(v) => patchRow(name, { unit: v })}
                          onBlur={() => row.dirty && void saveOne(name)}
                        />
                        <BaselineField
                          label="Measurement method"
                          placeholder="e.g. daily GAD-2 self-report"
                          value={row.measurement_method ?? ""}
                          onChange={(v) =>
                            patchRow(name, { measurement_method: v })
                          }
                          onBlur={() => row.dirty && void saveOne(name)}
                        />
                      </div>
                      {row.errorMessage && (
                        <p
                          className="mt-2 text-[10.5px] font-light italic"
                          style={{ color: "rgba(127,29,29,0.95)" }}
                        >
                          {row.errorMessage}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Footer — save-all + close */}
            <footer
              className="flex items-center justify-between gap-3 px-6 py-3"
              style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
            >
              <span
                className="text-[10.5px] font-light italic"
                style={{ color: appleVibe.text.tertiary }}
              >
                {dirtyCount === 0
                  ? "All changes saved · individual rows save on blur"
                  : `${dirtyCount} unsaved row${dirtyCount === 1 ? "" : "s"}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="text-[11px] font-medium underline-offset-2 hover:underline"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => void saveAll()}
                  disabled={dirtyCount === 0}
                  className="inline-flex items-center gap-1.5 transition-all duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    background: appleVibe.accent.primary,
                    color: appleVibe.text.onAccent,
                    borderRadius: appleVibe.radius.pill,
                    padding: "4px 12px",
                    fontSize: "10.5px",
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                    boxShadow: appleVibe.shadow.chip,
                  }}
                >
                  Save all
                </button>
              </div>
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Single-field row — label + input + blur-to-save semantics ─────

function BaselineField({
  label,
  placeholder,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="rounded-md px-2.5 py-1.5 text-[12px] outline-none transition-colors focus:bg-white"
        style={{
          background: "rgba(255,255,255,0.6)",
          border: `1px solid ${appleVibe.stroke.hairline}`,
          color: appleVibe.text.primary,
          fontFamily: appleVibe.font.stack,
        }}
      />
    </label>
  );
}
