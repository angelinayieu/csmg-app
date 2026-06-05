"use client";

// ── ConvergeDivergePopup ──
//
// The minimal contextual popup that replaces the old crammed AI scanner. Just
// two circular verbs — Diverge / Converge — shown BESIDE the selection (never
// over the text), for a single card OR a lasso/multi-selection. Each verb is a
// round icon that expands to reveal its label only on hover. Everything else
// (the full op list, Forge, settings) lives in the persistent Powerups rail.
//
// Runs via the same path as before: onRun(opId, temperature) →
// executeCardOperation in WhiteboardBase. The op id is resolved through the
// converge/diverge engine toggle; temperature comes from the shared settings.

import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  opIdForDirection,
  getDirectionEngine,
  type Direction,
} from "@/lib/objective-canvas/converge-diverge";
import { getAiSettings } from "@/lib/objective-canvas/ai-settings";

const GAP = 14;
const COLLAPSED = 40; // circular button diameter
const EXPANDED = 132; // width once hovered (icon + label)
const STACK_H = COLLAPSED * 2 + 8;

/** Why a verb produced no cards — drives the honest retry pill. "empty" = the
 *  model genuinely returned nothing; "credits" = the USER's app balance is out;
 *  "provider" = the LLM provider key is dry (NOT the user's fault — must not say
 *  "Out of credits" when they have a full balance); "error" = a transient
 *  request failure worth retrying. These used to ALL read as a misleading
 *  "Empty" / "Out of credits". */
type VerbStatus = "empty" | "error" | "credits" | "provider";

/** anchor = the selection's bounding box in SCREEN coords. */
export function ConvergeDivergePopup({
  anchor,
  onRun,
}: {
  anchor: { left: number; right: number; midY: number };
  onRun: (
    opId: string,
    temperature: number,
  ) => Promise<{ count: number; error?: string }> | void;
}) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  // Sit beside the selection; flip to its left if the right would overflow.
  const flip = anchor.right + GAP + EXPANDED > vw - 12;
  const left = flip
    ? Math.max(12, anchor.left - GAP - EXPANDED)
    : anchor.right + GAP;
  const top = Math.max(12, anchor.midY - STACK_H / 2);

  const [ran, setRan] = useState<Direction | null>(null);
  // Per-verb feedback when a run lands no cards, so it never silently does
  // nothing — the root of the "diverge doesn't work, just goes empty" report.
  // We now separate a genuine empty result from a failed request (the request
  // was failing silently and reading as "Empty", which looked like diverge was
  // broken) so the user knows when a retry is actually worthwhile.
  const [outcome, setOutcome] = useState<{
    dir: Direction;
    status: VerbStatus;
  } | null>(null);
  function flash(dir: Direction, status: VerbStatus) {
    setOutcome({ dir, status });
    window.setTimeout(
      () => setOutcome((c) => (c?.dir === dir ? null : c)),
      3200,
    );
  }
  async function run(dir: Direction) {
    if (ran) return;
    setRan(dir);
    setOutcome(null);
    try {
      const res = await Promise.resolve(
        onRun(
          opIdForDirection(dir, getDirectionEngine()),
          getAiSettings().temperature,
        ),
      );
      if (res && res.count === 0) {
        flash(
          dir,
          res.error === "credits"
            ? "credits"
            : res.error === "provider"
              ? "provider"
              : res.error
                ? "error"
                : "empty",
        );
      }
    } catch {
      // executeCardOperation catches transport errors internally, but treat any
      // unexpected throw as a failed run (retry-worthy), not a genuine empty.
      flash(dir, "error");
    } finally {
      setRan((c) => (c === dir ? null : c));
    }
  }

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left,
        top,
        zIndex: 70,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: flip ? "flex-end" : "flex-start",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <Verb
        dir="diverge"
        label="Diverge"
        Icon={ChevronLeft}
        busy={ran === "diverge"}
        status={outcome?.dir === "diverge" ? outcome.status : null}
        flip={flip}
        onClick={() => run("diverge")}
      />
      <Verb
        dir="converge"
        label="Converge"
        Icon={ChevronRight}
        busy={ran === "converge"}
        status={outcome?.dir === "converge" ? outcome.status : null}
        flip={flip}
        onClick={() => run("converge")}
      />
    </div>
  );
}

/** Pill copy + accent per non-empty outcome. */
const STATUS_COPY: Record<VerbStatus, { text: string; color: string; width: number }> = {
  empty: { text: "Empty — retry", color: "#B45309", width: 150 },
  error: { text: "Couldn't run — retry", color: "#B91C1C", width: 188 },
  credits: { text: "Out of credits", color: "#B91C1C", width: 150 },
  // The LLM PROVIDER is unavailable (both provider keys dry) — explicitly NOT
  // the user's app credits, so it never says "Out of credits".
  provider: { text: "AI unavailable — retry", color: "#B91C1C", width: 196 },
};

function Verb({
  label,
  Icon,
  busy,
  status,
  flip,
  onClick,
}: {
  dir: Direction;
  label: string;
  Icon: typeof ChevronLeft;
  busy: boolean;
  status: VerbStatus | null;
  flip: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const copy = status ? STATUS_COPY[status] : null;
  const expanded = hover || busy || !!status;
  return (
    <button
      type="button"
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: flip ? "flex-end" : "flex-start",
        gap: 8,
        height: COLLAPSED,
        width: copy ? copy.width : expanded ? EXPANDED : COLLAPSED,
        padding: "0 12px",
        borderRadius: 999,
        border: "1px solid var(--glass-border)",
        cursor: "pointer",
        overflow: "hidden",
        color: copy ? copy.color : appleVibe.text.primary,
        background: "var(--glass-float-bg)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 14px 34px -16px rgba(11,18,40,0.34)",
        transition: "width var(--dur-normal, 220ms) var(--ease-spring-soft, ease-out)",
      }}
    >
      <span style={{ display: "inline-flex", flexShrink: 0 }}>
        {busy ? (
          <Loader2 className="animate-spin" style={{ width: 17, height: 17 }} />
        ) : copy ? (
          <RotateCcw style={{ width: 16, height: 16 }} strokeWidth={2.4} />
        ) : (
          <Icon style={{ width: 18, height: 18 }} strokeWidth={2.4} />
        )}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 650,
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          opacity: expanded ? 1 : 0,
          transition: "opacity var(--dur-quick, 140ms) ease-out",
        }}
      >
        {copy ? copy.text : label}
      </span>
    </button>
  );
}
