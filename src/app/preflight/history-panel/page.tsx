// Visual harness for the redesigned board Version-history panel
// (BoardHistoryLauncher). Mounts the REAL component over a live tldraw host
// so it can never drift from what ships, drops a few colorful shapes behind
// the panel so the glass translucency is actually visible, and mocks ONLY the
// /board/history fetches (the auth'd API isn't reachable here) so both the
// populated rows and the empty state can be exercised without a real session.
//
// SAFE TO DELETE — exploration. Route: /preflight/history-panel

"use client";

import "tldraw/tldraw.css";
import { Tldraw, getSnapshot, type Editor } from "tldraw";
import { useEffect, useRef, useState } from "react";
import {
  BoardHistoryLauncher,
  OPEN_BOARD_HISTORY_EVENT,
} from "@/components/objective/canvas-interactions/board-history";

type Mode = "populated" | "empty";

// A few mock versions — mix of autosaves + one manual "Saved" so the row
// redesign (time-led, soft-chip active row, "Saved" tag) is on display.
const NOW = Date.now();
const MOCK_VERSIONS = [
  { id: "v1", label: null, created_at: new Date(NOW - 2 * 60_000).toISOString() },
  { id: "v2", label: "Manual save", created_at: new Date(NOW - 18 * 60_000).toISOString() },
  { id: "v3", label: null, created_at: new Date(NOW - 70 * 60_000).toISOString() },
  { id: "v4", label: null, created_at: new Date(NOW - 26 * 60 * 60_000).toISOString() },
];

export default function HistoryPanelPreflight() {
  // Initial mode is hash-driven (#empty) so each state has a direct URL —
  // robust against the preview browser reloading mid-interaction.
  const initialMode: Mode =
    typeof window !== "undefined" && window.location.hash === "#empty"
      ? "empty"
      : "populated";
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const modeRef = useRef<Mode>(initialMode);
  const [mode, setMode] = useState<Mode>(initialMode);

  // Intercept ONLY the history endpoints; everything else falls through to the
  // real fetch. The detail endpoint returns the live (blank) board snapshot so
  // the preview pane renders a real TldrawImage instead of "unavailable".
  useEffect(() => {
    const original = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const isHistory = /\/board\/history(\/|$|\?)/.test(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (isHistory) {
        if (method === "POST") return jsonResponse({ ok: true });
        const detail = /\/board\/history\/[^/?]+/.test(url);
        if (detail) {
          const snapshot = editorRef.current
            ? getSnapshot(editorRef.current.store)
            : null;
          return jsonResponse({ snapshot });
        }
        return jsonResponse({
          versions: modeRef.current === "empty" ? [] : MOCK_VERSIONS,
        });
      }
      return original(input, init);
    }) as typeof window.fetch;
    return () => {
      window.fetch = original;
    };
  }, []);

  function onMount(ed: Editor) {
    setEditor(ed);
    editorRef.current = ed;
    // Vivid shapes behind the top-left panel so the frosted glass has
    // something to refract (proves the translucency fix).
    ed.createShapes([
      shape("s1", 30, 150, 220, 150, "blue"),
      shape("s2", 280, 120, 180, 200, "violet"),
      shape("s3", 120, 330, 240, 140, "orange"),
      shape("s4", 430, 300, 200, 170, "green"),
      shape("s5", 520, 110, 150, 150, "light-red"),
    ]);
    ed.selectNone();
    ed.setCamera({ x: 0, y: 0, z: 1 });
  }

  // Auto-open the populated panel once the editor (and thus the launcher) is
  // mounted, so the harness lands ready to screenshot.
  useEffect(() => {
    if (!editor) return;
    const t = setTimeout(
      () => window.dispatchEvent(new Event(OPEN_BOARD_HISTORY_EVENT)),
      80,
    );
    return () => clearTimeout(t);
  }, [editor]);

  function open(next: Mode) {
    modeRef.current = next;
    setMode(next);
    // `key={mode}` remounts the launcher (fresh open=false), so it refetches
    // under the new mode. Wait past the remount's useEffect so the new
    // instance's open-event listener is registered before we dispatch.
    setTimeout(
      () => window.dispatchEvent(new Event(OPEN_BOARD_HISTORY_EVENT)),
      80,
    );
  }

  return (
    <div style={{ position: "relative", inset: 0, width: "100vw", height: "100vh" }}>
      <Tldraw onMount={onMount} hideUi />
      {editor ? (
        <BoardHistoryLauncher
          key={mode}
          spaceId="preflight-demo"
          editor={editor}
        />
      ) : null}

      {/* harness controls — bottom center, out of the panel's way */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 8,
          zIndex: 200,
          padding: 6,
          borderRadius: 999,
          background: "rgba(255,255,255,0.9)",
          border: "1px solid rgba(15,23,42,0.1)",
          boxShadow: "0 10px 30px -12px rgba(11,18,40,0.3)",
          font: '600 12px -apple-system, system-ui, sans-serif',
        }}
      >
        <button type="button" onClick={() => open("populated")} style={ctl(mode === "populated")}>
          Open · populated
        </button>
        <button type="button" onClick={() => open("empty")} style={ctl(mode === "empty")}>
          Open · empty
        </button>
      </div>
    </div>
  );
}

function ctl(active: boolean): React.CSSProperties {
  return {
    padding: "7px 14px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: active ? "rgba(15,23,42,0.92)" : "white",
    color: active ? "white" : "#0F172A",
    cursor: "pointer",
    font: "inherit",
  };
}

function shape(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  return {
    id: `shape:${id}` as `shape:${string}`,
    type: "geo",
    x,
    y,
    props: { geo: "rectangle", w, h, color, fill: "solid" },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
