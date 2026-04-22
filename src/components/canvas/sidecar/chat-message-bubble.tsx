"use client";

// ── ChatMessageBubble (Arc 5C.6) ───────────────────────────────────────
//
// Single bubble for user / assistant text messages. User messages are
// right-aligned with an indigo fill; assistant messages are glass cards
// with ring-1 border. "Enriching" state for assistants shows a 3-dot
// pulse under the bubble (reduced-motion → static "Thinking deeper…").

import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

interface Props {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  enriching?: boolean;
}

function formatTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function ChatMessageBubble({ role, text, createdAt, enriching }: Props) {
  const reducedMotion = useReducedMotion();
  const isUser = role === "user";

  return (
    <div
      className={cn(
        "flex max-w-[88%] flex-col",
        isUser ? "ml-auto items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
          isUser
            ? "bg-indigo-500 text-white shadow-[0_1px_2px_rgba(99,102,241,0.25)]"
            : "bg-white text-slate-800 ring-1 ring-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        )}
      >
        {text || (isUser ? "" : <span className="opacity-40">…</span>)}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span
          className={cn(
            "text-[10px] tabular-nums",
            isUser ? "text-indigo-400" : "text-slate-400",
          )}
        >
          {formatTimestamp(createdAt)}
        </span>
        {enriching && !isUser && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-medium text-indigo-500",
            )}
            aria-live="polite"
          >
            {reducedMotion ? (
              <span>Thinking deeper…</span>
            ) : (
              <>
                <span className="inline-flex gap-[2px]">
                  <span
                    className="h-1 w-1 rounded-full bg-indigo-400 animate-bounce"
                    style={{ animationDuration: "1.2s", animationDelay: "0ms" }}
                  />
                  <span
                    className="h-1 w-1 rounded-full bg-indigo-400 animate-bounce"
                    style={{ animationDuration: "1.2s", animationDelay: "200ms" }}
                  />
                  <span
                    className="h-1 w-1 rounded-full bg-indigo-400 animate-bounce"
                    style={{ animationDuration: "1.2s", animationDelay: "400ms" }}
                  />
                </span>
                <span className="ml-0.5">Thinking deeper</span>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
