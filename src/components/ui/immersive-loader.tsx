"use client";

// ── ImmersiveLoader ──
//
// Whiteboard surface with a wireframe 3D cube rotating at its center.
// Pure CSS transforms — no Three.js mount delay, no canvas warmup, no
// teal. Reads as an architect's sketch coming to life on a fresh page:
// dotted grid, soft graphite ink, a single floating volume.
//
// API unchanged: same `label` prop the two route-level loading.tsx
// files (app/loading.tsx, app/space/[id]/loading.tsx) already pass.

interface ImmersiveLoaderProps {
  /** Status line under the cube. Defaults to a generic one. */
  label?: string;
}

const CUBE_SIZE = 132;
const HALF = CUBE_SIZE / 2;

export function ImmersiveLoader({
  label = "Setting up your whiteboard…",
}: ImmersiveLoaderProps) {
  return (
    <div className="relative flex min-h-[70vh] w-full items-center justify-center overflow-hidden bg-[#fafbfc]">
      {/* Dotted whiteboard grid — radial mask so it fades at edges */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.07) 1px, transparent 0)",
          backgroundSize: "22px 22px",
          maskImage:
            "radial-gradient(ellipse 65% 55% at 50% 50%, black 35%, transparent 88%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 65% 55% at 50% 50%, black 35%, transparent 88%)",
        }}
      />

      {/* Cube + ground shadow */}
      <div className="relative z-10 flex flex-col items-center">
        <div className="ia-stage">
          <div className="ia-cube">
            <div className="ia-face ia-face-front" />
            <div className="ia-face ia-face-back" />
            <div className="ia-face ia-face-right" />
            <div className="ia-face ia-face-left" />
            <div className="ia-face ia-face-top" />
            <div className="ia-face ia-face-bottom" />
          </div>
          <div className="ia-shadow" aria-hidden />
        </div>

        <div className="mt-10 flex items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/80 px-4 py-1.5 backdrop-blur-md shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-slate-400 opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-slate-500" />
          </span>
          <span className="text-[12.5px] font-medium tracking-tight text-slate-600">
            {label}
          </span>
        </div>
      </div>

      <style jsx>{`
        .ia-stage {
          position: relative;
          width: ${CUBE_SIZE * 2}px;
          height: ${CUBE_SIZE * 1.6}px;
          perspective: 900px;
          perspective-origin: 50% 45%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .ia-cube {
          position: relative;
          width: ${CUBE_SIZE}px;
          height: ${CUBE_SIZE}px;
          transform-style: preserve-3d;
          animation: ia-cube-spin 14s linear infinite;
          will-change: transform;
        }

        .ia-face {
          position: absolute;
          inset: 0;
          background: rgba(255, 255, 255, 0.55);
          border: 1px solid rgba(15, 23, 42, 0.55);
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.7),
            inset 0 18px 36px -18px rgba(15, 23, 42, 0.08);
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
        }

        .ia-face-front  { transform: translateZ(${HALF}px); }
        .ia-face-back   { transform: rotateY(180deg) translateZ(${HALF}px); }
        .ia-face-right  { transform: rotateY(90deg)  translateZ(${HALF}px); }
        .ia-face-left   { transform: rotateY(-90deg) translateZ(${HALF}px); }
        .ia-face-top    { transform: rotateX(90deg)  translateZ(${HALF}px); }
        .ia-face-bottom { transform: rotateX(-90deg) translateZ(${HALF}px); }

        .ia-shadow {
          position: absolute;
          bottom: 6%;
          left: 50%;
          width: ${CUBE_SIZE * 1.4}px;
          height: 22px;
          transform: translateX(-50%);
          background: radial-gradient(
            ellipse at center,
            rgba(15, 23, 42, 0.18) 0%,
            rgba(15, 23, 42, 0.06) 45%,
            transparent 75%
          );
          filter: blur(6px);
          animation: ia-shadow-breathe 14s ease-in-out infinite;
        }

        @keyframes ia-cube-spin {
          0%   { transform: rotateX(-22deg) rotateY(0deg);   }
          50%  { transform: rotateX(-18deg) rotateY(180deg); }
          100% { transform: rotateX(-22deg) rotateY(360deg); }
        }

        @keyframes ia-shadow-breathe {
          0%, 100% { opacity: 0.9; transform: translateX(-50%) scaleX(1);    }
          50%      { opacity: 0.7; transform: translateX(-50%) scaleX(0.88); }
        }

        @media (prefers-reduced-motion: reduce) {
          .ia-cube {
            animation: none;
            transform: rotateX(-22deg) rotateY(-28deg);
          }
          .ia-shadow {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
