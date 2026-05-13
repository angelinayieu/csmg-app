// ── Synergy Room Voice Dock ──
//
// Bottom-LEFT companion to the bottom-center AI Dock. Drops a mic
// button + interim transcript surface into the shared room canvas
// so users can capture spoken thoughts as nodes without typing.
//
// Behavior:
//   - Click mic → start listening; click again → stop
//   - Each speech-final phrase becomes a NEW room node at the
//     current viewport center, tagged with the voice meta prefix
//     so the card renderer can show a mic glyph
//   - "Free-flow" toggle: when on, each final also fires
//     augment(decompose) on the new node, spawning AI children
//     (mirrors the solo whiteboard's auto-brainstorm mode)
//
// Voice runs locally via Web Speech API (useSpeech) — no audio is
// shipped to the server. Only the final transcript text crosses
// the wire, which keeps latency low and avoids any PII-in-audio
// concerns.

"use client";

import { Loader2, Mic, MicOff, Sparkles } from "lucide-react";

export const VOICE_META_PREFIX = "<<voice>>";

interface Props {
  listening: boolean;
  supported: boolean;
  freeFlow: boolean;
  interim: string;
  busy: boolean;
  disabled?: boolean;
  onToggleMic: () => void;
  onFreeFlowChange: (next: boolean) => void;
}

export function SynergyRoomVoiceDock({
  listening,
  supported,
  freeFlow,
  interim,
  busy,
  disabled,
  onToggleMic,
  onFreeFlowChange,
}: Props) {
  const showInterim = listening || busy || interim.length > 0;
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-30 flex flex-col items-start gap-2">
      {showInterim && (
        <div className="pointer-events-auto max-w-md rounded-xl border border-gray-200 bg-white/90 px-3 py-2 text-[12px] shadow-sm backdrop-blur">
          {busy && (
            <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin text-blue-600" />
          )}
          {freeFlow && busy && (
            <Sparkles className="mr-1 inline h-3 w-3 text-blue-600" />
          )}
          <span className="text-gray-700">
            {interim ||
              (busy
                ? freeFlow
                  ? "Spawning AI variations…"
                  : "Adding to board…"
                : "Listening…")}
          </span>
        </div>
      )}
      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-gray-200 bg-white/90 p-1.5 pl-3 shadow-md backdrop-blur">
        <label className="flex items-center gap-1.5 text-[11px] text-gray-700">
          <input
            type="checkbox"
            checked={freeFlow}
            onChange={(e) => onFreeFlowChange(e.target.checked)}
            disabled={disabled || !supported}
            className="accent-blue-600"
          />
          Free-flow
        </label>
        <button
          onClick={onToggleMic}
          disabled={!supported || disabled}
          title={
            !supported
              ? "Voice unsupported — try Chrome"
              : listening
                ? "Stop listening"
                : "Speak to add to the board"
          }
          aria-label={listening ? "Stop listening" : "Start listening"}
          className={[
            "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50",
            listening
              ? "bg-gray-900 text-white"
              : "bg-gray-900 text-white hover:bg-gray-800",
          ].join(" ")}
        >
          {listening ? (
            <MicOff className="h-3.5 w-3.5" />
          ) : (
            <Mic className="h-3.5 w-3.5" />
          )}
          {!supported
            ? "No voice"
            : listening
              ? "Listening"
              : "Speak"}
        </button>
      </div>
    </div>
  );
}
