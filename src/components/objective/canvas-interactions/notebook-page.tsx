"use client";

// ── NotebookPage ──
//
// The full-page Notebook (ARTIFACTS_DOCK_PLAN.md §5, Phase B) — client wrapper
// that frames the shared <NotebookEditor> with page chrome (a back link to the
// board). The editor handles load/edit/weave/autosave itself.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { NotebookEditor } from "./notebook-editor";

export function NotebookPage({ spaceId }: { spaceId: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "#FBF8F1",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <NotebookEditor
        spaceId={spaceId}
        variant="page"
        headerRight={
          <Link
            href={`/app/objective/${spaceId}`}
            title="Back to the board"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: 999,
              background: "rgba(15,23,42,0.05)",
              color: appleVibe.text.secondary,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            <ArrowLeft style={{ width: 14, height: 14 }} strokeWidth={2.4} />
            Board
          </Link>
        }
      />
    </div>
  );
}
