"use client";

import { useRef } from "react";
import { AnimatedBackground } from "./animated-background";
import { TopNavBar } from "./top-nav-bar";
import { EcosystemSection } from "./ecosystem-section";
import { GlobalQueryBox } from "./global-query-box";
import type { Space } from "@/types";

interface WelcomeHeroProps {
  greetingName: string;
  spaces: Space[];
}

export function WelcomeHero({ greetingName, spaces }: WelcomeHeroProps) {
  const heroRef = useRef<HTMLDivElement>(null);

  // Mouse-reactive glow on hero panel
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = heroRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty("--mx", `${x}%`);
    el.style.setProperty("--my", `${y}%`);
  };

  return (
    // Negative margin cancels parent's p-6 so background truly fills the full main area
    <div className="relative -m-6 min-h-screen">
      {/* Animated background — now fills the full area including padding */}
      <AnimatedBackground />

      {/* Content layer — vertically center the composition */}
      <div className="relative z-10 flex min-h-screen flex-col items-stretch justify-center px-6 py-6">
        {/* Top navigation */}
        <TopNavBar spaces={spaces} />

        {/* Hero panel wrapper with mouse-reactive glow */}
        <div
          ref={heroRef}
          onMouseMove={handleMouseMove}
          className="hero-glow-wrap anim-rise delay-300 mx-auto mt-7 max-w-[980px] rounded-[28px]"
        >
          <div className="glass-hero relative rounded-[28px] px-12 pt-7 pb-7">
            {/* Welcome text */}
            <div className="relative z-10 text-center">
              <p
                className="anim-fade-up delay-400 text-[28px] font-light text-gray-400"
                style={{ letterSpacing: "-0.025em", lineHeight: 1 }}
              >
                Welcome back,
              </p>
              <h1
                className="anim-fade-up delay-450 mt-1 pb-0.5"
                style={{
                  fontSize: 50,
                  fontWeight: 700,
                  letterSpacing: "-0.045em",
                  lineHeight: 1.08,
                  background:
                    "linear-gradient(180deg, #0a1020 10%, var(--gradient-name-end) 95%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {greetingName}
              </h1>

              {/* Status pill */}
              <div className="anim-scale-in delay-500 mt-2.5 inline-flex items-center gap-2 rounded-full border border-interaxis-300/40 bg-gradient-to-b from-white/80 to-interaxis-50/70 px-4 py-1 text-[12px] font-medium text-interaxis-600 shadow-sm backdrop-blur-md">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-interaxis-500 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-interaxis-500" />
                </span>
                Your Knowledge Graph Workspace
              </div>
            </div>

            {/* Ecosystem grid with hub sphere */}
            <div className="relative z-10">
              <EcosystemSection spaces={spaces} />
            </div>

            {/* Chat section */}
            <div className="relative z-10">
              <GlobalQueryBox />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
