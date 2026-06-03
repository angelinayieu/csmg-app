"use client";

// ── Library rail (dedicated, right edge) ──────────────────────────
//
// The space's reference surface: a docked panel (expandable to full screen)
// with two views over the SAME space graph the per-card detail drawer reads:
//   • Glossary — layer-grouped terms (wired to /api/brainstorm/space/[id]/glossary)
//   • Graph    — every entity + relationship (/api/spaces/[id]/graph), browsable
//                and grouped by layer (the node-link force render is the last mile)
//
// Clicking a glossary term OR a graph entity opens the real ItemDetailDrawer —
// the same per-card metadata/expanded-KG surface — so macro (Library) and micro
// (card press) are one graph at two altitudes. A term also focuses its card on
// the board. Self-contained launcher (toggle + rail + drawer).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Editor, TLShapeId } from "tldraw";
import {
  BookOpen,
  Share2,
  Maximize2,
  Minimize2,
  X,
  Search,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Library as LibraryIcon,
  Zap,
  AlertTriangle,
  Diamond,
} from "lucide-react";
import type { GlossaryTerm } from "@/lib/objective-canvas/generate-glossary";
import { ItemDetailDrawer } from "@/components/objective/item-detail-drawer";
import { appleVibe } from "@/lib/apple-vibe-tokens";

type View = "glossary" | "graph";
type ItemLayer = "pain" | "features" | "outcomes" | "objective";

/** Graph node shape returned by GET /api/spaces/[id]/graph. */
interface LibNode {
  id: string;
  name: string;
  type: string;
  layer: string | null;
  importance: string | null;
  centrality: number | null;
  isLeverage: boolean;
  isRisk: boolean;
  isBottleneck: boolean;
  subObjectiveId: string | null;
}
interface LibGraph {
  nodes: LibNode[];
  links: { id: string; source: string; target: string; relationship: string }[];
}

const LAYER_ORDER = [
  "objective",
  "pain",
  "pains",
  "mechanism",
  "mechanisms",
  "feature",
  "features",
  "outcome",
  "outcomes",
];
const titleCase = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const SOURCE_DOT: Record<string, string> = {
  annotation: "#2563EB",
  entity: "#059669",
  user: "#7C3AED",
  llm: "#94A3B8",
};

/** Map a raw entity layer string → the drawer's strict lane union. */
function toItemLayer(layer: string | null): ItemLayer {
  const l = (layer ?? "").toLowerCase();
  if (l.includes("pain")) return "pain";
  if (l.includes("outcome")) return "outcomes";
  if (l.includes("objective")) return "objective";
  return "features";
}

const layerRank = (k: string) => {
  const i = LAYER_ORDER.indexOf(k.toLowerCase());
  return i === -1 ? 50 + (k.charCodeAt(0) || 0) / 1000 : i;
};

/** Find the board card whose title/text matches a term, select + center it. */
function focusTermOnBoard(editor: Editor, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return false;
  try {
    for (const s of editor.getCurrentPageShapes()) {
      const p = s.props as { title?: unknown; subtitle?: unknown };
      const hay = [
        typeof p.title === "string" ? p.title : "",
        typeof p.subtitle === "string" ? p.subtitle : "",
      ]
        .join(" ")
        .toLowerCase();
      if (hay && hay.includes(needle)) {
        editor.select(s.id as TLShapeId);
        const b = editor.getShapePageBounds(s.id as TLShapeId);
        if (b)
          editor.centerOnPoint(
            { x: b.midX, y: b.midY },
            { animation: { duration: 300 } },
          );
        return true;
      }
    }
  } catch {
    /* focus is best-effort */
  }
  return false;
}

function NodeBadges({ n }: { n: LibNode }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}>
      {n.isLeverage && <Zap style={{ width: 11, height: 11, color: "#2563EB" }} strokeWidth={2.4} />}
      {n.isRisk && <AlertTriangle style={{ width: 11, height: 11, color: "#DC2626" }} strokeWidth={2.4} />}
      {n.isBottleneck && <Diamond style={{ width: 11, height: 11, color: "#EA580C" }} strokeWidth={2.4} />}
    </span>
  );
}

function GlossaryView({
  spaceId,
  editor,
  nodes,
  onOpenDetail,
}: {
  spaceId: string;
  editor: Editor;
  nodes: LibNode[];
  onOpenDetail: (n: LibNode) => void;
}) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(
    async (regen = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/brainstorm/space/${spaceId}/glossary`, {
          method: regen ? "POST" : "GET",
        });
        const json = (await res.json()) as { glossary?: GlossaryTerm[]; error?: string };
        if (!res.ok) {
          setError(json?.error ?? "Couldn't load the glossary.");
          return;
        }
        setTerms(Array.isArray(json.glossary) ? json.glossary : []);
      } catch {
        setError("Couldn't load the glossary.");
      } finally {
        setLoading(false);
      }
    },
    [spaceId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // term name (lowercased) → entity node, for click-through to the drawer.
  const nodeByName = useMemo(() => {
    const m = new Map<string, LibNode>();
    for (const n of nodes) m.set(n.name.trim().toLowerCase(), n);
    return m;
  }, [nodes]);

  const shelves = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? terms.filter(
          (t) =>
            t.term.toLowerCase().includes(q) ||
            t.definition.toLowerCase().includes(q) ||
            (t.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
        )
      : terms;
    const groups = new Map<string, GlossaryTerm[]>();
    for (const t of filtered) {
      const key = t.layer_tag?.trim() || "general";
      const arr = groups.get(key);
      if (arr) arr.push(t);
      else groups.set(key, [t]);
    }
    return Array.from(groups.entries())
      .sort((a, b) => layerRank(a[0]) - layerRank(b[0]))
      .map(([key, items]) => ({
        key,
        label: key === "general" ? "General" : titleCase(key),
        items: items.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)),
      }));
  }, [terms, query]);

  function onTermClick(t: GlossaryTerm) {
    const node = nodeByName.get(t.term.trim().toLowerCase());
    if (node) {
      onOpenDetail(node);
      return;
    }
    const hit = focusTermOnBoard(editor, t.term);
    setFlash(hit ? `Focused "${t.term}"` : `"${t.term}" — no entity yet`);
    window.setTimeout(() => setFlash((c) => (c && c.includes(t.term) ? null : c)), 1600);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", gap: 6, padding: "10px 12px 8px" }}>
        <div style={searchBox}>
          <Search style={{ width: 13, height: 13, color: appleVibe.text.tertiary }} strokeWidth={2.2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search terms…"
            style={searchInput}
          />
        </div>
        <button type="button" title="Regenerate glossary" onClick={() => load(true)} disabled={loading} style={squareBtn(loading)}>
          <RefreshCw className={loading ? "animate-spin" : undefined} style={{ width: 13, height: 13 }} strokeWidth={2.2} />
        </button>
      </div>

      {flash && <div style={flashStyle}>{flash}</div>}

      <div style={scrollArea}>
        {loading && terms.length === 0 ? (
          <div style={emptyRow}><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading glossary…</div>
        ) : error ? (
          <div style={{ padding: "16px 4px", fontSize: 12.5, color: appleVibe.text.tertiary }}>{error}</div>
        ) : shelves.length === 0 ? (
          <div style={{ padding: "16px 4px", fontSize: 12.5, lineHeight: 1.4, color: appleVibe.text.tertiary }}>
            No terms yet. Build rooms / annotate the objective, then hit regenerate.
          </div>
        ) : (
          shelves.map((shelf) => {
            const isCollapsed = collapsed.has(shelf.key);
            return (
              <div key={shelf.key} style={{ marginBottom: 8 }}>
                <button type="button" onClick={() => toggle(setCollapsed, shelf.key)} style={shelfHeader}>
                  {isCollapsed ? <ChevronRight style={chev} strokeWidth={2.4} /> : <ChevronDown style={chev} strokeWidth={2.4} />}
                  <span style={shelfLabel}>{shelf.label}</span>
                  <span style={shelfCount}>{shelf.items.length}</span>
                </button>
                {!isCollapsed &&
                  shelf.items.map((t) => {
                    const linked = nodeByName.has(t.term.trim().toLowerCase());
                    return (
                      <button
                        key={t.term}
                        type="button"
                        onClick={() => onTermClick(t)}
                        title={linked ? `Open "${t.term}" detail` : `Focus "${t.term}" on the board`}
                        style={termRow}
                        onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: SOURCE_DOT[t.source] ?? "#94A3B8" }} />
                          <span style={termName}>{t.term}</span>
                          {linked && <ChevronRight style={{ width: 12, height: 12, color: appleVibe.text.faint, marginLeft: "auto" }} strokeWidth={2.4} />}
                        </span>
                        <span style={termDef}>{t.definition}</span>
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function GraphView({
  graph,
  loading,
  onOpenDetail,
}: {
  graph: LibGraph | null;
  loading: boolean;
  onOpenDetail: (n: LibNode) => void;
}) {
  const shelves = useMemo(() => {
    if (!graph) return [];
    const groups = new Map<string, LibNode[]>();
    for (const n of graph.nodes) {
      const key = n.layer?.trim() || "general";
      const arr = groups.get(key);
      if (arr) arr.push(n);
      else groups.set(key, [n]);
    }
    return Array.from(groups.entries())
      .sort((a, b) => layerRank(a[0]) - layerRank(b[0]))
      .map(([key, items]) => ({ key, label: key === "general" ? "General" : titleCase(key), items }));
  }, [graph]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ padding: "10px 12px 4px", fontSize: 11, fontWeight: 600, color: appleVibe.text.tertiary }}>
        {graph ? `${graph.nodes.length} entities · ${graph.links.length} relationships` : "—"}
        <span style={{ marginLeft: 8, color: appleVibe.text.faint, fontWeight: 500 }}>· node-link map coming</span>
      </div>
      <div style={scrollArea}>
        {loading && !graph ? (
          <div style={emptyRow}><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading graph…</div>
        ) : !graph || graph.nodes.length === 0 ? (
          <div style={{ padding: "16px 4px", fontSize: 12.5, lineHeight: 1.4, color: appleVibe.text.tertiary }}>
            No entities yet — generate rooms to populate the space graph.
          </div>
        ) : (
          shelves.map((shelf) => (
            <div key={shelf.key} style={{ marginBottom: 8 }}>
              <div style={{ ...shelfLabel, padding: "6px 2px" }}>
                {shelf.label} <span style={shelfCount}>{shelf.items.length}</span>
              </div>
              {shelf.items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onOpenDetail(n)}
                  title={`Open "${n.name}" detail`}
                  style={termRow}
                  onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={termName}>{n.name}</span>
                    <NodeBadges n={n} />
                    <ChevronRight style={{ width: 12, height: 12, color: appleVibe.text.faint, marginLeft: "auto" }} strokeWidth={2.4} />
                  </span>
                  <span style={termDef}>{titleCase(n.type)}</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function toggle(set: Dispatch<SetStateAction<Set<string>>>, key: string) {
  set((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

export function LibraryLauncher({ spaceId, editor }: { spaceId: string; editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [view, setView] = useState<View>("glossary");
  const [graph, setGraph] = useState<LibGraph | null>(null);
  const [detail, setDetail] = useState<LibNode | null>(null);

  // Fetch the space graph once the rail opens (shared by both views + the
  // glossary term → entity resolution). Soft-fails to an empty graph. Loading
  // is derived (no synchronous setState in the effect).
  useEffect(() => {
    if (!open || graph) return;
    let alive = true;
    fetch(`/api/spaces/${spaceId}/graph`)
      .then((r) => (r.ok ? r.json() : { nodes: [], links: [] }))
      .then((j) => {
        if (alive) setGraph({ nodes: j.nodes ?? [], links: j.links ?? [] });
      })
      .catch(() => {
        if (alive) setGraph({ nodes: [], links: [] });
      });
    return () => {
      alive = false;
    };
  }, [open, graph, spaceId]);
  const graphLoading = open && graph === null;

  if (!open) {
    return (
      <button
        type="button"
        title="Library — glossary + knowledge graph"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(true)}
        style={launcherPill}
      >
        <LibraryIcon style={{ width: 14, height: 14 }} strokeWidth={2.2} />
        Library
      </button>
    );
  }

  const tabs: { id: View; label: string; Icon: typeof BookOpen }[] = [
    { id: "glossary", label: "Glossary", Icon: BookOpen },
    { id: "graph", label: "Graph", Icon: Share2 },
  ];

  return (
    <>
      <div onPointerDown={(e) => e.stopPropagation()} style={railStyle(full)}>
        <div style={railHeader}>
          <LibraryIcon style={{ width: 15, height: 15, color: appleVibe.text.secondary }} strokeWidth={2.2} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", color: appleVibe.text.primary }}>Library</span>
          <div style={tabBar}>
            {tabs.map((t) => {
              const active = view === t.id;
              return (
                <button key={t.id} type="button" onClick={() => setView(t.id)} style={tabBtn(active)}>
                  <t.Icon style={{ width: 12, height: 12 }} strokeWidth={2.2} />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
            <button type="button" title={full ? "Restore" : "Expand to full screen"} onClick={() => setFull((f) => !f)} style={iconBtn}>
              {full ? <Minimize2 style={{ width: 14, height: 14 }} strokeWidth={2.2} /> : <Maximize2 style={{ width: 14, height: 14 }} strokeWidth={2.2} />}
            </button>
            <button type="button" title="Close" onClick={() => setOpen(false)} style={iconBtn}>
              <X style={{ width: 15, height: 15 }} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        {view === "glossary" ? (
          <GlossaryView spaceId={spaceId} editor={editor} nodes={graph?.nodes ?? []} onOpenDetail={setDetail} />
        ) : (
          <GraphView graph={graph} loading={graphLoading} onOpenDetail={setDetail} />
        )}
      </div>

      {detail && (
        <ItemDetailDrawer
          entityId={detail.id}
          itemName={detail.name}
          itemLayer={toItemLayer(detail.layer)}
          linkedChains={[]}
          spaceId={spaceId}
          subObjectiveId={detail.subObjectiveId ?? undefined}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}

// ── styles ──
const launcherPill: CSSProperties = {
  position: "absolute",
  top: 64,
  right: 16,
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
const railStyle = (full: boolean): CSSProperties => ({
  position: "absolute",
  top: 12,
  bottom: 12,
  right: 12,
  width: full ? "calc(100% - 24px)" : 384,
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
  transition: "width var(--dur-normal) var(--ease-spring-soft)",
});
const railHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 12px 9px",
  borderBottom: "1px solid var(--glass-border)",
};
const tabBar: CSSProperties = {
  display: "flex",
  gap: 2,
  marginLeft: 8,
  padding: 2,
  borderRadius: appleVibe.radius.pill,
  background: appleVibe.surface.chip,
};
const tabBtn = (active: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "4px 10px",
  borderRadius: appleVibe.radius.pill,
  border: "none",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  fontSize: 11.5,
  fontWeight: 650,
  color: active ? appleVibe.text.onAccent : appleVibe.text.secondary,
  background: active ? appleVibe.accent.primary : "transparent",
});
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
const emptyRow: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "20px 4px", color: appleVibe.text.tertiary, fontSize: 12.5 };
const searchBox: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flex: 1,
  padding: "6px 9px",
  borderRadius: appleVibe.radius.md,
  background: appleVibe.surface.chip,
  border: "1px solid var(--glass-border)",
};
const searchInput: CSSProperties = {
  border: "none",
  outline: "none",
  background: "transparent",
  fontSize: 12.5,
  width: "100%",
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
};
const squareBtn = (loading: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  borderRadius: appleVibe.radius.md,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.chip,
  cursor: loading ? "default" : "pointer",
  color: appleVibe.text.secondary,
});
const flashStyle: CSSProperties = { margin: "0 12px 6px", fontSize: 11, fontWeight: 600, color: appleVibe.text.tertiary };
const shelfHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  padding: "6px 2px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const chev: CSSProperties = { width: 13, height: 13, color: appleVibe.text.tertiary };
const shelfLabel: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: appleVibe.text.secondary };
const shelfCount: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: appleVibe.text.faint, marginLeft: 4 };
const termRow: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 9px",
  marginBottom: 3,
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  background: appleVibe.surface.chip,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const termName: CSSProperties = { fontSize: 12.5, fontWeight: 650, color: appleVibe.text.primary, letterSpacing: "-0.01em" };
const termDef: CSSProperties = { display: "block", marginTop: 2, fontSize: 11.5, lineHeight: 1.4, color: appleVibe.text.tertiary };
