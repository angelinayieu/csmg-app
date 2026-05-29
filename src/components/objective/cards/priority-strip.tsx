"use client";

// ── Priority Strip ────────────────────────────────────────────────
//
// Companion to ConstraintsStrip. Captures the user's SOFT-WEIGHT
// trade-off preferences for THIS sub-objective room — distinct from
// the space-scoped hard-gate constraints already visible above.
//
// Visual language matches ConstraintsStrip (cardElevated + hairline
// border + shadow.chip) so the two surfaces read as siblings rather
// than competing for attention. Header label is "Priorities" (vs
// "Control vars") and the icon is Sliders (vs Lock) — the affordance
// difference (adjustable, not held-fixed) made literal.
//
// Cold-start affordance: when source="inferred" we render an "AI's
// read — adjust" subtitle so the user knows the vector is the
// system's first guess, not their stated preference. Once they save
// at least one edit, source flips to "user" and the hint drops.

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Pencil, Sliders, Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  DIMENSION_HINT,
  DIMENSION_LABEL,
  PRIORITY_DIMENSIONS,
  TIER_LABEL,
  TIER_ORDER,
  type PriorityTier,
  type PriorityVector,
} from "@/lib/objective-canvas/priority-vector";

interface Props {
  /** The room's vector (server-passed from improvement_goals.priority_vector).
   *  Null = column unset; the strip will trigger an auto-infer GET on
   *  mount so the user never sees an empty surface. */
  initialVector: PriorityVector | null;
  /** The sub-objective id this vector belongs to. Required — without
   *  it the strip can't save or auto-infer. */
  subObjectiveId: string;
}

// Tier color tint — high = accent, low = faint. Communicates the
// weight visually without needing a number on screen.
const TIER_TINT: Record<PriorityTier, { bg: string; text: string }> = {
  low: {
    bg: appleVibe.surface.chip,
    text: appleVibe.text.tertiary,
  },
  medium: {
    bg: appleVibe.surface.chip,
    text: appleVibe.text.secondary,
  },
  high: {
    // Light wash of the accent color — high-weighted dims pop.
    bg: `${appleVibe.accent.primary}1A`,
    text: appleVibe.accent.primary,
  },
};

/** Compact chip — facet label + tier value. Read-only mode. */
function Chip({
  facet,
  tier,
  title,
}: {
  facet: string;
  tier: PriorityTier;
  title?: string;
}) {
  const tint = TIER_TINT[tier];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
      style={{
        background: tint.bg,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        color: tint.text,
      }}
      title={title}
    >
      <span
        className="text-[9px] font-semibold uppercase tracking-[0.10em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        {facet}
      </span>
      <span className="font-medium">{TIER_LABEL[tier]}</span>
    </span>
  );
}

export function PriorityStrip({ initialVector, subObjectiveId }: Props) {
  // Local vector — bumped optimistically on save so chips reflect the
  // new tiers before the parent re-fetches. Also the landing target
  // for the auto-infer GET when initialVector is null.
  const [vector, setVector] = useState<PriorityVector | null>(initialVector);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PriorityVector | null>(initialVector);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Tracks the auto-infer fetch so we don't fire it twice + can show a
  // subtle hint while it runs.
  const [autoInferring, setAutoInferring] = useState(false);

  // Sync local copy when parent prop changes (router.refresh after a
  // separate save, hydration, etc.).
  useEffect(() => {
    setVector(initialVector);
    if (!editing) setDraft(initialVector);
  }, [initialVector, editing]);

  // Auto-infer on mount when the column is unset. Fires the GET route
  // which performs the inference + persists the result; the response
  // becomes the rendered vector. Soft-fail — if inference fails, the
  // strip stays empty (parent's row also missing the column = consistent).
  const triggerAutoInfer = useCallback(async () => {
    if (autoInferring) return;
    setAutoInferring(true);
    try {
      const res = await fetch(
        `/api/brainstorm/sub-objectives/${subObjectiveId}/priorities`,
        { method: "GET" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { vector: PriorityVector };
      if (json.vector) {
        setVector(json.vector);
        setDraft(json.vector);
      }
    } catch {
      // Silent — the strip just stays empty if inference fails.
    } finally {
      setAutoInferring(false);
    }
  }, [autoInferring, subObjectiveId]);

  useEffect(() => {
    if (initialVector === null) {
      void triggerAutoInfer();
    }
    // Only the initial-null case triggers; subsequent re-renders
    // shouldn't re-fire because vector becomes non-null after the
    // first successful response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing to show yet (still inferring, or inference failed silently).
  if (!vector) {
    if (autoInferring) {
      return (
        <div
          className="mb-3 flex items-center gap-2 rounded-md px-3.5 py-2 text-[11px]"
          style={{
            background: appleVibe.surface.cardElevated,
            border: `1px solid ${appleVibe.stroke.soft}`,
            color: appleVibe.text.tertiary,
            fontFamily: appleVibe.font.stack,
            boxShadow: appleVibe.shadow.chip,
          }}
        >
          <Sparkles className="h-3 w-3" strokeWidth={2} />
          <span className="font-medium">Reading your priorities…</span>
        </div>
      );
    }
    return null;
  }

  function openEditor() {
    setDraft(vector);
    setSaveError(null);
    setEditing(true);
  }

  function cancelEditor() {
    setDraft(vector);
    setSaveError(null);
    setEditing(false);
  }

  async function saveEditor() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/brainstorm/sub-objectives/${subObjectiveId}/priorities`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tiers: draft.tiers }),
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        const detail = json.detail ? ` — ${json.detail}` : "";
        setSaveError(`${json.error ?? "Save failed."}${detail}`);
        return;
      }
      const json = (await res.json()) as { vector: PriorityVector };
      setVector(json.vector);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSaving(false);
    }
  }

  const isInferred = vector.source === "inferred";

  return (
    <motion.div
      layout
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="mb-3 overflow-hidden"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.soft}`,
        borderRadius: appleVibe.radius.md,
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 px-3.5 py-2.5">
        <div className="flex flex-shrink-0 items-center gap-1.5 pt-0.5">
          <Sliders
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={2}
            style={{ color: appleVibe.text.tertiary }}
          />
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.secondary }}
          >
            Priorities
          </span>
          <span
            className="text-[10px] font-light"
            style={{ color: appleVibe.text.tertiary }}
            title="Soft trade-off weights for THIS room. Distinct from the held-fixed control variables."
          >
            · {PRIORITY_DIMENSIONS.length} dimensions
          </span>
          {isInferred && !editing && (
            <span
              className="ml-1 inline-flex items-center gap-1 text-[10px] font-light italic"
              style={{ color: appleVibe.text.faint }}
              title="The system inferred this from your objective + clarifying answers. Click edit to tune."
            >
              <Sparkles className="h-2.5 w-2.5" strokeWidth={2} />
              AI&apos;s read — adjust
            </span>
          )}
        </div>

        {/* Compact chips */}
        {!editing && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {PRIORITY_DIMENSIONS.map((dim) => (
              <Chip
                key={dim}
                facet={DIMENSION_LABEL[dim].toLowerCase()}
                tier={vector.tiers[dim]}
                title={DIMENSION_HINT[dim]}
              />
            ))}
          </div>
        )}

        {editing && <div className="min-w-0 flex-1" />}

        {!editing && (
          <motion.button
            type="button"
            onClick={openEditor}
            whileHover={{ y: -1, transition: { duration: 0.15 } }}
            whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
            className="inline-flex flex-shrink-0 items-center gap-1 self-center rounded-full px-2 py-1 text-[10.5px] font-semibold transition-[background,color] duration-150 ease-out"
            style={{
              background: "transparent",
              color: appleVibe.text.tertiary,
              border: `1px solid ${appleVibe.stroke.hairline}`,
            }}
            title="Tune your trade-off preferences for this room"
          >
            <Pencil className="h-2.5 w-2.5" strokeWidth={2} />
            edit
          </motion.button>
        )}
      </div>

      {/* Editor */}
      <AnimatePresence initial={false}>
        {editing && draft && (
          <motion.div
            key="editor"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div
              className="border-t px-3.5 py-3"
              style={{ borderColor: appleVibe.stroke.hairline }}
            >
              {PRIORITY_DIMENSIONS.map((dim) => (
                <DimensionRow
                  key={dim}
                  label={DIMENSION_LABEL[dim]}
                  hint={DIMENSION_HINT[dim]}
                  value={draft.tiers[dim]}
                  onChange={(next) =>
                    setDraft({
                      ...draft,
                      tiers: { ...draft.tiers, [dim]: next },
                    })
                  }
                />
              ))}

              {saveError && (
                <p
                  className="mt-2 text-[11px]"
                  style={{ color: "rgba(127,29,29,0.95)" }}
                >
                  {saveError}
                </p>
              )}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelEditor}
                  className="text-[10.5px] font-medium underline-offset-2 hover:underline"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  cancel
                </button>
                <motion.button
                  type="button"
                  onClick={saveEditor}
                  disabled={saving}
                  whileHover={!saving ? { y: -1 } : undefined}
                  whileTap={!saving ? { y: 0.5 } : undefined}
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
                  <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
                  {saving ? "Saving…" : "Save"}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Sub-component: dimension row ────────────────────────────────
// Label + one-line hint + segmented tier control. The hint lives
// inline (not in a tooltip) when editing because the user needs the
// meaning to choose the tier — hidden hints make the editor a guess.
function DimensionRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: PriorityTier;
  onChange: (next: PriorityTier) => void;
}) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-center gap-3">
        <span
          className="w-28 flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          {label}
        </span>
        <div className="min-w-0 flex-1">
          <TierControl value={value} onChange={onChange} />
        </div>
      </div>
      <p
        className="mt-1 pl-[7.5rem] text-[10.5px] leading-snug"
        style={{ color: appleVibe.text.faint }}
      >
        {hint}
      </p>
    </div>
  );
}

// ── Sub-component: segmented tier control ────────────────────────
// Three pills: low / med / high. Apple-style segmented control —
// active pill gets surface.card + shadow.chip + (for high) an accent
// tint so the user can see at a glance which dims are weighted high.
function TierControl({
  value,
  onChange,
}: {
  value: PriorityTier;
  onChange: (next: PriorityTier) => void;
}) {
  return (
    <div
      className="inline-flex items-center"
      style={{
        background: appleVibe.surface.chip,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.pill,
        padding: 2,
      }}
    >
      {TIER_ORDER.map((opt) => {
        const active = value === opt;
        const isHigh = opt === "high";
        // Active high gets accent tint to signal "this is the dim the
        // user weighted up." Active low/med stay neutral.
        const activeBg =
          active && isHigh
            ? `${appleVibe.accent.primary}1A`
            : active
              ? appleVibe.surface.card
              : "transparent";
        const activeColor =
          active && isHigh
            ? appleVibe.accent.primary
            : active
              ? appleVibe.text.primary
              : appleVibe.text.tertiary;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className="inline-flex items-center px-2.5 py-1 text-[10.5px] font-medium transition-all duration-150 ease-out"
            style={{
              background: activeBg,
              color: activeColor,
              borderRadius: appleVibe.radius.pill,
              boxShadow: active ? appleVibe.shadow.chip : "none",
              fontWeight: active ? 600 : 500,
              letterSpacing: "0.02em",
            }}
          >
            {TIER_LABEL[opt]}
          </button>
        );
      })}
    </div>
  );
}
