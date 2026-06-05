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
  type ReactNode,
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
  Sparkles,
  NotebookPen,
  ImageIcon,
  Megaphone,
  Wand2,
  Folder,
  FolderPlus,
  Layers,
  Check,
  DoorOpen,
  Plus,
  Target,
  Pin,
  History,
  Library as LibraryIcon,
  type LucideIcon,
} from "@/lib/cute-icons";
import { useRouter } from "next/navigation";
import { deployFolderToBoard } from "./deploy-folder";
import { CrossRoomBrowser } from "./cross-room-browser";
import {
  FOLDER_DND_MIME,
  encodeFolderDrag,
  decodeFolderDrag,
  toOcKind,
  folderSeedKey,
  type FolderDragCard,
} from "./folder-drag";
import type { GlossaryTerm } from "@/lib/objective-canvas/generate-glossary";
import { slugifyConcept } from "@/lib/objective-canvas/normalize-annotations";
import { OPEN_CARD_DETAIL_EVENT } from "@/components/objective/canvas-interactions/object-detail-drawer";
import { openNotebook } from "@/components/objective/board-bus";
import { GlossaryTimelineView } from "@/components/objective/glossary-timeline-view";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  CatalogTile,
  CatalogShelfHeader,
  DisplayToggle,
  catalogGrid,
  tropicalHue,
  CATALOG_SERIF,
} from "./catalog-tile";
import { usePanel, setPanel } from "@/lib/objective-canvas/board-panel-signal";

type View = "glossary" | "objects" | "artifacts" | "timeline";

/** A library_objects row (GET …/library/objects → { objects }). */
interface LibObject {
  id: string; // library_objects.id — the objectId
  title: string;
  type: string; // object_type
  summary: string;
  sourceEntityId: string | null;
  subObjectiveId: string | null;
  onWhiteboard: boolean;
  /** The curation FOLDER — `subsystem` cluster (decompose-seeded or
   *  user/AI re-filed). null → "Unfiled". */
  subsystem: string | null;
  /** The blueprint layer slot (1-based ordinal). null → "Unlayered". */
  layerOrdinal: number | null;
  /** Provenance key — used to group flow-step siblings under their
   *  mechanism parent in the catalog (op:{opId}:{slug} → all share prefix). */
  sourceRef: string | null;
  /** Selection status — "rejected" = archived (hidden from the default list). */
  selectionStatus: string;
}

/** A space layer ({ ordinal, name }) — the GET route now returns the real
 *  domain layer names so "Layer" grouping labels match the board's stack. */
interface LayerInfo {
  ordinal: number;
  name: string;
}

/** How the Objects list is grouped. Folder (the new emphasis) reuses the
 *  `subsystem` cluster; Layer reuses `blueprint_layer_ordinal`; Type is the
 *  original object_type grouping. */
type GroupAxis = "folder" | "layer" | "type" | "room";

const DEFAULT_LAYER_NAMES: Record<number, string> = {
  1: "Substrate",
  2: "Mechanism",
  3: "Process",
  4: "Output",
  5: "Outcome",
};
// Layer dot palette (substrate→outcome). Soft + distinct; falls back to faint.
const LAYER_COLORS: Record<number, string> = {
  1: "#94A3B8",
  2: "#2563EB",
  3: "#0D9488",
  4: "#D97706",
  5: "#16A34A",
};
const layerColor = (ord: number) => LAYER_COLORS[ord] ?? appleVibe.text.faint;
// Folder dot — matches the detail drawer's subsystem pill teal.
const FOLDER_DOT = "#069494";

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
    subsystem:
      typeof o.subsystem === "string" && o.subsystem.trim() ? o.subsystem.trim() : null,
    layerOrdinal:
      typeof o.blueprint_layer_ordinal === "number" ? o.blueprint_layer_ordinal : null,
    sourceRef: typeof o.source_ref === "string" ? o.source_ref : null,
    selectionStatus: typeof o.selection_status === "string" ? o.selection_status : "candidate",
  };
}

/**
 * Group flow-step siblings under their mechanism parent.
 *
 * The decompose / idea-mechanism operations emit ONE library_objects row per
 * spec item (the root mechanism + "How it works" + every numbered flow step),
 * all sharing the same `op:{opId}:` sourceRef prefix. The user sees these as
 * confusing top-level peers in the catalog; here we collapse them so only the
 * PARENT renders at top level, with its children counted as "+N steps" (and
 * surfaced inside the detail drawer's content_snapshot view).
 *
 * Parent heuristic: among siblings with the same `op:{opId}:` prefix, pick the
 * one whose title is NOT "How it works" and does NOT start with "N." — that's
 * the root mechanism. If nothing fits (e.g. only flow steps survived an old
 * cleanup), the first sibling becomes the parent so nothing is lost.
 *
 * Pure FE — no schema change, retroactive on the 82 existing objects.
 */
const FLOW_STEP_TITLE = /^\s*\d+\s*[\.:)]/;
const HOW_IT_WORKS = /^how it works$/i;
function opPrefix(ref: string | null): string | null {
  if (!ref || !ref.startsWith("op:")) return null;
  // "op:{opId}:{slug}" → "op:{opId}"
  const i = ref.indexOf(":", 3);
  return i === -1 ? null : ref.slice(0, i);
}
function collapseFlowSteps(rows: LibObject[]): { roots: LibObject[]; childCount: Map<string, number> } {
  const groups = new Map<string, LibObject[]>();
  const loose: LibObject[] = [];
  for (const r of rows) {
    const k = opPrefix(r.sourceRef);
    if (!k) {
      loose.push(r);
      continue;
    }
    const arr = groups.get(k);
    if (arr) arr.push(r);
    else groups.set(k, [r]);
  }
  const roots: LibObject[] = [...loose];
  const childCount = new Map<string, number>();
  for (const siblings of groups.values()) {
    if (siblings.length <= 1) {
      roots.push(...siblings);
      continue;
    }
    // Parent = first row that is NOT a flow step and NOT "How it works".
    let parent = siblings.find(
      (s) => !FLOW_STEP_TITLE.test(s.title) && !HOW_IT_WORKS.test(s.title),
    );
    if (!parent) parent = siblings[0];
    roots.push(parent);
    childCount.set(parent.id, siblings.length - 1);
  }
  return { roots, childCount };
}

/** Find the board card whose title/text matches a term, select + center it. */
/** Pull searchable text out of a shape (title + subtitle + name + freeform
 *  text). Used by citation scan + focus. */
function shapeText(s: { props: unknown }): string {
  const p = s.props as {
    title?: unknown;
    subtitle?: unknown;
    name?: unknown;
    text?: unknown;
    body?: unknown;
  };
  return [p.title, p.subtitle, p.name, p.text, p.body]
    .map((v) => (typeof v === "string" ? v : ""))
    .join(" ");
}

/** Best human-readable label for a citation row. */
function shapeLabel(s: { props: unknown; type: string }): string {
  const p = s.props as { title?: unknown; name?: unknown; text?: unknown };
  const raw =
    (typeof p.title === "string" && p.title.trim()) ||
    (typeof p.name === "string" && p.name.trim()) ||
    (typeof p.text === "string" && p.text.trim()) ||
    s.type;
  return String(raw).replace(/\s+/g, " ").slice(0, 72);
}

/** Select + center a shape on the board. */
function focusShape(editor: Editor, id: TLShapeId): boolean {
  try {
    editor.select(id);
    const b = editor.getShapePageBounds(id);
    if (b)
      editor.centerOnPoint(
        { x: b.midX, y: b.midY },
        { animation: { duration: 300 } },
      );
    return true;
  } catch {
    return false;
  }
}

/** All lowercased surface forms (term + aliases) for a glossary entry. */
function termSurfaces(t: GlossaryTerm): string[] {
  return [t.term, ...(t.aliases ?? [])]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "that", "this", "these",
  "those", "are", "was", "were", "have", "has", "but", "not", "any", "all",
  "can", "may", "via", "per", "you", "your", "our", "their", "its", "use",
  "uses", "used", "make", "made", "off", "out",
]);
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 3-tier glossary→object match: (1) slug equality, (2) surface form in
 *  object title, (3) token Jaccard ≥ 0.45 over title+summary. */
function matchObjectForTerm(
  t: GlossaryTerm,
  objects: LibObject[],
): LibObject | null {
  if (!objects.length) return null;
  const surfs = termSurfaces(t);
  const termSlug = t.concept_slug?.trim() || slugifyConcept(t.term);
  if (termSlug) {
    for (const o of objects) {
      if (slugifyConcept(o.title) === termSlug) return o;
    }
  }
  for (const o of objects) {
    const title = o.title.trim().toLowerCase();
    for (const s of surfs) {
      if (s && (title === s || title.includes(s) || s.includes(title))) {
        return o;
      }
    }
  }
  const tQ = tokens(`${t.term} ${(t.aliases ?? []).join(" ")}`);
  if (tQ.size > 0) {
    let best: LibObject | null = null;
    let bestScore = 0;
    for (const o of objects) {
      const tO = tokens(`${o.title} ${o.summary ?? ""}`);
      const score = jaccard(tQ, tO);
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (bestScore >= 0.45) return best;
  }
  return null;
}

interface Citation {
  shapeId: TLShapeId;
  label: string;
  shapeType: string;
}
function findCitations(editor: Editor, t: GlossaryTerm, cap = 8): Citation[] {
  const out: Citation[] = [];
  const surfs = termSurfaces(t);
  if (!surfs.length) return out;
  try {
    for (const s of editor.getCurrentPageShapes()) {
      const hay = shapeText(s).toLowerCase();
      if (!hay) continue;
      if (surfs.some((sf) => sf && hay.includes(sf))) {
        out.push({
          shapeId: s.id as TLShapeId,
          label: shapeLabel(s),
          shapeType: s.type,
        });
        if (out.length >= cap) break;
      }
    }
  } catch {
    /* best-effort */
  }
  return out;
}

/** layer_tag → library_objects.object_type for Promote. */
function objectTypeForLayer(tag: string | null | undefined): string {
  switch ((tag ?? "").toLowerCase()) {
    case "feature":
    case "features":
      return "feature";
    case "variable":
    case "variables":
      return "variable";
    case "goal":
    case "goals":
    case "outcome":
    case "outcomes":
      return "insight";
    case "constraint":
    case "constraints":
      return "variable";
    case "mechanism":
    case "mechanisms":
      return "mechanism";
    default:
      return "insight";
  }
}

const SOURCE_LABEL: Record<string, string> = {
  annotation: "from annotation lens",
  entity: "from entity",
  user: "user-pinned",
  llm: "LLM-mined",
};

/** Collapsible section header rendered as a WHITE PILL with a soft drop
 *  shadow — the unified "folder tab" for every grouped list in the rail.
 *  `accessory` hangs an action (e.g. per-section controls) to its right. */
function GroupHeader({
  label,
  count,
  collapsed,
  onToggle,
  dotColor,
  accessory,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  dotColor?: string;
  accessory?: ReactNode;
}) {
  return (
    <div style={groupHeaderRow}>
      <button
        type="button"
        onClick={onToggle}
        style={groupPill}
        onMouseEnter={(e) => (e.currentTarget.style.boxShadow = appleVibe.shadow.cardHover)}
        onMouseLeave={(e) => (e.currentTarget.style.boxShadow = appleVibe.shadow.chip)}
      >
        {collapsed ? (
          <ChevronRight style={groupChev} strokeWidth={2.6} />
        ) : (
          <ChevronDown style={groupChev} strokeWidth={2.6} />
        )}
        {dotColor && (
          <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: dotColor }} />
        )}
        <span style={groupPillLabel}>{label}</span>
        <span style={groupPillCount}>{count}</span>
      </button>
      {accessory}
    </div>
  );
}

function ConceptDetail({
  term,
  linked,
  citations,
  spaceId,
  onOpenObject,
  onFocusCitation,
  onPromote,
  onChanged,
}: {
  term: GlossaryTerm;
  linked: LibObject | null;
  citations: Citation[];
  spaceId: string;
  onOpenObject: (o: LibObject) => void;
  onFocusCitation: (c: Citation) => void;
  onPromote: () => void;
  onChanged: () => void;
}) {
  // Definition-page controls consolidated from the deprecated notebook: edit +
  // pin in place (optimistic local state; onChanged refetches the list). Depth
  // (evidence / cross-space / inherited) reads the enriched glossary fields.
  const enr = term as GlossaryTerm & {
    evidence?: Array<{ label?: string; detail?: string }>;
    crossSpaceCount?: number;
  };
  const evidence = enr.evidence ?? [];
  const crossN = enr.crossSpaceCount ?? 0;
  const inheritedFrom = term.cross_space_origin_title ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(term.definition);
  const [saving, setSaving] = useState(false);
  const [localDef, setLocalDef] = useState(term.definition);
  const [localPinned, setLocalPinned] = useState(!!term.pinned);
  const patch = async (payload: { definition?: string; pinned?: boolean }) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/brainstorm/space/${spaceId}/glossary`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ term: term.term, ...payload }),
      });
      const json = (await res.json().catch(() => null)) as { term?: GlossaryTerm } | null;
      if (res.ok && json?.term) {
        setLocalDef(json.term.definition ?? localDef);
        setLocalPinned(!!json.term.pinned);
      }
    } catch {
      /* soft-fail */
    }
    setSaving(false);
    onChanged();
  };
  return (
    <div style={conceptPanel} onClick={(e) => e.stopPropagation()}>
      <div style={conceptProvenance}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: SOURCE_DOT[localPinned ? "user" : term.source] ?? "#94A3B8" }} />
        <span>{localPinned ? SOURCE_LABEL.user : (SOURCE_LABEL[term.source] ?? term.source)}</span>
        {inheritedFrom && (
          <span style={layerChip} title={`Inherited from your "${inheritedFrom}"`}>↗ {inheritedFrom}</span>
        )}
        {term.layer_tag && <span style={layerChip}>{titleCase(term.layer_tag)}</span>}
        <button
          type="button"
          onClick={() => void patch({ pinned: !localPinned })}
          title={localPinned ? "Unpin (allow refresh)" : "Pin (keep across refreshes)"}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "2px 7px",
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 650,
            background: localPinned ? "rgba(217,119,6,0.14)" : appleVibe.surface.chip,
            color: localPinned ? "rgba(146,64,14,0.95)" : appleVibe.text.tertiary,
          }}
        >
          <Pin
            style={{ width: 9, height: 9, fill: localPinned ? "rgba(217,119,6,0.4)" : "none" }}
            strokeWidth={2.6}
          />
          {localPinned ? "pinned" : "pin"}
        </button>
      </div>

      <div style={conceptSection}>
        <div style={conceptSectionLabel}>Definition</div>
        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              style={{
                width: "100%",
                resize: "vertical",
                borderRadius: 8,
                padding: "7px 9px",
                fontSize: 12,
                lineHeight: 1.45,
                fontFamily: "inherit",
                color: appleVibe.text.primary,
                background: appleVibe.surface.chip,
                border: `1px solid ${appleVibe.text.faint}`,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                disabled={saving || !draft.trim()}
                onClick={() => {
                  void patch({ definition: draft.trim() });
                  setEditing(false);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  background: appleVibe.accent.primary,
                  color: appleVibe.text.onAccent,
                  opacity: saving || !draft.trim() ? 0.5 : 1,
                }}
              >
                <Check style={{ width: 11, height: 11 }} strokeWidth={2.6} /> Save &amp; pin
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  background: "transparent",
                  color: appleVibe.text.tertiary,
                }}
              >
                <X style={{ width: 11, height: 11 }} strokeWidth={2.6} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p style={{ margin: "2px 0 4px", fontSize: 12, lineHeight: 1.45, color: appleVibe.text.secondary }}>
              {localDef}
            </p>
            <button
              type="button"
              onClick={() => {
                setDraft(localDef);
                setEditing(true);
              }}
              style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", fontSize: 11, fontWeight: 600, color: appleVibe.accent.primary }}
            >
              Edit definition
            </button>
          </>
        )}
      </div>

      {(crossN > 0 || evidence.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
          {crossN > 0 && (
            <span
              style={{ borderRadius: 999, padding: "1px 7px", fontSize: 9.5, fontWeight: 600, background: appleVibe.surface.chip, color: appleVibe.text.tertiary }}
              title="You've defined this concept in other spaces too — defined once"
            >
              in {crossN} other space{crossN === 1 ? "" : "s"}
            </span>
          )}
          {evidence.slice(0, 3).map((e, i) => (
            <span
              key={i}
              style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderRadius: 999, padding: "1px 7px", fontSize: 9.5, fontWeight: 500, background: "rgba(37,99,235,0.08)", color: "rgba(30,64,175,0.9)" }}
              title={e.detail || e.label || ""}
            >
              ↳ {e.label}
            </span>
          ))}
        </div>
      )}

      {term.aliases && term.aliases.length > 0 && (
        <div style={conceptAliases}>
          <span style={conceptSectionLabel}>also</span>
          {term.aliases.slice(0, 4).map((a) => (
            <span key={a} style={aliasChip}>{a}</span>
          ))}
        </div>
      )}

      <div style={conceptSection}>
        <div style={conceptSectionLabel}>Linked object</div>
        {linked ? (
          <button
            type="button"
            onClick={() => onOpenObject(linked)}
            style={linkedObjectRow}
            onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
          >
            <span style={{ fontSize: 12.5, fontWeight: 650, color: appleVibe.text.primary }}>
              {linked.title}
            </span>
            <span style={{ fontSize: 10.5, color: appleVibe.text.tertiary, marginLeft: 6 }}>
              {titleCase(linked.type)}
            </span>
            <ChevronRight
              style={{ width: 13, height: 13, color: appleVibe.text.faint, marginLeft: "auto" }}
              strokeWidth={2.4}
            />
          </button>
        ) : (
          <button
            type="button"
            onClick={onPromote}
            style={promoteBtn}
            onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
          >
            <Plus style={{ width: 12, height: 12 }} strokeWidth={2.4} />
            Promote to object
          </button>
        )}
      </div>

      <div style={conceptSection}>
        <div style={conceptSectionLabel}>
          Cited on board{citations.length > 0 ? ` · ${citations.length}` : ""}
        </div>
        {citations.length === 0 ? (
          <div style={{ fontSize: 11.5, color: appleVibe.text.tertiary, padding: "2px 2px 4px" }}>
            Not mentioned on the board yet.
          </div>
        ) : (
          citations.map((c) => (
            <button
              key={c.shapeId}
              type="button"
              onClick={() => onFocusCitation(c)}
              style={citationRow}
              onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Target style={{ width: 11, height: 11, color: appleVibe.text.tertiary, flexShrink: 0 }} strokeWidth={2.4} />
              <span style={{ fontSize: 11.5, color: appleVibe.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.label}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function GlossaryView({
  spaceId,
  editor,
  objects,
  onOpen,
  onObjectsChanged,
}: {
  spaceId: string;
  editor: Editor;
  objects: LibObject[];
  onOpen: (o: LibObject) => void;
  onObjectsChanged?: () => void;
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

  // Per-term matched object (slug → alias → token-jaccard). Memoized so
  // hover/scroll doesn't re-run the scan.
  const matchByTerm = useMemo(() => {
    const m = new Map<string, LibObject | null>();
    for (const t of terms) m.set(t.term, matchObjectForTerm(t, objects));
    return m;
  }, [terms, objects]);

  // The currently expanded term (concept popover, inline below the row).
  const [expanded, setExpanded] = useState<{
    term: GlossaryTerm;
    citations: Citation[];
  } | null>(null);

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
    if (expanded?.term.term === t.term) {
      setExpanded(null);
      return;
    }
    setExpanded({ term: t, citations: findCitations(editor, t) });
  }

  async function promoteTermToObject(t: GlossaryTerm) {
    try {
      const res = await fetch(`/api/brainstorm/space/${spaceId}/library/objects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          objectType: objectTypeForLayer(t.layer_tag),
          title: t.term,
          summary: t.definition,
          sourceRef: `glossary:${t.concept_slug ?? slugifyConcept(t.term)}`,
        }),
      });
      if (!res.ok) {
        setFlash("Couldn't promote — try again");
        return;
      }
      onObjectsChanged?.();
      setFlash(`Promoted "${t.term}"`);
      setExpanded(null);
    } catch {
      setFlash("Couldn't promote — try again");
    } finally {
      window.setTimeout(() => setFlash(null), 1600);
    }
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
                <GroupHeader
                  label={shelf.label}
                  count={shelf.items.length}
                  collapsed={isCollapsed}
                  onToggle={() => toggle(setCollapsed, shelf.key)}
                />
                {!isCollapsed &&
                  shelf.items.map((t) => {
                    const linked = matchByTerm.get(t.term) ?? null;
                    const isOpen = expanded?.term.term === t.term;
                    return (
                      <div key={t.term}>
                        <button
                          type="button"
                          onClick={() => onTermClick(t)}
                          title={isOpen ? "Collapse" : linked ? `Concept · linked to "${linked.title}"` : "Concept — no object yet"}
                          style={termRow}
                          onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                          onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: SOURCE_DOT[t.source] ?? "#94A3B8" }} />
                            <span style={termName}>{t.term}</span>
                            {linked && (
                              <span style={linkedChip} title={`Linked to "${linked.title}"`}>
                                <Pin style={{ width: 9, height: 9 }} strokeWidth={2.6} />
                                object
                              </span>
                            )}
                            {isOpen ? (
                              <ChevronDown style={{ width: 12, height: 12, color: appleVibe.text.faint, marginLeft: "auto" }} strokeWidth={2.4} />
                            ) : (
                              <ChevronRight style={{ width: 12, height: 12, color: appleVibe.text.faint, marginLeft: "auto" }} strokeWidth={2.4} />
                            )}
                          </span>
                          <span style={termDef}>{t.definition}</span>
                        </button>
                        {isOpen && expanded && (
                          <ConceptDetail
                            term={expanded.term}
                            linked={linked}
                            citations={expanded.citations}
                            spaceId={spaceId}
                            onOpenObject={(o) => {
                              onOpen(o);
                              setExpanded(null);
                            }}
                            onFocusCitation={(c) => focusShape(editor, c.shapeId)}
                            onPromote={() => promoteTermToObject(t)}
                            onChanged={() => void load(false)}
                          />
                        )}
                      </div>
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
  spaceId,
  objects,
  setObjects,
  loading,
  layers,
  rooms,
  editor,
  onOpen,
  reload,
  onOpenCrossRoom,
}: {
  spaceId: string;
  objects: LibObject[] | null;
  setObjects: Dispatch<SetStateAction<LibObject[] | null>>;
  loading: boolean;
  layers: LayerInfo[];
  rooms: { id: string; title: string }[];
  editor: Editor;
  onOpen: (o: LibObject) => void;
  reload: () => void;
  onOpenCrossRoom: () => void;
}) {
  // Default to FOLDER grouping — the new organizing emphasis. Layer/Type are
  // the other two axes over the same objects (no refetch on switch).
  const [axis, setAxis] = useState<GroupAxis>("folder");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; kind: "folder" | "layer" } | null>(null);
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // Display mode for the object shelves — TILES (the tropical catalog grid)
  // is the default browse view; ROWS keeps the inline folder/layer chips.
  const [tiles, setTiles] = useState(true);
  const [spinMenu, setSpinMenu] = useState<string | null>(null);
  const router = useRouter();

  const objectsUrl = `/api/brainstorm/space/${spaceId}/library/objects`;

  const layerName = useCallback(
    (ord: number) =>
      layers.find((l) => l.ordinal === ord)?.name ||
      DEFAULT_LAYER_NAMES[ord] ||
      `Layer ${ord}`,
    [layers],
  );
  const layerChoices: LayerInfo[] = useMemo(
    () =>
      layers.length
        ? layers
        : [1, 2, 3, 4, 5].map((o) => ({ ordinal: o, name: DEFAULT_LAYER_NAMES[o] })),
    [layers],
  );

  // Collapse flow-step siblings into their mechanism parent, and hide archived
  // (selection_status === "rejected") rows from the default catalog list. Both
  // are pure-FE filters; nothing is deleted.
  const visibleObjects = useMemo(() => {
    if (!objects) return null;
    const live = objects.filter((o) => o.selectionStatus !== "rejected");
    return live;
  }, [objects]);
  const { roots: visibleRoots, childCount: flowChildCount } = useMemo(
    () => (visibleObjects ? collapseFlowSteps(visibleObjects) : { roots: [], childCount: new Map() }),
    [visibleObjects],
  );

  // Folder universe = every `subsystem` in use + locally-created empties.
  const folderNames = useMemo(() => {
    const s = new Set<string>();
    for (const o of visibleRoots) if (o.subsystem) s.add(o.subsystem);
    for (const f of extraFolders) s.add(f);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [visibleRoots, extraFolders]);

  const shelves = useMemo(() => {
    if (!visibleObjects) return [];
    const objects = visibleRoots;
    const bucket = (keyOf: (o: LibObject) => string) => {
      const m = new Map<string, LibObject[]>();
      for (const o of objects) {
        const k = keyOf(o);
        const arr = m.get(k);
        if (arr) arr.push(o);
        else m.set(k, [o]);
      }
      return m;
    };

    if (axis === "type") {
      return Array.from(bucket((o) => o.type?.trim() || "object").entries())
        .sort((a, b) => typeRank(a[0]) - typeRank(b[0]))
        .map(([key, items]) => ({ key, label: titleCase(key), items, dot: undefined as string | undefined }));
    }

    if (axis === "layer") {
      return Array.from(
        bucket((o) => (o.layerOrdinal != null ? String(o.layerOrdinal) : "none")).entries(),
      )
        .sort((a, b) => {
          if (a[0] === "none") return 1;
          if (b[0] === "none") return -1;
          return Number(a[0]) - Number(b[0]);
        })
        .map(([key, items]) =>
          key === "none"
            ? { key, label: "Unlayered", items, dot: appleVibe.text.faint as string | undefined }
            : { key, label: layerName(Number(key)), items, dot: layerColor(Number(key)) as string | undefined },
        );
    }

    if (axis === "room") {
      const titleById = new Map(rooms.map((r) => [r.id, r.title] as const));
      return Array.from(bucket((o) => o.subObjectiveId || "none").entries())
        .sort((a, b) => {
          if (a[0] === "none") return 1;
          if (b[0] === "none") return -1;
          return (titleById.get(a[0]) || a[0]).localeCompare(titleById.get(b[0]) || b[0]);
        })
        .map(([key, items]) =>
          key === "none"
            ? { key, label: "Space-level", items, dot: appleVibe.text.faint as string | undefined }
            : { key, label: titleById.get(key) || "Room", items, dot: "#7C3AED" as string | undefined },
        );
    }

    // folder — seed empty extras so a new/emptied folder still renders as a target.
    const m = new Map<string, LibObject[]>();
    for (const f of folderNames) m.set(f, []);
    for (const o of objects) {
      const k = o.subsystem || "__unfiled";
      const arr = m.get(k);
      if (arr) arr.push(o);
      else m.set(k, [o]);
    }
    return Array.from(m.entries())
      .sort((a, b) => {
        if (a[0] === "__unfiled") return 1;
        if (b[0] === "__unfiled") return -1;
        return b[1].length - a[1].length || a[0].localeCompare(b[0]);
      })
      .map(([key, items]) =>
        key === "__unfiled"
          ? { key, label: "Unfiled", items, dot: appleVibe.text.faint as string | undefined }
          : { key, label: key, items, dot: FOLDER_DOT as string | undefined },
      );
  }, [visibleObjects, visibleRoots, axis, folderNames, layerName, rooms]);

  // Feature tally for the catalog subline, and the running catalog number
  // each shelf starts at (001, 002, … continuous across shelves — tile mode).
  const featureCount = useMemo(
    () => (visibleObjects ?? []).filter((o) => o.type === "feature").length,
    [visibleObjects],
  );
  const shelfStarts = useMemo(() => {
    const starts: number[] = [];
    let running = 0;
    for (const s of shelves) {
      starts.push(running);
      running += s.items.length;
    }
    return starts;
  }, [shelves]);

  function showFlash(msg: string, ms = 1800) {
    setFlash(msg);
    window.setTimeout(() => setFlash((c) => (c === msg ? null : c)), ms);
  }

  async function archiveObject(o: LibObject) {
    // Optimistic: flip selectionStatus → "rejected" so collapseFlowSteps + the
    // rejected-filter drop it from the visible list. No schema change needed:
    // selection_status is already on the row, just unused by the current UI.
    setObjects((prev) =>
      prev?.map((x) => (x.id === o.id ? { ...x, selectionStatus: "rejected" } : x)) ?? prev,
    );
    showFlash(`Archived "${o.title.slice(0, 32)}${o.title.length > 32 ? "…" : ""}"`);
    try {
      await fetch(objectsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "select", objectId: o.id, status: "rejected" }),
      });
    } catch {
      /* soft-fail — the optimistic UI is the user-visible truth */
    }
  }

  async function moveToFolder(o: LibObject, folder: string | null) {
    setMenu(null);
    setObjects((prev) => prev?.map((x) => (x.id === o.id ? { ...x, subsystem: folder } : x)) ?? prev);
    try {
      await fetch(objectsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "subsystem", objectId: o.id, subsystem: folder ?? "" }),
      });
    } catch {
      /* optimistic — soft-fail */
    }
  }

  async function assignLayer(o: LibObject, ordinal: number | null) {
    setMenu(null);
    setObjects((prev) => prev?.map((x) => (x.id === o.id ? { ...x, layerOrdinal: ordinal } : x)) ?? prev);
    try {
      await fetch(objectsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "layer", objectId: o.id, blueprintLayerOrdinal: ordinal }),
      });
    } catch {
      /* optimistic — soft-fail */
    }
  }

  async function autoFolder() {
    if (busy) return;
    setBusy(true);
    setAxis("folder");
    showFlash("Auto-foldering with AI…", 60000);
    try {
      const res = await fetch(`/api/objective/${spaceId}/auto-folder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ onlyUnfiled: false }),
      });
      const j = res.ok ? await res.json() : null;
      const n = Number(j?.count ?? 0);
      reload();
      showFlash(
        n
          ? `Sorted ${n} card${n === 1 ? "" : "s"} into ${j?.folders?.length ?? 0} folders`
          : "Nothing to auto-folder",
        2400,
      );
    } catch {
      showFlash("Couldn't auto-folder", 2400);
    } finally {
      setBusy(false);
    }
  }

  function addFolder() {
    const name = newFolderName.trim().slice(0, 40);
    if (!name) return;
    setExtraFolders((p) => (p.includes(name) ? p : [...p, name]));
    setNewFolderName("");
    setNewFolderOpen(false);
    setAxis("folder");
  }

  // ── Folder → board: build the drag payload + deploy on click ──
  function folderCards(items: LibObject[]): FolderDragCard[] {
    return items.map((o) => ({
      objectId: o.id,
      kind: toOcKind(o.type),
      name: o.title,
      body: o.summary,
      subsystem: o.subsystem ?? undefined,
    }));
  }

  function sendFolderToBoard(folderName: string, items: LibObject[]) {
    const cards = folderCards(items);
    if (!cards.length) return;
    const { byObject } = deployFolderToBoard(editor, folderName, cards);
    const placed = new Set(byObject.keys());
    setObjects((prev) => prev?.map((x) => (placed.has(x.id) ? { ...x, onWhiteboard: true } : x)) ?? prev);
    for (const [objectId, shapeId] of byObject) {
      void fetch(objectsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "place", objectId, boardShapeId: shapeId }),
      }).catch(() => {});
    }
    // Close the rail so the freshly-deployed cluster (the deploy zooms to it)
    // isn't hidden behind the panel.
    setPanel("library", false);
  }

  // Spin a folder off into its OWN child board (room or sandbox): the route
  // copies the cards into a new child space; we seed sessionStorage so the child
  // board deploys them on load, then navigate there.
  async function spinOff(folderName: string, items: LibObject[], mode: "room" | "sandbox") {
    setSpinMenu(null);
    const ids = items.map((o) => o.id);
    if (!ids.length) return;
    showFlash(mode === "sandbox" ? "Opening sandbox…" : "Creating room…", 60000);
    try {
      const res = await fetch(`/api/objective/${spaceId}/spin-off-folder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderName, objectIds: ids, mode }),
      });
      const j = res.ok ? await res.json() : null;
      if (!j?.spaceId) {
        showFlash("Couldn't create the room", 2400);
        return;
      }
      try {
        sessionStorage.setItem(
          folderSeedKey(j.spaceId),
          JSON.stringify({ folderName: j.folderName ?? folderName, cards: j.cards ?? [] }),
        );
      } catch {
        /* storage unavailable — cards are still copied into the child board */
      }
      setPanel("library", false);
      router.push(`/app/objective/${j.spaceId}`);
    } catch {
      showFlash("Couldn't create the room", 2400);
    }
  }

  const axes: { id: GroupAxis; label: string; Icon: LucideIcon }[] = [
    { id: "folder", label: "Folder", Icon: Folder },
    { id: "layer", label: "Layer", Icon: Layers },
    { id: "type", label: "Type", Icon: Boxes },
    { id: "room", label: "Room", Icon: DoorOpen },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {/* grouping axis + folder tools */}
      <div style={objToolbar}>
        <div style={segWrap}>
          {axes.map((a) => {
            const active = axis === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAxis(a.id)}
                style={segBtn(active)}
                title={`Group by ${a.label.toLowerCase()}`}
              >
                <a.Icon style={{ width: 12, height: 12, flexShrink: 0 }} strokeWidth={2.2} />
                {a.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {axis === "folder" && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button type="button" title="New folder" onClick={() => setNewFolderOpen((v) => !v)} style={toolBtn}>
                <FolderPlus style={{ width: 14, height: 14 }} strokeWidth={2.2} />
              </button>
              <button type="button" title="Auto-folder with AI" onClick={autoFolder} disabled={busy} style={toolBtn}>
                {busy ? (
                  <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
                ) : (
                  <Sparkles style={{ width: 14, height: 14 }} strokeWidth={2.2} />
                )}
              </button>
            </div>
          )}
          {axis === "room" && (
            <button type="button" title="Browse all rooms" onClick={onOpenCrossRoom} style={browseRoomsBtn}>
              <DoorOpen style={{ width: 13, height: 13 }} strokeWidth={2.2} />
              Browse all
            </button>
          )}
          <DisplayToggle tiles={tiles} onChange={setTiles} />
        </div>
      </div>

      <div style={{ padding: "2px 12px 0" }}>
        <div style={{ fontFamily: CATALOG_SERIF, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", color: appleVibe.text.primary }}>
          The catalog
        </div>
      </div>
      <div style={objCaption}>
        {visibleObjects
          ? `${visibleRoots.length} object${visibleRoots.length === 1 ? "" : "s"}${featureCount > 0 ? ` · ${featureCount} feature${featureCount === 1 ? "" : "s"}` : ""}`
          : "—"}
        <span style={{ marginLeft: 8, color: appleVibe.text.faint, fontWeight: 500 }}>· node-link map coming</span>
      </div>

      {newFolderOpen && (
        <div style={{ display: "flex", gap: 6, padding: "0 12px 8px" }}>
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addFolder();
              if (e.key === "Escape") setNewFolderOpen(false);
            }}
            placeholder="New folder name…"
            style={newFolderInput}
          />
          <button type="button" onClick={addFolder} style={addFolderBtn}>
            Add
          </button>
        </div>
      )}

      {flash && <div style={flashStyle}>{flash}</div>}

      <div style={scrollArea}>
        {loading && !objects ? (
          <div style={emptyRow}><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading objects…</div>
        ) : !objects || objects.length === 0 ? (
          <div style={{ padding: "16px 4px", fontSize: 12.5, lineHeight: 1.4, color: appleVibe.text.tertiary }}>
            No objects yet — synthesize / save cards on the board to populate the library.
          </div>
        ) : (
          shelves.map((shelf, shelfIdx) => {
            const isCollapsed = collapsed.has(shelf.key);
            return (
              <div key={shelf.key} style={{ marginBottom: 8 }}>
                {tiles ? (
                  <CatalogShelfHeader
                    label={shelf.label}
                    count={shelf.items.length}
                    collapsed={isCollapsed}
                    onToggle={() => toggle(setCollapsed, shelf.key)}
                    hue={shelf.key === "__unfiled" || shelf.key === "none" ? null : tropicalHue(shelfIdx)}
                  />
                ) : (
                  <GroupHeader
                    label={shelf.label}
                    count={shelf.items.length}
                    collapsed={isCollapsed}
                    onToggle={() => toggle(setCollapsed, shelf.key)}
                    dotColor={shelf.dot}
                  />
                )}
                {axis === "folder" && shelf.key !== "__unfiled" && shelf.items.length > 0 && !isCollapsed && (
                  <div
                    draggable
                    onDragStart={(e) =>
                      encodeFolderDrag(e.dataTransfer, {
                        v: 1,
                        spaceId,
                        folderName: shelf.label,
                        cards: folderCards(shelf.items),
                      })
                    }
                    style={folderActionsRow}
                    title="Drag onto the board — or use Send"
                  >
                    <span style={folderActionsHint}>⠿ Drag to board</span>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => sendFolderToBoard(shelf.label, shelf.items)}
                        style={sendFolderBtn}
                      >
                        Send to board
                      </button>
                      <button
                        type="button"
                        onClick={() => setSpinMenu(spinMenu === shelf.key ? null : shelf.key)}
                        style={newRoomBtn}
                        title="Spin this folder off into a new board"
                      >
                        New room ▾
                      </button>
                    </div>
                  </div>
                )}
                {spinMenu === shelf.key && !isCollapsed && (
                  <div style={menuPanel}>
                    <button type="button" onClick={() => spinOff(shelf.label, shelf.items, "room")} style={menuItem(false)}>
                      <DoorOpen style={{ width: 12, height: 12, color: "#7C3AED", flexShrink: 0 }} strokeWidth={2.2} />
                      <span style={menuItemText}>New room — fresh board</span>
                    </button>
                    <button type="button" onClick={() => spinOff(shelf.label, shelf.items, "sandbox")} style={menuItem(false)}>
                      <Boxes style={{ width: 12, height: 12, color: FOLDER_DOT, flexShrink: 0 }} strokeWidth={2.2} />
                      <span style={menuItemText}>Sandbox — scratch board</span>
                    </button>
                  </div>
                )}
                {!isCollapsed && shelf.items.length === 0 && (
                  <div style={emptyFolderHint}>Empty — move cards here with the folder button.</div>
                )}
                {!isCollapsed && tiles && shelf.items.length > 0 && (
                  <div style={catalogGrid}>
                    {shelf.items.map((o, i) => (
                      <CatalogTile
                        key={o.id}
                        obj={o}
                        number={shelfStarts[shelfIdx] + i + 1}
                        hueIndex={shelfIdx}
                        onOpen={() => onOpen(o)}
                        onArchive={() => archiveObject(o)}
                        childCount={flowChildCount.get(o.id) ?? 0}
                      />
                    ))}
                  </div>
                )}
                {!isCollapsed && !tiles &&
                  shelf.items.map((o) => {
                    const folderMenu = menu?.id === o.id && menu.kind === "folder";
                    const layerMenu = menu?.id === o.id && menu.kind === "layer";
                    return (
                      <div
                        key={o.id}
                        style={termRow}
                        onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => onOpen(o)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onOpen(o);
                          }}
                          title={`Open "${o.title}"`}
                          style={{ cursor: "pointer" }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={termName}>{o.title}</span>
                            {(flowChildCount.get(o.id) ?? 0) > 0 && (
                              <span
                                title={`${flowChildCount.get(o.id)} nested flow step${(flowChildCount.get(o.id) ?? 0) === 1 ? "" : "s"}`}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "1px 6px",
                                  borderRadius: 999,
                                  background: appleVibe.surface.chip,
                                  color: appleVibe.text.tertiary,
                                  flexShrink: 0,
                                }}
                              >
                                +{flowChildCount.get(o.id)}
                              </span>
                            )}
                            {o.onWhiteboard && (
                              <span
                                style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: appleVibe.accent.primary }}
                                title="On the board"
                              />
                            )}
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label="Archive"
                              title="Archive"
                              onClick={(e) => {
                                e.stopPropagation();
                                void archiveObject(o);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void archiveObject(o);
                                }
                              }}
                              style={{
                                marginLeft: "auto",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 18,
                                height: 18,
                                borderRadius: 999,
                                color: appleVibe.text.faint,
                                cursor: "pointer",
                              }}
                            >
                              <X size={12} />
                            </span>
                            <ChevronRight size={12} style={{ color: appleVibe.text.faint }} />
                          </span>
                          {o.summary && <span style={termDef}>{o.summary}</span>}
                        </div>

                        {/* layer + folder chips — click to (re)assign */}
                        <div style={rowChips}>
                          <button
                            type="button"
                            onClick={() => setMenu(layerMenu ? null : { id: o.id, kind: "layer" })}
                            style={metaChip(o.layerOrdinal != null, o.layerOrdinal != null ? layerColor(o.layerOrdinal) : undefined)}
                            title="Set layer"
                          >
                            <Layers style={{ width: 11, height: 11, flexShrink: 0 }} strokeWidth={2.2} />
                            <span style={chipText}>{o.layerOrdinal != null ? layerName(o.layerOrdinal) : "Layer"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setMenu(folderMenu ? null : { id: o.id, kind: "folder" })}
                            style={metaChip(!!o.subsystem, o.subsystem ? FOLDER_DOT : undefined)}
                            title="Move to folder"
                          >
                            <Folder style={{ width: 11, height: 11, flexShrink: 0 }} strokeWidth={2.2} />
                            <span style={chipText}>{o.subsystem ?? "Folder"}</span>
                          </button>
                        </div>

                        {folderMenu && (
                          <div style={menuPanel}>
                            {folderNames.length === 0 && (
                              <div style={menuEmpty}>No folders yet — use the ✦ button to auto-folder, or + to add one.</div>
                            )}
                            {folderNames.map((f) => (
                              <button key={f} type="button" onClick={() => moveToFolder(o, f)} style={menuItem(o.subsystem === f)}>
                                <Folder style={{ width: 12, height: 12, color: FOLDER_DOT, flexShrink: 0 }} strokeWidth={2.2} />
                                <span style={menuItemText}>{f}</span>
                                {o.subsystem === f && <Check style={{ width: 12, height: 12, flexShrink: 0 }} strokeWidth={2.6} />}
                              </button>
                            ))}
                            {o.subsystem && (
                              <button type="button" onClick={() => moveToFolder(o, null)} style={menuItem(false)}>
                                <X style={{ width: 12, height: 12, color: appleVibe.text.tertiary, flexShrink: 0 }} strokeWidth={2.2} />
                                <span style={menuItemText}>Unfile</span>
                              </button>
                            )}
                          </div>
                        )}

                        {layerMenu && (
                          <div style={menuPanel}>
                            {layerChoices.map((l) => (
                              <button key={l.ordinal} type="button" onClick={() => assignLayer(o, l.ordinal)} style={menuItem(o.layerOrdinal === l.ordinal)}>
                                <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: layerColor(l.ordinal) }} />
                                <span style={menuItemText}>{l.name}</span>
                                {o.layerOrdinal === l.ordinal && <Check style={{ width: 12, height: 12, flexShrink: 0 }} strokeWidth={2.6} />}
                              </button>
                            ))}
                            {o.layerOrdinal != null && (
                              <button type="button" onClick={() => assignLayer(o, null)} style={menuItem(false)}>
                                <X style={{ width: 12, height: 12, color: appleVibe.text.tertiary, flexShrink: 0 }} strokeWidth={2.2} />
                                <span style={menuItemText}>Clear layer</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
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

// ── Artifacts (the "final products" — prototype, notebook, …) ──────────
interface ArtifactLite {
  id: string;
  type: string;
  engineKey: string;
  title: string;
  status: string;
  staleReason: string | null;
  updatedAt: string;
  boardShapeId: string | null;
}

const ARTIFACT_META: Record<string, { label: string; Icon: LucideIcon; color: string }> = {
  prototype: { label: "Prototypes", Icon: Boxes, color: "#6366F1" },
  notebook: { label: "Notebooks", Icon: NotebookPen, color: "#0F766E" },
  document: { label: "Documents", Icon: BookOpen, color: "#475569" },
  image: { label: "Images", Icon: ImageIcon, color: "#F59E0B" },
  social_post: { label: "Social posts", Icon: Megaphone, color: "#0EA5E9" },
  custom: { label: "Custom", Icon: Wand2, color: "#64748B" },
};

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function ArtifactsView({
  spaceId,
  editor,
}: {
  spaceId: string;
  editor: Editor;
}) {
  const [rows, setRows] = useState<ArtifactLite[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/objective/${spaceId}/artifacts`);
      const j = res.ok ? await res.json() : { artifacts: [] };
      const list = (Array.isArray(j.artifacts) ? j.artifacts : []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a: any): ArtifactLite => ({
          id: String(a.id),
          type: a.artifact_type ?? "custom",
          engineKey: a.engine_key ?? "",
          title: typeof a.title === "string" && a.title.trim() ? a.title : "Untitled",
          status: a.status ?? "ready",
          staleReason: a.stale_reason ?? null,
          updatedAt: a.updated_at ?? a.created_at ?? "",
          boardShapeId: a.board_shape_id ?? null,
        }),
      );
      setRows(list);
    } catch {
      setRows([]);
    }
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shelves = useMemo(() => {
    if (!rows) return [];
    const groups = new Map<string, ArtifactLite[]>();
    for (const a of rows) {
      const key = a.type?.trim() || "custom";
      const arr = groups.get(key);
      if (arr) arr.push(a);
      else groups.set(key, [a]);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  }, [rows]);

  function openArtifact(a: ArtifactLite) {
    if (a.type === "notebook") {
      openNotebook({ spaceId, artifactId: a.id });
      return;
    }
    // Everything else → reveal its board card if we have one.
    if (a.boardShapeId) {
      try {
        const id = a.boardShapeId as TLShapeId;
        const b = editor.getShapePageBounds(id);
        if (b) {
          editor.select(id);
          editor.centerOnPoint({ x: b.midX, y: b.midY }, { animation: { duration: 300 } });
          return;
        }
      } catch {
        /* fall through */
      }
    }
    setFlash(`"${a.title}" isn't on this board.`);
    window.setTimeout(() => setFlash(null), 1600);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ padding: "10px 12px 4px", fontSize: 11, fontWeight: 600, color: appleVibe.text.tertiary }}>
        {rows ? `${rows.length} artifact${rows.length === 1 ? "" : "s"}` : "—"}
        <span style={{ marginLeft: 8, color: appleVibe.text.faint, fontWeight: 500 }}>· your final products</span>
      </div>
      {flash && <div style={flashStyle}>{flash}</div>}
      <div style={scrollArea}>
        {!rows ? (
          <div style={emptyRow}><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading artifacts…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: "16px 4px", fontSize: 12.5, lineHeight: 1.4, color: appleVibe.text.tertiary }}>
            No artifacts yet — use the Artifact Dock (left edge) to build a prototype or weave a notebook.
          </div>
        ) : (
          shelves.map((shelf) => {
            const meta = ARTIFACT_META[shelf.key] ?? ARTIFACT_META.custom;
            return (
              <div key={shelf.key} style={{ marginBottom: 8 }}>
                <div style={{ ...shelfLabel, padding: "6px 2px", display: "flex", alignItems: "center", gap: 6 }}>
                  <meta.Icon style={{ width: 12, height: 12, color: meta.color }} strokeWidth={2.4} />
                  {meta.label} <span style={shelfCount}>{shelf.items.length}</span>
                </div>
                {shelf.items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => openArtifact(a)}
                    title={`Open "${a.title}"`}
                    style={termRow}
                    onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={termName}>{a.title}</span>
                      {a.staleReason && (
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            color: "#B45309",
                            background: "rgba(245,158,11,0.14)",
                            padding: "1px 6px",
                            borderRadius: 999,
                          }}
                          title={`Needs refresh: ${a.staleReason}`}
                        >
                          stale
                        </span>
                      )}
                      <ChevronRight style={{ width: 12, height: 12, color: appleVibe.text.faint, marginLeft: "auto" }} strokeWidth={2.4} />
                    </span>
                    <span style={termDef}>
                      {a.status === "generating" ? "Generating… · " : ""}
                      {relTime(a.updatedAt)}
                    </span>
                  </button>
                ))}
              </div>
            );
          })
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
  // Open state is shared via the board-panel signal — the trigger lives in
  // BoardTopRightBar; this component is headless until opened.
  const open = usePanel("library");
  const setOpen = (v: boolean) => setPanel("library", v);
  const [full, setFull] = useState(false);
  const [view, setView] = useState<View>("objects");
  const [objects, setObjects] = useState<LibObject[] | null>(null);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [rooms, setRooms] = useState<{ id: string; title: string }[]>([]);
  const [crossRoom, setCrossRoom] = useState(false);

  // Escape always closes the panel — a guaranteed exit independent of the
  // header's close ✕ (which could be obscured/clipped on some viewports).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (full) setFull(false);
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, full]);

  // Fetch the space's library_objects (shared by both views) + the layer-stack
  // names. Pulled out as a callable so the Objects view can refetch after an
  // AI auto-folder pass. Soft-fails to []. Loading is derived.
  const refetchObjects = useCallback(async () => {
    try {
      const r = await fetch(`/api/brainstorm/space/${spaceId}/library/objects`);
      const j = r.ok ? await r.json() : { objects: [], layers: [], rooms: [] };
      setObjects(Array.isArray(j.objects) ? j.objects.map(mapObject) : []);
      if (Array.isArray(j.layers)) {
        setLayers(
          j.layers
            .filter(
              (l: unknown): l is LayerInfo =>
                !!l &&
                typeof (l as LayerInfo).ordinal === "number" &&
                typeof (l as LayerInfo).name === "string",
            )
            .map((l: LayerInfo) => ({ ordinal: l.ordinal, name: l.name })),
        );
      }
      if (Array.isArray(j.rooms)) {
        setRooms(
          j.rooms
            .filter(
              (rm: unknown): rm is { id: string; title: string } =>
                !!rm &&
                typeof (rm as { id: unknown }).id === "string" &&
                typeof (rm as { title: unknown }).title === "string",
            )
            .map((rm: { id: string; title: string }) => ({ id: rm.id, title: rm.title })),
        );
      }
    } catch {
      setObjects((cur) => cur ?? []);
    }
  }, [spaceId]);

  useEffect(() => {
    if (!open || objects) return;
    void refetchObjects();
  }, [open, objects, refetchObjects]);
  const loading = open && objects === null;

  // Folder drag-and-drop TARGET: the whole tldraw surface. A folder dragged
  // from the rail materializes as oc-cards centered on the cursor. Attached to
  // the editor's container (capture phase, so tldraw's own child handlers don't
  // swallow it) and only acts on our MIME — native file/image drops pass
  // through untouched. Runs regardless of the rail's open state.
  useEffect(() => {
    const el = editor?.getContainer?.();
    if (!el) return;
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes(FOLDER_DND_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const payload = decodeFolderDrag(e.dataTransfer);
      if (!payload) return;
      e.preventDefault();
      const pt = editor.screenToPage({ x: e.clientX, y: e.clientY });
      const { byObject } = deployFolderToBoard(editor, payload.folderName, payload.cards, {
        anchorPage: pt,
      });
      for (const [objectId, shapeId] of byObject) {
        void fetch(`/api/brainstorm/space/${payload.spaceId}/library/objects`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "place", objectId, boardShapeId: shapeId }),
        }).catch(() => {});
      }
      void refetchObjects();
    };
    el.addEventListener("dragover", onDragOver, { capture: true });
    el.addEventListener("drop", onDrop, { capture: true });
    return () => {
      el.removeEventListener("dragover", onDragOver, { capture: true } as EventListenerOptions);
      el.removeEventListener("drop", onDrop, { capture: true } as EventListenerOptions);
    };
  }, [editor, refetchObjects]);

  // Deploy-on-load: a folder spun off into a NEW room copies its cards into the
  // child space + drops a sessionStorage seed; when THIS board (the child) loads
  // we deploy them once, then clear the seed. The short delay lets the (empty)
  // child board settle so the restore can't wipe the fresh shapes. No-ops on
  // every other board (the seed is keyed by this spaceId).
  useEffect(() => {
    if (!editor) return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(folderSeedKey(spaceId));
    } catch {
      return;
    }
    if (!raw) return;
    try {
      sessionStorage.removeItem(folderSeedKey(spaceId));
    } catch {
      /* ignore */
    }
    let seed: { folderName?: string; cards?: FolderDragCard[] } | null = null;
    try {
      seed = JSON.parse(raw);
    } catch {
      seed = null;
    }
    if (!seed || !Array.isArray(seed.cards) || seed.cards.length === 0) return;
    const cards = seed.cards;
    const folderName = seed.folderName || "Folder";
    const t = window.setTimeout(() => {
      const { byObject } = deployFolderToBoard(editor, folderName, cards);
      for (const [objectId, shapeId] of byObject) {
        void fetch(`/api/brainstorm/space/${spaceId}/library/objects`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "place", objectId, boardShapeId: shapeId }),
        }).catch(() => {});
      }
    }, 800);
    return () => window.clearTimeout(t);
  }, [editor, spaceId]);

  // Open an object → fire OPEN_CARD_DETAIL_EVENT; the board-level
  // ObjectDetailMount listens and opens the object detail drawer.
  function openObject(o: LibObject) {
    try {
      window.dispatchEvent(new CustomEvent(OPEN_CARD_DETAIL_EVENT, { detail: { objectId: o.id } }));
    } catch {
      /* event is best-effort */
    }
  }

  // Headless when closed — the trigger lives in BoardTopRightBar. The cross-room
  // browser can be open even when the rail itself is closed.
  if (!open && !crossRoom) return null;

  const tabs: { id: View; label: string; Icon: typeof BookOpen }[] = [
    { id: "objects", label: "Objects", Icon: Boxes },
    { id: "artifacts", label: "Artifacts", Icon: Sparkles },
    { id: "glossary", label: "Glossary", Icon: BookOpen },
    { id: "timeline", label: "Timeline", Icon: History },
  ];

  return (
    <>
      {crossRoom && <CrossRoomBrowser spaceId={spaceId} onClose={() => setCrossRoom(false)} />}
      {open && (
      <div onPointerDown={(e) => e.stopPropagation()} style={railStyle(full)}>
        <div style={railHeader}>
          <LibraryIcon style={{ width: 15, height: 15, color: appleVibe.text.secondary, flexShrink: 0 }} strokeWidth={2.2} />
          <div style={tabBar}>
            {tabs.map((t) => {
              const active = view === t.id;
              return (
                <button key={t.id} type="button" onClick={() => setView(t.id)} style={tabBtn(active)}>
                  <t.Icon style={{ width: 12, height: 12, flexShrink: 0 }} strokeWidth={2.2} />
                  {t.label}
                </button>
              );
            })}
          </div>
          {/* flexShrink:0 keeps the expand + close buttons pinned and on-screen.
              Without it the fixed-width tabs pushed the close ✕ past the rail's
              right edge. The tab bar (minWidth:0) yields space instead. The
              close ✕ rests on a chip fill so it reads as an obvious button. */}
          <div style={{ marginLeft: "auto", display: "flex", gap: 4, flexShrink: 0 }}>
            <button
              type="button"
              title={full ? "Restore" : "Expand to full screen"}
              aria-label={full ? "Restore" : "Expand to full screen"}
              onClick={() => setFull((f) => !f)}
              style={iconBtn}
              onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {full ? <Minimize2 style={{ width: 15, height: 15 }} strokeWidth={2.2} /> : <Maximize2 style={{ width: 15, height: 15 }} strokeWidth={2.2} />}
            </button>
            <button
              type="button"
              title="Close library"
              aria-label="Close library"
              onClick={() => setOpen(false)}
              style={closeBtn}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = appleVibe.accent.primary;
                e.currentTarget.style.color = appleVibe.text.onAccent;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = appleVibe.surface.chip;
                e.currentTarget.style.color = appleVibe.text.secondary;
              }}
            >
              <X style={{ width: 16, height: 16 }} strokeWidth={2.4} />
            </button>
          </div>
        </div>

        {view === "objects" ? (
          <ObjectsView
            spaceId={spaceId}
            objects={objects}
            setObjects={setObjects}
            loading={loading}
            layers={layers}
            rooms={rooms}
            editor={editor}
            onOpen={openObject}
            reload={refetchObjects}
            onOpenCrossRoom={() => setCrossRoom(true)}
          />
        ) : view === "artifacts" ? (
          <ArtifactsView spaceId={spaceId} editor={editor} />
        ) : view === "timeline" ? (
          <div style={{ ...scrollArea, paddingTop: 14 }}>
            <GlossaryTimelineView spaceId={spaceId} />
          </div>
        ) : (
          <GlossaryView
            spaceId={spaceId}
            editor={editor}
            objects={objects ?? []}
            onOpen={openObject}
            onObjectsChanged={refetchObjects}
          />
        )}
      </div>
      )}
    </>
  );
}

// ── styles ──
const railStyle = (full: boolean): CSSProperties => ({
  // Non-full: opens BELOW the unified top-right bar (top:16, ~38px tall) and
  // right-aligned to it, so the bar + this rail's own close ✕ stay visible
  // together — the close is well inside the card, never out in the corner.
  // Full screen: cover everything (its own restore/close chrome takes over).
  position: "absolute",
  top: full ? 12 : 64,
  bottom: 12,
  right: full ? 12 : 16,
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
  // Let the tab bar be the flex item that gives way when the header is tight,
  // so the expand/close buttons (flexShrink:0) always stay on-screen.
  minWidth: 0,
  overflow: "hidden",
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
  width: 30,
  height: 30,
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: appleVibe.text.secondary,
  transition: "background 0.15s ease, color 0.15s ease",
};
const closeBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: appleVibe.radius.sm,
  border: "none",
  // Resting chip fill so the close ✕ is an obvious, easy target — not a faint
  // glyph floating in the corner.
  background: appleVibe.surface.chip,
  cursor: "pointer",
  color: appleVibe.text.secondary,
  transition: "background 0.15s ease, color 0.15s ease",
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
// `secondary` (slate-700) is the design system's near-black subtitle color —
// the object/term descriptions read at full legibility, matching the section
// headers (was the washed-out tertiary).
const termDef: CSSProperties = { display: "block", marginTop: 2, fontSize: 11.5, lineHeight: 1.4, color: appleVibe.text.secondary };

// ── Concept popover (Glossary view) ──
const linkedChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  marginLeft: 4,
  padding: "1px 6px",
  borderRadius: 999,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
  color: appleVibe.accent.primary,
  background: "rgba(15,23,42,0.06)",
};
const pinnedChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "1px 6px",
  borderRadius: 999,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
  color: appleVibe.text.onAccent,
  background: appleVibe.accent.primary,
};
const layerChip: CSSProperties = {
  padding: "1px 6px",
  borderRadius: 999,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
  color: appleVibe.text.secondary,
  background: appleVibe.surface.chipHover,
};
const conceptPanel: CSSProperties = {
  marginBottom: 6,
  padding: "9px 10px 10px",
  borderRadius: appleVibe.radius.md,
  background: "var(--glass-inset-bg, rgba(255,255,255,0.55))",
  border: "1px solid var(--glass-border)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight)",
};
const conceptProvenance: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 10.5,
  fontWeight: 600,
  color: appleVibe.text.tertiary,
  letterSpacing: "0.01em",
};
const conceptSection: CSSProperties = { marginTop: 8 };
const conceptSectionLabel: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: appleVibe.text.faint,
  marginBottom: 4,
};
const conceptAliases: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 4,
  marginTop: 6,
};
const aliasChip: CSSProperties = {
  padding: "1px 7px",
  borderRadius: 999,
  fontSize: 10.5,
  color: appleVibe.text.secondary,
  background: appleVibe.surface.chip,
};
const linkedObjectRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "7px 8px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  background: appleVibe.surface.chip,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const promoteBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "5px 10px",
  borderRadius: 999,
  fontSize: 11.5,
  fontWeight: 600,
  color: appleVibe.text.secondary,
  background: appleVibe.surface.chip,
  border: "1px solid var(--glass-border)",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const citationRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  padding: "5px 6px",
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: appleVibe.font.stack,
};

// ── folders + layering (Objects view) ──
// Collapsible section header = WHITE PILL + soft drop shadow ("folder tab").
const groupHeaderRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  margin: "2px 0 6px",
};
const groupPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "5px 11px 5px 8px",
  borderRadius: appleVibe.radius.pill,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.card,
  boxShadow: appleVibe.shadow.chip,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  transition: "box-shadow 0.15s ease",
};
const groupChev: CSSProperties = { width: 13, height: 13, color: appleVibe.text.tertiary, flexShrink: 0 };
const groupPillLabel: CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: "-0.01em", color: appleVibe.text.primary };
const groupPillCount: CSSProperties = { fontSize: 10.5, fontWeight: 650, color: appleVibe.text.faint };

const objToolbar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  rowGap: 6,
  flexWrap: "wrap",
  padding: "10px 12px 6px",
};
const segWrap: CSSProperties = {
  display: "flex",
  gap: 2,
  padding: 2,
  borderRadius: appleVibe.radius.pill,
  background: appleVibe.surface.chip,
  minWidth: 0,
};
const segBtn = (active: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 9px",
  borderRadius: appleVibe.radius.pill,
  border: "none",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  fontSize: 11,
  fontWeight: 650,
  color: active ? appleVibe.text.onAccent : appleVibe.text.secondary,
  background: active ? appleVibe.accent.primary : "transparent",
});
const toolBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: appleVibe.radius.md,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.card,
  boxShadow: appleVibe.shadow.chip,
  cursor: "pointer",
  color: appleVibe.text.secondary,
  fontFamily: appleVibe.font.stack,
};
const objCaption: CSSProperties = {
  padding: "0 12px 6px",
  fontSize: 11,
  fontWeight: 600,
  color: appleVibe.text.tertiary,
};
const newFolderInput: CSSProperties = {
  flex: 1,
  padding: "6px 9px",
  borderRadius: appleVibe.radius.md,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.chip,
  outline: "none",
  fontSize: 12.5,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
};
const addFolderBtn: CSSProperties = {
  padding: "0 13px",
  borderRadius: appleVibe.radius.md,
  border: "none",
  background: appleVibe.accent.primary,
  color: appleVibe.text.onAccent,
  fontSize: 11.5,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const rowChips: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  marginTop: 7,
  flexWrap: "wrap",
};
const chipText: CSSProperties = {
  maxWidth: 130,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const metaChip = (active: boolean, color?: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  maxWidth: 170,
  padding: "2px 8px",
  borderRadius: appleVibe.radius.pill,
  border: `1px solid ${active ? "transparent" : "var(--glass-border)"}`,
  background: active ? (color ? `${color}1A` : appleVibe.surface.chip) : "transparent",
  color: active ? color ?? appleVibe.text.secondary : appleVibe.text.tertiary,
  fontSize: 10.5,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
});
const menuPanel: CSSProperties = {
  marginTop: 7,
  padding: 5,
  borderRadius: appleVibe.radius.md,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.card,
  boxShadow: appleVibe.shadow.card,
  display: "flex",
  flexDirection: "column",
  gap: 2,
  maxHeight: 210,
  overflowY: "auto",
};
const menuItem = (active: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 7,
  width: "100%",
  textAlign: "left",
  padding: "6px 8px",
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: active ? appleVibe.surface.chip : "transparent",
  color: appleVibe.text.primary,
  fontSize: 12,
  fontWeight: active ? 650 : 550,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
});
const menuItemText: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const menuEmpty: CSSProperties = {
  padding: "6px 8px",
  fontSize: 11,
  lineHeight: 1.4,
  color: appleVibe.text.tertiary,
};
const emptyFolderHint: CSSProperties = {
  padding: "2px 9px 8px",
  fontSize: 11,
  color: appleVibe.text.faint,
};
const folderActionsRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  margin: "0 0 6px",
  padding: "5px 8px",
  borderRadius: appleVibe.radius.md,
  border: "1px dashed var(--glass-border)",
  background: appleVibe.surface.chip,
  cursor: "grab",
  fontFamily: appleVibe.font.stack,
};
const folderActionsHint: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: appleVibe.text.tertiary,
  letterSpacing: "0.01em",
};
const sendFolderBtn: CSSProperties = {
  padding: "3px 10px",
  borderRadius: appleVibe.radius.pill,
  border: "none",
  background: FOLDER_DOT,
  color: "#fff",
  fontSize: 10.5,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  flexShrink: 0,
};
const newRoomBtn: CSSProperties = {
  padding: "3px 10px",
  borderRadius: appleVibe.radius.pill,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.card,
  color: appleVibe.text.secondary,
  fontSize: 10.5,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  flexShrink: 0,
};
const browseRoomsBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: 28,
  padding: "0 11px",
  borderRadius: appleVibe.radius.md,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.card,
  boxShadow: appleVibe.shadow.chip,
  color: appleVibe.text.secondary,
  fontSize: 11,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  flexShrink: 0,
};
