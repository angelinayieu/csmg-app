"use client";

// ── TwinQualityReadout ──────────────────────────────────────────────
//
// Visible quality signal for the digital twin. Renders:
//   - A large ring showing the overall score (0-100)
//   - A grade badge (excellent / good / fair / needs attention / critical)
//   - Per-layer subscores (input, coherence, strategy alignment, trajectory)
//   - An expandable issue list, grouped by severity
//   - "Jump to fix" affordances where a fix_hint is actionable
//
// Sits at the top of `/twin` so the user sees their twin's reliability
// before they trust its content. When the score is below the pass
// threshold, the readout becomes a blocking-style banner (doesn't actually
// block rendering, but makes clear the twin may be misleading).

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import type {
  TwinQualityIssue,
  TwinQualityLayer,
  TwinQualityReport,
  TwinQualitySeverity,
} from "@/lib/twin/validate-twin-quality";

const EASE = [0.22, 1, 0.36, 1] as const;

const LAYER_LABELS: Record<TwinQualityLayer, string> = {
  input: "Input",
  coherence: "Coherence",
  strategy_alignment: "Strategy alignment",
  trajectory: "Trajectory",
};

const LAYER_DESCRIPTIONS: Record<TwinQualityLayer, string> = {
  input: "Does the twin have enough raw material to mean anything?",
  coherence: "Are the projected stages and variables internally consistent?",
  strategy_alignment: "Do the strategy's tactics resolve to the twin?",
  trajectory: "Is the twin aligned with the active goal's direction?",
};

const SEVERITY_COLOR: Record<
  TwinQualitySeverity,
  { bg: string; fg: string; dot: string; label: string }
> = {
  error: { bg: "rgba(255,69,58,0.12)", fg: "#8a2a2a", dot: "#FF453A", label: "Error" },
  warning: { bg: "rgba(255,149,0,0.12)", fg: "#8a4a00", dot: "#FF9500", label: "Warning" },
  info: { bg: "rgba(0,122,255,0.10)", fg: "#0A4A8F", dot: "#0A84FF", label: "Info" },
};

export interface TwinQualityReadoutProps {
  report: TwinQualityReport;
  /** Called when the user clicks a "fix hint" action (optional). */
  onIssueAction?: (issue: TwinQualityIssue) => void;
  /** Start with the issue list open. Default: open when score < threshold. */
  defaultExpanded?: boolean;
}

export function TwinQualityReadout({
  report,
  onIssueAction,
  defaultExpanded,
}: TwinQualityReadoutProps) {
  const [expanded, setExpanded] = useState(
    defaultExpanded ?? !report.passed
  );

  const color = scoreColor(report.score);
  const grade = report.grade;

  const issuesBySeverity = useMemo(() => {
    const bucket: Record<TwinQualitySeverity, TwinQualityIssue[]> = {
      error: [],
      warning: [],
      info: [],
    };
    for (const i of report.issues) bucket[i.severity].push(i);
    return bucket;
  }, [report.issues]);

  return (
    <motion.section
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className={`relative overflow-hidden rounded-[18px] border px-6 py-5 ${
        report.passed
          ? "border-white/60 bg-gradient-to-br from-white/80 via-white/60 to-white/40"
          : "border-[rgba(255,159,10,0.35)] bg-gradient-to-br from-[rgba(255,247,230,0.9)] via-white/70 to-white/50"
      }`}
      style={{
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
      aria-label="Twin quality"
    >
      {/* Top row: big ring + headline + expand toggle */}
      <div className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <QualityRing score={report.score} color={color} />
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-fg,#6b7280)]">
                Twin quality
              </span>
              <GradeBadge grade={grade} />
            </div>
            <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--fg,#1d1d1f)]">
              {report.passed
                ? `${gradeHeadline(grade)} — trust what you see`
                : "Twin may be misleading"}
            </h3>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--muted-fg,#48484a)]">
              {summarizeIssues(report)}
            </p>
          </div>
        </div>

        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1.5 text-[11px] font-medium text-[color:var(--fg,#1d1d1f)] transition-colors hover:bg-black/10"
          aria-expanded={expanded}
        >
          {expanded ? "Hide details" : "Show issues"}
          <motion.svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            <path
              d="M3 4.5 L6 7.5 L9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.svg>
        </button>
      </div>

      {/* Layer subscores */}
      <div className="mt-5 grid grid-cols-4 gap-3">
        {(Object.keys(LAYER_LABELS) as TwinQualityLayer[]).map((layer) => (
          <LayerScore
            key={layer}
            layer={layer}
            score={report.layer_scores[layer]}
          />
        ))}
      </div>

      {/* Issue list */}
      <AnimatePresence initial={false}>
        {expanded && report.issues.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-5 space-y-3 border-t border-white/50 pt-4">
              {(["error", "warning", "info"] as TwinQualitySeverity[]).map(
                (sev) =>
                  issuesBySeverity[sev].length > 0 ? (
                    <IssueGroup
                      key={sev}
                      severity={sev}
                      issues={issuesBySeverity[sev]}
                      onAction={onIssueAction}
                    />
                  ) : null
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {expanded && report.issues.length === 0 ? (
        <div className="mt-5 rounded-lg bg-[rgba(48,209,88,0.08)] px-4 py-3 text-[12.5px] text-[color:var(--fg,#1d1d1f)]">
          No issues detected across all four layers. The twin is fully trustworthy.
        </div>
      ) : null}
    </motion.section>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────

function QualityRing({
  score,
  color,
}: {
  score: number;
  color: string;
}) {
  const size = 60;
  const strokeW = 5;
  const r = (size - strokeW) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(0,0,0,0.08)"
          strokeWidth={strokeW}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: EASE }}
          style={{ filter: `drop-shadow(0 0 4px ${color}60)` }}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[18px] font-semibold tabular-nums leading-none text-[color:var(--fg,#1d1d1f)]">
          {Math.round(score)}
        </span>
        <span className="text-[9px] font-medium uppercase tracking-wide text-[color:var(--muted-fg,#86868b)]">
          /100
        </span>
      </span>
    </div>
  );
}

function GradeBadge({ grade }: { grade: TwinQualityReport["grade"] }) {
  const palette: Record<
    TwinQualityReport["grade"],
    { bg: string; fg: string; label: string }
  > = {
    excellent: { bg: "rgba(48,209,88,0.14)", fg: "#1d7a3a", label: "Excellent" },
    good: { bg: "rgba(10,132,255,0.12)", fg: "#0a4a8f", label: "Good" },
    fair: { bg: "rgba(255,149,0,0.12)", fg: "#8a4a00", label: "Fair" },
    needs_attention: { bg: "rgba(255,149,0,0.18)", fg: "#6a3500", label: "Needs attention" },
    critical: { bg: "rgba(255,69,58,0.14)", fg: "#8a2a2a", label: "Critical" },
  };
  const p = palette[grade];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: p.bg, color: p.fg }}
    >
      {p.label}
    </span>
  );
}

function LayerScore({
  layer,
  score,
}: {
  layer: TwinQualityLayer;
  score: number;
}) {
  const color = scoreColor(score);
  return (
    <div
      className="rounded-xl border border-white/50 bg-white/40 px-3 py-2.5"
      title={LAYER_DESCRIPTIONS[layer]}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted-fg,#6b7280)]">
          {LAYER_LABELS[layer]}
        </span>
        <span className="text-[11px] font-mono font-semibold tabular-nums text-[color:var(--fg,#1d1d1f)]">
          {Math.round(score)}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-black/5">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.1 }}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
    </div>
  );
}

function IssueGroup({
  severity,
  issues,
  onAction,
}: {
  severity: TwinQualitySeverity;
  issues: TwinQualityIssue[];
  onAction?: (issue: TwinQualityIssue) => void;
}) {
  const palette = SEVERITY_COLOR[severity];
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <span
          className="h-[6px] w-[6px] rounded-full"
          style={{ background: palette.dot, boxShadow: `0 0 5px ${palette.dot}` }}
        />
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#86868b)]">
          {palette.label}
          {issues.length > 1 ? `s (${issues.length})` : ""}
        </span>
      </div>
      <ul className="space-y-1.5">
        {issues.map((iv) => (
          <li
            key={iv.id}
            className="flex items-start gap-3 rounded-lg bg-white/50 px-3 py-2.5 ring-1 ring-white/60"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-[color:var(--fg,#1d1d1f)]">
                {iv.message}
              </div>
              {iv.fix_hint ? (
                <div className="mt-0.5 text-[12px] text-[color:var(--muted-fg,#48484a)]">
                  <span className="font-medium">Fix:</span> {iv.fix_hint}
                </div>
              ) : null}
              <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[color:var(--muted-fg,#86868b)]">
                <span
                  className="rounded bg-black/5 px-1.5 py-0.5 font-semibold uppercase tracking-wide"
                  style={{ background: palette.bg, color: palette.fg }}
                >
                  {LAYER_LABELS[iv.layer]}
                </span>
                <span className="font-mono">{iv.path}</span>
              </div>
            </div>
            {onAction && iv.suggested_action ? (
              <button
                onClick={() => onAction(iv)}
                className="shrink-0 rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-medium text-[color:var(--fg,#1d1d1f)] hover:bg-black/10"
              >
                Fix
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 90) return "#30D158"; // green
  if (score >= 70) return "#0A84FF"; // blue
  if (score >= 60) return "#FF9F0A"; // amber
  if (score >= 40) return "#FF9500"; // deeper amber
  return "#FF453A"; // red
}

function gradeHeadline(grade: TwinQualityReport["grade"]): string {
  switch (grade) {
    case "excellent": return "Twin is excellent";
    case "good": return "Twin is reliable";
    case "fair": return "Twin is usable";
    case "needs_attention": return "Twin needs attention";
    case "critical": return "Twin is unreliable";
  }
}

function summarizeIssues(report: TwinQualityReport): string {
  if (report.issues.length === 0) {
    return "All four layers pass. Twin is fully trustworthy.";
  }
  const parts: string[] = [];
  if (report.error_count > 0)
    parts.push(
      `${report.error_count} error${report.error_count === 1 ? "" : "s"}`
    );
  if (report.warning_count > 0)
    parts.push(
      `${report.warning_count} warning${report.warning_count === 1 ? "" : "s"}`
    );
  if (report.info_count > 0)
    parts.push(`${report.info_count} note${report.info_count === 1 ? "" : "s"}`);
  return `${parts.join(" · ")} — ${report.issues.length} total`;
}
