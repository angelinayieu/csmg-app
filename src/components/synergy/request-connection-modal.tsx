// ── Request Connection modal ──
//
// Opens from a match card on /app/synergy/discover. Shows a clean,
// confidence-building summary of what the OTHER party will see if
// the user submits — full transparency. Then accepts an optional
// short message and submits.
//
// Privacy: nothing about the sender is leaked beyond what's already
// on their published matchable components. Sender stays anonymous
// to the receiver until the receiver accepts.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Lock,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { createMatchRequest } from "@/lib/synergy/match-client";
import type { RedactedMatch } from "@/lib/synergy/match-client";

interface Props {
  match: RedactedMatch;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}

const MAX_LEN = 500;

export function RequestConnectionModal({ match, open, onClose, onSent }: Props) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ESC to close, focus textarea on open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    setTimeout(() => textareaRef.current?.focus(), 100);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, sending]);

  if (!open) return null;

  const submit = async () => {
    if (sending) return;
    setSending(true);
    try {
      await createMatchRequest({
        fromComponentId: match.mine.id,
        toComponentId: match.theirs.id,
        message: message.trim() || undefined,
      });
      toast.success("Request sent", {
        description:
          "We'll surface their response in your inbox. Profile reveals on accept.",
      });
      setMessage("");
      onSent();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.toLowerCase().includes("already exists")) {
        toast.info("You've already requested this connection.");
        onClose();
      } else {
        toast.error("Couldn't send request", { description: msg });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      style={{
        background: "rgba(15, 23, 42, 0.55)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Request connection"
        className="relative w-full max-w-xl overflow-hidden rounded-3xl"
        style={{
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(20px)",
          boxShadow:
            "0 0 60px -15px rgba(6, 182, 212, 0.4), 0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Inner top cyan accent line */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(6,182,212,0.5) 50%, transparent 100%)",
          }}
        />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200/60 px-6 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 shadow-sm">
              <Send className="h-3.5 w-3.5 text-white" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-gray-900">
                Request connection
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
                Anonymous until they accept
              </div>
            </div>
          </div>
          <button
            onClick={() => !sending && onClose()}
            disabled={sending}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {/* What they'll see */}
          <section>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
              What they&apos;ll see
            </div>
            <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
              <div className="text-[11px] text-gray-600">
                <span className="font-semibold text-gray-900">Their match:</span>{" "}
                an anonymous user reaching out about their{" "}
                <span className="font-semibold">{match.theirs.kind}</span>{" "}
                component &mdash;
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5">
                <div className="text-[12px] font-semibold text-gray-900">
                  {match.theirs.label_public}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-700">
                  {match.theirs.description_public}
                </p>
              </div>
              <div className="text-[11px] text-gray-600">
                <span className="font-semibold text-gray-900">Your offer:</span>{" "}
                they&apos;ll see your matching component &mdash;
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-2.5">
                <div className="text-[12px] font-semibold text-gray-900">
                  {match.mine.label_public}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-700">
                  {match.mine.description_public}
                </p>
              </div>
            </div>
          </section>

          {/* What stays private */}
          <section className="rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-3 w-3 shrink-0 text-amber-700" />
              <div>
                <span className="font-semibold">What stays private:</span> your
                name, email, board, other components, and any unmatched private
                context. Identity reveals only after they accept.
              </div>
            </div>
          </section>

          {/* Message */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="connect-message"
                className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500"
              >
                Optional message · {MAX_LEN - message.length} chars left
              </label>
            </div>
            <textarea
              ref={textareaRef}
              id="connect-message"
              value={message}
              onChange={(e) =>
                setMessage(e.target.value.slice(0, MAX_LEN))
              }
              rows={4}
              placeholder="Why this match resonates, what you&apos;d hope to exchange, any quick context that&apos;d help them decide…"
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] leading-relaxed text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              maxLength={MAX_LEN}
            />
          </section>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 border-t border-gray-200/60 px-6 py-4"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.85) 50%)",
          }}
        >
          <button
            onClick={() => !sending && onClose()}
            disabled={sending}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-gray-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2 text-[12px] font-semibold text-white shadow-[0_4px_20px_-4px_rgba(6,182,212,0.5)] transition hover:scale-[1.02] disabled:opacity-60"
          >
            {sending ? (
              <Sparkles className="h-3 w-3 animate-pulse" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            {sending ? "Sending…" : "Send request"}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
