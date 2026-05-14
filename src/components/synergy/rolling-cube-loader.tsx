// ── Rolling cube loader ──
//
// A cute CSS-3D cube that tumbles end-over-end while the dashboard
// is preparing the destination route. Used in place of a spinner
// during the brief window between "user submits prompt" and
// "navigation lands on the destination" (clarifying-questions fetch
// + createSession round-trip). Inline styles so the surface can mount
// it anywhere without dragging in a CSS module.
//
// Three faces are visible at any rotation step. Each face carries a
// soft tint from the ambient palette (cyan → indigo → violet) so the
// cube reads as "in family" with the dashboard background. Reduced
// motion users see a static cube — the keyframes are gated by a
// media query.

"use client";

interface Props {
  /** Pixel size — the cube is rendered as size × size. Default 72. */
  size?: number;
  /** Optional label shown beneath the cube. */
  label?: string;
}

export function RollingCubeLoader({ size = 72, label }: Props) {
  const half = size / 2;

  return (
    <div className="inline-flex flex-col items-center gap-3" aria-live="polite">
      <div
        className="relative"
        style={{
          width: size,
          height: size,
          perspective: `${size * 6}px`,
        }}
      >
        <div
          className="rolling-cube-inner"
          style={{
            width: size,
            height: size,
            transformStyle: "preserve-3d",
            animation: "rollingCubeTumble 3.2s cubic-bezier(0.65, 0, 0.35, 1) infinite",
          }}
        >
          {/* 6 faces. Each is a translucent rounded square with a
              radial highlight + soft tint. Box-shadow on the inside
              gives the impression of a thin glass shell. */}
          {(
            [
              { transform: `translateZ(${half}px)`, color: "rgba(6, 182, 212, 0.55)", glow: "rgba(6, 182, 212, 0.45)" },
              { transform: `rotateY(180deg) translateZ(${half}px)`, color: "rgba(168, 85, 247, 0.55)", glow: "rgba(168, 85, 247, 0.42)" },
              { transform: `rotateY(90deg) translateZ(${half}px)`, color: "rgba(99, 102, 241, 0.55)", glow: "rgba(99, 102, 241, 0.42)" },
              { transform: `rotateY(-90deg) translateZ(${half}px)`, color: "rgba(16, 185, 129, 0.5)", glow: "rgba(16, 185, 129, 0.36)" },
              { transform: `rotateX(90deg) translateZ(${half}px)`, color: "rgba(244, 114, 182, 0.42)", glow: "rgba(244, 114, 182, 0.32)" },
              { transform: `rotateX(-90deg) translateZ(${half}px)`, color: "rgba(59, 130, 246, 0.5)", glow: "rgba(59, 130, 246, 0.4)" },
            ] as const
          ).map((face, i) => (
            <div
              key={i}
              className="absolute inset-0 rounded-2xl"
              style={{
                transform: face.transform,
                background: `radial-gradient(circle at 32% 28%, ${face.color}, ${face.glow} 70%, rgba(255,255,255,0.4) 100%)`,
                boxShadow: [
                  "inset 0 1px 0 rgba(255, 255, 255, 0.85)",
                  "inset 0 -1px 0 rgba(15, 23, 42, 0.08)",
                  "0 0 16px -2px rgba(255, 255, 255, 0.4)",
                ].join(", "),
                border: "1px solid rgba(255, 255, 255, 0.55)",
                backdropFilter: "blur(2px)",
                WebkitBackdropFilter: "blur(2px)",
              }}
            />
          ))}
        </div>

        {/* Contact shadow — squashes with the cube's vertical motion */}
        <div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            bottom: -size * 0.18,
            width: size * 0.85,
            height: size * 0.16,
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse at center, rgba(15, 23, 42, 0.22) 0%, rgba(15, 23, 42, 0) 70%)",
            filter: "blur(4px)",
            animation: "rollingCubeShadow 3.2s cubic-bezier(0.65, 0, 0.35, 1) infinite",
          }}
        />
      </div>

      {label && (
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-gray-600">
          {label}
        </span>
      )}

      <style jsx>{`
        @keyframes rollingCubeTumble {
          0% {
            transform: translateY(0) rotateX(0deg) rotateY(0deg);
          }
          25% {
            transform: translateY(-${size * 0.18}px) rotateX(-90deg) rotateY(0deg);
          }
          50% {
            transform: translateY(0) rotateX(-180deg) rotateY(0deg);
          }
          75% {
            transform: translateY(-${size * 0.18}px) rotateX(-180deg) rotateY(90deg);
          }
          100% {
            transform: translateY(0) rotateX(-270deg) rotateY(90deg);
          }
        }
        @keyframes rollingCubeShadow {
          0%,
          50%,
          100% {
            transform: scaleX(1);
            opacity: 0.7;
          }
          25%,
          75% {
            transform: scaleX(0.7);
            opacity: 0.35;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .rolling-cube-inner {
            animation: none !important;
            transform: rotateX(-20deg) rotateY(28deg);
          }
        }
      `}</style>
    </div>
  );
}
