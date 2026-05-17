"use client";

// ── CanvasWorkspaceRoomPicker (universal-canvas Phase A) ──────────
//
// Floating chrome button + popover that lets the user "bring in" an
// existing brainstorm session as a WorkspaceRoomShape on the canvas.
//
// Architecture mirrors CanvasAddButtons: this chrome lives OUTSIDE
// the tldraw editor tree. On select-brainstorm the picker dispatches
// a `canvas-workspace:add-brainstorm` window CustomEvent carrying the
// session id + cached title. The companion CanvasWorkspaceRoomSpawner
// (rendered inside the tldraw editor tree via the
// `InFrontOfTheCanvas` slot) listens for that event and calls
// editor.createShape(...) to actually spawn the shape.
//
// Phase A scope: brainstorm rooms only. Strategy / twin / probe
// follow the same pattern — add a new picker tab + a new event +
// extend the spawner switch. Each kind ships incrementally without
// reshaping anything.

import { useCallback, useEffect, useRef, useState } from "react";
import { Layers, Loader2, Plus, X } from "lucide-react";

interface BrainstormSummary {
  id: string;
  title: string;
  updated_at: string;
  node_count?: number;
}

export function CanvasWorkspaceRoomPicker() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<BrainstormSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Lazy-load the brainstorm list when the picker is opened so we
  // don't pay the fetch on every page render. Refresh each open so a
  // freshly-created brainstorm shows up without a page reload.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/synergy/sessions", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load brainstorms");
        const json = (await res.json()) as { sessions: BrainstormSummary[] };
        if (!cancelled) setSessions(json.sessions ?? []);
      } catch {
        if (!cancelled) setSessions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleSelect = useCallback(
    (session: BrainstormSummary) => {
      // Dispatch to the in-canvas spawner. It will call
      // editor.createShape with kind="brainstorm" + artifact_id +
      // cached_title so the room renders immediately.
      window.dispatchEvent(
        new CustomEvent("canvas-workspace:add-brainstorm", {
          detail: {
            sessionId: session.id,
            title: session.title,
          },
        }),
      );
      setOpen(false);
    },
    [],
  );

  return (
    <div ref={popoverRef} className="pointer-events-auto relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-gray-700 shadow-sm ring-1 ring-black/[0.06] backdrop-blur-md transition hover:bg-white hover:ring-black/[0.1]"
        title="Bring an existing brainstorm onto the canvas as a room"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        Add brainstorm
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-[320px] overflow-hidden rounded-2xl bg-white/95 shadow-lg ring-1 ring-black/[0.08] backdrop-blur-xl"
          style={{
            boxShadow:
              "0 20px 50px -24px rgba(15,23,42,0.2), inset 0 1px 0 rgba(255,255,255,0.7)",
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-black/[0.04] px-4 py-2.5">
            <div className="inline-flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-gray-500" />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
                Your brainstorms
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition hover:bg-black/[0.04] hover:text-gray-700"
              title="Close"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>

          <div className="max-h-[340px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-gray-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </div>
            ) : sessions === null || sessions.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-gray-500">
                No brainstorms yet. Start one from the homepage.
              </div>
            ) : (
              <ul>
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => handleSelect(s)}
                      className="block w-full px-4 py-2.5 text-left transition hover:bg-black/[0.03]"
                    >
                      <div className="text-[13px] font-medium text-gray-900">
                        {s.title || "Untitled brainstorm"}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">
                        {relativeTime(s.updated_at)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
