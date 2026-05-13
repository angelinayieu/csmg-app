// ── Synergy node action popover ──
//
// Replaces the inline horizontal action-chip menu that used to float
// below a hovered/selected card. New shape:
//
//   ┌─────────────────────────────────────────────┐
//   │ Expand this card                       More │
//   │                                             │
//   │ ┌─────┐ ┌─────┐ ┌─────┐                     │
//   │ │ icn │ │ icn │ │ icn │                     │
//   │ │ dec │ │ var │ │ que │                     │
//   │ └─────┘ └─────┘ └─────┘                     │
//   │ ┌─────┐ ┌─────┐ ┌─────┐                     │
//   │ │ icn │ │ icn │ │ icn │                     │
//   │ │ res │ │ pln │ │ rnk │                     │
//   │ └─────┘ └─────┘ └─────┘                     │
//   │                                             │
//   │ ┌─────────────────────────────────┐ ┌─────┐ │
//   │ │ Or describe what you want…      │ │ mic │ │
//   │ └─────────────────────────────────┘ └─────┘ │
//   └─────────────────────────────────────────────┘
//
// The "Or describe…" field is the escape hatch — typed or spoken
// instructions go through a new `describe` augment mode that spawns
// child nodes scoped to the source card, like the discrete actions
// but with the user's custom instruction as the prompt.

"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Send } from "lucide-react";
import {
  DecomposeIcon,
  PlanIcon,
  QuestionsIcon,
  RankIcon,
  ResearchIcon,
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
  | "describe";

interface ActionDef {
  key: Exclude<SynergyAction, "describe">;
  label: string;
  Icon: React.ComponentType<{ className?: string; size?: number }>;
  tileTint: string; // background tint behind the tile on hover
  disabledWhen?: "noVariations";
}

// Order chosen to match the user's mental flow: break it down,
// alternatives, sharpen, research, formalize, rank. Six actions in
// a 3×2 grid keeps the popover compact and scannable.
const ACTIONS: ActionDef[] = [
  { key: "decompose", label: "Decompose", Icon: DecomposeIcon, tileTint: "hover:bg-indigo-50/70" },
  { key: "variations", label: "Variations", Icon: VariationsIcon, tileTint: "hover:bg-fuchsia-50/70" },
  { key: "questions", label: "Questions", Icon: QuestionsIcon, tileTint: "hover:bg-amber-50/70" },
  { key: "research", label: "Research", Icon: ResearchIcon, tileTint: "hover:bg-purple-50/70" },
  { key: "actionable", label: "Make a plan", Icon: PlanIcon, tileTint: "hover:bg-sky-50/70" },
  { key: "rank", label: "Rank", Icon: RankIcon, tileTint: "hover:bg-orange-50/70", disabledWhen: "noVariations" },
];

interface Props {
  // Identity of the card this popover is acting on. Passed through
  // to the action dispatcher and the describe handler so the
  // whiteboard knows which card to anchor results under.
  nodeId: string;
  // Truncated label of the target — shown as the popover title.
  targetLabel: string;
  // Which action key is currently in-flight for this card, if any.
  // Drives the per-tile spinner. null = idle.
  busyAction: string | null;
  // Whether Rank should be enabled. False until the card has ≥2
  // variation children.
  canRank: boolean;
  onAction: (action: SynergyAction, nodeId: string) => void;
  // Called when the user submits free-text in "Or describe…".
  onDescribe: (instruction: string, nodeId: string) => void;
}

export function SynergyNodeActionPopover({
  nodeId,
  targetLabel,
  busyAction,
  canRank,
  onAction,
  onDescribe,
}: Props) {
  const [describeText, setDescribeText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Voice input feeds the same describe field. When the user clicks
  // mic and speaks, the interim transcript builds up live and the
  // final commits when they stop speaking. They can edit before sending.
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

  // Auto-stop voice if the popover unmounts (selection changed).
  useEffect(() => {
    return () => {
      if (speech.listening) speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="w-[324px] rounded-2xl border border-gray-200 bg-white/96 p-3 shadow-lg backdrop-blur"
      // Don't propagate pointerdown — clicking inside the popover
      // should never initiate a drag on the underlying card or close
      // the menu's parent hover state.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <div className="font-mono text-[9px] uppercase tracking-wider text-gray-500">
            Expand this card
          </div>
          <div className="truncate text-[11px] font-medium text-gray-700">
            {targetLabel}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {ACTIONS.map((a) => {
          const disabled = a.disabledWhen === "noVariations" ? !canRank : false;
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
              className={[
                "group flex flex-col items-center justify-center gap-1 rounded-xl border border-transparent bg-gray-50/50 px-1.5 py-2.5 transition",
                a.tileTint,
                "hover:border-gray-200 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-gray-50/50 disabled:hover:border-transparent",
              ].join(" ")}
            >
              <div className="relative flex h-7 w-7 items-center justify-center">
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                ) : (
                  <a.Icon size={26} className="transition group-hover:scale-110" />
                )}
              </div>
              <div className="text-[10.5px] font-medium text-gray-700">
                {a.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Or describe — the escape hatch. Anything the predefined
          actions don't cover gets routed through a free-form
          instruction that the backend treats as a custom expansion
          of the target card. */}
      <div className="mt-3 flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 py-1.5 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200">
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
          className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[12px] text-gray-900 outline-none placeholder:text-gray-400 disabled:opacity-50"
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
          className={[
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition",
            speech.listening
              ? "bg-rose-500 text-white animate-pulse"
              : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
            "disabled:opacity-30 disabled:hover:bg-transparent",
          ].join(" ")}
        >
          {speech.listening ? (
            <MicOff className="h-3 w-3" />
          ) : (
            <Mic className="h-3 w-3" />
          )}
        </button>
        <button
          onClick={submit}
          disabled={!describeText.trim() || isDescribing}
          title="Send (Enter)"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:scale-105 disabled:bg-gray-300 disabled:hover:scale-100"
        >
          {isDescribing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
        </button>
      </div>
    </div>
  );
}
