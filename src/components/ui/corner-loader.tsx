"use client";

// ── CornerLoader ──
//
// A tiny, non-occluding "we're loading" pill that floats in the
// bottom-right corner with a spinning coin. Deliberately NOT a
// full-screen takeover — the rest of the surface stays visible/usable.
// Used as the Next.js route-segment loading fallback so navigation
// never blanks the whole viewport with an immersive splash.

interface CornerLoaderProps {
  /** Short status line next to the spinner. */
  label?: string;
}

export function CornerLoader({ label = "Loading…" }: CornerLoaderProps) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-[9999]"
    >
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-slate-200/70 bg-white/85 px-3.5 py-2 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.25)] backdrop-blur-md">
        <span
          className="block h-4 w-4 rounded-full border-2 border-slate-200 border-t-interaxis-500"
          style={{ animation: "cornerSpin 0.7s linear infinite" }}
        />
        <span className="text-[12.5px] font-medium tracking-tight text-slate-600">
          {label}
        </span>
      </div>

      <style jsx global>{`
        @keyframes cornerSpin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
