"use client";

// ── Portal Card ──
//
// A motion-rich action card used on the Objective Canvas landing.
// Generic enough to power both "Create" (active, triggers a state
// transition into the entry form via Framer Motion layoutId) and
// "Explore" (visual-only, no routing — Coming soon).
//
// Motion package: subtle BREATHING (scale loops 1.0 ↔ 1.012 on a
// 4s cadence), CURSOR PARALLAX (inner content shifts ±6px), and
// 4 DRIFTING TWINKLES with per-mount jitter so the picture never
// feels mechanical. All animations honor prefers-reduced-motion.

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export interface PortalCardProps {
  /** Bold display title (e.g. "Create", "Explore"). */
  title: string;
  /** Single-line subtitle under the title. */
  subtitle: string;
  /** The icon shown in the top-left tile. */
  icon: React.ReactNode;
  /** Click handler. Omit to render a non-interactive card. */
  onActivate?: () => void;
  /** When set, the card participates in a Framer Motion shared
   *  layout transition with another mount having the same id. Used
   *  by the Create card to expand into the entry form. */
  layoutId?: string;
  /** "primary" = dark accent icon tile, full motion. "secondary"
   *  = lighter tile, gentler motion, fits a placeholder use. */
  variant?: "primary" | "secondary";
  /** Small badge in the top-right (e.g. "Coming soon"). */
  badge?: string;
  /** Disable cursor + interaction signals (still renders animations). */
  disabled?: boolean;
}

interface TwinkleSpec {
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
}

function generateTwinkles(): TwinkleSpec[] {
  const seeds = [
    { x: 12, y: 24, size: 12 },
    { x: 86, y: 20, size: 9 },
    { x: 20, y: 76, size: 8 },
    { x: 82, y: 70, size: 13 },
  ];
  return seeds.map((s, i) => ({
    x: s.x + (Math.random() * 6 - 3),
    y: s.y + (Math.random() * 6 - 3),
    size: s.size + (Math.random() * 2 - 1),
    delay: i * 0.6 + Math.random() * 0.4,
    duration: 5.5 + Math.random() * 1.6,
    drift: 12 + Math.random() * 10,
  }));
}

export function PortalCard({
  title,
  subtitle,
  icon,
  onActivate,
  layoutId,
  variant = "primary",
  badge,
  disabled = false,
}: PortalCardProps) {
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  const twinkles = useMemo(() => generateTwinkles(), []);
  const interactive = !!onActivate && !disabled;

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduce || opening || !interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    setParallax({
      x: Math.max(-1, Math.min(1, dx)) * 6,
      y: Math.max(-1, Math.min(1, dy)) * 6,
    });
  }

  function onMouseLeave() {
    setHovered(false);
    setParallax({ x: 0, y: 0 });
  }

  function handleClick() {
    if (!interactive || opening) return;
    setOpening(true);
    setTimeout(() => onActivate?.(), 140);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        interactive &&
        (e.key === "Enter" || e.key === " ") &&
        document.activeElement === containerRef.current
      ) {
        e.preventDefault();
        handleClick();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, interactive]);

  // Quiet the breathing on the secondary variant so the primary
  // card visually leads. Both still get parallax + twinkles.
  const breathingAmplitude = variant === "primary" ? 1.012 : 1.006;
  const breathing =
    !reduce && !hovered && !opening
      ? { scale: [1, breathingAmplitude, 1] }
      : { scale: 1 };

  const accentTile =
    variant === "primary"
      ? {
          background: appleVibe.accent.primary,
          color: appleVibe.text.onAccent,
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.18) inset, 0 8px 18px -10px rgba(11,18,40,0.45)",
        }
      : {
          background: "rgba(15,23,42,0.04)",
          color: appleVibe.text.primary,
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.95) inset, 0 4px 14px -8px rgba(11,18,40,0.18)",
          border: `1px solid ${appleVibe.stroke.hairline}`,
        };

  return (
    <motion.div
      ref={containerRef}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-label={interactive ? title : undefined}
      aria-disabled={!interactive ? true : undefined}
      onClick={handleClick}
      onMouseEnter={() => interactive && setHovered(true)}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      onMouseDown={() => interactive && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      layoutId={layoutId}
      animate={breathing}
      transition={{
        scale: hovered || opening
          ? { duration: 0.25, ease: "easeOut" }
          : { duration: 4, ease: "easeInOut", repeat: Infinity },
        layout: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
      }}
      whileTap={interactive && !reduce ? { scale: 0.985 } : undefined}
      className="group relative block h-full w-full overflow-hidden p-7 outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${
          hovered && interactive
            ? "rgba(15,23,42,0.12)"
            : appleVibe.stroke.soft
        }`,
        boxShadow: hovered && interactive
          ? appleVibe.shadow.cardHover
          : appleVibe.shadow.card,
        borderRadius: appleVibe.radius.xl,
        fontFamily: appleVibe.font.stack,
        cursor: interactive ? "pointer" : "default",
        minHeight: 180,
      }}
    >
      {/* Soft radial highlight in the top-left for depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 15% 10%, rgba(255,255,255,0.5), transparent 60%)",
        }}
      />

      {/* Twinkles */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {twinkles.map((t, i) => (
          <motion.div
            key={i}
            className="absolute"
            style={{
              left: `${t.x}%`,
              top: `${t.y}%`,
              width: t.size,
              height: t.size,
              color: "rgba(15,23,42,0.14)",
            }}
            animate={
              reduce
                ? undefined
                : {
                    x: [0, t.drift, -t.drift * 0.6, t.drift * 0.4, 0],
                    y: [0, -t.drift * 0.8, t.drift * 0.6, -t.drift * 0.3, 0],
                    opacity: [0.22, 0.65, 0.4, 0.6, 0.22],
                    rotate: [0, 40, -20, 30, 0],
                  }
            }
            transition={{
              duration: t.duration,
              delay: t.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <Sparkle className="h-full w-full" />
          </motion.div>
        ))}
      </div>

      {/* Top-right badge (Coming soon, etc.) */}
      {badge && (
        <span
          className="absolute right-4 top-4 inline-flex items-center rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em]"
          style={{
            background: "rgba(124,58,237,0.08)",
            color: "rgba(91,33,182,0.95)",
            border: "1px solid rgba(124,58,237,0.18)",
          }}
        >
          {badge}
        </span>
      )}

      {/* Inner content, parallax-shifted */}
      <motion.div
        animate={{ x: parallax.x, y: parallax.y }}
        transition={{ type: "spring", stiffness: 120, damping: 18, mass: 0.4 }}
        className="relative flex h-full flex-col justify-between"
      >
        <motion.div
          animate={{
            rotate: hovered && interactive ? 6 : 0,
            scale: pressed ? 0.92 : hovered && interactive ? 1.06 : 1,
          }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center"
          style={{
            ...accentTile,
            borderRadius: 14,
          }}
        >
          {icon}
        </motion.div>

        <div className="mt-6">
          <h2
            className="text-[26px] font-semibold leading-none tracking-tight"
            style={{
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.display,
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </h2>
          <p
            className="mt-2 text-[13px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {subtitle}
          </p>
        </div>

        {/* Hover arrow — only for interactive variant */}
        {interactive && (
          <motion.div
            aria-hidden
            animate={{
              x: hovered ? 4 : 0,
              opacity: hovered ? 1 : 0.4,
            }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute bottom-7 right-7"
          >
            <ArrowRight
              className="h-4 w-4"
              strokeWidth={2}
              style={{ color: appleVibe.text.secondary }}
            />
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
