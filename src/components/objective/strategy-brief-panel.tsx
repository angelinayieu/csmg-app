"use client";

// ── Strategy Brief Panel ──────────────────────────────────────────
//
// Right-edge slide-in popup that hosts <StrategyBriefView embedded>.
// Two chrome states:
//
//   • "side" (default open) — fixed right side, ~720px wide, scrolls
//     inside the panel body. The canvas behind stays interactive
//     enough that the user feels they're still on the canvas (we
//     skip the dark backdrop, like lab-notebook-panel's rail-card).
//   • "full" — maximize: panel grows to the full viewport so the
//     reading experience matches the standalone /brief route, with
//     the close button still in the top-right.
//
// Brief data is lazy-loaded via GET /api/brainstorm/space/[spaceId]/brief
// on open, so the parent page doesn't pay the compose cost unless the
// user actually opens the popup. Empty state ("Nothing to summarize
// yet") and error states render inline inside the panel body.
//
// The "Open full page" link still routes to /app/objective/[spaceId]/brief
// so the document remains deep-linkable.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink, Maximize2, Minimize2, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { StrategyBriefView } from "./strategy-brief-view";
import type { StrategyBrief } from "@/lib/objective-canvas/build-strategy-brief";

interface Props {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  /** Route to the standalone brief page (deep link). Defaults to the
   *  conventional `/app/objective/[spaceId]/brief` if omitted. */
  deepLinkHref?: string;
  /** Optional pre-loaded brief; when omitted the panel fetches on open. */
  initialBrief?: StrategyBrief | null;
  initialPolishStale?: boolean;
}

export function StrategyBriefPanel({
  open,
  onClose,
  spaceId,
  deepLinkHref,
  initialBrief = null,
  initialPolishStale = false,
}: Props) {
  const reduce = useReducedMotion();
  const [maximized, setMaximized] = useState(false);
  const [brief, setBrief] = useState<StrategyBrief | null>(initialBrief);
  const [polishStale, setPolishStale] = useState(initialPolishStale);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBrief = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/brainstorm/space/${spaceId}/brief`);
      const json = (await res.json().catch(() => ({}))) as {
        brief?: StrategyBrief;
        polishStale?: boolean;
        error?: string;
      };
      if (!res.ok || !json.brief) {
        setError(json.error ?? "Couldn't load the brief.");
        return;
      }
      setBrief(json.brief);
      setPolishStale(!!json.polishStale);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  // Load on open. We re-fetch every open so reopening after edits gets
  // fresh data — the brief is composed, not realtime.
  useEffect(() => {
    if (!open) return;
    void fetchBrief();
  }, [open, fetchBrief]);

  // Escape closes (panel is a dialog). Maximize toggles via the button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — only when maximized. In side mode the canvas
              behind stays interactive (matches lab-notebook rail-card
              feel) so the user keeps their bearings on the canvas. */}
          {maximized && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.2 }}
              onClick={onClose}
              className="fixed inset-0 z-40"
              style={{ background: "rgba(15,23,42,0.32)" }}
              aria-hidden
            />
          )}
          <motion.aside
            role="dialog"
            aria-label="Strategy Brief"
            initial={
              reduce ? { x: 0, opacity: 0 } : { x: "100%", opacity: 0.8 }
            }
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: "100%", opacity: 0 }}
            transition={{
              duration: reduce ? 0 : 0.36,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="fixed z-50 flex flex-col overflow-hidden"
            style={
              maximized
                ? {
                    inset: 0,
                    background: "#fafafa",
                    fontFamily: appleVibe.font.stack,
                  }
                : {
                    top: 16,
                    right: 16,
                    bottom: 16,
                    width: 720,
                    maxWidth: "calc(100vw - 32px)",
                    background: "#fafafa",
                    border: `1px solid ${appleVibe.stroke.hairline}`,
                    borderRadius: 20,
                    fontFamily: appleVibe.font.stack,
                    boxShadow:
                      "0 24px 64px -16px rgba(11,18,40,0.32), 0 4px 12px -4px rgba(11,18,40,0.10)",
                  }
            }
          >
            {/* Slim chrome header — minimal so the brief's own action
                bar (Copy / Polish / Print / Agent spec) shows below
                without competing chrome. */}
            <header
              className="flex items-center justify-between gap-3 px-4 py-2.5"
              style={{
                borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)",
                backdropFilter: "blur(12px)",
              }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="text-[10.5px] font-semibold uppercase"
                  style={{
                    color: appleVibe.text.tertiary,
                    letterSpacing: "0.16em",
                  }}
                >
                  Strategy Brief
                </span>
                {polishStale && (
                  <span
                    className="text-[10.5px] italic"
                    style={{ color: appleVibe.text.faint }}
                  >
                    · polish is stale
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Link
                  href={deepLinkHref ?? `/app/objective/${spaceId}/brief`}
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium"
                  style={{
                    color: appleVibe.text.tertiary,
                    border: `1px solid ${appleVibe.stroke.soft}`,
                  }}
                  title="Open standalone page"
                >
                  <ExternalLink className="h-3 w-3" strokeWidth={2} />
                  Open page
                </Link>
                <ChromeBtn
                  onClick={() => setMaximized((m) => !m)}
                  label={maximized ? "Restore" : "Full screen"}
                  icon={
                    maximized ? (
                      <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
                    ) : (
                      <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                    )
                  }
                />
                <ChromeBtn
                  onClick={onClose}
                  label="Close"
                  icon={<X className="h-3.5 w-3.5" strokeWidth={2} />}
                />
              </div>
            </header>

            {/* Body — scrollable. Hosts the brief view in embedded mode,
                or the loading / error / empty fallbacks. */}
            <div className="flex-1 overflow-y-auto">
              {loading && !brief && <PanelStatus message="Loading brief…" />}
              {!loading && error && (
                <PanelStatus
                  message={error}
                  tone="error"
                  action={{ label: "Try again", onClick: fetchBrief }}
                />
              )}
              {brief && brief.totals.rooms === 0 && (
                <PanelStatus
                  message="Nothing to summarize yet — generate at least one sub-objective room first."
                />
              )}
              {brief && brief.totals.rooms > 0 && (
                <StrategyBriefView
                  spaceId={spaceId}
                  brief={brief}
                  polishStale={polishStale}
                  embedded
                />
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Bits ─────────────────────────────────────────────────────────

function ChromeBtn({
  onClick,
  label,
  icon,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors"
      style={{
        color: appleVibe.text.tertiary,
        background: "transparent",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(15,23,42,0.06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
    </button>
  );
}

function PanelStatus({
  message,
  tone = "default",
  action,
}: {
  message: string;
  tone?: "default" | "error";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center"
      style={{
        color: tone === "error" ? "rgba(127,29,29,0.95)" : appleVibe.text.tertiary,
      }}
    >
      <p className="text-[13px] font-light leading-relaxed" style={{ maxWidth: 360 }}>
        {message}
      </p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
          style={{
            background: "rgba(15,23,42,0.06)",
            color: appleVibe.text.primary,
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
