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
  // Tidy this subtree: re-lay the target's descendants without
  // disturbing the rest of the board. Surfaces in the popover only
  // when the card has descendants (`canTidy` prop).
  | "tidy";

interface ActionDef {
  key: Exclude<SynergyAction, "describe">;
  label: string;
  Icon: React.ComponentType<{ className?: string; size?: number }>;
  disabledWhen?: "noVariations" | "noDescendants";
}

// Order chosen to match the user's mental flow: break it down,
// alternatives, sharpen, research, formalize, rank, tidy. Seven
// actions; the grid still uses 3 columns so the last row hangs the
// odd one (Tidy) on its own. Tidy is conditionally hidden when the
// card has no descendants — so the common case is a clean 3×2.
//
// Per-action tile tints removed — Apple aesthetic. All tiles share
// one neutral hover state; icons are monochrome (currentColor) so
// the popover reads as a single cohesive surface.
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
  // Whether Tidy should be visible / enabled. False when the card
  // has no descendants — nothing to re-lay out.
  canTidy: boolean;
  onAction: (action: SynergyAction, nodeId: string) => void;
  // Called when the user submits free-text in "Or describe…".
  onDescribe: (instruction: string, nodeId: string) => void;
  // Called when the user taps the "Focus thread" affordance. Drops
  // the rest of the board into a soft blur and opens Focus Mode
  // scoped to this node's thread.
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
      className="w-[324px] rounded-2xl p-3"
      style={{
        // Apple translucent popover — same vibrancy stack as the AI rail
        background: "rgba(252, 252, 253, 0.92)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        boxShadow: [
          "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
          "0 1px 2px rgba(15, 23, 42, 0.05)",
          "0 12px 32px -8px rgba(15, 23, 42, 0.18)",
          "0 0 0 1px rgba(0, 0, 0, 0.06)",
        ].join(", "),
      }}
      // Don't propagate pointerdown — clicking inside the popover
      // should never initiate a drag on the underlying card or close
      // the menu's parent hover state.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-start justify-between gap-2 px-1">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-500">
            Expand this card
          </div>
          <div className="truncate text-[11.5px] font-medium text-gray-800">
            {targetLabel}
          </div>
        </div>
        {onFocusThread && (
          <button
            type="button"
            onClick={() => onFocusThread(nodeId)}
            title="Focus this thread — soft-blur the rest of the board and open Focus Mode scoped here"
            className="group inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200/80 bg-white px-1.5 py-1 text-[10px] font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
          >
            <Focus className="h-2.5 w-2.5" strokeWidth={1.75} />
            Focus thread
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1">
        {ACTIONS
          // Hide Tidy entirely (don't render a dead tile) when there's
          // nothing to tidy. The user only sees it when meaningful.
          .filter((a) => a.disabledWhen !== "noDescendants" || canTidy)
          .map((a) => {
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
              className={[
                // Monochrome icon (text-gray-700 → currentColor in the SVG)
                "group flex flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2.5 text-gray-700 transition",
                "hover:bg-gray-100 hover:text-gray-900",
                "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
              ].join(" ")}
            >
              <div className="relative flex h-7 w-7 items-center justify-center">
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.5} />
                ) : (
                  <a.Icon size={26} className="transition" />
                )}
              </div>
              <div className="text-[10.5px] font-medium">{a.label}</div>
            </button>
          );
        })}
      </div>

      {/* Or describe — the escape hatch. Free-form instruction that
          the backend treats as a custom expansion of the target card. */}
      <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-white px-2 py-1.5 transition focus-within:bg-white"
        style={{
          boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.06)",
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
              ? "bg-gray-900 text-white"
              : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
            "disabled:opacity-30 disabled:hover:bg-transparent",
          ].join(" ")}
        >
          {speech.listening ? (
            <MicOff className="h-3 w-3" strokeWidth={1.5} />
          ) : (
            <Mic className="h-3 w-3" strokeWidth={1.5} />
          )}
        </button>
        <button
          onClick={submit}
          disabled={!describeText.trim() || isDescribing}
          title="Send (Enter)"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white transition hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400"
        >
          {isDescribing ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
          ) : (
            <Send className="h-3 w-3" strokeWidth={1.5} />
          )}
        </button>
      </div>
    </div>
  );
}
