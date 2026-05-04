"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { getSnapshot, loadSnapshot } from "tldraw";

// Server-backed canvas persistence.
//
// Load-once on mount: GET /api/canvas/[spaceId]. If a snapshot exists,
// restore it into the tldraw store. If not, let the entity-sync hook
// seed the canvas from current KG state.
//
// Autosave: debounced PUT /api/canvas/[spaceId] on user edits. Falls back
// to localStorage mirror so nothing is lost if the network hiccups.

const SCHEMA_VERSION = 1;
const lsKey = (spaceId: string) => `interaxis:canvas:${spaceId}`;
const DEBOUNCE_MS = 700;

// Painter-emitted shape types that are run-scoped overlays, not
// persistent narrative artifacts. The pipeline-event-painter has its
// own cross-run sweep that deletes these on runId change, but that
// sweep races against the async loadSnapshot below: if the painter
// sweeps before the snapshot loads, the snapshot brings the same
// shapes right back. Mirror the list here so we can re-sweep AFTER
// restore lands. Keep in sync with PAINTER_SHAPE_TYPES in
// pipeline-event-painter.tsx.
const PAINTER_EPHEMERAL_SHAPE_TYPES = new Set([
  "origin-prompt",
  "kg-formation",
  "probability-space-shell",
  "taxonomy-card",
  "variant-card",
  "proposal-snapshot",
  "proposal-chain-ribbon",
  "experiment-design-card",
  "root-cause-tree",
  "synthesis-intersection-card",
  "asset-card",
  "situation-card",
  // Note: "room" is intentionally NOT swept here — the painter
  // adopts existing rooms via canvas scan in upsertRoomForStage,
  // so room shapes are deduped by stable identity rather than
  // wholesale deletion + recreation.
]);

export type CanvasSaveStatus = "idle" | "saving" | "saved" | "error";

export interface CanvasPersistenceOptions {
  spaceId: string;
  /**
   * Active pipeline run id (or null when no run is in flight). When
   * set, persistence runs a post-restore sweep that strips painter-
   * ephemeral shapes from the loaded snapshot — the active run will
   * re-paint them via SSE, and the alternative is two-of-everything
   * when the painter's own sweep raced past loadSnapshot.
   *
   * Pass null when no run is active so completed-run snapshots
   * (probability shells, kg-formation card with final counts) survive
   * the visit.
   */
  currentRunId?: string | null;
  onRestored?: (hadSnapshot: boolean) => void;
}

export function useCanvasPersistence(
  editor: Editor | null,
  opts: CanvasPersistenceOptions,
): { status: CanvasSaveStatus } {
  const [status, setStatus] = useState<CanvasSaveStatus>("idle");
  const restoredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  // ── Restore (server → fallback localStorage) ──
  useEffect(() => {
    if (!editor || restoredRef.current) return;
    restoredRef.current = true;

    let cancelled = false;

    /**
     * Strip painter-ephemeral shapes after a snapshot loads when a run
     * is active. Without this, the painter's own cross-run sweep can
     * delete shapes BEFORE loadSnapshot finishes, and the snapshot
     * then re-introduces them — producing duplicates (e.g., two
     * kg-formation cards, stale prompt cards at old anchor positions).
     * Skipped when no run is active so completed-run snapshots
     * persist intact.
     */
    const sweepEphemeralsIfRunActive = () => {
      if (!opts.currentRunId) return;
      try {
        const stale: TLShapeId[] = [];
        for (const s of editor.getCurrentPageShapes()) {
          if (PAINTER_EPHEMERAL_SHAPE_TYPES.has(s.type)) {
            stale.push(s.id);
          }
        }
        if (stale.length > 0) {
          editor.deleteShapes(stale);
        }
      } catch (err) {
        console.warn("[canvas] post-restore ephemeral sweep failed", err);
      }
    };

    /**
     * Read the localStorage mirror, returning the wrapped snapshot
     * with its savedAt timestamp. Tolerates the legacy raw-snapshot
     * format (pre-timestamp) by treating those entries as "older
     * than any server snapshot" via a 0 timestamp.
     */
    const readLocalMirror = (): {
      snapshot: unknown;
      savedAt: number;
    } | null => {
      try {
        const raw = window.localStorage.getItem(lsKey(opts.spaceId));
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
            savedAt:
              typeof wrapped.savedAt === "number" ? wrapped.savedAt : 0,
          };
        }
        // Legacy format: raw snapshot stored directly.
        return { snapshot: parsed, savedAt: 0 };
      } catch (err) {
        console.warn("[canvas] localStorage parse failed", err);
        return null;
      }
    };

    (async () => {
      // Read both sources before deciding. The unload flush writes to
      // localStorage with a fresh timestamp; if it's newer than the
      // server's updated_at, the server is missing data the user
      // already saw (e.g., because the keepalive fetch on unload
      // exceeded the browser's payload cap). Prefer the newer one.
      const local = readLocalMirror();
      let serverSnapshot: unknown = null;
      let serverUpdatedAtMs = 0;
      try {
        const res = await fetch(`/api/canvas/${opts.spaceId}`, { method: "GET" });
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
        console.warn("[canvas] server restore failed", err);
      }
      if (cancelled) return;

      const localIsNewer =
        local !== null &&
        local.savedAt > 0 &&
        local.savedAt > serverUpdatedAtMs;

      if (localIsNewer) {
        try {
          loadSnapshot(
            editor.store,
            local.snapshot as Parameters<typeof loadSnapshot>[1],
          );
          sweepEphemeralsIfRunActive();
          setStatus("saved");
          opts.onRestored?.(true);
          // Re-sync the server: the unload-flush keepalive was likely
          // dropped by the browser (size cap), so the server's
          // snapshot is older than what the user actually has.
          // Triggers the autosave loop's normal save path on the next
          // store change; for now, fire a one-shot PUT so the server
          // catches up immediately rather than waiting for the user
          // to nudge a shape.
          void fetch(`/api/canvas/${opts.spaceId}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              snapshot: local.snapshot,
              schema_version: SCHEMA_VERSION,
            }),
          }).catch(() => {
            // Non-fatal — autosave will retry on the next edit.
          });
          return;
        } catch (err) {
          console.warn("[canvas] localStorage-preferred restore failed", err);
        }
      }

      if (serverSnapshot) {
        try {
          loadSnapshot(
            editor.store,
            serverSnapshot as Parameters<typeof loadSnapshot>[1],
          );
          sweepEphemeralsIfRunActive();
          setStatus("saved");
          opts.onRestored?.(true);
          return;
        } catch (err) {
          console.warn("[canvas] server-preferred restore failed", err);
        }
      }

      // Server had nothing; if local has data even without a fresh
      // timestamp, restore that as a last-ditch recovery.
      if (local !== null) {
        try {
          loadSnapshot(
            editor.store,
            local.snapshot as Parameters<typeof loadSnapshot>[1],
          );
          sweepEphemeralsIfRunActive();
          setStatus("saved");
          opts.onRestored?.(true);
          return;
        } catch (err) {
          console.warn("[canvas] localStorage fallback restore failed", err);
        }
      }

      opts.onRestored?.(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, opts]);

  // ── Autosave ──
  useEffect(() => {
    if (!editor) return;

    const save = async (retriesLeft = 2) => {
      const snapshot = getSnapshot(editor.store);

      // Local mirror first (cheap, sync). Wrapped with a savedAt
      // timestamp so the next mount's restore can detect when local
      // is newer than server (the unload flushSync writes this same
      // format, and its keepalive PUT often gets dropped by the
      // browser for being over the ~64KB body cap).
      try {
        window.localStorage.setItem(
          lsKey(opts.spaceId),
          JSON.stringify({ snapshot, savedAt: Date.now() }),
        );
      } catch {
        // quota exceeded or private mode — not fatal
      }

      inflightRef.current?.abort();
      const ctrl = new AbortController();
      inflightRef.current = ctrl;
      setStatus("saving");
      try {
        const res = await fetch(`/api/canvas/${opts.spaceId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ snapshot, schema_version: SCHEMA_VERSION }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus("saved");
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        // Transient-failure retry with short backoff. Fresh-space
        // races (read-after-write lag on the space row, brief
        // auth-refresh pauses) commonly self-heal within a second or
        // two — the previous behavior flashed "Save failed" on the
        // topbar and left users staring at it. Silent retry 2x before
        // committing to the error badge.
        if (retriesLeft > 0) {
          const delayMs = retriesLeft === 2 ? 800 : 2400;
          setTimeout(() => {
            // Skip retry if the component has already torn down or a
            // newer save is in flight.
            if (inflightRef.current !== ctrl) return;
            void save(retriesLeft - 1);
          }, delayMs);
          return;
        }
        console.warn("[canvas] server save failed after retries", err);
        setStatus("error");
      }
    };

    const unsub = editor.store.listen(
      () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => save(2), DEBOUNCE_MS);
      },
      { scope: "document", source: "user" },
    );

    // Flush pending saves on tab close / hide. Without this, a 700ms
    // debounce window of unsaved canvas state is lost whenever the
    // user navigates away — that's the channel through which
    // probability shells / kg-formation cards "disappeared" between
    // visits when a run completed seconds before the user closed the
    // tab. fetch({ keepalive: true }) is the only standard API that
    // both targets PUT and survives unload. localStorage is the
    // backup channel for snapshots that exceed the keepalive payload
    // cap (~64KB in most browsers); the next mount's restore picks
    // localStorage up if the server fetch comes back empty.
    const flushSync = () => {
      if (!timerRef.current) return; // nothing pending
      clearTimeout(timerRef.current);
      timerRef.current = null;
      try {
        const snapshot = getSnapshot(editor.store);
        const payload = JSON.stringify({
          snapshot,
          schema_version: SCHEMA_VERSION,
        });
        // Local mirror first — sync, no size limit, guaranteed to land
        // before the page tears down. Wrapped with savedAt so the
        // next mount can prefer this over a stale server snapshot
        // when the keepalive PUT below got dropped for size.
        try {
          window.localStorage.setItem(
            lsKey(opts.spaceId),
            JSON.stringify({ snapshot, savedAt: Date.now() }),
          );
        } catch {
          // quota exceeded — fall through to keepalive fetch
        }
        // Best-effort server save. keepalive: true lets the browser
        // continue the request after unload; if the body is too large
        // the browser rejects and localStorage covers the gap.
        try {
          void fetch(`/api/canvas/${opts.spaceId}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: payload,
            keepalive: true,
          });
        } catch {
          // Body too large for keepalive — localStorage has the data.
        }
      } catch (err) {
        console.warn("[canvas] flush-on-unload failed", err);
      }
    };

    const onVisibilityChange = () => {
      // visibilitychange → hidden fires reliably on mobile and on
      // tab-switching desktop browsers, where beforeunload often
      // doesn't. Mirror so both paths are covered.
      if (document.visibilityState === "hidden") flushSync();
    };
    window.addEventListener("beforeunload", flushSync);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      unsub();
      window.removeEventListener("beforeunload", flushSync);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
      inflightRef.current?.abort();
    };
  }, [editor, opts.spaceId]);

  return { status };
}
