"use client";

// ── CardChatbox (Arc 5C.5) ─────────────────────────────────────────────
//
// The multi-turn chat surface that layers on top of the CardSidecar.
// Two pieces:
//   1. The message history area — takes over the tab content when chat
//      has any messages for the selected card.
//   2. The input bar — always anchored at the sidecar bottom so typing
//      feels continuous regardless of which tab is active.
//
// Typing any text fades the tab content out and reveals the chat. Chat
// history is per-shape (see useCardChat).

import { useEffect, useRef, useState } from "react";
import { Send, MessageSquareText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import {
  useCardChat,
  type ChatMessage,
} from "../hooks/use-card-chat";
import type { CardContext } from "../hooks/use-card-sidecar-context";
import { ChatMessageBubble } from "./chat-message-bubble";
import { ProposedChangeCard } from "./proposed-change-card";
import { toast } from "@/lib/hooks/use-toast";

interface Props {
  spaceId: string;
  context: CardContext | null;
  /** When true, the history area is rendered on top of the tab content.
   *  Parent controls this via the tab/chat toggle. */
  historyVisible: boolean;
  /** Parent should set this when the user starts typing / sends.
   *  The sidecar uses it to auto-switch to chat mode visually. */
  onHistoryVisibleChange?: (visible: boolean) => void;
  /** Arc 5C.7: promoted probe text. When this changes, the chatbox
   *  pre-fills the input, focuses the textarea, and switches to chat
   *  history view. Reset to null after consumption. */
  prefillText?: string | null;
  onPrefillConsumed?: () => void;
}

export function CardChatbox({
  spaceId,
  context,
  historyVisible,
  onHistoryVisibleChange,
  prefillText,
  onPrefillConsumed,
}: Props) {
  const reducedMotion = useReducedMotion();
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const historyEndRef = useRef<HTMLDivElement | null>(null);

  const { messages, sending, send, setProposalDecision, hasHistory, clearHistory } = useCardChat({
    spaceId,
    context,
    onError: (msg) => toast.error("Chat error", { description: msg }),
  });

  // Auto-switch the parent to history view whenever a message lands.
  useEffect(() => {
    if (hasHistory && !historyVisible) {
      onHistoryVisibleChange?.(true);
    }
  }, [hasHistory, historyVisible, onHistoryVisibleChange]);

  // Auto-scroll to latest message when new ones arrive.
  useEffect(() => {
    if (historyVisible && historyEndRef.current) {
      historyEndRef.current.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "end",
      });
    }
  }, [messages.length, historyVisible, reducedMotion]);

  // Arc 5C.7: consume pre-fill from probe-promotion.
  useEffect(() => {
    if (!prefillText) return;
    setInput(prefillText);
    onHistoryVisibleChange?.(true);
    // Defer focus so the textarea is rendered before we focus it.
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      // Move caret to end
      const el = textareaRef.current;
      if (el) el.setSelectionRange(prefillText.length, prefillText.length);
    });
    onPrefillConsumed?.();
  }, [prefillText, onHistoryVisibleChange, onPrefillConsumed]);

  // Auto-grow the textarea (max 3 lines).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 72; // ~3 lines @ 13px/1.4
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [input]);

  const canSend = input.trim().length > 0 && !sending && !!context;

  const handleSend = async () => {
    if (!canSend) return;
    const text = input.trim();
    setInput("");
    // Reset textarea height after send
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await send(text);
  };

  const handleApplyProposal = async (messageId: string, message: ChatMessage) => {
    if (message.role !== "assistant" || message.kind !== "proposed_change") return;
    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          action: "apply_inline_proposal",
          proposal: message.proposal,
          origin: "chat",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Apply failed" }));
        throw new Error(err.error ?? "Apply failed");
      }
      const data = (await res.json()) as { note?: string; needs_regen?: boolean };
      setProposalDecision(messageId, "applied", data.note);
      toast.success(data.needs_regen ? "Pivot flagged" : "Change applied", {
        description: data.note,
      });
    } catch (e) {
      toast.error("Couldn't apply", { description: (e as Error).message });
    }
  };

  const handleSkipProposal = (messageId: string) => {
    setProposalDecision(messageId, "skipped");
    toast.info("Skipped", { description: "You can re-ask the AI later." });
  };

  return (
    <>
      {/* History area — renders above the chat input when visible. */}
      {historyVisible && (
        <section
          role="log"
          aria-label="Chat history"
          aria-live="polite"
          className={cn(
            "absolute inset-x-0 top-[88px] bottom-[64px] flex flex-col overflow-y-auto px-4 py-3",
            "bg-gradient-to-b from-white/92 via-white/88 to-white/92 backdrop-blur-xl",
            !reducedMotion && "transition-opacity duration-180",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
              <MessageSquareText className="h-3 w-3" />
              Chat
            </span>
            <div className="flex items-center gap-1">
              {hasHistory && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Clear chat history for this card?")) {
                      clearHistory();
                    }
                  }}
                  className={cn(
                    "text-[10px] font-semibold text-slate-400 hover:text-slate-700",
                    !reducedMotion && "transition-colors duration-150",
                  )}
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                aria-label="Return to tab view"
                onClick={() => onHistoryVisibleChange?.(false)}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-slate-300 hover:bg-slate-100 hover:text-slate-700",
                  !reducedMotion && "transition-colors duration-150",
                )}
                title="Hide chat history (return to tabs)"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <MessageSquareText className="h-7 w-7 text-slate-300" aria-hidden />
              <p className="text-[11.5px] text-slate-500">
                Ask a question, request a change, or share a thought about this card.
              </p>
            </div>
          ) : (
            <ul className="flex-1 space-y-3">
              {messages.map((m) => {
                if (m.role === "user") {
                  return (
                    <li key={m.id} className="flex justify-end">
                      <ChatMessageBubble role="user" text={m.text} createdAt={m.createdAt} />
                    </li>
                  );
                }
                if (m.kind === "proposed_change") {
                  return (
                    <li key={m.id} className="flex">
                      <ProposedChangeCard
                        preamble={m.preamble}
                        proposal={m.proposal}
                        decision={m.decision}
                        decisionNote={m.decisionNote}
                        onApply={() => handleApplyProposal(m.id, m)}
                        onSkip={() => handleSkipProposal(m.id)}
                      />
                    </li>
                  );
                }
                return (
                  <li key={m.id} className="flex">
                    <ChatMessageBubble
                      role="assistant"
                      text={m.text}
                      createdAt={m.createdAt}
                      enriching={m.enriching}
                    />
                  </li>
                );
              })}
              <div ref={historyEndRef} aria-hidden />
            </ul>
          )}
        </section>
      )}

      {/* Input bar — always anchored at the bottom of the sidecar. */}
      <footer
        className={cn(
          "absolute inset-x-0 bottom-0 h-16 border-t border-slate-200/70 bg-white/88 backdrop-blur-xl px-3 py-2",
        )}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            onFocus={() => {
              if (hasHistory) onHistoryVisibleChange?.(true);
            }}
            placeholder={
              context
                ? "Ask about this card…"
                : "Select a card first"
            }
            disabled={!context || sending}
            rows={1}
            aria-label="Chat input"
            className={cn(
              "flex-1 resize-none rounded-xl bg-slate-50/70 px-3 py-2 text-[13px] leading-relaxed text-slate-900 placeholder:text-slate-400",
              "ring-1 ring-transparent focus:bg-white focus:ring-indigo-300 focus:outline-none",
              !reducedMotion && "transition-[background,box-shadow] duration-150",
              !context && "cursor-not-allowed opacity-50",
            )}
            style={{ maxHeight: 72 }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className={cn(
              "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full",
              canSend
                ? "bg-indigo-500 text-white shadow-[0_1px_2px_rgba(99,102,241,0.3)] hover:bg-indigo-600"
                : "bg-slate-200 text-slate-400 cursor-not-allowed",
              !reducedMotion && "transition-colors duration-150",
            )}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </footer>
    </>
  );
}
