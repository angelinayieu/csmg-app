"use client";

// ── Objective Canvas top chrome ──
//
// Minimal identity layer on the Objective Canvas landing. Logo +
// wordmark on the left; profile chip with credits on the right.
// The center is owned by HomeTabNav (Objective Canvas / Synergy).
//
// We do NOT include Whiteboards / Lab / Explore links here — the
// landing's job is to start ONE thing. If the user wants to navigate
// to other surfaces they can switch to Synergy via the tab pill.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Coins, LogOut } from "lucide-react";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface Props {
  userEmail: string;
  creditBalance?: number;
}

export function ObjectiveTopChrome({ userEmail, creditBalance = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = userEmail.split("@")[0].slice(0, 2).toUpperCase();

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <>
      {/* ── Top-left: brand ── */}
      <div
        className="pointer-events-auto fixed left-5 top-4 z-50 flex items-center gap-2"
        style={{ fontFamily: appleVibe.font.stack }}
      >
        <Link
          href="/app"
          className="flex items-center gap-2 rounded-full px-1 py-1 transition-opacity hover:opacity-80"
          title="InterAxis home"
        >
          <InterAxisLogo
            className="h-7 w-7 flex-shrink-0"
            style={{
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 12px rgba(11,18,40,0.18)",
              borderRadius: 8,
            }}
          />
          <span
            className="text-[13px] font-bold tracking-tight"
            style={{ color: appleVibe.text.primary }}
          >
            InterAxis
          </span>
        </Link>
      </div>

      {/* ── Top-right: profile chip ── */}
      <div
        ref={ref}
        className="pointer-events-auto fixed right-5 top-4 z-50"
        style={{ fontFamily: appleVibe.font.stack }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 backdrop-blur-xl transition-colors"
          style={{
            background: open
              ? "rgba(255,255,255,0.95)"
              : "rgba(255,255,255,0.78)",
            border: `1px solid ${appleVibe.stroke.hairline}`,
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 20px -10px rgba(11,18,40,0.18)",
          }}
          title={userEmail}
        >
          <div
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-300 to-pink-600 text-[10px] font-bold text-white shadow-sm"
          >
            {initials}
          </div>
          <span
            className="inline-flex items-center gap-1 text-[11px] font-bold"
            style={{ color: "rgba(91,33,182,0.95)" }}
          >
            <Coins className="h-2.5 w-2.5" />
            {creditBalance}
          </span>
        </button>

        {open && (
          <div
            className="absolute right-0 mt-2 w-[240px] overflow-hidden rounded-2xl backdrop-blur-xl"
            style={{
              border: `1px solid ${appleVibe.stroke.hairline}`,
              background: "rgba(255,255,255,0.97)",
              boxShadow:
                "0 12px 28px -8px rgba(11,18,40,0.18), 0 0 0 1px rgba(15,23,42,0.04)",
            }}
          >
            <div className="flex items-center gap-2.5 px-3 py-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-300 to-pink-600 text-[12px] font-bold text-white shadow-sm">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[12px] font-semibold"
                  style={{ color: appleVibe.text.primary }}
                >
                  {userEmail}
                </p>
                <p
                  className="text-[10.5px]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Pro plan
                </p>
              </div>
            </div>

            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
            >
              <span
                className="text-[10.5px] font-medium"
                style={{ color: appleVibe.text.tertiary }}
              >
                Credits
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                style={{
                  background: "rgba(124,58,237,0.08)",
                  border: "1px solid rgba(124,58,237,0.18)",
                  color: "rgba(91,33,182,0.95)",
                }}
              >
                <Coins className="h-2.5 w-2.5" />
                {creditBalance}
              </span>
            </div>

            <div
              className="px-2 pb-2 pt-1"
              style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
            >
              <Link
                href="/app/settings"
                className="block rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-black/5"
                style={{ color: appleVibe.text.secondary }}
              >
                Settings
              </Link>
              <form action="/auth/logout" method="POST">
                <button
                  type="submit"
                  className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all"
                  style={{
                    border: `1px solid ${appleVibe.stroke.hairline}`,
                    background: "rgba(255,255,255,0.6)",
                    color: appleVibe.text.secondary,
                  }}
                >
                  <LogOut className="h-3 w-3" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
