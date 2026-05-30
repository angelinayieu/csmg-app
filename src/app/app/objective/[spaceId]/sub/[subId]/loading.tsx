// ── /app/objective/[spaceId]/sub/[subId] — loading.tsx ──
//
// Renders the instant the user clicks "Open room" and replaces the
// old page only when the new RSC payload streams in. Without this,
// Next.js holds the prior route visible (the main canvas) while the
// 8-query server render runs — making clicks feel dead.
//
// The treatment is intentionally "atmospheric" rather than a literal
// skeleton: aurora-soft gradient orbs drifting behind a frosted glass
// card with a slow breathing pulse. The room's three lane silhouettes
// (Problems · Mechanisms · Results) tint the orbs so the loading
// state visually previews the room being unfurled.

import { appleVibe } from "@/lib/apple-vibe-tokens";

export default function SubObjectiveRoomLoading() {
  return (
    <div
      className="relative h-[100dvh] w-full overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,1) 0%, rgba(248,250,252,1) 60%, rgba(241,245,249,1) 100%)",
        fontFamily: appleVibe.font.stack,
      }}
      aria-busy="true"
      aria-label="Opening room"
    >
      {/* Floating aurora orbs — three lane-tinted gradient blobs that
          drift slowly behind everything. Pure CSS, no JS. */}
      <Orb
        color={appleVibe.stage.pain}
        size={520}
        top="-12%"
        left="-8%"
        delay="0s"
      />
      <Orb
        color={appleVibe.stage.features}
        size={620}
        top="38%"
        left="62%"
        delay="-7s"
      />
      <Orb
        color={appleVibe.stage.outcomes}
        size={480}
        top="68%"
        left="-6%"
        delay="-14s"
      />
      <Orb
        color={appleVibe.stage.objective}
        size={420}
        top="-6%"
        left="58%"
        delay="-3s"
      />

      {/* Faint lane silhouettes — three horizontal hairlines spanning
          the canvas, hinting at the room's structure underneath the
          atmosphere. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-10 px-12 opacity-[0.45]">
        {([appleVibe.stage.pain, appleVibe.stage.features, appleVibe.stage.outcomes] as const).map(
          (c, i) => (
            <div
              key={i}
              className="w-full max-w-[920px]"
              style={{
                animation: `subRoomShimmer 2.4s ease-in-out ${i * 0.18}s infinite`,
              }}
            >
              <div
                className="h-px w-full"
                style={{
                  background: `linear-gradient(90deg, transparent 0%, ${c}55 18%, ${c}88 50%, ${c}55 82%, transparent 100%)`,
                }}
              />
              <div className="mt-4 flex items-center gap-2.5">
                <span
                  className="block h-2 w-2 rounded-full"
                  style={{ background: c, opacity: 0.55 }}
                />
                <span
                  className="block h-2 rounded-full"
                  style={{
                    width: 140 - i * 22,
                    background: `${c}22`,
                  }}
                />
                <span
                  className="block h-2 rounded-full"
                  style={{
                    width: 90 + i * 18,
                    background: appleVibe.stroke.medium,
                  }}
                />
              </div>
            </div>
          ),
        )}
      </div>

      {/* Center frosted-glass plaque with the breathing glyph. */}
      <div className="relative z-10 flex h-full w-full items-center justify-center">
        <div
          className="flex flex-col items-center gap-5 px-10 py-7"
          style={{
            background: "rgba(255,255,255,0.62)",
            backdropFilter: "blur(28px) saturate(160%)",
            WebkitBackdropFilter: "blur(28px) saturate(160%)",
            border: `1px solid ${appleVibe.stroke.hairline}`,
            borderRadius: appleVibe.radius.xl,
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.9) inset, 0 24px 60px -24px rgba(11,18,40,0.22)",
          }}
        >
          {/* Triad of pulsing dots in the lane colors — Problems →
              Mechanisms → Results, breathing in sequence so the user
              reads "the room is assembling its three layers." */}
          <div className="flex items-center gap-2.5">
            <Dot color={appleVibe.stage.pain} delay="0s" />
            <Dot color={appleVibe.stage.features} delay="0.18s" />
            <Dot color={appleVibe.stage.outcomes} delay="0.36s" />
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <span
              className="text-[15px] font-semibold leading-tight"
              style={{
                color: appleVibe.text.primary,
                letterSpacing: "-0.01em",
                fontFamily: appleVibe.font.display,
              }}
            >
              Opening the room
            </span>
            <span
              className="text-[12px] font-light leading-relaxed"
              style={{ color: appleVibe.text.secondary }}
            >
              Unfurling problems, mechanisms, results
            </span>
          </div>
        </div>
      </div>

      {/* Local keyframes — kept in this file so loading.tsx is a
          single self-contained surface (no global CSS coupling). */}
      <style>{`
        @keyframes subRoomDrift {
          0%   { transform: translate3d(0,0,0)       scale(1);    }
          50%  { transform: translate3d(40px,-30px,0) scale(1.08); }
          100% { transform: translate3d(0,0,0)       scale(1);    }
        }
        @keyframes subRoomShimmer {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1;    }
        }
        @keyframes subRoomBreathe {
          0%, 100% { transform: scale(0.85); opacity: 0.55; }
          50%      { transform: scale(1.15); opacity: 1;    }
        }
      `}</style>
    </div>
  );
}

function Orb({
  color,
  size,
  top,
  left,
  delay,
}: {
  color: string;
  size: number;
  top: string;
  left: string;
  delay: string;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        top,
        left,
        width: size,
        height: size,
        background: `radial-gradient(circle at 50% 50%, ${color}55 0%, ${color}22 36%, transparent 68%)`,
        filter: "blur(34px)",
        animation: `subRoomDrift 16s ease-in-out ${delay} infinite`,
        willChange: "transform",
      }}
    />
  );
}

function Dot({ color, delay }: { color: string; delay: string }) {
  return (
    <span
      className="block h-2 w-2 rounded-full"
      style={{
        background: color,
        boxShadow: `0 0 12px ${color}80`,
        animation: `subRoomBreathe 1.4s ease-in-out ${delay} infinite`,
      }}
    />
  );
}
