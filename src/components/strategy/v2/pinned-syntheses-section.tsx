"use client";

// ── Pinned syntheses section ───────────────────────────────────────────
//
// Surfaces summaries the user pinned from canvas SummaryCard shapes
// (the 📌 button on the AI Summary card chrome). Each pin is the
// frozen snapshot of the synthesis at pin-time, so this list survives:
//   • shape deletion on canvas
//   • space reload
//   • new strategy regeneration
//
// Lives near the top of the Strategy drawer (between version history
// and the strategy hero) so newly-pinned syntheses are immediately
// visible. Self-hides when there are zero pins. Refresh-on-mount + on
// window focus so opening the drawer after pinning a new card sees
// the fresh state without a hard reload.
//
// Server contract:
//   GET    /api/spaces/[id]/pin-summary           → { pins: PinnedSummary[] }
//   DELETE /api/spaces/[id]/pin-summary?summaryId=X
//
// Open-on-canvas affordance dispatches a `summary-card:focus` window
// event with { summaryId }; the canvas listens and zooms to the
// matching shape if it still exists.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pin, ChevronDown, ChevronUp, Loader2, X, ExternalLink, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/hooks/use-toast";
import { useDrawerState } from "@/components/canvas/drawers/use-drawer-state";

interface PinnedSummary {
  summaryId: string;
  title: string;
  body: string;
  sourceCount: number;
  sourceLabel: string;
  generatedAt: string;
  pinnedAt: string;
}

interface Props {
  spaceId: string;
  /** Optional callback fired when a pin's "Open on canvas" button is
   *  clicked. Lets the parent close the drawer + delegate the
   *  zoom-to-shape navigation. When omitted the component falls back
   *  to dispatching the `summary-card:focus` window event. */
  onOpenOnCanvas?: (summaryId: string) => void;
  /** Defaults true. Pass false to keep the section permanently
   *  expanded (e.g. embedded in a dedicated drawer page). */
  collapsibleHeader?: boolean;
}

export function PinnedSynthesesSection({
  spaceId,
  onOpenOnCanvas,
  collapsibleHeader = true,
}: Props) {
  const drawerState = useDrawerState();
  const [pins, setPins] = useState<PinnedSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [unpinningId, setUnpinningId] = useState<string | null>(null);
  // Accordion: which pin's body is fully expanded (Read more).
  const [openBodyId, setOpenBodyId] = useState<string | null>(null);

  // Avoid leaking state from stale fetches (drawer rapidly opened/closed).
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const refresh = useCallback(async () => {
    cancelRef.current = { cancelled: false };
    const tag = cancelRef.current;
    setLoading(true);
    try {
      const r = await fetch(`/api/spaces/${spaceId}/pin-summary`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { pins: PinnedSummary[] };
      if (tag.cancelled) return;
      setPins(Array.isArray(data.pins) ? data.pins : []);
    } catch (err) {
      if (!tag.cancelled) {
        console.warn("[pinned-syntheses] fetch failed:", err);
        setPins([]);
      }
    } finally {
      if (!tag.cancelled) setLoading(false);
    }
  }, [spaceId]);

  // Initial fetch + refresh on window focus (so pinning from canvas
  // is reflected the next time the drawer is in front).
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelRef.current.cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // Auto-expand when pins arrive after being empty so the user
  // immediately sees their first pin without an extra click.
  const hasPins = (pins?.length ?? 0) > 0;
  useEffect(() => {
    if (hasPins && !expanded) setExpanded(true);
  }, [hasPins, expanded]);

  const handleUnpin = useCallback(
    async (summaryId: string) => {
      setUnpinningId(summaryId);
      try {
        const r = await fetch(
          `/api/spaces/${spaceId}/pin-summary?summaryId=${encodeURIComponent(summaryId)}`,
          { method: "DELETE", credentials: "include" },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // Optimistic local update; refresh follows for any drift.
        setPins((cur) => (cur ? cur.filter((p) => p.summaryId !== summaryId) : cur));
        toast.success("Unpinned");
        // Notify the canvas so a still-living SummaryCard with this
        // id can clear its 📌 PINNED badge in real time.
        window.dispatchEvent(
          new CustomEvent("summary-card:unpinned", { detail: { summaryId } }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Unpin failed: ${message.slice(0, 80)}`);
      } finally {
        setUnpinningId(null);
      }
    },
    [spaceId],
  );

  const handleOpen = useCallback(
    (summaryId: string) => {
      // Close the drawer first so the canvas is visible. Defer the
      // window event by a tick so the drawer's transition starts and
      // the canvas zoom isn't visually fighting it.
      drawerState.closeDrawer();
      const dispatch = () =>
        window.dispatchEvent(
          new CustomEvent("summary-card:focus", { detail: { summaryId } }),
        );
      if (onOpenOnCanvas) {
        onOpenOnCanvas(summaryId);
      } else {
        // Fall back to the window-event bridge — the canvas listener
        // handles the zoom + selection.
        window.setTimeout(dispatch, 220);
      }
    },
    [drawerState, onOpenOnCanvas],
  );

  // Self-hide when no pins exist AND we've finished loading. This
  // keeps the strategy page clean for spaces that haven't used the
  // feature yet.
  if (!loading && (!pins || pins.length === 0)) return null;

  return (
    <section
      className="rounded-[14px] border bg-white"
      style={{
        background: "rgba(255, 255, 255, 0.72)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        border: "1px solid rgba(11,13,18,0.10)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04)",
      }}
      aria-label="Pinned syntheses"
    >
      <PinnedHeader
        count={pins?.length ?? 0}
        loading={loading}
        expanded={expanded}
        collapsible={collapsibleHeader}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <ul className="space-y-2 px-3 pb-3" role="list">
          {pins?.map((p) => (
            <PinRow
              key={p.summaryId}
              pin={p}
              isBodyOpen={openBodyId === p.summaryId}
              onToggleBody={() =>
                setOpenBodyId((cur) =>
                  cur === p.summaryId ? null : p.summaryId,
                )
              }
              onUnpin={() => handleUnpin(p.summaryId)}
              onOpen={() => handleOpen(p.summaryId)}
              unpinning={unpinningId === p.summaryId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Header ─────────────────────────────────────────────────────────────
function PinnedHeader({
  count,
  loading,
  expanded,
  collapsible,
  onToggle,
}: {
  count: number;
  loading: boolean;
  expanded: boolean;
  collapsible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={collapsible ? onToggle : undefined}
      className={cn(
        "flex w-full items-center justify-between px-3.5 py-2.5",
        collapsible && "cursor-pointer hover:bg-amber-50/60",
      )}
      aria-expanded={expanded}
      disabled={!collapsible}
    >
      <div className="flex items-center gap-2">
        <Pin
          className="h-3 w-3"
          style={{ color: "#92400e", fill: "#fcd34d" }}
        />
        <span className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-amber-900/80">
          Pinned syntheses
        </span>
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-700">
          {count}
        </span>
        {loading && (
          <Loader2 className="h-3 w-3 animate-spin text-amber-700/60" />
        )}
      </div>
      {collapsible && (
        <span aria-hidden>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          )}
        </span>
      )}
    </button>
  );
}

// ── Single pin row ─────────────────────────────────────────────────────
function PinRow({
  pin,
  isBodyOpen,
  onToggleBody,
  onUnpin,
  onOpen,
  unpinning,
}: {
  pin: PinnedSummary;
  isBodyOpen: boolean;
  onToggleBody: () => void;
  onUnpin: () => void;
  onOpen: () => void;
  unpinning: boolean;
}) {
  const pinnedAtLabel = useMemo(() => {
    try {
      return new Date(pin.pinnedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }, [pin.pinnedAt]);

  return (
    <li
      className="rounded-lg border bg-white px-3 py-2.5"
      style={{ border: "1px solid rgba(11,13,18,0.08)" }}
      role="listitem"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Sparkles
              size={11}
              strokeWidth={2.4}
              className="shrink-0 text-violet-600"
            />
            <h4
              className="truncate text-[12.5px] font-semibold text-gray-900"
              title={pin.title}
            >
              {pin.title || "AI Summary"}
            </h4>
          </div>
          <p
            className={cn(
              "mt-1 text-[11.5px] leading-[1.55] text-gray-600 whitespace-pre-wrap",
              !isBodyOpen &&
                "line-clamp-2 [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden",
            )}
          >
            {pin.body || "(no body)"}
          </p>
          {pin.body && pin.body.length > 140 && (
            <button
              type="button"
              onClick={onToggleBody}
              className="mt-1 text-[10.5px] font-semibold text-violet-700 hover:text-violet-900"
            >
              {isBodyOpen ? "Show less" : "Read more"}
            </button>
          )}
        </div>

        {/* Action buttons — kept compact on the right edge */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onOpen}
            title="Show on canvas"
            aria-label="Show this synthesis on the canvas"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onUnpin}
            disabled={unpinning}
            title="Unpin"
            aria-label="Unpin this synthesis"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
          >
            {unpinning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      <footer className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
        <span className="font-mono">{pin.sourceLabel || `${pin.sourceCount} sources`}</span>
        <span aria-hidden>·</span>
        <span>Pinned {pinnedAtLabel}</span>
      </footer>
    </li>
  );
}
