"use client";

// ── BrainstormSessionRoom ──
//
// Renders one brainstorm_sessions row (Synergy track) docked as a room.
// The room_config carries:
//   - session_id (uuid)
//   - title      (cached at creation time so we have something to show
//                 even before the GET resolves)
//
// On mount we fetch the session + nodes via /api/synergy/sessions/[id].
// The body has two views, toggled in the header:
//   - List  → up to 8 nodes inline with kind chips (compact reading).
//   - Graph → the brainstorm's own node-link diagram, laid out from the
//             stored x/y positions with parent→child edges. This is the
//             brainstorm's underlying graph, visualized in place.
//
// A "Materialize → KG" button runs the session's nodes through the same
// noun-phrase extractor scratch notes use, staging entity candidates
// into the Lab KG (the middle panel). That's the bridge from a
// brainstorm to the knowledge graph — previously this room was
// display-only.
//
// Refresh is manual (a small ↻ button) — brainstorms are typically
// finished by the time you add them as a room, so background polling
// would be wasteful.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { RoomBodyProps } from "./room-registry";
import { colors, tracking } from "../tokens";

interface BrainstormNode {
  id: string;
  kind: string;
  label: string;
  meta: string | null;
  parent_id: string | null;
  x: number;
  y: number;
}

interface BrainstormSession {
  id: string;
  title: string;
  objective_statement: string | null;
  state: string;
  updated_at: string;
}

const KIND_COLOR: Record<string, string> = {
  core: colors.brand.fg,
  branch: colors.layer.conceptual,
  insight: colors.state.leverage,
  question: colors.layer.external,
  action: colors.state.ok,
  user: colors.layer.internal,
  variation: colors.layer.bridge,
  ranking: colors.state.cycle,
};

// Graph canvas geometry. Compact enough to sit inside a room body but
// tall enough that a small tree reads clearly.
const GRAPH_W = 320;
const GRAPH_H = 184;
const GRAPH_PAD = 16;
// Above this node count we drop labels and rely on hover titles so the
// mini-graph doesn't turn into a wall of overlapping text.
const LABEL_LIMIT = 24;

interface PlacedNode extends BrainstormNode {
  px: number;
  py: number;
}

/** Project stored x/y into the compact viewBox. Pure — recomputed only
 *  when the node set changes. */
function layoutNodes(nodes: BrainstormNode[]): {
  placed: PlacedNode[];
  edges: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>;
} {
  if (nodes.length === 0) return { placed: [], edges: [] };

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const placed: PlacedNode[] = nodes.map((n) => ({
    ...n,
    px: GRAPH_PAD + ((n.x - minX) / spanX) * (GRAPH_W - 2 * GRAPH_PAD),
    py: GRAPH_PAD + ((n.y - minY) / spanY) * (GRAPH_H - 2 * GRAPH_PAD),
  }));

  const byId = new Map(placed.map((p) => [p.id, p]));
  const edges: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }> = [];
  for (const node of placed) {
    if (!node.parent_id) continue;
    const parent = byId.get(node.parent_id);
    if (!parent) continue;
    edges.push({ id: node.id, x1: parent.px, y1: parent.py, x2: node.px, y2: node.py });
  }

  return { placed, edges };
}

export function BrainstormSessionRoom({
  spaceId,
  roomId,
  roomConfig,
  onMaterialized,
}: RoomBodyProps) {
  const sessionId =
    typeof roomConfig?.session_id === "string" ? roomConfig.session_id : null;
  const cachedTitle =
    typeof roomConfig?.title === "string" ? roomConfig.title : "Brainstorm";

  const [session, setSession] = useState<BrainstormSession | null>(null);
  const [nodes, setNodes] = useState<BrainstormNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "graph">("list");

  // ── Materialize state (mirrors scratch-note-room) ──────────────────
  const [materializeStatus, setMaterializeStatus] = useState<
    "idle" | "working" | "error"
  >("idle");
  const [materializeError, setMaterializeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/synergy/sessions/${sessionId}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        session: BrainstormSession;
        nodes: BrainstormNode[];
      };
      setSession(json.session ?? null);
      const loaded = json.nodes ?? [];
      setNodes(loaded);
      // Default to the graph view when there's actually a graph to show
      // (≥2 nodes with at least one parent link); otherwise the list.
      const ids = new Set(loaded.map((n) => n.id));
      const hasEdges = loaded.some((n) => n.parent_id && ids.has(n.parent_id));
      setView(hasEdges ? "graph" : "list");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { placed, edges } = useMemo(() => layoutNodes(nodes), [nodes]);

  const canMaterialize =
    nodes.length > 0 && materializeStatus !== "working" && !loading;

  const materialize = useCallback(async () => {
    if (!canMaterialize) return;
    setMaterializeStatus("working");
    setMaterializeError(null);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/lab-rooms/${roomId}/materialize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { batchId?: string; staged?: number };
      setMaterializeStatus("idle");
      if (body.batchId && onMaterialized) {
        onMaterialized(body.batchId);
      }
    } catch (err) {
      setMaterializeStatus("error");
      setMaterializeError(err instanceof Error ? err.message : String(err));
    }
  }, [canMaterialize, spaceId, roomId, onMaterialized]);

  if (!sessionId) {
    return (
      <div className="p-3 text-[12px]" style={{ color: colors.state.risk }}>
        Brainstorm room is missing a session_id. Try removing and re-adding it.
      </div>
    );
  }

  const visibleNodes = nodes.slice(0, 8);
  const overflow = Math.max(0, nodes.length - visibleNodes.length);
  const title = session?.title ?? cachedTitle;
  const objective = session?.objective_statement ?? null;
  const showLabels = placed.length <= LABEL_LIMIT;

  return (
    <div className="px-3 py-2.5">
      {/* Header line: title + open-original + refresh */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className="truncate text-[12px] font-semibold"
            style={{ color: colors.neutral.fg900 }}
            title={title}
          >
            {title}
          </div>
          {objective ? (
            <div
              className="mt-0.5 line-clamp-2 text-[11px] leading-snug"
              style={{ color: colors.neutral.fg500 }}
            >
              {objective}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded p-1 text-[10px] transition hover:bg-black/5"
            style={{ color: colors.neutral.fg500 }}
            title="Refresh"
            disabled={loading}
          >
            {loading ? "…" : "↻"}
          </button>
          <Link
            href={`/app/synergy/${sessionId}`}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium transition hover:bg-black/5"
            style={{ color: colors.brand.fg }}
            title="Open the full brainstorm board"
          >
            Open →
          </Link>
        </div>
      </div>

      {/* Controls row: List ⇄ Graph toggle + Materialize action */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div
          className="inline-flex items-center rounded-full p-0.5"
          style={{ background: colors.neutral.chipBg }}
        >
          {(["list", "graph"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize transition"
              style={{
                background: view === v ? "white" : "transparent",
                color: view === v ? colors.neutral.fg900 : colors.neutral.fg400,
                boxShadow: view === v ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                letterSpacing: tracking.eyebrowTight,
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void materialize()}
          disabled={!canMaterialize}
          title={
            nodes.length === 0
              ? "No nodes to materialize"
              : materializeStatus === "working"
              ? "Extracting candidates…"
              : "Extract entity candidates from this brainstorm into the KG"
          }
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all"
          style={{
            background: canMaterialize
              ? colors.brand.gradient
              : colors.neutral.chipBg,
            color: canMaterialize ? "white" : colors.neutral.fg400,
            boxShadow: canMaterialize ? `0 3px 8px ${colors.brand.shadow}` : "none",
            opacity: materializeStatus === "working" ? 0.7 : 1,
            letterSpacing: tracking.eyebrowTight,
          }}
        >
          <span className="font-mono text-[11px] leading-none">✦</span>
          {materializeStatus === "working" ? "Extracting…" : "Materialize → KG"}
        </button>
      </div>

      {error ? (
        <div className="text-[11px]" style={{ color: colors.state.risk }}>
          {error}
        </div>
      ) : null}

      {/* Body: graph or list */}
      {nodes.length === 0 && !loading && !error ? (
        <div className="text-[11px]" style={{ color: colors.neutral.fg400 }}>
          No nodes captured yet in this session.
        </div>
      ) : view === "graph" ? (
        <div
          className="rounded-lg border"
          style={{
            borderColor: colors.neutral.borderInput,
            background: colors.neutral.chipBg,
          }}
        >
          <svg
            viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
            width="100%"
            height={GRAPH_H}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Brainstorm node graph"
          >
            {edges.map((e) => (
              <line
                key={e.id}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke={colors.neutral.fg400}
                strokeWidth={1}
                strokeOpacity={0.5}
              />
            ))}
            {placed.map((n) => (
              <g key={n.id}>
                <circle
                  cx={n.px}
                  cy={n.py}
                  r={n.kind === "core" ? 6 : 4}
                  fill={KIND_COLOR[n.kind] ?? colors.neutral.fg400}
                >
                  <title>{`${n.kind}: ${n.label}`}</title>
                </circle>
                {showLabels ? (
                  <text
                    x={n.px + 7}
                    y={n.py + 3}
                    fontSize={8.5}
                    fill={colors.neutral.fg700}
                  >
                    {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
                  </text>
                ) : null}
              </g>
            ))}
          </svg>
        </div>
      ) : (
        <ul className="space-y-1">
          {visibleNodes.map((n) => (
            <li
              key={n.id}
              className="flex items-start gap-2 rounded-md px-1.5 py-1 transition hover:bg-black/[0.025]"
            >
              <span
                className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: KIND_COLOR[n.kind] ?? colors.neutral.fg400,
                }}
                title={n.kind}
              />
              <div className="min-w-0">
                <div
                  className="text-[12px] leading-snug"
                  style={{ color: colors.neutral.fg700 }}
                >
                  {n.label}
                </div>
                {n.meta ? (
                  <div
                    className="line-clamp-1 text-[10.5px]"
                    style={{ color: colors.neutral.fg400 }}
                  >
                    {n.meta}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
          {overflow > 0 ? (
            <div
              className="mt-1.5 text-[10.5px]"
              style={{ color: colors.neutral.fg400 }}
            >
              +{overflow} more — open the board to see all
            </div>
          ) : null}
        </ul>
      )}

      {/* Materialize error strip */}
      {materializeStatus === "error" && materializeError ? (
        <div
          className="mt-1.5 rounded-md px-2 py-1 text-[10px] font-semibold"
          style={{
            background: colors.state.bottleneckSoft,
            color: colors.state.bottleneckFgChip,
          }}
        >
          ⚠ {materializeError}
        </div>
      ) : null}
    </div>
  );
}
