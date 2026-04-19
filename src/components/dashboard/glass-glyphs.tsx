"use client";

/* Custom SVG glyphs matching the InterAxis glass-morphism reference design.
   All glyphs use currentColor so they inherit from parent chip tint. */

import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const IconDashboard = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="5" rx="1.5" />
    <rect x="13" y="10" width="8" height="11" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
  </svg>
);

export const IconTarget = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

export const IconGraph = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5" cy="5" r="2.5" />
    <circle cx="19" cy="5" r="2.5" />
    <circle cx="12" cy="19" r="2.5" />
    <path d="M7 5.5 L17 5.5 M6.5 6.5 L10.5 17 M17.5 6.5 L13.5 17" strokeWidth="1.6" />
  </svg>
);

export const IconCurve = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 18 C7 18 7 6 12 6 S17 18 21 18" />
    <line x1="3" y1="20.5" x2="21" y2="20.5" strokeWidth="1.5" opacity="0.4" />
  </svg>
);

export const IconPulse = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12 H7 L9 7 L13 17 L15 12 H21" />
  </svg>
);

export const IconLayers = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 L21 8 L12 13 L3 8 Z" strokeWidth="1.7" />
    <path d="M3 12 L12 17 L21 12" strokeWidth="1.7" opacity="0.7" />
    <path d="M3 16 L12 21 L21 16" strokeWidth="1.7" opacity="0.4" />
  </svg>
);

export const IconCubes = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z" strokeWidth="1.6" />
    <path d="M4 7.5 L12 12 L20 7.5 M12 12 L12 21" strokeWidth="1.6" />
  </svg>
);

export const IconCompass = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" strokeWidth="1.7" />
    <path d="M9 15 L13 10 L15 9 L14 11 L10 15 Z" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="white" stroke="none" />
  </svg>
);

export const IconRadar = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" strokeWidth="1.4" opacity="0.4" />
    <circle cx="12" cy="12" r="6" strokeWidth="1.4" opacity="0.55" />
    <circle cx="12" cy="12" r="3" strokeWidth="1.4" opacity="0.75" />
    <line x1="12" y1="12" x2="20" y2="7" strokeWidth="2" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconBook = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 4 H11 a3 3 0 0 1 3 3 V21 a2 2 0 0 0 -2 -2 H4 Z" strokeWidth="1.7" />
    <path d="M20 4 H13 a3 3 0 0 0 -3 3 V21 a2 2 0 0 1 2 -2 H20 Z" strokeWidth="1.7" />
  </svg>
);

export const IconConverge = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 5 L11 11 M21 5 L13 11 M3 19 L11 13 M21 19 L13 13" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconFunnel = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 4 H21 L14 13 V20 L10 21 V13 L3 4 Z" strokeWidth="1.7" />
  </svg>
);

export const IconLever = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 16 L20 8" strokeWidth="2" />
    <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    <path d="M10 20 L14 20" strokeWidth="2" />
  </svg>
);

export const IconWarn = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 L22 20 H2 Z" strokeWidth="1.7" />
    <line x1="12" y1="10" x2="12" y2="15" strokeWidth="2" />
    <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconLoop = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12 a8 8 0 1 1 -2.5 -5.7" />
    <path d="M20 3 V7 H16" />
    <path d="M4 12 a8 8 0 0 0 13.5 5.7" opacity="0.55" />
  </svg>
);

export const IconBranches = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6" cy="5" r="2" strokeWidth="1.7" />
    <circle cx="6" cy="19" r="2" strokeWidth="1.7" />
    <circle cx="18" cy="12" r="2" strokeWidth="1.7" />
    <path d="M6 7 V17 M8 5 C14 5 12 12 16 12 M8 19 C14 19 12 12 16 12" strokeWidth="1.6" />
  </svg>
);

export const IconCheckList = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="4" height="4" rx="0.8" strokeWidth="1.7" />
    <rect x="3" y="10" width="4" height="4" rx="0.8" strokeWidth="1.7" />
    <rect x="3" y="16" width="4" height="4" rx="0.8" strokeWidth="1.7" />
    <line x1="10" y1="6" x2="21" y2="6" strokeWidth="1.7" />
    <line x1="10" y1="12" x2="21" y2="12" strokeWidth="1.7" />
    <line x1="10" y1="18" x2="17" y2="18" strokeWidth="1.7" />
  </svg>
);

export const IconSynth = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 4 V11 a6 6 0 0 0 12 0 V4" strokeWidth="1.7" />
    <path d="M12 15 V20 M9 20 H15" strokeWidth="1.7" />
    <path d="M4 4 H8 M16 4 H20" />
  </svg>
);

export const IconBars = (p: P) => (
  <svg {...base({ ...p, fill: "currentColor", stroke: "none" })}>
    <rect x="3" y="12" width="4" height="9" rx="1" opacity="0.6" />
    <rect x="10" y="7" width="4" height="14" rx="1" />
    <rect x="17" y="14" width="4" height="7" rx="1" opacity="0.4" />
  </svg>
);

export const IconBolt = (p: P) => (
  <svg {...base({ ...p, fill: "currentColor", stroke: "none" })}>
    <path d="M13 2 L4 14 H11 L10 22 L20 10 H13 L13 2 Z" />
  </svg>
);

export const IconDb = (p: P) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="5" rx="8" ry="2.5" strokeWidth="1.7" />
    <path d="M4 5 V12 a8 2.5 0 0 0 16 0 V5 M4 12 V19 a8 2.5 0 0 0 16 0 V12" strokeWidth="1.7" />
  </svg>
);

export const IconHistory = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 a9 9 0 1 1 -8.4 12.3" />
    <path d="M3 8 V3 H8" />
    <path d="M12 7 V12 L15 14" />
  </svg>
);

export const IconSparkles = (p: P) => (
  <svg {...base({ ...p, fill: "currentColor", stroke: "none" })}>
    <path d="M12 3 L13 9 L19 10 L13 11 L12 17 L11 11 L5 10 L11 9 Z" />
    <path d="M19 15 L19.8 18 L22.5 19 L19.8 20 L19 23 L18.2 20 L15.5 19 L18.2 18 Z" opacity="0.6" />
  </svg>
);

export const IconExpand = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 10 V4 H10 M14 4 H20 V10 M20 14 V20 H14 M10 20 H4 V14" />
  </svg>
);

export const IconArrowRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12 H19 M13 6 L19 12 L13 18" strokeWidth="2" />
  </svg>
);

export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" strokeWidth="1.7" />
    <path d="M12 7 V12 L15 14" />
  </svg>
);

export const IconGauge = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 14 a8 8 0 0 1 16 0" strokeWidth="1.8" />
    <path d="M12 14 L16 9" strokeWidth="2" />
    <circle cx="12" cy="14" r="1.5" fill="currentColor" stroke="none" />
    <path d="M3 20 H21" strokeWidth="1.4" opacity="0.45" />
  </svg>
);
