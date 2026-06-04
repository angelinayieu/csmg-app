"use client";

// ── VoiceRecorderPanel ──
//
// The floating glass recorder (Apple-Vision-Pro vibe, inspo #3 + #4): the
// user's profile + the live transcript (interim greyed, finals solid) + a
// waveform driven by the mic level + controls (pause / resume / stop /
// enter) + a Live-analysis toggle. Presentational — the FAB owns the
// recorder state and the commit/close handlers.

import { motion } from "framer-motion";
import { Mic, Pause, Play, X, CornerDownLeft, Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { VoiceRecorder } from "./use-voice-recorder";

const BARS = 7;

export function VoiceRecorderPanel({
  recorder,
  displayName,
  onCommit,
  onClose,
}: {
  recorder: VoiceRecorder;
  displayName: string;
  onCommit: () => void;
  onClose: () => void;
}) {
  const {
    supported,
    recording,
    paused,
    interim,
    finals,
    level,
    liveMode,
    setLiveMode,
    pause,
    resume,
  } = recorder;
  const initial = (displayName || "You").trim().charAt(0).toUpperCase();
  const hasText = finals.length > 0 || interim.trim().length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="w-[400px] max-w-[92vw]"
      style={{
        background: "rgba(255,255,255,0.82)",
        backdropFilter: "blur(22px) saturate(160%)",
        WebkitBackdropFilter: "blur(22px) saturate(160%)",
        border: `1px solid ${appleVibe.stroke.soft}`,
        borderRadius: 22,
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.9) inset, 0 28px 64px -24px rgba(11,18,40,0.34), 0 12px 32px -16px rgba(11,18,40,0.2)",
        padding: "14px 16px 13px",
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Header — profile + recording state + close */}
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold text-white"
          style={{ background: appleVibe.stage.features }}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div
            className="text-[13px] font-semibold"
            style={{ color: appleVibe.text.primary }}
          >
            {displayName || "You"}
          </div>
          <div
            className="flex items-center gap-1.5 text-[11px] font-medium"
            style={{ color: appleVibe.text.faint }}
          >
            <span
              className={recording && !paused ? "animate-pulse" : undefined}
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: paused
                  ? "#D97706"
                  : recording
                    ? "#DC2626"
                    : appleVibe.stroke.medium,
              }}
            />
            {paused ? "Paused" : recording ? "Recording…" : "Ready"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close recorder"
          className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5"
          style={{ color: appleVibe.text.tertiary }}
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {/* Transcript */}
      <div
        className="mt-3 max-h-[160px] min-h-[64px] overflow-y-auto text-[14px] leading-relaxed"
        style={{ color: appleVibe.text.primary }}
      >
        {!supported ? (
          <span style={{ color: appleVibe.text.tertiary }}>
            Voice transcription needs Chrome or Edge.
          </span>
        ) : hasText ? (
          <>
            {finals.join(" ")}{" "}
            <span style={{ color: appleVibe.text.faint }}>{interim}</span>
          </>
        ) : (
          <span style={{ color: appleVibe.text.faint }}>
            Start speaking — your words appear here.
          </span>
        )}
      </div>

      {/* Waveform */}
      <div className="mt-3 flex h-6 items-center justify-center gap-[3px]">
        {Array.from({ length: BARS }).map((_, i) => {
          // Vary each bar around the mic level so it reads as a live equalizer.
          const factor = 0.4 + Math.abs(Math.sin((i + 1) * 1.7)) * 0.6;
          const h = recording && !paused ? 4 + level * 22 * factor : 4;
          return (
            <span
              key={i}
              style={{
                width: 3,
                height: Math.max(4, h),
                borderRadius: 999,
                background: appleVibe.stage.features,
                opacity: recording && !paused ? 0.9 : 0.3,
                transition: "height 90ms linear",
              }}
            />
          );
        })}
      </div>

      {/* Controls */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setLiveMode(!liveMode)}
          aria-pressed={liveMode}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition-colors"
          style={{
            background: liveMode ? appleVibe.accent.primary : "rgba(15,23,42,0.05)",
            color: liveMode ? "white" : appleVibe.text.tertiary,
          }}
          title="Auto-analyze each finished sentence into cards"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          Live analysis
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={paused ? resume : pause}
            disabled={!supported}
            aria-label={paused ? "Resume" : "Pause"}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-black/5 disabled:opacity-40"
            style={{ color: appleVibe.text.secondary }}
          >
            {paused ? (
              <Play className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Pause className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={!hasText}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-40"
            style={{ background: appleVibe.accent.primary, color: "white" }}
          >
            <CornerDownLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
            Enter
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[10px]" style={{ color: appleVibe.text.faint }}>
        <Mic className="h-3 w-3" strokeWidth={2} />
        Transcript-only · Enter drops a note + updates your journal
      </div>
    </motion.div>
  );
}
