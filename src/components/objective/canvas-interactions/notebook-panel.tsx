"use client";

// ── NotebookMount / NotebookPanel ──
//
// The on-canvas editable Notebook surface (ARTIFACTS_DOCK_PLAN.md §5, Phase A).
// A large glass panel that expands over the canvas (board stays mounted behind
// it). The journal-card "Open" button + the Notebook dock engine fire
// OPEN_NOTEBOOK_EVENT; this mount listens and opens the panel.
//
// The notebook is a list of BLOCKS (ai_woven | user | quote). The user can
// edit any block (typing marks it `edited` so a re-weave never clobbers it),
// add their own blocks, lock blocks, and "Weave new notes" to append fresh
// AI entries from voice notes recorded since the last weave. Edits persist to
// the `artifacts` row (+ a version) and refresh the board card handle.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Plus,
  Sparkles,
  Lock,
  Unlock,
  Trash2,
  Loader2,
  BookOpen,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  OPEN_NOTEBOOK_EVENT,
  deployJournalCard,
  type OpenNotebookDetail,
} from "@/components/objective/board-bus";
import {
  coerceNotebookContent,
  blocksToSections,
  genBlockId,
  emptyNotebook,
  type NotebookContent,
  type NotebookBlock,
} from "@/lib/objective-canvas/notebook-types";

export function NotebookMount({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<OpenNotebookDetail>).detail;
      if (d?.spaceId && d.spaceId !== spaceId) return;
      setOpen(true);
    };
    window.addEventListener(OPEN_NOTEBOOK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTEBOOK_EVENT, onOpen);
  }, [spaceId]);

  if (!open) return null;
  return <NotebookPanel spaceId={spaceId} onClose={() => setOpen(false)} />;
}

function NotebookPanel({
  spaceId,
  onClose,
}: {
  spaceId: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<NotebookContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [weaving, setWeaving] = useState(false);
  const dirtyRef = useRef(false);

  // Load the space's notebook artifact (or start empty).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/objective/${spaceId}/artifacts?type=notebook`)
      .then((r) => (r.ok ? r.json() : { artifacts: [] }))
      .then((j) => {
        if (!alive) return;
        const row = Array.isArray(j.artifacts) ? j.artifacts[0] : null;
        setContent(row?.content ? coerceNotebookContent(row.content) : emptyNotebook());
      })
      .catch(() => {
        if (alive) setContent(emptyNotebook());
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [spaceId]);

  const mutate = useCallback((fn: (c: NotebookContent) => NotebookContent) => {
    dirtyRef.current = true;
    setContent((c) => (c ? fn(structuredCloneSafe(c)) : c));
  }, []);

  const setTitle = (title: string) => mutate((c) => ({ ...c, title }));

  const editBlock = (id: string, patch: Partial<NotebookBlock>) =>
    mutate((c) => ({
      ...c,
      blocks: c.blocks.map((b) =>
        b.id === id
          ? {
              ...b,
              ...patch,
              // Editing an AI block marks it edited so a re-weave won't touch it.
              edited: b.edited || patch.body !== undefined || patch.heading !== undefined,
              updatedAt: new Date().toISOString(),
            }
          : b,
      ),
    }));

  const addBlock = () =>
    mutate((c) => ({
      ...c,
      blocks: [
        ...c.blocks,
        { id: genBlockId("user"), kind: "user", body: "", edited: true },
      ],
    }));

  const deleteBlock = (id: string) =>
    mutate((c) => ({ ...c, blocks: c.blocks.filter((b) => b.id !== id) }));

  const toggleLock = (id: string) =>
    mutate((c) => ({
      ...c,
      blocks: c.blocks.map((b) => (b.id === id ? { ...b, locked: !b.locked } : b)),
    }));

  const save = useCallback(
    async (next?: NotebookContent) => {
      const c = next ?? content;
      if (!c) return;
      setSaving(true);
      try {
        await fetch(`/api/objective/${spaceId}/artifacts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "upsert",
            engineKey: "notebook",
            artifactType: "notebook",
            title: c.title,
            status: "ready",
            content: c,
            lastUpdatedBy: "user",
            appendVersion: true,
            changeType: "user_edit",
          }),
        });
        dirtyRef.current = false;
        // Refresh the glanceable board card.
        deployJournalCard({
          spaceId,
          title: c.title || "Notebook",
          sectionsJson: JSON.stringify(blocksToSections(c.blocks)),
          pageCount: Math.max(1, Math.ceil(c.blocks.length / 2)),
          status: "fresh",
        });
      } catch {
        /* soft-fail — keep the panel open with the unsaved edits */
      } finally {
        setSaving(false);
      }
    },
    [content, spaceId],
  );

  const weave = useCallback(async () => {
    setWeaving(true);
    // Persist any pending edits first so the weave appends to the latest.
    if (dirtyRef.current && content) await save(content);
    try {
      const res = await fetch(`/api/objective/${spaceId}/artifacts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run_notebook" }),
      });
      if (res.ok) {
        const j = await res.json();
        const fresh = coerceNotebookContent({
          title: j.title,
          blocks: j.blocks,
          wovenCount: j.wovenCount,
        });
        dirtyRef.current = false;
        setContent(fresh);
        deployJournalCard({
          spaceId,
          title: fresh.title || "Notebook",
          sectionsJson: JSON.stringify(blocksToSections(fresh.blocks)),
          pageCount: Math.max(1, Math.ceil(fresh.blocks.length / 2)),
          status: "fresh",
        });
      }
    } catch {
      /* soft-fail */
    } finally {
      setWeaving(false);
    }
  }, [spaceId, content, save]);

  const close = useCallback(async () => {
    if (dirtyRef.current && content) await save(content);
    onClose();
  }, [content, save, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center"
      style={{ background: "rgba(15,23,42,0.18)" }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) void close();
      }}
    >
      <div
        style={{
          width: "min(760px, 92vw)",
          height: "min(80vh, 860px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: 22,
          background: "var(--glass-modal-bg, rgba(255,255,255,0.96))",
          backdropFilter: "blur(var(--blur-modal, 28px)) saturate(1.7)",
          WebkitBackdropFilter: "blur(var(--blur-modal, 28px)) saturate(1.7)",
          border: "1px solid var(--glass-border)",
          boxShadow: "0 40px 90px -30px rgba(11,18,40,0.5)",
          fontFamily: appleVibe.font.stack,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "16px 20px",
            borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          <BookOpen style={{ width: 18, height: 18, color: "#0F766E" }} strokeWidth={2.2} />
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: appleVibe.text.faint,
            }}
          >
            Notebook
          </span>
          <div style={{ flex: 1 }} />
          {saving && (
            <span style={{ fontSize: 11.5, color: appleVibe.text.faint }}>Saving…</span>
          )}
          <button
            type="button"
            onClick={weave}
            disabled={weaving}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: 999,
              border: "none",
              cursor: weaving ? "default" : "pointer",
              background: "linear-gradient(140deg, #0F766E, #10B981)",
              color: "white",
              fontSize: 12,
              fontWeight: 650,
            }}
          >
            {weaving ? (
              <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} strokeWidth={2.4} />
            ) : (
              <Sparkles style={{ width: 14, height: 14 }} strokeWidth={2.4} />
            )}
            Weave new notes
          </button>
          <button
            type="button"
            onClick={() => void close()}
            aria-label="Close notebook"
            style={{
              display: "grid",
              placeItems: "center",
              width: 30,
              height: 30,
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background: "rgba(15,23,42,0.05)",
              color: appleVibe.text.tertiary,
            }}
          >
            <X style={{ width: 16, height: 16 }} strokeWidth={2.4} />
          </button>
        </div>

        {/* Body — warm paper scroll */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "22px 28px 32px",
            background: "#FBF8F1",
          }}
        >
          {loading || !content ? (
            <div style={{ color: appleVibe.text.faint, fontSize: 13, fontStyle: "italic" }}>
              Opening your notebook…
            </div>
          ) : (
            <>
              <input
                value={content.title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled notebook"
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontSize: 26,
                  fontWeight: 700,
                  color: "#3a3327",
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  marginBottom: 18,
                }}
              />

              {content.blocks.length === 0 ? (
                <div
                  style={{
                    fontSize: 13.5,
                    color: "#8a8068",
                    fontStyle: "italic",
                    fontFamily: "Georgia, serif",
                  }}
                >
                  Empty notebook. Record voice notes and tap “Weave new notes”, or
                  add your own entry below.
                </div>
              ) : (
                content.blocks.map((b) => (
                  <NotebookBlockRow
                    key={b.id}
                    block={b}
                    onEdit={(patch) => editBlock(b.id, patch)}
                    onDelete={() => deleteBlock(b.id)}
                    onToggleLock={() => toggleLock(b.id)}
                  />
                ))
              )}

              <button
                type="button"
                onClick={addBlock}
                style={{
                  marginTop: 18,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: `1px dashed ${appleVibe.stroke.medium}`,
                  background: "transparent",
                  cursor: "pointer",
                  color: appleVibe.text.tertiary,
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                <Plus style={{ width: 14, height: 14 }} strokeWidth={2.4} />
                Add an entry
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function NotebookBlockRow({
  block,
  onEdit,
  onDelete,
  onToggleLock,
}: {
  block: NotebookBlock;
  onEdit: (patch: Partial<NotebookBlock>) => void;
  onDelete: () => void;
  onToggleLock: () => void;
}) {
  const isQuote = block.kind === "quote";
  const tone =
    block.kind === "ai_woven" ? "#0F766E" : block.kind === "quote" ? "#6366F1" : "#64748B";
  const label =
    block.kind === "ai_woven" ? "Woven" : block.kind === "quote" ? "From board" : "You";

  return (
    <div
      className="group"
      style={{
        position: "relative",
        marginBottom: 16,
        paddingLeft: isQuote ? 14 : 0,
        borderLeft: isQuote ? `2px solid ${tone}55` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: tone,
          }}
        >
          {label}
          {block.locked && " · locked"}
        </span>
        <div style={{ flex: 1 }} />
        <div className="opacity-0 group-hover:opacity-100" style={{ display: "flex", gap: 4, transition: "opacity 120ms" }}>
          <IconBtn title={block.locked ? "Unlock" : "Lock"} onClick={onToggleLock}>
            {block.locked ? (
              <Unlock style={{ width: 13, height: 13 }} strokeWidth={2.2} />
            ) : (
              <Lock style={{ width: 13, height: 13 }} strokeWidth={2.2} />
            )}
          </IconBtn>
          <IconBtn title="Delete entry" onClick={onDelete}>
            <Trash2 style={{ width: 13, height: 13 }} strokeWidth={2.2} />
          </IconBtn>
        </div>
      </div>

      {!isQuote && (
        <input
          value={block.heading ?? ""}
          onChange={(e) => onEdit({ heading: e.target.value })}
          placeholder="Heading (optional)"
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 15,
            fontWeight: 700,
            color: "#3a3327",
            fontFamily: "Georgia, serif",
            marginBottom: 2,
          }}
        />
      )}
      <textarea
        value={block.body}
        onChange={(e) => {
          onEdit({ body: e.target.value });
          autosize(e.target);
        }}
        ref={(el) => el && autosize(el)}
        placeholder={isQuote ? "Quoted card…" : "Write…"}
        style={{
          width: "100%",
          border: "none",
          outline: "none",
          background: "transparent",
          resize: "none",
          overflow: "hidden",
          fontSize: 14,
          lineHeight: 1.6,
          color: "#4a4234",
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontStyle: isQuote ? "italic" : "normal",
        }}
      />
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: "grid",
        placeItems: "center",
        width: 24,
        height: 24,
        borderRadius: 7,
        border: "none",
        cursor: "pointer",
        background: "rgba(15,23,42,0.05)",
        color: appleVibe.text.tertiary,
      }}
    >
      {children}
    </button>
  );
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** structuredClone with a JSON fallback (older runtimes). */
function structuredCloneSafe<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v)) as T;
  }
}
