"use client";

// ── WhiteboardChatPanel ──
//
// The AI Chat surface for the objective whiteboard. Mounts globally on every
// objective route; lays dormant until something dispatches OPEN_BOARD_CHAT
// (toolbox sphere → "AI Chat" pill). When open, it's a small white card
// overlay in the bottom-right corner, sitting above the toolbox sphere.
//
// Context flows two ways:
//   · "This board"  → server reads the space metadata; client posts a tight
//                     snapshot of every shape currently on the page (title +
//                     one-liner body).
//   · "All boards"  → server adds library_objects from the user's OTHER
//                     spaces as ambient context (toggle in the header).
//
// The response is a regenerable, copyable chunk — long enough to drop straight
// back onto the canvas as a sticky note.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Editor, TLShape } from "tldraw";
import { ArrowUp, Globe, Layers, Waypoints, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export const OPEN_BOARD_CHAT_EVENT = "board:open-chat";

type Scope = "board" | "cross";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
}

interface ShapeSnap {
  kind: string;
  title: string;
  body?: string;
}

/** Extract a board-chat-friendly view of every shape on the current page.
 *  Mirrors the per-type rules used by the AI ops (room/oc/insight/note/text)
 *  so the chat sees the same vocabulary the user does. */
function snapshotBoard(editor: Editor): ShapeSnap[] {
  const shapes = editor.getCurrentPageShapes();
  const out: ShapeSnap[] = [];
  for (const s of shapes as TLShape[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = s.props as any;
    if (s.type === "objective-card" && (p?.title || p?.body)) {
      out.push({ kind: "Objective", title: String(p.title ?? "").slice(0, 160), body: p.body ? String(p.body).slice(0, 400) : undefined });
    } else if (s.type === "room-card" && (p?.title || p?.subtitle)) {
      out.push({ kind: "Room", title: String(p.title ?? "").slice(0, 160), body: p.subtitle ? String(p.subtitle).slice(0, 400) : undefined });
    } else if (s.type === "oc-card" && (p?.name || p?.body)) {
      const k = String(p.kind ?? "Card");
      out.push({ kind: `Card · ${k}`, title: String(p.name ?? "").slice(0, 160), body: p.body ? String(p.body).slice(0, 400) : undefined });
    } else if (s.type === "insight-card" && (p?.headline || p?.body)) {
      out.push({ kind: "Insight", title: String(p.headline ?? "").slice(0, 160), body: p.body ? String(p.body).slice(0, 400) : undefined });
    } else if (s.type === "prompt-sharpening" && p?.sharpenedPrompt) {
      out.push({ kind: "Sharpened prompt", title: String(p.title ?? "").slice(0, 160), body: String(p.sharpenedPrompt).slice(0, 400) });
    } else if (s.type === "voice-note-card" && p?.transcript) {
      out.push({ kind: "Voice note", title: "Voice note", body: String(p.transcript).slice(0, 400) });
    } else if (s.type === "comment-card") {
      const author = String(p?.authorName ?? "You");
      const status = String(p?.status ?? "open");
      const targets = Array.isArray(p?.targetShapeIds) ? p.targetShapeIds.length : 0;
      const head = `Comment by ${author}${targets > 0 ? ` on ${targets} card${targets === 1 ? "" : "s"}` : ""}${status === "resolved" ? " (resolved)" : status === "analyzed" ? " (analyzed)" : ""}`;
      const body = p?.body ? String(p.body).slice(0, 400) : undefined;
      out.push({ kind: "Comment", title: head, body });
    } else if (s.type === "note") {
      const text = String(p?.text ?? "").trim();
      if (text) out.push({ kind: "Sticky note", title: text.slice(0, 160) });
    } else if (s.type === "text" || s.type === "geo") {
      const text = String(p?.text ?? p?.richText ?? "").trim();
      if (text) out.push({ kind: s.type === "text" ? "Text" : "Geo", title: text.slice(0, 160) });
    }
    if (out.length >= 60) break;
  }
  return out;
}

export function WhiteboardChatPanel({
  spaceId,
  editor,
}: {
  spaceId: string;
  editor: Editor | null;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("board");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Open on event (toolbox sphere → AI Chat pill).
  useEffect(() => {
    function onOpen() {
      setOpen(true);
      // focus once the panel paints
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
    window.addEventListener(OPEN_BOARD_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_BOARD_CHAT_EVENT, onOpen);
  }, []);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Auto-scroll on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setError(null);
    const userMsg: Message = { id: idRef.current++, role: "user", text: message };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);
    try {
      const shapes = editor ? snapshotBoard(editor) : [];
      const priorTurns = messages.map((m) => ({ role: m.role, text: m.text }));
      const res = await fetch(`/api/objective/${spaceId}/board-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, scope, shapes, priorTurns }),
      });
      if (!res.ok) throw new Error(`board-chat ${res.status}`);
      const data = (await res.json()) as { response: string };
      const reply = String(data.response ?? "").trim();
      setMessages((prev) => [
        ...prev,
        { id: idRef.current++, role: "assistant", text: reply || "(no response)" },
      ]);
    } catch (err) {
      console.warn("[board-chat]", err);
      setError("Couldn't reach the AI. Try again.");
    } finally {
      setBusy(false);
    }
  }, [input, busy, editor, spaceId, scope, messages]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const onCopy = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard is best-effort */
    }
  };

  const placeholder = useMemo(() => {
    if (scope === "cross") return "Ask across all your boards…";
    return "Ask about this board, or have me draft something…";
  }, [scope]);

  if (!open) return null;

  return (
    <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
      {/* Header — title + scope toggle + close */}
      <div style={header}>
        <span style={titleWrap}>
          <Waypoints style={{ width: 13, height: 13, color: appleVibe.text.secondary }} strokeWidth={2.2} />
          <span style={titleText}>AI Chat</span>
        </span>
        <span style={scopeTabs} role="tablist" aria-label="Chat scope">
          <button
            type="button"
            role="tab"
            aria-selected={scope === "board"}
            onClick={() => setScope("board")}
            style={scopeBtn(scope === "board")}
            title="Use only this board's context"
          >
            <Layers style={{ width: 11, height: 11 }} strokeWidth={2.2} />
            This board
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === "cross"}
            onClick={() => setScope("cross")}
            style={scopeBtn(scope === "cross")}
            title="Also pull in objects from your other boards"
          >
            <Globe style={{ width: 11, height: 11 }} strokeWidth={2.2} />
            All boards
          </button>
        </span>
        <button type="button" title="Close (Esc)" onClick={() => setOpen(false)} style={iconBtn}>
          <X style={{ width: 14, height: 14 }} strokeWidth={2.2} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={feed}>
        {messages.length === 0 && !busy ? (
          <div style={emptyState}>
            <div style={emptyTitle}>What do you want to think about?</div>
            <div style={emptyHelp}>
              I can see every card on this board. Try:
            </div>
            <div style={chipRow}>
              <button type="button" onClick={() => setInput("Summarise this board in 3 bullets.")} style={chip}>
                Summarise this board
              </button>
              <button type="button" onClick={() => setInput("Draft a 1-paragraph problem statement from what's here.")} style={chip}>
                Draft a problem statement
              </button>
              <button type="button" onClick={() => setInput("What's missing or under-specified?")} style={chip}>
                What's missing?
              </button>
            </div>
          </div>
        ) : null}

        {messages.map((m) => (
          <div key={m.id} style={m.role === "user" ? userRow : aiRow}>
            <div style={m.role === "user" ? userBubble : aiBubble}>{m.text}</div>
            {m.role === "assistant" && (
              <button type="button" onClick={() => onCopy(m.text)} style={copyBtn} title="Copy">
                copy
              </button>
            )}
          </div>
        ))}

        {busy && (
          <div style={aiRow}>
            <div style={{ ...aiBubble, color: appleVibe.text.faint }}>
              <span className="oc-chat-pulse">Thinking…</span>
            </div>
          </div>
        )}

        {error && <div style={errBanner}>{error}</div>}
      </div>

      {/* Composer */}
      <div style={composer}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          style={textarea}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!input.trim() || busy}
          style={sendBtn(input.trim().length > 0 && !busy)}
          title="Send (Enter)"
          aria-label="Send"
        >
          <ArrowUp style={{ width: 14, height: 14 }} strokeWidth={2.4} />
        </button>
      </div>

      <style jsx>{`
        :global(.oc-chat-pulse) {
          animation: oc-chat-pulse 1.4s ease-in-out infinite;
        }
        @keyframes oc-chat-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── styles ─────────────────────────────────────────────────────────────────

const panelStyle: CSSProperties = {
  position: "fixed",
  right: 96, // clear the 56px toolbox sphere + 20px inset + margin
  bottom: 20,
  width: 420,
  maxWidth: "calc(100vw - 112px)",
  height: 560,
  maxHeight: "calc(100vh - 40px)",
  display: "flex",
  flexDirection: "column",
  background: "#FFFFFF",
  borderRadius: 18,
  border: "1px solid rgba(15,23,42,0.06)",
  boxShadow:
    "0 30px 80px -28px rgba(11,18,40,0.22), 0 8px 24px -16px rgba(11,18,40,0.12)",
  fontFamily: appleVibe.font.stack,
  zIndex: 90,
  overflow: "hidden",
};

const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 14px",
  borderBottom: "1px solid rgba(15,23,42,0.05)",
  background: "#FFFFFF",
};

const titleWrap: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  flexShrink: 0,
};

const titleText: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: appleVibe.text.primary,
};

const scopeTabs: CSSProperties = {
  marginLeft: 4,
  display: "inline-flex",
  padding: 2,
  borderRadius: 999,
  background: "rgba(15,23,42,0.04)",
};

const scopeBtn = (active: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 9px",
  borderRadius: 999,
  border: "none",
  background: active ? "#FFFFFF" : "transparent",
  color: active ? appleVibe.text.primary : appleVibe.text.secondary,
  fontSize: 10.5,
  fontWeight: 650,
  fontFamily: appleVibe.font.stack,
  cursor: "pointer",
  boxShadow: active ? "0 2px 6px -3px rgba(11,18,40,0.15)" : "none",
  transition: "background 0.15s ease, color 0.15s ease",
});

const iconBtn: CSSProperties = {
  marginLeft: "auto",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 999,
  border: "none",
  background: "transparent",
  color: appleVibe.text.secondary,
  cursor: "pointer",
};

const feed: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: "14px 14px 8px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const emptyState: CSSProperties = {
  marginTop: 8,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const emptyTitle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: appleVibe.text.primary,
};
const emptyHelp: CSSProperties = {
  fontSize: 12,
  color: appleVibe.text.secondary,
};
const chipRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 4,
};
const chip: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 999,
  border: "1px solid rgba(15,23,42,0.08)",
  background: "#FFFFFF",
  fontSize: 11,
  fontWeight: 550,
  color: appleVibe.text.secondary,
  fontFamily: appleVibe.font.stack,
  cursor: "pointer",
};

const userRow: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};
const aiRow: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 4,
};

const userBubble: CSSProperties = {
  maxWidth: "82%",
  padding: "8px 12px",
  borderRadius: 14,
  background: "rgba(15,23,42,0.94)",
  color: "#FFFFFF",
  fontSize: 12.5,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const aiBubble: CSSProperties = {
  maxWidth: "94%",
  padding: "8px 12px",
  borderRadius: 14,
  background: "rgba(15,23,42,0.035)",
  color: appleVibe.text.primary,
  fontSize: 12.5,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const copyBtn: CSSProperties = {
  alignSelf: "flex-start",
  padding: "2px 6px",
  borderRadius: 6,
  border: "none",
  background: "transparent",
  color: appleVibe.text.faint,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};

const errBanner: CSSProperties = {
  alignSelf: "stretch",
  padding: "8px 10px",
  borderRadius: 10,
  background: "rgba(220,38,38,0.07)",
  color: "#B91C1C",
  fontSize: 11.5,
  fontWeight: 600,
};

const composer: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 8,
  padding: "10px 12px 12px",
  borderTop: "1px solid rgba(15,23,42,0.05)",
  background: "#FFFFFF",
};

const textarea: CSSProperties = {
  flex: 1,
  resize: "none",
  border: "1px solid rgba(15,23,42,0.1)",
  borderRadius: 12,
  padding: "9px 12px",
  fontSize: 12.5,
  lineHeight: 1.4,
  fontFamily: appleVibe.font.stack,
  color: appleVibe.text.primary,
  outline: "none",
  background: "#FFFFFF",
  minHeight: 38,
  maxHeight: 140,
};

const sendBtn = (active: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 34,
  height: 34,
  borderRadius: 999,
  border: "none",
  background: active ? appleVibe.text.primary : "rgba(15,23,42,0.08)",
  color: active ? "#FFFFFF" : appleVibe.text.faint,
  cursor: active ? "pointer" : "not-allowed",
  flexShrink: 0,
  transition: "background 0.15s ease, color 0.15s ease",
});
