"use client";

// ── Cluster Recommendations Overlay ──────────────────────────────────
//
// The translucent "now what?" hover that appears above a freshly generated
// CLUSTER on the board (today: Deep Synthesize hub + branches; soon:
// decompose, make_plan, variations). Listens for CLUSTER_GENERATED_EVENT,
// fetches /api/objective/[id]/cluster-next-move, and renders a glass card
// anchored above the cluster's bounding box with:
//   • a primary recommended op (large pill) — the LLM's pick for the
//     single highest-leverage next move, given which intake factors the
//     cluster covers and which remain uncovered (priority-ranked).
//   • up to two secondary moves (small chips).
// Clicking a pill selects the cluster's hub shape and dispatches
// `objective-board:run-recommended-op` — whiteboard-base catches that and
// routes to `executeCardOperation` so the overlay never has to know about
// the executor itself (single responsibility: surface + dispatch).
//
// Auto-dismiss: outside click, Escape, after 45s, OR when another cluster
// generates (the new one takes the surface). Re-anchors to the cluster
// every animation frame so a pan/zoom keeps the hover glued in place.
//
// Soft: a fetch failure or null primary recommendation hides the overlay
// silently — the user gets no "couldn't recommend" toast (it's a nudge,
// not a feature; failing silently is the correct UX).

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  CLUSTER_GENERATED_EVENT,
  type ClusterGeneratedDetail,
} from "./synthesis-map";

/** Event the overlay dispatches when the user picks a recommended op.
 *  Whiteboard-base listens, selects the hub shape, and calls
 *  executeCardOperation with the op id. Keeps the overlay decoupled from
 *  the executor (which would import a lot of canvas-op surface area). */
export const RUN_RECOMMENDED_OP_EVENT =
  "objective-board:run-recommended-op" as const;
export interface RunRecommendedOpDetail {
  opId: string;
  hubShapeId: string;
  hubObjectId: string;
  /** Cluster context — passed back so the executor / downstream surfaces
   *  know which generation this move was recommended against. */
  branchObjectIds: string[];
  factorSlug: string;
  factorLabel: string;
}

interface Recommendation {
  op: string;
  label: string;
  rationale: string;
  factorLabel: string;
}
interface NextMoveResponse {
  primary: Recommendation | null;
  secondary: Recommendation[];
}

/** Pixel padding above the cluster bounds — the overlay floats this far
 *  above the topmost shape. Big enough to clear the dashed Proposed border
 *  + Keep/Dismiss footer without crowding. */
const ANCHOR_GAP = 28;
const OVERLAY_W = 360;
const AUTO_DISMISS_MS = 45_000;

interface ActiveCluster extends ClusterGeneratedDetail {
  /** ms epoch (Date.now equivalent — we just use performance.now via
   *  setTimeout's relative semantics) for auto-dismiss. */
  generatedAt: number;
}

export function ClusterRecommendationsMount({
  editor,
  spaceId,
}: {
  editor: Editor;
  spaceId: string;
}) {
  const [cluster, setCluster] = useState<ActiveCluster | null>(null);
  const [rec, setRec] = useState<NextMoveResponse | null>(null);
  const [loading, setLoading] = useState(false);
  // Live screen position — updated every frame so the overlay tracks pan/zoom.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dismissTimer = useRef<number | null>(null);

  /** Reset all state in one place — used by every dismissal path so we never
   *  leak a half-cleared overlay (rec without cluster, etc.). */
  function dismiss() {
    setCluster(null);
    setRec(null);
    setPos(null);
    setLoading(false);
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  }

  // Subscribe to the cluster-generated signal. A second cluster while one is
  // showing replaces it — the new generation IS the current "now what?".
  useEffect(() => {
    function onCluster(e: Event) {
      const detail = (e as CustomEvent<ClusterGeneratedDetail>).detail;
      if (!detail || !detail.hubShapeId || !detail.hubObjectId) return;
      dismiss();
      setCluster({ ...detail, generatedAt: performance.now() });
      // Schedule the soft auto-dismiss so an idle overlay doesn't sit
      // forever; pick a long-enough window that a user reading the rationale
      // doesn't lose it mid-read.
      dismissTimer.current = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    }
    window.addEventListener(CLUSTER_GENERATED_EVENT, onCluster);
    return () => {
      window.removeEventListener(CLUSTER_GENERATED_EVENT, onCluster);
      if (dismissTimer.current !== null)
        window.clearTimeout(dismissTimer.current);
    };
    // dismiss is stable enough — eslint exhaustive-deps would force us to
    // memoize for no benefit. We re-mount in dev only.
  }, []);

  // Fetch recommendations once per cluster. Hub object id is required (the
  // route returns {primary:null,…} otherwise — caught by the early-return
  // below). Aborted on dismiss / replace via AbortController.
  useEffect(() => {
    if (!cluster) return;
    const ctrl = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/objective/${spaceId}/cluster-next-move`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: cluster.kind,
              hubObjectId: cluster.hubObjectId,
              branchObjectIds: cluster.branchObjectIds,
              factorSlugs: cluster.factorSlugs,
            }),
            signal: ctrl.signal,
          },
        );
        if (!res.ok) {
          // Soft-fail: the overlay just doesn't render the recommendations.
          // No toast, no spinner — the hover is a nudge, not a feature.
          setRec({ primary: null, secondary: [] });
          return;
        }
        const data = (await res.json()) as NextMoveResponse;
        if (!ctrl.signal.aborted) setRec(data);
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError")
          setRec({ primary: null, secondary: [] });
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [cluster, spaceId]);

  // Re-anchor every frame so a pan/zoom keeps the hover glued to the cluster.
  // We compute the union bounds of every shape in the cluster, pageToScreen
  // the top-center, and place the overlay above with ANCHOR_GAP. If the
  // cluster is dragged off-screen, we hide (top < 0) — the overlay isn't a
  // tooltip, no value in chasing it forever.
  useEffect(() => {
    if (!cluster) return;
    let raf = 0;
    const ids = [
      cluster.hubShapeId as TLShapeId,
      ...cluster.branchShapeIds.map((s) => s as TLShapeId),
    ];
    function tick() {
      const boundsList = ids
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is NonNullable<typeof b> => !!b);
      if (boundsList.length === 0) {
        // Cluster was deleted — dismiss.
        dismiss();
        return;
      }
      const minX = Math.min(...boundsList.map((b) => b.minX));
      const maxX = Math.max(...boundsList.map((b) => b.maxX));
      const minY = Math.min(...boundsList.map((b) => b.minY));
      const midX = (minX + maxX) / 2;
      const topPage = { x: midX, y: minY };
      const top = editor.pageToScreen(topPage);
      const next = {
        left: top.x - OVERLAY_W / 2,
        top: top.y - ANCHOR_GAP - 200, // ~ overlay height; clamped below
      };
      // Clamp to viewport so it never floats off the top edge.
      next.top = Math.max(12, Math.min(window.innerHeight - 60, next.top));
      next.left = Math.max(
        12,
        Math.min(window.innerWidth - OVERLAY_W - 12, next.left),
      );
      setPos((cur) =>
        cur && Math.abs(cur.left - next.left) < 0.5 && Math.abs(cur.top - next.top) < 0.5
          ? cur
          : next,
      );
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cluster, editor]);

  // Escape + outside-click dismissal (outside = anywhere not the overlay).
  useEffect(() => {
    if (!cluster) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    function onDown(e: MouseEvent) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-cluster-rec-overlay]")) return;
      dismiss();
    }
    window.addEventListener("keydown", onKey);
    // capture phase so we beat tldraw's pointer listeners
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [cluster]);

  if (!cluster || !pos) return null;

  function runOp(opId: string, factorLabel: string) {
    if (!cluster) return;
    // Select the hub so any downstream op that reads "selection" gets the
    // right target. The op event carries the explicit ids too, so the
    // executor can use them directly if it wants.
    try {
      editor.select(cluster.hubShapeId as TLShapeId);
    } catch {
      /* ignore — selection is a courtesy, not required */
    }
    window.dispatchEvent(
      new CustomEvent<RunRecommendedOpDetail>(RUN_RECOMMENDED_OP_EVENT, {
        detail: {
          opId,
          hubShapeId: cluster.hubShapeId,
          hubObjectId: cluster.hubObjectId,
          branchObjectIds: cluster.branchObjectIds,
          factorSlug: "",
          factorLabel,
        },
      }),
    );
    dismiss();
  }

  const accent = cluster.color || appleVibe.accent.primary;
  const primary = rec?.primary;
  const secondary = rec?.secondary ?? [];

  return (
    <div
      data-cluster-rec-overlay
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: OVERLAY_W,
        pointerEvents: "all",
        zIndex: 9000,
        // Glass — translucent, blurred so it reads as a contextual hint
        // sitting OVER the cluster, not a chrome panel competing with it.
        background: "rgba(255,255,255,0.78)",
        backdropFilter: "blur(18px) saturate(180%)",
        WebkitBackdropFilter: "blur(18px) saturate(180%)",
        borderRadius: 18,
        border: `1px solid ${accent}28`,
        boxShadow: `0 1px 2px rgba(11,18,40,0.04), 0 18px 48px -16px ${accent}40, 0 8px 22px -10px rgba(11,18,40,0.16)`,
        padding: "12px 13px 12px",
        fontFamily:
          '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
      }}
    >
      {/* Header — provenance eyebrow + dismiss. */}
      <div style={headerRow}>
        <Sparkles
          style={{ width: 12, height: 12, color: accent }}
          strokeWidth={2.4}
        />
        <span style={{ ...eyebrowText, color: accent }}>
          Recommended next move
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss recommendation"
          style={dismissBtn}
        >
          <X
            style={{ width: 12, height: 12, color: appleVibe.text.tertiary }}
            strokeWidth={2.4}
          />
        </button>
      </div>

      {/* Primary recommendation OR skeleton. We render BOTH possible states
          inside the same shell so the overlay never visually pops between
          "empty card" and "filled card" — only the inner row changes. */}
      {loading || !rec ? (
        <SkeletonRows accent={accent} />
      ) : !primary ? (
        // No usable recommendation came back — dismiss after a beat rather
        // than render an empty card the user can't act on.
        <DismissAfter ms={1200} onDone={dismiss} />
      ) : (
        <>
          <button
            type="button"
            onClick={() => runOp(primary.op, primary.factorLabel)}
            style={{ ...primaryPill, background: accent, boxShadow: `0 4px 12px -3px ${accent}88` }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
              <span style={{ fontSize: 12.5, fontWeight: 650 }}>{primary.label}</span>
              <span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.86, lineHeight: 1.32 }}>
                {primary.rationale}
              </span>
            </span>
            <ArrowRight style={{ width: 14, height: 14, flexShrink: 0 }} strokeWidth={2.4} />
          </button>

          {/* Factor chip — what this move advances. Mirrors the insight-card
              eyebrow chip language so the trace-back reads as one system. */}
          {primary.factorLabel && (
            <div style={factorChipRow}>
              <span
                title={`Advances: ${primary.factorLabel}`}
                style={{
                  ...factorChip,
                  border: `1px solid ${accent}30`,
                  background: `${accent}10`,
                }}
              >
                {primary.factorLabel}
              </span>
            </div>
          )}

          {secondary.length > 0 && (
            <div style={secondaryRow}>
              {secondary.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => runOp(s.op, s.factorLabel)}
                  title={s.rationale || s.label}
                  style={{
                    ...secondaryChip,
                    border: `1px solid ${accent}30`,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Two-row shimmer while the recommendation is in flight. Kept simple — a
 *  full skeleton library would be overkill for ~1s of latency. */
function SkeletonRows({ accent }: { accent: string }) {
  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          height: 48,
          borderRadius: 14,
          background: `linear-gradient(90deg, ${accent}10, ${accent}20, ${accent}10)`,
          backgroundSize: "200% 100%",
          animation: "clusterRecShimmer 1.4s infinite",
        }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <div
          style={{
            flex: 1,
            height: 22,
            borderRadius: 999,
            background: `${accent}12`,
          }}
        />
        <div
          style={{
            flex: 1,
            height: 22,
            borderRadius: 999,
            background: `${accent}12`,
          }}
        />
      </div>
      <style>{`@keyframes clusterRecShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  );
}

/** Schedules dismissal after `ms` — used when the LLM returned nothing
 *  usable so we don't render a sad empty card permanently. */
function DismissAfter({ ms, onDone }: { ms: number; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(t);
  }, [ms, onDone]);
  return null;
}

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};
const eyebrowText: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: "0.02em",
};
const dismissBtn: CSSProperties = {
  marginLeft: "auto",
  width: 22,
  height: 22,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  borderRadius: 999,
  background: "rgba(15,23,42,0.04)",
  cursor: "pointer",
  padding: 0,
};
const primaryPill: CSSProperties = {
  marginTop: 10,
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "10px 13px",
  borderRadius: 14,
  border: "none",
  cursor: "pointer",
  color: "white",
};
const factorChipRow: CSSProperties = {
  marginTop: 8,
  display: "flex",
};
const factorChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.02em",
  color: appleVibe.text.secondary,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const secondaryRow: CSSProperties = {
  marginTop: 8,
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};
const secondaryChip: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "6px 10px",
  borderRadius: 999,
  cursor: "pointer",
  background: "rgba(255,255,255,0.6)",
  color: appleVibe.text.primary,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
