"use client";

// ── Constraints Strip ─────────────────────────────────────────────
//
// Phase 5a — Scientific Framing. Surfaces the user's operational
// constraints as CONTROL VARIABLES — the variables held FIXED during
// any mechanism experiment, so the loop is comparing variants under
// the same conditions.
//
// Without this strip the constraints lived in synthesis_data and only
// the LLM ever saw them. The user had no way to know which
// constraints were active or whether the constraints captured at
// intake still match their reality.
//
// Visual language matches the lane chrome (cardElevated + hairline
// border + shadow.chip) so the strip reads as a sibling chrome
// surface, not a foreign element.

import { motion } from "framer-motion";
import { Lock, Pencil } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { OperationalConstraints } from "@/lib/objective-canvas/constraints";

interface Props {
  constraints: OperationalConstraints | null;
  /** When provided, the strip renders an "edit" affordance. Caller
   *  is responsible for surfacing the editor (we don't own that UI
   *  here). Hides the button when undefined to keep the strip
   *  read-only in contexts where editing isn't appropriate. */
  onEdit?: () => void;
}

/** Friendly labels for each enum value — short enough to fit in
 *  a chip without overflowing. */
const TIME_HORIZON_LABEL: Record<
  OperationalConstraints["time_horizon"],
  string
> = {
  days: "days",
  weeks: "weeks",
  months: "months",
  quarter: "1 quarter",
  year_plus: "year+",
};

const BUDGET_LABEL: Record<OperationalConstraints["budget_tier"], string> = {
  zero: "$0",
  low: "< $500",
  moderate: "moderate",
  substantial: "substantial",
};

const TEAM_LABEL: Record<OperationalConstraints["team_size"], string> = {
  solo: "solo",
  small: "small",
  medium: "medium",
  large: "large",
};

const RISK_LABEL: Record<
  OperationalConstraints["risk_tolerance"],
  string
> = {
  experimental: "experimental",
  calibrated: "calibrated",
  conservative: "conservative",
};

/** Compact chip — uppercase facet label + the value. */
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

export function ConstraintsStrip({ constraints, onEdit }: Props) {
  // No constraints captured yet — render nothing. This is a hint
  // to the user rather than an absence; if they want constraints
  // they go through the (existing) inference / editor path.
  if (!constraints) return null;

  // Total = the structural 4 + any compliance lines (each its own
  // control variable since LLM treats compliance as hard rejects).
  const compliance = constraints.compliance_requirements ?? [];
  const total = 4 + compliance.length;

  return (
    <div
      className="mb-3 flex items-start gap-3 px-3.5 py-2.5"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.soft}`,
        borderRadius: appleVibe.radius.md,
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
      }}
    >
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

      {/* Chips — the structural four + compliance entries. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <Chip
          facet="time"
          value={TIME_HORIZON_LABEL[constraints.time_horizon]}
          title="Time horizon — drives prototype-lab cost gates"
        />
        <Chip
          facet="budget"
          value={BUDGET_LABEL[constraints.budget_tier]}
          title="Budget tier — filters expensive variations"
        />
        <Chip
          facet="team"
          value={TEAM_LABEL[constraints.team_size]}
          title="Team size — affects which variations are reachable"
        />
        <Chip
          facet="risk"
          value={RISK_LABEL[constraints.risk_tolerance]}
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

      {/* Edit affordance — only when the caller provides a handler. */}
      {onEdit && (
        <motion.button
          type="button"
          onClick={onEdit}
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
  );
}
