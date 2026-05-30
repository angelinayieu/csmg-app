"use client";

// ── SaveToLibraryButton ──
//
// The hover-revealed "Save" affordance that turns any generated card into a
// persistent, addressable Library object (object-flow Phase 0). Self-contained:
// reads spaceId/subId from the route, so a card only passes its own identity
// (type + title + entity id). POSTs `action:"upsert"` to the library route
// (idempotent on the natural key — re-saving is a no-op update), then surfaces
// a "Saved" confirmation. Mirrors SendToBoardButton's resting/hover styling.
//
// Lane note (object-flow coordination): writes ONLY the core/selection columns
// via the route's upsert — never object_links or the derived columns
// (blueprint_layer_ordinal/rank_score/evaluation), which the enrichment lane owns.

import { useRef, useState } from "react";
import { useParams } from "next/navigation";
import { BookmarkPlus, BookmarkCheck, Loader2 } from "lucide-react";
import type { LibraryObjectType } from "@/lib/objective-canvas/library-objects";

export interface SaveToLibraryButtonProps {
  objectType: LibraryObjectType;
  title: string;
  summary?: string | null;
  /** The parent feature/pain/outcome entity. */
  sourceEntityId?: string | null;
  /** Blob-local id (variation id…) — distinguishes objects on one entity. */
  sourceRef?: string | null;
  /** Override the room id (defaults to the [subId] route param). */
  sourceSubObjectiveId?: string | null;
  /** Accent color (match the card's lane color). */
  color: string;
  /** Notified with the saved object id — lets the host then place it on the
   *  board (route `action:"place"`) or mark it for the spec. */
  onSaved?: (objectId: string) => void;
}

type State = "idle" | "saving" | "saved" | "error";

export function SaveToLibraryButton({
  objectType,
  title,
  summary,
  sourceEntityId,
  sourceRef,
  sourceSubObjectiveId,
  color,
  onSaved,
}: SaveToLibraryButtonProps) {
  const params = useParams<{ spaceId?: string; subId?: string }>();
  const spaceId = params?.spaceId;
  const subId = sourceSubObjectiveId ?? params?.subId ?? null;
  const [state, setState] = useState<State>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // No space context → nothing to save into; render nothing (hooks already ran).
  if (!spaceId) return null;

  async function save(e: React.MouseEvent) {
    e.stopPropagation();
    if (state === "saving") return;
    setState("saving");
    try {
      const res = await fetch(
        `/api/brainstorm/space/${spaceId}/library/objects`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "upsert",
            objectType,
            title,
            summary: summary ?? null,
            sourceEntityId: sourceEntityId ?? null,
            sourceSubObjectiveId: subId,
            sourceRef: sourceRef ?? null,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      if (res.ok && json.id) {
        setState("saved");
        onSaved?.(json.id);
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setState((s) => (s === "error" ? "idle" : s));
    }, 1600);
  }

  const saved = state === "saved";
  const label =
    state === "saving"
      ? "Saving"
      : saved
        ? "Saved"
        : state === "error"
          ? "Retry"
          : "Save";

  return (
    <button
      type="button"
      title={saved ? "Saved to your Library" : "Save to your Library"}
      aria-label="Save to Library"
      onClick={save}
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold opacity-0 transition-all duration-150 ease-out hover:scale-105 focus:opacity-100 group-hover:opacity-100"
      style={{
        background: saved ? color : `${color}14`,
        color: saved ? "white" : color,
        border: `1px solid ${color}33`,
      }}
    >
      {state === "saving" ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
      ) : saved ? (
        <BookmarkCheck className="h-3 w-3" strokeWidth={3} />
      ) : (
        <BookmarkPlus className="h-3 w-3" strokeWidth={2.4} />
      )}
      {label}
    </button>
  );
}
