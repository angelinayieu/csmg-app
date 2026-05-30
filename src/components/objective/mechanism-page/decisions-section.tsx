"use client";

// ── §7 Decisions ──────────────────────────────────────────────────
//
// Full audit trail for this mechanism — every row from
// sub_objective_decisions where proposal_id === entityId. Sorted
// most-recent-first. Each row shows action, timestamp, and any
// rich metadata the route's logDecision call attached.

import { SectionHeader } from "./section-header";

interface DecisionRow {
  id: string;
  action: string;
  proposal_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface Props {
  decisions: DecisionRow[];
}

const ACTION_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  elect: { label: "Elected", bg: "rgba(34,197,94,0.12)", fg: "rgba(21,128,61,0.95)" },
  reject: { label: "Rejected", bg: "rgba(239,68,68,0.10)", fg: "rgba(185,28,28,0.92)" },
  defer: { label: "Deferred", bg: "rgba(15,23,42,0.06)", fg: "rgba(15,23,42,0.6)" },
  compose: { label: "Composed", bg: "rgba(168,85,247,0.12)", fg: "rgba(126,34,206,0.92)" },
  score: { label: "Scored", bg: "rgba(59,130,246,0.10)", fg: "rgba(37,99,235,0.92)" },
  autopilot_iteration: {
    label: "Autopilot",
    bg: "rgba(15,23,42,0.06)",
    fg: "rgba(15,23,42,0.6)",
  },
  mechanism_spec_generated: {
    label: "Spec generated",
    bg: "rgba(20,184,166,0.12)",
    fg: "rgba(15,118,110,0.95)",
  },
  research: {
    label: "Research",
    bg: "rgba(99,102,241,0.10)",
    fg: "rgba(67,56,202,0.92)",
  },
};

export function DecisionsSection({ decisions }: Props) {
  if (decisions.length === 0) {
    return (
      <div>
        <SectionHeader
          number="7"
          title="Decisions"
          subtitle="Every choice made on this mechanism."
        />
        <div
          className="rounded-lg border border-dashed px-4 py-6 text-center"
          style={{ borderColor: "rgba(15,23,42,0.12)" }}
        >
          <p
            className="text-[13px] font-light italic"
            style={{ color: "rgba(15,23,42,0.5)" }}
          >
            No decisions logged for this mechanism yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        number="7"
        title="Decisions"
        subtitle={`${decisions.length} event${decisions.length === 1 ? "" : "s"} · most recent first`}
      />
      <ol className="space-y-2">
        {decisions.map((d) => (
          <DecisionRow key={d.id} decision={d} />
        ))}
      </ol>
    </div>
  );
}

function DecisionRow({ decision }: { decision: DecisionRow }) {
  const meta = ACTION_LABEL[decision.action] ?? {
    label: decision.action,
    bg: "rgba(15,23,42,0.06)",
    fg: "rgba(15,23,42,0.6)",
  };
  const ts = formatRelativeTime(decision.created_at);
  const metadataSummary = summarizeMetadata(decision.action, decision.metadata);

  return (
    <li
      className="rounded-lg border p-3"
      style={{ borderColor: "rgba(15,23,42,0.08)", background: "#ffffff" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-1 items-start gap-2">
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: meta.bg, color: meta.fg }}
          >
            {meta.label}
          </span>
          {metadataSummary && (
            <span
              className="text-[12.5px] font-light leading-relaxed"
              style={{ color: "rgba(15,23,42,0.72)" }}
            >
              {metadataSummary}
            </span>
          )}
        </div>
        <span
          className="shrink-0 text-[11px] tabular-nums"
          style={{ color: "rgba(15,23,42,0.45)" }}
          title={decision.created_at}
        >
          {ts}
        </span>
      </div>
    </li>
  );
}

function summarizeMetadata(
  action: string,
  metadata: Record<string, unknown> | null,
): string | null {
  if (!metadata) return null;
  const m = metadata;

  if (action === "score") {
    const score =
      typeof m.composite_score === "number"
        ? Math.round((m.composite_score as number) * 100)
        : null;
    const method = typeof m.method === "string" ? m.method : null;
    return [
      method && `Method: ${method}`,
      score !== null && `Composite: ${score}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (action === "mechanism_spec_generated") {
    const aiCount =
      typeof m.n_active_ingredients === "number" ? m.n_active_ingredients : null;
    const evidence =
      typeof m.evidence_strength === "string" ? m.evidence_strength : null;
    return [
      aiCount !== null && `${aiCount} active ingredients`,
      evidence && `Evidence: ${evidence}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (action === "research") {
    const tech = typeof m.technical_count === "number" ? m.technical_count : null;
    const design = typeof m.design_count === "number" ? m.design_count : null;
    return [
      tech !== null && `${tech} technical`,
      design !== null && `${design} design`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (action === "autopilot_iteration") {
    const stage = typeof m.stage === "string" ? m.stage : null;
    const status = typeof m.status === "string" ? m.status : null;
    const reason = typeof m.reason === "string" ? m.reason : null;
    return [stage, status, reason].filter(Boolean).join(" · ") || null;
  }

  // Fallback: show variation name if present.
  const variation =
    typeof m.variation_name === "string"
      ? (m.variation_name as string)
      : null;
  return variation;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}
