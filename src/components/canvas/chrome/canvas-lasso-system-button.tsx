"use client";

// ── Canvas lasso → save-as-system button ──
//
// Floating chrome that appears whenever the user has selected one or
// more shapes that contain entity references — probability-space
// shells (entities + edges) or the synthesis intersection card
// (top convergence rows). Clicking the button POSTs to
// /api/spaces/[id]/systems with the union of all entities
// referenced by the selection, source-tagged as `user_lasso`.
//
// Why this is the right "lasso tool" for our canvas:
//   The Phase 1+ canvas doesn't render individual kg-node ghosts.
//   Entities live inside shells (as mini-graph nodes) and on the
//   synthesis card (as ranked rows). The most natural way to lasso
//   "this set of entities" is to lasso the SHAPES that contain
//   them — multi-select shells, save the union. This matches how
//   users think about systems ("save this lens" / "save these two
//   lenses combined") while sidestepping the need for a per-entity
//   selection layer the new architecture deliberately doesn't have.
//
// Hidden when the selection contains no shape with extractable
// entity ids. No-op rendering keeps the canvas clean.

import { useCallback, useMemo, useState } from "react";
import { useEditor, useValue } from "tldraw";
import { Network, Loader2, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExtractedEntities {
  ids: string[];
  /** Number of distinct shapes the selection covers — drives the
   *  source-of-truth label ("Save 7 entities from 2 lenses"). */
  shapeCount: number;
  /** Free-form descriptor for the system's auto-generated name. */
  shapeKindLabel: string;
}

function extractEntityIdsFromSelection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedShapes: Array<any>,
): ExtractedEntities {
  const ids = new Set<string>();
  let shellCount = 0;
  let synthCount = 0;
  for (const shape of selectedShapes) {
    if (shape.type === "probability-space-shell") {
      shellCount++;
      try {
        const parsed = JSON.parse(shape.props.entitiesJson ?? "[]");
        if (Array.isArray(parsed)) {
          for (const e of parsed) {
            if (e && typeof e.entityId === "string") ids.add(e.entityId);
          }
        }
      } catch {
        /* malformed json — skip */
      }
    } else if (shape.type === "synthesis-intersection-card") {
      synthCount++;
      try {
        const parsed = JSON.parse(shape.props.rowsJson ?? "[]");
        if (Array.isArray(parsed)) {
          for (const r of parsed) {
            if (r && typeof r.entityId === "string") ids.add(r.entityId);
          }
        }
      } catch {
        /* malformed json — skip */
      }
    }
  }
  let label = "selection";
  if (shellCount > 0 && synthCount === 0) {
    label = shellCount === 1 ? "lens" : `${shellCount} lenses`;
  } else if (synthCount > 0 && shellCount === 0) {
    label = "synthesis convergence";
  } else if (shellCount > 0 && synthCount > 0) {
    label = `${shellCount} lens${shellCount === 1 ? "" : "es"} + synthesis`;
  }
  return { ids: Array.from(ids), shapeCount: shellCount + synthCount, shapeKindLabel: label };
}

interface Props {
  spaceId: string;
}

export function CanvasLassoSystemButton({ spaceId }: Props) {
  const editor = useEditor();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Recompute on selection change. tldraw's selection ids signal is
  // the cheap subscription — getSelectedShapes() inside is O(N) but
  // N is small (selected count, not all shapes).
  const extracted = useValue<ExtractedEntities>(
    "lasso-extract",
    () => extractEntityIdsFromSelection(editor?.getSelectedShapes() ?? []),
    [editor],
  );

  const onSave = useCallback(async () => {
    if (extracted.ids.length === 0 || state === "saving") return;
    setState("saving");
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/spaces/${spaceId}/systems`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Lasso · ${extracted.ids.length} entit${extracted.ids.length === 1 ? "y" : "ies"} from ${extracted.shapeKindLabel}`,
          description: `Saved from canvas selection (${extracted.shapeKindLabel}). ${extracted.ids.length} entities; edges auto-resolved.`,
          entity_ids: extracted.ids,
          source_kind: "user_lasso",
        }),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`save failed: ${r.status} ${txt.slice(0, 120)}`);
      }
      setState("saved");
      window.setTimeout(() => setState("idle"), 1800);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
      window.setTimeout(() => setState("idle"), 2400);
    }
  }, [extracted.ids, extracted.shapeKindLabel, state, spaceId]);

  // Render rules — bail entirely when there's nothing to lasso.
  // Eligible selection: ≥1 shell or synthesis card AND it
  // contains ≥1 entity id we can extract. (A shell selected before
  // any space_entity_added event has 0 entities and won't qualify.)
  const showButton = useMemo(() => {
    return extracted.shapeCount > 0 && extracted.ids.length > 0;
  }, [extracted.shapeCount, extracted.ids.length]);

  if (!showButton) return null;

  return (
    <div
      // Top-right area, BELOW the topbar and LEFT of the legend tab.
      // z above the legend tab so users can read the count without
      // it overlapping. pointerEvents enabled only on the button so
      // the surrounding area doesn't eat tldraw pan/zoom drags.
      className="pointer-events-none absolute right-12 top-3 z-[45]"
      role="region"
      aria-label="Save selection as system"
    >
      <button
        type="button"
        onClick={onSave}
        disabled={state === "saving"}
        className={cn(
          "pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-sm backdrop-blur-md transition",
          state === "saved"
            ? "border-emerald-200 bg-emerald-50/95 text-emerald-700"
            : state === "error"
              ? "border-rose-200 bg-rose-50/95 text-rose-700"
              : state === "saving"
                ? "cursor-wait border-slate-200 bg-white/95 text-slate-500"
                : "border-violet-300 bg-white/95 text-violet-700 hover:bg-violet-50",
        )}
        title={
          state === "error"
            ? `Save failed: ${errorMsg ?? "unknown"}`
            : `Save ${extracted.ids.length} entit${extracted.ids.length === 1 ? "y" : "ies"} (${extracted.shapeKindLabel}) as a System. Edges auto-resolved.`
        }
      >
        {state === "saving" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : state === "saved" ? (
          <Check className="h-3 w-3" />
        ) : state === "error" ? (
          <AlertCircle className="h-3 w-3" />
        ) : (
          <Network className="h-3 w-3" />
        )}
        {state === "saved"
          ? "Saved"
          : state === "error"
            ? "Failed"
            : `Save ${extracted.ids.length} as system`}
        {state === "idle" && (
          <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-700">
            {extracted.shapeKindLabel}
          </span>
        )}
      </button>
    </div>
  );
}
