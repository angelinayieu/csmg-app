"use client";

/**
 * StudioDropzone — the universal zero-commitment capture surface.
 *
 * Mode toggle: "Ask" ↔ "Create".
 *   - Ask (default): query across every whiteboard the user owns. Submits
 *     to POST /api/ask/start, which creates an ask-kind space and fires
 *     the ask-cross-space inngest function; the space page streams the
 *     answer + cited reference entities into place.
 *   - Create: routes into the existing /app/analyze intake (Quick / Standard
 *     / Deep tier selector + full pipeline). No behaviour change — just a
 *     different entry presentation.
 *
 * The toggle is persistent per-session (lastMode in sessionStorage) so users
 * who prefer one mode don't get reset each visit.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  ArrowUpRight,
  Paperclip,
  Loader2,
  X,
  MessageCircleQuestion,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "ask" | "create";

const ASK_PLACEHOLDERS = [
  "Ask anything that touches your whiteboards — I'll stitch an answer from them…",
  "What pattern keeps showing up across your projects?",
  "Compare how two of your whiteboards approach the same problem…",
  "Surface the risks I've flagged anywhere — and which are most connected.",
];

const CREATE_PLACEHOLDERS = [
  "Build a knowledge model of a domain you're learning…",
  "R&D a product — paste the spec, the competitors, the open questions…",
  "Map a strategic decision — the options, the constraints, the consequences…",
  "Drop a paper, a PDF, or a long thread — I'll find the structure.",
];

interface StudioDropzoneProps {
  /** When true (no spaces yet), amps up the empty-state guidance. */
  firstRun?: boolean;
}

export function StudioDropzone({ firstRun = false }: StudioDropzoneProps) {
  const [mode, setMode] = useState<Mode>("ask");
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  // Restore last-used mode on mount (session-scoped).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem("studioDropzone.mode");
    if (saved === "ask" || saved === "create") setMode(saved);
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem("studioDropzone.mode", mode);
  }, [mode]);

  // Reset the placeholder carousel when the mode changes so the first prompt
  // the user sees is always the mode-appropriate one.
  useEffect(() => {
    setPlaceholderIdx(0);
    setError(null);
  }, [mode]);

  const placeholders = mode === "ask" ? ASK_PLACEHOLDERS : CREATE_PLACEHOLDERS;

  useEffect(() => {
    if (input.length > 0) return;
    const id = window.setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % placeholders.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, [input.length, placeholders.length]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);
  const handleDragLeave = useCallback(() => setDragging(false), []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }, []);

  const canSubmit = input.trim().length > 0 || (mode === "create" && file != null);

  // ── Create mode: route into existing /app/analyze flow (full pipeline) ──
  const submitCreate = useCallback(
    (tone: "sketch" | "analyze") => {
      if (!canSubmit || submitting) return;
      setSubmitting(true);
      const seed = input.trim();
      const params = new URLSearchParams();
      if (seed) params.set("seed", seed);
      if (tone === "sketch") params.set("mode", "sketch");
      router.push(`/app/analyze${params.toString() ? `?${params.toString()}` : ""}`);
    },
    [canSubmit, submitting, input, router],
  );

  // ── Ask mode: POST /api/ask/start then navigate to the ask space ──
  const submitAsk = useCallback(async () => {
    if (!canSubmit || submitting) return;
    const query = input.trim();
    if (!query) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/ask/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Ask failed (${res.status})`);
      }
      const { spaceId } = (await res.json()) as { spaceId: string };
      router.push(`/app/space/${spaceId}`);
    } catch (err) {
      console.error("[ask] start failed", err);
      setError(err instanceof Error ? err.message : "Ask failed");
      setSubmitting(false);
    }
  }, [canSubmit, submitting, input, router]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (mode === "ask") {
          void submitAsk();
        } else {
          // Same keyboard contract as before for Create mode.
          if (e.metaKey || e.ctrlKey) submitCreate("analyze");
          else submitCreate("sketch");
        }
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (mode === "ask") void submitAsk();
        else submitCreate("analyze");
      }
    },
    [mode, submitAsk, submitCreate],
  );

  return (
    <div className="w-full max-w-[720px] mx-auto">
      {/* Headline */}
      <h1
        className="text-center text-[28px] font-semibold text-gray-900 mb-4"
        style={{ letterSpacing: "-0.02em", lineHeight: 1.15 }}
      >
        {mode === "ask" ? "What do you want to think about?" : "What are you thinking about?"}
      </h1>

      {/* Ask | Create toggle */}
      <div className="mb-4 flex justify-center">
        <div
          role="tablist"
          aria-label="Mode"
          className="inline-flex items-center rounded-full border border-gray-200 bg-white/70 p-1 shadow-[0_1px_4px_-2px_rgba(0,0,0,0.08)] backdrop-blur-md"
        >
          <ModeTab
            active={mode === "ask"}
            onClick={() => setMode("ask")}
            icon={<MessageCircleQuestion className="h-3.5 w-3.5" />}
            label="Ask"
            sublabel="across whiteboards"
          />
          <ModeTab
            active={mode === "create"}
            onClick={() => setMode("create")}
            icon={<Wand2 className="h-3.5 w-3.5" />}
            label="Create"
            sublabel="new analysis"
          />
        </div>
      </div>

      {/* The dropzone itself */}
      <div
        onDragOver={mode === "create" ? handleDragOver : undefined}
        onDragLeave={mode === "create" ? handleDragLeave : undefined}
        onDrop={mode === "create" ? handleDrop : undefined}
        className={cn(
          "relative rounded-2xl border bg-white/80 backdrop-blur-md transition-all",
          dragging
            ? "border-interaxis-400 bg-interaxis-50/60 shadow-[0_0_0_4px_rgba(10,106,238,0.12)]"
            : "border-gray-200 shadow-[0_12px_32px_-20px_rgba(0,40,120,0.22)]",
        )}
      >
        {/* File chip (Create mode only — Ask doesn't take files for now) */}
        {mode === "create" && file && (
          <div className="px-4 pt-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 pl-2 pr-1 py-1 text-[11px] text-gray-700">
              <Paperclip className="h-3 w-3 text-gray-500" />
              <span className="font-medium max-w-[240px] truncate">{file.name}</span>
              <span className="text-gray-400">· {(file.size / 1024).toFixed(0)}kb</span>
              <button
                onClick={() => setFile(null)}
                className="flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                title="Remove file"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholders[placeholderIdx]}
          rows={3}
          className="block w-full resize-none border-0 bg-transparent px-5 pt-4 pb-2 text-[15px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
          style={{ letterSpacing: "-0.005em" }}
        />

        {/* Action strip — differs per mode */}
        {mode === "create" ? (
          <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2.5">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-700">
              <Paperclip className="h-3 w-3" />
              Attach
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                }}
              />
            </label>

            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] text-gray-400">
              <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-sans text-[9px] text-gray-600">
                Enter
              </kbd>{" "}
              sketch ·{" "}
              <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-sans text-[9px] text-gray-600">
                ⌘↵
              </kbd>{" "}
              full analysis
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => submitCreate("sketch")}
                disabled={!canSubmit || submitting}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all",
                  "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
                title="Fast, cheap, ephemeral — 5–8 entities in ~10s. No credit commitment."
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                Sketch
              </button>
              <button
                onClick={() => submitCreate("analyze")}
                disabled={!canSubmit || submitting}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition-all",
                  "bg-gradient-to-b from-interaxis-500 to-interaxis-700 shadow-[0_4px_12px_-4px_rgba(0,60,200,0.35)]",
                  "hover:shadow-[0_6px_16px_-4px_rgba(0,60,200,0.4)] hover:-translate-y-px",
                  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0",
                )}
                title="Full pipeline — commits to a persistent model."
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUpRight className="h-3.5 w-3.5" />
                )}
                Analyze
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2.5">
            <span className="text-[11px] text-gray-500">
              <MessageCircleQuestion className="inline h-3 w-3 mr-1 -mt-px" />
              Searches across every whiteboard you own.
            </span>
            <span className="text-[10px] text-gray-400 ml-auto">
              <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-sans text-[9px] text-gray-600">
                Enter
              </kbd>{" "}
              ask
            </span>
            <button
              onClick={submitAsk}
              disabled={!canSubmit || submitting}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition-all",
                "bg-gradient-to-b from-interaxis-500 to-interaxis-700 shadow-[0_4px_12px_-4px_rgba(0,60,200,0.35)]",
                "hover:shadow-[0_6px_16px_-4px_rgba(0,60,200,0.4)] hover:-translate-y-px",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0",
              )}
              title="Open a new whiteboard with a synthesized answer."
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5" />
              )}
              Ask
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 text-center text-[11px] text-red-600">{error}</div>
      )}

      {/* First-run helper (Create mode only — Ask needs prior whiteboards to be useful) */}
      {firstRun && mode === "create" && input.length === 0 && !file && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {FIRST_RUN_SEEDS.map((seed) => (
            <button
              key={seed.label}
              onClick={() => setInput(seed.prompt)}
              className="group inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/60 px-3 py-1 text-[11px] font-medium text-gray-700 transition-all hover:border-interaxis-300 hover:bg-white hover:text-interaxis-700"
            >
              <span className="text-gray-400 group-hover:text-interaxis-500">{seed.icon}</span>
              {seed.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
  sublabel,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] font-semibold transition-all",
        active
          ? "bg-gradient-to-b from-interaxis-500 to-interaxis-700 text-white shadow-[0_4px_10px_-4px_rgba(0,60,200,0.35)]"
          : "text-gray-600 hover:text-gray-900",
      )}
    >
      {icon}
      <span className="leading-none">
        {label}
        <span
          className={cn(
            "ml-1.5 text-[10px] font-medium",
            active ? "text-white/80" : "text-gray-400",
          )}
        >
          {sublabel}
        </span>
      </span>
    </button>
  );
}

const FIRST_RUN_SEEDS: Array<{ label: string; icon: string; prompt: string }> = [
  {
    label: "Build a knowledge model",
    icon: "◆",
    prompt: "I want to build a living knowledge model of ",
  },
  {
    label: "R&D a product",
    icon: "▲",
    prompt: "R&D: I'm exploring a product concept around ",
  },
  {
    label: "Make a decision",
    icon: "◇",
    prompt: "I'm deciding between the following options: ",
  },
  {
    label: "Investigate a question",
    icon: "?",
    prompt: "Open question I want to investigate: ",
  },
];
