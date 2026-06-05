"use client";

// ── VoiceRecordFab ──
//
// The persistent record affordance on the board (glass FAB, bottom-center).
// Owns the recorder + the user's profile, and orchestrates a commit:
//   1. drop a voice-note card on the board (deployVoiceNoteCard)
//   2. analyze THAT note in the background → its card shows the AI's read
//      (analyzeVoiceNote → updateVoiceNoteAnalysis), NOT a journal.
// A voice note no longer auto-synthesizes a journal — journals/notebooks are
// produced on demand from the Artifact Dock (not everyone wants one).
// When Live analysis is on, each finished sentence is also routed to the
// quality-gated converge/diverge controller.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence } from "framer-motion";
import { Square } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

/** The "new" voice waveform mark — five rounded bars, tallest at center.
 *  Inherits currentColor so the glass FAB can tint it with the accent. */
function WaveformIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="currentColor" style={style} aria-hidden>
      <rect x={2} y={9} width={2.6} height={6} rx={1.3} />
      <rect x={6.7} y={5.5} width={2.6} height={13} rx={1.3} />
      <rect x={11.4} y={2.5} width={2.6} height={19} rx={1.3} />
      <rect x={16.1} y={5.5} width={2.6} height={13} rx={1.3} />
      <rect x={20.8} y={9} width={2.6} height={6} rx={1.3} />
    </svg>
  );
}
import { useVoiceRecorder } from "./use-voice-recorder";
import { VoiceRecorderPanel } from "./voice-recorder-panel";
import {
  handleVoiceSentence,
  analyzeVoiceNote,
} from "./voice-analysis-controller";
import { deployVoiceNoteCard } from "@/components/objective/board-bus";

export function VoiceRecordFab({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("You");
  const liveRef = useRef(false);
  const noteStartRef = useRef<number>(0); // start of the current (uncommitted) note

  const recorder = useVoiceRecorder({
    onFinalSentence: (sentence) => {
      if (liveRef.current) void handleVoiceSentence(spaceId, sentence);
    },
  });
  useEffect(() => {
    liveRef.current = recorder.liveMode;
  }, [recorder.liveMode]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.displayName) setDisplayName(d.displayName as string);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const openAndStart = useCallback(() => {
    setOpen(true);
    noteStartRef.current = Date.now();
    recorder.start();
  }, [recorder]);

  const close = useCallback(() => {
    recorder.pause();
    setOpen(false);
  }, [recorder]);

  const commit = useCallback(() => {
    const text = recorder.transcript.trim();
    if (!text) return;
    const voiceNoteId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `vn-${Date.now()}`;
    const durationMs = noteStartRef.current
      ? Date.now() - noteStartRef.current
      : 0;

    // 1. The note card — drops with a "pending" analysis (shows "Analyzing…").
    deployVoiceNoteCard({
      voiceNoteId,
      spaceId,
      authorName: displayName,
      transcript: text,
      createdAtIso: new Date().toISOString(),
      durationMs,
      analysisJson: JSON.stringify({ status: "pending", points: [] }),
    });
    recorder.reset(); // keep listening for the next note
    noteStartRef.current = Date.now(); // next note's clock starts now

    // 2. Analyze THIS note in the background → attaches to its card.
    void analyzeVoiceNote(voiceNoteId, text, durationMs);
  }, [recorder, spaceId, displayName]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <div
            className="fixed left-1/2 z-[64]"
            style={{ bottom: 140, transform: "translateX(-50%)" }}
          >
            <VoiceRecorderPanel
              recorder={recorder}
              displayName={displayName}
              onCommit={commit}
              onClose={close}
            />
          </div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={open ? close : openAndStart}
        aria-label={open ? "Stop recording" : "Record a voice note"}
        className="fixed left-1/2 z-[63] flex items-center justify-center rounded-full transition-transform hover:scale-105"
        style={{
          // Sits just above tldraw's bottom-center toolbar (~56px). Lowered a
          // touch per feedback; glassmorphism so it reads as part of the chrome.
          bottom: 70,
          transform: "translateX(-50%)",
          width: 54,
          height: 54,
          background: open ? "rgba(220,38,38,0.9)" : "var(--glass-float-bg)",
          border: open ? "1px solid rgba(220,38,38,0.5)" : "1px solid var(--glass-border)",
          backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
          WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
          color: open ? "white" : appleVibe.accent.primary,
          boxShadow:
            "inset 0 1px 0 var(--glass-highlight), 0 16px 40px -14px rgba(11,18,40,0.34)",
        }}
      >
        {open ? (
          <Square className="h-5 w-5" strokeWidth={2.4} fill="white" />
        ) : (
          <WaveformIcon style={{ width: 22, height: 22 }} />
        )}
      </button>
    </>
  );
}
