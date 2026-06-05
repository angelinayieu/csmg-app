"use client";

// ── NotebookEditor ──
//
// The shared editable Notebook surface (ARTIFACTS_DOCK_PLAN.md §5). Used by
// BOTH the on-canvas panel (Phase A) and the full-page route (Phase B), so the
// block-editing behaviour lives in exactly one place.
//
// Block model (notebook-types): ai_woven | user | quote. Editing any block
// marks it `edited` so a re-weave never clobbers it; "Weave new notes" appends
// fresh AI entries from voice notes recorded since the last weave. Edits
// persist to the `artifacts` row (+ a version) and refresh the board card.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Sparkles, Lock, Unlock, Trash2, Loader2, BookOpen } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { deployJournalCard } from "@/components/objective/board-bus";
import {
  coerceNotebookContent,
  blocksToSections,
  genBlockId,
  emptyNotebook,
  type NotebookContent,
  type NotebookBlock,
} from "@/lib/objective-canvas/notebook-types";

export function NotebookEditor({
  spaceId,
  variant,
  headerRight,
}: {
  spaceId: string;
  variant: "panel" | "page";
  /** Extra controls for the toolbar (e.g. the panel's close X). */
  headerRight?: ReactNode;
}) {
  const [content, setContent] = useState<NotebookContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [weaving, setWeaving] = useState(false);
  const dirtyRef = useRef(false);

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
    setContent((c) => (c ? fn(cloneSafe(c)) : c));
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
              edited: b.edited || patch.body !== undefined || patch.heading !== undefined,
              updatedAt: new Date().toISOString(),
            }
          : b,
      ),
    }));
  const addBlock = () =>
    mutate((c) => ({
      ...c,
      blocks: [...c.blocks, { id: genBlockId("user"), kind: "user", body: "", edited: true }],
    }));
  const deleteBlock = (id: string) =>
    mutate((c) => ({ ...c, blocks: c.blocks.filter((b) => b.id !== id) }));
  const toggleLock = (id: string) =>
    mutate((c) => ({
      ...c,
      blocks: c.blocks.map((b) => (b.id === id ? { ...b, locked: !b.locked } : b)),
    }));

  const save = useCallback(
    async (c: NotebookContent) => {
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
        deployJournalCard({
          spaceId,
          title: c.title || "Notebook",
          sectionsJson: JSON.stringify(blocksToSections(c.blocks)),
          pageCount: Math.max(1, Math.ceil(c.blocks.length / 2)),
          status: "fresh",
        });
      } catch {
        /* soft-fail */
      } finally {
        setSaving(false);
      }
    },
    [spaceId],
  );

  // Autosave on a short debounce after edits stop.
  useEffect(() => {
    if (!content || !dirtyRef.current) return;
    const t = window.setTimeout(() => {
      if (dirtyRef.current && content) void save(content);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [content, save]);

  // Flush on unmount.
  const contentRef = useRef(content);
  contentRef.current = content;
  useEffect(
    () => () => {
      if (dirtyRef.current && contentRef.current) void save(contentRef.current);
    },
    [save],
  );

  const weave = useCallback(async () => {
    setWeaving(true);
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

  const isPage = variant === "page";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: isPage ? "18px 28px" : "16px 20px",
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
        {saving && <span style={{ fontSize: 11.5, color: appleVibe.text.faint }}>Saving…</span>}
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
        {headerRight}
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: isPage ? "32px 0" : "22px 28px 32px",
          background: "#FBF8F1",
        }}
      >
        <div style={isPage ? { maxWidth: 760, margin: "0 auto", padding: "0 32px" } : undefined}>
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
                  fontSize: isPage ? 32 : 26,
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
                  Empty notebook. Record voice notes and tap “Weave new notes”, or add your own
                  entry below.
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
    </div>
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
        <div
          className="opacity-0 group-hover:opacity-100"
          style={{ display: "flex", gap: 4, transition: "opacity 120ms" }}
        >
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
        ref={(el) => {
          if (el) autosize(el);
        }}
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
  children: ReactNode;
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

function cloneSafe<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v)) as T;
  }
}
