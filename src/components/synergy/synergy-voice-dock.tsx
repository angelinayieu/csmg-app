// ── Synergy whiteboard bottom voice dock ──
//
// Floating bottom card with:
//   - Free auto-brainstorm toggle (when on, each speech-final triggers
//     the augment mode and new nodes spawn off the core/seed)
//   - Mic button (red + pulsing when listening, blue when idle)
//   - Interim transcript surface above the dock when speaking OR when
//     an augment call is in-flight
//
// If speech isn't supported (Safari, Firefox), the mic button is
// disabled and an inline "Voice unsupported — try Chrome" message
// replaces the interim transcript.

"use client";

import { Loader2, Mic, MicOff } from "lucide-react";

interface Props {
  listening: boolean;
  supported: boolean;
  autoMode: boolean;
  interim: string;
  busy: boolean;
  onAutoModeChange: (next: boolean) => void;
  onToggleMic: () => void;
}

export function SynergyVoiceDock({
  listening,
  supported,
  autoMode,
  interim,
  busy,
  onAutoModeChange,
  onToggleMic,
}: Props) {
  const showInterim = busy || interim.length > 0;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-3 px-6">
      {showInterim && (
        <div className="pointer-events-auto max-w-2xl rounded-xl border border-gray-200 bg-white/90 px-4 py-2 text-sm shadow-sm backdrop-blur">
          {busy && (
            <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin text-blue-600" />
          )}
          <span className="text-gray-700">
            {interim || "Mapping your thought…"}
          </span>
        </div>
      )}
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-gray-200 bg-white/90 p-2 pl-4 shadow-md backdrop-blur">
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={autoMode}
            onChange={(e) => onAutoModeChange(e.target.checked)}
            className="accent-blue-600"
          />
          Free auto-brainstorm
        </label>
        <button
          onClick={onToggleMic}
          disabled={!supported}
          title={
            supported
              ? listening
                ? "Stop listening"
                : "Start listening"
              : "Voice unsupported — try Chrome"
          }
          className={[
            "group inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50",
            listening
              ? "bg-gray-900 text-white"
              : "bg-blue-600 text-white hover:scale-[1.02]",
          ].join(" ")}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {!supported
            ? "Voice unsupported"
            : listening
              ? "Listening — tap to stop"
              : "Hold a thought, speak it"}
        </button>
      </div>
    </div>
  );
}
