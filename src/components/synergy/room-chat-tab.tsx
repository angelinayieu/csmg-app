// ── RoomChatTab — chat surface (messages list + composer) ──
//
// Apple Messages restraint, productivity-pro flavor.
//
// Bubbles:
//   - Yours: gray-900 fill, white text, right-aligned, no tail
//   - Theirs: gray-100 fill, gray-900 text, left-aligned, no tail
// Streak handling collapses the gap and hides repeat avatar/timestamp.
// Voice transcripts prefix a small mic glyph. AI summaries (R5+) render
// system-style — no bubble, italic centered text.
//
// Composer at the bottom:
//   - left mic toggle (useSpeech) with hued pulse while listening
//   - center auto-growing textarea, Enter sends, Shift+Enter newlines
//   - right gray-900 send disc with ArrowUp glyph
//
// New messages auto-scroll to bottom unless the user is reading older
// context (then a "↓ N new" pill surfaces above the composer).

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Mic,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { abstractAvatarStyle } from "@/lib/synergy/abstract-avatar";
import { useSpeech } from "@/hooks/synergy/use-speech";
import type { RoomMessage, RoomMessageKind } from "@/lib/synergy/room-messages";

interface Props {
  messages: RoomMessage[];
  loading: boolean;
  myUserId: string;
  theirDisplayName: string | null;
  archived: boolean;
  /** POST helper from useRoomMessages. */
  onSend: (
    body: string,
    opts?: { kind?: RoomMessageKind; meta?: Record<string, unknown> },
  ) => Promise<boolean>;
}

/** Group two consecutive messages into one streak when authored by the
 *  same user AND less than this many ms apart. Matches Apple Messages
 *  spacing rules: streaks render tighter; new author or long pause
 *  resets the avatar + timestamp. */
const STREAK_GAP_MS = 5 * 60 * 1_000;

interface DisplayItem {
  message: RoomMessage;
  isStreakStart: boolean;
  /** True if this message is far enough ahead of the previous to warrant
   *  a centered "Today · HH:MM" separator above it. */
  showTimeSeparator: boolean;
}

export function RoomChatTab({
  messages,
  loading,
  myUserId,
  theirDisplayName,
  archived,
  onSend,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  // Voice dictation flow — mirrors the Focus Mode Stage 3 "Other" answer
  // pattern. Speech.interim appends greyed text; speech final commits
  // a slice to the textarea draft so the user can edit before sending.
  const handleVoiceFinal = (text: string) => {
    const chunk = text.trim();
    if (!chunk) return;
    setDraft((prev) => (prev ? `${prev} ${chunk}` : chunk));
  };
  const speech = useSpeech(handleVoiceFinal);

  // Auto-scroll control: only stick to bottom if the user is already
  // near the bottom. If they've scrolled up to read history, leave the
  // viewport alone and show a "↓ new" pill instead.
  const [stickToBottom, setStickToBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom) {
      el.scrollTop = el.scrollHeight;
      setUnseenCount(0);
    } else {
      setUnseenCount((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom < 40;
    setStickToBottom(near);
    if (near) setUnseenCount(0);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStickToBottom(true);
    setUnseenCount(0);
  };

  // Compose display items (streaks + time separators).
  const items = useMemo<DisplayItem[]>(() => {
    const out: DisplayItem[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const prev = i > 0 ? messages[i - 1] : null;
      const sameAuthor = prev?.author_id === m.author_id;
      const gap = prev
        ? new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()
        : Infinity;
      const showTimeSeparator = gap > STREAK_GAP_MS;
      const isStreakStart = !sameAuthor || showTimeSeparator;
      out.push({ message: m, isStreakStart, showTimeSeparator });
    }
    return out;
  }, [messages]);

  const onSubmit = async () => {
    const text = draft.trim();
    if (!text || sending || archived) return;
    setSending(true);
    // Optimistic clear — if the send fails, we restore the draft.
    const prior = draft;
    setDraft("");
    const ok = await onSend(text, {
      kind: speech.listening ? "voice_transcript" : "text",
    });
    setSending(false);
    if (!ok) {
      setDraft(prior);
      return;
    }
    // Stop dictation when a voice-built message ships, otherwise the
    // user keeps recording silently.
    if (speech.listening) speech.stop();
    composerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSubmit();
    }
  };

  const toggleMic = () => {
    if (!speech.supported) return;
    if (speech.listening) speech.stop();
    else speech.start();
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {loading ? (
          <SkeletonBubbles />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.map((item, idx) => (
              <MessageItem
                key={item.message.id}
                item={item}
                prev={idx > 0 ? items[idx - 1] : null}
                myUserId={myUserId}
                theirDisplayName={theirDisplayName}
              />
            ))}
          </ul>
        )}
      </div>

      {/* "↓ new" pill */}
      {unseenCount > 0 && (
        <button
          onClick={jumpToBottom}
          className="font-numerical absolute bottom-[88px] left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1 text-[11px] font-medium tabular-nums text-white shadow-lg transition hover:bg-black"
        >
          <ArrowDown className="h-3 w-3" strokeWidth={1.75} />
          {unseenCount} new
        </button>
      )}

      {/* Composer */}
      <div className="border-t border-gray-200/70 bg-white px-3 py-2.5">
        <div className="flex items-end gap-2">
          {/* Mic toggle */}
          <button
            onClick={toggleMic}
            disabled={!speech.supported || archived}
            className={[
              "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition",
              speech.listening
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200",
              !speech.supported || archived ? "opacity-40" : "",
            ].join(" ")}
            title={
              !speech.supported
                ? "Voice not supported in this browser"
                : speech.listening
                  ? "Stop dictation"
                  : "Speak instead of typing"
            }
            aria-label={speech.listening ? "Stop dictation" : "Start dictation"}
          >
            <Mic className="h-3.5 w-3.5" strokeWidth={1.75} />
            {speech.listening && (
              <span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{
                  boxShadow: "0 0 0 0 rgba(15,23,42,0.4)",
                  animation: "roomChatMicPulse 1.4s ease-out infinite",
                }}
              />
            )}
          </button>

          {/* Textarea */}
          <textarea
            ref={composerRef}
            value={
              speech.listening && speech.interim
                ? `${draft}${draft ? " " : ""}${speech.interim}`
                : draft
            }
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={archived ? "Archived" : "Type or speak…"}
            rows={1}
            disabled={archived}
            className="font-display max-h-[80px] min-h-[28px] flex-1 resize-none rounded-xl border-0 bg-transparent px-1 py-1 text-[13.5px] leading-snug text-gray-900 outline-none placeholder:text-gray-400 disabled:opacity-50"
          />

          {/* Send */}
          <button
            onClick={onSubmit}
            disabled={!draft.trim() || sending || archived}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white transition hover:bg-black disabled:opacity-40 disabled:hover:bg-gray-900"
            title="Send"
            aria-label="Send message"
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <style jsx global>{`
        @keyframes roomChatMicPulse {
          0% { box-shadow: 0 0 0 0 rgba(15,23,42,0.35); }
          100% { box-shadow: 0 0 0 7px rgba(15,23,42,0); }
        }
      `}</style>
    </div>
  );
}

// ── Message item ────────────────────────────────────────────────────

function MessageItem({
  item,
  myUserId,
  theirDisplayName,
}: {
  item: DisplayItem;
  prev: DisplayItem | null;
  myUserId: string;
  theirDisplayName: string | null;
}) {
  const m = item.message;
  const mine = m.author_id === myUserId;
  const actorLabel = mine ? "You" : theirDisplayName ?? "Anon";

  // AI summaries render system-style: centered, italic, no bubble.
  if (m.kind === "ai_summary") {
    return (
      <li className="my-2 flex items-center justify-center gap-1.5 px-6 text-center">
        <Sparkles className="h-3 w-3 text-gray-400" strokeWidth={1.5} />
        <span className="text-[11.5px] italic leading-snug text-gray-500">
          {m.body}
        </span>
      </li>
    );
  }

  return (
    <li className={mine ? "flex flex-col items-end" : "flex flex-col items-start"}>
      {item.showTimeSeparator && (
        <div className="my-2 w-full text-center font-mono text-[9px] uppercase tracking-[0.12em] text-gray-400">
          {formatTimeSeparator(m.created_at)}
        </div>
      )}
      {item.isStreakStart && (
        <div
          className={[
            "mt-2 mb-1 flex items-center gap-1.5 px-1 text-[10.5px] text-gray-500",
            mine ? "flex-row-reverse" : "",
          ].join(" ")}
        >
          <div
            style={{
              ...abstractAvatarStyle(m.author_id, 18),
              flexShrink: 0,
              fontSize: 7,
            }}
            aria-hidden
          />
          <span className="font-semibold text-gray-700">{actorLabel}</span>
          {m.kind === "voice_transcript" && (
            <Mic
              className="h-2.5 w-2.5 text-gray-400"
              strokeWidth={1.75}
              aria-label="Voice transcript"
            />
          )}
        </div>
      )}
      <div
        className={[
          "max-w-[78%] rounded-2xl px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap break-words",
          mine
            ? "bg-gray-900 text-white"
            : "bg-gray-100 text-gray-900",
        ].join(" ")}
      >
        {m.body}
      </div>
    </li>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function formatTimeSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `Today · ${hh}:${mm}`;
  if (isYesterday) return `Yesterday · ${hh}:${mm}`;
  return `${d.toLocaleDateString()} · ${hh}:${mm}`;
}

function SkeletonBubbles() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={i % 2 === 0 ? "self-start" : "self-end"}
        >
          <div
            className="h-7 w-44 rounded-2xl bg-gray-100"
            style={{
              animation: "roomTimelineShimmer 1.6s ease-in-out infinite",
              animationDelay: `${i * 0.12}s`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <MessageSquare className="h-5 w-5 text-gray-300" strokeWidth={1.5} />
      <p className="text-[12px] font-semibold text-gray-700">No messages yet</p>
      <p className="max-w-[200px] text-[11px] leading-relaxed text-gray-500">
        Talk through what you&apos;re working on. Voice or text — both land
        in this thread.
      </p>
    </div>
  );
}
