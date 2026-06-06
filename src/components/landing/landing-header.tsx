"use client";

// Shared marketing-surface header used by both `/` and `/pricing` so the
// glass pill nav (Home / Plans / About) + akiboe wordmark stay persistent
// across the public surfaces. Active item is driven by `active` so each
// page highlights the right tab.

import { appleVibe } from "@/lib/apple-vibe-tokens";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";

const INK = "#0B0B0C";
const NAV = ["Home", "Plans", "About"] as const;
type NavItem = (typeof NAV)[number];

export function LandingHeader({
  active,
  subtitle,
}: {
  active: NavItem;
  subtitle?: string;
}) {
  return (
    <header className="relative z-30 flex flex-col items-center gap-3 px-6 pt-6 text-center">
      <a href="/" className="flex flex-col items-center transition-opacity hover:opacity-80">
        <InterAxisLogo variant="lockup" theme="light" size={26} />
        {subtitle && (
          <div
            className="mt-2 text-[12.5px] leading-none"
            style={{ color: appleVibe.text.tertiary }}
          >
            {subtitle}
          </div>
        )}
      </a>

      <nav className="flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/70 p-1 shadow-[0_10px_30px_-14px_rgba(11,18,40,0.28),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl">
        {NAV.map((item) => {
          const href =
            item === "Plans" ? "/pricing" : item === "Home" ? "/" : "#";
          const isStub = item === "About";
          const isActive = item === active;
          return (
            <a
              key={item}
              href={href}
              onClick={isStub ? (e) => e.preventDefault() : undefined}
              className="rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-black/[0.04]"
              style={{
                color: INK,
                background: isActive ? "rgba(15,23,42,0.06)" : undefined,
              }}
            >
              {item}
            </a>
          );
        })}
      </nav>
    </header>
  );
}
