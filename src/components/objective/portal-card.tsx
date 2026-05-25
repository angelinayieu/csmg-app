"use client";

// ── Portal Card ──
//
// Square, centered-content action card used on the Objective Canvas
// landing. Generic — drives both "Create" (active, transitions
// into the entry form via layoutId) and "Explore" (visual-only,
// "Coming soon").
//
// Designed to sit inside a card stack: the parent positions each
// card with a tilt; on hover/open the card eases its rotation
// toward 0 and lifts. On activate (Create), the card straightens
// fully, scales up briefly, then the parent triggers the layoutId
// expand into the entry form.

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export interface PortalCardProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onActivate?: () => void;
  /** Shared layout id for Framer Motion transitions. The Create
   *  card uses "portal-card" so it expands smoothly into the
   *  entry form mounted in the entry stage. */
  layoutId?: string;
  variant?: "primary" | "secondary";
  /** Small badge in the top-right (e.g. "Coming soon"). */
  badge?: string;
  /** Disable interaction (still renders ambient motion). */
  disabled?: boolean;
  /** Resting rotation in degrees. Cards in the landing stack pass
   *  ±5°; the card eases to 0 on hover/open. */
  restRotation?: number;
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
    { x: 14, y: 18, size: 10 },
    { x: 84, y: 22, size: 8 },
    { x: 22, y: 80, size: 8 },
    { x: 82, y: 78, size: 11 },
  ];
  return seeds.map((s, i) => ({
    x: s.x + (Math.random() * 6 - 3),
    y: s.y + (Math.random() * 6 - 3),
    size: s.size + (Math.random() * 2 - 1),
    delay: i * 0.55 + Math.random() * 0.4,
    duration: 5.5 + Math.random() * 1.6,
    drift: 10 + Math.random() * 8,
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
  restRotation = 0,
}: PortalCardProps) {
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [opening, setOpening] = useState(false);

  const twinkles = useMemo(() => generateTwinkles(), []);
  const interactive = !!onActivate && !disabled;

  function handleClick() {
    if (!interactive || opening) return;
    setOpening(true);
    // Hold so the straighten + scale animation reads before we
    // trigger the parent's layoutId expansion.
    setTimeout(() => onActivate?.(), 280);
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

  // ── Motion targets ──
  // Resting:  rotation = restRotation, scale = 1
  // Hovered:  rotation = restRotation × 0.35, scale = 1.03, y = -6
  // Opening:  rotation = 0, scale = 1.05, y = -10
  // Reduced motion: snap to resting.
  const motionTarget = (() => {
    if (reduce) return { rotate: restRotation, scale: 1, y: 0 };
    if (opening) return { rotate: 0, scale: 1.05, y: -10 };
    if (hovered && interactive)
      return { rotate: restRotation * 0.35, scale: 1.03, y: -6 };
    return { rotate: restRotation, scale: 1, y: 0 };
  })();

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
      onMouseLeave={() => setHovered(false)}
      onMouseDown={() => interactive && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      layoutId={layoutId}
      initial={false}
      animate={motionTarget}
      transition={{
        rotate: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
        scale: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
        y: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
        layout: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
      }}
      whileTap={interactive && !reduce && !opening ? { scale: 0.98 } : undefined}
      className="group relative block overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${
          hovered && interactive
            ? "rgba(15,23,42,0.14)"
            : appleVibe.stroke.soft
        }`,
        boxShadow:
          hovered && interactive
            ? "0 1px 0 rgba(255,255,255,0.95) inset, 0 24px 50px -20px rgba(11,18,40,0.30)"
            : "0 1px 0 rgba(255,255,255,0.95) inset, 0 14px 36px -18px rgba(11,18,40,0.22)",
        borderRadius: 28,
        fontFamily: appleVibe.font.stack,
        cursor: interactive ? "pointer" : "default",
        width: 280,
        height: 280,
        // Center the rotation pivot so the tilt looks natural.
        transformOrigin: "50% 50%",
      }}
    >
      {/* Soft radial highlight (top-left) for depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 20% 12%, rgba(255,255,255,0.55), transparent 60%)",
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

      {/* Centered content — icon top-center, title + subtitle below */}
      <div className="relative flex h-full w-full flex-col items-center justify-center px-7 text-center">
        <motion.div
          animate={{
            scale: pressed ? 0.92 : hovered && interactive ? 1.06 : 1,
            rotate: hovered && interactive ? 6 : 0,
          }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="flex h-[56px] w-[56px] flex-shrink-0 items-center justify-center"
          style={{
            ...accentTile,
            borderRadius: 18,
          }}
        >
          {icon}
        </motion.div>

        <h2
          className="mt-6 text-[24px] font-semibold leading-none tracking-tight"
          style={{
            color: appleVibe.text.primary,
            fontFamily: appleVibe.font.display,
            letterSpacing: "-0.022em",
          }}
        >
          {title}
        </h2>
        <p
          className="mt-2 line-clamp-2 max-w-[200px] text-[12.5px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {subtitle}
        </p>
      </div>
    </motion.div>
  );
}
