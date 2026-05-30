"use client";

// ── Lab Notebook Panel ────────────────────────────────────────────
//
// Phase 9 — right-edge slide-in surface for the room's decision
// history. Reads from GET /api/brainstorm/sub-objectives/[id]/decisions
// and renders a day-grouped timeline of every meaningful event:
//
//   • elect / reject / defer    — disposition on a variation
//   • rd_iterate                — R&D experiment ran
//   • score                     — mechanism effectiveness scored
//   • approve_bet               — chain approved
//   • compose                   — composed design synthesized
//   • generate_batch / confirm  — picker activity (legacy surfacing)
//
// Each row carries lane color from the event's role, a relative
// timestamp ("4 min ago"), display strings for the subject, and
// optional context chips (lift %, placebo verdict, candidate count).
// Clicking a row fires onNavigate({ chainEntityId, variationId })
// so the host can focus the relevant Category Card + open drawer.
//
// Visual chrome mirrors ItemDetailDrawer:
//   • 480px max width on desktop
//   • Backdrop blur + soft drop shadow
//   • Right-edge slide animation, 0.36s ease-out
//   • Apple-vibe tokens throughout
//
// Pagination via "Load older" — cursor is the OLDEST event's ISO
// timestamp from the current page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BookText,
  Check,
  ChevronDown,
  Combine,
  FileCode,
  FlaskConical,
  Gauge,
  History,
  Layers,
  LayoutGrid,
  Loader2,
  Maximize2,
  MessageCircle,
  Play,
  Plus,
  Package,
  RefreshCw,
  ScanLine,
  Send,
  Sliders,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { NotebookGlossaryView } from "./notebook-glossary-view";
import type {
  NotebookAction,
  NotebookEvent,
  NotebookEventPage,
} from "@/lib/objective-canvas/notebook-events";
import type {
  AgentToolAction,
  NotebookMessage,
} from "@/lib/objective-canvas/notebook-chat";

interface Props {
  /** When false, the panel is unmounted entirely (AnimatePresence
   *  drives exit). The host owns the open state. */
  open: boolean;
  onClose: () => void;
  /** Phase 11.8b — chrome style.
   *    "modal" (default, backward compat) — full-height slide-in
   *      with backdrop. Suits one-off opens.
   *    "rail-card" — floating card with margins from screen edges,
   *      rounded corners, drop shadow, NO backdrop. The canvas
   *      underneath stays interactive (user can pan/click the
   *      whiteboard behind the card). The layout-level mount uses
   *      this so the notebook always sits on the side without
   *      locking the rest of the canvas. */
  chrome?: "modal" | "rail-card";
  /** Phase 10b — which feed to read:
   *   "room"  → GET /sub-objectives/[id]/decisions (Phase 9 path).
   *             `subObjectiveId` required.
   *   "space" → GET /space/[spaceId]/decisions (Phase 10b path).
   *             `spaceId` required. Surfaces ALL events for the
   *             space: pre-room (stage/clarifying/picking),
   *             cross-room (workbench/themes/concepts), AND each
   *             room's per-item work — tagged with room title so
   *             the user can scan the whole canvas history.
   *  Defaults to "room" for backward compat. */
  mode?: "room" | "space";
  /** The sub-objective whose decisions the notebook reads (mode="room"). */
  subObjectiveId?: string;
  /** The space whose decisions the notebook reads (mode="space"). */
  spaceId?: string;
  /** Click-handler fired when the user clicks a row. Host routes
   *  to the relevant Category Card / drawer. Optional — when
   *  omitted, rows render but don't navigate. */
  onNavigate?: (target: NotebookNavigateTarget) => void;
}

export interface NotebookNavigateTarget {
  entityId?: string | null;
  variationId?: string | null;
  /** Phase 10b — set when clicking a row from the space-scoped view;
   *  host can navigate to the matching room before opening the drawer. */
  subObjectiveId?: string | null;
}

const FILTERS: ReadonlyArray<{
  label: string;
  actions: NotebookEvent["action"][] | null;
  /** When set, the lens shows only headline-weight events (decisions +
   *  surprising results) client-side — the "see the most important
   *  things" view. Server still returns everything; we filter here. */
  headlinesOnly?: boolean;
}> = [
  { label: "All", actions: null },
  { label: "Key", actions: null, headlinesOnly: true },
  {
    label: "Experiments",
    actions: ["rd_iterate", "score", "autopilot_run", "autopilot_iteration"],
  },
  { label: "Elections", actions: ["elect", "reject", "defer", "clear"] },
  { label: "Bets", actions: ["approve_bet", "compose"] },
  // Phase 10a — System events: room births, item expansions, expansion tree
  // growth, prototype lifecycle, finding curation, theme/concept branching,
  // constraint changes, stage transitions. These describe what the canvas
  // (and the user) did at the system altitude rather than per-chain work.
  {
    label: "System",
    actions: [
      "room_generated",
      "item_expanded",
      "expansion_spawned",
      "prototype_status_changed",
      "finding_acknowledged",
      "finding_dismissed",
      "finding_resolved",
      "theme_distilled",
      "concept_branched",
      "constraints_set",
      "stage_transitioned",
      // Phase 11.4 chain enrichment + Phase 11.6 baseline-set both
      // belong here — system-altitude events the user didn't directly
      // initiate at a per-variation level but that shape downstream work.
      "chains_enriched",
      "baseline_set",
      // Phase 11.A — objective layering events. Always space-scoped;
      // surface them in System alongside chains_enriched + baseline_set
      // since they shape downstream proposer + room behavior the same way.
      "layers_generated",
      "layers_regenerated",
      "layer_position_set",
      // Arc 3.1 — mechanism technical-depth spec. System-altitude
      // depth on a feature, same bucket as item_expanded.
      "mechanism_spec_generated",
      // Priority vector — per-sub-objective soft weights edited.
      // Same bucket as constraints_set (settings-altitude change).
      "priorities_set",
      // 2026-05-29 — deliverable-visibility slice. Cross-room scan
      // closure + every artifact-producing route (mockup, export
      // prompt, doc, prototype brief, agent spec) + brief polish.
      "scan_complete",
      "deliverable_generated",
      "brief_polished",
    ],
  },
];

export function LabNotebookPanel({
  open,
  onClose,
  chrome = "modal",
  mode = "room",
  subObjectiveId,
  spaceId,
  onNavigate,
}: Props) {
  const reduce = useReducedMotion();
  const [events, setEvents] = useState<NotebookEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterIdx, setFilterIdx] = useState(0);
  // Arc 3.5 — the rail hosts two views: the activity log (timeline +
  // chat) and the space Glossary (the definition page). Glossary only
  // offered when we have a spaceId to load it from.
  const [bodyView, setBodyView] = useState<"activity" | "glossary">("activity");
  // Phase 10c — chat thread state. Sticky input at bottom + message
  // bubbles at the top of the scrollable body. Loads on open + after
  // every send so the thread stays in sync without polling.
  const [messages, setMessages] = useState<NotebookMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  // Tracks which suggested-action tool calls the user has fired client-
  // side so the UI shows "running…" then "done" without re-rendering
  // from scratch. Keyed by assistant message id.
  const [toolDispatchStatus, setToolDispatchStatus] = useState<
    Record<string, "idle" | "running" | "done" | "error">
  >({});

  // Phase 10b — switch feed URL based on mode. Room mode uses the
  // existing Phase 9 endpoint (filters by sub_objective_id). Space
  // mode uses the new 10b endpoint that returns ALL space events —
  // both per-room rows (sub_objective_id set) and space-level rows
  // (sub_objective_id null: stage/clarifying/findings/themes).
  const feedUrl =
    mode === "space" && spaceId
      ? `/api/brainstorm/space/${spaceId}/decisions`
      : subObjectiveId
        ? `/api/brainstorm/sub-objectives/${subObjectiveId}/decisions`
        : null;

  const fetchPage = useCallback(
    async (opts: { cursor?: string | null; reset?: boolean }) => {
      if (!feedUrl) {
        setError("Missing notebook target.");
        return;
      }
      const filter = FILTERS[filterIdx];
      const qs = new URLSearchParams();
      if (opts.cursor) qs.set("cursor", opts.cursor);
      if (filter.actions) qs.set("actions", filter.actions.join(","));
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${feedUrl}?${qs.toString()}`);
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(j.error ?? "Couldn't load notebook.");
          return;
        }
        const page = (await res.json()) as NotebookEventPage;
        setEvents((prev) =>
          opts.reset ? page.events : [...prev, ...page.events],
        );
        setTotal(page.total);
        setNextCursor(page.next_cursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [feedUrl, filterIdx],
  );

  // Load on open + when filter changes.
  useEffect(() => {
    if (!open) return;
    setEvents([]);
    setNextCursor(null);
    void fetchPage({ reset: true });
  }, [open, fetchPage]);

  // Keep a ref to the latest events so the liveness poll can read them
  // without re-subscribing the interval every time the feed changes.
  const eventsRef = useRef<NotebookEvent[]>([]);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  // Silent first-page refetch (no spinner) — used by the liveness poll.
  const silentRefresh = useCallback(async () => {
    if (!feedUrl) return;
    const filter = FILTERS[filterIdx];
    const qs = new URLSearchParams();
    if (filter.actions) qs.set("actions", filter.actions.join(","));
    try {
      const res = await fetch(`${feedUrl}?${qs.toString()}`);
      if (!res.ok) return;
      const page = (await res.json()) as NotebookEventPage;
      setEvents(page.events);
      setTotal(page.total);
      setNextCursor(page.next_cursor);
    } catch {
      // Soft-fail — a dropped poll is harmless; the next tick retries.
    }
  }, [feedUrl, filterIdx]);

  // Liveness — there is no realtime path to this data (the SSE bus is a
  // different subsystem that never touches the decision log), so while a
  // run is plausibly active we lightly poll the first page. Gated to
  // avoid waste + disruption: only when the tab is visible, only when
  // the newest event is recent (≤90s — a run is plausibly mid-flight),
  // and only while the user is still on the first page of history.
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const evs = eventsRef.current;
      if (evs.length === 0 || evs.length > 40) return;
      const newestTs = new Date(evs[0].created_at).getTime();
      if (Date.now() - newestTs > 90_000) return;
      void silentRefresh();
    }, 4000);
    return () => window.clearInterval(id);
  }, [open, silentRefresh]);

  // Phase 10c — load chat thread on open. Thread is keyed by
  // (space_id, sub_objective_id) — null sub_objective_id = canvas-
  // level thread when the panel mounts in space mode.
  const loadMessages = useCallback(async () => {
    if (!open) return;
    const sid =
      mode === "space" ? spaceId : await (async () => spaceId)();
    if (!sid) return;
    setMessagesLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("spaceId", sid);
      if (mode === "room" && subObjectiveId) {
        qs.set("subObjectiveId", subObjectiveId);
      }
      const res = await fetch(
        `/api/brainstorm/notebook/messages?${qs.toString()}`,
      );
      if (res.ok) {
        const j = (await res.json()) as { messages: NotebookMessage[] };
        setMessages(j.messages ?? []);
      }
    } catch {
      // Soft-fail: thread is optional. Timeline still works.
    } finally {
      setMessagesLoading(false);
    }
  }, [open, mode, spaceId, subObjectiveId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  // ── Submit handler — POSTs the user turn, appends returned msgs ──
  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatSending) return;
    // Resolve the spaceId — in room mode the host may not have passed
    // it, but the chat endpoint needs it. We can't fetch the missing
    // spaceId from here; fall back to "no chat" gracefully.
    if (!spaceId) {
      setChatError(
        "Chat needs a space context — try opening the notebook again.",
      );
      return;
    }
    setChatSending(true);
    setChatError(null);
    try {
      const res = await fetch("/api/brainstorm/notebook/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          subObjectiveId: mode === "room" ? subObjectiveId ?? null : null,
          content: text,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setChatError(j.error ?? "Couldn't send.");
        return;
      }
      const j = (await res.json()) as { messages: NotebookMessage[] };
      setMessages((prev) => [...prev, ...(j.messages ?? [])]);
      setChatInput("");
      // Refresh the timeline too — server-executed tools may have
      // landed new decision-log rows.
      setEvents([]);
      setNextCursor(null);
      void fetchPage({ reset: true });
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setChatSending(false);
    }
  }, [chatInput, chatSending, spaceId, subObjectiveId, mode, fetchPage]);

  // ── Suggested client-tool dispatch — fires the real route from
  //    the UI when the user clicks a "Run" button on an assistant
  //    suggested action. Records status locally + refreshes timeline. ──
  const runSuggestedTool = useCallback(
    async (assistantMessageId: string, action: AgentToolAction) => {
      setToolDispatchStatus((prev) => ({
        ...prev,
        [assistantMessageId]: "running",
      }));
      try {
        const url = clientToolUrl(action);
        const body = clientToolBody(action);
        if (!url || !body) {
          setToolDispatchStatus((prev) => ({
            ...prev,
            [assistantMessageId]: "error",
          }));
          return;
        }
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        setToolDispatchStatus((prev) => ({
          ...prev,
          [assistantMessageId]: res.ok ? "done" : "error",
        }));
        if (res.ok) {
          // Refresh timeline — the underlying route logged a decision.
          setEvents([]);
          setNextCursor(null);
          void fetchPage({ reset: true });
        }
      } catch {
        setToolDispatchStatus((prev) => ({
          ...prev,
          [assistantMessageId]: "error",
        }));
      }
    },
    [fetchPage],
  );

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The "Key" lens filters to headline-weight events client-side (the
  // server still returns everything). Other lenses already filter by
  // action server-side via fetchPage.
  const headlinesOnly = FILTERS[filterIdx]?.headlinesOnly ?? false;

  // Group events by day for the timeline display.
  const grouped = useMemo(
    () => groupByDay(headlinesOnly ? events.filter(isHeadlineEvent) : events),
    [events, headlinesOnly],
  );

  // Header breakdown — a quick sense of what the loaded window holds.
  const counts = useMemo(() => {
    let experiments = 0;
    let decisions = 0;
    for (const e of events) {
      if (e.action === "score" || e.action === "rd_iterate") experiments += 1;
      else if (
        e.action === "elect" ||
        e.action === "approve_bet" ||
        e.action === "compose"
      )
        decisions += 1;
    }
    return { experiments, decisions };
  }, [events]);

  // Phase 10c-polish — auto-scroll the chat to the newest message
  // whenever a turn lands. Without this, long conversations stay
  // pinned to the top of the panel and the user has to scroll down
  // manually after every send. Ref points at a sentinel <div /> at
  // the bottom of the messages list.
  const chatEndRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!open) return;
    if (messages.length === 0) return;
    chatEndRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "nearest",
    });
  }, [open, messages.length, reduce]);

  // Phase 11.8b — rail-card chrome: floating card with margins, no
  // backdrop, canvas underneath stays interactive. Modal chrome is
  // the original full-height slide-in with backdrop. The two share
  // the same body — only the outer aside positioning + backdrop
  // presence differs.
  const isRail = chrome === "rail-card";
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — only in modal mode. Rail-card mode skips it
              entirely so the user can pan/click the canvas behind. */}
          {!isRail && (
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
            aria-label="Lab Notebook"
            initial={reduce ? { x: 0, opacity: 0 } : { x: "100%", opacity: 0.8 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: "100%", opacity: 0 }}
            transition={{
              duration: reduce ? 0 : 0.36,
              ease: [0.22, 1, 0.36, 1],
            }}
            className={
              isRail
                ? "fixed z-50 flex flex-col overflow-hidden"
                : "fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden md:w-[480px]"
            }
            style={
              isRail
                ? {
                    // Floating card: margins from each edge so the
                    // canvas peeks through on all four sides. Rounded
                    // corners + soft drop shadow give the "hovering"
                    // feel. Width matches the modal chrome's desktop
                    // width minus a bit for visual breathing room.
                    top: 16,
                    right: 16,
                    bottom: 16,
                    width: 420,
                    maxWidth: "calc(100vw - 32px)",
                    background: appleVibe.surface.card,
                    border: `1px solid ${appleVibe.stroke.hairline}`,
                    borderRadius: 20,
                    fontFamily: appleVibe.font.stack,
                    boxShadow:
                      "0 24px 64px -16px rgba(11,18,40,0.32), 0 4px 12px -4px rgba(11,18,40,0.10)",
                  }
                : {
                    background: appleVibe.surface.card,
                    borderLeft: `1px solid ${appleVibe.stroke.hairline}`,
                    fontFamily: appleVibe.font.stack,
                    boxShadow: "0 0 40px -8px rgba(11,18,40,0.28)",
                  }
            }
          >
            {/* Header */}
            <header
              className="flex items-center justify-between gap-3 px-5 py-4"
              style={{
                borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)",
                backdropFilter: "blur(12px)",
              }}
            >
              <div className="min-w-0 flex-1">
                <div
                  className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {mode === "space" ? "Canvas Notebook · All rooms" : "Lab Notebook"}
                </div>
                <h2
                  className="mt-1 truncate text-[18px] font-semibold leading-tight tracking-tight"
                  style={{
                    color: appleVibe.text.primary,
                    fontFamily: appleVibe.font.display,
                    letterSpacing: "-0.015em",
                  }}
                >
                  {total} {total === 1 ? "event" : "events"}
                </h2>
                {(counts.experiments > 0 || counts.decisions > 0) && (
                  <div
                    className="mt-0.5 text-[11px] font-medium"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    {counts.experiments > 0 && (
                      <span>
                        {counts.experiments} experiment
                        {counts.experiments === 1 ? "" : "s"}
                      </span>
                    )}
                    {counts.experiments > 0 && counts.decisions > 0 && " · "}
                    {counts.decisions > 0 && (
                      <span>
                        {counts.decisions} decision
                        {counts.decisions === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.04)]"
                aria-label="Close notebook"
                style={{ color: appleVibe.text.secondary }}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </header>

            {/* Arc 3.5 — Activity / Glossary view toggle (Glossary only
                when we have a spaceId to load the project dictionary). */}
            {spaceId && (
              <div className="flex items-center gap-1 px-5 pt-3">
                {(["activity", "glossary"] as const).map((v) => {
                  const active = bodyView === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setBodyView(v)}
                      className="inline-flex items-center gap-1 transition-[background,color] duration-150 ease-out"
                      style={{
                        background: active
                          ? appleVibe.accent.primary
                          : "transparent",
                        color: active
                          ? appleVibe.text.onAccent
                          : appleVibe.text.secondary,
                        border: `1px solid ${active ? appleVibe.accent.primary : appleVibe.stroke.medium}`,
                        borderRadius: appleVibe.radius.pill,
                        padding: "3px 12px",
                        fontSize: "10.5px",
                        fontWeight: 600,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {v === "glossary" && (
                        <BookText className="h-3 w-3" strokeWidth={2} />
                      )}
                      {v === "activity" ? "Activity" : "Glossary"}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Filter chips (activity view only) */}
            {bodyView === "activity" && (
            <div
              className="flex flex-wrap items-center gap-1.5 px-5 py-3"
              style={{ borderBottom: `1px solid ${appleVibe.stroke.hairline}` }}
            >
              {FILTERS.map((f, i) => {
                const active = i === filterIdx;
                return (
                  <motion.button
                    key={f.label}
                    type="button"
                    onClick={() => setFilterIdx(i)}
                    whileHover={{ y: -1, transition: { duration: 0.15 } }}
                    whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
                    className="inline-flex items-center gap-1 transition-[background,color] duration-150 ease-out"
                    style={{
                      background: active
                        ? appleVibe.accent.primary
                        : "transparent",
                      color: active
                        ? appleVibe.text.onAccent
                        : appleVibe.text.secondary,
                      border: `1px solid ${active ? appleVibe.accent.primary : appleVibe.stroke.medium}`,
                      borderRadius: appleVibe.radius.pill,
                      padding: "3px 10px",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {f.label}
                  </motion.button>
                );
              })}
            </div>
            )}

            {/* Scrollable body — Glossary view OR the activity log
                (chat + timeline). */}
            {bodyView === "glossary" && spaceId ? (
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <NotebookGlossaryView spaceId={spaceId} />
              </div>
            ) : (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Phase 10c — Chat thread. Renders above the timeline
                  so the user reads recent conversation in context
                  before the structured event log below. Sticky input
                  is below the scroll area (in the panel chrome). */}
              <section className="mb-5">
                <div
                  className="mb-2 flex items-center gap-2"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  <MessageCircle
                    className="h-3 w-3"
                    strokeWidth={2}
                    style={{ color: appleVibe.accent.primary }}
                  />
                  <span
                    className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Conversation
                  </span>
                  <span
                    className="h-px flex-1"
                    style={{ background: appleVibe.stroke.hairline }}
                  />
                </div>
                {messages.length === 0 && !messagesLoading && (
                  <ChatWelcome mode={mode} />
                )}
                {messagesLoading && messages.length === 0 && (
                  <p
                    className="text-[11.5px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Loading conversation…
                  </p>
                )}
                <ul className="space-y-2">
                  {messages.map((m) => (
                    <ChatBubble
                      key={m.id}
                      message={m}
                      dispatchStatus={toolDispatchStatus[m.id] ?? "idle"}
                      onRunSuggested={(action) =>
                        runSuggestedTool(m.id, action)
                      }
                    />
                  ))}
                  {/* Auto-scroll anchor — useEffect scrolls this into
                      view whenever a new turn lands. */}
                  <li ref={chatEndRef} aria-hidden className="h-0" />
                </ul>
              </section>

              {error && (
                <div
                  className="mb-3 px-3 py-2"
                  style={{
                    background: "rgba(220,38,38,0.04)",
                    border: "1px solid rgba(220,38,38,0.20)",
                    borderRadius: appleVibe.radius.sm,
                  }}
                >
                  <p
                    className="text-[12px]"
                    style={{ color: "rgba(127,29,29,0.95)" }}
                  >
                    {error}
                  </p>
                </div>
              )}

              {!error && events.length === 0 && !loading && (
                <EmptyState />
              )}

              {grouped.map(({ label, events: dayEvents }) => {
                // Fold bursts of work into collapsible chapters (autopilot
                // sessions + same-room process bursts) so each day reads as
                // a fork-tree of micro-processes, not a flat wall of rows.
                const items = buildChapters(dayEvents);
                return (
                  <section key={label} className="mb-5">
                    <div
                      className="mb-2 flex items-center gap-2"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      <span
                        className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                        style={{ color: appleVibe.text.tertiary }}
                      >
                        {label}
                      </span>
                      <span
                        className="h-px flex-1"
                        style={{ background: appleVibe.stroke.hairline }}
                      />
                    </div>
                    {/* The spine — a hairline rail the row nodes sit on. */}
                    <div className="relative">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute bottom-1 top-1 w-px"
                        style={{
                          left: 22,
                          background: appleVibe.stroke.hairline,
                        }}
                      />
                      <ul className="relative space-y-1.5">
                        {items.map((item) => {
                          if (item.kind === "chapter") {
                            return (
                              <ChapterRow
                                key={item.chapter.id}
                                chapter={item.chapter}
                                onNavigate={(target) => onNavigate?.(target)}
                              />
                            );
                          }
                          const ev = item.event;
                          return (
                            <NotebookRow
                              key={ev.id}
                              event={ev}
                              weight={weightFor(ev)}
                              onClick={() =>
                                onNavigate?.({
                                  entityId: ev.subject.entity_id ?? null,
                                  variationId: ev.subject.variation_id ?? null,
                                  // Fall back to the spawned room when the
                                  // event itself was space-scoped but created
                                  // a new room (concept_branched,
                                  // theme_distilled, sub-objective add).
                                  subObjectiveId:
                                    ev.subject.sub_objective_id ??
                                    ev.meta.spawned_sub_objective_id ??
                                    null,
                                })
                              }
                            />
                          );
                        })}
                      </ul>
                    </div>
                  </section>
                );
              })}

              {/* Load older */}
              {nextCursor && (
                <div className="mt-4 flex justify-center">
                  <motion.button
                    type="button"
                    onClick={() => void fetchPage({ cursor: nextCursor })}
                    disabled={loading}
                    whileHover={{ y: -1, transition: { duration: 0.15 } }}
                    whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
                    className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: "transparent",
                      color: appleVibe.text.secondary,
                      border: `1px solid ${appleVibe.stroke.medium}`,
                      borderRadius: appleVibe.radius.pill,
                      padding: "4px 12px",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {loading ? (
                      <>
                        <Loader2
                          className="h-2.5 w-2.5 animate-spin"
                          strokeWidth={2.5}
                        />
                        Loading…
                      </>
                    ) : (
                      "Load older"
                    )}
                  </motion.button>
                </div>
              )}

              {loading && events.length === 0 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Loader2
                    className="h-3 w-3 animate-spin"
                    strokeWidth={2}
                    style={{ color: appleVibe.text.tertiary }}
                  />
                  <span
                    className="text-[11.5px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Loading notebook…
                  </span>
                </div>
              )}
            </div>
            )}

            {/* Phase 10c — sticky chat input bar. Sits in the panel
                chrome (per L3 lock-in: timeline-first, chat as side
                action). Always visible at the bottom of the panel so
                the user can ask the agent anything regardless of
                where they are in the timeline. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendChat();
              }}
              className="flex flex-col gap-1.5 px-4 py-3"
              style={{
                borderTop: `1px solid ${appleVibe.stroke.hairline}`,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.97) 100%)",
                backdropFilter: "blur(12px)",
              }}
            >
              {chatError && (
                <p
                  className="text-[10.5px] font-light"
                  style={{ color: "rgba(127,29,29,0.95)" }}
                >
                  {chatError}
                </p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter to send, Shift+Enter for newline. Matches
                    // most modern chat UIs.
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendChat();
                    }
                  }}
                  placeholder={
                    mode === "space"
                      ? "Ask about the whole canvas…"
                      : "Ask about this room…"
                  }
                  rows={1}
                  disabled={chatSending}
                  className="min-h-[34px] flex-1 resize-none rounded-2xl px-3 py-2 outline-none transition-colors focus:bg-white"
                  style={{
                    background: appleVibe.surface.cardElevated,
                    border: `1px solid ${appleVibe.stroke.medium}`,
                    color: appleVibe.text.primary,
                    fontSize: "12.5px",
                    fontFamily: appleVibe.font.stack,
                    lineHeight: 1.4,
                    maxHeight: "120px",
                  }}
                />
                <button
                  type="submit"
                  disabled={chatSending || !chatInput.trim()}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background: appleVibe.accent.primary,
                    color: appleVibe.text.onAccent,
                  }}
                  aria-label="Send"
                >
                  {chatSending ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      strokeWidth={2.4}
                    />
                  ) : (
                    <Send className="h-3.5 w-3.5" strokeWidth={2.4} />
                  )}
                </button>
              </div>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Chat bubble + suggested tool action ───────────────────────────

/** Renders one chat message. User and assistant get bubbles in the
 *  Apple-vibe palette; tool result rows render as a small inline
 *  status badge below the assistant bubble. Suggested-action calls
 *  surface as a "Run" button the user can click to fire the real
 *  route. */
function ChatBubble({
  message,
  dispatchStatus,
  onRunSuggested,
}: {
  message: NotebookMessage;
  dispatchStatus: "idle" | "running" | "done" | "error";
  onRunSuggested: (action: AgentToolAction) => void;
}) {
  if (message.role === "tool") {
    const r = message.tool_result;
    return (
      <li
        className="text-[10.5px] font-light italic"
        style={{
          color: r?.ok
            ? appleVibe.stage.outcomes
            : "rgba(127,29,29,0.95)",
        }}
      >
        Tool {r?.ok ? "executed" : "failed"}
        {r?.error ? ` — ${r.error}` : ""}
      </li>
    );
  }
  const isUser = message.role === "user";
  const action = message.tool_call;
  return (
    <li
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className="max-w-[88%] rounded-2xl px-3 py-2"
        style={{
          background: isUser
            ? appleVibe.accent.primary
            : appleVibe.surface.cardElevated,
          color: isUser
            ? appleVibe.text.onAccent
            : appleVibe.text.primary,
          border: isUser
            ? "none"
            : `1px solid ${appleVibe.stroke.hairline}`,
        }}
      >
        <p
          className="whitespace-pre-wrap text-[12px] leading-snug"
          style={{ fontFamily: appleVibe.font.stack }}
        >
          {message.content ?? ""}
        </p>
        {action && action.status === "suggested" && (
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onRunSuggested(action)}
              disabled={dispatchStatus === "running" || dispatchStatus === "done"}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold transition-opacity disabled:opacity-50"
              style={{
                background: "rgba(255,255,255,0.20)",
                color: appleVibe.text.onAccent,
                border: "1px solid rgba(255,255,255,0.35)",
              }}
            >
              {dispatchStatus === "running" ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2.4} />
              ) : dispatchStatus === "done" ? (
                <Check className="h-2.5 w-2.5" strokeWidth={2.4} />
              ) : (
                <Play className="h-2.5 w-2.5" strokeWidth={2.4} />
              )}
              {dispatchStatus === "done"
                ? "Ran"
                : dispatchStatus === "error"
                  ? "Retry"
                  : action.label ?? `Run ${action.tool_name}`}
            </button>
          </div>
        )}
        {action && action.status === "executed" && (
          <p
            className="mt-1.5 text-[10px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            Fired {action.tool_name}
          </p>
        )}
      </div>
    </li>
  );
}

// ── Client-side tool URL + body resolver ──────────────────────────
//
// Maps a suggested ClientTool to the existing brainstorm route the
// UI fires when the user clicks the "Run" button on an agent
// suggestion. Returns null when args are missing so the UI can show
// an error badge instead of firing a malformed request.

function clientToolUrl(action: AgentToolAction): string | null {
  switch (action.tool_name) {
    case "score_feature":
      return "/api/brainstorm/item/variation/score";
    case "refine_feature":
      return "/api/brainstorm/item/variation/refine";
    case "research_item":
      return "/api/brainstorm/item/research";
    default:
      return null;
  }
}

function clientToolBody(
  action: AgentToolAction,
): Record<string, unknown> | null {
  const entityId =
    typeof action.args.entityId === "string" ? action.args.entityId : "";
  if (!entityId) return null;
  return { entityId };
}

// ── Empty state ───────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      className="mt-6 px-4 py-10 text-center"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px dashed ${appleVibe.stroke.medium}`,
        borderRadius: appleVibe.radius.lg,
      }}
    >
      <div
        className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full"
        style={{
          background: appleVibe.surface.chip,
          color: appleVibe.text.tertiary,
        }}
      >
        <History className="h-3.5 w-3.5" strokeWidth={2} />
      </div>
      <p
        className="text-[12.5px] font-medium"
        style={{ color: appleVibe.text.secondary }}
      >
        No decisions yet.
      </p>
      <p
        className="mt-1 text-[11.5px] font-light leading-snug"
        style={{ color: appleVibe.text.tertiary }}
      >
        The notebook fills as you elect variations, run experiments,
        and approve bets.
      </p>
    </div>
  );
}

// ── Per-row render ────────────────────────────────────────────────

function NotebookRow({
  event: ev,
  onClick,
  weight = "routine",
}: {
  event: NotebookEvent;
  onClick?: () => void;
  /** Priority weight — muted rows rest dimmed so headlines lead. */
  weight?: EventWeight;
}) {
  // Phase 10b — visualFor is action-driven; the row click handler
  // now forwards sub_objective_id too so the host can route to the
  // right room from the all-rooms feed. Meta is passed so subtype-
  // bearing actions (deliverable_generated) get the specific label.
  const visual = visualFor(ev.action, ev.meta);
  const Icon = visual.icon;
  const subject = formatSubject(ev);
  const time = formatTime(ev.created_at);
  return (
    <motion.li
      whileHover={{ y: -0.5, transition: { duration: 0.15 } }}
      whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
      onClick={onClick}
      className="cursor-pointer transition-colors duration-150 ease-out hover:bg-[rgba(15,23,42,0.04)]"
      style={{
        background: "transparent",
        borderRadius: appleVibe.radius.sm,
        padding: "9px 12px",
        opacity: weight === "muted" ? 0.55 : 1,
      }}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
          style={{
            background: `${visual.color}14`,
            color: visual.color,
          }}
          aria-hidden
        >
          <Icon className="h-3 w-3" strokeWidth={2.4} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="text-[11.5px] font-semibold"
              style={{ color: appleVibe.text.primary }}
            >
              {visual.label}
            </span>
            <span
              className="flex-shrink-0 font-mono text-[10px] tabular-nums"
              style={{ color: appleVibe.text.tertiary }}
              title={new Date(ev.created_at).toLocaleString()}
            >
              {time}
            </span>
          </div>
          {subject && (
            <p
              className="mt-0.5 text-[11.5px] leading-snug line-clamp-2"
              style={{ color: appleVibe.text.secondary }}
            >
              {subject}
            </p>
          )}
          {/* Metadata chips — render small data badges when present */}
          <MetadataChips event={ev} />
        </div>
      </div>
    </motion.li>
  );
}

function MetadataChips({ event: ev }: { event: NotebookEvent }) {
  const chips: Array<{ key: string; label: string; color?: string }> = [];
  if (typeof ev.meta.top_score === "number") {
    chips.push({
      key: "top",
      label: `top ${(ev.meta.top_score * 100).toFixed(0)}`,
      color: appleVibe.stage.features,
    });
  }
  if (typeof ev.meta.effectiveness_score === "number") {
    chips.push({
      key: "score",
      label: `score ${(ev.meta.effectiveness_score * 100).toFixed(0)}`,
      color: appleVibe.stage.features,
    });
  }
  if (typeof ev.meta.lift_pct === "number") {
    chips.push({
      key: "lift",
      label: `lift ${(ev.meta.lift_pct * 100).toFixed(0)}%`,
    });
  }
  if (ev.meta.placebo_verdict) {
    chips.push({
      key: "placebo",
      label: `placebo ${ev.meta.placebo_verdict}`,
      color:
        ev.meta.placebo_verdict === "pass"
          ? appleVibe.stage.outcomes
          : ev.meta.placebo_verdict === "fail"
            ? appleVibe.stage.pain
            : appleVibe.text.tertiary,
    });
  }
  if (typeof ev.meta.candidate_count === "number") {
    chips.push({
      key: "cands",
      label: `${ev.meta.candidate_count} candidate${ev.meta.candidate_count === 1 ? "" : "s"}`,
    });
  }
  if (typeof ev.meta.conflicts_open_count === "number" && ev.meta.conflicts_open_count > 0) {
    chips.push({
      key: "conf",
      label: `${ev.meta.conflicts_open_count} conflict${ev.meta.conflicts_open_count === 1 ? "" : "s"} open`,
      color: appleVibe.stage.pain,
    });
  }
  if (ev.meta.target_root_cause) {
    chips.push({
      key: "gap",
      label: `targets: "${ev.meta.target_root_cause}"`,
    });
  }
  // ── Phase 10a system-event chips ──
  if (ev.meta.room_layer_counts) {
    const c = ev.meta.room_layer_counts;
    const parts: string[] = [];
    if (c.pain !== undefined) parts.push(`${c.pain} pains`);
    if (c.features !== undefined) parts.push(`${c.features} mechanisms`);
    if (c.outcomes !== undefined) parts.push(`${c.outcomes} outcomes`);
    if (parts.length > 0) {
      chips.push({ key: "layer-counts", label: parts.join(" · ") });
    }
  }
  if (typeof ev.meta.variation_count === "number" && ev.meta.variation_count > 0) {
    chips.push({
      key: "variations",
      label: `${ev.meta.variation_count} variation${ev.meta.variation_count === 1 ? "" : "s"}`,
    });
  }
  if (ev.meta.had_research) {
    chips.push({ key: "research", label: "research-backed" });
  }
  if (ev.meta.prototype_status) {
    const ps = ev.meta.prototype_status;
    chips.push({
      key: "proto-status",
      label: ev.meta.prior_prototype_status
        ? `${ev.meta.prior_prototype_status} → ${ps}`
        : ps,
      color:
        ps === "concluded"
          ? appleVibe.stage.outcomes
          : ps === "abandoned"
            ? appleVibe.stage.pain
            : ps === "running"
              ? appleVibe.stage.features
              : appleVibe.text.tertiary,
    });
  }
  if (ev.meta.expansion_node_title) {
    chips.push({
      key: "exp-title",
      label: `"${ev.meta.expansion_node_title}"`,
    });
  }
  if (ev.meta.finding_category) {
    chips.push({
      key: "find-cat",
      label: ev.meta.finding_severity
        ? `${ev.meta.finding_category} · ${ev.meta.finding_severity}`
        : ev.meta.finding_category,
      color:
        ev.meta.finding_severity === "critical"
          ? appleVibe.stage.pain
          : appleVibe.text.tertiary,
    });
  }
  if (ev.meta.theme_title) {
    chips.push({ key: "theme", label: `"${ev.meta.theme_title}"` });
  }
  if (ev.meta.canonical_display_name) {
    chips.push({
      key: "concept",
      label: ev.meta.canonical_display_name,
      color: appleVibe.stage.objective,
    });
  }
  if (ev.meta.constraints_summary) {
    chips.push({
      key: "constraints",
      label: ev.meta.constraints_summary,
    });
  }
  if (ev.meta.stage_from && ev.meta.stage_to) {
    chips.push({
      key: "stage",
      label: `${ev.meta.stage_from} → ${ev.meta.stage_to}`,
      color: appleVibe.accent.primary,
    });
  }
  if (typeof ev.meta.chain_count === "number" && ev.meta.chain_count > 0) {
    chips.push({
      key: "chains",
      label: `${ev.meta.chain_count} chain${ev.meta.chain_count === 1 ? "" : "s"}`,
    });
  }
  // ── Phase 11.2 — proxy-indicator breakdown chips ──
  // Renders the top-3 indicators the scoring run touched as a strip:
  //   "[indicator name] · 0.71"  (or "0.71 ⚠️" when proxy confidence ≤0.4)
  // The ⚠️ is the load-bearing affordance — it tells the user "this
  // proxy is shaky; don't chase the number." When indicator_count >
  // 3 we also append a "+N more" chip so the user knows the run
  // graded more than the visible top-3.
  if (
    Array.isArray(ev.meta.indicator_breakdown) &&
    ev.meta.indicator_breakdown.length > 0
  ) {
    for (const ind of ev.meta.indicator_breakdown) {
      const shaky = ind.min_confidence <= 0.4;
      const truncated =
        ind.indicator.length > 28
          ? `${ind.indicator.slice(0, 26)}…`
          : ind.indicator;
      chips.push({
        key: `ind:${ind.indicator}`,
        label: `${truncated} · ${ind.avg_score.toFixed(2)}${shaky ? " ⚠️" : ""}`,
        color: shaky ? appleVibe.stage.pain : appleVibe.stage.features,
      });
    }
    const extras = (ev.meta.indicator_count ?? 0) - ev.meta.indicator_breakdown.length;
    if (extras > 0) {
      chips.push({
        key: "ind-more",
        label: `+${extras} more`,
      });
    }
  }
  // ── Phase 11.4 chains_enriched chips ──
  if (typeof ev.meta.enriched_chain_count === "number") {
    chips.push({
      key: "enriched",
      label: `${ev.meta.enriched_chain_count} chains enriched`,
      color: appleVibe.stage.features,
    });
  }
  if (
    typeof ev.meta.new_chains_count === "number" &&
    ev.meta.new_chains_count > 0
  ) {
    chips.push({
      key: "new-chains",
      label: `+${ev.meta.new_chains_count} new chains`,
      color: appleVibe.stage.outcomes,
    });
  }
  if (typeof ev.meta.avg_chain_strength === "number") {
    chips.push({
      key: "chain-strength",
      label: `avg strength ${ev.meta.avg_chain_strength.toFixed(2)}`,
    });
  }
  if (
    typeof ev.meta.orphans_closed === "number" &&
    ev.meta.orphans_closed > 0
  ) {
    chips.push({
      key: "orphans",
      label: `${ev.meta.orphans_closed} orphan${ev.meta.orphans_closed === 1 ? "" : "s"} closed`,
    });
  }
  // ── Phase 11.6 baseline_set chips ──
  if (ev.meta.indicator_name) {
    chips.push({
      key: "indicator",
      label: `"${ev.meta.indicator_name}"`,
      color: appleVibe.stage.outcomes,
    });
  }
  if (ev.meta.baseline_value) {
    const valueText = ev.meta.baseline_unit
      ? `${ev.meta.baseline_value} ${ev.meta.baseline_unit}`
      : ev.meta.baseline_value;
    const targetText = ev.meta.target_value
      ? ` → target ${ev.meta.target_value}`
      : "";
    chips.push({
      key: "baseline",
      label: `baseline ${valueText}${targetText}`,
    });
  }
  if (ev.meta.baseline_source === "llm") {
    chips.push({
      key: "baseline-src",
      label: "auto-baselined",
    });
  }
  // ── Phase 11.A — layers_generated / layers_regenerated chips ──
  // Surface the domain template + layer/variable counts as a compact
  // "Cognition · 5L · 24v" chip so the notebook row reads like a
  // tiny stack summary.
  if (ev.meta.domain_template) {
    const tmpl = ev.meta.domain_template;
    // Short label for the chip — matches the ObjectiveStack widget's
    // tooltip vocabulary (Cognition / Health rather than the raw enum).
    const TEMPLATE_SHORT: Record<string, string> = {
      software: "Software",
      cognition_health: "Cognition",
      business_ops: "Business",
      behavior_change: "Behavior",
      scientific: "Scientific",
      generic: "Generic",
    };
    const parts: string[] = [TEMPLATE_SHORT[tmpl] ?? tmpl];
    if (typeof ev.meta.layer_count === "number" && ev.meta.layer_count > 0) {
      parts.push(`${ev.meta.layer_count}L`);
    }
    if (
      typeof ev.meta.variable_count === "number" &&
      ev.meta.variable_count > 0
    ) {
      parts.push(`${ev.meta.variable_count}v`);
    }
    chips.push({
      key: "layers-stack",
      label: parts.join(" · "),
      color: appleVibe.accent.primary,
    });
  }
  if (ev.meta.triggered_by === "clarify_complete") {
    chips.push({
      key: "layers-auto",
      label: "auto-fired",
    });
  }
  // ── Phase 11.A — layer_position_set chips ──
  if (
    Array.isArray(ev.meta.prior_layer_ordinals) &&
    ev.meta.prior_layer_ordinals.length > 0 &&
    Array.isArray(ev.meta.layer_ordinals) &&
    ev.meta.layer_ordinals.length > 0
  ) {
    const prior = ev.meta.prior_layer_ordinals.join(",");
    const next = ev.meta.layer_ordinals.join(",");
    chips.push({
      key: "layer-shift",
      label: `L${prior} → L${next}`,
      color: appleVibe.text.tertiary,
    });
  } else if (
    Array.isArray(ev.meta.layer_ordinals) &&
    ev.meta.layer_ordinals.length > 0
  ) {
    chips.push({
      key: "layer-set",
      label: `L${ev.meta.layer_ordinals.join(",")}`,
      color: appleVibe.text.tertiary,
    });
  }
  // ── Arc 3.1 — mechanism_spec_generated chips ──
  if (ev.meta.spec_evidence_strength) {
    const tone =
      ev.meta.spec_evidence_strength === "established"
        ? appleVibe.stage.outcomes
        : ev.meta.spec_evidence_strength === "speculative"
          ? appleVibe.text.tertiary
          : appleVibe.stage.features;
    chips.push({
      key: "spec-evidence",
      label: `evidence: ${ev.meta.spec_evidence_strength}`,
      color: tone,
    });
  }
  if (
    typeof ev.meta.spec_active_ingredient_count === "number" &&
    ev.meta.spec_active_ingredient_count > 0
  ) {
    const n = ev.meta.spec_active_ingredient_count;
    const m =
      typeof ev.meta.spec_component_count === "number"
        ? ev.meta.spec_component_count
        : 0;
    chips.push({
      key: "spec-parts",
      label:
        m > 0
          ? `${n} ingredient${n === 1 ? "" : "s"} · ${m} component${m === 1 ? "" : "s"}`
          : `${n} ingredient${n === 1 ? "" : "s"}`,
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            background: c.color ? `${c.color}10` : appleVibe.surface.chip,
            color: c.color ?? appleVibe.text.tertiary,
          }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

type VisualForAction = {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  color: string;
};

function visualFor(
  action: NotebookEvent["action"],
  meta?: NotebookEvent["meta"],
): VisualForAction {
  switch (action) {
    case "elect":
      return { icon: Check, label: "Elected", color: appleVibe.stage.outcomes };
    case "reject":
      return { icon: X, label: "Rejected", color: appleVibe.stage.pain };
    case "defer":
      return {
        icon: ChevronDown,
        label: "Deferred",
        color: appleVibe.text.tertiary,
      };
    case "clear":
      return {
        icon: RefreshCw,
        label: "Cleared",
        color: appleVibe.text.tertiary,
      };
    case "rd_iterate":
      return {
        icon: FlaskConical,
        label: "Ran experiment",
        color: appleVibe.stage.features,
      };
    case "score":
      return {
        icon: RefreshCw,
        label: "Scored",
        color: appleVibe.stage.features,
      };
    case "approve_bet":
      return {
        icon: Check,
        label: "Approved bet",
        color: appleVibe.stage.outcomes,
      };
    case "compose":
      return {
        icon: Combine,
        label: "Composed design",
        color: appleVibe.accent.primary,
      };
    case "generate_batch":
      return {
        icon: LayoutGrid,
        label: "Generated batch",
        color: appleVibe.text.tertiary,
      };
    case "confirm":
      return {
        icon: Check,
        label: "Confirmed",
        color: appleVibe.text.tertiary,
      };
    case "autopilot_run":
      return {
        icon: Gauge,
        label: "Autopilot started",
        color: appleVibe.stage.features,
      };
    case "autopilot_iteration":
      return {
        icon: Gauge,
        label: "Autopilot iteration",
        color: appleVibe.stage.features,
      };
    // ── Phase 10a — system event visuals ──
    case "room_generated":
      return {
        icon: Layers,
        label: "Room generated",
        color: appleVibe.accent.primary,
      };
    case "item_expanded":
      return {
        icon: Maximize2,
        label: "Expanded item",
        color: appleVibe.stage.features,
      };
    case "expansion_spawned":
      return {
        icon: Plus,
        label: "Spawned deeper",
        color: appleVibe.stage.objective,
      };
    case "prototype_status_changed":
      return {
        icon: RefreshCw,
        label: "Prototype status",
        color: appleVibe.stage.features,
      };
    case "finding_acknowledged":
      return {
        icon: ChevronDown,
        label: "Acknowledged finding",
        color: appleVibe.text.tertiary,
      };
    case "finding_dismissed":
      return {
        icon: X,
        label: "Dismissed finding",
        color: appleVibe.text.tertiary,
      };
    case "finding_resolved":
      return {
        icon: Check,
        label: "Resolved finding",
        color: appleVibe.stage.outcomes,
      };
    case "theme_distilled":
      return {
        icon: ArrowRight,
        label: "Distilled into room",
        color: appleVibe.accent.primary,
      };
    case "concept_branched":
      return {
        icon: ArrowRight,
        label: "Branched from concept",
        color: appleVibe.accent.primary,
      };
    case "constraints_set":
      return {
        icon: RefreshCw,
        label: "Updated constraints",
        color: appleVibe.text.tertiary,
      };
    case "stage_transitioned":
      return {
        icon: ArrowRight,
        label: "Stage advanced",
        color: appleVibe.accent.primary,
      };
    // ── Phase 11.4 ─────────────────────────────────────────────
    case "chains_enriched":
      return {
        icon: Layers,
        label: "Enriched chains",
        color: appleVibe.stage.features,
      };
    // ── Phase 11.6 ─────────────────────────────────────────────
    case "baseline_set":
      return {
        icon: Check,
        label: "Set baseline",
        color: appleVibe.stage.outcomes,
      };
    // ── Phase 11.A — objective layering ────────────────────────
    case "layers_generated":
      return {
        icon: Layers,
        label: "Layers mapped",
        color: appleVibe.accent.primary,
      };
    case "layers_regenerated":
      return {
        icon: Layers,
        label: "Layers remapped",
        color: appleVibe.accent.primary,
      };
    case "layer_position_set":
      return {
        icon: Layers,
        label: "Layer position set",
        color: appleVibe.text.tertiary,
      };
    // ── Arc 3.1 — mechanism technical-depth spec ───────────────
    case "mechanism_spec_generated":
      return {
        icon: FileCode,
        label: "Spec'd mechanism",
        color: appleVibe.stage.features,
      };
    // ── Priority vector — per-sub-objective soft weights ────────
    case "priorities_set":
      return {
        icon: Sliders,
        label: "Tuned priorities",
        color: appleVibe.accent.primary,
      };
    // ── 2026-05-29 — deliverable visibility ─────────────────────
    case "scan_complete":
      return {
        icon: ScanLine,
        label: "Cross-room scan",
        color: appleVibe.accent.primary,
      };
    case "deliverable_generated": {
      // Subtype-specific label so the row reads "Built mockup" rather
      // than a generic "Built deliverable". Falls back when meta missing
      // (e.g. chapter aggregation, where visualFor is called without it).
      const subtypeLabel: Record<string, string> = {
        mockup: "Built mockup",
        export_prompt: "Built export prompt",
        description_doc: "Built description doc",
        prototype_brief: "Built prototype brief",
        agent_spec: "Built agent spec",
      };
      const sub = meta?.deliverable_subtype;
      return {
        icon: Package,
        label:
          (typeof sub === "string" && subtypeLabel[sub]) ||
          "Built deliverable",
        color: appleVibe.accent.primary,
      };
    }
    case "brief_polished":
      return {
        icon: BookText,
        label: "Polished brief",
        color: appleVibe.accent.primary,
      };
    default:
      return {
        icon: RefreshCw,
        label: "Event",
        color: appleVibe.text.tertiary,
      };
  }
}

function formatSubject(ev: NotebookEvent): string | null {
  const parts: string[] = [];
  if (ev.subject.variation_name && ev.subject.entity_name) {
    parts.push(
      `${ev.subject.variation_name} · in ${ev.subject.entity_name}`,
    );
  } else if (ev.subject.entity_name) {
    parts.push(ev.subject.entity_name);
  }
  if (ev.subject.chain_label) {
    parts.push(ev.subject.chain_label);
  }
  // Phase 10b — show room context when populated. The space-scoped
  // GET enriches this; the per-room GET leaves it null. Branchless
  // append keeps the format consistent across both panels.
  if (ev.subject.sub_objective_title) {
    parts.push(`Room: ${ev.subject.sub_objective_title}`);
  }
  return parts.length > 0 ? parts.join(" — ") : null;
}

function formatTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const deltaSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (deltaSec < 60) return "just now";
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  // Older than 24h — show local time HH:MM.
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Phase 10c-polish — fold autopilot child events into their parent row.
//
// AutopilotRunner fires a single `autopilot_run` event up front, then
// iterates chains client-side firing `score` + `rd_iterate` per chain
// via the underlying brainstorm routes (which each log their own
// decision). Without grouping, the timeline shows the parent
// surrounded by ~N×2 child events — high noise, hard to read.
//
// Heuristic: any `score` or `rd_iterate` event that fires within the
// AUTOPILOT_WINDOW_MS after an `autopilot_run` becomes a child of it.
// 5 minutes is comfortably above typical autopilot duration (~30s per
// chain × ~5 chains) and tight enough to avoid sweeping in unrelated
// later manual runs.
//
// We don't try to match by feature_id — the autopilot_run metadata
// stores chain_ids (chain.id), not feature entity_ids, so an exact
// match would need a schema change. Time-window grouping is the
// pragmatic MVP. False positives are rare in single-user workflows.

const AUTOPILOT_WINDOW_MS = 5 * 60 * 1000;
// A run of low-signal "process" steps in the SAME room within this
// window collapses into one chapter, so the timeline reads "Spec'd 7
// mechanisms" instead of 7 identical rows (the screenshot's noise).
const CLUSTER_WINDOW_MS = 12 * 60 * 1000;
const CLUSTER_MIN = 3;

// Individually low-signal steps an orchestrator (room birth, deepen,
// autopilot) fires in bursts. Headline/decision actions are never
// clustered — they always stand alone on the spine.
const CLUSTERABLE_ACTIONS = new Set<NotebookAction>([
  "mechanism_spec_generated",
  "item_expanded",
  "expansion_spawned",
  "score",
  "rd_iterate",
]);

// ── Priority model — what the timeline leads with vs. dims ──────────
// Headline = irreversible / high-meaning moments (decisions, surprising
// results). Muted = pure churn. Everything else is routine. Drives the
// "Key" lens and the resting opacity of standalone rows. This is visual
// weighting of the RECORD only — standing "what to do next" judgments
// live in the Analysis Workbench, not here.
type EventWeight = "headline" | "routine" | "muted";

const HEADLINE_ACTIONS = new Set<NotebookAction>([
  "approve_bet",
  "compose",
  "elect",
  "theme_distilled",
  "concept_branched",
  "baseline_set",
  "layers_generated",
  "layers_regenerated",
  // 2026-05-29 — the user's actual takeaways are headlines.
  "deliverable_generated",
  "brief_polished",
]);

const MUTED_ACTIONS = new Set<NotebookAction>([
  "confirm",
  "clear",
  "generate_batch",
  "finding_acknowledged",
  "finding_dismissed",
  "layer_position_set",
  "constraints_set",
  "prototype_status_changed",
]);

function weightFor(ev: NotebookEvent): EventWeight {
  if (HEADLINE_ACTIONS.has(ev.action)) return "headline";
  // A score that beat baseline is a surprising result → headline.
  if (
    ev.action === "score" &&
    typeof ev.meta.lift_pct === "number" &&
    ev.meta.lift_pct > 0
  )
    return "headline";
  // A scan that surfaced net-new cross-room patterns is the autopilot's
  // closing "I noticed something" — headline. Otherwise routine.
  if (
    ev.action === "scan_complete" &&
    typeof ev.meta.new_finding_count === "number" &&
    ev.meta.new_finding_count > 0
  )
    return "headline";
  if (MUTED_ACTIONS.has(ev.action)) return "muted";
  return "routine";
}

function isHeadlineEvent(ev: NotebookEvent): boolean {
  return weightFor(ev) === "headline";
}

interface Chapter {
  id: string;
  kind: "autopilot" | "process";
  /** The anchor event (autopilot_run, or the newest step in a process
   *  burst) — drives time, room context, and the headline. */
  anchor: NotebookEvent;
  /** Child operations, ordered oldest→newest (read like a transcript). */
  children: NotebookEvent[];
}

type DisplayItem =
  | { kind: "event"; event: NotebookEvent }
  | { kind: "chapter"; chapter: Chapter };

/** Generalized fork-tree builder (replaces the autopilot-only grouper).
 *  Two chapter kinds:
 *    • autopilot — an autopilot_run parent + the score/rd_iterate it
 *      spawned within AUTOPILOT_WINDOW_MS.
 *    • process   — a run of ≥CLUSTER_MIN consecutive clusterable steps
 *      in the same room within CLUSTER_WINDOW_MS (room births, deepen
 *      bursts). Everything else stays a standalone node.
 *  events arrive sorted DESC by created_at (newest first). */
function buildChapters(events: NotebookEvent[]): DisplayItem[] {
  const consumed = new Set<string>();
  const out: DisplayItem[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (consumed.has(ev.id)) continue;

    // 1) Autopilot session.
    if (ev.action === "autopilot_run") {
      const parentTime = new Date(ev.created_at).getTime();
      const children: NotebookEvent[] = [];
      // Walk toward newer events (they came AFTER the run in real time).
      for (let j = i - 1; j >= 0; j--) {
        const cand = events[j];
        if (consumed.has(cand.id)) continue;
        const delta = new Date(cand.created_at).getTime() - parentTime;
        if (delta < 0) continue;
        if (delta > AUTOPILOT_WINDOW_MS) break;
        if (cand.action === "score" || cand.action === "rd_iterate") {
          children.push(cand);
          consumed.add(cand.id);
        }
      }
      consumed.add(ev.id);
      children.reverse();
      out.push({
        kind: "chapter",
        chapter: { id: ev.id, kind: "autopilot", anchor: ev, children },
      });
      continue;
    }

    // 2) Process burst — consecutive same-room clusterable steps.
    if (CLUSTERABLE_ACTIONS.has(ev.action)) {
      const room = ev.subject.sub_objective_id ?? null;
      const anchorTime = new Date(ev.created_at).getTime();
      const run: NotebookEvent[] = [ev];
      for (let j = i + 1; j < events.length; j++) {
        const cand = events[j];
        if (consumed.has(cand.id)) break;
        if (!CLUSTERABLE_ACTIONS.has(cand.action)) break;
        if ((cand.subject.sub_objective_id ?? null) !== room) break;
        const delta = anchorTime - new Date(cand.created_at).getTime();
        if (delta < 0 || delta > CLUSTER_WINDOW_MS) break;
        run.push(cand);
      }
      if (run.length >= CLUSTER_MIN) {
        for (const r of run) consumed.add(r.id);
        out.push({
          kind: "chapter",
          chapter: {
            id: ev.id,
            kind: "process",
            anchor: ev,
            children: [...run].reverse(),
          },
        });
        continue;
      }
      // Too small to be a chapter — fall through as a standalone node.
    }

    out.push({ kind: "event", event: ev });
    consumed.add(ev.id);
  }
  return out;
}

/** Dominant action across a chapter's children (most frequent). */
function dominantAction(children: NotebookEvent[]): NotebookAction {
  const counts = new Map<NotebookAction, number>();
  for (const c of children)
    counts.set(c.action, (counts.get(c.action) ?? 0) + 1);
  let best: NotebookAction = children[0]?.action ?? "score";
  let bestN = 0;
  for (const [a, n] of counts)
    if (n > bestN) {
      bestN = n;
      best = a;
    }
  return best;
}

/** Synthesized one-line headline for a process chapter. */
function clusterHeadline(children: NotebookEvent[]): string {
  const total = children.length;
  const distinct = new Set(children.map((c) => c.action));
  if (distinct.size === 1) {
    const plural = total === 1 ? "" : "s";
    switch (children[0].action) {
      case "mechanism_spec_generated":
        return `Spec'd ${total} mechanism${plural}`;
      case "item_expanded":
        return `Expanded ${total} item${plural}`;
      case "expansion_spawned":
        return `Spawned ${total} deeper node${plural}`;
      case "score":
        return `Scored ${total} chain${plural}`;
      case "rd_iterate":
        return `Ran ${total} experiment${plural}`;
      default:
        break;
    }
  }
  return `${total} operations`;
}

// Empty-state welcome bubble shown when no chat messages exist yet —
// removes the cold-start awkwardness of opening the panel and seeing
// just a blank input. Static content per mode, no LLM call.
function ChatWelcome({ mode }: { mode: "room" | "space" }) {
  return (
    <div
      className="rounded-2xl px-3 py-2.5"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px dashed ${appleVibe.stroke.medium}`,
      }}
    >
      <p
        className="text-[12px] leading-snug"
        style={{ color: appleVibe.text.primary }}
      >
        Hi — I&apos;m the notebook agent. Ask me about{" "}
        {mode === "space"
          ? "anything across your canvas: what rooms are pending, where conflicts are open, what to do next."
          : "this room: what variations are elected, where the score gaps are, what to refine next."}
      </p>
      <p
        className="mt-1.5 text-[10.5px] font-light italic"
        style={{ color: appleVibe.text.tertiary }}
      >
        I can also mark variations / findings / constraints for you. Try
        &ldquo;what should I focus on?&rdquo;
      </p>
    </div>
  );
}

// Chapter row — a collapsible fork-tree node. One synthesized headline
// for a burst of work (autopilot session or a same-room process burst)
// with its child operations folded underneath. Default-collapsed so the
// timeline stays calm; expanding reveals the steps oldest→newest, like
// reading a transcript segment. Generalizes the old AutopilotGroupRow.
function ChapterRow({
  chapter,
  onNavigate,
}: {
  chapter: Chapter;
  onNavigate: (target: NotebookNavigateTarget) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { anchor, children } = chapter;
  const isAuto = chapter.kind === "autopilot";
  const lead = isAuto
    ? { icon: Gauge, color: appleVibe.stage.features }
    : visualFor(dominantAction(children));
  const Icon = lead.icon;
  const time = formatTime(anchor.created_at);
  const room = anchor.subject.sub_objective_title;
  const headline = isAuto ? "Autopilot run" : clusterHeadline(children);

  const scoreCount = children.filter((c) => c.action === "score").length;
  const refineCount = children.filter((c) => c.action === "rd_iterate").length;
  const sub = isAuto
    ? `${
        anchor.meta.chain_count
          ? `${anchor.meta.chain_count} chain${anchor.meta.chain_count === 1 ? "" : "s"}`
          : "Started"
      }${
        children.length > 0
          ? ` · ${scoreCount} scored · ${refineCount} refined`
          : " · no work captured in window"
      }`
    : (room ?? null);

  return (
    <motion.li
      whileHover={{ y: -0.5, transition: { duration: 0.15 } }}
      className="overflow-hidden"
      style={{
        background: `${lead.color}08`,
        borderRadius: appleVibe.radius.sm,
        boxShadow: `0 0 0 1px ${lead.color}1f, 0 6px 18px -12px ${lead.color}66`,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2.5 text-left"
        style={{ padding: "10px 12px" }}
      >
        <div
          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
          style={{ background: `${lead.color}14`, color: lead.color }}
          aria-hidden
        >
          <Icon className="h-3 w-3" strokeWidth={2.4} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="truncate text-[11.5px] font-semibold"
              style={{ color: appleVibe.text.primary }}
            >
              {headline}
            </span>
            <span className="flex flex-shrink-0 items-center gap-1.5">
              <span
                className="rounded-full px-1.5 text-[9.5px] font-semibold tabular-nums"
                style={{ background: `${lead.color}1a`, color: lead.color }}
              >
                {children.length}
              </span>
              <span
                className="font-mono text-[10px] tabular-nums"
                style={{ color: appleVibe.text.tertiary }}
                title={new Date(anchor.created_at).toLocaleString()}
              >
                {time}
              </span>
              <ChevronDown
                className="h-3 w-3 transition-transform duration-150"
                strokeWidth={2.4}
                style={{
                  color: appleVibe.text.tertiary,
                  transform: expanded ? "rotate(180deg)" : "none",
                }}
              />
            </span>
          </div>
          {sub && (
            <p
              className="mt-0.5 truncate text-[11.5px] leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              {sub}
            </p>
          )}
        </div>
      </button>
      {expanded && children.length > 0 && (
        <ul
          className="ml-[22px] mr-3 space-y-1 border-l pb-2.5 pl-3"
          style={{ borderColor: appleVibe.stroke.hairline }}
        >
          {children.map((c) => {
            const v = visualFor(c.action, c.meta);
            const subject = formatSubject(c);
            return (
              <li
                key={c.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate({
                    entityId: c.subject.entity_id ?? null,
                    variationId: c.subject.variation_id ?? null,
                    // Same spawned-room fallback as the top-level row.
                    subObjectiveId:
                      c.subject.sub_objective_id ??
                      c.meta.spawned_sub_objective_id ??
                      null,
                  });
                }}
                className="cursor-pointer text-[11px] leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                <span style={{ color: v.color }}>{v.label}</span>
                {subject ? (
                  <>
                    <span style={{ color: appleVibe.text.tertiary }}>
                      {" — "}
                    </span>
                    <span>{subject}</span>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </motion.li>
  );
}

function groupByDay(
  events: NotebookEvent[],
): Array<{ label: string; events: NotebookEvent[] }> {
  const groups = new Map<string, NotebookEvent[]>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  for (const ev of events) {
    const d = new Date(ev.created_at);
    d.setHours(0, 0, 0, 0);
    let label: string;
    if (d.getTime() === today.getTime()) label = "Today";
    else if (d.getTime() === yesterday.getTime()) label = "Yesterday";
    else
      label = new Date(ev.created_at).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    const arr = groups.get(label) ?? [];
    arr.push(ev);
    groups.set(label, arr);
  }
  return Array.from(groups.entries()).map(([label, evs]) => ({
    label,
    events: evs,
  }));
}
