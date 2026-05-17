// ── Synergy node action popover ──
//
// Apple-style sectioned action list. Replaces the previous 3×2 icon
// grid with two named groups — "Expand" (divergent moves: decompose,
// variations, questions) and "Sharpen" (convergent moves: research,
// plan, rank). Each row is icon-tile + label + one-line hint, giving
// new users semantic grouping instead of forcing icon recall.
//
//   ┌──────────────────────────────────────────────┐
//   │ EXPAND THIS CARD              ⌖ Focus thread │
//   │ "Your card label…"                           │
//   │                                              │
//   │ EXPAND                                       │
//   │   ▣  Decompose                               │
//   │      Break it into the parts it depends on   │
//   │   ▣  Variations                              │
//   │      Surface alternative framings            │
//   │   ▣  Questions                               │
//   │      Sharpen what's still underspecified     │
//   │                                              │
//   │ SHARPEN                                      │
//   │   ▣  Research                                │
//   │      Pull in supporting evidence             │
//   │   ▣  Make a plan                             │
//   │      Formalize the steps + risks             │
//   │   ▣  Rank                                    │
//   │      Promote the strongest variation         │
//   │                                              │
//   │ ── Tidy this subtree ───────────────         │
//   │                                              │
//   │ ┌────────────────────────────┐ ┌──┐ ┌──┐     │
//   │ │ Or describe what you want… │ │🎤│ │ ↗│     │
//   │ └────────────────────────────┘ └──┘ └──┘     │
//   └──────────────────────────────────────────────┘
//
// Visual rules (Apple-ish, restrained):
//   - Section labels: 9px mono uppercase tracking-[0.18em] gray-400
//   - Row hover: subtle bg-gray-50 lift + icon tile gets bg-white shadow
//   - Icon tiles: 32×32 rounded-lg, monochrome currentColor glyph
//   - Hairline dividers, no harsh borders
//   - Tidy demoted to a quiet footer link (utility, not generative)
//   - The describe field is the universal escape hatch

"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Focus, Loader2, Mic, MicOff } from "lucide-react";
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
  // disturbing the rest of the board. Demoted to a footer utility
  // link — only visible when the card has descendants (`canTidy`).
  | "tidy";

type ActionSection = "expand" | "sharpen";

interface ActionDef {
  key: Exclude<SynergyAction, "describe" | "tidy">;
  label: string;
  hint: string;
  Icon: React.ComponentType<{ className?: string; size?: number }>;
  section: ActionSection;
  // Per-row disabled rule keyed by what the parent must establish.
  // "noVariations" → Rank disabled until ≥2 variation children exist.
  disabledWhen?: "noVariations";
}

// Two-section layout reflects the divergent → convergent loop:
// EXPAND opens the idea up (more children, more options); SHARPEN
// chooses or strengthens what's already there.
const ACTIONS: ActionDef[] = [
  {
    key: "decompose",
    label: "Decompose",
    hint: "Break it into the parts it depends on",
    Icon: DecomposeIcon,
    section: "expand",
  },
  {
    key: "variations",
    label: "Variations",
    hint: "Surface alternative framings",
    Icon: VariationsIcon,
    section: "expand",
  },
  {
    key: "questions",
    label: "Questions",
    hint: "Sharpen what's still underspecified",
    Icon: QuestionsIcon,
    section: "expand",
  },
  {
    key: "research",
    label: "Research",
    hint: "Pull in supporting evidence",
    Icon: ResearchIcon,
    section: "sharpen",
  },
  {
    key: "actionable",
    label: "Make a plan",
    hint: "Formalize the steps + risks",
    Icon: PlanIcon,
    section: "sharpen",
  },
  {
    key: "rank",
    label: "Rank",
    hint: "Promote the strongest variation",
    Icon: RankIcon,
    section: "sharpen",
    disabledWhen: "noVariations",
  },
];

const SECTION_ORDER: Array<{ key: ActionSection; label: string }> = [
  { key: "expand", label: "Expand" },
  { key: "sharpen", label: "Sharpen" },
];

interface Props {
  // Identity of the card this popover is acting on. Passed through
  // to the action dispatcher and the describe handler so the
  // whiteboard knows which card to anchor results under.
  nodeId: string;
  // Truncated label of the target — shown as the popover title.
  targetLabel: string;
  // Which action key is currently in-flight for this card, if any.
  // Drives the per-row spinner. null = idle.
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
  // Called when the user taps the "Focus thread" chip in the header.
  // Drops the rest of the board into a soft blur and opens Focus Mode
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
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Voice input feeds the same describe field. When the user clicks
  // mic and speaks, the interim transcript builds up live and the
  // final commits when they stop speaking. They can edit before sending.
  const handleVoiceFinal = (text: string) => {
    setDescribeText((prev) => (prev ? `${prev} ${text}`.trim() : text));
  };
  const speech = useSpeech(handleVoiceFinal);

  const isDescribing = busyAction === "describe";
  const isTidying = busyAction === "tidy";

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
      className="w-[348px] rounded-2xl"
      style={{
        // Apple translucent popover — vibrancy stack matches the
        // glass dock + Focus Mode pane.
        background: "rgba(252, 252, 253, 0.92)",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
        boxShadow: [
          "inset 0 1px 0 rgba(255, 255, 255, 0.75)",
          "0 1px 2px rgba(15, 23, 42, 0.04)",
          "0 16px 40px -10px rgba(15, 23, 42, 0.18)",
          "0 0 0 0.5px rgba(0, 0, 0, 0.07)",
        ].join(", "),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ── Header: card label + Focus thread chip ── */}
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
            Expand this card
          </div>
          <div className="mt-0.5 truncate text-[12px] font-medium text-gray-800">
            {targetLabel}
          </div>
        </div>
        {onFocusThread && (
          <button
            type="button"
            onClick={() => onFocusThread(nodeId)}
            title="Focus this thread — soft-blur the rest of the board"
            className="group inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
          >
            <Focus
              className="h-2.5 w-2.5 transition-transform group-hover:scale-110"
              strokeWidth={1.75}
            />
            Focus thread
          </button>
        )}
      </div>

      {/* Hairline divider — softer than a border */}
      <div
        aria-hidden
        className="mx-4 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(15,23,42,0.08) 20%, rgba(15,23,42,0.08) 80%, transparent 100%)",
        }}
      />

      {/* ── Sectioned action rows ── */}
      <div className="px-2 py-2">
        {SECTION_ORDER.map((section, idx) => (
          <div key={section.key} className={idx > 0 ? "mt-2" : ""}>
            <div className="px-2 pt-1.5 pb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
              {section.label}
            </div>
            <div className="flex flex-col">
              {ACTIONS.filter((a) => a.section === section.key).map((a) => {
                const disabled =
                  a.disabledWhen === "noVariations" ? !canRank : false;
                const busy = busyAction === a.key;
                const isHovered = hoveredRow === a.key;
                return (
                  <button
                    key={a.key}
                    onClick={() => onAction(a.key, nodeId)}
                    onMouseEnter={() => setHoveredRow(a.key)}
                    onMouseLeave={() =>
                      setHoveredRow((h) => (h === a.key ? null : h))
                    }
                    disabled={disabled || busy}
                    title={
                      disabled
                        ? "Generate variations first"
                        : a.hint
                    }
                    className={[
                      "group relative flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-all duration-200",
                      disabled
                        ? "cursor-not-allowed opacity-30"
                        : "hover:bg-white/70",
                    ].join(" ")}
                    style={{
                      // Soft inner glow when hovered — feels like a key cap
                      boxShadow:
                        !disabled && isHovered
                          ? "inset 0 0 0 0.5px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)"
                          : undefined,
                    }}
                  >
                    {/* Icon tile — neutral gray-50 rest, white+shadow on hover */}
                    <div
                      className={[
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                        disabled
                          ? "bg-gray-50 text-gray-400"
                          : isHovered
                            ? "bg-white text-gray-900"
                            : "bg-gray-50 text-gray-700",
                      ].join(" ")}
                      style={{
                        boxShadow:
                          !disabled && isHovered
                            ? "inset 0 0 0 0.5px rgba(15,23,42,0.08), 0 1px 1.5px rgba(15,23,42,0.06)"
                            : undefined,
                      }}
                    >
                      {busy ? (
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          strokeWidth={1.5}
                        />
                      ) : (
                        <a.Icon size={20} />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium leading-tight text-gray-900">
                        {a.label}
                      </div>
                      <div className="mt-0.5 truncate text-[10.5px] leading-snug text-gray-500">
                        {a.hint}
                      </div>
                    </div>

                    {/* Subtle right-side affordance on hover — a thin
                        vertical accent that suggests "click to run" without
                        adding a literal chevron. */}
                    <div
                      aria-hidden
                      className="h-6 w-px shrink-0 transition-opacity duration-200"
                      style={{
                        opacity: !disabled && isHovered ? 1 : 0,
                        background:
                          "linear-gradient(180deg, transparent 0%, rgba(15,23,42,0.18) 50%, transparent 100%)",
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Footer: Tidy utility (if applicable) + describe field ── */}
      {(canTidy || true) && (
        <div className="px-3 pb-3 pt-1">
          {canTidy && (
            <button
              type="button"
              onClick={() => onAction("tidy", nodeId)}
              disabled={isTidying}
              title="Re-layout this card's descendants without disturbing the rest of the board"
              className="group mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/70 disabled:opacity-50"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-50 text-gray-600 transition group-hover:bg-white group-hover:text-gray-900">
                {isTidying ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                ) : (
                  <TidyIcon size={14} />
                )}
              </div>
              <span className="text-[11px] font-medium text-gray-600 group-hover:text-gray-900">
                Tidy this subtree
              </span>
              <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.15em] text-gray-400">
                Layout
              </span>
            </button>
          )}

          {/* Describe — the escape hatch. Free-form instruction that
              the backend treats as a custom expansion of the target. */}
          <div
            className="flex items-center gap-1.5 rounded-xl bg-white px-2 py-1.5 transition focus-within:ring-1 focus-within:ring-gray-300/60"
            style={{
              boxShadow:
                "inset 0 0 0 0.5px rgba(15,23,42,0.08), 0 1px 1.5px rgba(15,23,42,0.03)",
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
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
