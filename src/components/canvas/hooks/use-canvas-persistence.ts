"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "tldraw";
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

export type CanvasSaveStatus = "idle" | "saving" | "saved" | "error";

export interface CanvasPersistenceOptions {
  spaceId: string;
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
    (async () => {
      try {
        const res = await fetch(`/api/canvas/${opts.spaceId}`, { method: "GET" });
        if (!cancelled && res.ok) {
          const json = (await res.json()) as { snapshot: unknown | null };
          if (json.snapshot) {
            loadSnapshot(editor.store, json.snapshot as Parameters<typeof loadSnapshot>[1]);
            setStatus("saved");
            opts.onRestored?.(true);
            return;
          }
        }
      } catch (err) {
        console.warn("[canvas] server restore failed, trying localStorage", err);
      }

      // Fall back to localStorage mirror
      try {
        const raw = window.localStorage.getItem(lsKey(opts.spaceId));
        if (raw) {
          loadSnapshot(editor.store, JSON.parse(raw));
          setStatus("saved");
          opts.onRestored?.(true);
          return;
        }
      } catch (err) {
        console.warn("[canvas] localStorage restore failed", err);
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

    const save = async () => {
      const snapshot = getSnapshot(editor.store);

      // Local mirror first (cheap, sync)
      try {
        window.localStorage.setItem(lsKey(opts.spaceId), JSON.stringify(snapshot));
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
        console.warn("[canvas] server save failed", err);
        setStatus("error");
      }
    };

    const unsub = editor.store.listen(
      () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(save, DEBOUNCE_MS);
      },
      { scope: "document", source: "user" },
    );

    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
      inflightRef.current?.abort();
    };
  }, [editor, opts.spaceId]);

  return { status };
}
