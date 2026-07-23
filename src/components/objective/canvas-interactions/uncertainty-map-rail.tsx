"use client";

// ── UncertaintyMapRail ───────────────────────────────────────────────
//
// The right-edge home for the auto-detected uncertainty map (#17). Same
// geometry + glass treatment as PowerupRail so the two read as one family.
//
// Fetches /api/spaces/[id]/uncertainty-map on open (and on demand), then
// renders the space's own graph coloured by heat = centrality × residual
// uncertainty. The hot spots listed underneath are the ones that become open
// questions — this is what replaces the fixed ten-zone ambiguity heatmap.

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { usePanel, setPanel } from "@/lib/objective-canvas/board-panel-signal";
import { Loader2, X } from "@/lib/cute-icons";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { UncertaintyMap } from "@/components/canvas/uncertainty-map";
import type { UncertaintyMapResponse } from "@/app/api/spaces/[id]/uncertainty-map/route";

export function UncertaintyMapRail({ spaceId }: { spaceId: string }) {
  const open = usePanel("map");
  const [data, setData] = useState<UncertaintyMapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/uncertainty-map`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setData((await res.json()) as UncertaintyMapResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the map");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (open && !data && !loading) void load();
    // Intentionally not depending on `data`/`loading` — this fires once per
    // open, and the Refresh button covers deliberate re-reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, load]);

  if (!open) return null;

  const hotIds = data?.hotSpots.map((h) => h.entityId) ?? [];

  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={rail}>
      <div style={header}>
        <span style={titleText}>Uncertainty map</span>
        <button
          type="button"
          title="Recompute"
          onClick={() => void load()}
          style={linkBtn}
        >
          Refresh
        </button>
        <button
          type="button"
          title="Close"
          onClick={() => setPanel("map", false)}
          style={iconBtn}
        >
          <X style={{ width: 15, height: 15 }} strokeWidth={2.2} />
        </button>
      </div>

      <div style={scroll}>
        {loading && (
          <div style={centerRow}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
            <span>Reading the graph…</span>
          </div>
        )}

        {err && !loading && (
          <div style={errBox}>
            {err}
            <button type="button" onClick={() => void load()} style={retryBtn}>
              Try again
            </button>
          </div>
        )}

        {data && !loading && !err && (
          <>
            <p style={helper}>
              Every concept in this space, scored by how central it is and how
              unresolved it still is. Nothing here is a preset category.
            </p>

            <UncertaintyMap
              graph={data.graph}
              hotSpotIds={hotIds}
              allEstimated={data.allEstimated}
              selectedId={selected}
              onSelect={(id) => setSelected((c) => (c === id ? null : id))}
            />

            <div style={hairline} />
            <div style={sectionLabel}>
              HOT SPOTS
              <span style={countChip}>{data.hotSpots.length}</span>
            </div>

            {data.hotSpots.length === 0 ? (
              <p style={helper}>
                No hot spots yet. That happens when the graph has no
                connections to weigh, or nothing is left uncertain — it is not
                padded to a fixed number.
              </p>
            ) : (
              data.hotSpots.map((h) => (
                <button
                  key={h.entityId}
                  type="button"
                  onClick={() =>
                    setSelected((c) => (c === h.entityId ? null : h.entityId))
                  }
                  style={{
                    ...hotRow,
                    borderColor:
                      selected === h.entityId
                        ? appleVibe.accent.primary
                        : "transparent",
                  }}
                >
                  <span
                    style={{
                      ...dot,
                      background: `color-mix(in srgb, var(--av-stage-pain) ${Math.round(
                        (h.heat / (data.hotSpots[0]?.heat || 1)) * 100,
                      )}%, var(--av-text-faint))`,
                    }}
                  />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={hotLabel}>{h.label}</span>
                    <span style={hotMeta}>
                      {Math.round(h.centrality * 100)}% central ·{" "}
                      {Math.round(h.uncertainty * 100)}% unsure
                      {h.estimated ? " · estimated" : ""}
                    </span>
                  </span>
                </button>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── styles (mirrors powerup-rail geometry) ──
const rail: CSSProperties = {
  position: "absolute",
  top: 64,
  bottom: 12,
  right: 16,
  width: 340,
  zIndex: 92,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  borderRadius: appleVibe.radius.lg,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  border: "1px solid var(--glass-border)",
  boxShadow:
    "inset 0 1px 0 var(--glass-highlight), 0 28px 60px -24px rgba(11,18,40,0.38)",
  fontFamily: appleVibe.font.stack,
};
const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 12px 9px",
  borderBottom: "1px solid var(--glass-border)",
};
const titleText: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: appleVibe.text.primary,
  flex: 1,
};
const iconBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: appleVibe.text.tertiary,
};
const linkBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 11.5,
  fontWeight: 600,
  color: appleVibe.text.tertiary,
  padding: "2px 4px",
};
const scroll: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 14px 18px",
  minHeight: 0,
};
const helper: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.45,
  color: appleVibe.text.tertiary,
  letterSpacing: "-0.005em",
  margin: "0 0 10px",
};
const hairline: CSSProperties = {
  height: 1,
  background: "var(--glass-border)",
  margin: "14px 0 10px",
};
const sectionLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: appleVibe.text.tertiary,
  marginBottom: 8,
};
const countChip: CSSProperties = {
  fontSize: 10.5,
  letterSpacing: 0,
  fontWeight: 600,
  color: appleVibe.text.secondary,
  background: appleVibe.surface.chip,
  borderRadius: appleVibe.radius.pill,
  padding: "1px 7px",
};
const hotRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 9,
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  background: appleVibe.surface.chip,
  cursor: "pointer",
  marginBottom: 6,
  fontFamily: appleVibe.font.stack,
};
const dot: CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: "50%",
  flexShrink: 0,
  marginTop: 4,
};
const hotLabel: CSSProperties = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 600,
  color: appleVibe.text.primary,
  letterSpacing: "-0.01em",
};
const hotMeta: CSSProperties = {
  display: "block",
  marginTop: 2,
  fontSize: 11,
  color: appleVibe.text.tertiary,
};
const centerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  justifyContent: "center",
  padding: "28px 0",
  fontSize: 12.5,
  color: appleVibe.text.tertiary,
};
const errBox: CSSProperties = {
  padding: "11px 13px",
  borderRadius: 9,
  borderLeft: `2.5px solid ${appleVibe.stage.pain}`,
  background: appleVibe.surface.chip,
  fontSize: 12,
  lineHeight: 1.5,
  color: appleVibe.text.secondary,
};
const retryBtn: CSSProperties = {
  display: "block",
  marginTop: 8,
  border: "none",
  background: "transparent",
  padding: 0,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  color: appleVibe.text.primary,
  textDecoration: "underline",
};
