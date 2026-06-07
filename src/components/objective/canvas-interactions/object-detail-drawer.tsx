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

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Editor, TLShape, TLShapeId } from "tldraw";
import { X, Loader2, Boxes, ArrowRight, ArrowLeft, MapPin, Target, Star, Sparkles, Pencil } from "@/lib/cute-icons";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { labelFor, panToShape } from "../favorites-sidebar";
import { ObjectClusterGraph } from "./object-cluster-graph";
import { slugifyConcept } from "@/lib/objective-canvas/normalize-annotations";
import { usePanel, setPanel } from "@/lib/objective-canvas/board-panel-signal";

export const OPEN_CARD_DETAIL_EVENT = "objective-board:open-card-detail";

// ── MicrosSection ──
// The per-card success rubric (3-5 micros derived from the seed objective).
// Each row shows: label + the one-line WHY (which explicitly cites the
// objective or a laddered factor, per the deriver's prompt) + the laddering
// arrow. Surfacing the WHY closes the trust loop — the connection back to
// the main objective is the whole point of the rubric.
//
// First open hits the route with `cacheOnly: true` so the panel renders
// instantly. On a cache miss, the section auto-derives once (objective-
// keyed Sonnet call ~2s, cached for every future open of this card).
interface MinimalMicro {
  slug: string;
  label: string;
  /** 1-sentence WHY — references the main objective or a laddered factor.
   *  Surfaced under the label so the grounding is visible. */
  why?: string;
  /** Optional measurable signal (threshold / ratio / time-bound). Shown as
   *  a small chip when present — sharper micros include one. */
  success_signal?: string;
  laddersTo: string[];
}

function MicrosSection({
  spaceId,
  objectId,
  objectType,
}: {
  spaceId: string;
  objectId: string;
  objectType: string;
}) {
  const enabled = ["feature", "variable", "mechanism"].includes(objectType);
  const [micros, setMicros] = useState<MinimalMicro[] | null>(null);
  const [busy, setBusy] = useState(false);
  // True once auto-derive has fired for this card — prevents a derive loop
  // if the route legitimately returns [] (e.g. card content missing).
  const autoDerivedRef = useRef(false);
  // slug → label for the ladder arrow. Populated from the route response
  // (which echoes the space's factors) so we don't fetch sharpening twice.
  const [factorLabel, setFactorLabel] = useState<Map<string, string>>(
    () => new Map(),
  );

  const derive = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/objective/${spaceId}/card-micro-objectives`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: objectId }),
        },
      );
      if (res.ok) {
        const j = (await res.json()) as {
          micros?: MinimalMicro[];
          factors?: { slug: string; label: string }[];
        };
        setMicros(Array.isArray(j.micros) ? j.micros : []);
        if (Array.isArray(j.factors)) {
          setFactorLabel(new Map(j.factors.map((f) => [f.slug, f.label])));
        }
      } else {
        // Surface the empty state so the user sees SOMETHING (rather than the
        // loading dot spinning forever on a server error).
        setMicros([]);
      }
    } finally {
      setBusy(false);
    }
  }, [spaceId, objectId]);

  // First open: cache-only read. Free (no LLM) and instant. On a cache miss,
  // AUTO-DERIVE once — the user shouldn't have to click a button to see
  // the rubric for their own card.
  useEffect(() => {
    if (!enabled) return;
    autoDerivedRef.current = false; // reset per card (component is keyed)
    let alive = true;
    fetch(`/api/objective/${spaceId}/card-micro-objectives`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: objectId, cacheOnly: true }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        const cached: MinimalMicro[] = Array.isArray(j?.micros) ? j.micros : [];
        if (Array.isArray(j?.factors)) {
          setFactorLabel(
            new Map(
              (j.factors as { slug: string; label: string }[]).map((f) => [
                f.slug,
                f.label,
              ]),
            ),
          );
        }
        if (cached.length > 0) {
          setMicros(cached);
          return;
        }
        // Cache miss → auto-derive (once). Keep micros = null so the panel
        // stays in the "deriving" state instead of flashing empty.
        if (!autoDerivedRef.current) {
          autoDerivedRef.current = true;
          void derive();
        } else {
          setMicros([]);
        }
      })
      .catch(() => {
        // Network hiccup — fall back to the empty affordance so the user can
        // still kick it manually.
        if (alive) setMicros([]);
      });
    return () => {
      alive = false;
    };
  }, [enabled, spaceId, objectId, derive]);

  if (!enabled) return null;

  // Loading covers BOTH the initial cache-only fetch and the auto-derive
  // round-trip — the user reads one continuous "working on it" state.
  const isLoading = micros === null || busy;
  const isEmpty = micros !== null && micros.length === 0 && !busy;

  return (
    <section style={{ marginTop: 14 }}>
      <div style={microsHeaderRow}>
        <div style={sectionLabel}>
          Micros{micros && micros.length ? ` · ${micros.length}` : ""}
        </div>
        {micros && micros.length > 0 && (
          <button
            type="button"
            onClick={derive}
            disabled={busy}
            style={microsRefreshBtn}
            title="Re-derive — used after editing the card's title or body"
          >
            {busy ? "…" : "↻"}
          </button>
        )}
      </div>
      {/* Provenance line — makes the grounding visible. The deriver's prompt
          frames every micro through the space's main objective; surfacing
          that here is what closes the "this looks disconnected" gap. */}
      {micros && micros.length > 0 && (
        <div style={microsProvenance}>
          Success conditions for this card to serve your main objective.
        </div>
      )}
      {isLoading && (
        <div style={microsHint}>
          {busy ? "Deriving from your objective…" : "Loading…"}
        </div>
      )}
      {isEmpty && (
        <button
          type="button"
          onClick={derive}
          disabled={busy}
          style={microsDerivePill}
          title="Re-derive — the previous derive returned no usable micros."
        >
          Derive
        </button>
      )}
      {micros && micros.length > 0 && (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {micros.map((m) => {
            const ladders = m.laddersTo
              .map((s) => factorLabel.get(s) || s)
              .filter(Boolean);
            return (
              <div key={m.slug} style={microItem}>
                <div style={microLabelRow}>
                  <span style={microLabelText}>{m.label}</span>
                  {ladders.length > 0 && (
                    <span style={microLadderText}>
                      → {ladders.join(" · ")}
                    </span>
                  )}
                </div>
                {m.why && <div style={microWhyText}>{m.why}</div>}
                {m.success_signal && (
                  <div style={microSignalChip} title="Measurable success signal">
                    {m.success_signal}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

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
  /** feature_proposal seed (decompose-cards): how-it-works + confidence. */
  evaluation?: { kind?: string; mechanism?: string; confidence?: number } | null;
  content_snapshot?: unknown;
  selection_status?: string | null;
  on_whiteboard?: boolean;
  board_shape_id?: string | null;
  source_entity_id?: string | null;
  source_ref?: string | null;
  subsystem?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}
interface SiblingRef {
  id: string;
  title: string;
  type: string;
  summary: string | null;
}
/** Image evidence — the trace-back surface for context_concept rows
 *  materialized from a vision extraction. */
interface ImageEvidence {
  ingestedFileId: string;
  imageUrl: string | null;
  sourceName: string | null;
  description: string | null;
  narrative: string | null;
  sourcePhrase: string | null;
}
interface DetailResponse {
  object: LibObjectFull | null;
  links: ObjectLinkRef[];
  siblings?: SiblingRef[];
  imageEvidence?: ImageEvidence | null;
}

/** Human-friendly "5m ago" / "2h ago" for the freshness chip. */
function timeAgo(iso?: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}

/** Provenance label for a source_ref like "op:{opId}:{slug}". Falls back to a
 *  generic "From canvas operation" when we can't decode the op kind. */
function provenanceLabel(ref?: string | null): string | null {
  if (!ref) return null;
  if (ref.startsWith("op:")) return "From canvas operation";
  if (ref.startsWith("converge:")) return "From a converge pass";
  if (ref.startsWith("synthesis:")) return "From deep-synthesize";
  if (ref.startsWith("decompose:")) return "From decompose";
  return null;
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

/** Image evidence panel — the trace-back surface for context_concept rows
 *  materialized from a vision extraction. Renders only when the detail
 *  endpoint populated `imageEvidence`. Shows:
 *    - thumbnail of the original image
 *    - taste-aware narrative (rich prose, the second-pass output)
 *    - technical description (the dry vision extraction summary)
 *    - the verbatim phrase this concept was lifted from
 *  Soft on missing fields — any single piece can be null. */
function ImageEvidencePanel({ evidence }: { evidence: ImageEvidence }) {
  const hasThumb = !!evidence.imageUrl;
  const hasAny =
    evidence.narrative ||
    evidence.description ||
    evidence.sourcePhrase ||
    hasThumb;
  if (!hasAny) return null;
  return (
    <section style={{ marginTop: 14 }}>
      <div style={sectionLabel}>From your image</div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          gap: 12,
          padding: 10,
          borderRadius: 12,
          border: `1px solid ${appleVibe.stroke.soft}`,
          background: appleVibe.surface.chip,
        }}
      >
        {hasThumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={evidence.imageUrl!}
            alt={evidence.sourceName ?? "Source image"}
            style={{
              width: 96,
              height: 96,
              objectFit: "cover",
              borderRadius: 8,
              border: `1px solid ${appleVibe.stroke.soft}`,
              flexShrink: 0,
            }}
          />
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            minWidth: 0,
          }}
        >
          {evidence.narrative && (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                lineHeight: 1.5,
                color: appleVibe.text.primary,
                fontFamily: appleVibe.font.stack,
              }}
            >
              {evidence.narrative}
            </p>
          )}
          {evidence.description && evidence.description !== evidence.narrative && (
            <p
              style={{
                margin: 0,
                fontSize: 11.5,
                lineHeight: 1.45,
                color: appleVibe.text.tertiary,
                fontFamily: appleVibe.font.stack,
              }}
            >
              {evidence.description}
            </p>
          )}
          {evidence.sourcePhrase && (
            <p
              style={{
                margin: 0,
                fontSize: 11.5,
                lineHeight: 1.45,
                color: appleVibe.text.secondary,
                fontStyle: "italic",
                fontFamily: appleVibe.font.stack,
                paddingLeft: 8,
                borderLeft: `2px solid ${appleVibe.accent.primary}`,
              }}
            >
              “{evidence.sourcePhrase}”
            </p>
          )}
          {evidence.sourceName && (
            <span
              style={{
                fontSize: 10.5,
                color: appleVibe.text.faint,
                fontFamily: appleVibe.font.stack,
              }}
            >
              {evidence.sourceName}
            </span>
          )}
        </div>
      </div>
    </section>
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

/** A glossary term as the enriched endpoint returns it (provenance added). */
interface TasteTermLite {
  term: string;
  aliases?: string[];
  provenance?: "yours" | "grounded" | "ai";
  definition?: string;
  concept_slug?: string;
}

/** The taste receipt: which USER-SHAPED terms (yours / grounded — never the
 *  AI's own guesses) actually appear in this card's text. The signal that the
 *  AI generated this WITH the user's vocabulary, so they don't re-explain it.
 *  Word-boundary match to avoid substring noise; small cap. */
function tasteHitsFor(
  text: string,
  terms: TasteTermLite[],
  cap = 6,
): Array<{ term: string; yours: boolean }> {
  const hay = text.toLowerCase();
  if (!hay.trim() || terms.length === 0) return [];
  const out: Array<{ term: string; yours: boolean }> = [];
  const seen = new Set<string>();
  for (const t of terms) {
    if (!t.term || t.provenance === "ai" || !t.provenance) continue; // user-shaped only
    const surfaces = [t.term, ...(t.aliases ?? [])]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const hit = surfaces.some((s) => {
      const i = hay.indexOf(s);
      if (i === -1) return false;
      const before = i === 0 ? " " : hay[i - 1];
      const after = i + s.length >= hay.length ? " " : hay[i + s.length];
      return /[^a-z0-9]/.test(before) && /[^a-z0-9]/.test(after);
    });
    const key = t.term.toLowerCase();
    if (hit && !seen.has(key)) {
      seen.add(key);
      out.push({ term: t.term, yours: t.provenance === "yours" });
      if (out.length >= cap) break;
    }
  }
  return out;
}

export function ObjectDetailDrawer({
  spaceId,
  objectId,
  editor,
  onClose,
  onNavigate,
  embedded = false,
  onTitleChange,
}: {
  spaceId: string;
  objectId: string;
  editor: Editor;
  onClose: () => void;
  onNavigate: (id: string) => void;
  /** When true, render only the scroll body — the parent (Library rail) wraps
   *  it in its own chrome (header + side-fork rail container). */
  embedded?: boolean;
  /** Notify the parent of the resolved title so it can render its own header.
   *  Only fires while `embedded`. */
  onTitleChange?: (title: string) => void;
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
  // The space glossary (enriched with provenance) — drives the taste receipt.
  // Space-level, so fetched once per space, not per object.
  const [glossary, setGlossary] = useState<TasteTermLite[]>([]);
  // Active taste capture — refine THIS concept's meaning in place (pins it).
  const [editingTerm, setEditingTerm] = useState(false);
  const [draftDef, setDraftDef] = useState("");
  const [savingTerm, setSavingTerm] = useState(false);
  const [glossaryTick, setGlossaryTick] = useState(0);

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

  // Glossary (with provenance) for the taste receipt. Soft-fail → no receipt.
  useEffect(() => {
    let alive = true;
    fetch(`/api/brainstorm/space/${spaceId}/glossary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && Array.isArray(j?.glossary)) setGlossary(j.glossary as TasteTermLite[]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [spaceId, glossaryTick]);

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

  // Pin the user's meaning for this object's concept. Reuses the glossary PATCH
  // (source:'user' + pinned), so it instantly becomes "yours" everywhere AI
  // reasons + travels to other spaces by concept_slug. Refetch flips the cue.
  async function saveConceptMeaning(termName: string) {
    if (!draftDef.trim()) return;
    setSavingTerm(true);
    try {
      await fetch(`/api/brainstorm/space/${spaceId}/glossary`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          term: termName,
          definition: draftDef.trim(),
          pinned: true,
        }),
      });
    } catch {
      /* soft-fail */
    }
    setSavingTerm(false);
    setEditingTerm(false);
    setGlossaryTick((t) => t + 1);
  }

  const loading = data === null;
  const obj = data?.object ?? null;
  const links = data?.links ?? [];
  const name = obj?.card_face?.name?.trim() || obj?.title || "Object";
  const body = obj?.card_face?.body?.trim() || obj?.summary || "";
  // feature_proposal rich metadata (Step 4) — surfaced in the expanded sidebar,
  // never on the board face.
  const mechanism =
    typeof obj?.evaluation?.mechanism === "string" ? obj.evaluation.mechanism.trim() : "";
  const confidencePct =
    typeof obj?.evaluation?.confidence === "number"
      ? Math.round(obj.evaluation.confidence * 100)
      : null;
  // Which of the user's defined terms shaped this card (receipt on the output).
  // This object's OWN concept as a glossary term (by slug) — the target of the
  // "make it yours" capture. Objects seed the glossary, so this usually hits.
  const objSlug = obj ? slugifyConcept(name) : "";
  // Drop the chip whose term IS the card title — title already shows in the
  // header + the "defined in your words" row; a third copy is just noise.
  const tasteHits = obj
    ? tasteHitsFor(`${name} ${body}`, glossary).filter(
        (h) => !objSlug || slugifyConcept(h.term) !== objSlug,
      )
    : [];
  const matchedTerm =
    obj && objSlug
      ? (glossary.find(
          (t) =>
            (t.concept_slug && t.concept_slug === objSlug) ||
            slugifyConcept(t.term) === objSlug,
        ) ?? null)
      : null;
  const conceptIsYours = matchedTerm?.provenance === "yours";

  // group links by relation
  const linkGroups = new Map<string, ObjectLinkRef[]>();
  for (const l of links) {
    const arr = linkGroups.get(l.relation);
    if (arr) arr.push(l);
    else linkGroups.set(l.relation, [l]);
  }
  const linkedIds = new Set(links.map((l) => l.id));

  // Notify embedded host of the resolved title so it can render its own header.
  useEffect(() => {
    if (embedded && onTitleChange && obj) onTitleChange(name);
  }, [embedded, onTitleChange, name, obj]);

  const scrollBody = (
        <div style={embedded ? scrollEmbedded : scroll}>
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
                {provenanceLabel(obj.source_ref) && (
                  <span
                    style={{ ...statusPill, opacity: 0.85 }}
                    title={obj.source_ref ?? ""}
                  >
                    {provenanceLabel(obj.source_ref)}
                  </span>
                )}
                {timeAgo(obj.updated_at) && (
                  <span style={{ ...statusPill, opacity: 0.75 }} title={obj.updated_at ?? ""}>
                    Updated {timeAgo(obj.updated_at)}
                  </span>
                )}
              </div>

              {/* Taste receipt — the defined terms that shaped this card. "Yours"
                  chips fill accent (mirroring the inline underline); grounded
                  ones are dashed. Closes the trust loop: taste is visibly used. */}
              {tasteHits.length > 0 && (
                <div
                  style={tasteRow}
                  title="Terms you've defined that shaped this card — the AI generated it using your meanings, so you don't have to re-explain them."
                >
                  <Sparkles
                    style={{ width: 12, height: 12, color: appleVibe.accent.primary, flexShrink: 0 }}
                    strokeWidth={2.4}
                  />
                  <span style={tasteLabel}>Shaped by your terms</span>
                  {tasteHits.map((h) => (
                    <span key={h.term} style={h.yours ? tasteChipYours : tasteChip}>
                      {h.term}
                    </span>
                  ))}
                </div>
              )}

              {body && <p style={{ ...bodyText, marginTop: 10 }}>{body}</p>}

              {/* feature_proposal — how it works + confidence (Step 4). Lives in
                  the expanded sidebar ONLY; the board face stays title-first. */}
              {(mechanism || confidencePct !== null) && (
                <section style={{ marginTop: 14 }}>
                  <div style={sectionLabel}>How it works</div>
                  {mechanism && <p style={{ ...bodyText, marginTop: 6 }}>{mechanism}</p>}
                  {confidencePct !== null && (
                    <div style={{ marginTop: 6, fontSize: 11, color: appleVibe.text.faint }}>
                      Confidence {confidencePct}%
                    </div>
                  )}
                </section>
              )}

              {/* Micros — the per-card success rubric. Renders only for
                  feature / variable / mechanism rows (gated inside the
                  component) so insight / image / context cards stay clean. */}
              <MicrosSection
                spaceId={spaceId}
                objectId={obj.id}
                objectType={obj.object_type}
              />

              {/* Active taste capture — pin what this concept means to YOU. The
                  missing "write" side of define-once: one action makes the term
                  yours everywhere AI reasons + travels to your other spaces. */}
              {matchedTerm &&
                (editingTerm ? (
                  <div style={conceptBox}>
                    <div style={sectionLabel}>
                      Define “{matchedTerm.term}” in your words
                    </div>
                    <textarea
                      value={draftDef}
                      onChange={(e) => setDraftDef(e.target.value)}
                      rows={3}
                      autoFocus
                      placeholder="What does this mean in YOUR project? The AI will honor it everywhere."
                      style={conceptTextarea}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        type="button"
                        onClick={() => saveConceptMeaning(matchedTerm.term)}
                        disabled={savingTerm || !draftDef.trim()}
                        style={{
                          ...conceptSaveBtn,
                          opacity: savingTerm || !draftDef.trim() ? 0.5 : 1,
                        }}
                      >
                        {savingTerm ? "Saving…" : "Make it mine"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingTerm(false)}
                        style={conceptCancelBtn}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : conceptIsYours ? (
                  <div
                    style={conceptYoursRow}
                    title="You've defined this — the AI honors your meaning everywhere, and it travels to your other spaces."
                  >
                    <Sparkles
                      style={{ width: 12, height: 12, color: appleVibe.accent.primary, flexShrink: 0 }}
                      strokeWidth={2.4}
                    />
                    <span>
                      {slugifyConcept(matchedTerm.term) === objSlug
                        ? "Defined in your words"
                        : `“${matchedTerm.term}” is defined in your words`}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftDef(matchedTerm.definition ?? body ?? "");
                      setEditingTerm(true);
                    }}
                    style={conceptDefineBtn}
                    title="Pin what this means to you — every AI surface will use your definition, and it carries to your other spaces."
                  >
                    <Pencil style={{ width: 12, height: 12, flexShrink: 0 }} strokeWidth={2.4} />
                    Define “{matchedTerm.term}” in your words
                  </button>
                ))}

              <Gallery snapshot={obj.content_snapshot} />

              {/* Image evidence — when this object is a context_concept that was
                  materialized from a vision extraction, render the trace-back
                  panel: thumbnail + technical description + taste-aware
                  narrative + the verbatim phrase this concept was lifted from.
                  Closes the "how does meta-data trace back to the image" loop. */}
              {data?.imageEvidence && (
                <ImageEvidencePanel evidence={data.imageEvidence} />
              )}

              {/* Sibling rows from the same canvas operation — "How it works"
                  + numbered flow steps — surfaced here so the parent mechanism
                  shows its full breakdown without forcing the user to open every
                  child separately. Hidden in the catalog (collapsed to "+N steps"
                  on the parent's tile). */}
              {data?.siblings && data.siblings.length > 0 && (
                <section style={{ marginTop: 14 }}>
                  <div style={sectionLabel}>
                    Flow ({data.siblings.length} step{data.siblings.length === 1 ? "" : "s"})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                    {data.siblings.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          // navigate the drawer to the sibling without re-mounting
                          window.dispatchEvent(
                            new CustomEvent(OPEN_CARD_DETAIL_EVENT, { detail: { objectId: s.id } }),
                          );
                        }}
                        style={{
                          textAlign: "left",
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(15,23,42,0.06)",
                          background: appleVibe.surface.chip,
                          cursor: "pointer",
                          fontFamily: appleVibe.font.stack,
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: appleVibe.text.primary }}>
                          {s.title}
                        </span>
                        {s.summary && (
                          <span style={{ fontSize: 11.5, lineHeight: 1.4, color: appleVibe.text.tertiary }}>
                            {s.summary}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              )}

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
  );

  if (embedded) return scrollBody;

  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={rail}>
        {/* header */}
        <div style={header}>
          <Boxes
            style={{ width: 15, height: 15, marginTop: 2, color: appleVibe.text.secondary, flexShrink: 0 }}
            strokeWidth={2.2}
          />
          <span style={titleStyle}>{name}</span>
          <button type="button" title="Close" onClick={onClose} style={closeBtn}>
            <X style={{ width: 16, height: 16 }} strokeWidth={2.2} />
          </button>
        </div>
        {scrollBody}
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
 *  marker id "__obj" opens the board-sourced ObjectiveNode instead.
 *
 *  Mutual exclusion with the board-panel rails (Actions/Library/Style): this
 *  floating drawer occupies the SAME top-right slot, so opening it closes any
 *  open panel, and opening any panel closes this drawer. Otherwise two side
 *  panels stack and the user sees both at once. */
export function ObjectDetailMount({ spaceId, editor }: { spaceId: string; editor: Editor }) {
  const [objectId, setObjectId] = useState<string | null>(null);
  const powerupsOpen = usePanel("powerups");
  const libraryOpen = usePanel("library");
  const styleOpen = usePanel("style");

  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent<{ objectId?: string }>).detail?.objectId;
      if (!id) return;
      // Close every top-right panel so this drawer is the only thing in the slot.
      setPanel("powerups", false);
      setPanel("library", false);
      setPanel("style", false);
      setObjectId(String(id));
    }
    window.addEventListener(OPEN_CARD_DETAIL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CARD_DETAIL_EVENT, onOpen);
  }, []);

  // If any board panel opens while the drawer is up, the drawer yields the slot.
  useEffect(() => {
    if (!objectId) return;
    if (powerupsOpen || libraryOpen || styleOpen) setObjectId(null);
  }, [objectId, powerupsOpen, libraryOpen, styleOpen]);

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
  // Sits just under the top-right pill bar (BoardTopRightBar at top:16) so the
  // drawer reclaims vertical space — the title wraps to two lines, so the
  // header needs the headroom.
  top: 64,
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
  alignItems: "flex-start",
  gap: 8,
  padding: "13px 14px 11px",
  borderBottom: "1px solid var(--glass-border)",
};
const titleStyle: CSSProperties = {
  fontSize: 15.5,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  lineHeight: 1.25,
  color: appleVibe.text.primary,
  minWidth: 0,
  flex: 1,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  wordBreak: "break-word",
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
// Embedded variant — the Library rail's catalog body already pads at
// "0 12px 14px", so match that to keep the gutter consistent when forking.
const scrollEmbedded: CSSProperties = { flex: 1, overflowY: "auto", padding: "10px 12px 14px", minHeight: 0 };

// ── Micros section styles ──
// Minimal by intent: section label + a list of one-line rows (label · ladder).
// No icons, no background fills, no edit chrome. Matches the spacing of the
// surrounding sections so it visually fades into the rest of the drawer.
const microsHeaderRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 6,
};
const microsRefreshBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  color: appleVibe.text.tertiary,
  padding: "0 4px",
  lineHeight: 1,
};
const microsHint: CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  color: appleVibe.text.tertiary,
};
const microsDerivePill: CSSProperties = {
  marginTop: 6,
  display: "inline-flex",
  alignItems: "center",
  height: 22,
  padding: "0 12px",
  borderRadius: appleVibe.radius.pill,
  border: `1px solid ${appleVibe.stroke.hairline}`,
  background: appleVibe.surface.chip,
  color: appleVibe.text.primary,
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
};
// One micro row = stacked label + why + optional signal chip. Each micro is
// its own little group so the WHY breathes; the section reads as a list of
// success conditions, not a wall of jammed text.
const microItem: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
};
const microLabelRow: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  fontSize: 12.5,
  lineHeight: 1.4,
  color: appleVibe.text.primary,
  flexWrap: "wrap",
};
const microLabelText: CSSProperties = {
  fontWeight: 600,
  color: appleVibe.text.primary,
};
const microLadderText: CSSProperties = {
  fontSize: 11,
  color: appleVibe.text.tertiary,
};
// The objective-grounded WHY — the sentence the deriver writes that cites
// the main objective or a laddered factor. Slate-secondary so it sits
// quieter than the label but stays fully legible.
const microWhyText: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.45,
  color: appleVibe.text.secondary,
};
const microSignalChip: CSSProperties = {
  alignSelf: "flex-start",
  marginTop: 2,
  fontSize: 10.5,
  fontWeight: 600,
  color: appleVibe.text.secondary,
  padding: "3px 8px",
  borderRadius: appleVibe.radius.pill,
  background: appleVibe.surface.chip,
  border: `1px solid ${appleVibe.stroke.hairline}`,
};
// Provenance line under the section heading — surfaces the objective lens
// so the user reads "these serve my objective" before the list itself.
const microsProvenance: CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  lineHeight: 1.4,
  color: appleVibe.text.tertiary,
  fontStyle: "italic",
};
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
const tasteRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
  marginTop: 10,
  padding: "7px 9px",
  borderRadius: 10,
  background: appleVibe.surface.chip,
};
const tasteLabel: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.02em",
  color: appleVibe.text.secondary,
  marginRight: 2,
};
// "Yours" = solid accent (matches the inline glossary underline); "grounded"
// = dashed outline. The receipt's visual language ties back to the prose cue.
const tasteChipYours: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 18,
  padding: "0 8px",
  borderRadius: appleVibe.radius.pill,
  background: appleVibe.accent.primary,
  color: appleVibe.text.onAccent,
  fontSize: 10.5,
  fontWeight: 700,
};
const tasteChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 18,
  padding: "0 8px",
  borderRadius: appleVibe.radius.pill,
  background: "transparent",
  color: appleVibe.text.secondary,
  fontSize: 10.5,
  fontWeight: 600,
  border: `1px dashed ${appleVibe.text.tertiary}`,
};
// Active taste capture (drawer).
const conceptBox: CSSProperties = {
  marginTop: 10,
  padding: "9px 10px",
  borderRadius: 10,
  background: appleVibe.surface.chip,
};
const conceptTextarea: CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "7px 9px",
  borderRadius: 8,
  border: `1px solid ${appleVibe.text.faint}`,
  background: "transparent",
  color: appleVibe.text.primary,
  fontSize: 12.5,
  lineHeight: 1.45,
  resize: "vertical",
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};
const conceptSaveBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 26,
  padding: "0 12px",
  borderRadius: appleVibe.radius.pill,
  background: appleVibe.accent.primary,
  color: appleVibe.text.onAccent,
  fontSize: 11.5,
  fontWeight: 700,
  border: "none",
  cursor: "pointer",
};
const conceptCancelBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 26,
  padding: "0 10px",
  borderRadius: appleVibe.radius.pill,
  background: "transparent",
  color: appleVibe.text.secondary,
  fontSize: 11.5,
  fontWeight: 600,
  border: "none",
  cursor: "pointer",
};
const conceptYoursRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginTop: 10,
  fontSize: 11.5,
  fontWeight: 600,
  color: appleVibe.text.secondary,
};
const conceptDefineBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  marginTop: 10,
  padding: "6px 10px",
  borderRadius: appleVibe.radius.pill,
  background: "transparent",
  color: appleVibe.accent.primary,
  fontSize: 11.5,
  fontWeight: 650,
  border: `1px dashed ${appleVibe.accent.primary}`,
  cursor: "pointer",
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
