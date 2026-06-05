"use client";

// ── BoardHistoryLauncher ──────────────────────────────────────────
//
// Version history for the objective board. A left-edge pill opens a two-pane
// panel: a list of timestamped snapshots (newest first) on the left + a LIVE
// PREVIEW of the selected version's screen on the right (rendered statically
// with <TldrawImage> using the board's custom shape utils, so cards render
// exactly as they do on the canvas). Restore replaces the current board
// (loadSnapshot) after a confirm.
//
// Snapshots are captured automatically every few minutes WHEN the board changed
// (a dirty flag set by a store listener), plus on demand via "Save version".
// Reads/writes /api/objective/[spaceId]/board/history[/snapshotId]. Self-contained.

import {
  Component,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  type Editor,
  getSnapshot,
  loadSnapshot,
  TldrawImage,
} from "tldraw";
import { History, X, RotateCcw, Save, Loader2, ImageOff } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { CUSTOM_SHAPE_UTILS } from "../board-shape-utils";

interface Version {
  id: string;
  label: string | null;
  created_at: string;
}

const AUTO_CAPTURE_MS = 180_000; // snapshot at most every 3 min, only if changed

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/** Short wall-clock time (e.g. "3:42 PM") — the quiet secondary line under
 *  the relative time, so the row leads with "when" without repeating a label. */
function clockTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Fired by the top-right nav bar to open this panel (the launcher's own left
 *  pill is retired — the nav bar is the single trigger). */
export const OPEN_BOARD_HISTORY_EVENT = "board:open-history";

export function BoardHistoryLauncher({
  spaceId,
  editor,
}: {
  spaceId: string;
  editor: Editor;
}) {
  const [open, setOpen] = useState(false);
  // `closing` keeps the panel mounted through its exit animation, so it eases
  // out instead of hard-cutting. A timer ref lets a re-open cancel a pending
  // close (rapid toggle) and gets cleared on unmount.
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dirtyRef = useRef(false);
  const [refreshTick, setRefreshTick] = useState(0);

  // Opened from the consolidated nav bar (top-right). Re-opening mid-exit
  // cancels the pending unmount so it snaps back to fully open.
  useEffect(() => {
    const openIt = () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setClosing(false);
      setOpen(true);
    };
    window.addEventListener(OPEN_BOARD_HISTORY_EVENT, openIt);
    return () => window.removeEventListener(OPEN_BOARD_HISTORY_EVENT, openIt);
  }, []);

  // Clear any pending close timer if the component unmounts mid-exit.
  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  // Play the exit animation, then actually unmount (matches the 150ms
  // oc-history-out keyframe in globals.css).
  function requestClose() {
    if (closeTimerRef.current) return; // already closing
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
      setClosing(false);
      setConfirming(false);
    }, 150);
  }

  // The version being PREVIEWED. Derived default = newest, so the preview shows
  // immediately on open without a setState-in-effect.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    snapshot: unknown | null;
  } | null>(null);
  const activeId = selectedId ?? versions?.[0]?.id ?? null;
  const activeVersion = versions?.find((v) => v.id === activeId) ?? null;
  const previewLoading = !!activeId && preview?.id !== activeId;

  // Mark dirty on any document change + auto-capture on an interval (only when
  // dirty, so an idle board doesn't pile up identical versions).
  useEffect(() => {
    const unsub = editor.store.listen(
      () => {
        dirtyRef.current = true;
      },
      { scope: "document" },
    );
    const t = setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      try {
        const snapshot = getSnapshot(editor.store);
        void fetch(`/api/objective/${spaceId}/board/history`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ snapshot }),
        });
      } catch {
        /* best-effort */
      }
    }, AUTO_CAPTURE_MS);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, [editor, spaceId]);

  // Load the version list when the panel opens (or after a save). No sync
  // setState in the effect body — the fetch resolves it.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/objective/${spaceId}/board/history`)
      .then((r) => (r.ok ? r.json() : { versions: [] }))
      .then((j) => {
        if (alive) setVersions(Array.isArray(j.versions) ? j.versions : []);
      })
      .catch(() => {
        if (alive) setVersions([]);
      });
    return () => {
      alive = false;
    };
  }, [open, spaceId, refreshTick]);

  // Fetch the active version's snapshot for the preview. setState only in the
  // async callbacks (never synchronously in the effect body).
  useEffect(() => {
    if (!open || !activeId || preview?.id === activeId) return;
    let alive = true;
    fetch(`/api/objective/${spaceId}/board/history/${activeId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setPreview({ id: activeId, snapshot: j?.snapshot ?? null });
      })
      .catch(() => {
        if (alive) setPreview({ id: activeId, snapshot: null });
      });
    return () => {
      alive = false;
    };
  }, [open, activeId, spaceId, preview?.id]);

  async function saveNow() {
    if (busy) return;
    setBusy(true);
    try {
      const snapshot = getSnapshot(editor.store);
      await fetch(`/api/objective/${spaceId}/board/history`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot, label: "Manual save" }),
      });
      dirtyRef.current = false;
    } catch {
      /* soft-fail */
    } finally {
      setBusy(false);
      setRefreshTick((n) => n + 1);
    }
  }

  async function restore(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      // Reuse the already-fetched preview snapshot when restoring the version
      // we're previewing; otherwise fetch it.
      let snap: unknown | null =
        preview?.id === id ? preview.snapshot : null;
      if (!snap) {
        const r = await fetch(
          `/api/objective/${spaceId}/board/history/${id}`,
        );
        if (r.ok) snap = ((await r.json()) as { snapshot: unknown }).snapshot;
      }
      if (snap) {
        loadSnapshot(
          editor.store,
          snap as Parameters<typeof loadSnapshot>[1],
        );
      }
    } catch {
      /* soft-fail */
    } finally {
      setBusy(false);
      requestClose();
    }
  }

  // The left-edge launcher pill is retired — the top-right nav bar opens this.
  // Stay mounted through the exit animation (`closing`) before unmounting.
  if (!open && !closing) return null;

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="oc-history-panel"
      data-closing={closing}
      style={panel}
    >
      <div style={panelHeader}>
        <History
          style={{ width: 14, height: 14, color: appleVibe.text.secondary }}
          strokeWidth={2.2}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: appleVibe.text.primary,
            letterSpacing: "-0.01em",
          }}
        >
          Version history
        </span>
        <button
          type="button"
          title="Save version now"
          onClick={saveNow}
          disabled={busy}
          style={saveBtn}
        >
          {busy ? (
            <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />
          ) : (
            <Save style={{ width: 12, height: 12 }} strokeWidth={2.2} />
          )}
          Save
        </button>
        <button
          type="button"
          title="Close"
          onClick={requestClose}
          style={iconBtn}
        >
          <X style={{ width: 15, height: 15 }} strokeWidth={2.2} />
        </button>
      </div>

      <div style={body}>
        {/* Left rail — the version list. Clicking a row previews it. */}
        <div style={rail}>
          {versions === null ? (
            // Calm skeleton instead of a "Loading…" string — three faint,
            // pulsing row placeholders.
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="animate-pulse"
                  style={{
                    height: 38,
                    borderRadius: appleVibe.radius.sm,
                    background: appleVibe.surface.chip,
                  }}
                />
              ))}
            </div>
          ) : versions.length === 0 ? (
            // The rich empty composition lives in the preview pane; keep the
            // rail quiet so the two don't compete.
            <div
              style={{
                padding: "14px 6px",
                fontSize: 11.5,
                lineHeight: 1.4,
                color: appleVibe.text.faint,
              }}
            >
              No checkpoints yet.
            </div>
          ) : (
            versions.map((v) => {
              const active = v.id === activeId;
              const manual = !!v.label && v.label !== "Autosave";
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(v.id);
                    setConfirming(false);
                  }}
                  style={{
                    ...row,
                    // Active = a soft raised chip (filled + gentle drop shadow),
                    // never a hard left side-spine.
                    background: active
                      ? appleVibe.surface.chipHover
                      : "transparent",
                    boxShadow: active ? appleVibe.shadow.chip : "none",
                  }}
                >
                  <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                    <span style={rowTitle}>{timeAgo(v.created_at)}</span>
                    <span style={rowTime}>{clockTime(v.created_at)}</span>
                  </span>
                  {manual ? <span style={savedTag}>Saved</span> : null}
                </button>
              );
            })
          )}
        </div>

        {/* Right pane — the live preview of the selected version's screen. */}
        <div style={previewPane}>
          <div style={previewFrame}>
            {versions !== null && versions.length === 0 ? (
              // One calm empty composition (not three competing messages):
              // glyph + line + the single primary action.
              <div style={emptyState}>
                <History
                  style={{ width: 22, height: 22, color: appleVibe.text.faint }}
                  strokeWidth={1.8}
                />
                <div style={emptyTitle}>No checkpoints yet</div>
                <div style={emptySub}>
                  Versions accrue automatically as you work.
                </div>
                <button
                  type="button"
                  onClick={saveNow}
                  disabled={busy}
                  style={emptyCta}
                >
                  {busy ? (
                    <Loader2
                      className="animate-spin"
                      style={{ width: 13, height: 13 }}
                    />
                  ) : (
                    <Save style={{ width: 13, height: 13 }} strokeWidth={2.2} />
                  )}
                  Save one now
                </button>
              </div>
            ) : !activeId || previewLoading ? (
              <div style={previewMsg}>
                <Loader2
                  className="animate-spin"
                  style={{ width: 18, height: 18 }}
                />
              </div>
            ) : preview?.snapshot ? (
              <PreviewBoundary
                key={activeId}
                fallback={
                  <div style={previewMsg}>
                    <ImageOff style={{ width: 18, height: 18 }} /> Preview
                    unavailable
                  </div>
                }
              >
                <div className="oc-version-preview">
                  <TldrawImage
                    snapshot={
                      preview.snapshot as Parameters<
                        typeof loadSnapshot
                      >[1]
                    }
                    shapeUtils={CUSTOM_SHAPE_UTILS}
                    background
                  />
                </div>
              </PreviewBoundary>
            ) : (
              <div style={previewMsg}>
                <ImageOff style={{ width: 18, height: 18 }} /> Preview
                unavailable
              </div>
            )}
          </div>

          {/* Footer — active version meta + restore (with confirm). Only
              shown once a real version is selected, so the empty/loading
              states never render a dead Restore button. */}
          {activeVersion ? (
          <div style={previewFooter}>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={rowTitle}>{timeAgo(activeVersion.created_at)}</span>
              <span style={rowTime}>{clockTime(activeVersion.created_at)}</span>
            </span>
            {confirming ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 11.5,
                    color: appleVibe.text.secondary,
                  }}
                >
                  Replace current board?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  style={cancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => activeId && restore(activeId)}
                  disabled={busy || !activeId}
                  style={restoreBtn}
                >
                  Restore
                </button>
              </div>
            ) : (
              <button
                type="button"
                title="Restore this version"
                onClick={() => setConfirming(true)}
                disabled={!preview?.snapshot}
                style={{
                  ...restoreBtn,
                  opacity: preview?.snapshot ? 1 : 0.5,
                }}
              >
                <RotateCcw style={{ width: 12, height: 12 }} strokeWidth={2.2} />
                Restore
              </button>
            )}
          </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Preview error boundary ──
// A custom shape's static render can throw (e.g. a shape util that assumes the
// live editor); contain it so the panel survives with a fallback.
class PreviewBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ── styles ──
const panel: CSSProperties = {
  position: "absolute",
  top: 138,
  left: 16,
  zIndex: 93,
  width: "min(720px, 92vw)",
  maxHeight: "min(70vh, 560px)",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  borderRadius: appleVibe.radius.lg,
  // Pulled ~22% more translucent than the shared float token (theme-safe via
  // color-mix, so we don't mutate the global --glass-float-bg) — this is what
  // lets the blur + saturate actually read as glass over canvas content
  // instead of a flat opaque slab.
  background: "color-mix(in srgb, var(--glass-float-bg), transparent 22%)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.8)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.8)",
  border: "1px solid var(--glass-border)",
  boxShadow:
    "inset 0 1px 0 var(--glass-highlight), 0 28px 60px -24px rgba(11,18,40,0.38)",
  fontFamily: appleVibe.font.stack,
};
const panelHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "13px 14px 11px",
  borderBottom: "1px solid var(--glass-border)",
};
const body: CSSProperties = {
  flex: 1,
  display: "flex",
  minHeight: 0,
};
const rail: CSSProperties = {
  width: 214,
  flexShrink: 0,
  overflowY: "auto",
  padding: "8px 10px 12px",
  borderRight: "1px solid var(--glass-border)",
  minHeight: 0,
};
const previewPane: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  padding: 14,
  gap: 12,
};
const previewFrame: CSSProperties = {
  flex: 1,
  // A floor so the pane keeps its confident shape even in the empty/loading
  // state — no more stubby collapsed panel on first open.
  minHeight: 264,
  borderRadius: appleVibe.radius.md,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.base,
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const previewMsg: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: appleVibe.text.tertiary,
  fontSize: 12,
};
const previewFooter: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexShrink: 0,
};
const saveBtn: CSSProperties = {
  marginLeft: "auto",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "4px 9px",
  borderRadius: appleVibe.radius.pill,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.chip,
  color: appleVibe.text.secondary,
  fontSize: 11,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const iconBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: appleVibe.text.tertiary,
};
const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "9px 11px",
  marginBottom: 3,
  borderRadius: appleVibe.radius.sm,
  border: "none",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const savedTag: CSSProperties = {
  flexShrink: 0,
  fontSize: 10,
  fontWeight: 650,
  letterSpacing: "0.02em",
  color: appleVibe.text.secondary,
  padding: "2px 7px",
  borderRadius: appleVibe.radius.pill,
  background: appleVibe.surface.chip,
  border: "1px solid var(--glass-border)",
};
const emptyState: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  textAlign: "center",
  padding: 24,
  maxWidth: 300,
};
const emptyTitle: CSSProperties = {
  fontSize: 13.5,
  fontWeight: 650,
  color: appleVibe.text.primary,
  letterSpacing: "-0.01em",
};
const emptySub: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.45,
  color: appleVibe.text.tertiary,
};
const emptyCta: CSSProperties = {
  marginTop: 8,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 14px",
  borderRadius: appleVibe.radius.pill,
  border: `1px solid ${appleVibe.accent.primary}`,
  background: appleVibe.accent.primary,
  color: appleVibe.text.onAccent,
  fontSize: 12,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const rowTitle: CSSProperties = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 600,
  color: appleVibe.text.primary,
  letterSpacing: "-0.01em",
};
const rowTime: CSSProperties = {
  display: "block",
  marginTop: 1,
  fontSize: 11,
  color: appleVibe.text.faint,
};
const cancelBtn: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 999,
  border: "1px solid var(--glass-border)",
  background: "white",
  color: appleVibe.text.primary,
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const restoreBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  borderRadius: 999,
  border: `1px solid ${appleVibe.accent.primary}`,
  background: appleVibe.accent.primary,
  color: appleVibe.text.onAccent,
  fontSize: 11.5,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
