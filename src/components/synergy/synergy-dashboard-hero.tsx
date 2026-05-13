// ── Synergy dashboard hero — prompt input + voice button + CTAs ──
//
// Two intent paths share the same prompt input:
//   1. "Start brainstorming" → creates a fresh synergy session with
//      the prompt as the seed node, navigates to /app/synergy/[id]
//   2. "Generate strategy from prompt" → navigates to /app/strategy/new
//      with the prompt pre-filled (the destination's page runs the
//      full strategy-from-prompt orchestrator)
//
// Voice button hands off to /app/synergy/new with the input as seed
// AND speech-recognition pre-armed (the Synergy whiteboard's mic
// flow takes over from there). We don't try to do voice on the
// dashboard itself — keeps state isolated.

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, Mic, Sparkles } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { createSession } from "@/lib/synergy/client";
import { VoiceOrbOverlay } from "@/components/synergy/voice-orb-overlay";

interface Props {
  greeting: string;
  firstName: string;
}

export function SynergyDashboardHero({ greeting, firstName }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "brainstorm" | "strategy">(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const startBrainstorm = async () => {
    if (busy) return;
    const seed = text.trim();
    setBusy("brainstorm");
    try {
      const res = await createSession({
        title: seed ? seed.slice(0, 80) : "Untitled brainstorm",
        seedText: seed || undefined,
      });
      router.push(`/app/synergy/${res.session.id}`);
    } catch (e) {
      toast.error("Couldn't start brainstorm", {
        description: (e as Error).message,
      });
      setBusy(null);
    }
  };

  const goToStrategyFromPrompt = () => {
    if (busy) return;
    const trimmed = text.trim();
    if (!trimmed) {
      toast.info("Type a brief description first", {
        description: "Even one sentence is enough.",
      });
      inputRef.current?.focus();
      return;
    }
    const params = new URLSearchParams({ prompt: trimmed });
    router.push(`/app/strategy/new?${params.toString()}`);
  };

  return (
    <section className="relative">
      <h1 className="text-center font-semibold tracking-tight text-gray-900"
        style={{ fontSize: "clamp(36px, 5.5vw, 64px)", letterSpacing: "-0.02em" }}>
        {greeting}, {firstName}
      </h1>
      <p className="mt-3 text-center text-[18px] leading-snug text-gray-600">
        What are you brainstorming today?
      </p>

      {/* Glass input bar */}
      <div className="mx-auto mt-8 max-w-2xl">
        <div
          className="relative rounded-2xl"
          style={{
            background: "rgba(255, 255, 255, 0.7)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.6)",
            boxShadow: [
              "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
              "0 1px 2px rgba(15, 23, 42, 0.04)",
              "0 16px 40px -12px rgba(15, 23, 42, 0.12)",
              "0 0 60px -16px rgba(6, 182, 212, 0.35)",
            ].join(", "),
          }}
        >
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1000))}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void startBrainstorm();
              }
            }}
            placeholder="Type or paste an idea. Press ⌘+Enter to start brainstorming."
            rows={2}
            className="w-full resize-none rounded-2xl bg-transparent px-5 py-4 pr-16 text-[16px] leading-relaxed text-gray-900 outline-none placeholder:text-gray-400"
          />
          <button
            onClick={() => setVoiceOpen(true)}
            disabled={!!busy}
            title="Speak — opens the voice orb"
            aria-label="Open voice orb"
            className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-indigo-500 to-violet-500 text-white transition hover:scale-[1.08] disabled:opacity-60"
            style={{
              boxShadow: "0 4px 24px -4px rgba(99, 102, 241, 0.6)",
              animation: "synergyHeroMicPulse 3s ease-in-out infinite",
            }}
          >
            <Mic className="h-4 w-4" />
            <style jsx>{`
              @keyframes synergyHeroMicPulse {
                0%,
                100% {
                  box-shadow: 0 4px 24px -4px rgba(99, 102, 241, 0.55);
                }
                50% {
                  box-shadow: 0 6px 36px -4px rgba(99, 102, 241, 0.95);
                }
              }
            `}</style>
          </button>
        </div>

        {/* Action chips */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => void startBrainstorm()}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_6px_20px_-6px_rgba(6,182,212,0.5)] transition hover:scale-[1.03] disabled:opacity-60"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {busy === "brainstorm" ? "Opening whiteboard…" : "Start brainstorming"}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={goToStrategyFromPrompt}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/80 backdrop-blur px-4 py-2 text-[13px] font-semibold text-gray-700 transition hover:border-blue-300 hover:text-gray-900 disabled:opacity-60"
          >
            <FileText className="h-3.5 w-3.5" />
            Generate strategy from prompt
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="mt-3 text-center text-[11px] text-gray-500">
          Brainstorming opens a fresh whiteboard with voice + AI augmentation.
          Strategy-from-prompt drafts the full living doc directly.
        </p>
      </div>

      {/* Voice orb — full-screen immersive overlay. Mounts on demand;
          uses portal-style position:fixed inside the component. */}
      <VoiceOrbOverlay open={voiceOpen} onClose={() => setVoiceOpen(false)} />
    </section>
  );
}
