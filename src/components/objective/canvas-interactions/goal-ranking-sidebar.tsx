"use client";

// ── Goal & alignment sidebar (dedicated, left edge) ───────────────
//
// The "where am I aiming + what matters" rail. A left-edge launcher opens a
// panel with two parts:
//   • Ultimate goal — the space's distilled objective (title + expandable
//     description), fetched server-side with the ranking.
//   • Live ranking — every board node scored by the alignment ranker
//     (/api/spaces/[id]/rank-nodes): convergent (commits toward the goal) vs
//     divergent (opens away), sorted by importance × alignment × quality.
//     Click a row → focus that card on the board.
//
// Mirrors the right-edge Library launcher (symmetric chrome). Self-contained;
// reads `editor` to enumerate nodes + focus, never mutates the board.

import { useEffect, useState, type CSSProperties } from "react";
import type { Editor, TLShapeId } from "tldraw";
import {
  Compass,
  X,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { shapeToScanTarget } from "./shape-node-adapter";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface RankedNode {
  id: string;
  direction: "convergent" | "divergent";
  score: number;
  reason: string;
}
interface RankData {
  goal: { title: string; description: string };
  ranked: RankedNode[];
}

/** A node's display label resolved from the board (the ranker only knows ids). */
function labelFor(editor: Editor, id: string): string {
  try {
    const s = editor.getShape(id as TLShapeId);
    if (!s) return "(removed)";
    const p = s.props as { title?: unknown; text?: unknown; subtitle?: unknown };
    const t =
      (typeof p.title === "string" && p.title) ||
      (typeof p.text === "string" && p.text) ||
      (typeof p.subtitle === "string" && p.subtitle) ||
      "Untitled";
    return String(t).replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";
  } catch {
    return "Untitled";
  }
}

/** Enumerate board nodes → POST the ranker → ranked data. No setState (so the
 *  open-effect's only side effect is the fetch). Returns null on failure. */
async function fetchRanking(editor: Editor, spaceId: string): Promise<RankData | null> {
  const seen = new Set<string>();
  const nodes: { id: string; text: string }[] = [];
  try {
    for (const s of editor.getCurrentPageShapes()) {
      const t = shapeToScanTarget(s);
      if (t?.shapeId && t.text?.trim() && !seen.has(t.shapeId)) {
        seen.add(t.shapeId);
        nodes.push({ id: t.shapeId, text: t.text });
      }
    }
  } catch {
    /* enumeration is best-effort */
  }
  try {
    const res = await fetch(`/api/spaces/${spaceId}/rank-nodes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodes }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as RankData;
    return {
      goal: json.goal ?? { title: "Your objective", description: "" },
      ranked: Array.isArray(json.ranked) ? json.ranked : [],
    };
  } catch {
    return null;
  }
}

function focusNode(editor: Editor, id: string) {
  try {
    editor.select(id as TLShapeId);
    const b = editor.getShapePageBounds(id as TLShapeId);
    if (b) editor.centerOnPoint({ x: b.midX, y: b.midY }, { animation: { duration: 300 } });
  } catch {
    /* best-effort */
  }
}

/** Fired by the top-right nav bar to open this rail (the launcher's own left
 *  pill is retired — the nav bar is the single trigger). */
export const OPEN_BOARD_GOAL_EVENT = "board:open-goal";

export function GoalLauncher({ spaceId, editor }: { spaceId: string; editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RankData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [descOpen, setDescOpen] = useState(false);

  // Opened from the consolidated nav bar (top-right).
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener(OPEN_BOARD_GOAL_EVENT, openIt);
    return () => window.removeEventListener(OPEN_BOARD_GOAL_EVENT, openIt);
  }, []);

  // Initial load on open (setData only in the .then callback — no synchronous
  // setState in the effect body).
  useEffect(() => {
    if (!open || data) return;
    let alive = true;
    fetchRanking(editor, spaceId).then((d) => {
      // Fall back to an empty result on failure so the panel never hangs on
      // the loading state (e.g. transient auth/network error).
      if (alive) setData(d ?? { goal: { title: "Your objective", description: "" }, ranked: [] });
    });
    return () => {
      alive = false;
    };
  }, [open, data, spaceId, editor]);

  const loading = open && data === null;

  function refresh() {
    setRefreshing(true);
    fetchRanking(editor, spaceId)
      .then((d) => {
        if (d) setData(d);
      })
      .finally(() => setRefreshing(false));
  }

  // The left-edge launcher pill is retired — the top-right nav bar opens this.
  if (!open) return null;

  const goal = data?.goal;
  const ranked = data?.ranked ?? [];
  // Group by direction (header once per group) instead of repeating the label
  // on every row; each group sorted by score desc.
  const groups = (["convergent", "divergent"] as const)
    .map((dir) => ({
      dir,
      label: dir === "convergent" ? "Converging" : "Diverging",
      accent: dir === "convergent" ? "#059669" : "#D97706",
      items: ranked
        .filter((r) => r.direction === dir)
        .sort((a, b) => b.score - a.score),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={panel}>
      {/* header */}
      <div style={header}>
        <Compass style={{ width: 15, height: 15, color: appleVibe.text.secondary }} strokeWidth={2.2} />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", color: appleVibe.text.primary }}>
          Goal &amp; alignment
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          <button type="button" title="Re-rank" onClick={refresh} disabled={refreshing} style={iconBtn}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} style={{ width: 14, height: 14 }} strokeWidth={2.2} />
          </button>
          <button type="button" title="Close" onClick={() => setOpen(false)} style={iconBtn}>
            <X style={{ width: 15, height: 15 }} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* goal */}
      <div style={{ padding: "11px 12px", borderBottom: "1px solid var(--glass-border)" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: appleVibe.text.faint, marginBottom: 4 }}>
          Ultimate goal
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, letterSpacing: "-0.01em", color: appleVibe.text.primary }}>
          {goal?.title ?? (loading ? "…" : "Your objective")}
        </div>
        {goal?.description && (
          <>
            <div
              style={{
                marginTop: 5,
                fontSize: 12,
                lineHeight: 1.45,
                color: appleVibe.text.tertiary,
                display: "-webkit-box",
                WebkitLineClamp: descOpen ? "unset" : 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {goal.description}
            </div>
            {goal.description.length > 140 && (
              <button
                type="button"
                onClick={() => setDescOpen((o) => !o)}
                style={{ marginTop: 3, border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: appleVibe.text.secondary, fontFamily: appleVibe.font.stack }}
              >
                {descOpen ? <ChevronDown style={{ width: 12, height: 12 }} strokeWidth={2.4} /> : <ChevronRight style={{ width: 12, height: 12 }} strokeWidth={2.4} />}
                {descOpen ? "Less" : "More"}
              </button>
            )}
          </>
        )}
      </div>

      {/* ranking */}
      <div style={{ padding: "9px 12px 4px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: appleVibe.text.faint }}>
          Live ranking
        </span>
        {ranked.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 600, color: appleVibe.text.faint }}>{ranked.length}</span>}
      </div>

      <div style={scrollArea}>
        {loading ? (
          <div style={emptyRow}><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Ranking the board…</div>
        ) : ranked.length === 0 ? (
          <div style={{ padding: "12px 4px", fontSize: 12.5, lineHeight: 1.4, color: appleVibe.text.tertiary }}>
            No nodes to rank yet — add cards/notes, then re-rank.
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.dir} style={{ marginBottom: 6 }}>
              <div style={sectionHeader}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: g.accent, flexShrink: 0 }} />
                <span style={{ color: g.accent }}>{g.label}</span>
                <span style={{ marginLeft: "auto", fontWeight: 600, color: appleVibe.text.faint }}>{g.items.length}</span>
              </div>
              {g.items.map((r) => {
                const score = Math.round(r.score * 100);
                const name = labelFor(editor, r.id);
                const bad = name === "(removed)" || name === "Untitled";
                const primary = bad && r.reason ? r.reason : name;
                const secondary = !bad && r.reason ? r.reason : "";
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => focusNode(editor, r.id)}
                    title="Focus on the board"
                    style={rowThin}
                    onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                      <span style={{ ...scoreCell, color: g.accent }}>{score}</span>
                      <span style={nameCell}>{primary}</span>
                    </span>
                    {secondary && <span style={reasonCell}>{secondary}</span>}
                    <span style={barTrack}>
                      <span style={{ ...barFill, width: `${score}%`, background: g.accent }} />
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── styles ──
const launcherPill: CSSProperties = {
  position: "absolute",
  top: 96,
  left: 16,
  zIndex: 66,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "7px 12px",
  borderRadius: appleVibe.radius.pill,
  border: "1px solid var(--glass-border)",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  fontSize: 11.5,
  fontWeight: 650,
  color: appleVibe.text.secondary,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 12px 30px -16px rgba(11,18,40,0.32)",
};
const panel: CSSProperties = {
  position: "absolute",
  // Start below the top chrome (tldraw Page menu + AI settings bar) so the
  // "Goal & alignment" header isn't hidden behind it — matches launcherPill.
  top: 64,
  bottom: 12,
  left: 12,
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
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 28px 60px -24px rgba(11,18,40,0.38)",
  fontFamily: appleVibe.font.stack,
};
const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 12px 9px",
  borderBottom: "1px solid var(--glass-border)",
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
const scrollArea: CSSProperties = { flex: 1, overflowY: "auto", padding: "0 12px 14px", minHeight: 0 };
const emptyRow: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "16px 4px", color: appleVibe.text.tertiary, fontSize: 12.5 };
const sectionHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 3px 5px",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};
const rowThin: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "6px 7px",
  marginBottom: 1,
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  background: "transparent",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const scoreCell: CSSProperties = {
  width: 24,
  flexShrink: 0,
  textAlign: "right",
  fontSize: 11.5,
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
};
const nameCell: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12.5,
  fontWeight: 600,
  color: appleVibe.text.primary,
  letterSpacing: "-0.01em",
};
const reasonCell: CSSProperties = {
  display: "block",
  marginLeft: 33,
  marginTop: 1,
  fontSize: 11,
  lineHeight: 1.3,
  color: appleVibe.text.tertiary,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const barTrack: CSSProperties = {
  display: "block",
  marginLeft: 33,
  marginTop: 4,
  height: 2,
  borderRadius: 999,
  background: appleVibe.surface.chip,
  overflow: "hidden",
};
const barFill: CSSProperties = { display: "block", height: "100%", borderRadius: 999 };
