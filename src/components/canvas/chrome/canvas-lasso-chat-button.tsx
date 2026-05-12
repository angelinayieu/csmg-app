"use client";

// ── Canvas lasso → Chat button ─────────────────────────────────────
//
// Floating pill that appears whenever ≥1 extractable shape is selected.
// Sits to the left of the Summarize button (right-[22rem]).
//
// Clicking the button opens a full-height right-side chat panel scoped
// to the selection. The panel:
//   - Shows a compact list of the selected items as context
//   - Renders a scrollable message thread
//   - Sends messages to /api/canvas/lasso-chat with the selection items
//     and prior turns as context
//
// The component is self-contained: it owns its own open/closed state
// and chat history, so the canvas orchestrator doesn't need to know
// about any of it.

import { useCallback, useMemo, useRef, useState } from "react";
import { useEditor, useValue, createShapeId, type TLShapeId } from "tldraw";
import { MessageSquare, Send, Loader2, Sprout, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  extractShapeContent,
  describeSelection,
  type ExtractedSelection,
} from "@/lib/canvas/extract-shape-content";

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

interface Props {
  spaceId: string;
}

const MIN_SHAPES = 1;

export function CanvasLassoChatButton({ spaceId }: Props) {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sending, setSending] = useState(false);
  // Path A.3 — snapshot the extracted selection when the chat opens so
  // "Plant on canvas" lands the response next to the originally-lassoed
  // shapes even if the user later deselects or moves them. Cleared on
  // close. Without this, planting after a stray click on the canvas
  // would put the sticky in the wrong place (or nowhere).
  const [frozenSelection, setFrozenSelection] =
    useState<ExtractedSelection | null>(null);
  // Tracks which assistant turn is currently being planted (for spinner).
  const [plantingIdx, setPlantingIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const extracted = useValue(
    "lasso-chat-extract",
    () => extractShapeContent(editor?.getSelectedShapes() ?? []),
    [editor],
  );

  const showButton = useMemo(
    () => extracted.summarizable && extracted.items.length >= MIN_SHAPES,
    [extracted.summarizable, extracted.items.length],
  );

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setSending(true);
    setInput("");
    const userTurn: ChatTurn = { role: "user", text: msg };
    setTurns((prev) => [...prev, userTurn]);

    try {
      const res = await fetch("/api/canvas/lasso-chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          items: extracted.items.map((it) => ({
            oneLiner: it.oneLiner,
            content: JSON.stringify(it.content).slice(0, 300),
          })),
          message: msg,
          priorTurns: turns.slice(-6).map((t) => ({
            role: t.role,
            text: t.text,
          })),
        }),
      });
      const data = (await res.json()) as {
        response?: string;
        error?: string;
      };
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.response || "Sorry, couldn't respond.",
        },
      ]);
    } catch {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", text: "Error — please try again." },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
        inputRef.current?.focus();
      }, 50);
    }
  }, [input, sending, extracted.items, spaceId, turns]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setTurns([]);
    setInput("");
    setFrozenSelection(null);
  }, []);

  // Path A.3 — open snapshots the current selection. We freeze the
  // ExtractedSelection (items + bounds) at the moment the chat opens so
  // the plant action below has a stable target. Re-opening starts a
  // fresh snapshot.
  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setFrozenSelection(extracted);
      } else {
        setFrozenSelection(null);
        setTurns([]);
        setInput("");
      }
      return next;
    });
  }, [extracted]);

  // Path A.3 — plant an assistant response on canvas as a sticky note,
  // with dotted-violet arrows from every source shape in the frozen
  // selection back to the new sticky. Mirrors the deep-dive panel's
  // origin→planted arrow pattern + the lasso-summarize source→summary
  // arrow pattern. The sticky is labeled with the user prompt + AI
  // answer so it stays self-explanatory after the chat is dismissed.
  const handlePlantTurn = useCallback(
    async (assistantIdx: number) => {
      if (!editor || !frozenSelection) return;
      const assistantTurn = turns[assistantIdx];
      if (!assistantTurn || assistantTurn.role !== "assistant") return;
      // Find the user turn that prompted this response (most recent
      // user turn before the assistant turn). Falls back to a generic
      // label if the chat starts with an assistant turn for any reason.
      let promptText = "AI response";
      for (let i = assistantIdx - 1; i >= 0; i--) {
        if (turns[i].role === "user") {
          promptText = turns[i].text;
          break;
        }
      }
      setPlantingIdx(assistantIdx);
      try {
        const sb = frozenSelection.selectionBounds;
        // Place to the RIGHT of the selection bbox, vertically centered.
        // Lasso-summarize plants BELOW the bbox; we go right so the two
        // actions don't crash into each other when both are used.
        const stickyW = 240;
        const stickyH = 240;
        const placeX = sb ? Math.round(sb.x + sb.w + 80) : 0;
        const placeY = sb
          ? Math.round(sb.y + sb.h / 2 - stickyH / 2)
          : 0;
        const stickyId = createShapeId();
        const stickyText =
          `Q: ${promptText.slice(0, 240)}\n\n${assistantTurn.text}`.slice(
            0,
            1800,
          );
        editor.createShapes([
          {
            id: stickyId,
            type: "sticky-note" as const,
            x: placeX,
            y: placeY,
            props: {
              text: stickyText,
              color: "blue" as const,
              w: stickyW,
              h: stickyH,
              aiTagged: true,
              entityId: null,
              dimension: "insight" as const,
            },
          },
        ]);
        // Connect every source shape back to the new sticky with the
        // same dotted-violet style the deep-dive panel uses, so the
        // user can read provenance at a glance: "this insight came from
        // those three highlighted things".
        for (const item of frozenSelection.items) {
          try {
            const arrowId = createShapeId();
            editor.createShapes([
              {
                id: arrowId,
                type: "arrow",
                props: {
                  color: "light-violet",
                  size: "s",
                  dash: "dotted",
                },
              },
            ]);
            editor.createBindings([
              {
                fromId: arrowId,
                toId: item.shapeId as TLShapeId,
                type: "arrow",
                props: {
                  terminal: "start",
                  normalizedAnchor: { x: 0.5, y: 0.5 },
                  isExact: false,
                  isPrecise: false,
                },
                meta: {},
              },
              {
                fromId: arrowId,
                toId: stickyId,
                type: "arrow",
                props: {
                  terminal: "end",
                  normalizedAnchor: { x: 0.5, y: 0.5 },
                  isExact: false,
                  isPrecise: false,
                },
                meta: {},
              },
            ]);
          } catch {
            // Per-arrow failure shouldn't break the plant — same
            // pattern lasso-summarize uses.
          }
        }
        editor.select(stickyId);
      } finally {
        setPlantingIdx(null);
      }
    },
    [editor, frozenSelection, turns],
  );

  if (!showButton) return null;

  const count = extracted.items.length;
  const label = describeSelection(extracted);

  return (
    <>
      {/* Toggle pill — sits left of the Summarize button */}
      <div className="pointer-events-none absolute right-[22rem] top-3 z-[45]">
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            "pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-sm backdrop-blur-md transition",
            open
              ? "border-blue-400 bg-blue-600 text-white"
              : "border-blue-200 bg-white/95 text-blue-700 hover:bg-blue-50",
          )}
          title={`Chat with ${count} selected item${count === 1 ? "" : "s"}`}
        >
          <MessageSquare className="h-3 w-3" />
          Chat
          <span
            className={cn(
              "ml-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
              open
                ? "bg-blue-500 text-blue-100"
                : "bg-blue-100 text-blue-700",
            )}
          >
            {count}
          </span>
        </button>
      </div>

      {/* Chat panel */}
      {open && (
        <div
          className="pointer-events-auto absolute right-4 z-[50] flex flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white/95 shadow-xl backdrop-blur-md"
          style={{ top: 56, width: 320, maxHeight: "calc(100vh - 72px)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[11.5px] font-bold text-gray-900">
                Chat with selection
              </div>
              <div className="max-w-[220px] truncate text-[10px] text-gray-500">
                {count} item{count !== 1 ? "s" : ""} · {label}
              </div>
            </div>
            <button
              onClick={handleClose}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {/* Selection context */}
          <div className="border-b border-gray-100 px-3 py-2">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
              Context
            </div>
            <ul className="flex max-h-24 flex-col gap-0.5 overflow-y-auto">
              {extracted.items.slice(0, 6).map((it, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <div className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-blue-400" />
                  <span className="text-[10.5px] leading-snug text-gray-600">
                    {it.oneLiner}
                  </span>
                </li>
              ))}
              {extracted.items.length > 6 && (
                <li className="pl-3 text-[10px] text-gray-400">
                  +{extracted.items.length - 6} more
                </li>
              )}
            </ul>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-3 py-2"
            style={{ maxHeight: 300 }}
          >
            {turns.length === 0 && (
              <div className="py-4 text-center text-[11px] text-gray-400">
                Ask about patterns, gaps, hypotheses, or next steps — I'm
                grounded in your selection.
              </div>
            )}
            {turns.map((t, i) => {
              const isAssistant = t.role === "assistant";
              const isPlanting = plantingIdx === i;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex flex-col gap-1",
                    t.role === "user" ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2 text-[11.5px] leading-relaxed",
                      t.role === "user"
                        ? "rounded-tr-sm bg-blue-600 text-white"
                        : "rounded-tl-sm bg-gray-100 text-gray-800",
                    )}
                  >
                    {t.text}
                  </div>
                  {/* Path A.3 — per-assistant-turn Plant action. Drops the
                      response as a sticky note next to the originally-
                      lassoed selection with dotted-violet arrows back to
                      every source shape, so the user can promote chat
                      insights into canvas artifacts in one click. */}
                  {isAssistant && frozenSelection && (
                    <button
                      type="button"
                      onClick={() => handlePlantTurn(i)}
                      disabled={isPlanting}
                      title="Plant this response as a sticky note linked to the selection"
                      className={cn(
                        "flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:cursor-wait",
                        isPlanting
                          ? "bg-violet-100 text-violet-500"
                          : "bg-violet-50 text-violet-700 hover:bg-violet-100",
                      )}
                    >
                      {isPlanting ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <Sprout className="h-2.5 w-2.5" />
                      )}
                      {isPlanting ? "Planting…" : "Plant on canvas"}
                    </button>
                  )}
                </div>
              );
            })}
            {sending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-gray-100 px-3 py-2">
                  <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                  <span className="text-[10.5px] text-gray-400">
                    Thinking…
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex items-end gap-2 border-t border-gray-100 px-3 py-2.5">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask about the selection…"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[11.5px] text-gray-800 placeholder-gray-400 focus:border-blue-300 focus:bg-white focus:outline-none"
              style={{ maxHeight: 80 }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className={cn(
                "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl transition-all",
                input.trim() && !sending
                  ? "bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                  : "cursor-not-allowed bg-gray-100 text-gray-300",
              )}
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
