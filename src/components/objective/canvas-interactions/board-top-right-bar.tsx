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

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Sparkle, Library as LibraryIcon, Palette, Users } from "lucide-react";
import type { Editor } from "tldraw";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { BoardSaveStatus } from "@/components/objective/use-objective-board-persistence";
import type {
  BoardCollaborator,
  BoardIdentity,
} from "@/components/objective/use-board-collaboration";
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
  selfIdentity,
}: {
  spaceId: string;
  editor: Editor;
  saveStatus: BoardSaveStatus;
  collaborators: BoardCollaborator[];
  selfIdentity: BoardIdentity | null;
}) {
  const powerupsOpen = usePanel("powerups");
  const libraryOpen = usePanel("library");
  const styleOpen = usePanel("style");

  return (
    <>
      <div onPointerDown={(e) => e.stopPropagation()} style={bar}>
        {/* Live collaborators — who else is on the board now. Avatar stack
            doubles as a Miro-style people button: click to see the roster. */}
        {selfIdentity && (
          <>
            <PeoplePopover
              collaborators={collaborators}
              selfIdentity={selfIdentity}
            />
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

// ── People popover ────────────────────────────────────────────────
//
// Miro-style avatar stack + click-to-open roster. Shows You first, then
// every other live participant with their cursor color, name, and role.
// Closes on outside-click + Esc. Anchored below the bar, like the AI
// settings popover, so it never overlaps the row.

function PeoplePopover({
  collaborators,
  selfIdentity,
}: {
  collaborators: BoardCollaborator[];
  selfIdentity: BoardIdentity;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visible = collaborators.slice(0, 4);
  const overflow = Math.max(0, collaborators.length - visible.length);
  const total = collaborators.length + 1; // include self

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        title={
          collaborators.length === 0
            ? "Just you on this board"
            : `${total} people on this board`
        }
        aria-label="People on this board"
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
        style={peopleBtn(open)}
        onMouseEnter={(e) => hoverIn(e, open)}
        onMouseLeave={(e) => hoverOut(e, open)}
      >
        {collaborators.length === 0 ? (
          <Users style={{ width: 14, height: 14 }} strokeWidth={2.2} />
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            {visible.map((c, i) => (
              <span
                key={c.clientId}
                style={{ ...avatar, marginLeft: i === 0 ? 0 : -7, background: c.color }}
              >
                {(c.name || "?").trim().charAt(0)}
              </span>
            ))}
            {overflow > 0 && (
              <span
                style={{
                  ...avatar,
                  marginLeft: -7,
                  background: "var(--glass-float-bg)",
                  color: appleVibe.text.secondary,
                  border: "2px solid var(--glass-border)",
                }}
              >
                +{overflow}
              </span>
            )}
          </span>
        )}
      </button>

      {open && (
        <div style={popover} onPointerDown={(e) => e.stopPropagation()}>
          <div style={popoverHeader}>
            {collaborators.length === 0
              ? "Just you on this board"
              : `${total} on this board`}
          </div>
          <PersonRow
            color={selfIdentity.color}
            name={`${selfIdentity.name} (You)`}
            role={selfIdentity.role}
          />
          {collaborators.map((c) => (
            <PersonRow
              key={c.clientId}
              color={c.color}
              name={c.name || "Guest"}
              role={c.role}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PersonRow({
  color,
  name,
  role,
}: {
  color: string;
  name: string;
  role: BoardIdentity["role"];
}) {
  return (
    <div style={personRow}>
      <span style={{ ...avatar, width: 22, height: 22, background: color }}>
        {name.trim().charAt(0)}
      </span>
      <span style={personName}>{name}</span>
      <span style={roleBadge(role)}>{role}</span>
    </div>
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
const peopleBtn = (active: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 32,
  height: 32,
  padding: "0 8px",
  borderRadius: 999,
  border: "none",
  cursor: "pointer",
  color: active ? appleVibe.text.onAccent : appleVibe.text.secondary,
  background: active ? appleVibe.accent.primary : "transparent",
  transition: "background 0.15s ease, color 0.15s ease",
});
const popover: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  left: 0,
  minWidth: 220,
  maxHeight: 320,
  overflowY: "auto",
  padding: 6,
  borderRadius: 14,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  border: "1px solid var(--glass-border)",
  boxShadow:
    "inset 0 1px 0 var(--glass-highlight), 0 18px 38px -16px rgba(11,18,40,0.4)",
  fontFamily: appleVibe.font.stack,
  zIndex: 80,
};
const popoverHeader: CSSProperties = {
  padding: "6px 10px 8px",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: appleVibe.text.secondary,
  textTransform: "uppercase",
};
const personRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  borderRadius: 10,
  fontSize: 12.5,
  fontWeight: 600,
  color: appleVibe.text.primary,
};
const personName: CSSProperties = {
  flex: 1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const roleBadge = (role: BoardIdentity["role"]): CSSProperties => ({
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
  padding: "2px 7px",
  borderRadius: 999,
  color: role === "owner" ? "#fff" : appleVibe.text.secondary,
  background:
    role === "owner"
      ? appleVibe.accent.primary
      : "var(--glass-border)",
});
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
