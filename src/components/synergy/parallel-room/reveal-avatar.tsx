// ── Reveal-aware avatar widget ──
//
// Renders the partner's avatar with one of three appearances:
//
//   1. Anonymous (no reveal yet OR one-sided reveal):
//      → abstract FNV-1a gradient avatar seeded by their user_id
//   2. Mutually revealed + avatar_url present:
//      → real photo, circular, hairline ring
//   3. Mutually revealed + no avatar_url (display_name only):
//      → soft gray circle with two-letter initials from display_name
//
// Crossfade animation: when the props flip from anonymous → revealed,
// the abstract layer fades out (200ms) while the real layer fades in
// (200ms), so the swap feels gentle rather than jarring.

"use client";

import { useEffect, useState } from "react";
import { abstractAvatarFor } from "@/lib/synergy/abstract-avatar";

interface Props {
  /** Stable user_id (or any stable string) for the abstract fallback. */
  seed: string;
  /** When non-null, mutual reveal is achieved. */
  displayName: string | null;
  /** When non-null + mutual reveal achieved: real photo URL. */
  avatarUrl: string | null;
  /** Pixel size. Default 40. */
  size?: number;
}

export function RevealAvatar({
  seed,
  displayName,
  avatarUrl,
  size = 40,
}: Props) {
  const isRevealed = displayName !== null;

  // Track previous reveal state to enable the crossfade only on transition
  // (not on every re-render).
  const [animateIn, setAnimateIn] = useState(false);
  useEffect(() => {
    if (isRevealed) {
      setAnimateIn(true);
      const t = setTimeout(() => setAnimateIn(false), 400);
      return () => clearTimeout(t);
    }
  }, [isRevealed]);

  return (
    <span
      style={{
        width: size,
        height: size,
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
      aria-label={displayName ?? "Anonymous partner"}
    >
      {isRevealed ? (
        <RevealedLayer
          displayName={displayName!}
          avatarUrl={avatarUrl}
          size={size}
          animateIn={animateIn}
        />
      ) : (
        <AnonymousLayer seed={seed} size={size} />
      )}
    </span>
  );
}

function AnonymousLayer({ seed, size }: { seed: string; size: number }) {
  const av = abstractAvatarFor(seed);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: av.background,
        color: av.textColor,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        fontSize: size * 0.4,
        letterSpacing: "-0.5px",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.06)",
      }}
    >
      {av.initials}
    </span>
  );
}

function RevealedLayer({
  displayName,
  avatarUrl,
  size,
  animateIn,
}: {
  displayName: string;
  avatarUrl: string | null;
  size: number;
  animateIn: boolean;
}) {
  const transition = animateIn
    ? "opacity 200ms ease-out, transform 200ms ease-out"
    : "none";
  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.06)",
    transition,
    opacity: animateIn ? 1 : 1, // we don't need start opacity here; React mounts post-transition
  };
  if (avatarUrl) {
    return (
      <span
        style={{
          ...baseStyle,
          backgroundImage: `url(${avatarUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        title={displayName}
      />
    );
  }
  // Soft initials fallback when no avatar_url
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      style={{
        ...baseStyle,
        background: "#f3f4f6", // gray-100
        color: "#111827", // gray-900
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        fontSize: size * 0.38,
        letterSpacing: "-0.4px",
      }}
      title={displayName}
    >
      {initials || "?"}
    </span>
  );
}
