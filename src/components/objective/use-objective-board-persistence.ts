"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "tldraw";
import { getSnapshot, loadSnapshot } from "tldraw";

// ── Objective board persistence (server-backed) ───────────────────
//
// A focused sibling of `use-canvas-persistence` for the objective
// whiteboard. Same battle-tested shape — load-once on mount, debounced
// autosave, localStorage mirror + keepalive flush on unload — but without
// the pipeline-painter ephemeral sweep (the objective board has no
// SSE painter) and pointed at /api/objective/[spaceId]/board (the
// `canvases` table, scope='objective'), so it never collides with the
// project canvas.
//
// Endpoint contract:
//   GET → { snapshot, schema_version?, updated_at? } | { snapshot: null }
//   PUT body { snapshot, schema_version } → { ok, updated_at? }
// The server soft-no-ops (ok:false) when the space has no objective
// anchor yet; the localStorage mirror covers that gap until it does.

const SCHEMA_VERSION = 1;
const lsKey = (spaceId: string) => `interaxis:objective-board:${spaceId}`;
// Durable autosave debounce. Kept deliberately slow: each save ships the
// FULL board snapshot (can exceed 1 MB) as a single upsert against one hot
// row. A tight (sub-second) cadence let concurrent saves pile up on that
// row lock, exhaust the connection pool, and cascade into 504/401s across
// unrelated routes. The localStorage mirror (200ms) covers fast reloads.
const DEBOUNCE_MS = 2500;

/**
 * The persisted snapshot is DOCUMENT-ONLY. `getSnapshot` also returns the
 * `session` half (camera, selection, per-tab UI state) which churns on every
 * pan/zoom/click and does not belong in a shared/durable row — persisting it
 * inflated the payload and triggered needless saves. `loadSnapshot` happily
 * restores a document-only snapshot (camera just resets to default on load).
 */
function documentSnapshot(editor: Editor) {
  return { document: getSnapshot(editor.store).document };
}

export type BoardSaveStatus = "idle" | "saving" | "saved" | "error";

export function useObjectiveBoardPersistence(
  editor: Editor | null,
  spaceId: string,
  /** Fired once after the restore attempt settles. Callers can safely add
   *  to the store here (e.g. drain queued artifacts) without a late
   *  restore wiping them. */
  onRestored?: () => void,
  /** Single-writer gate for live collaboration. Returns false when ANOTHER
   *  participant is the elected saver — this client then keeps its local
   *  localStorage mirror but skips the durable server PUT, so N editors
   *  don't storm `objective_boards` with last-write-wins thrash. Default
   *  (undefined) = always allowed (the solo / non-shared case). Read as a
   *  getter so the live saver election can change without re-subscribing. */
  canSave?: () => boolean,
): { status: BoardSaveStatus } {
  const [status, setStatus] = useState<BoardSaveStatus>("idle");
  const restoredRef = useRef(false);
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;
  const canSaveRef = useRef(canSave);
  canSaveRef.current = canSave;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<AbortController | null>(null);
  // Becomes true ONLY after the restore attempt fully settles. Until then NO
  // save may run: tldraw mounts with an empty document (~1–2 KB), and saving
  // (or flushing on a fast navigate-away) that empty store overwrites the real
  // server board with a blank one. This race is the root cause of "cards
  // disappear on reload" — gating every save path on it is the fix.
  const restoreCompleteRef = useRef(false);

  // ── Restore (server → localStorage fallback, prefer the newer) ──
  useEffect(() => {
    if (!editor || restoredRef.current) return;
    restoredRef.current = true;
    let cancelled = false;

    const readLocalMirror = (): { snapshot: unknown; savedAt: number } | null => {
      try {
        const raw = window.localStorage.getItem(lsKey(spaceId));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === "object" &&
          "snapshot" in parsed &&
          (parsed as { snapshot: unknown }).snapshot
        ) {
          const wrapped = parsed as { snapshot: unknown; savedAt?: unknown };
          return {
            snapshot: wrapped.snapshot,
            savedAt: typeof wrapped.savedAt === "number" ? wrapped.savedAt : 0,
          };
        }
        return { snapshot: parsed, savedAt: 0 };
      } catch (err) {
        console.warn("[objective-board] localStorage parse failed", err);
        return null;
      }
    };

    const restore = (snapshot: unknown) => {
      try {
        loadSnapshot(
          editor.store,
          snapshot as Parameters<typeof loadSnapshot>[1],
        );
        setStatus("saved");
      } catch (err) {
        // Surface (don't swallow) so a bad/incompatible snapshot is visible in
        // the console instead of silently leaving an empty board — and re-throw
        // so applyRestore falls back to another source.
        console.warn("[objective-board] loadSnapshot failed", err);
        throw err;
      }
    };

    (async () => {
      const local = readLocalMirror();
      let serverSnapshot: unknown = null;
      let serverUpdatedAtMs = 0;
      try {
        const res = await fetch(`/api/objective/${spaceId}/board`, {
          method: "GET",
        });
        if (!cancelled && res.ok) {
          const json = (await res.json()) as {
            snapshot: unknown | null;
            updated_at?: string;
          };
          if (json.snapshot) {
            serverSnapshot = json.snapshot;
            serverUpdatedAtMs = json.updated_at
              ? new Date(json.updated_at).getTime()
              : 0;
          }
        }
      } catch (err) {
        console.warn("[objective-board] server restore failed", err);
      }
      if (cancelled) return;

      const localIsNewer =
        local !== null && local.savedAt > 0 && local.savedAt > serverUpdatedAtMs;

      // Apply the best available snapshot (if any), then signal ready so
      // callers can safely add to the store without a late restore wiping
      // them.
      const applyRestore = () => {
        if (localIsNewer && local) {
          try {
            restore(local.snapshot);
            // Server is behind (e.g. unload keepalive dropped) — catch up.
            void fetch(`/api/objective/${spaceId}/board`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                snapshot: local.snapshot,
                schema_version: SCHEMA_VERSION,
              }),
            }).catch(() => {});
            return;
          } catch (err) {
            console.warn("[objective-board] local-preferred restore failed", err);
          }
        }
        if (serverSnapshot) {
          try {
            restore(serverSnapshot);
            return;
          } catch (err) {
            console.warn("[objective-board] server restore apply failed", err);
          }
        }
        if (local !== null) {
          try {
            restore(local.snapshot);
          } catch (err) {
            console.warn("[objective-board] local fallback restore failed", err);
          }
        }
        // Else: nothing to restore — fresh board.
      };
      applyRestore();
      // Restore has settled (content applied, or confirmed nothing to
      // restore) — saving is now safe.
      restoreCompleteRef.current = true;
      onRestoredRef.current?.();
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, spaceId]);

  // ── Autosave (debounced PUT + localStorage mirror) ──
  useEffect(() => {
    if (!editor) return;

    const save = async (isRetry = false) => {
      const snapshot = documentSnapshot(editor);
      try {
        window.localStorage.setItem(
          lsKey(spaceId),
          JSON.stringify({ snapshot, savedAt: Date.now() }),
        );
      } catch {
        // quota / private mode — non-fatal
      }

      // Single-writer election (live collaboration): when another participant
      // is the elected saver, this client mirrors locally (above) but skips
      // the durable PUT. The saver applies everyone's remote deltas into its
      // own store, so ITS snapshot already reflects this client's edits.
      if (canSaveRef.current && !canSaveRef.current()) {
        setStatus("saved");
        return;
      }

      inflightRef.current?.abort();
      const ctrl = new AbortController();
      inflightRef.current = ctrl;
      setStatus("saving");

      let res: Response;
      try {
        res = await fetch(`/api/objective/${spaceId}/board`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ snapshot, schema_version: SCHEMA_VERSION }),
          signal: ctrl.signal,
        });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        // True network failure (offline / unreachable host). Retry AT MOST
        // once, on a long backoff — never a tight loop. localStorage already
        // mirrored this snapshot, so a dropped save is not data loss.
        if (!isRetry) {
          setTimeout(() => {
            if (inflightRef.current !== ctrl) return;
            void save(true);
          }, 4000);
          return;
        }
        setStatus("error");
        return;
      }

      if (res.ok) {
        setStatus("saved");
        return;
      }

      // The server was REACHED but errored (504/500 — typically backend
      // overload). Do NOT retry: retrying a saturated backend is exactly what
      // turns a transient load blip into a connection-pool cascade. The
      // localStorage mirror holds this snapshot; the next edit (or the
      // unload flush) re-sends it once the backend recovers.
      console.warn("[objective-board] server save failed", res.status);
      setStatus("error");
    };

    // localStorage mirror on a SHORT trailing debounce so a dev HMR re-mount or
    // a fast reload restores the LATEST board, not a stale debounced copy — the
    // #1 cause of "cards disappearing". The server PUT stays on the longer
    // debounce. Scope drops the `source: "user"` filter so PROGRAMMATIC card
    // deploys (AI results, sharpening, decompose) are persisted too, not just
    // direct user edits.
    let lsTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = editor.store.listen(
      () => {
        // Ignore every change until restore settles — the empty initial store
        // (and the restore's own apply) must never schedule a save that
        // clobbers the server board. Normal autosave resumes after restore.
        if (!restoreCompleteRef.current) return;
        if (lsTimer) clearTimeout(lsTimer);
        lsTimer = setTimeout(() => {
          try {
            window.localStorage.setItem(
              lsKey(spaceId),
              JSON.stringify({ snapshot: documentSnapshot(editor), savedAt: Date.now() }),
            );
          } catch {
            /* quota / private mode — non-fatal */
          }
        }, 200);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => save(), DEBOUNCE_MS);
      },
      { scope: "document" },
    );

    const flushSync = () => {
      // NEVER flush before restore settles — flushing the empty initial store
      // on a fast navigate-away/hide is exactly what wiped real boards. Once
      // restored, capture the CURRENT board so a reload restores the latest.
      if (!restoreCompleteRef.current) return;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (lsTimer) {
        clearTimeout(lsTimer);
        lsTimer = null;
      }
      try {
        const snapshot = documentSnapshot(editor);
        try {
          window.localStorage.setItem(
            lsKey(spaceId),
            JSON.stringify({ snapshot, savedAt: Date.now() }),
          );
        } catch {
          // quota — keepalive fetch covers it
        }
        // Non-savers skip the durable flush (the elected saver owns the
        // server snapshot) but keep their localStorage mirror above.
        if (canSaveRef.current && !canSaveRef.current()) return;
        try {
          void fetch(`/api/objective/${spaceId}/board`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ snapshot, schema_version: SCHEMA_VERSION }),
            keepalive: true,
          });
        } catch {
          // body too large for keepalive — localStorage has it
        }
      } catch (err) {
        console.warn("[objective-board] flush-on-unload failed", err);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushSync();
    };
    window.addEventListener("beforeunload", flushSync);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      unsub();
      window.removeEventListener("beforeunload", flushSync);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (lsTimer) clearTimeout(lsTimer);
      inflightRef.current?.abort();
    };
  }, [editor, spaceId]);

  return { status };
}
