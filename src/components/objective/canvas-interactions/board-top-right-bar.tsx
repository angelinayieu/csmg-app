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

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkle,
  Library as LibraryIcon,
  Palette,
  Trophy,
  Sparkles as IdeasIcon,
  Star,
  Zap,
} from "lucide-react";
import type { LeaderboardResponse } from "@/app/api/objective/[spaceId]/leaderboard/route";
import type { Editor } from "tldraw";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { BoardSaveStatus } from "@/components/objective/use-objective-board-persistence";
import type {
  BoardCollaborator,
  BoardIdentity,
} from "@/components/objective/use-board-collaboration";
import { AiSettingsBar } from "./ai-settings-bar";
import { PowerupRail } from "./powerup-rail";
import { UncertaintyMapRail } from "./uncertainty-map-rail";
import { LibraryLauncher } from "./library-rail";
import { ShareBoardLauncher } from "../share-board-modal";
import {
  usePanel,
  togglePanel,
  setPanel,
} from "@/lib/objective-canvas/board-panel-signal";

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
  const mapOpen = usePanel("map");
  const libraryOpen = usePanel("library");
  const styleOpen = usePanel("style");

  return (
    <>
      <div onPointerDown={(e) => e.stopPropagation()} style={bar}>
        {/* Live collaborators — who else is on the board now. Avatar stack
            doubles as a Miro-style people button: click to see the roster +
            a contributions leaderboard. */}
        {selfIdentity && (
          <>
            <PeoplePopover
              spaceId={spaceId}
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

        {/* Uncertainty map — auto-detected hot spots (#17). */}
        <button
          type="button"
          title="Map — where this idea is most uncertain"
          aria-pressed={mapOpen}
          onClick={() => togglePanel("map")}
          style={textBtn(mapOpen)}
          onMouseEnter={(e) => hoverIn(e, mapOpen)}
          onMouseLeave={(e) => hoverOut(e, mapOpen)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <circle cx="5" cy="6" r="2" />
            <circle cx="19" cy="7" r="2" />
            <circle cx="6" cy="19" r="2" />
            <path d="M10.2 10.4 6.6 7.4M14 11l3.3-2.5M10.4 14.2 7.6 17.4" />
          </svg>
          Map
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
      <UncertaintyMapRail spaceId={spaceId} />
      <LibraryLauncher spaceId={spaceId} editor={editor} />
    </>
  );
}

// ── People popover ────────────────────────────────────────────────
//
// Miro-style avatar stack + click-to-open roster. The stack ALWAYS leads
// with YOU (accent-ringed self avatar) so identity reads even when you're
// solo; peers fan in to the right (-7px overlap, max 3 visible + "+N"
// chip). Each peer carries a soft breathing green live-dot — the
// "they're really here" signal that matches the cursor's bob/pulse on
// the canvas. Two views inside: Roster (the list) ↔ Contributions
// (leaderboard over library_objects via /api/objective/[id]/leaderboard).
// See [[project_contributor_leaderboard]] + [[project_collaborative_whiteboard]].

function PeoplePopover({
  spaceId,
  collaborators,
  selfIdentity,
}: {
  spaceId: string;
  collaborators: BoardCollaborator[];
  selfIdentity: BoardIdentity;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"roster" | "leaderboard">("roster");
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Pull the leaderboard lazily — only when the user actually flips to it,
  // and re-fetch each open so the rates stay fresh after a converge/publish.
  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/objective/${spaceId}/leaderboard`, {
        cache: "no-store",
      });
      if (res.ok) setLeaderboard((await res.json()) as LeaderboardResponse);
    } catch {
      /* soft-fail — empty state renders */
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (!open || view !== "leaderboard") return;
    void loadLeaderboard();
  }, [open, view, loadLeaderboard]);

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

  // Up to 3 peer avatars (4 chips total with self); rest collapse to "+N".
  const visiblePeers = collaborators.slice(0, 3);
  const overflow = Math.max(0, collaborators.length - visiblePeers.length);
  const total = collaborators.length + 1;
  const title =
    collaborators.length === 0
      ? "Just you on this board"
      : collaborators.length === 1
        ? "1 other person here · click to see who"
        : `${collaborators.length} others here · click to see who`;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        title={title}
        aria-label="People on this board"
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
        style={peopleBtn(open)}
        onMouseEnter={(e) => hoverIn(e, open)}
        onMouseLeave={(e) => hoverOut(e, open)}
      >
        <span style={{ display: "inline-flex", alignItems: "center" }}>
          {/* Self ALWAYS first — accent ring so "You" reads at a glance. */}
          <AvatarChip
            color={selfIdentity.color}
            initial={(selfIdentity.name || "?").trim().charAt(0)}
            self
          />
          {visiblePeers.map((c) => (
            <AvatarChip
              key={c.clientId}
              color={c.color}
              initial={(c.name || "?").trim().charAt(0)}
              live
            />
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
      </button>

      {open && (
        <div style={popover} onPointerDown={(e) => e.stopPropagation()}>
          <div style={popoverHeader}>
            <span style={liveDotInline} />
            <span style={{ flex: 1 }}>
              {collaborators.length === 0
                ? "Just you here"
                : `${total} on this board`}
            </span>
          </div>

          {/* Segmented toggle — Roster vs Contributions. */}
          <div style={segmented}>
            <button
              type="button"
              onClick={() => setView("roster")}
              style={segBtn(view === "roster")}
            >
              Roster
            </button>
            <button
              type="button"
              onClick={() => setView("leaderboard")}
              style={segBtn(view === "leaderboard")}
            >
              <Trophy
                style={{ width: 11, height: 11, marginRight: 4 }}
                strokeWidth={2.4}
              />
              Contributions
            </button>
          </div>

          {view === "roster" ? (
            <>
              <PersonRow
                color={selfIdentity.color}
                name={`${selfIdentity.name} (You)`}
                role={selfIdentity.role}
                self
              />
              {collaborators.map((c) => (
                <PersonRow
                  key={c.clientId}
                  color={c.color}
                  name={c.name || "Guest"}
                  role={c.role}
                />
              ))}
            </>
          ) : (
            <LeaderboardView
              data={leaderboard}
              loading={loading}
              meUserId={selfIdentity.userId}
            />
          )}
        </div>
      )}

      {/* Scoped keyframes — the live-dot breathing pulse echoes the
          cursor's bob/pulse so the bar + canvas read as one system. */}
      <style>{`
        @keyframes board-people-pulse {
          0%, 100% { transform: scale(1);   opacity: 1; }
          50%      { transform: scale(1.25); opacity: 0.65; }
        }
      `}</style>
    </div>
  );
}

// Single avatar chip. `self` gets an accent ring; `live` gets a small
// breathing green dot pinned to the bottom-right.
function AvatarChip({
  color,
  initial,
  self = false,
  live = false,
}: {
  color: string;
  initial: string;
  self?: boolean;
  live?: boolean;
}) {
  return (
    <span
      style={{
        ...avatar,
        marginLeft: self ? 0 : -7,
        background: color,
        position: "relative",
        boxShadow: self
          ? `0 0 0 2px var(--glass-float-bg), 0 0 0 3.5px ${appleVibe.accent.primary}`
          : `0 0 0 2px var(--glass-float-bg)`,
      }}
    >
      {initial}
      {live && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: 7,
            height: 7,
            borderRadius: 999,
            background: "#22C55E",
            border: "1.5px solid var(--glass-float-bg)",
            animation: "board-people-pulse 1.8s ease-in-out infinite",
            transformOrigin: "center",
          }}
        />
      )}
    </span>
  );
}

function PersonRow({
  color,
  name,
  role,
  self = false,
}: {
  color: string;
  name: string;
  role: BoardIdentity["role"];
  self?: boolean;
}) {
  return (
    <div style={personRow}>
      <AvatarChip
        color={color}
        initial={name.trim().charAt(0)}
        self={self}
        live={!self}
      />
      <span style={personName}>{name}</span>
      <span style={roleBadge(role)}>{role}</span>
    </div>
  );
}

// ── Leaderboard view ──────────────────────────────────────────────
//
// Per-contributor rollup over library_objects (the finalized idea layer).
// Each row's stacked bar: outer width = activity share within the room,
// inner accent fill = finalized rate. Stats line: finalized/total ·
// on-board · quality stars. Top strip = signal-vs-noise totals; footer
// "Browse Library" opens the Library rail so the user can SEE the
// finalized vs noise corpus directly. See [[project_contributor_leaderboard]].
function LeaderboardView({
  data,
  loading,
  meUserId,
}: {
  data: LeaderboardResponse | null;
  loading: boolean;
  meUserId: string;
}) {
  if (loading && !data) return <div style={emptyState}>Loading contributions…</div>;
  if (!data) return <div style={emptyState}>Could not load leaderboard.</div>;
  const { rows, totals } = data;
  if (rows.length === 0 || totals.inLibrary === 0) {
    return (
      <div style={emptyState}>
        No published ideas yet. Run Converge → Publish on a selection to
        seed contributions.
      </div>
    );
  }
  const maxIdeas = Math.max(1, ...rows.map((r) => r.totalIdeas));
  return (
    <>
      <div style={statStrip}>
        <Stat label="Finalized" value={totals.finalized} accent />
        <span style={statDivider} />
        <Stat label="Noise" value={totals.noise} muted />
        <span style={statDivider} />
        <Stat label="On board" value={totals.onBoard} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((r, idx) => (
          <LeaderRow
            key={r.userId}
            rank={idx + 1}
            row={r}
            maxIdeas={maxIdeas}
            isYou={r.userId === meUserId}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setPanel("library", true)}
        style={browseLibraryBtn}
      >
        <LibraryIcon style={{ width: 12, height: 12 }} strokeWidth={2.4} />
        Browse Library
      </button>
    </>
  );
}

function LeaderRow({
  rank,
  row,
  maxIdeas,
  isYou,
}: {
  rank: number;
  row: LeaderboardResponse["rows"][number];
  maxIdeas: number;
  isYou: boolean;
}) {
  const ideasPct = Math.min(100, (row.totalIdeas / maxIdeas) * 100);
  const finalPct = Math.min(100, row.finalizedRate * 100);
  const qualityStars =
    row.avgQuality == null
      ? null
      : Math.max(0, Math.min(5, Math.round(row.avgQuality)));
  return (
    <div
      style={{
        ...leaderRowOuter,
        background: isYou ? appleVibe.surface.chip : "transparent",
      }}
    >
      <span style={rankNum}>{rank}</span>
      <AvatarChip
        color={row.color}
        initial={(row.name || "?").trim().charAt(0)}
        self={isYou}
        live={!isYou}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={leaderTopLine}>
          <span style={leaderName}>
            {row.name}
            {isYou && <span style={youTag}>You</span>}
            {row.isOwner && <span style={ownerTag}>Owner</span>}
          </span>
          {row.recent24h > 0 && (
            <span style={zapTag} title={`${row.recent24h} new in last 24h`}>
              <Zap style={{ width: 9, height: 9 }} strokeWidth={2.8} />
              {row.recent24h}
            </span>
          )}
        </div>
        <div style={barOuter}>
          <div style={{ ...barTotal, width: `${ideasPct}%` }}>
            <div style={{ ...barFinal, width: `${finalPct}%` }} />
          </div>
        </div>
        <div style={leaderBottomLine}>
          <span style={leaderStat}>
            <IdeasIcon style={{ width: 9, height: 9 }} strokeWidth={2.4} />
            {row.finalized}/{row.totalIdeas} finalized
          </span>
          {row.onBoard > 0 && (
            <span style={leaderStat}>on board · {row.onBoard}</span>
          )}
          {qualityStars != null && (
            <span
              style={leaderStat}
              title={`Avg quality ${row.avgQuality?.toFixed(2)}`}
            >
              <Star
                style={{ width: 9, height: 9, fill: "#f59e0b", color: "#f59e0b" }}
                strokeWidth={2}
              />
              {qualityStars}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
  muted = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <span style={statCol}>
      <span
        style={{
          ...statVal,
          color: accent
            ? appleVibe.accent.primary
            : muted
              ? appleVibe.text.tertiary
              : appleVibe.text.primary,
        }}
      >
        {value}
      </span>
      <span style={statLabel}>{label}</span>
    </span>
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
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px 8px",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: appleVibe.text.secondary,
  textTransform: "uppercase",
};
const liveDotInline: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: "#22C55E",
  flexShrink: 0,
  animation: "board-people-pulse 1.8s ease-in-out infinite",
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

// ── Leaderboard styles ──
const segmented: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  margin: "4px 6px 8px",
  padding: 2,
  borderRadius: 999,
  background: appleVibe.surface.chip,
};
const segBtn = (active: boolean): CSSProperties => ({
  flex: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  padding: "5px 9px",
  borderRadius: 999,
  border: "none",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.01em",
  textTransform: "uppercase",
  color: active ? appleVibe.text.onAccent : appleVibe.text.secondary,
  background: active ? appleVibe.accent.primary : "transparent",
  boxShadow: active ? "0 4px 12px -6px rgba(11,18,40,0.4)" : "none",
  transition: "background 0.15s ease, color 0.15s ease",
});
const emptyState: CSSProperties = {
  padding: "16px 10px",
  fontSize: 11.5,
  lineHeight: 1.45,
  color: appleVibe.text.tertiary,
  textAlign: "center",
  fontFamily: appleVibe.font.stack,
};
const statStrip: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: 6,
  margin: "0 6px 8px",
  padding: "8px 10px",
  borderRadius: 12,
  background: appleVibe.surface.chip,
  border: `1px solid ${appleVibe.stroke.hairline}`,
};
const statCol: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 1,
};
const statVal: CSSProperties = {
  fontSize: 16,
  fontWeight: 750,
  letterSpacing: "-0.02em",
  fontFamily: appleVibe.font.stack,
};
const statLabel: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: appleVibe.text.tertiary,
  textTransform: "uppercase",
};
const statDivider: CSSProperties = {
  width: 1,
  alignSelf: "stretch",
  background: appleVibe.stroke.hairline,
  borderRadius: 1,
};
const leaderRowOuter: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  borderRadius: 10,
  fontFamily: appleVibe.font.stack,
};
const rankNum: CSSProperties = {
  width: 14,
  textAlign: "center",
  fontSize: 11,
  fontWeight: 700,
  color: appleVibe.text.tertiary,
  flexShrink: 0,
};
const leaderTopLine: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};
const leaderName: CSSProperties = {
  flex: 1,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  minWidth: 0,
  fontSize: 12,
  fontWeight: 650,
  letterSpacing: "-0.01em",
  color: appleVibe.text.primary,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const youTag: CSSProperties = {
  padding: "0 5px",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  borderRadius: 999,
  color: appleVibe.text.onAccent,
  background: appleVibe.accent.primary,
};
const ownerTag: CSSProperties = {
  padding: "0 5px",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  borderRadius: 999,
  color: appleVibe.text.secondary,
  background: "var(--glass-border)",
};
const zapTag: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: "1px 6px 1px 4px",
  fontSize: 9.5,
  fontWeight: 700,
  borderRadius: 999,
  color: "#92400E",
  background: "#FEF3C7",
};
const barOuter: CSSProperties = {
  width: "100%",
  height: 5,
  marginTop: 4,
  borderRadius: 999,
  background: "var(--glass-border)",
  overflow: "hidden",
};
const barTotal: CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "rgba(15,23,42,0.18)",
  position: "relative",
};
const barFinal: CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: appleVibe.accent.primary,
};
const leaderBottomLine: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 4,
};
const leaderStat: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: 10,
  fontWeight: 600,
  color: appleVibe.text.tertiary,
  letterSpacing: "0.01em",
};
const browseLibraryBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  width: "calc(100% - 12px)",
  margin: "8px 6px 4px",
  padding: "7px 10px",
  borderRadius: 10,
  border: `1px solid ${appleVibe.stroke.hairline}`,
  background: "var(--glass-float-bg)",
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
  fontSize: 11.5,
  fontWeight: 650,
  letterSpacing: "-0.01em",
  cursor: "pointer",
};
