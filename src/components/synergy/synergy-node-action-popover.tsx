// ── Synergy node action popover (Vision Pro chrome) ──
//
// Floats off the hovered/selected card on the canvas. The popover
// reads as a glass plate with a soft top-edge highlight; the action
// tiles are quiet, monochrome, and lift on hover. The describe field
// at the bottom has no fake form-border — it inherits the popover's
// glass so the input feels embedded in the surface, not stamped on it.

"use client";

import { useEffect, useRef, useState } from "react";
import { Focus, Loader2, Mic, MicOff, Send } from "lucide-react";
import {
  DecomposeIcon,
  PlanIcon,
  QuestionsIcon,
  RankIcon,
  ResearchIcon,
  TidyIcon,
  VariationsIcon,
} from "./icons/action-icons";
import { useSpeech } from "@/hooks/synergy/use-speech";

export type SynergyAction =
  | "decompose"
  | "variations"
  | "questions"
  | "research"
  | "actionable"
  | "rank"
  | "describe"
  | "tidy";

interface ActionDef {
  key: Exclude<SynergyAction, "describe">;
  label: string;
  Icon: React.ComponentType<{ className?: string; size?: number }>;
  disabledWhen?: "noVariations" | "noDescendants";
}

const ACTIONS: ActionDef[] = [
  { key: "decompose", label: "Decompose", Icon: DecomposeIcon },
  { key: "variations", label: "Variations", Icon: VariationsIcon },
  { key: "questions", label: "Questions", Icon: QuestionsIcon },
  { key: "research", label: "Research", Icon: ResearchIcon },
  { key: "actionable", label: "Make a plan", Icon: PlanIcon },
  { key: "rank", label: "Rank", Icon: RankIcon, disabledWhen: "noVariations" },
  { key: "tidy", label: "Tidy", Icon: TidyIcon, disabledWhen: "noDescendants" },
];

interface Props {
  nodeId: string;
  targetLabel: string;
  busyAction: string | null;
  canRank: boolean;
  canTidy: boolean;
  onAction: (action: SynergyAction, nodeId: string) => void;
  onDescribe: (instruction: string, nodeId: string) => void;
  onFocusThread?: (nodeId: string) => void;
}

export function SynergyNodeActionPopover({
  nodeId,
  targetLabel,
  busyAction,
  canRank,
  canTidy,
  onAction,
  onDescribe,
  onFocusThread,
}: Props) {
  const [describeText, setDescribeText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleVoiceFinal = (text: string) => {
    setDescribeText((prev) => (prev ? `${prev} ${text}`.trim() : text));
  };
  const speech = useSpeech(handleVoiceFinal);

  const isDescribing = busyAction === "describe";

  const submit = () => {
    const txt = describeText.trim();
    if (!txt || isDescribing) return;
    onDescribe(txt, nodeId);
    setDescribeText("");
    if (speech.listening) speech.stop();
  };

  useEffect(() => {
    return () => {
      if (speech.listening) speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="w-[340px] p-3"
      style={{
        background: "var(--glass-float-bg)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.6)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.6)",
        border: "1px solid var(--glass-border)",
        borderRadius: 18,
        boxShadow: [
          "inset 0 1px 0 var(--glass-highlight)",
          "0 2px 4px rgba(15, 23, 42, 0.04)",
          "0 18px 40px -16px rgba(15, 23, 42, 0.22)",
        ].join(", "),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2 px-1">
        <div className="min-w-0 flex-1">
          <div
            className="text-[10.5px] font-semibold tracking-[0.02em]"
            style={{ color: "rgba(15,23,42,0.55)" }}
          >
            Expand this card
          </div>
          <div
            className="truncate text-[12.5px] font-semibold tracking-tight"
            style={{ color: "rgba(15,23,42,0.92)" }}
          >
            {targetLabel}
          </div>
        </div>
        {onFocusThread && (
          <button
            type="button"
            onClick={() => onFocusThread(nodeId)}
            title="Focus this thread — soft-blur the rest of the board and open Focus Mode scoped here"
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold transition"
            style={{
              background: "rgba(15,23,42,0.04)",
              color: "rgba(15,23,42,0.62)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(15,23,42,0.08)";
              e.currentTarget.style.color = "rgba(15,23,42,0.92)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(15,23,42,0.04)";
              e.currentTarget.style.color = "rgba(15,23,42,0.62)";
            }}
          >
            <Focus className="h-2.5 w-2.5" strokeWidth={1.75} />
            Focus thread
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {ACTIONS.filter((a) => a.disabledWhen !== "noDescendants" || canTidy).map(
          (a) => {
            const disabled =
              a.disabledWhen === "noVariations"
                ? !canRank
                : a.disabledWhen === "noDescendants"
                  ? !canTidy
                  : false;
            const busy = busyAction === a.key;
            return (
              <button
                key={a.key}
                onClick={() => onAction(a.key, nodeId)}
                disabled={disabled || busy}
                title={
                  disabled
                    ? "Generate variations first"
                    : `${a.label} — scoped to this card`
                }
                className="group flex flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2.5 transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)] active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-30"
                style={{
                  background: "transparent",
                  color: "rgba(15,23,42,0.72)",
                }}
                onMouseEnter={(e) => {
                  if (disabled || busy) return;
                  e.currentTarget.style.background = "rgba(15,23,42,0.05)";
                  e.currentTarget.style.color = "rgba(15,23,42,0.95)";
                }}
                onMouseLeave={(e) => {
                  if (disabled || busy) return;
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "rgba(15,23,42,0.72)";
                }}
              >
                <div className="relative flex h-7 w-7 items-center justify-center">
                  {busy ? (
                    <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.5} />
                  ) : (
                    <a.Icon size={26} className="transition" />
                  )}
                </div>
                <div className="text-[11px] font-semibold">{a.label}</div>
              </button>
            );
          },
        )}
      </div>

      {/* Describe field — no fake border. Inherits the popover's glass
          with a slightly more saturated inner well so the input feels
          embedded, not stamped on. */}
      <div
        className="mt-3 flex items-center gap-1.5 px-2.5 py-1.5 transition focus-within:bg-white"
        style={{
          background: "rgba(255,255,255,0.7)",
          border: "1px solid var(--glass-hairline)",
          borderRadius: 12,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={describeText}
          onChange={(e) => setDescribeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={
            speech.listening
              ? speech.interim || "Listening…"
              : "Or describe what you want…"
          }
          disabled={isDescribing}
          className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[12.5px] outline-none disabled:opacity-50"
          style={{
            color: "rgba(15,23,42,0.92)",
          }}
        />
        <button
          onClick={() => {
            if (!speech.supported) return;
            if (speech.listening) speech.stop();
            else speech.start();
          }}
          disabled={!speech.supported || isDescribing}
          title={
            !speech.supported
              ? "Voice unsupported in this browser"
              : speech.listening
                ? "Stop voice input"
                : "Speak it instead"
          }
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)] active:scale-[0.94] disabled:opacity-30"
          style={
            speech.listening
              ? {
                  background:
                    "linear-gradient(180deg, rgba(15,23,42,0.94) 0%, rgba(15,23,42,0.82) 100%)",
                  color: "white",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 10px -6px rgba(15,23,42,0.55)",
                }
              : {
                  background: "transparent",
                  color: "rgba(15,23,42,0.55)",
                }
          }
          onMouseEnter={(e) => {
            if (speech.listening || !speech.supported || isDescribing) return;
            e.currentTarget.style.background = "rgba(15,23,42,0.06)";
            e.currentTarget.style.color = "rgba(15,23,42,0.92)";
          }}
          onMouseLeave={(e) => {
            if (speech.listening || !speech.supported || isDescribing) return;
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "rgba(15,23,42,0.55)";
          }}
        >
          {speech.listening ? (
            <MicOff className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <Mic className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
        <button
          onClick={submit}
          disabled={!describeText.trim() || isDescribing}
          title="Send (Enter)"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)] active:scale-[0.94]"
          style={
            !describeText.trim() || isDescribing
              ? {
                  background: "rgba(15,23,42,0.06)",
                  color: "rgba(15,23,42,0.35)",
                }
              : {
                  background:
                    "linear-gradient(180deg, rgba(10,132,255,1) 0%, rgba(0,111,230,1) 100%)",
                  color: "white",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 12px -6px rgba(10,132,255,0.5)",
                }
          }
        >
          {isDescribing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
      </div>
    </div>
  );
}
