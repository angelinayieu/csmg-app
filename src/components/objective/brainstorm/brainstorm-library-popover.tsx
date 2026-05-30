"use client";

// ── Brainstorm Library Popover ──────────────────────────────────────
//
// Phase 5 of BRAINSTORM_MODULE_SPEC.md — surfaces past pinned
// brainstorm sessions for the current space so the user can revisit
// what they explored before. Mounts as a small dropdown popover
// next to the Brainstorm button; not a full route + view yet
// (that's a Phase 5b polish if the surface gets heavy use).
//
// MVP behaviour:
//   • GET /api/brainstorm/sessions?spaceId=X&onlyPinned=true
//   • Lists newest-first; shows title + plan-intents + outcome_summary
//     + settled_at
//   • Each row currently READS (preview). Re-open into the panel is
//     deferred to Phase 5b — needs a separate panel mode that loads
//     an existing session id and skips the runner.
//
// Why a popover not a route:
//   • The library lives next to the brainstorm flow itself; the user
//     is already on the picker, doesn't need to navigate away
//   • Cheap to ship; can graduate to a full /app/library/brainstorms
//     route in Phase 5b without breaking this affordance

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, Loader2, Sparkles, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { BrainstormSession } from "@/lib/brainstorm/session-types";
import type { SubObjectiveIntent } from "@/lib/objective-canvas/sub-objective-state";

interface Props {
  spaceId: string;
  open: boolean;
  onClose: () => void;
  /** Bottom-left anchor: positioned relative to a parent that has
   *  `position: relative`. Caller mounts inside the same wrapper as
   *  the trigger button so positioning lines up. */
  anchor?: "left" | "right";
  /** Fires when the user clicks a session row. Caller (picker) sets
   *  rehydrateSession on the BrainstormPanel + opens it, jumping
   *  directly to the prior settled view. */
  onSelect?: (session: BrainstormSession) => void;
}

export function BrainstormLibraryPopover({
  spaceId,
  open,
  onClose,
  anchor = "right",
  onSelect,
}: Props) {
  const [sessions, setSessions] = useState<BrainstormSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Load when opened. Refresh on every open (cheap query, ensures
  // freshly-pinned sessions surface).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/brainstorm/sessions?spaceId=${encodeURIComponent(
            spaceId,
          )}&onlyPinned=true&limit=50`,
        );
        if (!res.ok) {
          if (!cancelled) {
            const t = await res.text();
            setError(`Couldn't load library (${res.status}): ${t.slice(0, 160)}`);
          }
          return;
        }
        const json = (await res.json()) as {
          sessions?: BrainstormSession[];
        };
        if (!cancelled) setSessions(json.sessions ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, spaceId]);

  // Click-outside to dismiss.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      onClose();
    };
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", handler);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, y: -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="absolute z-40 mt-2 flex flex-col overflow-hidden"
          style={{
            top: "100%",
            [anchor]: 0,
            width: 380,
            maxHeight: 420,
            background: appleVibe.surface.card,
            border: `1px solid ${appleVibe.stroke.hairline}`,
            borderRadius: 14,
            fontFamily: appleVibe.font.stack,
            boxShadow:
              "0 16px 40px -12px rgba(11,18,40,0.22), 0 2px 6px -1px rgba(11,18,40,0.08)",
          }}
        >
          <PopoverHeader onClose={onClose} count={sessions.length} />
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {loading && <LoadingRow />}
            {!loading && error && <ErrorRow message={error} />}
            {!loading && !error && sessions.length === 0 && (
              <EmptyRow />
            )}
            {!loading && !error && sessions.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    onSelect={
                      onSelect
                        ? () => {
                            onSelect(s);
                            onClose();
                          }
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Header ──────────────────────────────────────────────────────────

function PopoverHeader({
  onClose,
  count,
}: {
  onClose: () => void;
  count: number;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 border-b px-3 py-2"
      style={{ borderColor: appleVibe.stroke.hairline }}
    >
      <div className="flex items-center gap-1.5">
        <Bookmark
          className="h-3 w-3"
          strokeWidth={2.25}
          style={{ color: "rgba(217,119,6,0.85)" }}
        />
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Library
        </span>
        <span
          className="text-[10.5px] font-light tabular-nums"
          style={{ color: appleVibe.text.faint }}
        >
          · {count} pinned
        </span>
      </div>
      <button
        onClick={onClose}
        aria-label="Close library"
        className="rounded p-1 transition hover:bg-gray-100"
        style={{ color: appleVibe.text.tertiary }}
      >
        <X className="h-3 w-3" strokeWidth={1.75} />
      </button>
    </div>
  );
}

// ── Rows ────────────────────────────────────────────────────────────

function LoadingRow() {
  return (
    <div
      className="flex items-center justify-center gap-2 py-6 text-[11px]"
      style={{ color: appleVibe.text.tertiary }}
    >
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      Loading sessions…
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg px-2.5 py-2 text-[11px]"
      style={{ background: "rgba(254,242,242,0.7)", color: "rgba(127,29,29,0.95)" }}
    >
      {message}
    </div>
  );
}

function EmptyRow() {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
      <Sparkles
        className="h-4 w-4"
        strokeWidth={1.75}
        style={{ color: appleVibe.text.faint }}
      />
      <span
        className="text-[11.5px] font-light leading-snug"
        style={{ color: appleVibe.text.tertiary }}
      >
        No pinned sessions yet.
        <br />
        Pin a brainstorm session to save it here.
      </span>
    </div>
  );
}

function SessionRow({
  session,
  onSelect,
}: {
  session: BrainstormSession;
  onSelect?: () => void;
}) {
  const plan = session.plan as
    | { intents?: SubObjectiveIntent[] }
    | Record<string, never>;
  const intents = Array.isArray(plan?.intents) ? plan.intents : [];
  const ts = session.settled_at ?? session.started_at;
  return (
    <li
      onClick={onSelect}
      className={`rounded-lg border px-2.5 py-2 transition hover:border-slate-300 ${
        onSelect ? "cursor-pointer hover:bg-slate-50" : "cursor-default"
      }`}
      style={{
        borderColor: appleVibe.stroke.hairline,
        background: "rgba(255,255,255,0.7)",
      }}
      title={onSelect ? "Re-open this session" : session.id}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[12px] font-semibold leading-snug"
            style={{ color: appleVibe.text.primary }}
          >
            {session.title ?? "Untitled brainstorm"}
          </div>
          {session.outcome_summary && (
            <div
              className="mt-0.5 truncate text-[10.5px] leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              {session.outcome_summary}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {intents.map((i) => (
              <span
                key={i}
                className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                style={{
                  background: intentColor(i),
                  color: "white",
                }}
              >
                {i}
              </span>
            ))}
          </div>
        </div>
        <span
          className="flex-shrink-0 text-[9.5px] tabular-nums"
          style={{ color: appleVibe.text.faint }}
        >
          {formatRelative(ts)}
        </span>
      </div>
    </li>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function intentColor(intent: SubObjectiveIntent): string {
  switch (intent) {
    case "creative":
      return "rgba(59,130,246,0.85)";
    case "concrete":
      return "rgba(20,184,166,0.85)";
    case "contrarian":
      return "rgba(168,85,247,0.85)";
    case "gap_fill":
      return "rgba(217,119,6,0.85)";
    case "ambitious":
      return "rgba(220,38,38,0.8)";
    case "wildcard":
      return "rgba(236,72,153,0.85)";
    default:
      return "rgba(100,116,139,0.8)";
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const ms = Date.now() - then;
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.round(day / 7);
  if (wk < 4) return `${wk}w`;
  const mo = Math.round(day / 30);
  return `${mo}mo`;
}
