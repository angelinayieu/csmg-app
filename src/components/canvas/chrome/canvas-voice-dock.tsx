// ── Canvas voice dock ──
//
// Small floating mic anchored bottom-center of the canvas. Click to
// start dictation; the live transcript appears as a chip above the
// mic; each finalized utterance creates a new entity on the space
// via /api/spaces/[id]/entities/manual.
//
// Different from synergy-voice-orb-overlay.tsx (which is a full-
// screen Vision-Pro-style centerpiece). On the canvas the orb would
// cover the workspace the user is trying to fill, so this is a
// compact button with a transient transcript chip — keeps the user
// in the canvas the whole time.
//
// Mode-gated: only mounts for brain_probe (the interactive-probe
// pill). brainstorm_speed has autopilot instead; deep R&D modes
// don't need free-form voice.

"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mic, MicOff, Sparkles } from "lucide-react";
import { useSpeech } from "@/hooks/synergy/use-speech";
import { useSpaceData } from "@/contexts/space-data-context";
import { toast } from "@/lib/hooks/use-toast";

interface Props {
  spaceId: string;
}

export function CanvasVoiceDock({ spaceId }: Props) {
  const { refreshEntities } = useSpaceData();
  const [submitting, setSubmitting] = useState(false);
  // Show a brief "✓ Added" feedback flash after a successful insert.
  const [lastAddedAt, setLastAddedAt] = useState<number | null>(null);

  // Speech hook with on-final callback that materializes each chunk
  // as an entity. Keeps voice in continuous mode — user can speak
  // multiple sentences in a row, each becomes its own node.
  const speech = useSpeech(async (chunk) => {
    const text = chunk.trim();
    if (text.length < 2 || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/entities/manual`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: text.slice(0, 200),
          // Default to "variable" — neutral, doesn't constrain how
          // the user thinks about the utterance. Brain Probe users
          // can re-tag entities later via the inspector.
          kind: "variable",
          description: `Captured via voice — "${text.slice(0, 400)}"`,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status}`);
      }
      // Force a refresh so the new entity paints immediately.
      await refreshEntities();
      setLastAddedAt(Date.now());
    } catch (e) {
      toast.error("Couldn't capture", { description: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  });

  // Flash the "✓ Added" indicator for 1.4s after each capture.
  useEffect(() => {
    if (!lastAddedAt) return;
    const t = window.setTimeout(() => setLastAddedAt(null), 1400);
    return () => window.clearTimeout(t);
  }, [lastAddedAt]);

  const toggleMic = useCallback(() => {
    if (!speech.supported) {
      toast.error("Voice unsupported", {
        description: "Try Chrome — Safari and Firefox don't expose the Web Speech API.",
      });
      return;
    }
    if (speech.listening) speech.stop();
    else speech.start();
  }, [speech]);

  // Live transcript: interim while listening; the last final chunk
  // briefly when not listening.
  const showFlash = lastAddedAt !== null && !speech.listening;
  const transcript = speech.listening
    ? speech.interim || "Listening…"
    : showFlash
      ? "✓ Added"
      : "";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[58] flex flex-col items-center gap-2">
      {/* Transcript chip — only when something to show */}
      {transcript && (
        <div
          className="pointer-events-none max-w-[480px] truncate rounded-full px-4 py-1.5 text-[12px]"
          style={{
            background: speech.listening
              ? "rgba(15, 23, 42, 0.88)"
              : "rgba(16, 185, 129, 0.9)",
            color: "white",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxShadow: "0 10px 28px -10px rgba(15, 23, 42, 0.3)",
            animation: "canvasVoiceChipIn 220ms ease both",
          }}
        >
          {transcript}
        </div>
      )}

      {/* Mic button */}
      <button
        type="button"
        onClick={toggleMic}
        disabled={!speech.supported || submitting}
        aria-label={speech.listening ? "Stop dictation" : "Start dictation"}
        title={
          !speech.supported
            ? "Voice unsupported in this browser"
            : speech.listening
              ? "Stop dictation"
              : "Tap to talk — each sentence becomes a node"
        }
        className="pointer-events-auto relative inline-flex h-12 w-12 items-center justify-center rounded-full text-white transition disabled:opacity-50"
        style={{
          background: speech.listening
            ? "linear-gradient(135deg, #ef4444, #dc2626)"
            : "linear-gradient(135deg, #06b6d4, #4f46e5)",
          boxShadow: speech.listening
            ? "0 0 28px -2px rgba(239, 68, 68, 0.55), 0 6px 18px -4px rgba(15, 23, 42, 0.3)"
            : "0 6px 22px -8px rgba(6, 182, 212, 0.55), 0 6px 18px -4px rgba(15, 23, 42, 0.25)",
        }}
      >
        {submitting ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : speech.listening ? (
          <>
            <MicOff className="h-5 w-5" strokeWidth={1.7} />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-rose-400/60"
              style={{ animation: "canvasVoicePulse 1.4s ease-out infinite" }}
            />
          </>
        ) : (
          <Mic className="h-5 w-5" strokeWidth={1.7} />
        )}
      </button>

      {/* Affordance hint — only when idle and supported */}
      {!speech.listening && !submitting && speech.supported && !transcript && (
        <div className="pointer-events-none flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-gray-500">
          <Sparkles className="h-2.5 w-2.5" />
          Tap to talk
        </div>
      )}

      <style jsx>{`
        @keyframes canvasVoicePulse {
          0% {
            transform: scale(1);
            opacity: 0.7;
          }
          100% {
            transform: scale(1.55);
            opacity: 0;
          }
        }
        @keyframes canvasVoiceChipIn {
          from {
            opacity: 0;
            transform: translateY(6px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
