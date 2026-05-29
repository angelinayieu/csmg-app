// ── Objective core orb ──
//
// Identity glyph for the Core Objective. A single luminous glass
// sphere — the one fixed thing the whole canvas orbits. Minimal (one
// shape) but dimensional: a radial depth gradient shades it like a lit
// sphere, a soft specular highlight sits upper-left, and a faint rim
// light catches the lower-right edge for that visionOS glass feel.
// Pairs with the Autopilot "orbit" glyph — still center vs. motion
// around it.
//
// Self-contained: gradient ids are scoped with a useId() suffix so the
// glyph can render many times without id collisions. Colors are the
// objective-violet family; `className`/`style` size it (any inherited
// text `color` is intentionally ignored — this is fixed identity
// chrome that carries its own light).

import * as React from "react";

type ObjectiveCoreProps = React.SVGProps<SVGSVGElement>;

export function ObjectiveCore({ className, ...rest }: ObjectiveCoreProps) {
  const uid = React.useId().replace(/:/g, "");
  const body = `oc-body-${uid}`;
  const spec = `oc-spec-${uid}`;
  const rim = `oc-rim-${uid}`;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <defs>
        {/* Body — lit from upper-left, deepening to the far lower edge. */}
        <radialGradient id={body} cx="38%" cy="32%" r="80%">
          <stop offset="0%" stopColor="#CDBBFF" />
          <stop offset="44%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#5B21B6" />
        </radialGradient>
        {/* Rim light — bright only along the lower-right edge. */}
        <linearGradient id={rim} x1="28%" y1="16%" x2="76%" y2="94%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="68%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#EDE3FF" stopOpacity="0.9" />
        </linearGradient>
        {/* Specular highlight — soft glossy spot upper-left. */}
        <radialGradient id={spec} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Sphere body */}
      <circle cx="12" cy="12" r="9.4" fill={`url(#${body})`} />
      {/* Rim light hugging the lower-right edge */}
      <circle
        cx="12"
        cy="12"
        r="9.4"
        fill="none"
        stroke={`url(#${rim})`}
        strokeWidth="1.1"
      />
      {/* Glossy specular highlight */}
      <ellipse
        cx="9.1"
        cy="8.4"
        rx="3.2"
        ry="2.2"
        fill={`url(#${spec})`}
        transform="rotate(-28 9.1 8.4)"
      />
    </svg>
  );
}
