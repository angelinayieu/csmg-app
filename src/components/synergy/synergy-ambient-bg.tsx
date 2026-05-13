// ── Synergy ambient gradient background ──
//
// Slow-drifting layered radial gradients + a faint particle overlay,
// inspired by Vision Pro's environmental backgrounds.
//
// Three pseudo-element blobs:
//   - cyan blob (top-left, slow horizontal drift)
//   - indigo blob (bottom-right, slow vertical pulse)
//   - violet blob (center, slow rotation around a circle)
//
// All animations are 60s+ durations so the page never "feels busy" —
// the motion is at the threshold of perception. Reduced-motion users
// get a static composition (prefers-reduced-motion handled via CSS).
//
// Stacking: this component renders position:fixed at z-0 so it sits
// behind every dashboard surface. Surfaces use translucent glass so
// the ambient bleeds through.

"use client";

export function SynergyAmbientBg() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ backgroundColor: "#fafbff" }}
    >
      {/* Layer 1: cyan blob, top-left */}
      <div
        className="absolute -left-32 -top-32 h-[640px] w-[640px] rounded-full opacity-40"
        style={{
          background:
            "radial-gradient(circle at center, rgba(6, 182, 212, 0.55) 0%, rgba(6, 182, 212, 0) 65%)",
          filter: "blur(60px)",
          animation: "synergyAmbientDriftA 70s ease-in-out infinite",
        }}
      />
      {/* Layer 2: indigo blob, bottom-right */}
      <div
        className="absolute -right-32 -bottom-32 h-[720px] w-[720px] rounded-full opacity-35"
        style={{
          background:
            "radial-gradient(circle at center, rgba(99, 102, 241, 0.5) 0%, rgba(99, 102, 241, 0) 65%)",
          filter: "blur(70px)",
          animation: "synergyAmbientDriftB 90s ease-in-out infinite",
        }}
      />
      {/* Layer 3: violet blob, center, slow orbit */}
      <div
        className="absolute left-1/2 top-1/2 h-[480px] w-[480px] rounded-full opacity-25"
        style={{
          background:
            "radial-gradient(circle at center, rgba(168, 85, 247, 0.45) 0%, rgba(168, 85, 247, 0) 65%)",
          filter: "blur(80px)",
          animation: "synergyAmbientOrbit 110s linear infinite",
          transformOrigin: "center",
        }}
      />

      {/* Particle layer — very subtle drifting dots. Twelve absolutely
          positioned spans, each with a different drift duration so they
          don't form a visible pattern. */}
      <div className="absolute inset-0">
        {Array.from({ length: 12 }).map((_, i) => (
          <span
            key={i}
            className="absolute inline-block rounded-full bg-cyan-400/30"
            style={{
              left: `${(i * 73) % 100}%`,
              top: `${(i * 47) % 100}%`,
              width: i % 3 === 0 ? 3 : 2,
              height: i % 3 === 0 ? 3 : 2,
              animation: `synergyParticle${i % 3} ${30 + (i % 5) * 8}s ease-in-out infinite`,
              animationDelay: `${i * 1.7}s`,
              opacity: 0.5,
            }}
          />
        ))}
      </div>

      {/* SVG noise overlay to kill gradient banding */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.035] mix-blend-overlay"
        xmlns="http://www.w3.org/2000/svg"
      >
        <filter id="synergyNoise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#synergyNoise)" />
      </svg>

      <style jsx>{`
        @keyframes synergyAmbientDriftA {
          0%, 100% {
            transform: translate(0px, 0px) scale(1);
          }
          33% {
            transform: translate(120px, 80px) scale(1.08);
          }
          66% {
            transform: translate(60px, 160px) scale(0.96);
          }
        }
        @keyframes synergyAmbientDriftB {
          0%, 100% {
            transform: translate(0px, 0px) scale(1);
          }
          50% {
            transform: translate(-100px, -140px) scale(1.1);
          }
        }
        @keyframes synergyAmbientOrbit {
          0% {
            transform: translate(-50%, -50%) rotate(0deg) translate(120px) rotate(0deg);
          }
          100% {
            transform: translate(-50%, -50%) rotate(360deg) translate(120px) rotate(-360deg);
          }
        }
        @keyframes synergyParticle0 {
          0%, 100% { transform: translate(0, 0); opacity: 0.3; }
          50% { transform: translate(40px, -60px); opacity: 0.7; }
        }
        @keyframes synergyParticle1 {
          0%, 100% { transform: translate(0, 0); opacity: 0.4; }
          50% { transform: translate(-30px, 40px); opacity: 0.6; }
        }
        @keyframes synergyParticle2 {
          0%, 100% { transform: translate(0, 0); opacity: 0.5; }
          50% { transform: translate(50px, 20px); opacity: 0.8; }
        }
        @media (prefers-reduced-motion: reduce) {
          div[aria-hidden] > div {
            animation: none !important;
          }
          span {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
