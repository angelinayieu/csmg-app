"use client";

// ── Sticky Research UI (Phase 2D) ──
//
// Attached research affordances for sticky notes when the
// brainstorm `deepSearch` toggle is on. Two surfaces:
//
//   StickyResearchTrigger — small circular button in the sticky's
//     bottom-right corner. Only visible when the sticky has enough
//     text to search. Click fires `/api/canvas/card-web-search`.
//
//   StickyResearchChips — compact source chips appearing below the
//     sticky's text when research results exist. Each chip shows
//     favicon (via Google S2) + domain + title; clicking opens the
//     source in a new tab.
//
// Both components are pure presentation — the state machine lives
// in the sticky shape's renderer so it survives tldraw's shape
// lifecycle cleanly.

import { ExternalLink, Loader2, Search, Sparkles } from "lucide-react";
import type { CardWebSearchResult } from "@/app/api/canvas/card-web-search/route";

export type ResearchStatus = "idle" | "running" | "done" | "error";

export interface ResearchState {
  status: ResearchStatus;
  /** The sticky text the current results were fetched for. When
   *  text diverges from this, state should invalidate. */
  forText: string | null;
  results: CardWebSearchResult[];
  summary: string | null;
  error: string | null;
}

export const INITIAL_RESEARCH_STATE: ResearchState = {
  status: "idle",
  forText: null,
  results: [],
  summary: null,
  error: null,
};

const MIN_TEXT_FOR_SEARCH = 10;

// ── Trigger button ─────────────────────────────────────────────────

export function StickyResearchTrigger({
  stickyText,
  status,
  onTrigger,
  accent = "#8B5CF6",
}: {
  stickyText: string;
  status: ResearchStatus;
  onTrigger: () => void;
  accent?: string;
}) {
  const canSearch = stickyText.trim().length >= MIN_TEXT_FOR_SEARCH;
  if (!canSearch && status === "idle") return null;

  const running = status === "running";
  const errored = status === "error";

  return (
    <button
      onClick={onTrigger}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={running || !canSearch}
      title={
        running
          ? "Searching the web…"
          : errored
            ? "Search failed — click to retry"
            : status === "done"
              ? "Re-run search"
              : "Search the web for context"
      }
      style={{
        position: "absolute",
        bottom: 8,
        right: 8,
        width: 26,
        height: 26,
        borderRadius: 13,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: errored
          ? "rgba(239, 68, 68, 0.12)"
          : running
            ? `color-mix(in srgb, ${accent} 16%, transparent)`
            : "rgba(255, 255, 255, 0.72)",
        border: `1px solid ${errored ? "rgba(239,68,68,0.35)" : "rgba(15,23,42,0.1)"}`,
        boxShadow:
          running && !errored
            ? `0 0 0 4px color-mix(in srgb, ${accent} 8%, transparent)`
            : "0 1px 2px rgba(15,23,42,0.06)",
        color: errored ? "#dc2626" : running ? accent : "#475569",
        cursor: running || !canSearch ? "default" : "pointer",
        transition: "all 180ms ease",
      }}
    >
      {running ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      ) : status === "done" ? (
        <Sparkles className="h-3 w-3" strokeWidth={1.75} />
      ) : (
        <Search className="h-3 w-3" strokeWidth={1.75} />
      )}
    </button>
  );
}

// ── Result chips ───────────────────────────────────────────────────

export function StickyResearchChips({
  state,
  accent = "#8B5CF6",
  maxVisible = 3,
}: {
  state: ResearchState;
  accent?: string;
  maxVisible?: number;
}) {
  // Render nothing in idle state. Every other status (running,
  // done, error) shows at least a summary line or error message.
  if (state.status === "idle") return null;
  // Done with nothing to show (no results + no summary) — quietly
  // collapse the panel.
  if (
    state.status === "done" &&
    state.results.length === 0 &&
    !state.summary
  ) {
    return null;
  }

  const visible = state.results.slice(0, maxVisible);
  const overflow = state.results.length - visible.length;

  return (
    <div
      style={{
        marginTop: 8,
        paddingTop: 8,
        borderTop: "1px solid rgba(15,23,42,0.08)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Summary line when available */}
      {state.summary && state.status === "done" && (
        <div
          style={{
            fontSize: 10,
            fontStyle: "italic",
            lineHeight: 1.4,
            color: "rgba(15,23,42,0.65)",
            marginBottom: 2,
          }}
        >
          {state.summary}
        </div>
      )}

      {/* Running state placeholder */}
      {state.status === "running" && visible.length === 0 && (
        <div
          style={{
            fontSize: 10,
            color: "rgba(15,23,42,0.45)",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2} />
          Searching 2–4 sources…
        </div>
      )}

      {/* Source chips */}
      {visible.map((r) => (
        <a
          key={r.url}
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 6px",
            borderRadius: 6,
            background: `color-mix(in srgb, ${accent} 6%, transparent)`,
            border: `1px solid color-mix(in srgb, ${accent} 14%, transparent)`,
            textDecoration: "none",
            color: "inherit",
            transition: "background 150ms ease",
          }}
          title={r.snippet || r.title}
        >
          {r.domain && (
            <img
              src={`https://www.google.com/s2/favicons?domain=${r.domain}&sz=32`}
              alt=""
              width={12}
              height={12}
              style={{ borderRadius: 2, flexShrink: 0 }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 10,
              fontWeight: 500,
              color: "rgba(15,23,42,0.8)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.title}
          </span>
          <ExternalLink
            className="h-2.5 w-2.5 flex-shrink-0"
            strokeWidth={2}
            style={{ color: accent, opacity: 0.7 }}
          />
        </a>
      ))}

      {overflow > 0 && (
        <div
          style={{
            fontSize: 9.5,
            color: "rgba(15,23,42,0.45)",
            paddingLeft: 6,
          }}
        >
          +{overflow} more source{overflow === 1 ? "" : "s"}
        </div>
      )}

      {/* Error fallback */}
      {state.status === "error" && (
        <div
          style={{
            fontSize: 9.5,
            color: "#dc2626",
            padding: "2px 6px",
          }}
        >
          {state.error ?? "Search failed"}
        </div>
      )}
    </div>
  );
}
