"use client";

// ── LibraryPanel ──────────────────────────────────────────────────
//
// The "see what you saved" surface for the object-flow Library (Phase 0).
// Lists the space's library_objects (via GET …/library/objects), and lets
// the user PLACE one on the whiteboard (board-bus) or REMOVE it (mark
// rejected). This closes the save → see → place loop.
//
// Self-contained: fetches on mount. Accepts `initialObjects` as an escape
// hatch so it can be rendered in a preflight harness (or SSR) without the
// authed fetch — that's how it's verified while the full tsc is OOM-blocked.
//
// Lane: reads + writes ONLY core/selection columns (selection_status,
// on_whiteboard) via the route — never object_links or the derived columns.

import { useCallback, useEffect, useState } from "react";
import { Bookmark, LayoutGrid, Loader2, X, Check } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { sendArtifactToBoard } from "@/components/objective/board-bus";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { LibraryObjectRow } from "@/lib/objective-canvas/library-objects";

/** library object_type → the board card kind the painter understands. */
const TYPE_KIND: Record<
  string,
  "pain" | "features" | "outcomes" | "objective" | "note"
> = {
  feature: "features",
  mechanism: "features",
  variation: "features",
  deliverable: "note",
  experiment: "note",
  insight: "note",
  ui_idea: "note",
  recommendation: "note",
  brainstorm_cluster: "note",
};

/** Artifact-card kind → lane color for objects placed back on the board. */
const ARTIFACT_KIND_COLOR: Record<
  "pain" | "feature" | "outcome" | "lab",
  string
> = {
  pain: appleVibe.stage.pain,
  feature: appleVibe.stage.features,
  outcome: appleVibe.stage.outcomes,
  lab: appleVibe.stage.objective,
};

const TYPE_LABEL: Record<string, string> = {
  feature: "Feature",
  mechanism: "Mechanism",
  variation: "Variation",
  deliverable: "Deliverable",
  experiment: "Experiment",
  insight: "Insight",
  ui_idea: "UI idea",
  recommendation: "Recommendation",
  brainstorm_cluster: "Brainstorm",
};

/** Per-type chip accent — keeps Brainstorm clusters visually distinct
 *  from feature/mechanism rows since the user interaction model differs
 *  (clusters re-open into the BrainstormPanel; features place on board). */
const TYPE_ACCENT: Record<
  string,
  { bg: string; fg: string }
> = {
  brainstorm_cluster: {
    bg: "rgba(71,85,105,0.10)",
    fg: "rgba(71,85,105,0.95)",
  },
};

/** Shape the brainstorm runner stashes in `content_snapshot`. Validated
 *  loosely at render time — every field optional, anything malformed
 *  silently degrades the preview to the standard list row. */
interface BrainstormSnapshot {
  session_id?: string;
  target_kind?: string;
  tldraw_page_id?: string | null;
  ranking_summary?: string;
  top_3?: Array<{ proposal_id?: string; composite_score?: number }>;
}

function readBrainstormSnapshot(raw: unknown): BrainstormSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as BrainstormSnapshot;
}

const TARGET_LABEL: Record<string, string> = {
  sub_objective_picker: "Sub-objective picker",
  room_feature: "Room feature",
  annotation: "Annotation lens",
};

export function LibraryPanel({
  spaceId,
  initialObjects,
}: {
  spaceId: string;
  /** Render-test escape hatch — when provided, skips the authed fetch. */
  initialObjects?: LibraryObjectRow[];
}) {
  const [objects, setObjects] = useState<LibraryObjectRow[]>(
    initialObjects ?? [],
  );
  const [loading, setLoading] = useState(!initialObjects);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/brainstorm/space/${spaceId}/library/objects`,
      );
      const json = (await res.json().catch(() => ({}))) as {
        objects?: LibraryObjectRow[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Couldn't load your Library.");
        return;
      }
      setObjects(Array.isArray(json.objects) ? json.objects : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (initialObjects) return; // harness / SSR — don't fetch
    void load();
  }, [initialObjects, load]);

  const place = useCallback(
    (o: LibraryObjectRow) => {
      if (!o.source_entity_id) return;
      const painterKind = TYPE_KIND[o.object_type] ?? "note";
      const artifactKind: "pain" | "feature" | "outcome" | "lab" =
        painterKind === "features"
          ? "feature"
          : painterKind === "outcomes"
            ? "outcome"
            : painterKind === "pain"
              ? "pain"
              : "lab";
      sendArtifactToBoard(spaceId, {
        entityId: o.source_entity_id,
        kind: artifactKind,
        title: o.title,
        subtitle: o.summary ?? undefined,
        color: ARTIFACT_KIND_COLOR[artifactKind],
        roomId: o.source_sub_objective_id ?? "",
      });
      // Record the placement (on_whiteboard + a deterministic link).
      void fetch(`/api/brainstorm/space/${spaceId}/library/objects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "place",
          objectId: o.id,
          boardShapeId: `entity:${o.source_entity_id}`,
        }),
      }).catch(() => {});
      setObjects((prev) =>
        prev.map((x) => (x.id === o.id ? { ...x, on_whiteboard: true } : x)),
      );
    },
    [spaceId],
  );

  const remove = useCallback(
    (o: LibraryObjectRow) => {
      void fetch(`/api/brainstorm/space/${spaceId}/library/objects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "select",
          objectId: o.id,
          status: "rejected",
        }),
      }).catch(() => {});
      setObjects((prev) => prev.filter((x) => x.id !== o.id));
    },
    [spaceId],
  );

  return (
    <div
      className="flex flex-col gap-3"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      <div className="flex items-baseline justify-between">
        <h2
          className="text-[15px] font-semibold"
          style={{ color: appleVibe.text.primary }}
        >
          Library
        </h2>
        <span className="text-[11.5px]" style={{ color: appleVibe.text.tertiary }}>
          {objects.length} saved
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-[12.5px]" style={{ color: appleVibe.text.tertiary }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="text-[12.5px]" style={{ color: "#DC2626" }}>{error}</div>
      ) : objects.length === 0 ? (
        <div
          className="rounded-2xl px-4 py-6 text-center text-[12.5px]"
          style={{ background: "rgba(15,23,42,0.03)", color: appleVibe.text.tertiary }}
        >
          Nothing saved yet — hit the <span className="font-semibold">Save</span> icon on any card.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {objects.map((o) => {
            const isBrainstorm = o.object_type === "brainstorm_cluster";
            const accent = TYPE_ACCENT[o.object_type];
            const snap = isBrainstorm
              ? readBrainstormSnapshot(o.content_snapshot)
              : null;
            return (
              <li
                key={o.id}
                className="group flex items-start gap-3 rounded-2xl px-4 py-3"
                style={{
                  background: "#FFFFFF",
                  border: `1px solid ${appleVibe.stroke.soft}`,
                  boxShadow: "0 1px 2px rgba(11,18,40,0.04)",
                }}
              >
                {/* Brainstorm clusters get the gradient Sparkle to match
                    the BrainstormButton — visual continuity from press to
                    saved object. All other types keep the neutral Bookmark. */}
                {isBrainstorm ? (
                  <Sparkle
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                    style={{ color: "rgba(71,85,105,0.95)" }}
                  />
                ) : (
                  <Bookmark
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                    style={{ color: appleVibe.text.faint }}
                  />
                )}
                <div className="flex flex-1 flex-col gap-1">
                  <span
                    className="text-[13px] font-semibold leading-snug"
                    style={{ color: appleVibe.text.primary }}
                  >
                    {o.title}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        background: accent?.bg ?? "rgba(15,23,42,0.05)",
                        color: accent?.fg ?? appleVibe.text.tertiary,
                      }}
                    >
                      {TYPE_LABEL[o.object_type] ?? o.object_type}
                    </span>
                    {/* Brainstorm-specific: target_kind tag so the user
                        sees at a glance whether this was a picker /
                        feature / annotation brainstorm. */}
                    {isBrainstorm && snap?.target_kind && (
                      <span
                        className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                        style={{
                          background: "rgba(15,23,42,0.04)",
                          color: appleVibe.text.tertiary,
                        }}
                      >
                        {TARGET_LABEL[snap.target_kind] ?? snap.target_kind}
                      </span>
                    )}
                    {/* Top-3 count + best score badge */}
                    {isBrainstorm &&
                      snap?.top_3 &&
                      snap.top_3.length > 0 && (
                        <span
                          className="rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                          style={{
                            background: "rgba(22,163,74,0.1)",
                            color: "#16A34A",
                          }}
                          title="Top-ranked candidates from this brainstorm session"
                        >
                          {snap.top_3.length} top pick
                          {snap.top_3.length === 1 ? "" : "s"} ·{" "}
                          {Math.max(
                            0,
                            ...snap.top_3.map(
                              (t) => t.composite_score ?? 0,
                            ),
                          ).toFixed(2)}
                        </span>
                      )}
                    {o.included_in_spec && (
                      <span
                        className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                        style={{
                          background: "rgba(22,163,74,0.1)",
                          color: "#16A34A",
                        }}
                      >
                        In spec
                      </span>
                    )}
                    {o.on_whiteboard && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                        style={{
                          background: "rgba(37,99,235,0.1)",
                          color: "#2563EB",
                        }}
                      >
                        <Check className="h-2.5 w-2.5" strokeWidth={3} /> On board
                      </span>
                    )}
                  </div>
                  {/* Brainstorm summary line (e.g. "12 candidates ranked · 3 ready · 4 explore") */}
                  {isBrainstorm && (snap?.ranking_summary || o.summary) && (
                    <span
                      className="mt-0.5 text-[11px] leading-snug"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      {snap?.ranking_summary ?? o.summary}
                    </span>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {/* Brainstorm clusters have no source_entity_id —
                      they're space-/sub-objective-/entity-scoped at the
                      session level, not card-level. So the Board button
                      is suppressed; re-open into the BrainstormPanel is
                      a Phase 7b polish (would need to thread an open-by-
                      session-id handler from the host). */}
                  {!isBrainstorm && o.source_entity_id && !o.on_whiteboard && (
                    <button
                      type="button"
                      onClick={() => place(o)}
                      title="Place on the whiteboard"
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                      style={{
                        background: "rgba(37,99,235,0.1)",
                        color: "#2563EB",
                        border: "1px solid rgba(37,99,235,0.2)",
                      }}
                    >
                      <LayoutGrid className="h-3 w-3" /> Board
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(o)}
                    title="Remove from Library"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full"
                    style={{ color: appleVibe.text.faint }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
