"use client";

// ── BoardNavBar ──
//
// One consolidated nav — a single white pill in the top-right corner with
// icon-only triggers (Home · Goal · History · Settings), replacing the old
// stack of four labelled glass pills on the left. Home navigates; the other
// three dispatch open-events their (now pill-less) launcher panels listen for.
// Icons + tooltips only, per the minimal chrome direction.

import { type CSSProperties } from "react";
import { Home, Plus, Compass, History, Settings } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { OPEN_BOARD_GOAL_EVENT } from "./goal-ranking-sidebar";
import { OPEN_BOARD_HISTORY_EVENT } from "./board-history";
import { OPEN_BOARD_SETTINGS_EVENT } from "./board-settings";

const fire = (name: string) =>
  window.dispatchEvent(new CustomEvent(name));

/** Spin up a fresh, isolated scratch space + navigate to it. */
async function createSandbox() {
  try {
    const r = await fetch("/api/objective/sandbox", { method: "POST" });
    if (!r.ok) return;
    const { spaceId } = (await r.json()) as { spaceId?: string };
    if (spaceId) window.location.assign(`/app/objective/${spaceId}`);
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
  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={bar}>
      {ITEMS.map(({ key, label, Icon, onClick }) => (
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
