"use client";

// ── RotatingWord ──
//
// Cross-fades through a list of words inside a fixed-width slot. The
// slot reserves the width of the longest word (via an invisible
// spacer) so the surrounding text never reflows. Every word is kept
// mounted at `position: absolute; inset: 0` and the active one fades
// + slides in by toggling opacity / translate; the others fade out at
// the same time. CSS handles the interpolation — no setTimeout-driven
// phase juggling, so transitions are continuous and never look
// "stepped".

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  words: ReadonlyArray<string>;
  intervalMs?: number;
  className?: string;
}

export function RotatingWord({
  words,
  intervalMs = 2600,
  className,
}: Props) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (words.length <= 1) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % words.length);
    }, intervalMs);
    return () => clearInterval(t);
  }, [words.length, intervalMs]);

  const longest = words.reduce((a, b) => (a.length >= b.length ? a : b), "");

  return (
    <span
      className={cn(
        "relative inline-block align-baseline whitespace-nowrap",
        className,
      )}
      aria-live="polite"
    >
      {/* Invisible spacer reserves the slot width based on the longest
          word so the rest of the headline never reflows. */}
      <span className="invisible" aria-hidden>
        {longest}
      </span>

      {words.map((w, i) => {
        const active = i === index;
        return (
          <span
            key={w}
            aria-hidden={!active}
            className="absolute inset-0 text-center"
            style={{
              opacity: active ? 1 : 0,
              transform: active ? "translateY(0)" : "translateY(0.18em)",
              transition:
                "opacity 540ms cubic-bezier(0.25,0.8,0.25,1), transform 540ms cubic-bezier(0.25,0.8,0.25,1)",
              backgroundImage:
                "linear-gradient(120deg, #0F172A 0%, #1E293B 35%, #475569 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              willChange: "opacity, transform",
            }}
          >
            {w}
          </span>
        );
      })}
    </span>
  );
}
