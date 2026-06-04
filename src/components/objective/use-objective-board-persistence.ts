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
const DEBOUNCE_MS = 700;

export type BoardSaveStatus = "idle" | "saving" | "saved" | "error";

export function useObjectiveBoardPersistence(
  editor: Editor | null,
  spaceId: string,
  /** Fired once after the restore attempt settles. Callers can safely add
   *  to the store here (e.g. drain queued artifacts) without a late
   *  restore wiping them. */
  onRestored?: () => void,
): { status: BoardSaveStatus } {
  const [status, setStatus] = useState<BoardSaveStatus>("idle");
  const restoredRef = useRef(false);
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

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
      onRestoredRef.current?.();
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, spaceId]);

  // ── Autosave (debounced PUT + localStorage mirror) ──
  useEffect(() => {
    if (!editor) return;

    const save = async (retriesLeft = 2) => {
      const snapshot = getSnapshot(editor.store);
      try {
        window.localStorage.setItem(
          lsKey(spaceId),
          JSON.stringify({ snapshot, savedAt: Date.now() }),
        );
      } catch {
        // quota / private mode — non-fatal
      }

      inflightRef.current?.abort();
      const ctrl = new AbortController();
      inflightRef.current = ctrl;
      setStatus("saving");
      try {
        const res = await fetch(`/api/objective/${spaceId}/board`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ snapshot, schema_version: SCHEMA_VERSION }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus("saved");
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        if (retriesLeft > 0) {
          const delayMs = retriesLeft === 2 ? 800 : 2400;
          setTimeout(() => {
            if (inflightRef.current !== ctrl) return;
            void save(retriesLeft - 1);
          }, delayMs);
          return;
        }
        console.warn("[objective-board] server save failed after retries", err);
        setStatus("error");
      }
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
        if (lsTimer) clearTimeout(lsTimer);
        lsTimer = setTimeout(() => {
          try {
            window.localStorage.setItem(
              lsKey(spaceId),
              JSON.stringify({ snapshot: getSnapshot(editor.store), savedAt: Date.now() }),
            );
          } catch {
            /* quota / private mode — non-fatal */
          }
        }, 200);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => save(2), DEBOUNCE_MS);
      },
      { scope: "document" },
    );

    const flushSync = () => {
      // Always capture the CURRENT board on unload/hide — NOT gated on a pending
      // save — so a reload restores the latest, never a stale snapshot.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (lsTimer) {
        clearTimeout(lsTimer);
        lsTimer = null;
      }
      try {
        const snapshot = getSnapshot(editor.store);
        try {
          window.localStorage.setItem(
            lsKey(spaceId),
            JSON.stringify({ snapshot, savedAt: Date.now() }),
          );
        } catch {
          // quota — keepalive fetch covers it
        }
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
