"use client";

// ── BoardTopRightBar ──────────────────────────────────────────────
//
// One frosted-glass container in the top-right that holds every board control
// in a single tidy row — mirroring the BoardNavBar pill on the left. Replaces
// the old scatter of independent position:absolute pills (Saved · Share ·
// Actions · Library · palette · AI) that drifted apart, left gaps between
// them, and shoved each other whenever a popover opened.
//
//   [collaborators] · Saved │ AI · style · Actions · Library │ Share
//
// The two full-height rails (Actions, Library) and the small popovers (AI,
// style) open BELOW this bar, anchored — so nothing in the row ever moves or
// overlaps when one opens. Shared open state (board-panel-signal) lights up
// each trigger while its panel is live and routes the panel's own close ✕.

import { type CSSProperties } from "react";
import { Sparkle, Library as LibraryIcon, Palette } from "lucide-react";
import type { Editor } from "tldraw";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { BoardSaveStatus } from "@/components/objective/use-objective-board-persistence";
import type { BoardCollaborator } from "@/components/objective/use-board-collaboration";
import { AiSettingsBar } from "./ai-settings-bar";
import { PowerupRail } from "./powerup-rail";
import { LibraryLauncher } from "./library-rail";
import { ShareBoardLauncher } from "../share-board-modal";
import { usePanel, togglePanel } from "@/lib/objective-canvas/board-panel-signal";

function saveColor(s: BoardSaveStatus): string {
  return s === "error" ? "#DC2626" : s === "saving" ? "#F59E0B" : "#16A34A";
}
function saveLabel(s: BoardSaveStatus): string {
  return s === "saving" ? "Saving…" : s === "error" ? "Save failed" : "Saved";
}

export function BoardTopRightBar({
  spaceId,
  editor,
  saveStatus,
  collaborators,
}: {
  spaceId: string;
  editor: Editor;
  saveStatus: BoardSaveStatus;
  collaborators: BoardCollaborator[];
}) {
  const powerupsOpen = usePanel("powerups");
  const libraryOpen = usePanel("library");
  const styleOpen = usePanel("style");

  return (
    <>
      <div onPointerDown={(e) => e.stopPropagation()} style={bar}>
        {/* Live collaborators — who else is on the board now. */}
        {collaborators.length > 0 && (
          <>
            <div style={{ display: "inline-flex", alignItems: "center", paddingLeft: 4 }}>
              {collaborators.slice(0, 4).map((c, i) => (
                <div
                  key={c.clientId}
                  title={`${c.name}${c.role === "viewer" ? " (viewer)" : ""}`}
                  style={{ ...avatar, marginLeft: i === 0 ? 0 : -7, background: c.color }}
                >
                  {(c.name || "?").trim().charAt(0)}
                </div>
              ))}
            </div>
            <span style={divider} />
          </>
        )}

        {/* Autosave status — green saved · amber saving · red failed. */}
        <div style={savedPill} title={saveLabel(saveStatus)}>
          <span style={{ ...dot, background: saveColor(saveStatus) }} />
          <span style={{ color: saveStatus === "error" ? "#DC2626" : appleVibe.text.secondary }}>
            {saveLabel(saveStatus)}
          </span>
        </div>

        <span style={divider} />

        {/* AI thinking settings — self-contained button + popover (opens below). */}
        <AiSettingsBar />

        {/* Style palette — toggles tldraw's StylePanel, rendered in-context
            below the bar by CollapsibleStylePanel. */}
        <button
          type="button"
          title="Style controls"
          aria-label="Style controls"
          aria-pressed={styleOpen}
          onClick={() => togglePanel("style")}
          style={iconBtn(styleOpen)}
          onMouseEnter={(e) => hoverIn(e, styleOpen)}
          onMouseLeave={(e) => hoverOut(e, styleOpen)}
        >
          <Palette style={{ width: 15, height: 15 }} strokeWidth={2} />
        </button>

        {/* Actions rail — AI ops on the selection + artifacts. */}
        <button
          type="button"
          title="Actions — run AI on your selection + see artifacts"
          aria-pressed={powerupsOpen}
          onClick={() => togglePanel("powerups")}
          style={textBtn(powerupsOpen)}
          onMouseEnter={(e) => hoverIn(e, powerupsOpen)}
          onMouseLeave={(e) => hoverOut(e, powerupsOpen)}
        >
          <Sparkle style={{ width: 14, height: 14 }} strokeWidth={2.2} />
          Actions
        </button>

        {/* Library rail — objects + glossary. */}
        <button
          type="button"
          title="Library — objects + glossary"
          aria-pressed={libraryOpen}
          onClick={() => togglePanel("library")}
          style={textBtn(libraryOpen)}
          onMouseEnter={(e) => hoverIn(e, libraryOpen)}
          onMouseLeave={(e) => hoverOut(e, libraryOpen)}
        >
          <LibraryIcon style={{ width: 14, height: 14 }} strokeWidth={2.2} />
          Library
        </button>

        <span style={divider} />

        {/* Share — the one accent CTA. */}
        <ShareBoardLauncher spaceId={spaceId} variant="bar" />
      </div>

      {/* Headless panels — render their rail when their signal opens. Mounted
          here so the bar owns the whole top-right surface. */}
      <PowerupRail spaceId={spaceId} editor={editor} />
      <LibraryLauncher spaceId={spaceId} editor={editor} />
    </>
  );
}

// ── hover helpers (transparent → chip, unless active) ──
function hoverIn(e: React.MouseEvent<HTMLButtonElement>, active: boolean) {
  if (active) return;
  e.currentTarget.style.background = appleVibe.surface.chip;
  e.currentTarget.style.color = appleVibe.text.primary;
}
function hoverOut(e: React.MouseEvent<HTMLButtonElement>, active: boolean) {
  if (active) return;
  e.currentTarget.style.background = "transparent";
  e.currentTarget.style.color = appleVibe.text.secondary;
}

// ── styles ──
const bar: CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  zIndex: 70,
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: 4,
  borderRadius: 999,
  // Frosted glass — same material as BoardNavBar (top-left), so the two
  // corners read as one consistent chrome.
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  border: "1px solid var(--glass-border)",
  boxShadow:
    "inset 0 1px 0 var(--glass-highlight), 0 12px 30px -16px rgba(11,18,40,0.32)",
  fontFamily: appleVibe.font.stack,
};
const textBtn = (active: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 11px",
  borderRadius: 999,
  border: "none",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  fontSize: 11.5,
  fontWeight: 650,
  letterSpacing: "-0.01em",
  color: active ? appleVibe.text.onAccent : appleVibe.text.secondary,
  background: active ? appleVibe.accent.primary : "transparent",
  transition: "background 0.15s ease, color 0.15s ease",
});
const iconBtn = (active: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  borderRadius: 999,
  border: "none",
  cursor: "pointer",
  color: active ? appleVibe.text.onAccent : appleVibe.text.secondary,
  background: active ? appleVibe.accent.primary : "transparent",
  transition: "background 0.15s ease, color 0.15s ease",
});
const savedPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "0 8px 0 6px",
  fontFamily: appleVibe.font.stack,
  fontSize: 11,
  fontWeight: 600,
  color: appleVibe.text.secondary,
  whiteSpace: "nowrap",
};
const dot: CSSProperties = { width: 6, height: 6, borderRadius: 999, flexShrink: 0 };
const divider: CSSProperties = {
  width: 1,
  height: 18,
  borderRadius: 1,
  background: "var(--glass-border)",
  margin: "0 2px",
  flexShrink: 0,
};
const avatar: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 999,
  color: "#fff",
  fontSize: 10,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "2px solid var(--glass-float-bg)",
  textTransform: "uppercase",
  fontFamily: appleVibe.font.stack,
};
