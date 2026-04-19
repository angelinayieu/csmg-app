"use client";

// Phase 35 — Reaction hover preview.
//
// A floating, Reactor-Glass popover that surfaces a reaction's guts
// without forcing the user into the lab. Anchors to any trigger element;
// opens on hover with a 120ms delay (so drifting through a list doesn't
// strobe popovers) and closes with a 140ms grace so the cursor can
// reach the popover itself.
//
// Consumed by:
//   - LabReactionNetwork rows (lab footer)
//   - KGNodeShape ReactionBadge (canvas card chips)
//
// Visual composition:
//   - Type chip (color-coded: emergent/reinforcing/tension/trivial)
//   - Title
//   - 2-line mechanism
//   - 2-line implication
//   - Participant row (initials, focal highlighted)
//   - Probability bar with tick
//
// Non-goals:
//   - Editing (Phase T4 will do delete/edit — this is read-only)
//   - Rich charts — histogram is 20px tall; deep exploration belongs
//     in the lab

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ReactorGlass } from "./reactor-glass";
import type { Entity } from "@/types";
import type { Reaction, ReactionType } from "@/types/reactions";

const REACTION_TYPE_COLOR: Record<ReactionType, string> = {
  emergent: "#4ade80",
  reinforcing: "#22d3ee",
  tension: "#f472b6",
  trivial: "#94a3b8",
};

const REACTION_TYPE_TINT: Record<
  ReactionType,
  "green" | "cyan" | "pink" | "violet"
> = {
  emergent: "green",
  reinforcing: "cyan",
  tension: "pink",
  trivial: "violet",
};

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 140;

export interface ReactionHoverPreviewProps {
  reaction: Reaction;
  /** Entities touched by this reaction. Missing rows render as stubs. */
  participants: Array<Entity | null>;
  /**
   * Entity id to highlight as "focal" in the participant row. Useful when
   * the popover is attached to a specific entity's badge so the user
   * sees which side of the reaction they're on.
   */
  focalEntityId?: string | null;
  /** Optional "open in lab" link. Bottom-right footer affordance. */
  openInLabHref?: string;
  children: ReactNode;
}

export function ReactionHoverPreview({
  reaction,
  participants,
  focalEntityId,
  openInLabHref,
  children,
}: ReactionHoverPreviewProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    placement: "top" | "bottom";
  } | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelTimers = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    cancelTimers();
    openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }, [cancelTimers]);

  const scheduleClose = useCallback(() => {
    cancelTimers();
    closeTimer.current = window.setTimeout(
      () => setOpen(false),
      CLOSE_DELAY_MS,
    );
  }, [cancelTimers]);

  useEffect(() => () => cancelTimers(), [cancelTimers]);

  // Anchor the popover above the trigger by default; flip to below if
  // there isn't enough headroom. Width is fixed at 280px for consistency.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const pop = popoverRef.current;
    if (!anchor || !pop) return;
    const aRect = anchor.getBoundingClientRect();
    const pRect = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const spaceAbove = aRect.top;
    const spaceBelow = window.innerHeight - aRect.bottom;
    const placement: "top" | "bottom" =
      spaceAbove > pRect.height + 16 || spaceAbove > spaceBelow
        ? "top"
        : "bottom";
    const top =
      placement === "top"
        ? Math.max(8, aRect.top - pRect.height - 8)
        : Math.min(window.innerHeight - pRect.height - 8, aRect.bottom + 8);
    const anchorCenter = aRect.left + aRect.width / 2;
    const left = Math.max(
      8,
      Math.min(vw - pRect.width - 8, anchorCenter - pRect.width / 2),
    );
    setCoords({ top, left, placement });
  }, [open]);

  // Close on ESC; don't break ESC for parent surfaces (lab, canvas).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={scheduleOpen}
        onBlur={scheduleClose}
        style={{ display: "contents" }}
      >
        {children}
      </span>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            role="tooltip"
            aria-label={`Reaction: ${reaction.name}`}
            onMouseEnter={cancelTimers}
            onMouseLeave={scheduleClose}
            style={{
              position: "fixed",
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              width: 280,
              zIndex: 80,
              opacity: coords ? 1 : 0,
              transition: "opacity 160ms cubic-bezier(0.25, 1, 0.5, 1)",
              pointerEvents: "auto",
            }}
          >
            <ReactorGlass
              elevation="summoned"
              tint={REACTION_TYPE_TINT[reaction.reaction_type]}
              sweep
              style={{ padding: 12 }}
            >
              <ReactionPreviewBody
                reaction={reaction}
                participants={participants}
                focalEntityId={focalEntityId}
                openInLabHref={openInLabHref}
              />
            </ReactorGlass>
          </div>,
          document.body,
        )}
    </>
  );
}

function ReactionPreviewBody({
  reaction,
  participants,
  focalEntityId,
  openInLabHref,
}: {
  reaction: Reaction;
  participants: Array<Entity | null>;
  focalEntityId?: string | null;
  openInLabHref?: string;
}) {
  const color = REACTION_TYPE_COLOR[reaction.reaction_type];
  const prob = Math.round(reaction.probability * 100);
  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      {/* Header: type chip + title */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
            borderRadius: 3,
            background: `${color}22`,
            color,
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: color,
              boxShadow: `0 0 6px ${color}`,
            }}
          />
          {reaction.reaction_type}
        </span>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#e8edf4",
            lineHeight: 1.25,
            flex: 1,
            minWidth: 0,
          }}
          title={reaction.name}
        >
          {reaction.name}
        </div>
      </div>

      {/* Mechanism (if any) */}
      {reaction.mechanism && (
        <div
          style={{
            marginTop: 8,
            fontSize: 10.5,
            lineHeight: 1.45,
            color: "#a8b3c4",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {reaction.mechanism}
        </div>
      )}

      {/* Implication (if any) */}
      {reaction.implication && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10,
            lineHeight: 1.45,
            color: "#94a3b8",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            fontStyle: "italic",
          }}
        >
          → {reaction.implication}
        </div>
      )}

      {/* Participants */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 9.5,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          letterSpacing: "0.04em",
        }}
      >
        {reaction.entity_ids.map((eid, i) => {
          const p = participants[i];
          const isFocal = focalEntityId === eid;
          const initials = p ? initialsFor(p.name) : "?";
          return (
            <span key={`${eid}-${i}`} style={{ display: "inline-flex", alignItems: "center" }}>
              <span
                style={{
                  display: "inline-grid",
                  placeItems: "center",
                  minWidth: 22,
                  height: 22,
                  padding: "0 5px",
                  borderRadius: 4,
                  background: isFocal
                    ? `${color}1a`
                    : "rgba(148, 163, 184, 0.08)",
                  border: `1px solid ${isFocal ? `${color}55` : "rgba(148, 163, 184, 0.14)"}`,
                  color: isFocal ? color : "#a8b3c4",
                  fontWeight: isFocal ? 700 : 600,
                }}
                title={p?.name ?? "(unknown entity)"}
              >
                {initials}
              </span>
              {i < reaction.entity_ids.length - 1 && (
                <span style={{ margin: "0 4px", color: "#475569" }}>+</span>
              )}
            </span>
          );
        })}
      </div>

      {/* Probability bar */}
      <div style={{ marginTop: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 3,
          }}
        >
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            Probability
          </span>
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11,
              fontWeight: 700,
              color,
            }}
          >
            {prob}%
          </span>
        </div>
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: "rgba(148, 163, 184, 0.1)",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              width: `${prob}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${color}44, ${color})`,
              boxShadow: `0 0 8px ${color}66`,
            }}
          />
        </div>
        {reaction.ci_low !== null &&
          reaction.ci_high !== null &&
          reaction.ci_low !== undefined &&
          reaction.ci_high !== undefined && (
            <div
              style={{
                marginTop: 3,
                fontSize: 8.5,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                color: "#64748b",
              }}
            >
              CI · {Math.round(reaction.ci_low * 100)}–
              {Math.round(reaction.ci_high * 100)}%
            </div>
          )}
      </div>

      {/* Footer */}
      {openInLabHref && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: "1px solid rgba(148, 163, 184, 0.08)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <a
            href={openInLabHref}
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#4ade80",
              textDecoration: "none",
            }}
          >
            Open in lab →
          </a>
        </div>
      )}
    </div>
  );
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
