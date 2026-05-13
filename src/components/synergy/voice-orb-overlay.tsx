// ── Voice orb overlay ──
//
// The Vision-Pro-style centerpiece. Activates when the user taps the
// mic on the dashboard hero. Layered visual stack:
//   1. Backdrop: dark dim + backdrop-blur, blocks page interaction
//   2. Central radial bg glow (cyan→indigo) that intensifies with
//      audio level
//   3. Halo rings (3 concentric SVG circles) that pulse with peakLevel
//   4. Orb core: 120px circle, cyan→indigo gradient, breathing scale,
//      live audio-reactive shadow
//   5. Live transcript: large display type below the orb, cross-fades
//      as interim updates roll in
//   6. Cancel hint (Esc) + escape-to-typing link at bottom
//
// On speech-final: commit immediately — create a synergy session with
// the transcript as the seed, fade the overlay, route to the
// whiteboard with ?voice=1 so listening resumes there.
//
// Audio + speech run as independent streams. The orb is purely
// visual; the speech recognizer is the source of truth for the
// committed text.

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic, MicOff, X } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { createSession } from "@/lib/synergy/client";
import { useSpeech } from "@/hooks/synergy/use-speech";
import { useAudioAnalyser } from "@/hooks/synergy/use-audio-analyser";

interface Props {
  open: boolean;
  onClose: () => void;
}

type CommitState = "listening" | "committing" | "settled";

export function VoiceOrbOverlay({ open, onClose }: Props) {
  const router = useRouter();
  const [commitState, setCommitState] = useState<CommitState>("listening");
  const committedRef = useRef(false);

  // Speech recognition — on final, commit + close
  const speech = useSpeech((finalText) => {
    if (committedRef.current) return;
    if (!finalText.trim()) return;
    committedRef.current = true;
    void commit(finalText);
  });

  // Audio analyser drives the orb pulse + halo expansion
  const { level, peakLevel, state: audioState } = useAudioAnalyser(open);

  // Start speech recognition the moment the overlay opens; stop on close.
  useEffect(() => {
    if (!open) {
      committedRef.current = false;
      setCommitState("listening");
      speech.reset();
      if (speech.listening) speech.stop();
      return;
    }
    // Slight delay so the entry animation lands before the mic
    // permission prompt cuts across it (Chrome shows a permission
    // dialog that pauses the page).
    const t = window.setTimeout(() => {
      if (!speech.listening) speech.start();
    }, 320);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && commitState !== "committing") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, commitState]);

  const handleClose = () => {
    if (speech.listening) speech.stop();
    onClose();
  };

  const commit = async (text: string) => {
    if (speech.listening) speech.stop();
    setCommitState("committing");
    try {
      const res = await createSession({
        title: text.slice(0, 80),
        seedText: text,
      });
      // Brief settle moment so the user sees the orb's "got it"
      // pulse before the page transitions.
      setCommitState("settled");
      window.setTimeout(() => {
        router.push(`/app/synergy/${res.session.id}?voice=1`);
      }, 650);
    } catch (e) {
      toast.error("Couldn't start brainstorm", {
        description: (e as Error).message,
      });
      setCommitState("listening");
      committedRef.current = false;
    }
  };

  if (!open) return null;

  // Visual mappings
  const baseScale = 1 + level * 0.18;
  const haloScale1 = 1.4 + peakLevel * 0.5;
  const haloScale2 = 1.8 + peakLevel * 0.7;
  const haloScale3 = 2.3 + peakLevel * 0.9;
  const interimText = speech.interim.trim();
  const showLatestFinal =
    !interimText && speech.finals.length > 0
      ? speech.finals[speech.finals.length - 1]
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice brainstorm"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 50% 45%, rgba(15, 23, 42, 0.55) 0%, rgba(15, 23, 42, 0.85) 70%)",
        backdropFilter: "blur(14px) saturate(140%)",
        WebkitBackdropFilter: "blur(14px) saturate(140%)",
        animation:
          commitState === "committing"
            ? "voiceOrbFadeOut 600ms ease both"
            : "voiceOrbFadeIn 320ms ease both",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && commitState !== "committing") {
          handleClose();
        }
      }}
    >
      {/* Central radial bg glow that intensifies with audio */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          width: 1200,
          height: 1200,
          left: "50%",
          top: "45%",
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(circle at center, rgba(6, 182, 212, ${0.18 + level * 0.18}) 0%, rgba(99, 102, 241, ${0.08 + level * 0.1}) 30%, transparent 70%)`,
          filter: "blur(40px)",
          transition: "opacity 200ms ease",
          opacity: commitState === "settled" ? 1 : 0.95,
        }}
      />

      {/* Close button (top right) */}
      <button
        onClick={handleClose}
        disabled={commitState === "committing"}
        aria-label="Cancel"
        className="absolute right-6 top-6 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-md transition hover:bg-white/20 hover:text-white disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>

      {/* ── Orb stack ── */}
      <div
        className="relative flex flex-col items-center"
        style={{
          marginTop: -40,
        }}
      >
        {/* Halo rings */}
        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: 120,
              height: 120,
              transform: `translate(-50%, -50%) scale(${haloScale3})`,
              background:
                "radial-gradient(circle, rgba(6, 182, 212, 0.18) 0%, transparent 60%)",
              transition: "transform 90ms ease-out",
              filter: "blur(8px)",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: 120,
              height: 120,
              transform: `translate(-50%, -50%) scale(${haloScale2})`,
              background:
                "radial-gradient(circle, rgba(99, 102, 241, 0.22) 0%, transparent 60%)",
              transition: "transform 80ms ease-out",
              filter: "blur(6px)",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: 120,
              height: 120,
              transform: `translate(-50%, -50%) scale(${haloScale1})`,
              background:
                "radial-gradient(circle, rgba(168, 85, 247, 0.28) 0%, transparent 60%)",
              transition: "transform 70ms ease-out",
              filter: "blur(4px)",
            }}
          />

          {/* The orb core */}
          <div
            className="relative inline-flex h-[120px] w-[120px] items-center justify-center rounded-full"
            style={{
              background:
                "radial-gradient(circle at 35% 30%, #93c5fd 0%, #06b6d4 35%, #6366f1 70%, #a855f7 100%)",
              boxShadow: [
                `0 0 ${60 + level * 80}px ${10 + level * 30}px rgba(6, 182, 212, ${0.4 + level * 0.4})`,
                `0 0 ${20 + level * 30}px ${5 + level * 15}px rgba(99, 102, 241, ${0.3 + level * 0.3})`,
                "inset 0 4px 12px rgba(255, 255, 255, 0.25)",
                "inset 0 -4px 16px rgba(15, 23, 42, 0.2)",
              ].join(", "),
              transform: `scale(${baseScale})`,
              transition: "transform 100ms ease-out, box-shadow 80ms ease-out",
              animation:
                commitState === "settled"
                  ? "voiceOrbSettle 600ms ease both"
                  : "voiceOrbBreathe 3.6s ease-in-out infinite",
            }}
          >
            {/* Inner conic shimmer */}
            <div
              aria-hidden
              className="absolute inset-2 rounded-full"
              style={{
                background:
                  "conic-gradient(from 0deg, rgba(255,255,255,0.18), rgba(255,255,255,0) 40%, rgba(255,255,255,0.15) 60%, rgba(255,255,255,0) 100%)",
                animation: "voiceOrbShimmer 6s linear infinite",
                mixBlendMode: "overlay",
              }}
            />
            {/* Mic icon (subtle, only visible when not yet audio-active) */}
            {audioState !== "active" && (
              <span className="relative z-10 inline-flex items-center justify-center text-white/85">
                {audioState === "requesting" ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : audioState === "denied" ? (
                  <MicOff className="h-6 w-6" />
                ) : (
                  <Mic className="h-6 w-6" />
                )}
              </span>
            )}
          </div>
        </div>

        {/* Status line above transcript */}
        <div className="mt-12 font-mono text-[10px] uppercase tracking-[0.25em] text-white/55">
          {audioState === "requesting"
            ? "Awaiting microphone…"
            : audioState === "denied"
              ? "Microphone blocked"
              : audioState === "error"
                ? "Microphone unavailable"
                : commitState === "committing"
                  ? "Got it — opening whiteboard"
                  : commitState === "settled"
                    ? "✓ Captured"
                    : speech.listening
                      ? "Listening"
                      : "Tap to retry"}
        </div>

        {/* Live transcript */}
        <div className="mt-3 min-h-[120px] max-w-[720px] px-6 text-center">
          {interimText ? (
            <p
              className="text-white/95"
              style={{
                fontSize: "clamp(22px, 3.2vw, 36px)",
                fontWeight: 500,
                letterSpacing: "-0.015em",
                lineHeight: 1.25,
                textShadow: "0 2px 24px rgba(6, 182, 212, 0.4)",
                animation: "voiceOrbTextIn 200ms ease both",
              }}
            >
              {interimText}
            </p>
          ) : showLatestFinal ? (
            <p
              className="text-white/95"
              style={{
                fontSize: "clamp(22px, 3.2vw, 36px)",
                fontWeight: 500,
                letterSpacing: "-0.015em",
                lineHeight: 1.25,
                textShadow: "0 2px 24px rgba(6, 182, 212, 0.4)",
              }}
            >
              {showLatestFinal}
            </p>
          ) : audioState === "denied" ? (
            <p className="text-white/70 text-[14px]">
              Microphone access was denied. Allow it in your browser
              settings, then close this and try again.
            </p>
          ) : (
            <p
              className="text-white/55"
              style={{
                fontSize: "clamp(18px, 2.4vw, 26px)",
                fontWeight: 400,
                letterSpacing: "-0.01em",
              }}
            >
              Speak your idea. We&apos;ll open a fresh whiteboard with it.
            </p>
          )}
        </div>
      </div>

      {/* Bottom hint */}
      <div className="absolute inset-x-0 bottom-10 flex flex-col items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-white/60 backdrop-blur">
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[9px]">ESC</kbd>
          to cancel
        </div>
        <button
          onClick={handleClose}
          disabled={commitState === "committing"}
          className="text-[11px] font-medium text-white/60 underline-offset-2 transition hover:text-white/85 hover:underline disabled:opacity-50"
        >
          Or just type instead →
        </button>
      </div>

      <style jsx>{`
        @keyframes voiceOrbFadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes voiceOrbFadeOut {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes voiceOrbBreathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        @keyframes voiceOrbSettle {
          0% { transform: scale(1); }
          40% { transform: scale(1.25); }
          100% { transform: scale(0.6); opacity: 0.5; }
        }
        @keyframes voiceOrbShimmer {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes voiceOrbTextIn {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          div[role="dialog"] * {
            animation-duration: 0.001ms !important;
            animation-iteration-count: 1 !important;
          }
        }
      `}</style>
    </div>
  );
}
