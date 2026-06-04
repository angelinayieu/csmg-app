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

/** anchor = the selection's bounding box in SCREEN coords. */
export function ConvergeDivergePopup({
  anchor,
  onRun,
}: {
  anchor: { left: number; right: number; midY: number };
  onRun: (
    opId: string,
    temperature: number,
  ) => Promise<{ count: number }> | void;
}) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  // Sit beside the selection; flip to its left if the right would overflow.
  const flip = anchor.right + GAP + EXPANDED > vw - 12;
  const left = flip
    ? Math.max(12, anchor.left - GAP - EXPANDED)
    : anchor.right + GAP;
  const top = Math.max(12, anchor.midY - STACK_H / 2);

  const [ran, setRan] = useState<Direction | null>(null);
  // Brief per-verb "came back empty" flag so a 0-result run gives feedback
  // instead of silently doing nothing — the root of the "converge doesn't work
  // for connection" report (the converge prompt can yield 0 decision nodes on a
  // thin connection card, and the result was being swallowed with no signal).
  const [empty, setEmpty] = useState<Direction | null>(null);
  async function run(dir: Direction) {
    if (ran) return;
    setRan(dir);
    setEmpty(null);
    try {
      const res = await Promise.resolve(
        onRun(
          opIdForDirection(dir, getDirectionEngine()),
          getAiSettings().temperature,
        ),
      );
      if (res && res.count === 0) {
        setEmpty(dir);
        window.setTimeout(() => setEmpty((c) => (c === dir ? null : c)), 2600);
      }
    } catch {
      // executeCardOperation soft-fails internally; treat a throw as empty too.
      setEmpty(dir);
      window.setTimeout(() => setEmpty((c) => (c === dir ? null : c)), 2600);
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
        empty={empty === "diverge"}
        flip={flip}
        onClick={() => run("diverge")}
      />
      <Verb
        dir="converge"
        label="Converge"
        Icon={ChevronRight}
        busy={ran === "converge"}
        empty={empty === "converge"}
        flip={flip}
        onClick={() => run("converge")}
      />
    </div>
  );
}

function Verb({
  label,
  Icon,
  busy,
  empty,
  flip,
  onClick,
}: {
  dir: Direction;
  label: string;
  Icon: typeof ChevronLeft;
  busy: boolean;
  empty: boolean;
  flip: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const expanded = hover || busy || empty;
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
        width: empty ? 150 : expanded ? EXPANDED : COLLAPSED,
        padding: "0 12px",
        borderRadius: 999,
        border: "1px solid var(--glass-border)",
        cursor: "pointer",
        overflow: "hidden",
        color: empty ? "#B45309" : appleVibe.text.primary,
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
        ) : empty ? (
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
        {empty ? "Empty — retry" : label}
      </span>
    </button>
  );
}
