"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Send, Loader2, MessageSquarePlus, Sparkles, Bookmark } from "lucide-react";

interface Comment {
  id: string;
  text: string;
  createdAt: number;
  aiResponse?: string;
}

interface CommentModalProps {
  spaceId: string;
  onClose: () => void;
}

export function CommentModal({ spaceId, onClose }: CommentModalProps) {
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingResponse, setStreamingResponse] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMounted(true);
    // Load saved comments from localStorage
    const raw = localStorage.getItem(`comments:${spaceId}`);
    if (raw) {
      try {
        setComments(JSON.parse(raw));
      } catch {
        // ignore
      }
    }
    // Focus textarea
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [spaceId]);

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function saveComments(next: Comment[]) {
    setComments(next);
    localStorage.setItem(`comments:${spaceId}`, JSON.stringify(next));
  }

  function handleSave() {
    if (!text.trim()) return;
    const next: Comment[] = [
      { id: crypto.randomUUID(), text: text.trim(), createdAt: Date.now() },
      ...comments,
    ];
    saveComments(next);
    setText("");
  }

  async function handleAskAI() {
    if (!text.trim() || loading) return;
    setLoading(true);
    setStreamingResponse("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          message: text.trim(),
          operation: "question",
          history: [],
        }),
      });

      if (!res.ok || !res.body) {
        setStreamingResponse("Error: could not reach AI.");
        setLoading(false);
        return;
      }

      // Stream SSE response
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          try {
            const event = JSON.parse(payload);
            if (event.type === "delta" && event.text) {
              accumulated += event.text;
              setStreamingResponse(accumulated);
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Save as comment with AI response
      if (accumulated) {
        const next: Comment[] = [
          {
            id: crypto.randomUUID(),
            text: text.trim(),
            createdAt: Date.now(),
            aiResponse: accumulated,
          },
          ...comments,
        ];
        saveComments(next);
        setText("");
        setStreamingResponse("");
      }
    } catch {
      setStreamingResponse("Error: request failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleDelete(id: string) {
    saveComments(comments.filter((c) => c.id !== id));
  }

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[120] bg-black/25 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-x-4 top-[6%] bottom-[6%] z-[121] mx-auto flex max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-interaxis-50 text-interaxis-600">
              <MessageSquarePlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">
                Comments & AI Reasoning
              </h2>
              <p className="text-xs text-gray-500">
                Add notes to this analysis or ask the AI to reason on your thoughts.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Input */}
        <div className="border-b border-gray-100 p-6">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a comment, or ask the AI to reason on something specific..."
            rows={4}
            className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-interaxis-300 focus:bg-white focus:ring-2 focus:ring-interaxis-100"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleAskAI}
              disabled={!text.trim() || loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-interaxis-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-interaxis-600 disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {loading ? "Thinking..." : "Ask AI to reason"}
            </button>
            <button
              onClick={handleSave}
              disabled={!text.trim() || loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40"
            >
              <Bookmark className="h-4 w-4" />
              Save comment
            </button>
          </div>

          {/* Streaming response */}
          {streamingResponse && (
            <div className="mt-4 rounded-xl border border-interaxis-200 bg-interaxis-50/40 p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-interaxis-700">
                <Sparkles className="h-3 w-3" />
                AI Response
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">
                {streamingResponse}
                {loading && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-interaxis-500" />}
              </p>
            </div>
          )}
        </div>

        {/* Saved comments */}
        <div className="flex-1 overflow-y-auto p-6">
          {comments.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              No comments yet. Write a note above to get started.
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Saved ({comments.length})
              </h3>
              {comments.map((c) => (
                <div
                  key={c.id}
                  className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 text-sm text-gray-800">{c.text}</p>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="flex-shrink-0 rounded p-1 text-gray-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {c.aiResponse && (
                    <div className="mt-3 rounded-lg bg-interaxis-50/40 p-3">
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-interaxis-700">
                        <Sparkles className="h-2.5 w-2.5" />
                        AI Response
                      </div>
                      <p className="whitespace-pre-wrap text-xs text-gray-700">
                        {c.aiResponse}
                      </p>
                    </div>
                  )}
                  <p className="mt-2 text-[10px] text-gray-400">
                    {new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-2.5">
          <p className="text-[10px] text-gray-400">
            Comments are saved locally in your browser. Sync to cloud coming soon.
          </p>
        </div>
      </div>

      {/* Send icon */}
      <span className="hidden">
        <Send />
      </span>
    </>,
    document.body
  );
}
