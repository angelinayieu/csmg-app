"use client";

// PipelineModePicker — Phase 7b.
//
// Three-chip toggle controlling how aggressively the chain pipelines
// commit AI outputs to the KG:
//
//   ◉ Autopilot   — auto-commit every stage (current/default behavior)
//   ◐ Review each — open a candidate drawer after each stage (Phase 7c)
//   ◌ Manual      — no chain pipelines fire; user assembles by hand
//
// Lives in the top-left of triple-lab, visually adjacent to (but
// distinct from) the FocusModePicker — they're related affordances
// but answer different questions:
//
//   FocusModePicker     answers "how do I see the lab?"      (layout)
//   PipelineModePicker  answers "how aggressively does AI commit?" (behavior)
//
// Persistence strategy:
//   - DB column `spaces.pipeline_mode` is the source of truth
//   - localStorage is a fast-path mirror for instant first paint
//   - On mount: render localStorage value immediately, then GET to
//     reconcile. If they disagree, DB wins.
//   - On click: optimistic local update, then PATCH. Roll back if it
//     fails.

import { useCallback, useEffect, useState } from "react";
import { colors, tracking } from "./tokens";

export type PipelineMode = "autopilot" | "review_each" | "manual";

const STORAGE_KEY_PREFIX = "triple-lab:pipeline-mode:";

interface ChipDef {
  mode: PipelineMode;
  label: string;
  glyph: string;
  title: string;
}

const CHIPS: readonly ChipDef[] = [
  {
    mode: "autopilot",
    label: "Autopilot",
    glyph: "◉",
    title: "Chain stages auto-commit. Fastest path; AI drives.",
  },
  {
    mode: "review_each",
    label: "Review",
    glyph: "◐",
    title:
      "Each chain stage opens a candidate drawer. You pick what commits.",
  },
  {
    mode: "manual",
    label: "Manual",
    glyph: "◌",
    title:
      "No chain pipelines fire. You assemble the whiteboard by hand.",
  },
] as const;

function loadCached(spaceId: string): PipelineMode {
  if (typeof window === "undefined") return "autopilot";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + spaceId);
    if (raw === "autopilot" || raw === "review_each" || raw === "manual") {
      return raw;
    }
  } catch {
    // ignore
  }
  return "autopilot";
}

function saveCached(spaceId: string, mode: PipelineMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + spaceId, mode);
  } catch {
    // ignore (private browsing, quota, etc.)
  }
}

interface PipelineModePickerProps {
  spaceId: string;
  /** Optional callback fires whenever the mode changes (locally OR
   *  from the GET reconciliation). Lets the parent gate behavior —
   *  e.g., disable auto-extract when mode === "manual". */
  onChange?: (mode: PipelineMode) => void;
}

export function PipelineModePicker({
  spaceId,
  onChange,
}: PipelineModePickerProps) {
  // Hydrate from localStorage first so first paint shows the user's
  // chosen mode without waiting for the network. Reconcile from the
  // DB once the GET resolves.
  const [mode, setModeRaw] = useState<PipelineMode>(() => loadCached(spaceId));
  // Disable interaction while a PATCH is in flight so a fast clicker
  // can't fire 3 conflicting writes in 200ms.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reconcile from DB on mount + whenever spaceId changes. We don't
  // fire onChange on the initial reconcile if the value matches what
  // we already have — only on actual deltas.
  useEffect(() => {
    let cancelled = false;
    const fetchMode = async () => {
      try {
        const res = await fetch(`/api/spaces/${spaceId}/pipeline-mode`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { pipeline_mode?: PipelineMode };
        const dbMode = body.pipeline_mode;
        if (
          (dbMode === "autopilot" ||
            dbMode === "review_each" ||
            dbMode === "manual") &&
          !cancelled
        ) {
          setModeRaw((prev) => {
            if (prev === dbMode) return prev;
            saveCached(spaceId, dbMode);
            onChange?.(dbMode);
            return dbMode;
          });
        }
      } catch {
        // Soft-fail — the cached value remains the displayed mode.
        // No banner; the picker is a quality-of-life control, not a
        // critical path.
      }
    };
    void fetchMode();
    return () => {
      cancelled = true;
    };
  }, [spaceId, onChange]);

  const pickMode = useCallback(
    async (next: PipelineMode) => {
      if (next === mode || busy) return;
      setBusy(true);
      setError(null);
      // Optimistic local update so the chip lights up instantly.
      const previous = mode;
      setModeRaw(next);
      saveCached(spaceId, next);
      onChange?.(next);
      try {
        const res = await fetch(`/api/spaces/${spaceId}/pipeline-mode`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipeline_mode: next }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        // Roll back on failure so the UI doesn't lie to the user.
        setModeRaw(previous);
        saveCached(spaceId, previous);
        onChange?.(previous);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [mode, busy, spaceId, onChange],
  );

  return (
    <div className="flex flex-col items-stretch gap-0.5">
      <div
        className="flex items-center gap-0.5 rounded-full p-0.5 shadow-sm"
        style={{
          background: "rgba(255, 255, 255, 0.88)",
          border: `1px solid ${colors.neutral.borderFaint}`,
          backdropFilter: "blur(8px)",
          opacity: busy ? 0.7 : 1,
          transition: "opacity 160ms ease",
        }}
        // Eyebrow above the group so the user knows what this picker
        // controls, distinct from the adjacent FocusModePicker.
        aria-label="Pipeline mode"
      >
        {CHIPS.map((chip) => (
          <ModeChip
            key={chip.mode}
            chip={chip}
            active={chip.mode === mode}
            onClick={() => void pickMode(chip.mode)}
          />
        ))}
      </div>
      {/* Error toast — tiny, only renders on failure. No fixed slot
       *  so the picker stays compact in the common case. */}
      {error && (
        <div
          className="rounded-md px-2 py-1 text-[9px] font-semibold"
          style={{
            background: colors.state.bottleneckSoft,
            color: colors.state.bottleneckFgChip,
            letterSpacing: tracking.eyebrowTight,
          }}
          title={error}
        >
          ⚠ Mode change failed — using local fallback
        </div>
      )}
    </div>
  );
}

function ModeChip({
  chip,
  active,
  onClick,
}: {
  chip: ChipDef;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={chip.title}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all"
      style={{
        background: active ? colors.brand.gradient : "transparent",
        color: active ? "white" : "rgb(71, 85, 105)",
        boxShadow: active ? `0 3px 8px ${colors.brand.shadow}` : "none",
      }}
    >
      <span className="font-mono text-[11px] leading-none">{chip.glyph}</span>
      {chip.label}
    </button>
  );
}
