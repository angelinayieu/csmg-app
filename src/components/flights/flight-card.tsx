// ── FlightCard (Phase 6) ─────────────────────────────────────────
//
// Gallery card matching the user's second reference image: name +
// category chip + 1-line description + horizontal entity sequence
// (color-coded by group) + step count + date.
//
// This component is presentational. The flight row carries:
//   - name, description, category
//   - steps_entity_ids (resolved to entity name + layer/category by
//     the parent — we accept a `stepEntities` array)
//   - phases (when set, surfaced as small phase pills below the
//     entity sequence)
//
// Click-through behavior is the parent's responsibility (link to a
// detail page, drawer, or canvas highlight).

"use client";

import Link from "next/link";

// `flights` is not tracked in database.types.ts (same convention as
// evidence_registries — newer tables aren't auto-regenerated yet).
// Local type mirrors migration 20260626_flights.sql; widen to
// Database["public"]["Tables"]["flights"]["Row"] once types are
// regenerated.
export interface FlightRow {
  id: string;
  space_id: string;
  user_id: string;
  name: string;
  description: string | null;
  category: string | null;
  steps_entity_ids: string[];
  steps_edge_ids: string[];
  origin:
    | "auto_critical_path"
    | "auto_root_trace"
    | "template_seeded"
    | "user_curated";
  template_seed_id: string | null;
  status: "draft" | "active" | "archived";
  total_peak_days: number | null;
  total_persistence_days: number | null;
  joint_probability: number | null;
  evidence_count: number;
  heterogeneity_i2: number | null;
  phases: unknown;
  score_breakdown: unknown;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

// ── Color palette ────────────────────────────────────────────────
//
// Category → hex pair (chip background + text). Open vocab (matches
// what cognition-template ships); falls back to neutral gray.
const CATEGORY_COLORS: Record<string, { bg: string; fg: string }> = {
  inflammation: { bg: "rgba(255,59,48,0.10)", fg: "#FF3B30" },
  stress_axis: { bg: "rgba(175,82,222,0.10)", fg: "#AF52DE" },
  clearance: { bg: "rgba(0,122,255,0.10)", fg: "#0071E3" },
  neuroplasticity: { bg: "rgba(52,199,89,0.10)", fg: "#34C759" },
  nutritional: { bg: "rgba(255,149,0,0.10)", fg: "#FF9500" },
  proliferation: { bg: "rgba(255,149,0,0.10)", fg: "#FF9500" },
  survival: { bg: "rgba(52,199,89,0.10)", fg: "#34C759" },
  apoptosis: { bg: "rgba(255,45,85,0.10)", fg: "#FF2D55" },
  regulation: { bg: "rgba(0,122,255,0.10)", fg: "#0071E3" },
};

function categoryStyle(cat: string | null) {
  if (cat && CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
  return { bg: "rgba(0,0,0,0.06)", fg: "#86868b" };
}

// Entity layer → chip color (mirror cognition layers).
const LAYER_COLORS: Record<string, string> = {
  exogenous: "#DC2626",
  behaviors: "#34C759",
  biomarkers: "#AF52DE",
  pathways: "#0071E3",
  symptoms: "#06B6D4",
  cognitive: "#60A5FA",
  composite: "#FF9500",
};

export interface FlightCardEntity {
  id: string;
  name: string;
  layer: string | null;
  /** entity_category — used as fallback color when layer is null. */
  category: string | null;
}

export interface FlightCardProps {
  flight: FlightRow;
  /** Hydrated entity rows in flight order. Length should equal
   *  flight.steps_entity_ids.length; missing entries render as
   *  "?" placeholders (entity dropped during sanitize). */
  stepEntities: FlightCardEntity[];
  /** Optional href; when set the whole card is a link. When unset,
   *  caller wires onClick separately. */
  href?: string;
  onClick?: () => void;
}

export function FlightCard({
  flight,
  stepEntities,
  href,
  onClick,
}: FlightCardProps) {
  const catStyle = categoryStyle(flight.category);
  const stepCount = flight.steps_entity_ids.length;
  const phaseCount = Array.isArray(flight.phases) ? flight.phases.length : 0;
  const dateLabel = formatDate(flight.created_at);

  const inner = (
    <div
      style={{
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        background: "rgba(255,255,255,0.72)",
        borderRadius: 18,
        border: "1px solid rgba(0,0,0,0.06)",
        padding: "24px 28px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
        transition: "all 0.2s ease",
        cursor: href || onClick ? "pointer" : "default",
      }}
      onMouseEnter={(e) => {
        if (!href && !onClick) return;
        e.currentTarget.style.boxShadow = "0 8px 30px rgba(0,0,0,0.08)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        if (!href && !onClick) return;
        e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.04)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <div>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 600,
              margin: "0 0 6px 0",
              letterSpacing: -0.3,
              color: "#1d1d1f",
            }}
          >
            {flight.name}
          </h3>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: catStyle.fg,
              background: catStyle.bg,
              padding: "2px 10px",
              borderRadius: 20,
              textTransform: "capitalize",
            }}
          >
            {flight.category?.replace(/_/g, " ") ?? "uncategorized"}
          </span>
        </div>
        <span style={{ fontSize: 12, color: "#86868b" }}>{dateLabel}</span>
      </div>

      {/* Description */}
      {flight.description && (
        <p
          style={{
            fontSize: 14,
            color: "#424245",
            lineHeight: 1.5,
            margin: "0 0 16px 0",
          }}
        >
          {flight.description}
        </p>
      )}

      {/* Entity sequence */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {stepEntities.map((ent, i) => {
          const color = layerColor(ent.layer ?? ent.category);
          return (
            <div
              key={`${ent.id}-${i}`}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <span
                style={{
                  padding: "4px 12px",
                  borderRadius: 8,
                  background: `${color}10`,
                  color,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {ent.name}
              </span>
              {i < stepEntities.length - 1 && (
                <span style={{ color: "#d2d2d7", fontSize: 16 }}>→</span>
              )}
            </div>
          );
        })}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 12,
            color: "#86868b",
            background: "rgba(0,0,0,0.04)",
            padding: "4px 12px",
            borderRadius: 20,
          }}
        >
          {stepCount} step{stepCount === 1 ? "" : "s"}
          {phaseCount > 0 ? ` · ${phaseCount} phase${phaseCount === 1 ? "" : "s"}` : ""}
        </span>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ display: "block", textDecoration: "none" }}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <div role="button" tabIndex={0} onClick={onClick}>
        {inner}
      </div>
    );
  }
  return inner;
}

function layerColor(layer: string | null): string {
  if (!layer) return "#86868b";
  return LAYER_COLORS[layer.toLowerCase()] ?? "#86868b";
}

function formatDate(iso: string): string {
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
