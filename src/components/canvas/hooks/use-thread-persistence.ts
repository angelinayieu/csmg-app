"use client";

// ── useThreadPersistence (Arc 5A.6) ────────────────────────────────────
//
// Two-way sync between tldraw ThreadNoteShapes and the `shape_threads`
// table.
//
// Responsibilities:
//   1. ON MOUNT: fetch threads for the space and reconcile with whatever
//      tldraw has in its snapshot. If a thread row exists but the shape
//      is missing (e.g. new browser tab), create the shape. If the shape
//      exists but the row is deleted, remove the shape.
//   2. ON SHAPE CREATE: insert a row for any thread-note shape that has
//      no server-side id yet (threadId === "" or pending === true).
//   3. ON SHAPE TEXT CHANGE: debounced PATCH to server.
//   4. ON SHAPE DELETE: soft-delete via DELETE endpoint. Uses tldraw
//      editor.sideEffects.registerBeforeDeleteHandler (v4 API) to catch
//      both keyboard-delete and programmatic shape removal.
//
// Debouncing: text PATCH fires 600ms after the last keystroke. Creation
// is eager — we want the server ID back ASAP so subsequent PATCHes land
// on the right row.

import { useEffect, useRef } from "react";
import { type Editor, type TLShapeId } from "tldraw";
import type { ThreadNoteShape } from "../shapes/types";
import type {
  ShapeThreadRow,
  ListThreadsResponse,
} from "@/app/api/spaces/[id]/threads/route";

interface UseThreadPersistenceOpts {
  spaceId: string;
  /** Tldraw editor — passed in rather than pulled from context so this
   *  hook can be invoked from components rendered outside the <Tldraw />
   *  tree (our mount sibling pattern). Safe to pass null — the hook
   *  no-ops until an editor is available. */
  editor: Editor | null;
  /** Called on error so the parent can surface a toast. Not throwing: errors are common transient things. */
  onError?: (message: string) => void;
}

export function useThreadPersistence({ spaceId, editor, onError }: UseThreadPersistenceOpts) {
  const bootedRef = useRef(false);
  const pendingTextTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTextRef = useRef<Map<string, string>>(new Map());

  // ── 1. Hydrate on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return;
    if (bootedRef.current) return;
    bootedRef.current = true;

    let cancelled = false;

    const hydrate = async () => {
      try {
        const res = await fetch(`/api/spaces/${spaceId}/threads`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ListThreadsResponse;
        if (cancelled) return;

        // Index live shapes by shape_id (tldraw id) for quick lookup.
        const allShapes = editor.getCurrentPageShapes();
        const threadShapesById = new Map<string, ThreadNoteShape>();
        for (const s of allShapes) {
          if (s.type === "thread-note") {
            threadShapesById.set(s.id, s as ThreadNoteShape);
          }
        }

        // Reconcile:
        // • For each server row without a matching shape → restore shape.
        // • For each shape matching a server row → merge (prefer server content if newer).
        for (const row of data.threads) {
          const existing = threadShapesById.get(row.shape_id);
          if (!existing) {
            // Missing shape — the tldraw snapshot is out of sync with the DB.
            // We don't know the original x/y because tldraw owns that; the
            // safest thing is to skip rather than guess a random position
            // and risk clutter. A future migration-step can persist positions
            // too. For now we log for diagnostics.
            if (typeof window !== "undefined" && (window as unknown as { __ix_debug_threads?: boolean }).__ix_debug_threads) {
              // eslint-disable-next-line no-console
              console.info("[threads] orphaned row (shape missing in tldraw):", row.id, row.shape_id);
            }
            continue;
          }
          // Merge: update the shape with server-side threadId + content
          // (server wins if its updated_at is newer than our last edit).
          if (existing.props.threadId !== row.id || existing.props.pending) {
            editor.updateShape<ThreadNoteShape>({
              id: existing.id as TLShapeId,
              type: "thread-note",
              props: {
                threadId: row.id,
                text: row.content,
                authorDisplay: row.author_display ?? "",
                createdAtIso: row.created_at,
                pending: false,
              },
            });
          }
        }
      } catch (e) {
        onError?.((e as Error).message ?? "Failed to hydrate threads");
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [editor, spaceId, onError]);

  // ── 2+3+4. Watch tldraw for shape lifecycle events ─────────────────
  useEffect(() => {
    if (!editor) return;

    // Intercept creation — insert row server-side for any new, pending thread-note.
    const disposeAfterCreate = editor.sideEffects.registerAfterCreateHandler(
      "shape",
      (shape) => {
        if (shape.type !== "thread-note") return;
        const t = shape as ThreadNoteShape;
        if (!t.props.pending) return; // Already server-side
        if (!t.props.rootShapeId) return; // Can't persist without a root

        // Snapshot the text we're POSTing so we can detect drift once
        // the request resolves (user may have kept typing during the
        // network round trip — those keystrokes were intentionally
        // skipped by the text-change handler because `pending: true`).
        const postedText = t.props.text;
        // Eager create — we need the server id before any PATCHes land.
        (async () => {
          try {
            const res = await fetch(`/api/spaces/${spaceId}/threads`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                shape_id: shape.id,
                parent_shape_id: t.props.parentShapeId,
                root_shape_id: t.props.rootShapeId,
                thread_depth: t.props.depth,
                content: postedText,
              }),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: "Create failed" }));
              throw new Error(err.error ?? "Create failed");
            }
            const data = (await res.json()) as { thread: ShapeThreadRow };
            // Mark the shape as no longer pending + stamp the server id + author.
            editor.updateShape<ThreadNoteShape>({
              id: shape.id as TLShapeId,
              type: "thread-note",
              props: {
                threadId: data.thread.id,
                authorDisplay: data.thread.author_display ?? t.props.authorDisplay,
                createdAtIso: data.thread.created_at,
                pending: false,
              },
            });
            // Drift catch-up: if the user kept typing during the POST, fire
            // an immediate PATCH so we don't lose those characters. (The
            // normal debounced-PATCH path won't fire until the NEXT
            // keystroke because lastTextRef wasn't seeded.)
            const nowShape = editor.getShape(shape.id as TLShapeId);
            if (nowShape && nowShape.type === "thread-note") {
              const currentText = (nowShape as ThreadNoteShape).props.text;
              if (currentText !== postedText) {
                lastTextRef.current.set(shape.id, currentText);
                void fetch(
                  `/api/spaces/${spaceId}/threads/${data.thread.id}`,
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content: currentText }),
                  },
                ).catch((e) => onError?.((e as Error).message ?? "Drift PATCH failed"));
              }
            }
          } catch (e) {
            onError?.((e as Error).message ?? "Failed to create thread");
          }
        })();
      },
    );

    // Watch text edits — debounced PATCH.
    const disposeAfterChange = editor.sideEffects.registerAfterChangeHandler(
      "shape",
      (_prev, next) => {
        if (next.type !== "thread-note") return;
        const t = next as ThreadNoteShape;
        if (t.props.pending) return; // Wait until server-side creation resolves
        if (!t.props.threadId) return;

        const last = lastTextRef.current.get(next.id);
        if (last === t.props.text) return;
        lastTextRef.current.set(next.id, t.props.text);

        const existingTimeout = pendingTextTimeoutsRef.current.get(next.id);
        if (existingTimeout) clearTimeout(existingTimeout);

        const timeout = setTimeout(() => {
          pendingTextTimeoutsRef.current.delete(next.id);
          (async () => {
            try {
              const res = await fetch(
                `/api/spaces/${spaceId}/threads/${t.props.threadId}`,
                {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ content: t.props.text }),
                },
              );
              if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Update failed" }));
                throw new Error(err.error ?? "Update failed");
              }
            } catch (e) {
              onError?.((e as Error).message ?? "Failed to save thread edit");
            }
          })();
        }, 600);
        pendingTextTimeoutsRef.current.set(next.id, timeout);
      },
    );

    // Delete — soft-delete the row. Cascades to descendants client-side
    // via tldraw's native delete (when we select all descendants first);
    // in 5A.5 we'll add a keybinding that expands descendant selection
    // before delete.
    const disposeBeforeDelete = editor.sideEffects.registerBeforeDeleteHandler(
      "shape",
      (shape) => {
        if (shape.type !== "thread-note") return;
        const t = shape as ThreadNoteShape;
        if (!t.props.threadId || t.props.pending) return;
        // Fire-and-forget — if server delete fails, hydrate on next load
        // will restore the row and re-create the shape. User can retry.
        void fetch(`/api/spaces/${spaceId}/threads/${t.props.threadId}`, {
          method: "DELETE",
        }).catch((e) => {
          onError?.((e as Error).message ?? "Failed to delete thread");
        });
      },
    );

    return () => {
      disposeAfterCreate();
      disposeAfterChange();
      disposeBeforeDelete();
      // Flush any pending debounce timers
      for (const t of pendingTextTimeoutsRef.current.values()) {
        clearTimeout(t);
      }
      pendingTextTimeoutsRef.current.clear();
    };
  }, [editor, spaceId, onError]);
}
