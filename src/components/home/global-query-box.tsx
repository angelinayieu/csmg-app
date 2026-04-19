"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Zap, Image, Video, Mic, ArrowUpRight, Maximize2 } from "lucide-react";

export function GlobalQueryBox() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const expandToCanvas = useCallback(() => {
    // "Expand to canvas" now routes into /app/analyze (the seed → analysis
    // entry). The standalone /app/canvas route was retired in the route
    // consolidation; /app/analyze is the canonical capture entry point.
    const query = input.trim();
    if (query) {
      router.push(`/app/analyze?seed=${encodeURIComponent(query)}`);
    } else {
      router.push("/app/analyze");
    }
  }, [input, router]);

  const handleSubmit = useCallback(() => {
    const query = input.trim();
    if (!query || loading) return;

    if (/^(create|new|analyze|build|decompose|map)/i.test(query)) {
      router.push("/app/analyze");
      return;
    }
    if (/^(weave|bridge|connect|link)/i.test(query)) {
      router.push("/app/weave");
      return;
    }
    if (/^(meta|overview|all spaces|graph)/i.test(query)) {
      router.push("/app/bridges");
      return;
    }

    setLoading(true);
    router.push("/app/analyze");
  }, [input, loading, router]);

  return (
    <div className="anim-fade-up delay-1200 w-full max-w-[820px] mx-auto mt-4 text-center">
      {/* Prompt text */}
      <p className="mb-2 text-lg font-normal text-gray-800" style={{ letterSpacing: "-0.025em", lineHeight: 1.25 }}>
        Create a{" "}
        <span
          className="font-semibold"
          style={{
            background: "linear-gradient(90deg, var(--accent-600), var(--accent-700))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          new analysis
        </span>
        , or query one that already exists.
      </p>

      {/* Chatbox */}
      <div
        className="glass-chat relative rounded-3xl p-3 text-left"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Hover-reveal: expand to canvas */}
        <button
          onClick={expandToCanvas}
          className={`pointer-events-auto absolute -top-3 right-4 z-20 flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-blue-700 shadow-md transition-all duration-200 ${
            hovered
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-1 opacity-0"
          }`}
          title={
            input.trim()
              ? `Open "${input.slice(0, 40)}${input.length > 40 ? "…" : ""}" in Universal Canvas`
              : "Open Universal Canvas"
          }
        >
          <Maximize2 className="h-3 w-3" />
          Expand to Canvas
        </button>
        {/* Attachment thumbnails */}
        <div className="relative z-10 mb-2 flex gap-2">
          <div className="flex h-[42px] w-[42px] cursor-pointer items-center justify-center rounded-[12px] border border-white/80 bg-gradient-to-br from-interaxis-200 to-interaxis-400 text-base shadow-md transition-transform hover:-translate-y-0.5 hover:scale-105">
            <span className="text-white text-lg">+</span>
          </div>
          <div
            className="flex h-[42px] w-[42px] cursor-pointer items-center justify-center rounded-[12px] border border-dashed border-gray-300/60 bg-white/50 text-gray-400 transition-transform hover:-translate-y-0.5 hover:scale-105"
          >
            <Plus className="h-5 w-5" />
          </div>
        </div>

        {/* Input row */}
        <div className="relative z-10 flex items-center gap-2.5">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Describe what you want to build, refine, or query..."
            className="flex-1 bg-transparent py-1.5 px-1.5 text-[14px] text-gray-800 placeholder-gray-400 outline-none"
            style={{ letterSpacing: "-0.005em" }}
          />
        </div>

        {/* Toolbar */}
        <div className="relative z-10 mt-2 flex items-center gap-1.5 border-t border-white/50 pt-2">
          <button className="chat-chip" onClick={() => router.push("/app/analyze")}>
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
          <button className="chat-chip" onClick={() => inputRef.current?.focus()}>
            <Zap className="h-3.5 w-3.5" />
            Prompt
          </button>
          <button className="chat-chip">
            <Image className="h-3.5 w-3.5" />
            Image
          </button>
          <button className="chat-chip">
            <Video className="h-3.5 w-3.5" />
            Video
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-white/55 border border-white/70 text-gray-500 transition-all hover:bg-white/85">
              <Mic className="h-4 w-4" />
            </button>
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || loading}
              className="send-btn-gradient disabled:opacity-40"
            >
              <ArrowUpRight className="h-4 w-4 text-white" />
            </button>
          </div>
        </div>

        {/* Rainbow bar */}
        <div className="rainbow-gradient-bar relative z-10 mt-2 -mx-3 -mb-3 rounded-b-3xl" />
      </div>
    </div>
  );
}
