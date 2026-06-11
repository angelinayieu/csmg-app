"use client";

// Trove Map — the knowledge graph on a real tldraw whiteboard.
//
// "Talk to the agent through the whiteboard": the dock at the bottom sends
// your message to /api/trove/map-chat; the agent replies AND returns a board
// plan (clusters / causal flow / radial mind-map) that we draw as native
// tldraw shapes — so you can keep sketching, rearranging, and brainstorming
// on top with the full tldraw toolset.
//
// We only ever delete shapes WE drew (tracked in a ref), so your own
// sticky notes and doodles survive every redraw.

import { useCallback, useMemo, useRef, useState } from "react";
import { Tldraw, createShapeId, toRichText, type Editor, type TLShapeId } from "tldraw";
import "tldraw/tldraw.css";
import { useTrove } from "../_lib/store";
import type { MapPlanBoard, MapPlanResponse, TroveNode } from "../_lib/types";
import { KIND_EMOJI } from "../_lib/types";

type TlColor =
  | "black" | "grey" | "light-violet" | "violet" | "blue" | "light-blue"
  | "yellow" | "orange" | "green" | "light-green" | "light-red" | "red";

function hueToColor(hue: number): TlColor {
  const h = ((hue % 360) + 360) % 360;
  if (h < 18) return "light-red";
  if (h < 45) return "orange";
  if (h < 70) return "yellow";
  if (h < 105) return "light-green";
  if (h < 160) return "green";
  if (h < 205) return "light-blue";
  if (h < 255) return "blue";
  if (h < 290) return "violet";
  if (h < 335) return "light-violet";
  return "light-red";
}

interface ChatMsg {
  role: "user" | "agent";
  body: string;
}

const CARD_W = 250;
const CARD_H = 110;

export default function TroveMap() {
  const { nodes, collections, edges, loading } = useTrove();
  const editorRef = useRef<Editor | null>(null);
  const drawnIds = useRef<Set<TLShapeId>>(new Set());
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [reply, setReply] = useState<string | null>(null);
  const [boardTitle, setBoardTitle] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [drewOnce, setDrewOnce] = useState(false);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const clearDrawn = useCallback((editor: Editor) => {
    const ids = [...drawnIds.current].filter((id) => editor.getShape(id));
    if (ids.length) editor.deleteShapes(ids);
    drawnIds.current.clear();
  }, []);

  /** Create one knowledge card; returns its shape id. */
  const makeCard = useCallback(
    (
      editor: Editor,
      node: Pick<TroveNode, "id" | "title" | "kind" | "hue">,
      x: number,
      y: number,
      opts?: { w?: number; h?: number; color?: TlColor },
    ): TLShapeId => {
      const id = createShapeId();
      editor.createShapes([
        {
          id,
          type: "geo",
          x,
          y,
          props: {
            geo: "rectangle",
            w: opts?.w ?? CARD_W,
            h: opts?.h ?? CARD_H,
            color: opts?.color ?? hueToColor(node.hue),
            fill: "semi",
            dash: "solid",
            size: "s",
            font: "sans",
            richText: toRichText(`${KIND_EMOJI[node.kind] ?? "🧩"} ${node.title}`),
          },
          meta: { troveNodeId: node.id },
        },
      ]);
      drawnIds.current.add(id);
      return id;
    },
    [],
  );

  const makeLabel = useCallback(
    (editor: Editor, text: string, x: number, y: number, color: TlColor = "black", size: "m" | "l" | "xl" = "l") => {
      const id = createShapeId();
      editor.createShapes([
        {
          id,
          type: "text",
          x,
          y,
          props: { richText: toRichText(text), color, size, font: "sans", autoSize: true },
        },
      ]);
      drawnIds.current.add(id);
      return id;
    },
    [],
  );

  const makeArrow = useCallback(
    (
      editor: Editor,
      fromId: TLShapeId,
      toId: TLShapeId,
      label?: string,
      opts?: { dashed?: boolean; color?: TlColor },
    ) => {
      const arrowId = createShapeId();
      editor.createShapes([
        {
          id: arrowId,
          type: "arrow",
          props: {
            color: opts?.color ?? "grey",
            size: "s",
            dash: opts?.dashed ? "dashed" : "solid",
            arrowheadEnd: "arrow",
            ...(label ? { richText: toRichText(label) } : {}),
          },
        },
      ]);
      editor.createBindings([
        {
          fromId: arrowId,
          toId: fromId,
          type: "arrow",
          props: { terminal: "start", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
        },
        {
          fromId: arrowId,
          toId: toId,
          type: "arrow",
          props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
        },
      ]);
      drawnIds.current.add(arrowId);
    },
    [],
  );

  /** Render a board plan from the agent (or the local overview) onto the canvas. */
  const drawPlan = useCallback(
    (board: MapPlanBoard, planNodes: TroveNode[]) => {
      const editor = editorRef.current;
      if (!editor) return;
      const byId = new Map(planNodes.map((n) => [n.id, n]));
      const resolve = (id: string) => byId.get(id) ?? nodeById.get(id);

      editor.run(() => {
        clearDrawn(editor);
        const shapeFor = new Map<string, TLShapeId>();

        if (board.title) makeLabel(editor, board.title, 40, -90, "black", "xl");

        if (board.mode === "flow" && board.sequence.length) {
          board.sequence.forEach((nid, i) => {
            const n = resolve(nid);
            if (!n) return;
            const sid = makeCard(editor, n, i * (CARD_W + 110), 200 + (i % 2 === 0 ? 0 : 46));
            shapeFor.set(nid, sid);
          });
          for (let i = 0; i < board.sequence.length - 1; i++) {
            const a = shapeFor.get(board.sequence[i]);
            const b = shapeFor.get(board.sequence[i + 1]);
            if (a && b) makeArrow(editor, a, b, undefined, { color: "black" });
          }
        } else if (board.mode === "radial" && board.groups.length) {
          const centerId = board.groups[0]?.node_ids[0];
          const center = centerId ? resolve(centerId) : undefined;
          const cx = 700;
          const cy = 460;
          if (center) {
            const sid = makeCard(editor, center, cx - 150, cy - 70, {
              w: 300,
              h: 140,
              color: hueToColor(board.groups[0].hue),
            });
            shapeFor.set(center.id, sid);
          }
          const spokes: Array<{ nid: string; hue: number; groupLabel: string; first: boolean }> = [];
          board.groups.forEach((g, gi) => {
            const ids = gi === 0 ? g.node_ids.slice(1) : g.node_ids;
            ids.forEach((nid, i) => spokes.push({ nid, hue: g.hue, groupLabel: g.label, first: i === 0 }));
          });
          const R = Math.max(430, spokes.length * 46);
          spokes.forEach((s, i) => {
            const angle = (i / Math.max(1, spokes.length)) * Math.PI * 2 - Math.PI / 2;
            const x = cx + Math.cos(angle) * R - CARD_W / 2;
            const y = cy + Math.sin(angle) * (R * 0.72) - CARD_H / 2;
            const n = resolve(s.nid);
            if (!n) return;
            const sid = makeCard(editor, n, x, y, { color: hueToColor(s.hue) });
            shapeFor.set(s.nid, sid);
            if (s.first && spokes.length > 3) {
              makeLabel(
                editor,
                s.groupLabel,
                cx + Math.cos(angle) * (R + 190) - 60,
                cy + Math.sin(angle) * ((R + 190) * 0.72),
                hueToColor(s.hue),
                "m",
              );
            }
            const centerShape = center && shapeFor.get(center.id);
            if (centerShape) makeArrow(editor, centerShape, sid, undefined, { dashed: true });
          });
        } else {
          // clusters (default)
          const groups = board.groups.length
            ? board.groups
            : [{ label: "Everything", hue: 24, node_ids: planNodes.map((n) => n.id) }];
          groups.forEach((g, gi) => {
            const col = gi % 3;
            const row = Math.floor(gi / 3);
            const ox = col * 880;
            const oy = row * 660;
            makeLabel(editor, `${g.label}`, ox + 8, oy - 6, hueToColor(g.hue), "l");
            g.node_ids.slice(0, 8).forEach((nid, i) => {
              const n = resolve(nid);
              if (!n) return;
              const sid = makeCard(
                editor,
                n,
                ox + (i % 2) * (CARD_W + 26),
                oy + 64 + Math.floor(i / 2) * (CARD_H + 26),
                { color: hueToColor(g.hue) },
              );
              shapeFor.set(nid, sid);
            });
          });
        }

        for (const link of board.links ?? []) {
          const a = shapeFor.get(link.source_id);
          const b = shapeFor.get(link.target_id);
          if (a && b) makeArrow(editor, a, b, link.label || undefined);
        }
      });

      editor.zoomToFit({ animation: { duration: 360 } });
      setDrewOnce(true);
    },
    [clearDrawn, makeArrow, makeCard, makeLabel, nodeById],
  );

  /** Instant, LLM-free overview: islands per collection. */
  const drawOverview = useCallback(() => {
    const byCol = new Map<string, TroveNode[]>();
    for (const n of nodes) {
      const key = n.collection_id ?? "unfiled";
      if (!byCol.has(key)) byCol.set(key, []);
      byCol.get(key)!.push(n);
    }
    const groups = [...byCol.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 9)
      .map(([cid, ns]) => {
        const c = collections.find((x) => x.id === cid);
        return {
          label: c ? `${c.emoji ?? "🗂️"} ${c.name}` : "🧺 Unfiled",
          hue: c?.hue ?? 24,
          node_ids: ns.slice(0, 8).map((n) => n.id),
        };
      });
    // Surface existing edges between the drawn nodes.
    const shown = new Set(groups.flatMap((g) => g.node_ids));
    const links = edges
      .filter((e) => shown.has(e.source_id) && shown.has(e.target_id))
      .slice(0, 40)
      .map((e) => ({ source_id: e.source_id, target_id: e.target_id, label: e.label ?? e.relation.replace(/_/g, " ") }));
    drawPlan({ mode: "clusters", title: "Your trove — overview", groups, sequence: [], links }, nodes);
    setBoardTitle("Your trove — overview");
  }, [nodes, collections, edges, drawPlan]);

  const ask = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setBusy(true);
      setDraft("");
      setHistory((h) => [...h.slice(-7), { role: "user", body: message }]);
      try {
        const resp = await fetch("/api/trove/map-chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, history }),
        });
        const data: MapPlanResponse | null = await resp.json().catch(() => null);
        if (!resp.ok || !data) throw new Error(data?.error ?? "The map agent failed");
        setReply(data.reply);
        setHistory((h) => [...h.slice(-7), { role: "agent", body: data.reply }]);
        if (data.board && (data.board.groups.length || data.board.sequence.length)) {
          drawPlan(data.board, data.nodes ?? []);
          setBoardTitle(data.board.title);
        }
      } catch (e) {
        setReply(e instanceof Error ? e.message : "The map agent failed — try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, history, drawPlan],
  );

  return (
    <div className="tr-map-wrap">
      {boardTitle && <div className="tr-map-title">{boardTitle}</div>}
      <div className="tr-map-canvas">
        <Tldraw
          onMount={(editor) => {
            editorRef.current = editor;
            editor.user.updateUserPreferences({ colorScheme: "light" });
            if (nodes.length && !drewOnce) drawOverview();
          }}
        />
      </div>
      <div className="tr-map-dock">
        {reply && (
          <div className="tr-map-reply">
            <strong>◆ </strong>
            {reply}
          </div>
        )}
        <div className="tr-map-quick">
          <button onClick={drawOverview} disabled={busy || loading || !nodes.length}>
            ⬒ Redraw overview
          </button>
          <button onClick={() => void ask("Show me the big picture — what are the main themes in my trove and how do they relate?")} disabled={busy || !nodes.length}>
            Big picture
          </button>
          <button onClick={() => void ask("Draw the strongest cause-and-effect chain you can find across my knowledge, as a flow.")} disabled={busy || !nodes.length}>
            Causal chain
          </button>
          <button onClick={() => void ask("Pick the most interesting node and build a radial mind-map around it, including connections I haven't drawn yet.")} disabled={busy || !nodes.length}>
            Surprise me
          </button>
        </div>
        <div className="tr-map-input">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void ask(draft)}
            placeholder={
              nodes.length
                ? "Ask the agent to re-draw your knowledge… e.g. “map everything about design as a mind-map”"
                : "Add some knowledge first — then talk to your map"
            }
            disabled={busy || !nodes.length}
          />
          <button className="tr-send" onClick={() => void ask(draft)} disabled={busy || !draft.trim()} aria-label="Send">
            {busy ? "…" : "↑"}
          </button>
        </div>
      </div>
    </div>
  );
}
