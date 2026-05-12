"use client";

// PreciseInputForm — optional structured fields the user can fill in
// addition to the free-text prompt on the immersive home (C5).
//
// Why: vague prompts work, but the planner / strategy LLM produces much
// stronger output when the user can name a concrete outcome metric, a
// time horizon, and the subject they care about. This form captures
// those without forcing them — every field is optional and the form
// is hidden behind a toggle so casual users never see it.
//
// At submit time, the parent serializes the filled fields into a
// markdown suffix appended to the prompt (see buildPreciseSuffix
// below). Downstream LLM stages see them in-context and can frame
// their outputs around the constraints. Empty fields are dropped.

import { Target, Activity, Clock3, Users, ListChecks } from "lucide-react";

export interface PreciseFields {
  /** What to optimize, e.g. "deep-work hours per week". */
  outcome: string;
  /** Magnitude of change to aim for, e.g. "+25%" or "from 12 → 18 hr". */
  target_delta: string;
  /** Time horizon, e.g. "12 weeks" or "Q3 2026". */
  horizon: string;
  /** Subject / population, e.g. "knowledge workers 30-45 with mild
   *  brain fog" or "myself". */
  subject: string;
  /** Constraints, e.g. "no caffeine after 11am", "≤30 min/day commit". */
  constraints: string;
}

export const EMPTY_PRECISE_FIELDS: PreciseFields = {
  outcome: "",
  target_delta: "",
  horizon: "",
  subject: "",
  constraints: "",
};

export function preciseFieldsAreEmpty(f: PreciseFields): boolean {
  return (
    !f.outcome.trim() &&
    !f.target_delta.trim() &&
    !f.horizon.trim() &&
    !f.subject.trim() &&
    !f.constraints.trim()
  );
}

/** Serialize the filled fields into a markdown suffix that will be
 *  appended to the prompt text the planner LLM consumes. */
export function buildPreciseSuffix(f: PreciseFields): string {
  const lines: string[] = [];
  if (f.outcome.trim()) lines.push(`- Outcome: ${f.outcome.trim()}`);
  if (f.target_delta.trim())
    lines.push(`- Target delta: ${f.target_delta.trim()}`);
  if (f.horizon.trim()) lines.push(`- Horizon: ${f.horizon.trim()}`);
  if (f.subject.trim()) lines.push(`- Subject: ${f.subject.trim()}`);
  if (f.constraints.trim())
    lines.push(`- Constraints: ${f.constraints.trim()}`);
  if (lines.length === 0) return "";
  return `\n\n--- precise framing ---\n${lines.join("\n")}`;
}

interface FieldDef {
  key: keyof PreciseFields;
  label: string;
  placeholder: string;
  Icon: typeof Target;
}

const FIELDS: FieldDef[] = [
  {
    key: "outcome",
    label: "Outcome",
    placeholder: "What should change? (e.g. deep-work hours / week)",
    Icon: Target,
  },
  {
    key: "target_delta",
    label: "Target delta",
    placeholder: "By how much? (e.g. +25%, 12 → 18)",
    Icon: Activity,
  },
  {
    key: "horizon",
    label: "Horizon",
    placeholder: "By when? (e.g. 12 weeks, Q3 2026)",
    Icon: Clock3,
  },
  {
    key: "subject",
    label: "Subject",
    placeholder: "Who? (e.g. myself, knowledge workers 30-45)",
    Icon: Users,
  },
  {
    key: "constraints",
    label: "Constraints",
    placeholder: "Any non-negotiables? (e.g. ≤30 min/day, no caffeine after 11am)",
    Icon: ListChecks,
  },
];

interface Props {
  fields: PreciseFields;
  onChange: (fields: PreciseFields) => void;
}

export function PreciseInputForm({ fields, onChange }: Props) {
  return (
    <div className="space-y-1.5 px-1 pt-1.5">
      <div className="flex items-center justify-between">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: "var(--home-text-faint)" }}
        >
          Precise framing — optional, all fields skip if blank
        </p>
        <button
          type="button"
          onClick={() => onChange({ ...EMPTY_PRECISE_FIELDS })}
          disabled={preciseFieldsAreEmpty(fields)}
          className="text-[10px] font-medium transition-colors disabled:opacity-40"
          style={{ color: "var(--home-text-faint)" }}
        >
          Clear
        </button>
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        {FIELDS.map(({ key, label, placeholder, Icon }) => (
          <label
            key={key}
            className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
            style={{
              border: "1px solid var(--home-chrome-stroke)",
              background: "var(--home-chrome-fill)",
            }}
          >
            <Icon
              className="h-3 w-3 flex-shrink-0"
              style={{ color: "var(--home-text-faint)" }}
              strokeWidth={1.75}
            />
            <span
              className="text-[10px] font-semibold uppercase tracking-wide w-[88px] flex-shrink-0"
              style={{ color: "var(--home-text-faint)" }}
            >
              {label}
            </span>
            <input
              type="text"
              value={fields[key]}
              onChange={(e) => onChange({ ...fields, [key]: e.target.value })}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent text-[11.5px] focus:outline-none"
              style={{
                color: "var(--home-text)",
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
