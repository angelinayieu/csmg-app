"use client";

// ── Synergism Whiteboard Tile ──
//
// Sits on the Objective Canvas main view as a "blank space" entry
// point into the brainstorm whiteboard. The user can step off the
// structured canvas (subs, layers, archetypes) into a free-form
// surface where they can speak, sketch, drop sticky notes, and let
// the AI augment in real time.
//
// Tile reads as a glass-tiered Vision Pro affordance — soft accent
// halo, subtle interior light highlight, gentle hover lift. The
// objective text is seeded into the session so the whiteboard opens
// with the user's question already anchoring the canvas.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Loader2, Mic, StickyNote } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";

interface Props {
  /** The current objective text — passed as the seed so the whiteboard
   *  opens with the user's question as the core node, ready to be
   *  spoken into or branched from. */
  objective: string;
}

export function SynergismWhiteboardTile({ objective }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onOpen = () => {
    if (pending) return;
    setPending(true);
    // /app/synergy/new is a server component that creates a fresh
    // brainstorm_sessions row + seed core node, then redirects to
    // /app/synergy/[id]. Passing the objective text as the seed
    // anchors the new board with the user's question.
    const trimmed = objective.trim().slice(0, 400);
    const qs = new URLSearchParams();
    if (trimmed.length >= 4) qs.set("seed", trimmed);
    router.push(`/app/synergy/new${qs.toString() ? `?${qs.toString()}` : ""}`);
  };

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={pending}
      className="group relative block w-full overflow-hidden text-left transition-all duration-300 ease-[var(--ease-spring-tight)] hover:-translate-y-0.5 active:scale-[0.995] disabled:cursor-wait disabled:opacity-80"
      style={{
        background: "var(--glass-card-bg)",
        border: "1px solid var(--glass-hairline)",
        borderRadius: 24,
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 12px 32px -16px rgba(11,18,40,0.18)",
        backdropFilter: "blur(var(--blur-card)) saturate(1.5)",
        WebkitBackdropFilter: "blur(var(--blur-card)) saturate(1.5)",
      }}
    >
      {/* Ambient halo — sits behind the content, radiates out from the
          left where the icon is. Pointer-events off; pure decoration. */}
      <div
        className="pointer-events-none absolute -left-20 -top-20 h-[280px] w-[280px] opacity-70 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(circle, rgba(10,132,255,0.16) 0%, rgba(71,85,105,0.08) 40%, transparent 75%)",
          filter: "blur(8px)",
        }}
        aria-hidden
      />

      <div className="relative flex items-center gap-5 px-6 py-5">
        {/* Iconography badge — gradient glass with a subtle pulse on
            hover. Hosts the sparkle as the "this is intelligent" mark. */}
        <div
          className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
          style={{
            background:
              "linear-gradient(150deg, rgba(10,132,255,0.92) 0%, rgba(71,85,105,0.95) 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.30), 0 10px 24px -10px rgba(10,132,255,0.50)",
          }}
        >
          {pending ? (
            <Loader2 className="h-6 w-6 animate-spin text-white" strokeWidth={1.75} />
          ) : (
            <Sparkle
              className="h-6 w-6 text-white"
              strokeWidth={1.75}
              style={{ filter: "drop-shadow(0 0 8px rgba(255,255,255,0.35))" }}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-[10.5px] font-semibold tracking-[0.02em]"
              style={{ color: "rgba(10,132,255,0.95)" }}
            >
              Free-form mode
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em]"
              style={{
                background: "rgba(10,132,255,0.10)",
                color: "rgba(0,88,184,0.95)",
              }}
            >
              New design
            </span>
          </div>
          <h3
            className="mt-1 text-[18px] font-semibold leading-snug tracking-tight"
            style={{ color: "rgba(15,23,42,0.92)" }}
          >
            Open the Brainstorm Whiteboard
          </h3>
          <p
            className="mt-1 text-[12.5px] leading-snug"
            style={{ color: "rgba(15,23,42,0.62)" }}
          >
            Step off the structured canvas into a free-form board.
            Speak, sketch, drop sticky notes — the AI Companion
            decomposes, sharpens, and researches your thinking in real
            time, anchored to your objective.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <FeatureChip Icon={Mic} label="Voice-first" />
            <FeatureChip Icon={Sparkle} label="AI Companion" />
            <FeatureChip Icon={StickyNote} label="Sticky + sketch" />
          </div>
        </div>

        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)] group-hover:translate-x-0.5"
          style={{
            background: "rgba(15,23,42,0.05)",
            color: "rgba(15,23,42,0.62)",
          }}
        >
          <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} />
        </div>
      </div>
    </button>
  );
}

function FeatureChip({
  Icon,
  label,
}: {
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
      style={{
        background: "rgba(15,23,42,0.04)",
        color: "rgba(15,23,42,0.62)",
      }}
    >
      <Icon className="h-2.5 w-2.5" strokeWidth={2} />
      {label}
    </span>
  );
}
