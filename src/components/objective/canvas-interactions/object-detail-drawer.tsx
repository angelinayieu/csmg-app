"use client";

// ── Object detail drawer (the oc-card / Library object metadata + KG) ──
//
// The listener for OPEN_CARD_DETAIL_EVENT {objectId} — fired by the oc-card
// shape (double-click) AND the Library rail. Opens a centered glass modal for a
// single `library_objects` row: its metadata (card_face / summary +
// content_snapshot gallery) + the back-half OBJECT GRAPH (object_links to other
// objects, clickable to navigate). This is the NEW object-layer detail surface
// (replaces the entity-based drawer for the object layer). Reads
// GET …/library/objects/[objectId]. Mount once at the board level.

import { useEffect, useState, type CSSProperties } from "react";
import type { Editor, TLShape, TLShapeId } from "tldraw";
import { X, Loader2, Boxes, ArrowRight, ArrowLeft, MapPin, Target, Star } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { labelFor, panToShape } from "../favorites-sidebar";
import { ObjectClusterGraph } from "./object-cluster-graph";

export const OPEN_CARD_DETAIL_EVENT = "objective-board:open-card-detail";

interface ObjectLinkRef {
  id: string;
  relation: string;
  direction: "out" | "in";
  title: string;
  type: string;
  subsystem?: string | null;
}
interface LibObjectFull {
  id: string;
  object_type: string;
  title: string;
  summary: string | null;
  card_face?: { name?: string; body?: string } | null;
  content_snapshot?: unknown;
  selection_status?: string | null;
  on_whiteboard?: boolean;
  board_shape_id?: string | null;
  source_entity_id?: string | null;
  subsystem?: string | null;
}
interface DetailResponse {
  object: LibObjectFull | null;
  links: ObjectLinkRef[];
}

const titleCase = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function renderItem(it: unknown): string {
  if (typeof it === "string") return it;
  if (it && typeof it === "object") {
    const o = it as Record<string, unknown>;
    const v = o.title ?? o.name ?? o.label ?? o.text ?? o.summary;
    return typeof v === "string" ? v : JSON.stringify(o).slice(0, 120);
  }
  return String(it);
}

/** Defensive render of content_snapshot — string fields + array galleries only;
 *  skips deep/unknown structures so an arbitrary blob can't break the modal. */
function Gallery({ snapshot }: { snapshot: unknown }) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const entries = Object.entries(snapshot as Record<string, unknown>).filter(([, v]) =>
    typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) && v.length > 0,
  );
  if (!entries.length) return null;
  return (
    <>
      {entries.map(([k, v]) => (
        <section key={k} style={{ marginTop: 12 }}>
          <div style={sectionLabel}>{titleCase(k)}</div>
          {typeof v === "string" ? (
            <p style={bodyText}>{v}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {(v as unknown[]).slice(0, 12).map((it, i) => (
                <div key={i} style={galleryItem}>
                  {renderItem(it)}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}

/** Select + center the oc-card whose props.objectId matches (best-effort). */
function focusObjectOnBoard(editor: Editor, objectId: string): boolean {
  try {
    for (const s of editor.getCurrentPageShapes()) {
      if ((s.props as { objectId?: unknown }).objectId === objectId) {
        editor.select(s.id);
        const b = editor.getShapePageBounds(s.id);
        if (b)
          editor.centerOnPoint(
            { x: b.midX, y: b.midY },
            { animation: { duration: 300 } },
          );
        return true;
      }
    }
  } catch {
    /* best-effort */
  }
  return false;
}

function ObjectDetailDrawer({
  spaceId,
  objectId,
  editor,
  onClose,
  onNavigate,
}: {
  spaceId: string;
  objectId: string;
  editor: Editor;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  // data starts null (lazy); the component is keyed by objectId so navigating to
  // a linked object remounts it fresh — no setState in the effect body.
  const [data, setData] = useState<DetailResponse | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // "+ Link" picker state — persists a REAL object_link from this card so the
  // connection shows up in the cluster graph (manual linking, collision-free).
  const [linkOpen, setLinkOpen] = useState(false);
  const [relation, setRelation] = useState<"feeds" | "depends_on">("feeds");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<
    { id: string; title: string; type: string }[]
  >([]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/brainstorm/space/${spaceId}/library/objects/${objectId}`)
      .then((r) => (r.ok ? r.json() : { object: null, links: [] }))
      .then((j) => {
        if (alive) setData({ object: j.object ?? null, links: j.links ?? [] });
      })
      .catch(() => {
        if (alive) setData({ object: null, links: [] });
      });
    return () => {
      alive = false;
    };
  }, [spaceId, objectId, reloadTick]);

  // Lazy-load link candidates the first time the picker opens.
  useEffect(() => {
    if (!linkOpen || candidates.length) return;
    let alive = true;
    fetch(`/api/brainstorm/space/${spaceId}/library/objects`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && Array.isArray(j?.objects)) {
          setCandidates(
            (
              j.objects as Array<{ id: string; title: string; type: string }>
            ).map((o) => ({ id: o.id, title: o.title, type: o.type })),
          );
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [linkOpen, spaceId, candidates.length]);

  async function doLink(toId: string) {
    try {
      await fetch(`/api/objective/${spaceId}/link-objects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromObjectId: objectId,
          toObjectId: toId,
          relation,
        }),
      });
    } catch {
      /* soft-fail */
    }
    setLinkOpen(false);
    setQuery("");
    setReloadTick((t) => t + 1); // re-fetch detail → cluster graph updates
  }

  const loading = data === null;
  const obj = data?.object ?? null;
  const links = data?.links ?? [];
  const name = obj?.card_face?.name?.trim() || obj?.title || "Object";
  const body = obj?.card_face?.body?.trim() || obj?.summary || "";

  // group links by relation
  const linkGroups = new Map<string, ObjectLinkRef[]>();
  for (const l of links) {
    const arr = linkGroups.get(l.relation);
    if (arr) arr.push(l);
    else linkGroups.set(l.relation, [l]);
  }
  const linkedIds = new Set(links.map((l) => l.id));

  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={rail}>
        {/* header */}
        <div style={header}>
          <Boxes style={{ width: 15, height: 15, color: appleVibe.text.secondary }} strokeWidth={2.2} />
          <span style={titleStyle}>{name}</span>
          <button type="button" title="Close" onClick={onClose} style={closeBtn}>
            <X style={{ width: 16, height: 16 }} strokeWidth={2.2} />
          </button>
        </div>

        <div style={scroll}>
          {loading ? (
            <div style={emptyRow}>
              <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading object…
            </div>
          ) : !obj ? (
            <div style={{ padding: "12px 2px", fontSize: 12.5, color: appleVibe.text.tertiary }}>
              This object couldn&apos;t be loaded.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={typePill}>{titleCase(obj.object_type)}</span>
                {obj.selection_status && obj.selection_status !== "candidate" && (
                  <span style={statusPill}>{titleCase(obj.selection_status)}</span>
                )}
                {obj.on_whiteboard && <span style={statusPill}>On board</span>}
                {obj.subsystem && <span style={subsystemPill}>{obj.subsystem}</span>}
              </div>

              {body && <p style={{ ...bodyText, marginTop: 10 }}>{body}</p>}

              <Gallery snapshot={obj.content_snapshot} />

              {/* cluster — this object + its linked neighborhood, plus a
                  "+ Link" affordance that persists a real object_link. */}
              {obj && (
                <section style={{ marginTop: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={sectionLabel}>Cluster</div>
                    <button
                      type="button"
                      onClick={() => setLinkOpen((v) => !v)}
                      style={linkAddBtn}
                    >
                      {linkOpen ? "Cancel" : "+ Link"}
                    </button>
                  </div>

                  {linkOpen && (
                    <div style={pickerWrap}>
                      <div style={{ display: "flex", gap: 6, marginBottom: 7 }}>
                        {(["feeds", "depends_on"] as const).map((rel) => (
                          <button
                            key={rel}
                            type="button"
                            onClick={() => setRelation(rel)}
                            style={relChip(relation === rel)}
                          >
                            {rel === "feeds" ? "Feeds" : "Depends on"}
                          </button>
                        ))}
                      </div>
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search a card to link…"
                        style={searchInput}
                      />
                      <div
                        style={{
                          marginTop: 6,
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                          maxHeight: 168,
                          overflowY: "auto",
                        }}
                      >
                        {candidates
                          .filter(
                            (c) =>
                              c.id !== objectId &&
                              !linkedIds.has(c.id) &&
                              c.title
                                .toLowerCase()
                                .includes(query.trim().toLowerCase()),
                          )
                          .slice(0, 10)
                          .map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => doLink(c.id)}
                              style={linkRow}
                              onMouseEnter={(e) =>
                                (e.currentTarget.style.background =
                                  appleVibe.surface.chipHover)
                              }
                              onMouseLeave={(e) =>
                                (e.currentTarget.style.background =
                                  appleVibe.surface.chip)
                              }
                              title={`Link "${c.title}"`}
                            >
                              <span style={{ minWidth: 0, flex: 1 }}>
                                <span style={linkTitle}>{c.title}</span>
                                <span style={linkType}>{titleCase(c.type)}</span>
                              </span>
                            </button>
                          ))}
                        {candidates.length === 0 && (
                          <div style={{ ...emptyRow, padding: "8px 2px" }}>
                            Loading…
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {links.length > 0 ? (
                    <div
                      style={{
                        marginTop: 8,
                        borderRadius: appleVibe.radius.sm,
                        background: appleVibe.surface.chip,
                        padding: "8px 4px",
                      }}
                    >
                      <ObjectClusterGraph
                        centerTitle={name}
                        centerType={obj.object_type}
                        neighbors={links.map((l) => ({
                          id: l.id,
                          title: l.title,
                          type: l.type,
                          relation: l.relation,
                          direction: l.direction,
                        }))}
                        onNavigate={onNavigate}
                      />
                    </div>
                  ) : (
                    !linkOpen && (
                      <div style={{ ...emptyRow, padding: "10px 2px" }}>
                        No connections yet — + Link to feed this into another
                        card.
                      </div>
                    )
                  )}
                </section>
              )}

              {/* object graph — the back-half links */}
              {links.length > 0 && (
                <section style={{ marginTop: 14 }}>
                  <div style={sectionLabel}>Linked objects · {links.length}</div>
                  {Array.from(linkGroups.entries()).map(([relation, group]) => (
                    <div key={relation} style={{ marginTop: 6 }}>
                      <div style={relationLabel}>{titleCase(relation)}</div>
                      {group.map((l) => (
                        <button
                          key={`${l.id}-${l.direction}`}
                          type="button"
                          onClick={() => onNavigate(l.id)}
                          style={linkRow}
                          onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                          onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
                          title={`Open "${l.title}"`}
                        >
                          {l.direction === "out" ? (
                            <ArrowRight style={linkArrow} strokeWidth={2.2} />
                          ) : (
                            <ArrowLeft style={linkArrow} strokeWidth={2.2} />
                          )}
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={linkTitle}>{l.title}</span>
                            <span style={linkType}>{titleCase(l.type)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </section>
              )}

              {/* footer actions */}
              <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => focusObjectOnBoard(editor, obj.id)}
                  style={footerBtn}
                >
                  <MapPin style={{ width: 13, height: 13 }} strokeWidth={2.2} /> Find on board
                </button>
              </div>
            </>
          )}
        </div>
    </div>
  );
}

// ── The objective itself, as a node ──
// The objective is NOT a library_objects row (it lives on the `spaces` row and
// as the on-board objective-card). So when the marker id "__obj" is opened we
// render this board-sourced node instead of fetching /library/objects — its
// contents are EVERYTHING currently on the whiteboard, favorited cards first
// (they carry more weight). Reuses the same modal chrome as the object drawer.
export const OBJECTIVE_MARKER = "__obj";

// Structural / primitive shapes that aren't "contents" of the objective.
const NON_CONTENT_TYPES = new Set([
  "objective-card", // the objective itself
  "chatbox-card", // transient intake textarea
  "room-card",
  "layer-band",
  "arrow",
  "draw",
  "geo",
  "text",
  "line",
  "highlight",
  "frame",
  "group",
  "note",
  "image",
  "embed",
  "bookmark",
  "video",
]);

function isContentCard(s: TLShape): boolean {
  if (NON_CONTENT_TYPES.has(s.type)) return false;
  // Every custom content card ends in "-card"; plus a couple that don't.
  return (
    s.type.endsWith("-card") ||
    s.type === "prompt-sharpening" ||
    s.type === "subsystem-kg"
  );
}

interface ContentRow {
  id: TLShapeId;
  type: string;
  label: string;
  favorited: boolean;
}

function ObjectiveNode({
  spaceId,
  editor,
  onClose,
}: {
  spaceId: string;
  editor: Editor;
  onClose: () => void;
}) {
  // Snapshot the board at open time (the modal covers the board, so the set
  // can't change while it's up). Favorited cards sort to the top — weighted.
  const objCard = editor
    .getCurrentPageShapes()
    .find((s) => s.type === "objective-card");
  const op = (objCard?.props ?? {}) as { title?: string; objective?: string };
  const title = op.title?.trim() || "Objective";
  const objective = op.objective?.trim() || "";

  const contents: ContentRow[] = editor
    .getCurrentPageShapes()
    .filter(isContentCard)
    .map((s) => ({
      id: s.id,
      type: s.type,
      label: labelFor(s),
      favorited: !!(s.meta as { favorited?: boolean })?.favorited,
    }))
    .sort((a, b) => Number(b.favorited) - Number(a.favorited));
  const favCount = contents.filter((c) => c.favorited).length;

  // Light enrichment: the sharpened ambiguities as metadata chips (best-effort).
  const [chips, setChips] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/objective/${spaceId}/prompt-sharpening`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || j?.status !== "ready" || !j.artifact) return;
        const ranked = Array.isArray(j.artifact.ranked_ambiguities)
          ? j.artifact.ranked_ambiguities
          : [];
        setChips(
          ranked
            .slice(0, 6)
            .map((r: { ambiguity_type?: string }) =>
              String(r?.ambiguity_type ?? "")
                .replace(/ambiguity/i, "")
                .trim(),
            )
            .filter(Boolean),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [spaceId]);

  // Space images (stored binaries) — so analyzed images stay visible in the
  // storage area, not only on the board. Safe route (guaranteed columns only).
  const [images, setImages] = useState<{ id: string; name: string; url: string }[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/objective/${spaceId}/stored-images`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && Array.isArray(j?.images)) setImages(j.images);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [spaceId]);

  function goTo(id: TLShapeId) {
    onClose();
    panToShape(editor, id);
  }

  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={rail}>
        <div style={header}>
          <Target style={{ width: 15, height: 15, color: appleVibe.text.secondary }} strokeWidth={2.2} />
          <span style={titleStyle}>{title}</span>
          <button type="button" title="Close" onClick={onClose} style={closeBtn}>
            <X style={{ width: 16, height: 16 }} strokeWidth={2.2} />
          </button>
        </div>

        <div style={scroll}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={typePill}>Objective</span>
            <span style={statusPill}>{contents.length} on board</span>
            {favCount > 0 && (
              <span style={statusPill}>
                <Star style={{ width: 11, height: 11, marginRight: 4, fill: "#F43F5E", color: "#F43F5E" }} />
                {favCount} weighted
              </span>
            )}
          </div>

          {objective && <p style={{ ...bodyText, marginTop: 10 }}>{objective}</p>}

          {chips.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {chips.map((c) => (
                <span key={c} style={galleryItem}>{titleCase(c)}</span>
              ))}
            </div>
          )}

          {/* Contents — everything on the whiteboard, weighted ones first. */}
          <section style={{ marginTop: 14 }}>
            <div style={sectionLabel}>Contains · {contents.length}</div>
            {contents.length === 0 ? (
              <div style={{ ...emptyRow, padding: "10px 2px" }}>
                Nothing on the board yet — cards you add live here.
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                {contents.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => goTo(c.id)}
                    style={{
                      ...linkRow,
                      border: c.favorited
                        ? "1px solid rgba(244,63,94,0.35)"
                        : linkRow.border,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
                    title={`Find "${c.label}" on the board`}
                  >
                    {c.favorited ? (
                      <Star style={{ ...linkArrow, fill: "#F43F5E", color: "#F43F5E" }} strokeWidth={2.2} />
                    ) : (
                      <MapPin style={linkArrow} strokeWidth={2.2} />
                    )}
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={linkTitle}>{c.label}</span>
                      <span style={linkType}>
                        {titleCase(c.type.replace(/-card$/, ""))}
                        {c.favorited ? " · weighted" : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {images.length > 0 && (
            <section style={{ marginTop: 14 }}>
              <div style={sectionLabel}>Images · {images.length}</div>
              <div
                style={{
                  marginTop: 6,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                }}
              >
                {images.map((im) => (
                  <a
                    key={im.id}
                    href={im.url}
                    target="_blank"
                    rel="noreferrer"
                    title={im.name}
                    style={{
                      display: "block",
                      borderRadius: appleVibe.radius.sm,
                      overflow: "hidden",
                      border: "1px solid var(--glass-border)",
                      aspectRatio: "4 / 3",
                      background: appleVibe.surface.chip,
                    }}
                  >
                    {/* External Storage URL — plain img (next/image can't optimize it). */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={im.url}
                      alt={im.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
    </div>
  );
}

/** Mount once at the board level. Listens for OPEN_CARD_DETAIL_EVENT and opens
 *  the object drawer; navigating a link remounts it for the new object. The
 *  marker id "__obj" opens the board-sourced ObjectiveNode instead. */
export function ObjectDetailMount({ spaceId, editor }: { spaceId: string; editor: Editor }) {
  const [objectId, setObjectId] = useState<string | null>(null);

  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent<{ objectId?: string }>).detail?.objectId;
      if (id) setObjectId(String(id));
    }
    window.addEventListener(OPEN_CARD_DETAIL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CARD_DETAIL_EVENT, onOpen);
  }, []);

  // Esc closes the rail (there's no backdrop to click — it's non-occluding).
  useEffect(() => {
    if (!objectId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setObjectId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [objectId]);

  if (!objectId) return null;
  if (objectId === OBJECTIVE_MARKER) {
    return (
      <ObjectiveNode
        spaceId={spaceId}
        editor={editor}
        onClose={() => setObjectId(null)}
      />
    );
  }
  return (
    <ObjectDetailDrawer
      key={objectId}
      spaceId={spaceId}
      objectId={objectId}
      editor={editor}
      onClose={() => setObjectId(null)}
      onNavigate={(id) => setObjectId(id)}
    />
  );
}

// ── styles ──
// Docked, NON-OCCLUDING right rail (no backdrop) — stays open while the user
// keeps working the whiteboard. Closes via the X button or Esc only. Sits
// above board chrome (z 90) but below true modals (Resolution Studio z 200).
const rail: CSSProperties = {
  position: "fixed",
  top: 16,
  right: 16,
  bottom: 16,
  zIndex: 90,
  width: "min(380px, calc(100vw - 32px))",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  borderRadius: appleVibe.radius.lg,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  border: "1px solid var(--glass-border)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 24px 60px -22px rgba(11,18,40,0.40)",
  fontFamily: appleVibe.font.stack,
};
const subsystemPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 19,
  padding: "0 9px",
  borderRadius: appleVibe.radius.pill,
  background: "rgba(6,148,148,0.12)",
  color: "#069494",
  fontSize: 10.5,
  fontWeight: 650,
};
const linkAddBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 20,
  padding: "0 9px",
  borderRadius: appleVibe.radius.pill,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.chip,
  color: appleVibe.text.secondary,
  fontSize: 10.5,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const pickerWrap: CSSProperties = {
  marginTop: 8,
  padding: 10,
  borderRadius: appleVibe.radius.sm,
  border: "1px solid var(--glass-border)",
  background: "rgba(255,255,255,0.55)",
};
const searchInput: CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid var(--glass-border)",
  background: "rgba(255,255,255,0.8)",
  fontSize: 12,
  color: appleVibe.text.primary,
  outline: "none",
  fontFamily: appleVibe.font.stack,
};
function relChip(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: "5px 8px",
    borderRadius: appleVibe.radius.sm,
    border: `1px solid ${active ? appleVibe.accent.primary : "var(--glass-border)"}`,
    background: active ? "rgba(37,99,235,0.10)" : appleVibe.surface.chip,
    color: active ? appleVibe.text.primary : appleVibe.text.secondary,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: appleVibe.font.stack,
  };
}
const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "13px 14px 11px",
  borderBottom: "1px solid var(--glass-border)",
};
const titleStyle: CSSProperties = {
  fontSize: 14.5,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: appleVibe.text.primary,
  minWidth: 0,
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const closeBtn: CSSProperties = {
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
  flexShrink: 0,
};
const scroll: CSSProperties = { flex: 1, overflowY: "auto", padding: "12px 16px 18px", minHeight: 0 };
const emptyRow: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "16px 2px", color: appleVibe.text.tertiary, fontSize: 12.5 };
const typePill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 19,
  padding: "0 9px",
  borderRadius: appleVibe.radius.pill,
  background: appleVibe.accent.primary,
  color: appleVibe.text.onAccent,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.02em",
};
const statusPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 19,
  padding: "0 9px",
  borderRadius: appleVibe.radius.pill,
  background: appleVibe.surface.chip,
  color: appleVibe.text.secondary,
  fontSize: 10.5,
  fontWeight: 650,
};
const bodyText: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: appleVibe.text.primary,
  margin: 0,
};
const sectionLabel: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: appleVibe.text.tertiary,
};
const relationLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 650,
  color: appleVibe.text.faint,
  margin: "2px 0",
};
const galleryItem: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.4,
  color: appleVibe.text.secondary,
  padding: "6px 9px",
  borderRadius: appleVibe.radius.sm,
  background: appleVibe.surface.chip,
};
const linkRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "7px 9px",
  marginBottom: 3,
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  background: appleVibe.surface.chip,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const linkArrow: CSSProperties = { width: 13, height: 13, color: appleVibe.text.tertiary, flexShrink: 0 };
const linkTitle: CSSProperties = { fontSize: 12.5, fontWeight: 600, color: appleVibe.text.primary, display: "block" };
const linkType: CSSProperties = { fontSize: 10.5, color: appleVibe.text.faint, display: "block", marginTop: 1 };
const footerBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: appleVibe.radius.pill,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.chip,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  color: appleVibe.text.secondary,
  fontFamily: appleVibe.font.stack,
};
