"use client";

// ── Constraints Strip ─────────────────────────────────────────────
//
// Phase 5a — Scientific Framing. Surfaces the user's operational
// constraints as CONTROL VARIABLES — the variables held FIXED during
// any mechanism experiment, so the loop is comparing variants under
// the same conditions.
//
// Phase 8a — Inline editor. The strip now self-manages an edit mode:
// click Edit → strip expands into a form (segmented pills per enum +
// inline compliance chip editor). Save → POSTs to
// /api/brainstorm/space/constraints, updates local state optimistically,
// collapses back to compact view. This closes a real semantic gap:
// in the scientific framing, control variables that can't be edited
// break the experiment — if budget changes, autopilot would keep
// proposing $5K experiments to a $0 budget user.
//
// Visual language matches the lane chrome (cardElevated + hairline
// border + shadow.chip) so the strip reads as a sibling chrome
// surface, not a foreign element.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Lock, Pencil, Plus, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  BudgetTier,
  OperationalConstraints,
  RiskTolerance,
  TeamSize,
  TimeHorizon,
} from "@/lib/objective-canvas/constraints";

interface Props {
  constraints: OperationalConstraints | null;
  /** Phase 8a — required when editor functionality is desired.
   *  Without spaceId the strip renders read-only (no edit button). */
  spaceId?: string;
}

/** Friendly labels for each enum value — short enough to fit in
 *  a chip without overflowing. */
const TIME_HORIZON_LABEL: Record<TimeHorizon, string> = {
  days: "days",
  weeks: "weeks",
  months: "months",
  quarter: "1 quarter",
  year_plus: "year+",
};

const BUDGET_LABEL: Record<BudgetTier, string> = {
  zero: "$0",
  low: "< $500",
  moderate: "moderate",
  substantial: "substantial",
};

const TEAM_LABEL: Record<TeamSize, string> = {
  solo: "solo",
  small: "small",
  medium: "medium",
  large: "large",
};

const RISK_LABEL: Record<RiskTolerance, string> = {
  experimental: "experimental",
  calibrated: "calibrated",
  conservative: "conservative",
};

const TIME_ORDER: TimeHorizon[] = [
  "days",
  "weeks",
  "months",
  "quarter",
  "year_plus",
];
const BUDGET_ORDER: BudgetTier[] = ["zero", "low", "moderate", "substantial"];
const TEAM_ORDER: TeamSize[] = ["solo", "small", "medium", "large"];
const RISK_ORDER: RiskTolerance[] = [
  "experimental",
  "calibrated",
  "conservative",
];

/** Compact chip — uppercase facet label + the value. Read-only mode. */
function Chip({
  facet,
  value,
  title,
}: {
  facet: string;
  value: string;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
      style={{
        background: appleVibe.surface.chip,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        color: appleVibe.text.secondary,
      }}
      title={title}
    >
      <span
        className="text-[9px] font-semibold uppercase tracking-[0.10em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        {facet}
      </span>
      <span className="font-medium" style={{ color: appleVibe.text.primary }}>
        {value}
      </span>
    </span>
  );
}

export function ConstraintsStrip({ constraints, spaceId }: Props) {
  // Edit state — self-contained. The user opens/closes the editor
  // entirely within this component. Save fires the POST and updates
  // the optimistic local copy; on next render the parent passes the
  // fresh server value but it matches the optimistic state so no
  // flicker.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OperationalConstraints | null>(
    constraints,
  );
  // When the parent's `constraints` prop changes (e.g. after a
  // router.refresh, or first hydration), sync the draft so the
  // editor opens with the latest values.
  useEffect(() => {
    if (!editing) setDraft(constraints);
  }, [constraints, editing]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Local mirror of the constraints — bumped optimistically on save
  // so the chip view reflects the new values before the parent
  // re-fetches. Falls back to the prop after the next sync.
  const [localConstraints, setLocalConstraints] = useState<
    OperationalConstraints | null
  >(constraints);
  useEffect(() => {
    setLocalConstraints(constraints);
  }, [constraints]);

  // No constraints captured yet → render nothing.
  if (!localConstraints) return null;

  // Total chip count for the header — structural 4 + compliance entries.
  const compliance = localConstraints.compliance_requirements ?? [];
  const total = 4 + compliance.length;

  function openEditor() {
    setDraft(localConstraints);
    setSaveError(null);
    setEditing(true);
  }

  function cancelEditor() {
    setDraft(localConstraints);
    setSaveError(null);
    setEditing(false);
  }

  async function saveEditor() {
    if (!draft || !spaceId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/brainstorm/space/constraints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          time_horizon: draft.time_horizon,
          budget_tier: draft.budget_tier,
          team_size: draft.team_size,
          risk_tolerance: draft.risk_tolerance,
          compliance_requirements: draft.compliance_requirements,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        const detail = json.detail ? ` — ${json.detail}` : "";
        setSaveError(`${json.error ?? "Save failed."}${detail}`);
        return;
      }
      const json = (await res.json()) as { constraints: OperationalConstraints };
      // Optimistic local commit — the chip view paints from
      // localConstraints, which we just updated. The parent will
      // eventually pass the same value via its own re-fetch.
      setLocalConstraints(json.constraints);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSaving(false);
    }
  }

  // Show the editor when in edit mode, otherwise compact view.
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
      {/* Header row — always visible (compact view AND edit mode). */}
      <div className="flex items-start gap-3 px-3.5 py-2.5">
        {/* Header label — scientific framing makes the role clear. */}
        <div className="flex flex-shrink-0 items-center gap-1.5 pt-0.5">
          <Lock
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={2}
            style={{ color: appleVibe.text.tertiary }}
          />
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.secondary }}
          >
            Control vars
          </span>
          <span
            className="text-[10px] font-light"
            style={{ color: appleVibe.text.tertiary }}
            title="Held fixed during mechanism experiments so variants are tested under the same conditions."
          >
            · {total} held fixed
          </span>
        </div>

        {/* Compact chips — only when NOT editing. */}
        {!editing && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <Chip
              facet="time"
              value={TIME_HORIZON_LABEL[localConstraints.time_horizon]}
              title="Time horizon — drives prototype-lab cost gates"
            />
            <Chip
              facet="budget"
              value={BUDGET_LABEL[localConstraints.budget_tier]}
              title="Budget tier — filters expensive variations"
            />
            <Chip
              facet="team"
              value={TEAM_LABEL[localConstraints.team_size]}
              title="Team size — affects which variations are reachable"
            />
            <Chip
              facet="risk"
              value={RISK_LABEL[localConstraints.risk_tolerance]}
              title="Risk tolerance — how much surprise the user can absorb"
            />
            {compliance.map((c, i) => (
              <Chip
                key={`compliance-${i}`}
                facet="must"
                value={c}
                title="Compliance requirement — LLM treats as a hard reject for variations that violate it"
              />
            ))}
          </div>
        )}

        {/* When editing — placeholder spacer so the header keeps
            its right-aligned action button position. */}
        {editing && <div className="min-w-0 flex-1" />}

        {/* Edit affordance — only when spaceId is provided AND not
            currently in edit mode. */}
        {spaceId && !editing && (
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
            title="Edit your operational constraints"
          >
            <Pencil className="h-2.5 w-2.5" strokeWidth={2} />
            edit
          </motion.button>
        )}
      </div>

      {/* Editor — slides down when in edit mode. AnimatePresence so the
          enter/exit transitions render. */}
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
              <FacetRow label="Time">
                <SegmentedControl<TimeHorizon>
                  options={TIME_ORDER}
                  labels={TIME_HORIZON_LABEL}
                  value={draft.time_horizon}
                  onChange={(v) =>
                    setDraft({ ...draft, time_horizon: v })
                  }
                />
              </FacetRow>
              <FacetRow label="Budget">
                <SegmentedControl<BudgetTier>
                  options={BUDGET_ORDER}
                  labels={BUDGET_LABEL}
                  value={draft.budget_tier}
                  onChange={(v) =>
                    setDraft({ ...draft, budget_tier: v })
                  }
                />
              </FacetRow>
              <FacetRow label="Team">
                <SegmentedControl<TeamSize>
                  options={TEAM_ORDER}
                  labels={TEAM_LABEL}
                  value={draft.team_size}
                  onChange={(v) =>
                    setDraft({ ...draft, team_size: v })
                  }
                />
              </FacetRow>
              <FacetRow label="Risk">
                <SegmentedControl<RiskTolerance>
                  options={RISK_ORDER}
                  labels={RISK_LABEL}
                  value={draft.risk_tolerance}
                  onChange={(v) =>
                    setDraft({ ...draft, risk_tolerance: v })
                  }
                />
              </FacetRow>
              <FacetRow label="Compliance">
                <ComplianceEditor
                  value={draft.compliance_requirements ?? []}
                  onChange={(next) =>
                    setDraft({ ...draft, compliance_requirements: next })
                  }
                />
              </FacetRow>

              {/* Save / cancel footer */}
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

// ── Sub-component: Facet row ────────────────────────────────────
// A label + a segmented (or chip-list) control on one line. Matches
// the strip's restrained typography vocabulary.
function FacetRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-3 last:mb-0">
      <span
        className="w-20 flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ── Sub-component: Segmented pill control ────────────────────────
// Apple-style segmented control — each option is a pill in a
// shared container. Active option gets surface.card + shadow.chip,
// inactive options are transparent with tertiary text.
function SegmentedControl<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: T[];
  labels: Record<T, string>;
  value: T;
  onChange: (next: T) => void;
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
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className="inline-flex items-center px-2.5 py-1 text-[10.5px] font-medium transition-all duration-150 ease-out"
            style={{
              background: active ? appleVibe.surface.card : "transparent",
              color: active ? appleVibe.text.primary : appleVibe.text.tertiary,
              borderRadius: appleVibe.radius.pill,
              boxShadow: active ? appleVibe.shadow.chip : "none",
              fontWeight: active ? 600 : 500,
              letterSpacing: "0.02em",
            }}
          >
            {labels[opt]}
          </button>
        );
      })}
    </div>
  );
}

// ── Sub-component: Compliance editor ─────────────────────────────
// Inline chip list with a tiny "+" affordance + per-chip delete.
// Cap at 6 entries — the LLM treats compliance as hard rejects,
// more than that is unwieldy.
function ComplianceEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");

  function addEntry() {
    const trimmed = newValue.trim();
    if (!trimmed) {
      setAdding(false);
      setNewValue("");
      return;
    }
    if (value.length >= 6) {
      setAdding(false);
      setNewValue("");
      return;
    }
    if (value.includes(trimmed)) {
      setAdding(false);
      setNewValue("");
      return;
    }
    onChange([...value, trimmed.slice(0, 80)]);
    setNewValue("");
    setAdding(false);
  }

  function removeEntry(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.length === 0 && !adding && (
        <span
          className="text-[10.5px] font-light italic"
          style={{ color: appleVibe.text.faint }}
        >
          none — add hard constraints like HIPAA, GDPR, accessibility
        </span>
      )}
      {value.map((c, i) => (
        <span
          key={`${c}-${i}`}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
          style={{
            background: appleVibe.surface.chip,
            border: `1px solid ${appleVibe.stroke.hairline}`,
            color: appleVibe.text.primary,
            fontWeight: 500,
          }}
        >
          {c}
          <button
            type="button"
            onClick={() => removeEntry(i)}
            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors duration-150 ease-out hover:bg-[rgba(15,23,42,0.08)]"
            title="Remove"
            aria-label={`Remove ${c}`}
          >
            <X
              className="h-2 w-2"
              strokeWidth={2.5}
              style={{ color: appleVibe.text.tertiary }}
            />
          </button>
        </span>
      ))}
      {adding && (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
          style={{
            background: appleVibe.surface.card,
            border: `1px solid ${appleVibe.stroke.medium}`,
          }}
        >
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value.slice(0, 80))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addEntry();
              } else if (e.key === "Escape") {
                setAdding(false);
                setNewValue("");
              }
            }}
            onBlur={addEntry}
            autoFocus
            placeholder="e.g. HIPAA"
            className="w-28 bg-transparent text-[11px] focus:outline-none"
            style={{ color: appleVibe.text.primary }}
            maxLength={80}
          />
        </span>
      )}
      {!adding && value.length < 6 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors duration-150 ease-out hover:bg-[rgba(15,23,42,0.04)]"
          style={{
            background: "transparent",
            color: appleVibe.text.tertiary,
            border: `1px dashed ${appleVibe.stroke.medium}`,
          }}
        >
          <Plus className="h-2.5 w-2.5" strokeWidth={2} />
          add
        </button>
      )}
    </div>
  );
}
