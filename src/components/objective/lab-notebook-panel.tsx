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
  Check,
  ChevronDown,
  Layers,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
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
}> = [
  { label: "All", actions: null },
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
    ],
  },
];

export function LabNotebookPanel({
  open,
  onClose,
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

  // Group events by day for the timeline display.
  const grouped = useMemo(() => groupByDay(events), [events]);

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

  return (
    <AnimatePresence>
      {open && (
        <>
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
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden md:w-[480px]"
            style={{
              background: appleVibe.surface.card,
              borderLeft: `1px solid ${appleVibe.stroke.hairline}`,
              fontFamily: appleVibe.font.stack,
              boxShadow: "0 0 40px -8px rgba(11,18,40,0.28)",
            }}
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

            {/* Filter chips */}
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

            {/* Scrollable body */}
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
                // Phase 10c-polish — autopilot grouping. Inside each
                // day section, fold score/rd_iterate events that fired
                // within 5 minutes AFTER an autopilot_run into the
                // parent row so the timeline tells the autopilot story
                // as one unit instead of a scattered burst.
                const items = groupAutopilotChildren(dayEvents);
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
                    <ul className="space-y-1.5">
                      {items.map((item) => {
                        if (item.kind === "autopilot_group") {
                          return (
                            <AutopilotGroupRow
                              key={item.parent.id}
                              parent={item.parent}
                              children={item.children}
                              onClick={(target) => onNavigate?.(target)}
                            />
                          );
                        }
                        const ev = item.event;
                        return (
                          <NotebookRow
                            key={ev.id}
                            event={ev}
                            onClick={() =>
                              onNavigate?.({
                                entityId: ev.subject.entity_id ?? null,
                                variationId: ev.subject.variation_id ?? null,
                                subObjectiveId:
                                  ev.subject.sub_objective_id ?? null,
                              })
                            }
                          />
                        );
                      })}
                    </ul>
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
                <Sparkles className="h-2.5 w-2.5" strokeWidth={2.4} />
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
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
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
}: {
  event: NotebookEvent;
  onClick?: () => void;
}) {
  // Phase 10b — visualFor is action-driven; the row click handler
  // now forwards sub_objective_id too so the host can route to the
  // right room from the all-rooms feed.
  const visual = visualFor(ev.action);
  const Icon = visual.icon;
  const subject = formatSubject(ev);
  const time = formatTime(ev.created_at);
  return (
    <motion.li
      whileHover={{ y: -0.5, transition: { duration: 0.15 } }}
      whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
      onClick={onClick}
      className="cursor-pointer transition-colors duration-150 ease-out"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.sm,
        padding: "10px 12px",
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
            border: c.color
              ? `1px solid ${c.color}26`
              : `1px solid ${appleVibe.stroke.hairline}`,
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

function visualFor(action: NotebookEvent["action"]): VisualForAction {
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
        icon: Sparkles,
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
        icon: Sparkles,
        label: "Composed design",
        color: appleVibe.accent.primary,
      };
    case "generate_batch":
      return {
        icon: Sparkles,
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
        icon: Sparkles,
        label: "Autopilot started",
        color: appleVibe.stage.features,
      };
    case "autopilot_iteration":
      return {
        icon: Sparkles,
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
        icon: Sparkles,
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

type DisplayItem =
  | { kind: "event"; event: NotebookEvent }
  | { kind: "autopilot_group"; parent: NotebookEvent; children: NotebookEvent[] };

function groupAutopilotChildren(events: NotebookEvent[]): DisplayItem[] {
  // events arrive sorted DESC by created_at (newest first).
  const consumed = new Set<string>();
  const out: DisplayItem[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (consumed.has(ev.id)) continue;
    if (ev.action !== "autopilot_run") {
      out.push({ kind: "event", event: ev });
      continue;
    }
    const parentTime = new Date(ev.created_at).getTime();
    const children: NotebookEvent[] = [];
    // Walk BACKWARD (toward newer events in DESC order = events with
    // larger timestamps that came AFTER this autopilot_run in real time).
    for (let j = i - 1; j >= 0; j--) {
      const cand = events[j];
      if (consumed.has(cand.id)) continue;
      const candTime = new Date(cand.created_at).getTime();
      const delta = candTime - parentTime;
      if (delta < 0) continue; // older than the parent — skip
      if (delta > AUTOPILOT_WINDOW_MS) break;
      if (cand.action === "score" || cand.action === "rd_iterate") {
        children.push(cand);
        consumed.add(cand.id);
      }
    }
    consumed.add(ev.id);
    // Restore chronological order within children (oldest first).
    children.reverse();
    out.push({ kind: "autopilot_group", parent: ev, children });
  }
  return out;
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

// Autopilot group row — renders the parent autopilot_run prominently
// with its score/rd_iterate children listed underneath as a compact
// summary instead of separate full-height rows.
function AutopilotGroupRow({
  parent,
  children,
  onClick,
}: {
  parent: NotebookEvent;
  children: NotebookEvent[];
  onClick: (target: NotebookNavigateTarget) => void;
}) {
  const time = formatTime(parent.created_at);
  const scoreCount = children.filter((c) => c.action === "score").length;
  const refineCount = children.filter((c) => c.action === "rd_iterate").length;
  return (
    <motion.li
      whileHover={{ y: -0.5, transition: { duration: 0.15 } }}
      className="cursor-default"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stage.features}26`,
        borderLeft: `3px solid ${appleVibe.stage.features}`,
        borderRadius: appleVibe.radius.sm,
        padding: "10px 12px",
      }}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
          style={{
            background: `${appleVibe.stage.features}14`,
            color: appleVibe.stage.features,
          }}
          aria-hidden
        >
          <Sparkles className="h-3 w-3" strokeWidth={2.4} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="text-[11.5px] font-semibold"
              style={{ color: appleVibe.text.primary }}
            >
              Autopilot run
            </span>
            <span
              className="flex-shrink-0 font-mono text-[10px] tabular-nums"
              style={{ color: appleVibe.text.tertiary }}
              title={new Date(parent.created_at).toLocaleString()}
            >
              {time}
            </span>
          </div>
          <p
            className="mt-0.5 text-[11.5px] leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {parent.meta.chain_count
              ? `${parent.meta.chain_count} chain${parent.meta.chain_count === 1 ? "" : "s"}`
              : "Started"}
            {children.length > 0
              ? ` · ${scoreCount} scored · ${refineCount} refined`
              : children.length === 0
                ? " · no work captured in window"
                : ""}
          </p>
          {children.length > 0 && (
            <ul className="mt-2 space-y-1 border-l pl-3" style={{ borderColor: appleVibe.stroke.hairline }}>
              {children.map((c) => {
                const v = visualFor(c.action);
                const subject = formatSubject(c);
                return (
                  <li
                    key={c.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClick({
                        entityId: c.subject.entity_id ?? null,
                        variationId: c.subject.variation_id ?? null,
                        subObjectiveId: c.subject.sub_objective_id ?? null,
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
        </div>
      </div>
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
