// ── EdgeTimingSection (Phase 6) ───────────────────────────────────
//
// Compact "Timing" chip for the edge detail drawer. Shows the
// Phase 3 pooled timing for one edge:
//   • Onset / Peak / Persistence days with p10/p90 ranges
//   • Decay kinetics modal
//   • Evidence count + heterogeneity badge
//   • Citation chips (when temporal_evidence_ids present)
//
// Drop-in: pass the row directly. Renders nothing when the edge has
// no temporal pool (consumers get a "nothing yet" blank instead of
// a misleading empty card).

"use client";

import type { Database } from "@/types/database.types";

type EdgeRow = Database["public"]["Tables"]["edges"]["Row"];

const HETEROGENEITY_LABELS: Array<[number, string, string]> = [
  // [threshold, label, color]
  [0.25, "Low heterogeneity", "#34C759"],
  [0.5, "Moderate heterogeneity", "#FF9500"],
  [0.75, "High heterogeneity", "#FF3B30"],
  [1.0, "Very high heterogeneity", "#FF2D55"],
];

const DECAY_LABELS: Record<string, string> = {
  linear: "Linear decay",
  exponential: "Exponential decay",
  sustained: "Sustained",
  biphasic: "Biphasic decay",
  unknown: "Decay unknown",
};

export interface EdgeTimingSectionProps {
  edge: Pick<
    EdgeRow,
    | "onset_days_p50"
    | "onset_days_p10"
    | "onset_days_p90"
    | "peak_days_p50"
    | "peak_days_p10"
    | "peak_days_p90"
    | "persistence_days_p50"
    | "persistence_days_p10"
    | "persistence_days_p90"
    | "decay_kinetics_modal"
    | "temporal_evidence_count"
    | "temporal_heterogeneity_i2"
    | "temporal_evidence_ids"
    | "temporal_pooled_at"
  >;
}

export function EdgeTimingSection({ edge }: EdgeTimingSectionProps) {
  const hasAny =
    typeof edge.onset_days_p50 === "number" ||
    typeof edge.peak_days_p50 === "number" ||
    typeof edge.persistence_days_p50 === "number";

  if (!hasAny) return null;

  const heterogeneity = heterogeneityBadge(edge.temporal_heterogeneity_i2);
  const decayLabel = edge.decay_kinetics_modal
    ? DECAY_LABELS[edge.decay_kinetics_modal] ?? edge.decay_kinetics_modal
    : null;

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.02)",
        borderRadius: 12,
        padding: "16px 18px",
        marginTop: 16,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1,
          color: "#86868b",
          textTransform: "uppercase",
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>Timing</span>
        {edge.temporal_evidence_count ? (
          <span
            style={{
              fontWeight: 600,
              color: "#0071E3",
              background: "rgba(0,113,227,0.10)",
              padding: "2px 8px",
              borderRadius: 20,
              fontSize: 11,
              letterSpacing: 0,
            }}
          >
            {edge.temporal_evidence_count} stud
            {edge.temporal_evidence_count === 1 ? "y" : "ies"}
          </span>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        <TimingFigure
          label="Onset"
          p50={edge.onset_days_p50}
          p10={edge.onset_days_p10}
          p90={edge.onset_days_p90}
          color="#0071E3"
        />
        <TimingFigure
          label="Peak"
          p50={edge.peak_days_p50}
          p10={edge.peak_days_p10}
          p90={edge.peak_days_p90}
          color="#34C759"
        />
        <TimingFigure
          label="Persistence"
          p50={edge.persistence_days_p50}
          p10={edge.persistence_days_p10}
          p90={edge.persistence_days_p90}
          color="#AF52DE"
        />
      </div>

      {/* Decay + heterogeneity row */}
      {(decayLabel || heterogeneity) && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 12,
            flexWrap: "wrap",
          }}
        >
          {decayLabel && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "#86868b",
                background: "rgba(0,0,0,0.04)",
                padding: "4px 10px",
                borderRadius: 20,
              }}
            >
              {decayLabel}
            </span>
          )}
          {heterogeneity && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: heterogeneity.color,
                background: `${heterogeneity.color}14`,
                padding: "4px 10px",
                borderRadius: 20,
              }}
            >
              {heterogeneity.label} (I² ={" "}
              {edge.temporal_heterogeneity_i2!.toFixed(2)})
            </span>
          )}
        </div>
      )}

      {/* Pooled-at timestamp */}
      {edge.temporal_pooled_at && (
        <div
          style={{
            fontSize: 10,
            color: "#86868b",
            marginTop: 8,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          Pooled {formatPooledAt(edge.temporal_pooled_at)}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function TimingFigure({
  label,
  p50,
  p10,
  p90,
  color,
}: {
  label: string;
  p50: number | null;
  p10: number | null;
  p90: number | null;
  color: string;
}) {
  if (typeof p50 !== "number") {
    return (
      <div style={{ padding: "6px 0" }}>
        <div
          style={{
            fontSize: 10,
            color: "#86868b",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 14, color: "#86868b" }}>—</div>
      </div>
    );
  }
  const range =
    typeof p10 === "number" && typeof p90 === "number"
      ? `${formatDays(p10)} – ${formatDays(p90)}`
      : null;
  return (
    <div style={{ padding: "6px 0" }}>
      <div
        style={{
          fontSize: 10,
          color: "#86868b",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatDays(p50)}
      </div>
      {range && (
        <div
          style={{
            fontSize: 11,
            color: "#86868b",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {range}
        </div>
      )}
    </div>
  );
}

function formatDays(d: number): string {
  if (!Number.isFinite(d)) return "—";
  if (d >= 365) {
    const yrs = d / 365;
    return `${yrs.toFixed(1)}y`;
  }
  if (d >= 60) {
    const months = d / 30.44;
    return `${months.toFixed(1)}mo`;
  }
  if (d >= 14) {
    const weeks = d / 7;
    return `${weeks.toFixed(1)}wk`;
  }
  if (d >= 1) {
    return `${Math.round(d)}d`;
  }
  return `${d.toFixed(1)}d`;
}

function heterogeneityBadge(
  i2: number | null,
): { label: string; color: string } | null {
  if (typeof i2 !== "number" || !Number.isFinite(i2)) return null;
  for (const [threshold, label, color] of HETEROGENEITY_LABELS) {
    if (i2 <= threshold) return { label, color };
  }
  return { label: "Very high heterogeneity", color: "#FF2D55" };
}

function formatPooledAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
