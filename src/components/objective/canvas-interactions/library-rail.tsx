"use client";

// ── Library rail (dedicated, right edge) — over the NEW OBJECT layer ──
//
// Re-pointed off the old entities graph onto `library_objects` (the oc-card
// layer) per project_old_build_deprecation. Two views:
//   • Glossary — layer-grouped terms (…/glossary); click resolves to its object
//                (by title) when one exists, else focuses the board card.
//   • Objects  — every library_object grouped by type (…/library/objects).
//
// Clicking an object fires OPEN_CARD_DETAIL_EVENT {objectId} — the SAME event the
// oc-cards dispatch for their metadata/KG drawer (currently WIP/unwired) — AND,
// when the object carries a source_entity_id, opens ItemDetailDrawer as the
// working detail until that object drawer lands. Self-contained launcher.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Editor, TLShapeId } from "tldraw";
import {
  BookOpen,
  Boxes,
  Maximize2,
  Minimize2,
  X,
  Search,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Library as LibraryIcon,
} from "lucide-react";
import type { GlossaryTerm } from "@/lib/objective-canvas/generate-glossary";
import { OPEN_CARD_DETAIL_EVENT } from "@/components/objective/canvas-interactions/object-detail-drawer";
import { appleVibe } from "@/lib/apple-vibe-tokens";

type View = "glossary" | "objects";

/** A library_objects row (GET …/library/objects → { objects }). */
interface LibObject {
  id: string; // library_objects.id — the objectId
  title: string;
  type: string; // object_type
  summary: string;
  sourceEntityId: string | null;
  subObjectiveId: string | null;
  onWhiteboard: boolean;
}

const TYPE_ORDER = [
  "feature",
  "variable",
  "mechanism",
  "insight",
  "recommendation",
  "deliverable",
  "experiment",
  "variation",
  "ui_idea",
  "brainstorm_cluster",
];
const titleCase = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const SOURCE_DOT: Record<string, string> = {
  annotation: "#2563EB",
  entity: "#059669",
  user: "#7C3AED",
  llm: "#94A3B8",
};

const typeRank = (k: string) => {
  const i = TYPE_ORDER.indexOf(k.toLowerCase());
  return i === -1 ? 50 + (k.charCodeAt(0) || 0) / 1000 : i;
};

function mapObject(o: any): LibObject {
  return {
    id: String(o.id),
    title: typeof o.title === "string" && o.title.trim() ? o.title : "Untitled",
    type: o.object_type ?? "object",
    summary: typeof o.summary === "string" ? o.summary : "",
    sourceEntityId: o.source_entity_id ?? null,
    subObjectiveId: o.source_sub_objective_id ?? null,
    onWhiteboard: !!o.on_whiteboard,
  };
}

/** Find the board card whose title/text matches a term, select + center it. */
function focusTermOnBoard(editor: Editor, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return false;
  try {
    for (const s of editor.getCurrentPageShapes()) {
      const p = s.props as { title?: unknown; subtitle?: unknown; name?: unknown };
      const hay = [
        typeof p.title === "string" ? p.title : "",
        typeof p.subtitle === "string" ? p.subtitle : "",
        typeof p.name === "string" ? p.name : "",
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

function GlossaryView({
  spaceId,
  editor,
  objects,
  onOpen,
}: {
  spaceId: string;
  editor: Editor;
  objects: LibObject[];
  onOpen: (o: LibObject) => void;
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

  // Auto-build the glossary from objects the FIRST time it's empty but objects
  // exist — so the generated feature/variable cards contribute without a manual
  // regenerate. Ref-guarded → fires at most once (no repeated LLM calls).
  const autoRegen = useRef(false);
  useEffect(() => {
    if (!autoRegen.current && !loading && terms.length === 0 && objects.length > 0) {
      autoRegen.current = true;
      void load(true);
    }
  }, [loading, terms.length, objects.length, load]);

  // term (lowercased) → object, for click-through to the object detail.
  const objByTitle = useMemo(() => {
    const m = new Map<string, LibObject>();
    for (const o of objects) m.set(o.title.trim().toLowerCase(), o);
    return m;
  }, [objects]);

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
      .sort((a, b) => typeRank(a[0]) - typeRank(b[0]))
      .map(([key, items]) => ({
        key,
        label: key === "general" ? "General" : titleCase(key),
        items: items.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)),
      }));
  }, [terms, query]);

  function onTermClick(t: GlossaryTerm) {
    const obj = objByTitle.get(t.term.trim().toLowerCase());
    if (obj) {
      onOpen(obj);
      return;
    }
    const hit = focusTermOnBoard(editor, t.term);
    setFlash(hit ? `Focused "${t.term}"` : `"${t.term}" — no object yet`);
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
            No terms yet — they accrue as you build out objects on the board.
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
                    const linked = objByTitle.has(t.term.trim().toLowerCase());
                    return (
                      <button
                        key={t.term}
                        type="button"
                        onClick={() => onTermClick(t)}
                        title={linked ? `Open "${t.term}"` : `Focus "${t.term}" on the board`}
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

function ObjectsView({
  objects,
  loading,
  onOpen,
}: {
  objects: LibObject[] | null;
  loading: boolean;
  onOpen: (o: LibObject) => void;
}) {
  const shelves = useMemo(() => {
    if (!objects) return [];
    const groups = new Map<string, LibObject[]>();
    for (const o of objects) {
      const key = o.type?.trim() || "object";
      const arr = groups.get(key);
      if (arr) arr.push(o);
      else groups.set(key, [o]);
    }
    return Array.from(groups.entries())
      .sort((a, b) => typeRank(a[0]) - typeRank(b[0]))
      .map(([key, items]) => ({ key, label: titleCase(key), items }));
  }, [objects]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ padding: "10px 12px 4px", fontSize: 11, fontWeight: 600, color: appleVibe.text.tertiary }}>
        {objects ? `${objects.length} object${objects.length === 1 ? "" : "s"}` : "—"}
        <span style={{ marginLeft: 8, color: appleVibe.text.faint, fontWeight: 500 }}>· node-link map coming</span>
      </div>
      <div style={scrollArea}>
        {loading && !objects ? (
          <div style={emptyRow}><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading objects…</div>
        ) : !objects || objects.length === 0 ? (
          <div style={{ padding: "16px 4px", fontSize: 12.5, lineHeight: 1.4, color: appleVibe.text.tertiary }}>
            No objects yet — synthesize / save cards on the board to populate the library.
          </div>
        ) : (
          shelves.map((shelf) => (
            <div key={shelf.key} style={{ marginBottom: 8 }}>
              <div style={{ ...shelfLabel, padding: "6px 2px" }}>
                {shelf.label} <span style={shelfCount}>{shelf.items.length}</span>
              </div>
              {shelf.items.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onOpen(o)}
                  title={`Open "${o.title}"`}
                  style={termRow}
                  onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={termName}>{o.title}</span>
                    {o.onWhiteboard && (
                      <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: appleVibe.accent.primary }} title="On the board" />
                    )}
                    <ChevronRight style={{ width: 12, height: 12, color: appleVibe.text.faint, marginLeft: "auto" }} strokeWidth={2.4} />
                  </span>
                  {o.summary && <span style={termDef}>{o.summary}</span>}
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
  const [view, setView] = useState<View>("objects");
  const [objects, setObjects] = useState<LibObject[] | null>(null);

  // Fetch the space's library_objects once the rail opens (shared by both
  // views). Soft-fails to []. Loading is derived (no setState in effect body).
  useEffect(() => {
    if (!open || objects) return;
    let alive = true;
    fetch(`/api/brainstorm/space/${spaceId}/library/objects`)
      .then((r) => (r.ok ? r.json() : { objects: [] }))
      .then((j) => {
        if (alive) setObjects(Array.isArray(j.objects) ? j.objects.map(mapObject) : []);
      })
      .catch(() => {
        if (alive) setObjects([]);
      });
    return () => {
      alive = false;
    };
  }, [open, objects, spaceId]);
  const loading = open && objects === null;

  // Open an object → fire OPEN_CARD_DETAIL_EVENT; the board-level
  // ObjectDetailMount listens and opens the object detail drawer.
  function openObject(o: LibObject) {
    try {
      window.dispatchEvent(new CustomEvent(OPEN_CARD_DETAIL_EVENT, { detail: { objectId: o.id } }));
    } catch {
      /* event is best-effort */
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        title="Library — objects + glossary"
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
    { id: "objects", label: "Objects", Icon: Boxes },
    { id: "glossary", label: "Glossary", Icon: BookOpen },
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

        {view === "objects" ? (
          <ObjectsView objects={objects} loading={loading} onOpen={openObject} />
        ) : (
          <GlossaryView spaceId={spaceId} editor={editor} objects={objects ?? []} onOpen={openObject} />
        )}
      </div>
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
