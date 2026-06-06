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
import Link from "next/link";
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

// ── Sun greeting mark ──
// A tiny sun glyph (echoing the akiboe brand mark) with a soft warm glow
// and faint ripples that emerge from the center and dissolve outward. No
// spinning — every motion is deliberately minuscule, so it reads as a
// quiet living warmth above the greeting rather than a loader.
const SUN_INK = "#1b1a18";
const SUN_ACCENT = "#c2593b";
function SunGreetingMark() {
  const size = 42;
  const center = size / 2;
  // 8 rays around the core, plus one warm accent ray (lower-right).
  const rays = Array.from({ length: 8 }).map((_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return {
      x1: center + 8 * Math.cos(a),
      y1: center + 8 * Math.sin(a),
      x2: center + 12.5 * Math.cos(a),
      y2: center + 12.5 * Math.sin(a),
    };
  });
  return (
    <div
      aria-hidden
      className="relative mx-auto mb-5"
      style={{ width: size, height: size }}
    >
      {/* soft warm glow — breathes ever so slightly */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, ${SUN_ACCENT}33 0%, transparent 68%)`,
        }}
        animate={{ opacity: [0.55, 0.85, 0.55], scale: [1, 1.06, 1] }}
        transition={{ duration: 4.5, ease: "easeInOut", repeat: Infinity }}
      />
      {/* ripples emerging from the center, dissolving outward (staggered) */}
      {[0, 2.2].map((delay) => (
        <motion.div
          key={delay}
          className="absolute rounded-full"
          style={{
            left: "50%",
            top: "50%",
            width: 14,
            height: 14,
            marginLeft: -7,
            marginTop: -7,
            border: `1px solid ${SUN_ACCENT}`,
          }}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: [0.5, 1.5], opacity: [0, 0.28, 0] }}
          transition={{
            duration: 4.4,
            ease: "easeOut",
            repeat: Infinity,
            delay,
          }}
        />
      ))}
      {/* the sun glyph itself */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="relative"
        style={{ display: "block" }}
      >
        <g stroke={SUN_INK} strokeWidth={2.4} strokeLinecap="round">
          {rays.slice(0, 7).map((r, i) => (
            <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />
          ))}
        </g>
        {/* the warm accent ray */}
        <line
          x1={rays[7].x1}
          y1={rays[7].y1}
          x2={rays[7].x2}
          y2={rays[7].y2}
          stroke={SUN_ACCENT}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
        {/* core — gently breathing */}
        <motion.circle
          cx={center}
          cy={center}
          r={4.4}
          fill={SUN_INK}
          style={{ transformOrigin: "center", transformBox: "fill-box" }}
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 4.5, ease: "easeInOut", repeat: Infinity }}
        />
      </svg>
    </div>
  );
}

// The greeting question rotates between a couple of gentle prompts.
const GREETING_PROMPTS = [
  "What are your thoughts today?",
  "What are you building?",
];

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

  // Rotating greeting prompt — cross-fades between a couple of gentle
  // questions every few seconds.
  const [promptIdx, setPromptIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setPromptIdx((i) => (i + 1) % GREETING_PROMPTS.length),
      6500,
    );
    return () => clearInterval(id);
  }, []);

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

  // Avatar (set on /app/profile) — fetched client-side so the chip shows
  // the user's photo when present; falls back to the initial chip.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch("/api/me/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.avatarUrl) setAvatarUrl(d.avatarUrl as string);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
        {/* Frosted floating bar: a contained, blurred pill (hairline + soft
            shadow) centered and constrained so the logo + actions read as a
            deliberate nav instead of two lonely items pinned to the edges.
            Sticky so it floats as the library scrolls under it. */}
        <header
          className="sticky top-3 z-20 mx-auto flex max-w-[1100px] items-center justify-between gap-3 rounded-full py-2 pl-3 pr-2.5"
          style={{
            background: "rgba(255,255,255,0.72)",
            backdropFilter: "saturate(180%) blur(20px)",
            WebkitBackdropFilter: "saturate(180%) blur(20px)",
            border: `1px solid ${appleVibe.stroke.soft}`,
            boxShadow: appleVibe.shadow.chip,
          }}
        >
          <div className="flex items-center gap-2.5">
            <InterAxisLogo
              className="h-8 w-8"
              size={32}
              style={{ borderRadius: 10 }}
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
                  className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-[13px] font-semibold text-white"
                  style={{ background: appleVibe.stage.features }}
                >
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initial
                  )}
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
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-[13px] font-semibold text-white"
                      style={{ background: appleVibe.stage.features }}
                    >
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initial
                      )}
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

                  {/* actions — Next <Link> so the click is a real
                      anchor nav; the onClick still closes the popover.
                      router.push was no-op'ing on some sessions when
                      paired with the immediate setState close. */}
                  <div className="p-1.5">
                    <Link
                      href="/app/profile"
                      prefetch
                      onClick={() => setProfileOpen(false)}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors hover:bg-black/[0.04]"
                      style={{ color: appleVibe.text.primary }}
                    >
                      <SettingsIcon
                        style={{ width: 15, height: 15, color: appleVibe.text.tertiary }}
                        strokeWidth={2}
                      />
                      Profile settings
                    </Link>
                    <Link
                      href="/app/credits"
                      prefetch
                      onClick={() => setProfileOpen(false)}
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
                    </Link>
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
            <SunGreetingMark />
            <h1
              className="text-center text-[31px] font-medium leading-tight tracking-tight"
              style={{
                color: appleVibe.text.primary,
                fontFamily: appleVibe.font.display,
                letterSpacing: "-0.02em",
              }}
            >
              <span className="font-bold">
                {greeting},{" "}
                <span style={{ color: "#8B93C4" }}>{displayName}</span>
              </span>
              <br />
              <span className="relative inline-block">
                {/* reserve width with the longest prompt so layout is stable */}
                <span className="invisible" aria-hidden>
                  {GREETING_PROMPTS.reduce((a, b) =>
                    a.length >= b.length ? a : b,
                  )}
                </span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={promptIdx}
                    className="absolute inset-0 whitespace-nowrap"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {GREETING_PROMPTS[promptIdx]}
                  </motion.span>
                </AnimatePresence>
              </span>
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
