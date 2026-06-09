"use client";

// ── Knowledge Graph panel (space-wide, force-directed) ────────────────────────
//
// The macro view of the object layer: every library_object as a color-coded
// node, every object_link as an edge, laid out with FORCE-DIRECTED physics
// (cytoscape-fcose) so the graph visibly *forms* — nodes spring out from the
// center and settle. Nodes are condensed to colored dots (sized by how
// connected they are); the name stays hidden until you hover/focus, so a dense
// graph reads as shape + color instead of a wall of text. A small legend
// decodes the colors.
//
// Two exports:
//   • KnowledgeGraphCanvas — the pure cytoscape renderer (takes nodes/edges).
//     Reused by the /preflight/kg harness so the look can be verified without
//     auth (board routes redirect to login).
//   • KnowledgeGraphPanel — the dockable right-edge panel that fetches the
//     space's graph from /api/objective/[spaceId]/kg and renders the canvas.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import type { Editor } from "tldraw";
import { Network, X, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { OPEN_BOARD_KG_EVENT } from "@/components/objective/board-bus";
import { ObjectDetailDrawer } from "./object-detail-drawer";

export interface KgNode {
  id: string;
  type: string;
  title: string;
  summary?: string;
  degree?: number;
}
export interface KgEdge {
  source: string;
  target: string;
  relation: string;
}

// Object-type → color. Mirrors ObjectClusterGraph so the per-object cluster and
// the space-wide graph speak ONE color language.
const TYPE_COLOR: Record<string, string> = {
  variable: "#069494",
  feature: "#2563EB",
  mechanism: "#7C3AED",
  experiment: "#D97706",
  deliverable: "#0D9488",
  insight: "#DB2777",
  concept: "#64748B",
  // Crucible (Phase 2) — leverage points are the gold output; constraints are
  // the rose limits. first_principle/variation/sub_objective reserved for the
  // later phases so they color correctly the moment they're persisted.
  leverage_point: "#F59E0B",
  constraint: "#E11D48",
  first_principle: "#7C3AED",
  variation: "#9333EA",
  sub_objective: "#0EA5E9",
};
const TYPE_LABEL: Record<string, string> = {
  variable: "Variable",
  feature: "Feature",
  mechanism: "Mechanism",
  experiment: "Experiment",
  deliverable: "Deliverable",
  insight: "Insight",
  concept: "Concept",
  leverage_point: "Leverage point",
  constraint: "Constraint",
  first_principle: "First principle",
  variation: "Variation",
  sub_objective: "Sub-objective",
};
const typeColor = (t: string) => TYPE_COLOR[t] ?? TYPE_COLOR.concept;

// fcose registers globally; guard so a remount doesn't double-register (throws).
let fcoseReady = false;
function ensureFcose() {
  if (fcoseReady) return;
  try {
    cytoscape.use(fcose);
  } catch {
    /* already registered in this session */
  }
  fcoseReady = true;
}

const FCOSE_BASE = {
  name: "fcose" as const,
  animate: true,
  animationDuration: 700,
  fit: true,
  padding: 38,
  nodeRepulsion: 7000,
  idealEdgeLength: 90,
  nodeSeparation: 95,
  packComponents: true,
};

function buildElements(nodes: KgNode[], edges: KgEdge[]): cytoscape.ElementDefinition[] {
  const nodeEls: cytoscape.ElementDefinition[] = nodes.map((n) => {
    const deg = n.degree ?? 0;
    return {
      group: "nodes",
      data: {
        id: n.id,
        label: n.title,
        type: n.type,
        color: typeColor(n.type),
        // hubs read bigger; clamp so one mega-hub doesn't dwarf the rest.
        size: 16 + Math.min(deg, 9) * 3.4,
      },
    };
  });
  const edgeEls: cytoscape.ElementDefinition[] = edges.map((e, i) => ({
    group: "edges",
    data: {
      id: `e${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      relation: e.relation,
    },
  }));
  return [...nodeEls, ...edgeEls];
}

// Cast via unknown: cytoscape's strict Css.Node/Edge types reject "data(...)"
// mappers + some shorthand we rely on, and the `style` option wants StylesheetJson.
const CY_STYLE = ([
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      width: "data(size)",
      height: "data(size)",
      label: "data(label)",
      "font-size": 10,
      "font-weight": 600,
      "font-family": appleVibe.font.stack,
      color: "#0F172A",
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": 4,
      "text-max-width": "120px",
      "text-wrap": "ellipsis",
      "text-opacity": 0, // hidden until hover/focus
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.92,
      "text-background-padding": "3px",
      "text-background-shape": "roundrectangle",
      "min-zoomed-font-size": 7,
      "border-width": 2,
      "border-color": "#ffffff",
      "overlay-opacity": 0,
      "transition-property": "text-opacity border-color",
      "transition-duration": 120,
    },
  },
  {
    selector: "node.hl",
    style: { "text-opacity": 1, "z-index": 20, "border-color": "data(color)" },
  },
  {
    selector: "edge",
    style: {
      width: 1.2,
      "line-color": "rgba(100,116,139,0.28)",
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "rgba(100,116,139,0.32)",
      "arrow-scale": 0.7,
    },
  },
  {
    selector: "edge.hl",
    style: {
      width: 1.8,
      "line-color": "rgba(15,23,42,0.5)",
      "target-arrow-color": "rgba(15,23,42,0.5)",
      label: "data(relation)",
      "font-size": 8,
      "font-family": appleVibe.font.stack,
      color: "#475569",
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.9,
      "text-background-padding": "2px",
    },
  },
] as unknown) as cytoscape.StylesheetJson;

/** Pure cytoscape renderer. Init once; re-layout (with formation animation)
 *  whenever the data changes. */
export function KnowledgeGraphCanvas({
  nodes,
  edges,
  onNodeClick,
  style,
}: {
  nodes: KgNode[];
  edges: KgEdge[];
  onNodeClick?: (id: string) => void;
  style?: CSSProperties;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const laidOut = useRef(false);
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;

  // Init once.
  useEffect(() => {
    ensureFcose();
    if (!boxRef.current) return;
    const cy = cytoscape({
      container: boxRef.current,
      style: CY_STYLE,
      elements: [],
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
      autoungrabify: false,
    });
    cyRef.current = cy;

    cy.on("mouseover", "node", (e) => {
      e.target.addClass("hl");
      e.target.connectedEdges().addClass("hl");
    });
    cy.on("mouseout", "node", (e) => {
      e.target.removeClass("hl");
      e.target.connectedEdges().removeClass("hl");
    });
    cy.on("tap", "node", (e) => onClickRef.current?.(e.target.id()));

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Sync data + run the force layout (formation) on change.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(buildElements(nodes, edges));
    });
    if (cy.nodes().length === 0) return;
    // First layout scatters then settles (the "formation"); later updates keep
    // existing positions and just re-settle so it isn't jarring.
    const layout = cy.layout({
      ...FCOSE_BASE,
      randomize: !laidOut.current,
    } as unknown as cytoscape.LayoutOptions);
    layout.run();
    laidOut.current = true;
  }, [nodes, edges]);

  return (
    <div
      ref={boxRef}
      style={{ width: "100%", height: "100%", ...style }}
      // cytoscape owns pointer events inside; stop them reaching the tldraw canvas.
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    />
  );
}

// ── Dockable panel ───────────────────────────────────────────────────────────

// User-resizable dimensions. The panel width and the graph/details split
// fraction persist per-browser so the layout you set is the layout you get
// back. Clamped so the panel can't be shrunk past readability or grown past
// the board.
const WIDTH_LS_KEY = "kg-panel-width-v1";
const SPLIT_LS_KEY = "kg-panel-split-v1"; // fraction of total height given to the GRAPH (0..1)
const MIN_WIDTH = 360;
const MAX_WIDTH = 880;
const DEFAULT_WIDTH = 420;
const MIN_SPLIT = 0.25; // details can grow until graph is 25% of split area
const MAX_SPLIT = 0.85; // graph can grow until details is 15% of split area
const DEFAULT_SPLIT = 0.55;

function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}
function writeNumber(key: string, n: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(n));
  } catch {
    /* quota / privacy mode → ignore */
  }
}

export function KnowledgeGraphPanel({
  spaceId,
  editor,
  onClose,
}: {
  spaceId: string;
  /** Optional — when provided, tapping a node opens the embedded object detail
   *  drawer in the bottom row (so it can pan-to-shape / focus the canvas). */
  editor?: Editor | null;
  onClose: () => void;
}) {
  const [nodes, setNodes] = useState<KgNode[]>([]);
  const [edges, setEdges] = useState<KgEdge[]>([]);
  const [loading, setLoading] = useState(true);
  // The tapped node → opens the inline detail row.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Resolved object title (notified by the embedded drawer) so we can show a
  // proper detail-row header without re-fetching the object up here.
  const [detailTitle, setDetailTitle] = useState<string>("");
  // Hide-but-keep-the-selection: collapsing folds the row to a tiny stub
  // instead of clearing it, so the chevron can re-open the SAME object.
  const [detailCollapsed, setDetailCollapsed] = useState(false);

  // Persisted layout — restored on mount, NOT during SSR (localStorage guard).
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [splitFrac, setSplitFrac] = useState<number>(DEFAULT_SPLIT);
  useEffect(() => {
    setWidth(clamp(readNumber(WIDTH_LS_KEY, DEFAULT_WIDTH), MIN_WIDTH, MAX_WIDTH));
    setSplitFrac(clamp(readNumber(SPLIT_LS_KEY, DEFAULT_SPLIT), MIN_SPLIT, MAX_SPLIT));
  }, []);
  // Persist (debounced via the natural setState cadence — these fire on
  // drag move, but localStorage writes are cheap and bounded).
  useEffect(() => {
    writeNumber(WIDTH_LS_KEY, width);
  }, [width]);
  useEffect(() => {
    writeNumber(SPLIT_LS_KEY, splitFrac);
  }, [splitFrac]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/objective/${spaceId}/kg`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { nodes?: KgNode[]; edges?: KgEdge[] };
        if (cancelled) return;
        setNodes(Array.isArray(j.nodes) ? j.nodes : []);
        setEdges(Array.isArray(j.edges) ? j.edges : []);
      } catch {
        if (!cancelled) {
          setNodes([]);
          setEdges([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    // Re-poll while the AI is building the graph so new concepts spring in live.
    const id = window.setInterval(load, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [spaceId]);

  // Which types are actually present → only legend those.
  const presentTypes = Array.from(new Set(nodes.map((n) => n.type))).filter(
    (t) => TYPE_LABEL[t] || TYPE_COLOR[t],
  );

  // ── Drag handlers ──
  // Left-edge handle stretches the panel; live-updates width during drag. We
  // listen on window so leaving the handle mid-drag doesn't strand the state.
  const startWidthDrag = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      ev.preventDefault();
      const startX = ev.clientX;
      const startWidth = width;
      const onMove = (e: PointerEvent) => {
        // Panel is anchored to the RIGHT edge → dragging left grows it.
        const next = clamp(startWidth + (startX - e.clientX), MIN_WIDTH, MAX_WIDTH);
        setWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width],
  );

  // The split handle between graph and details. Drag fraction is computed
  // against the parent's measured height so it stays correct as the panel
  // itself is resized.
  const splitTrackRef = useRef<HTMLDivElement | null>(null);
  const startSplitDrag = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      ev.preventDefault();
      const track = splitTrackRef.current;
      if (!track) return;
      const onMove = (e: PointerEvent) => {
        const rect = track.getBoundingClientRect();
        if (rect.height <= 0) return;
        const f = (e.clientY - rect.top) / rect.height;
        setSplitFrac(clamp(f, MIN_SPLIT, MAX_SPLIT));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ns-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [],
  );

  // When a freshly-tapped node arrives, make sure the row is expanded — the
  // user is asking to *see* the detail, so an old "collapsed" state shouldn't
  // suppress it.
  const handleNodeClick = useCallback((id: string) => {
    setSelectedId(id);
    setDetailCollapsed(false);
  }, []);

  const detailOpen = !!selectedId;
  // Express the split as a flexBasis only while the detail row is OPEN and
  // EXPANDED; otherwise the graph takes the whole content area.
  const graphFlexBasis =
    detailOpen && !detailCollapsed ? `${splitFrac * 100}%` : "100%";

  return (
    <div
      style={{ ...panel, width }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Left-edge width handle. Sits over the rounded corner; cursor and a
          subtle accent on hover make it discoverable. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel width"
        title="Drag to resize"
        onPointerDown={startWidthDrag}
        style={widthHandle}
      />

      <div style={header}>
        <Network
          style={{ width: 15, height: 15, color: appleVibe.text.secondary }}
          strokeWidth={2.2}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: appleVibe.text.primary,
          }}
        >
          Knowledge graph
        </span>
        {nodes.length > 0 && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: appleVibe.text.faint,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {nodes.length}
          </span>
        )}
        <button
          type="button"
          title="Close"
          onClick={onClose}
          style={{ marginLeft: "auto", ...iconBtn }}
        >
          <X style={{ width: 15, height: 15 }} strokeWidth={2.2} />
        </button>
      </div>

      <div ref={splitTrackRef} style={splitTrack}>
        {/* ── Row 1: graph ── */}
        <div style={{ ...splitPane, flexBasis: graphFlexBasis }}>
          {loading ? (
            <div style={center}>
              <Loader2
                className="animate-spin"
                style={{ width: 16, height: 16 }}
              />
              <span style={{ marginTop: 8 }}>Mapping the graph…</span>
            </div>
          ) : nodes.length === 0 ? (
            <div style={{ ...center, padding: "0 28px", textAlign: "center" }}>
              <Network
                style={{ width: 22, height: 22, opacity: 0.4 }}
                strokeWidth={1.8}
              />
              <span style={{ marginTop: 10, lineHeight: 1.45 }}>
                No concepts yet. As the AI resolves your objective, the variables,
                features and how they connect will appear here.
              </span>
            </div>
          ) : (
            <KnowledgeGraphCanvas
              nodes={nodes}
              edges={edges}
              onNodeClick={handleNodeClick}
            />
          )}
        </div>

        {/* ── Drag handle (only between rows when row 2 is open & expanded) ── */}
        {detailOpen && !detailCollapsed && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize graph / detail split"
            title="Drag to resize"
            onPointerDown={startSplitDrag}
            style={splitHandle}
          >
            <span style={splitHandleGrip} />
          </div>
        )}

        {/* ── Row 2: detail (when a node is selected) ── */}
        {detailOpen && (
          <div style={{ ...splitPane, ...(detailCollapsed ? splitPaneCollapsed : {}) }}>
            <div style={detailHeader}>
              <button
                type="button"
                title={detailCollapsed ? "Expand details" : "Collapse details"}
                onClick={() => setDetailCollapsed((c) => !c)}
                style={iconBtnSmall}
              >
                {detailCollapsed ? (
                  <ChevronUp style={{ width: 13, height: 13 }} strokeWidth={2.4} />
                ) : (
                  <ChevronDown style={{ width: 13, height: 13 }} strokeWidth={2.4} />
                )}
              </button>
              <span style={detailTitleStyle} title={detailTitle || "Object"}>
                {detailTitle || "Object"}
              </span>
              <button
                type="button"
                title="Close details"
                onClick={() => {
                  setSelectedId(null);
                  setDetailTitle("");
                  setDetailCollapsed(false);
                }}
                style={{ marginLeft: "auto", ...iconBtnSmall }}
              >
                <X style={{ width: 13, height: 13 }} strokeWidth={2.4} />
              </button>
            </div>
            {!detailCollapsed && editor && (
              <div style={detailBody}>
                <ObjectDetailDrawer
                  key={selectedId!}
                  spaceId={spaceId}
                  objectId={selectedId!}
                  editor={editor}
                  embedded
                  onTitleChange={setDetailTitle}
                  onNavigate={(id) => {
                    setSelectedId(id);
                    setDetailTitle("");
                  }}
                  onClose={() => {
                    setSelectedId(null);
                    setDetailTitle("");
                  }}
                />
              </div>
            )}
            {!detailCollapsed && !editor && (
              <div style={{ padding: "12px 14px", fontSize: 12, color: appleVibe.text.tertiary }}>
                Detail view unavailable in this context.
              </div>
            )}
          </div>
        )}
      </div>

      {presentTypes.length > 0 && (
        <div style={legend}>
          {presentTypes.map((t) => (
            <span key={t} style={legendItem}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: typeColor(t),
                  flexShrink: 0,
                }}
              />
              {TYPE_LABEL[t] ?? t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Launcher ─────────────────────────────────────────────────────────────────

/** Self-managing launcher: renders nothing until the nav bar fires the open
 *  event, then toggles the panel. Mirrors GoalLauncher so whiteboard-base just
 *  drops in <KnowledgeGraphLauncher spaceId=… editor=… />. */
export function KnowledgeGraphLauncher({
  spaceId,
  editor,
}: {
  spaceId: string;
  editor?: Editor | null;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener(OPEN_BOARD_KG_EVENT, toggle);
    return () => window.removeEventListener(OPEN_BOARD_KG_EVENT, toggle);
  }, []);
  if (!open) return null;
  return (
    <KnowledgeGraphPanel
      spaceId={spaceId}
      editor={editor}
      onClose={() => setOpen(false)}
    />
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// ── styles ──
// `width` is intentionally OMITTED here — the panel sets it inline from state
// so it can be drag-resized. Top/bottom/right anchor + flex column drive the
// row split underneath.
const panel: CSSProperties = {
  position: "absolute",
  top: 64,
  bottom: 12,
  right: 12,
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
  overflow: "hidden",
};
const widthHandle: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  width: 6,
  cursor: "ew-resize",
  zIndex: 5,
  // No fill — a hairline accent on hover keeps it discoverable without adding
  // visible chrome to the resting state of the panel.
  background: "transparent",
};
const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 12px 9px",
  borderBottom: "1px solid var(--glass-border)",
  flexShrink: 0,
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
const iconBtnSmall: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: appleVibe.text.tertiary,
};
const center: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: appleVibe.text.tertiary,
  fontSize: 12.5,
};
const legend: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px 12px",
  padding: "9px 12px",
  borderTop: "1px solid var(--glass-border)",
  flexShrink: 0,
};
const legendItem: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 10.5,
  fontWeight: 600,
  color: appleVibe.text.tertiary,
};

// Split row container — flex column so panes share the available height per
// their flexBasis. `minHeight: 0` is the critical bit that lets overflowing
// children scroll inside their own pane instead of pushing the panel.
const splitTrack: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};
const splitPane: CSSProperties = {
  position: "relative",
  flexGrow: 0,
  flexShrink: 1,
  flexBasis: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};
const splitPaneCollapsed: CSSProperties = {
  flexBasis: 32, // header strip only
  flexGrow: 0,
  flexShrink: 0,
};
const splitHandle: CSSProperties = {
  position: "relative",
  height: 6,
  cursor: "ns-resize",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderTop: "1px solid var(--glass-border)",
  borderBottom: "1px solid var(--glass-border)",
  background: "var(--glass-float-bg)",
  flexShrink: 0,
};
const splitHandleGrip: CSSProperties = {
  display: "block",
  width: 28,
  height: 2,
  borderRadius: 999,
  background: "rgba(100,116,139,0.45)",
};
const detailHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 8px",
  borderBottom: "1px solid var(--glass-border)",
  flexShrink: 0,
  background: "var(--glass-float-bg)",
};
const detailTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  color: appleVibe.text.primary,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  flex: 1,
  minWidth: 0,
};
const detailBody: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "8px 10px 12px",
};
