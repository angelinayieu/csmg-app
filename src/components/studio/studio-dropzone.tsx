"use client";

/**
 * StudioDropzone — the universal zero-commitment capture surface.
 *
 * This is the single input on the Studio landing. It replaces the previous
 * GlobalQueryBox / WelcomeHero stack. Design discipline:
 *
 *   - ONE field. Keyboard-focused on mount. Accepts typed text, pasted content,
 *     dropped files, and clipboard-pasted images (the first three for now; OCR
 *     image flow deferred to the existing /app/analyze path).
 *   - TWO affordances exposed directly: "Sketch" (cheap, ephemeral, ~10s) and
 *     "Analyze" (commits to a full model; routes to the existing /app/analyze
 *     flow pre-filled with the user's input).
 *   - Inline file indicator when user drags a file in — no separate upload
 *     modal.
 *   - Placeholder rotates across four archetypal use-cases so the user sees
 *     that the system adapts to many downstream paths, not just "analyze a
 *     document".
 *
 * Sketch mode is currently a prefilled redirect into /app/analyze with the
 * `?seed=...&mode=sketch` hint. A dedicated sketch pipeline is a follow-up;
 * keeping this layer stable now lets the rest of Studio ship.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowUpRight, Paperclip, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const PLACEHOLDERS = [
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
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  // Auto-focus on mount so the first thing a user can do is type.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Rotate placeholders every 4s while the field is empty — advertises that
  // the dropzone is purpose-agnostic without requiring a feature grid.
  useEffect(() => {
    if (input.length > 0) return;
    const id = window.setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, [input.length]);

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

  const canSubmit = input.trim().length > 0 || file != null;

  const submit = useCallback(
    (mode: "sketch" | "analyze") => {
      if (!canSubmit || submitting) return;
      setSubmitting(true);
      const seed = input.trim();
      // Route into the existing /app/analyze capture surface with a mode hint.
      // The full Sketch pipeline (cheap, ephemeral, ~10s) can swap in later
      // behind this same entry point without the Studio UI needing changes.
      const params = new URLSearchParams();
      if (seed) params.set("seed", seed);
      if (mode === "sketch") params.set("mode", "sketch");
      router.push(`/app/analyze${params.toString() ? `?${params.toString()}` : ""}`);
    },
    [canSubmit, submitting, input, router],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit("analyze");
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit("sketch");
      }
    },
    [submit],
  );

  return (
    <div className="w-full max-w-[720px] mx-auto">
      {/* Headline — the single question the product asks */}
      <h1
        className="text-center text-[28px] font-semibold text-gray-900 mb-5"
        style={{ letterSpacing: "-0.02em", lineHeight: 1.15 }}
      >
        What are you thinking about?
      </h1>

      {/* The dropzone itself */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative rounded-2xl border bg-white/80 backdrop-blur-md transition-all",
          dragging
            ? "border-interaxis-400 bg-interaxis-50/60 shadow-[0_0_0_4px_rgba(10,106,238,0.12)]"
            : "border-gray-200 shadow-[0_12px_32px_-20px_rgba(0,40,120,0.22)]",
        )}
      >
        {/* File chip, if attached */}
        {file && (
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
          placeholder={PLACEHOLDERS[placeholderIdx]}
          rows={3}
          className="block w-full resize-none border-0 bg-transparent px-5 pt-4 pb-2 text-[15px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
          style={{ letterSpacing: "-0.005em" }}
        />

        {/* Action strip */}
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
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-sans text-[9px] text-gray-600">Enter</kbd>{" "}
            sketch ·{" "}
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-sans text-[9px] text-gray-600">⌘↵</kbd>{" "}
            full analysis
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => submit("sketch")}
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
              onClick={() => submit("analyze")}
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
      </div>

      {/* First-run helper: four concrete seed ideas.
          Disappears as soon as the user types — keeps the first screen calm. */}
      {firstRun && input.length === 0 && !file && (
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
