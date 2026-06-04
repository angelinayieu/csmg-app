"use client";

// ── useVoiceRecorder ──
//
// Composes the existing Web-Speech hook (`useSpeech`) + the mic-level
// analyser (`useAudioAnalyser`) into a recorder with pause / resume / reset
// and a "live analysis" toggle. `useSpeech` itself is left untouched (it's a
// shared synergy hook). Pause = stop recognition but KEEP the accumulated
// finals; resume = start again (Web Speech appends new finals). Transcript-
// only — no audio is stored.

import { useCallback, useRef, useState } from "react";
import { useSpeech } from "@/hooks/synergy/use-speech";
import { useAudioAnalyser } from "@/hooks/synergy/use-audio-analyser";

export interface VoiceRecorder {
  /** false on Safari/Firefox — the UI shows a "use Chrome" fallback. */
  supported: boolean;
  /** Mic actively capturing right now. */
  recording: boolean;
  /** User paused (recognition stopped, finals preserved). */
  paused: boolean;
  /** Live (not-yet-final) fragment. */
  interim: string;
  /** Completed sentence chunks. */
  finals: string[];
  /** finals + interim, joined + trimmed — the full current transcript. */
  transcript: string;
  /** Smoothed mic level 0–1 (drives the waveform). */
  level: number;
  /** When on, finished sentences auto-unfurl converge/diverge cards. */
  liveMode: boolean;
  setLiveMode: (v: boolean) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
}

export function useVoiceRecorder(opts?: {
  onFinalSentence?: (sentence: string) => void;
}): VoiceRecorder {
  const [paused, setPaused] = useState(false);
  const [liveMode, setLiveMode] = useState(false);

  // Keep the latest callback without re-subscribing the speech hook.
  const onFinalRef = useRef(opts?.onFinalSentence);
  onFinalRef.current = opts?.onFinalSentence;

  const speech = useSpeech((sentence) => onFinalRef.current?.(sentence));
  // Mic-level meter runs only while actively listening (not paused).
  const audio = useAudioAnalyser(speech.listening && !paused);

  const start = useCallback(() => {
    setPaused(false);
    speech.start();
  }, [speech]);

  const pause = useCallback(() => {
    setPaused(true);
    speech.stop(); // keeps finals; recognition halts
  }, [speech]);

  const resume = useCallback(() => {
    setPaused(false);
    speech.start(); // Web Speech appends to the existing finals
  }, [speech]);

  const reset = useCallback(() => {
    setPaused(false);
    speech.reset();
  }, [speech]);

  const transcript = [speech.finals.join(" "), speech.interim]
    .filter((s) => s && s.trim().length > 0)
    .join(" ")
    .trim();

  return {
    supported: speech.supported,
    recording: speech.listening,
    paused,
    interim: speech.interim,
    finals: speech.finals,
    transcript,
    level: audio.level,
    liveMode,
    setLiveMode,
    start,
    pause,
    resume,
    reset,
  };
}
