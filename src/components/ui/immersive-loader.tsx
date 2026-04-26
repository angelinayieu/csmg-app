"use client";

// ── ImmersiveLoader ──
//
// Replaces the boxy grey skeleton flicker between routes with something
// that feels like the whiteboard catching its breath: dotted canvas, a
// breathing brand mark, a quiet status line, and three ghost cards that
// drift in from the periphery. Same vocabulary as the landing immersive
// hero so route transitions feel continuous, not surgical.

import { InterAxisLogo } from "@/components/brand/interaxis-logo";

interface ImmersiveLoaderProps {
  /** Status line under the logo. Defaults to a generic one. */
  label?: string;
}

const GHOST_CARDS = [
  { x: "12%", y: "22%", delay: 0, w: 180, h: 100, rot: -4 },
  { x: "76%", y: "30%", delay: 0.4, w: 200, h: 110, rot: 3 },
  { x: "20%", y: "72%", delay: 0.8, w: 170, h: 90, rot: 5 },
  { x: "72%", y: "76%", delay: 1.1, w: 190, h: 105, rot: -3 },
];

export function ImmersiveLoader({
  label = "Setting up your whiteboard…",
}: ImmersiveLoaderProps) {
  return (
    <div className="relative flex min-h-[70vh] w-full items-center justify-center overflow-hidden">
      {/* Dotted canvas background — same dot grid as landing */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.10) 1px, transparent 0)",
          backgroundSize: "22px 22px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 50%, black 40%, transparent 90%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 60% at 50% 50%, black 40%, transparent 90%)",
        }}
      />

      {/* Soft teal aura behind the brand mark */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(0,188,212,0.18), rgba(0,188,212,0) 70%)",
          animation: "iaPulse 3.4s ease-in-out infinite",
        }}
      />

      {/* Drifting ghost cards */}
      {GHOST_CARDS.map((c, i) => (
        <div
          key={i}
          aria-hidden
          className="pointer-events-none absolute rounded-2xl border border-white/60 bg-white/55 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)] backdrop-blur-md"
          style={{
            left: c.x,
            top: c.y,
            width: c.w,
            height: c.h,
            transform: `rotate(${c.rot}deg)`,
            animation: `iaDrift 5.5s ease-in-out ${c.delay}s infinite alternate`,
            opacity: 0.85,
          }}
        >
          {/* Ghost content lines */}
          <div className="flex h-full flex-col gap-2 p-4">
            <div className="h-2.5 w-1/2 rounded-full bg-slate-200/80" />
            <div className="h-2 w-3/4 rounded-full bg-slate-200/60" />
            <div className="mt-auto h-2 w-1/3 rounded-full bg-interaxis-200/70" />
          </div>
        </div>
      ))}

      {/* Brand mark + status */}
      <div className="relative z-10 flex flex-col items-center">
        <div
          className="rounded-2xl"
          style={{
            animation: "iaBreathe 2.6s ease-in-out infinite",
            filter:
              "drop-shadow(0 10px 30px rgba(0,188,212,0.25)) drop-shadow(0 4px 14px rgba(15,23,42,0.10))",
          }}
        >
          <InterAxisLogo className="h-14 w-14" size={112} />
        </div>

        <div className="mt-6 flex items-center gap-2.5 rounded-full border border-slate-200/70 bg-white/70 px-4 py-1.5 backdrop-blur-md">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-interaxis-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-interaxis-500" />
          </span>
          <span className="text-[12.5px] font-medium tracking-tight text-slate-600">
            {label}
          </span>
        </div>
      </div>

      <style jsx global>{`
        @keyframes iaBreathe {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.95;
          }
          50% {
            transform: scale(1.05);
            opacity: 1;
          }
        }
        @keyframes iaPulse {
          0%,
          100% {
            opacity: 0.55;
            transform: translate(-50%, -50%) scale(1);
          }
          50% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1.08);
          }
        }
        @keyframes iaDrift {
          0% {
            transform: translateY(0px) rotate(var(--rot, 0deg));
          }
          100% {
            transform: translateY(-10px) rotate(var(--rot, 0deg));
          }
        }
      `}</style>
    </div>
  );
}
