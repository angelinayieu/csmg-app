"use client";

// ── Canvas mode chip ───────────────────────────────────────────────────
//
// Tiny pill in the canvas top-bar communicating which output-shape
// mode the space is running in (the user picked it during intake via
// the Apps + Lab toggles in the home chatbox; persisted to
// space.reasoning_settings).
//
// Modes (priority order — most expansive label wins):
//   • Plan + Apps + Lab  → both flags on (full pipeline; experiments
//                          run; leaderboard populates)
//   • Plan + Apps        → generateApps on, runLab off (apps but no
//                          variant simulations)
//   • Plan-only          → both off (default; PRD/strategy is the
//                          terminal artifact)
//
// Click → toggles the mode forward (Plan-only → Plan+Apps →
// Plan+Apps+Lab → Plan-only). PATCHes
// /api/spaces/[id]/reasoning-mode with the new flags.
//
// Visual: a small chip matching the canvas-topbar nav chips' visual
// language (rounded-md, ~10.5px font, gray default with accent on
// active modes).

import { useCallback, useEffect, useState } from "react";
import { FileText, Zap, FlaskConical } from "lucide-react";

interface ReasoningSettingsLite {
  generateApps?: boolean;
  runLab?: boolean;
}

interface SpaceFetchResult {
  reasoning_settings?: ReasoningSettingsLite;
}

type Mode = "plan" | "plan-apps" | "plan-apps-lab";

function modeFromFlags(generateApps: boolean, runLab: boolean): Mode {
  if (generateApps && runLab) return "plan-apps-lab";
  if (generateApps) return "plan-apps";
  return "plan";
}

function nextMode(mode: Mode): Mode {
  if (mode === "plan") return "plan-apps";
  if (mode === "plan-apps") return "plan-apps-lab";
  return "plan";
}

function flagsForMode(mode: Mode): { generateApps: boolean; runLab: boolean } {
  if (mode === "plan-apps-lab") return { generateApps: true, runLab: true };
  if (mode === "plan-apps") return { generateApps: true, runLab: false };
  return { generateApps: false, runLab: false };
}

const MODE_META: Record<
  Mode,
  { label: string; tooltip: string; accent: string; icon: typeof FileText }
> = {
  plan: {
    label: "Plan-only",
    tooltip:
      "Plan-only mode — strategy + PRD are the terminal artifacts. Click to enable Apps.",
    accent: "#475569",
    icon: FileText,
  },
  "plan-apps": {
    label: "Plan + Apps",
    tooltip:
      "Plan + Apps — strategy materializes apps post-approval. Click to enable Lab simulations.",
    accent: "#7c3aed",
    icon: Zap,
  },
  "plan-apps-lab": {
    label: "Plan + Apps + Lab",
    tooltip:
      "Plan + Apps + Lab — full pipeline; variants score; leaderboard populates. Click to return to Plan-only.",
    accent: "#d97706",
    icon: FlaskConical,
  },
};

export function CanvasModeChip({ spaceId }: { spaceId: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [updating, setUpdating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/spaces/${spaceId}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = (await r.json()) as SpaceFetchResult;
      const settings = data.reasoning_settings ?? {};
      setMode(modeFromFlags(settings.generateApps === true, settings.runLab === true));
    } catch {
      /* silent — chip just stays in last-known state */
    }
  }, [spaceId]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const cycleMode = useCallback(async () => {
    if (mode == null || updating) return;
    const target = nextMode(mode);
    const flags = flagsForMode(target);
    setMode(target); // optimistic
    setUpdating(true);
    try {
      const r = await fetch(`/api/spaces/${spaceId}/reasoning-mode`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(flags),
      });
      if (!r.ok) {
        // Revert on failure.
        await refresh();
      }
    } catch {
      await refresh();
    } finally {
      setUpdating(false);
    }
  }, [mode, updating, spaceId, refresh]);

  if (mode == null) return null; // first fetch in flight

  const meta = MODE_META[mode];
  const Icon = meta.icon;

  return (
    <button
      type="button"
      onClick={cycleMode}
      disabled={updating}
      title={meta.tooltip}
      className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-semibold transition disabled:opacity-60"
      style={{
        color: meta.accent,
        background: `${meta.accent}10`,
        border: `1px solid ${meta.accent}33`,
      }}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </button>
  );
}
