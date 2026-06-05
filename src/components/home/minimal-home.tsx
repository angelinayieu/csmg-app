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

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Coins, Settings as SettingsIcon, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";
import {
  ObjectiveChatbox,
  type SyncedTab,
} from "@/components/home/objective-chatbox";
import { LibraryGrid, type LibrarySpace } from "@/components/home/library-grid";

// ── Animated dotted-ring mark ──
// A ring of small dots that gently rotates with a comet-tail opacity
// gradient, while the whole mark floats softly above the greeting. Reads
// as a quiet "thinking" pulse rather than a busy spinner.
function DottedRingMark() {
  const DOTS = 12;
  const radius = 13; // px from center
  const size = 38; // viewBox px
  const center = size / 2;
  return (
    <motion.div
      aria-hidden
      className="mx-auto mb-5"
      style={{ width: size, height: size }}
      animate={{ y: [0, -5, 0] }}
      transition={{ duration: 3.6, ease: "easeInOut", repeat: Infinity }}
    >
      <motion.svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        animate={{ rotate: 360 }}
        transition={{ duration: 8, ease: "linear", repeat: Infinity }}
        style={{ display: "block" }}
      >
        {Array.from({ length: DOTS }).map((_, i) => {
          const angle = (i / DOTS) * Math.PI * 2 - Math.PI / 2;
          const cx = center + radius * Math.cos(angle);
          const cy = center + radius * Math.sin(angle);
          // comet-tail: leading dots brighter/larger, trailing dots fade.
          const t = i / DOTS;
          const opacity = 0.18 + 0.82 * t;
          const r = 1.1 + 1.2 * t;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill={appleVibe.text.primary}
              opacity={opacity}
            />
          );
        })}
      </motion.svg>
    </motion.div>
  );
}

interface Props {
  displayName: string;
  email: string;
  creditBalance: number;
  spaces: LibrarySpace[];
  syncedTabs: SyncedTab[];
  driveConnected: boolean;
  /** Hidden draft objective space — typing lands the user on this board. */
  draftSpaceId?: string;
  /** Instant intake. When provided, a real whiteboard is mounted UNDERNEATH
   *  this home; the first keystroke hands the text to it + the host fades this
   *  home away (no navigation). The fake dot-grid morph is suppressed since
   *  the real board shows through on reveal. */
  onIntakeStart?: (text: string) => void;
}

export function MinimalHome({
  displayName,
  email,
  creditBalance,
  spaces,
  syncedTabs,
  driveConnected,
  draftSpaceId,
  onIntakeStart,
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

  // Profile dropdown (avatar → settings / credits / logout).
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!profileOpen) return;
    function onDown(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [profileOpen]);

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
      {/* Whiteboard surface — fades in behind the chatbox once composing.
          Suppressed when a REAL board is mounted underneath (onIntakeStart):
          the host reveals that instead of this faux dot-grid. */}
      <AnimatePresence>
        {composing && !onIntakeStart && (
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
        className="relative mx-auto w-full max-w-[1100px] pb-20 pt-7"
        style={{ zIndex: 2, fontFamily: appleVibe.font.stack }}
      >
        {/* ── Header ── */}
        <header className="flex items-center justify-between py-1.5">
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
              akiboe
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Credit pill */}
            <button
              type="button"
              onClick={() => router.push("/app/credits")}
              title="Credits & billing"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold tabular-nums transition-colors hover:brightness-[0.98]"
              style={{
                background: appleVibe.surface.card,
                border: `1px solid ${appleVibe.stroke.soft}`,
                color: appleVibe.text.secondary,
                boxShadow: appleVibe.shadow.chip,
              }}
            >
              <Coins
                style={{ width: 14, height: 14, color: appleVibe.accent.primary }}
                strokeWidth={2.2}
              />
              {creditBalance.toLocaleString()}
            </button>

            {/* Profile chip → dropdown (settings / credits / logout) */}
            <div ref={profileRef} className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors"
                style={{
                  background: profileOpen ? appleVibe.surface.chip : "transparent",
                }}
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                  style={{ background: appleVibe.stage.features }}
                >
                  {initial}
                </div>
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: appleVibe.text.primary }}
                >
                  {displayName}
                </span>
              </button>

              {profileOpen && (
                <div
                  className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-2xl"
                  style={{
                    background: appleVibe.surface.card,
                    border: `1px solid ${appleVibe.stroke.soft}`,
                    boxShadow:
                      "0 18px 44px -18px rgba(11,18,40,0.30), 0 2px 8px -2px rgba(11,18,40,0.12)",
                  }}
                >
                  {/* identity */}
                  <div
                    className="flex items-center gap-2.5 px-3.5 py-3"
                    style={{ borderBottom: `1px solid ${appleVibe.stroke.soft}` }}
                  >
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                      style={{ background: appleVibe.stage.features }}
                    >
                      {initial}
                    </div>
                    <div className="min-w-0 leading-tight">
                      <div
                        className="truncate text-[13px] font-semibold"
                        style={{ color: appleVibe.text.primary }}
                      >
                        {displayName}
                      </div>
                      {email && (
                        <div
                          className="truncate text-[11px]"
                          style={{ color: appleVibe.text.faint }}
                        >
                          {email}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* actions */}
                  <div className="p-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        router.push("/app/settings");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors hover:bg-black/[0.04]"
                      style={{ color: appleVibe.text.primary }}
                    >
                      <SettingsIcon
                        style={{ width: 15, height: 15, color: appleVibe.text.tertiary }}
                        strokeWidth={2}
                      />
                      Profile settings
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        router.push("/app/credits");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors hover:bg-black/[0.04]"
                      style={{ color: appleVibe.text.primary }}
                    >
                      <Coins
                        style={{ width: 15, height: 15, color: appleVibe.text.tertiary }}
                        strokeWidth={2}
                      />
                      Credits
                      <span
                        className="ml-auto tabular-nums text-[12px] font-semibold"
                        style={{ color: appleVibe.text.tertiary }}
                      >
                        {creditBalance.toLocaleString()}
                      </span>
                    </button>
                  </div>

                  {/* logout */}
                  <div
                    className="p-1.5"
                    style={{ borderTop: `1px solid ${appleVibe.stroke.soft}` }}
                  >
                    <button
                      type="button"
                      onClick={logout}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors hover:bg-black/[0.04]"
                      style={{ color: "#DC2626" }}
                    >
                      <LogOut style={{ width: 15, height: 15 }} strokeWidth={2} />
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ── Greeting + chatbox ── */}
        {/* Fixed top; the greeting stays in flow (height reserved) and only
            fades, so the chatbox never shifts when composing — it just
            expands in place. */}
        <section className="mx-auto mt-16 max-w-[760px]">
          <motion.div
            animate={{ opacity: composing ? 0 : 1 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{ pointerEvents: composing ? "none" : "auto" }}
          >
            <DottedRingMark />
            <h1
              className="text-center text-[34px] font-semibold leading-tight tracking-tight"
              style={{
                color: appleVibe.text.primary,
                fontFamily: appleVibe.font.display,
                letterSpacing: "-0.02em",
              }}
            >
              {greeting},{" "}
              <span style={{ color: "#8B93C4" }}>{displayName}</span>
              <br />
              What are your thoughts today?
            </h1>
          </motion.div>

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
              onIntakeStart={onIntakeStart}
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
