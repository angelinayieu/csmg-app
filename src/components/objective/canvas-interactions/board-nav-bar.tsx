"use client";

// ── BoardNavBar ──
//
// One consolidated nav — a single white pill in the top-right corner with
// icon-only triggers (Home · Goal · History · Settings), replacing the old
// stack of four labelled glass pills on the left. Home navigates; the other
// three dispatch open-events their (now pill-less) launcher panels listen for.
// Icons + tooltips only, per the minimal chrome direction.

import { type CSSProperties, useSyncExternalStore } from "react";
import { Home, Plus, Compass, History, Settings } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { openSandbox } from "@/lib/objective-canvas/sandbox-signal";
import { OPEN_BOARD_GOAL_EVENT } from "./goal-ranking-sidebar";
import { OPEN_BOARD_HISTORY_EVENT } from "./board-history";
import { OPEN_BOARD_SETTINGS_EVENT } from "./board-settings";

const fire = (name: string) =>
  window.dispatchEvent(new CustomEvent(name));

/** The objective this board belongs to, parsed from the URL — so the nav
 *  bar stays prop-free (and we never touch the collision-hot whiteboard-base). */
function currentObjectiveId(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.pathname.match(/\/app\/objective\/([^/]+)/);
  return m ? m[1] : null;
}

/** Find-or-create THE sandbox for the current objective and pop it open in
 *  place as a floating, isolated sub-whiteboard. No navigation and no library
 *  card — the sandbox is a hidden child space surfaced only via the panel. */
async function createSandbox() {
  const parentSpaceId = currentObjectiveId();
  if (!parentSpaceId) return;
  try {
    const r = await fetch("/api/objective/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentSpaceId }),
    });
    if (!r.ok) return;
    const { spaceId } = (await r.json()) as { spaceId?: string };
    if (spaceId) openSandbox({ sandboxId: spaceId, parentSpaceId });
  } catch {
    /* ignore — soft-fail */
  }
}

const ITEMS: {
  key: string;
  label: string;
  Icon: typeof Home;
  onClick: () => void;
}[] = [
  { key: "home", label: "Home", Icon: Home, onClick: () => window.location.assign("/app") },
  { key: "sandbox", label: "New sandbox space", Icon: Plus, onClick: createSandbox },
  { key: "goal", label: "Goal & alignment", Icon: Compass, onClick: () => fire(OPEN_BOARD_GOAL_EVENT) },
  { key: "history", label: "Version history", Icon: History, onClick: () => fire(OPEN_BOARD_HISTORY_EVENT) },
  { key: "settings", label: "Settings", Icon: Settings, onClick: () => fire(OPEN_BOARD_SETTINGS_EVENT) },
];

export function BoardNavBar() {
  // Embedded mode (the sandbox iframe, `?embed=1`) drops Home + New-Sandbox —
  // there's no "home" inside a sandbox, and a sandbox can't spawn a sandbox.
  // Read the client-only `?embed=1` flag with a stable `false` server snapshot
  // — no hydration mismatch, no setState-in-effect. (Same primitive as
  // board-panel-signal.) The flag is fixed for the iframe's lifetime, so no
  // live subscription is needed.
  const embed = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("embed") === "1",
    () => false,
  );
  const items = embed
    ? ITEMS.filter((i) => i.key !== "home" && i.key !== "sandbox")
    : ITEMS;

  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={bar}>
      {items.map(({ key, label, Icon, onClick }) => (
        <button
          key={key}
          type="button"
          title={label}
          aria-label={label}
          onClick={onClick}
          style={iconBtn}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = appleVibe.surface.chip;
            e.currentTarget.style.color = appleVibe.text.primary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = appleVibe.text.secondary;
          }}
        >
          <Icon style={{ width: 16, height: 16 }} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}

// ── styles ──
const bar: CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  zIndex: 70,
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: 4,
  borderRadius: 999,
  // Frosted glass — matches every other floating pill (page tabs, AI,
  // Library, Powerups) so the chrome reads as one material, not a solid
  // white outlier in a sea of glass.
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  border: "1px solid var(--glass-border)",
  boxShadow:
    "inset 0 1px 0 var(--glass-highlight), 0 12px 30px -16px rgba(11,18,40,0.32)",
  fontFamily: appleVibe.font.stack,
};
const iconBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  borderRadius: 999,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: appleVibe.text.secondary,
  transition: "background 0.15s ease, color 0.15s ease",
};
