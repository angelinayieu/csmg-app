"use client";

// ── NotebookMount / NotebookPanel ──
//
// The on-canvas editable Notebook surface (ARTIFACTS_DOCK_PLAN.md §5, Phase A).
// A large glass panel that expands over the canvas (board stays mounted behind
// it). The journal-card "Open" button + the Notebook dock engine fire
// OPEN_NOTEBOOK_EVENT; this mount listens and opens the panel.
//
// The editing surface itself is the shared <NotebookEditor> (also used by the
// full-page route). This file is just the modal chrome + open/close wiring;
// edits autosave (NotebookEditor flushes on unmount).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  OPEN_NOTEBOOK_EVENT,
  type OpenNotebookDetail,
} from "@/components/objective/board-bus";
import { NotebookEditor } from "./notebook-editor";

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

function NotebookPanel({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center"
      style={{ background: "rgba(15,23,42,0.18)" }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(760px, 92vw)",
          height: "min(80vh, 860px)",
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
        <NotebookEditor
          spaceId={spaceId}
          variant="panel"
          headerRight={
            <>
              <a
                href={`/app/objective/${spaceId}/notebook`}
                title="Open full page"
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  background: "rgba(15,23,42,0.05)",
                  color: appleVibe.text.tertiary,
                }}
              >
                <Maximize2 style={{ width: 15, height: 15 }} strokeWidth={2.2} />
              </a>
              <button
                type="button"
                onClick={onClose}
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
            </>
          }
        />
      </div>
    </div>,
    document.body,
  );
}
