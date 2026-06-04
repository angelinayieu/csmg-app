"use client";

// ── BoardHistoryLauncher ──────────────────────────────────────────
//
// Version history for the objective board. A left-edge pill opens a panel of
// timestamped snapshots (newest first) you can restore. Snapshots are captured
// automatically every few minutes WHEN the board changed (a dirty flag set by a
// store listener), plus on demand via "Save version". Restore replaces the
// current board (loadSnapshot) after a confirm. Reads/writes
// /api/objective/[spaceId]/board/history[/snapshotId]. Self-contained.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { type Editor, getSnapshot, loadSnapshot } from "tldraw";
import { History, X, RotateCcw, Save, Loader2 } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

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
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const [refreshTick, setRefreshTick] = useState(0);

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
      const r = await fetch(`/api/objective/${spaceId}/board/history/${id}`);
      if (r.ok) {
        const j = (await r.json()) as { snapshot: unknown };
        if (j.snapshot) {
          loadSnapshot(
            editor.store,
            j.snapshot as Parameters<typeof loadSnapshot>[1],
          );
        }
      }
    } catch {
      /* soft-fail */
    } finally {
      setBusy(false);
      setConfirmId(null);
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
        <History style={{ width: 14, height: 14, color: appleVibe.text.secondary }} strokeWidth={2.2} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: appleVibe.text.primary }}>
          Version history
        </span>
        <button type="button" title="Save version now" onClick={saveNow} disabled={busy} style={saveBtn}>
          {busy ? <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} /> : <Save style={{ width: 12, height: 12 }} strokeWidth={2.2} />}
          Save
        </button>
        <button type="button" title="Close" onClick={() => setOpen(false)} style={iconBtn}>
          <X style={{ width: 15, height: 15 }} strokeWidth={2.2} />
        </button>
      </div>

      <div style={list}>
        {versions === null ? (
          <div style={emptyRow}><Loader2 className="animate-spin" style={{ width: 13, height: 13 }} /> Loading…</div>
        ) : versions.length === 0 ? (
          <div style={{ padding: "14px 4px", fontSize: 12, lineHeight: 1.4, color: appleVibe.text.tertiary }}>
            No versions yet — they accrue as you work, or hit Save to checkpoint now.
          </div>
        ) : (
          versions.map((v) => (
            <div key={v.id} style={row}>
              {confirmId === v.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                  <span style={{ flex: 1, fontSize: 11.5, color: appleVibe.text.secondary }}>
                    Replace current board?
                  </span>
                  <button type="button" onClick={() => setConfirmId(null)} style={cancelBtn}>Cancel</button>
                  <button type="button" onClick={() => restore(v.id)} disabled={busy} style={restoreBtn}>Restore</button>
                </div>
              ) : (
                <>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={rowTitle}>{v.label || "Autosave"}</span>
                    <span style={rowTime}>{timeAgo(v.created_at)}</span>
                  </span>
                  <button
                    type="button"
                    title="Restore this version"
                    onClick={() => setConfirmId(v.id)}
                    style={rowRestore}
                  >
                    <RotateCcw style={{ width: 12, height: 12 }} strokeWidth={2.2} />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
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
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 12px 30px -16px rgba(11,18,40,0.32)",
};
const panel: CSSProperties = {
  position: "absolute",
  top: 138,
  left: 16,
  zIndex: 93,
  width: 300,
  maxHeight: "min(60vh, 520px)",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  borderRadius: appleVibe.radius.lg,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  border: "1px solid var(--glass-border)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 28px 60px -24px rgba(11,18,40,0.38)",
  fontFamily: appleVibe.font.stack,
};
const panelHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 11px 9px",
  borderBottom: "1px solid var(--glass-border)",
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
const list: CSSProperties = { flex: 1, overflowY: "auto", padding: "6px 8px 10px", minHeight: 0 };
const emptyRow: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "16px 4px", color: appleVibe.text.tertiary, fontSize: 12 };
const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 9px",
  marginBottom: 2,
  borderRadius: appleVibe.radius.sm,
  background: appleVibe.surface.chip,
};
const rowTitle: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, color: appleVibe.text.primary, letterSpacing: "-0.01em" };
const rowTime: CSSProperties = { display: "block", marginTop: 1, fontSize: 11, color: appleVibe.text.faint };
const rowRestore: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  flexShrink: 0,
  borderRadius: appleVibe.radius.sm,
  border: "1px solid var(--glass-border)",
  background: "white",
  color: appleVibe.text.secondary,
  cursor: "pointer",
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
  padding: "5px 11px",
  borderRadius: 999,
  border: `1px solid ${appleVibe.accent.primary}`,
  background: appleVibe.accent.primary,
  color: appleVibe.text.onAccent,
  fontSize: 11.5,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
