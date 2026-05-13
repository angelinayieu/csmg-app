// ── useAudioAnalyser ──
//
// Web Audio API microphone analyser. When `active` is true, the hook
// requests microphone access, samples time-domain data via
// requestAnimationFrame, computes a smoothed RMS volume level
// (0-1), and exposes:
//   - level      : current smoothed volume
//   - peakLevel  : a slowly-decaying peak indicator (drives ring expansion)
//   - state      : "idle" | "requesting" | "active" | "denied" | "error"
//
// Independent from the Web Speech Recognition API — both can run
// simultaneously because each makes its own getUserMedia request
// (browsers de-duplicate at the device layer).
//
// All resources (MediaStream + AudioContext + RAF) are torn down
// when `active` flips to false or the component unmounts.

"use client";

import { useEffect, useRef, useState } from "react";

type AnalyserState = "idle" | "requesting" | "active" | "denied" | "error";

// Visual smoothing: lerp factor each frame. 0.25 = snappy, 0.08 = silky.
const SMOOTH_FACTOR = 0.18;
// Peak decay per frame (~60fps so 0.015 ≈ ~1s to decay from 1.0 to 0).
const PEAK_DECAY = 0.015;
// RMS multiplier — raw RMS hovers around 0.05-0.1 for quiet speech;
// boost so the visuals actually react. Capped to 1 in clamp below.
const RMS_GAIN = 6;

export function useAudioAnalyser(active: boolean): {
  level: number;
  peakLevel: number;
  state: AnalyserState;
} {
  const [state, setState] = useState<AnalyserState>("idle");
  // Refs hold the rendered values to avoid React re-rendering every
  // frame; we mirror into state at a slower cadence below.
  const levelRef = useRef(0);
  const peakRef = useRef(0);
  // Reactive copies, updated ~30fps via setState. Cheap because the
  // consumer (overlay) only re-renders to drive Tailwind/style; the
  // expensive work stays inside refs.
  const [level, setLevel] = useState(0);
  const [peakLevel, setPeakLevel] = useState(0);

  useEffect(() => {
    if (!active) {
      setState("idle");
      levelRef.current = 0;
      peakRef.current = 0;
      setLevel(0);
      setPeakLevel(0);
      return;
    }

    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let raf: number | null = null;
    let reactStateTimer: number | null = null;
    let cancelled = false;

    setState("requesting");

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ctx = (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext) as typeof AudioContext;
        audioCtx = new Ctx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);

        const buf = new Uint8Array(analyser.fftSize);
        setState("active");

        const tick = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / buf.length);
          const target = Math.min(1, rms * RMS_GAIN);
          // Lerp toward target for smooth visual motion
          levelRef.current += (target - levelRef.current) * SMOOTH_FACTOR;
          // Peak indicator: jumps up to current, then decays
          peakRef.current = Math.max(
            peakRef.current - PEAK_DECAY,
            levelRef.current,
          );
          raf = requestAnimationFrame(tick);
        };
        tick();

        // Mirror refs → state at ~30fps so React re-renders aren't on
        // every frame (would tank performance). The CSS animations
        // bridge between mirror ticks.
        reactStateTimer = window.setInterval(() => {
          setLevel(levelRef.current);
          setPeakLevel(peakRef.current);
        }, 33);
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string }).name ?? "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setState("denied");
        } else {
          setState("error");
          console.warn("[useAudioAnalyser] init failed:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (raf !== null) cancelAnimationFrame(raf);
      if (reactStateTimer !== null) window.clearInterval(reactStateTimer);
      if (audioCtx) {
        void audioCtx.close().catch(() => {});
      }
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [active]);

  return { level, peakLevel, state };
}
