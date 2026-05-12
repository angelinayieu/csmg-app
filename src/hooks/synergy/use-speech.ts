// ── useSpeech — Web Speech API hook ──
//
// Ported from idea-synthesizer. Returns:
//   supported  → false on Safari/Firefox; UI should fall back to a textarea
//   listening  → mic currently capturing
//   interim    → live (not-yet-final) transcript fragment for display
//   finals     → array of completed transcript chunks
//   start/stop → toggle mic
//   reset      → clear finals + interim (used on "Clear board")
//
// onFinal callback fires every time a chunk crystallizes from interim
// → final. The Synergy whiteboard wires this to handleAIAugment when
// "Free auto-brainstorm" is enabled.

import { useCallback, useEffect, useRef, useState } from "react";

type SRResult = { isFinal: boolean; 0: { transcript: string } };
type SREvent = { resultIndex: number; results: ArrayLike<SRResult> };
interface SRInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export interface SpeechHook {
  supported: boolean;
  listening: boolean;
  interim: string;
  finals: string[];
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export function useSpeech(onFinal?: (text: string) => void): SpeechHook {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [finals, setFinals] = useState<string[]>([]);
  const recRef = useRef<SRInstance | null>(null);
  const supportedRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      SpeechRecognition?: new () => SRInstance;
      webkitSpeechRecognition?: new () => SRInstance;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    supportedRef.current = true;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0].transcript;
        if (r.isFinal) {
          const clean = txt.trim();
          if (clean) {
            setFinals((p) => [...p, clean]);
            onFinalRef.current?.(clean);
          }
        } else {
          interimText += txt;
        }
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      console.warn("[useSpeech] error:", e.error);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
  }, []);

  const start = useCallback(() => {
    if (!recRef.current) return;
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      // already started — no-op
    }
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const reset = useCallback(() => {
    setFinals([]);
    setInterim("");
  }, []);

  return {
    supported: supportedRef.current,
    listening,
    interim,
    finals,
    start,
    stop,
    reset,
  };
}
