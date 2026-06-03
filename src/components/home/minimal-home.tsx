"use client";

// ── Minimal home ──
//
// The default /app surface: a clean header, a time-aware greeting, the
// objective chatbox (the single entry point into the product), and the
// user's library below. As soon as the user starts typing, the home
// transitions onto a whiteboard surface — the greeting + library recede
// and the chatbox lifts onto a dot-grid board, so composing a thought
// already feels like being on the whiteboard. Submitting routes to the
// real objective canvas. Everything else (synergy, strategy, dashboards)
// is re-routed off the default path — reachable via /app?legacy=1.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";
import {
  ObjectiveChatbox,
  type SyncedTab,
} from "@/components/home/objective-chatbox";
import { LibraryGrid, type LibrarySpace } from "@/components/home/library-grid";

interface Props {
  displayName: string;
  email: string;
  creditBalance: number;
  spaces: LibrarySpace[];
  syncedTabs: SyncedTab[];
  driveConnected: boolean;
  /** Hidden draft objective space — typing lands the user on this board. */
  draftSpaceId?: string;
}

export function MinimalHome({
  displayName,
  email,
  creditBalance,
  spaces,
  syncedTabs,
  driveConnected,
  draftSpaceId,
}: Props) {
  const router = useRouter();
  // Default to the screenshot's "Good morning"; refine to local time after
  // mount so SSR + client agree (no hydration mismatch).
  const [greeting, setGreeting] = useState("Good morning");
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(
      h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening",
    );
  }, []);

  // composing = the user has started typing → morph onto the whiteboard.
  const [composing, setComposing] = useState(false);

  async function logout() {
    try {
      await createClient().auth.signOut();
    } catch {
      /* fall through to redirect regardless */
    }
    router.push("/auth/login");
  }

  const initial = (displayName || email || "?").trim().charAt(0).toUpperCase();

  return (
    <>
      {/* Whiteboard surface — fades in behind the chatbox once composing. */}
      <AnimatePresence>
        {composing && (
          <motion.div
            key="whiteboard-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none fixed inset-0"
            style={{
              zIndex: 1,
              background: appleVibe.surface.base,
              // tldraw-style dot grid so it reads as the whiteboard.
              backgroundImage:
                "radial-gradient(circle, rgba(15,23,42,0.07) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          />
        )}
      </AnimatePresence>

      <div
        className="relative mx-auto w-full max-w-[1100px] pb-20"
        style={{ zIndex: 2, fontFamily: appleVibe.font.stack }}
      >
        {/* ── Header ── */}
        <header className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2.5">
            <InterAxisLogo
              className="h-9 w-9"
              size={36}
              style={{ borderRadius: 11 }}
            />
            <span
              className="text-[17px] font-semibold tracking-tight"
              style={{ color: appleVibe.text.primary }}
            >
              Intersice
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/app/credits")}
              className="text-[12px] font-medium transition-opacity hover:opacity-70"
              style={{ color: appleVibe.text.tertiary }}
            >
              {creditBalance.toLocaleString()} credits
            </button>
            <div className="flex items-center gap-2">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                style={{ background: appleVibe.stage.features }}
              >
                {initial}
              </div>
              <div className="leading-tight">
                <div
                  className="text-[13px] font-semibold"
                  style={{ color: appleVibe.text.primary }}
                >
                  {displayName}
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="text-[11px] font-medium transition-opacity hover:opacity-70"
                  style={{ color: appleVibe.text.faint }}
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* ── Greeting + chatbox ── */}
        {/* Fixed top; the greeting stays in flow (height reserved) and only
            fades, so the chatbox never shifts when composing — it just
            expands in place. */}
        <section className="mx-auto mt-16 max-w-[760px]">
          <motion.h1
            animate={{ opacity: composing ? 0 : 1 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="text-center text-[34px] font-semibold leading-tight tracking-tight"
            style={{
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.display,
              letterSpacing: "-0.02em",
              pointerEvents: composing ? "none" : "auto",
            }}
          >
            {greeting},{" "}
            <span style={{ color: "#8B93C4" }}>{displayName}</span>
            <br />
            Thoughts…?
          </motion.h1>

          {/* Anchored chatbox — starts narrow, then only its width grows
              (centered) when composing, so it expands without moving. */}
          <motion.div
            className="mx-auto mt-10 w-full"
            animate={{ maxWidth: composing ? 680 : 480 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <ObjectiveChatbox
              syncedTabs={syncedTabs}
              driveConnected={driveConnected}
              onActiveChange={setComposing}
              draftSpaceId={draftSpaceId}
            />
          </motion.div>
        </section>

        {/* ── Library (recedes while composing) ── */}
        <AnimatePresence initial={false}>
          {!composing && (
            <motion.section
              key="library"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="mt-20"
            >
              <h2
                className="mb-5 text-[26px] font-semibold tracking-tight"
                style={{
                  color: appleVibe.text.primary,
                  fontFamily: appleVibe.font.display,
                  letterSpacing: "-0.02em",
                }}
              >
                library
              </h2>
              <LibraryGrid spaces={spaces} />
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
