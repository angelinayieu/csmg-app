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

export function BoardHistoryLauncher({
  spaceId,
  editor,
}: {
  spaceId: string;
  editor: Editor;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dirtyRef = useRef(false);
  const [refreshTick, setRefreshTick] = useState(0);

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
      setConfirming(false);
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        title="Version history"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(true)}
        style={launcherPill}
      >
        <History style={{ width: 13, height: 13 }} strokeWidth={2.2} />
        History
      </button>
    );
  }

  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={panel}>
      <div style={panelHeader}>
        <History
          style={{ width: 14, height: 14, color: appleVibe.text.secondary }}
          strokeWidth={2.2}
        />
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: appleVibe.text.primary,
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
          onClick={() => setOpen(false)}
          style={iconBtn}
        >
          <X style={{ width: 15, height: 15 }} strokeWidth={2.2} />
        </button>
      </div>

      <div style={body}>
        {/* Left rail — the version list. Clicking a row previews it. */}
        <div style={rail}>
          {versions === null ? (
            <div style={emptyRow}>
              <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />{" "}
              Loading…
            </div>
          ) : versions.length === 0 ? (
            <div
              style={{
                padding: "14px 4px",
                fontSize: 12,
                lineHeight: 1.4,
                color: appleVibe.text.tertiary,
              }}
            >
              No versions yet — they accrue as you work, or hit Save to checkpoint
              now.
            </div>
          ) : (
            versions.map((v) => {
              const active = v.id === activeId;
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
                    background: active
                      ? appleVibe.surface.chipHover
                      : "transparent",
                    boxShadow: active
                      ? `inset 2px 0 0 ${appleVibe.accent.primary}`
                      : "none",
                  }}
                >
                  <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                    <span style={rowTitle}>{v.label || "Autosave"}</span>
                    <span style={rowTime}>{timeAgo(v.created_at)}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Right pane — the live preview of the selected version's screen. */}
        <div style={previewPane}>
          <div style={previewFrame}>
            {!activeId ? (
              <div style={previewMsg}>Select a version to preview</div>
            ) : previewLoading ? (
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

          {/* Footer — active version meta + restore (with confirm). */}
          <div style={previewFooter}>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={rowTitle}>
                {activeVersion?.label || "Autosave"}
              </span>
              <span style={rowTime}>
                {activeVersion ? timeAgo(activeVersion.created_at) : ""}
              </span>
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
                disabled={!activeId || !preview?.snapshot}
                style={{
                  ...restoreBtn,
                  opacity: activeId && preview?.snapshot ? 1 : 0.5,
                }}
              >
                <RotateCcw style={{ width: 12, height: 12 }} strokeWidth={2.2} />
                Restore
              </button>
            )}
          </div>
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
const launcherPill: CSSProperties = {
  position: "absolute",
  top: 138,
  left: 16,
  zIndex: 66,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "7px 12px",
  borderRadius: appleVibe.radius.pill,
  border: "1px solid var(--glass-border)",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  fontSize: 11.5,
  fontWeight: 650,
  color: appleVibe.text.secondary,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  boxShadow:
    "inset 0 1px 0 var(--glass-highlight), 0 12px 30px -16px rgba(11,18,40,0.32)",
};
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
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  border: "1px solid var(--glass-border)",
  boxShadow:
    "inset 0 1px 0 var(--glass-highlight), 0 28px 60px -24px rgba(11,18,40,0.38)",
  fontFamily: appleVibe.font.stack,
};
const panelHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 11px 9px",
  borderBottom: "1px solid var(--glass-border)",
};
const body: CSSProperties = {
  flex: 1,
  display: "flex",
  minHeight: 0,
};
const rail: CSSProperties = {
  width: 210,
  flexShrink: 0,
  overflowY: "auto",
  padding: "6px 8px 10px",
  borderRight: "1px solid var(--glass-border)",
  minHeight: 0,
};
const previewPane: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  padding: 12,
  gap: 10,
};
const previewFrame: CSSProperties = {
  flex: 1,
  minHeight: 0,
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
const emptyRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "16px 4px",
  color: appleVibe.text.tertiary,
  fontSize: 12,
};
const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "8px 9px",
  marginBottom: 2,
  borderRadius: appleVibe.radius.sm,
  border: "none",
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
