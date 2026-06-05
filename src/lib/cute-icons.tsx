// Cute icons — custom hand-drawn SVG set (NOT a library), shaped after the
// reference vibe: chunky rounded strokes + duotone fills, friendly silhouettes.
// Drop-in for the lucide-react import surface we already use (size, className,
// color, strokeWidth all accepted; strokeWidth ignored — we lock the look).
//
// Each icon is a 24×24 viewBox, 2.2 stroke, round caps & joins, with a soft
// `currentColor` accent at 18% opacity behind the mark to give the duotone
// "card" feel. Pass `size` (number|string) to scale; default 16.
"use client";

import type { ReactElement, SVGProps } from "react";

export interface CuteIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number | string;
  /** Ignored — kept so lucide-style call sites still typecheck. */
  strokeWidth?: number | string;
  /** Ignored — kept for Phosphor-style compatibility. */
  weight?: string;
}

type IconComp = (p: CuteIconProps) => ReactElement;

// shared SVG wrapper
const SVG = ({
  size = 16,
  children,
  strokeWidth: _sw,
  weight: _w,
  ...rest
}: CuteIconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

// soft duotone backdrop (rounded square, 18% currentColor)
const Backdrop = ({ inset = 2, r = 5 }: { inset?: number; r?: number }) => (
  <rect
    x={inset}
    y={inset}
    width={24 - inset * 2}
    height={24 - inset * 2}
    rx={r}
    ry={r}
    fill="currentColor"
    opacity={0.16}
    stroke="none"
  />
);

// ─── tab + nav ────────────────────────────────────────────────────────────

// Objects → stacked rounded cubes (chunky stack mark)
export const Boxes: IconComp = (p) => (
  <SVG {...p}>
    <rect x={3} y={9.5} width={11} height={11} rx={2.5} fill="currentColor" opacity={0.18} stroke="none" />
    <rect x={3} y={9.5} width={11} height={11} rx={2.5} />
    <rect x={10} y={3} width={11} height={11} rx={2.5} fill="currentColor" opacity={0.32} stroke="none" />
    <rect x={10} y={3} width={11} height={11} rx={2.5} />
  </SVG>
);

// Artifacts → sparkle (4-point star + small accent)
export const Sparkles: IconComp = (p) => (
  <SVG {...p}>
    <path
      d="M12 3.5c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4Z"
      fill="currentColor"
      opacity={0.22}
    />
    <path d="M12 3.5c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4Z" />
    <path d="M18.5 14c.25 1.6.9 2.2 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.3 2.25-.9 2.5-2.5Z" fill="currentColor" />
  </SVG>
);

// Glossary → open book with bookmark ribbon
export const BookOpen: IconComp = (p) => (
  <SVG {...p}>
    <path d="M3 5.5c2.5-1 5.2-1 8 .5v13c-2.8-1.5-5.5-1.5-8-.5v-13Z" fill="currentColor" opacity={0.18} />
    <path d="M21 5.5c-2.5-1-5.2-1-8 .5v13c2.8-1.5 5.5-1.5 8-.5v-13Z" fill="currentColor" opacity={0.18} />
    <path d="M3 5.5c2.5-1 5.2-1 8 .5v13c-2.8-1.5-5.5-1.5-8-.5v-13Z" />
    <path d="M21 5.5c-2.5-1-5.2-1-8 .5v13c2.8-1.5 5.5-1.5 8-.5v-13Z" />
    <path d="M16.5 3.5v6l1.5-1 1.5 1v-6" stroke="currentColor" fill="currentColor" opacity={0.9} />
  </SVG>
);

// Library rail header → book bookmark stack
export const Library: IconComp = (p) => (
  <SVG {...p}>
    <rect x={3.5} y={3} width={4.5} height={18} rx={1.5} fill="currentColor" opacity={0.2} />
    <rect x={3.5} y={3} width={4.5} height={18} rx={1.5} />
    <rect x={9.5} y={3} width={4.5} height={18} rx={1.5} fill="currentColor" opacity={0.32} />
    <rect x={9.5} y={3} width={4.5} height={18} rx={1.5} />
    <path d="m16.5 4 4 .9-3 16.5L13.6 21 16.5 4Z" fill="currentColor" opacity={0.18} />
    <path d="m16.5 4 4 .9-3 16.5L13.6 21 16.5 4Z" />
  </SVG>
);

// ─── axes (folder / layer / type / room) ─────────────────────────────────

export const Folder: IconComp = (p) => (
  <SVG {...p}>
    <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z" fill="currentColor" opacity={0.22} />
    <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z" />
  </SVG>
);

export const Layers: IconComp = (p) => (
  <SVG {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" fill="currentColor" opacity={0.22} />
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
    <path d="m3 17 9 5 9-5" opacity={0.55} />
  </SVG>
);

export const DoorOpen: IconComp = (p) => (
  <SVG {...p}>
    <path d="M5 21V5l9-2v18l-9 2V21Z" fill="currentColor" opacity={0.2} />
    <path d="M5 21V5l9-2v18l-9 2V21Z" />
    <path d="M14 21h5V8h-5" />
    <circle cx={11.5} cy={12.5} r={1} fill="currentColor" stroke="none" />
  </SVG>
);

// ─── utility / tool buttons ──────────────────────────────────────────────

export const X: IconComp = (p) => (
  <SVG {...p}>
    <Backdrop />
    <path d="m9 9 6 6M15 9l-6 6" />
  </SVG>
);

export const Search: IconComp = (p) => (
  <SVG {...p}>
    <circle cx={10.5} cy={10.5} r={6} fill="currentColor" opacity={0.18} />
    <circle cx={10.5} cy={10.5} r={6} />
    <path d="m15 15 5 5" />
  </SVG>
);

export const Plus: IconComp = (p) => (
  <SVG {...p}>
    <Backdrop />
    <path d="M12 8v8M8 12h8" />
  </SVG>
);

export const Check: IconComp = (p) => (
  <SVG {...p}>
    <Backdrop />
    <path d="m8 12.5 2.8 2.8L16.5 9.5" />
  </SVG>
);

export const Maximize2: IconComp = (p) => (
  <SVG {...p}>
    <Backdrop />
    <path d="M9.5 9.5 6 6m0 0v3.5M6 6h3.5M14.5 14.5 18 18m0 0v-3.5M18 18h-3.5" />
  </SVG>
);

export const Minimize2: IconComp = (p) => (
  <SVG {...p}>
    <Backdrop />
    <path d="M10 10 6 6m0 0h3.5M6 6v3.5M14 14l4 4m0 0h-3.5M18 18v-3.5" />
  </SVG>
);

// Side-by-side panels — used for "open beside" affordance in the library rail.
export const PanelLeft: IconComp = (p) => (
  <SVG {...p}>
    <rect x={3.5} y={5} width={17} height={14} rx={2.5} />
    <rect x={3.5} y={5} width={6.5} height={14} rx={2.5} fill="currentColor" opacity={0.22} />
    <path d="M10 5v14" />
  </SVG>
);

export const RefreshCw: IconComp = (p) => (
  <SVG {...p}>
    <path d="M20 6v5h-5" />
    <path d="M20 11a8 8 0 1 0-2.5 6" fill="currentColor" opacity={0.18} stroke="currentColor" />
  </SVG>
);

export const Loader2: IconComp = (p) => (
  <SVG {...p}>
    <circle cx={12} cy={12} r={8} stroke="currentColor" opacity={0.22} />
    <path d="M20 12a8 8 0 0 0-8-8" />
  </SVG>
);

// ─── chevrons + arrows ───────────────────────────────────────────────────

export const ChevronDown: IconComp = (p) => (
  <SVG {...p}>
    <path d="m6 9 6 6 6-6" />
  </SVG>
);

export const ChevronRight: IconComp = (p) => (
  <SVG {...p}>
    <path d="m9 6 6 6-6 6" />
  </SVG>
);

export const ArrowRight: IconComp = (p) => (
  <SVG {...p}>
    <Backdrop />
    <path d="M7.5 12h9m0 0-3-3m3 3-3 3" />
  </SVG>
);

export const ArrowLeft: IconComp = (p) => (
  <SVG {...p}>
    <Backdrop />
    <path d="M16.5 12h-9m0 0 3-3m-3 3 3 3" />
  </SVG>
);

export const ArrowUpRight: IconComp = (p) => (
  <SVG {...p}>
    <Backdrop />
    <path d="M9 15 15 9m0 0h-4m4 0v4" />
  </SVG>
);

// ─── content marks ───────────────────────────────────────────────────────

export const NotebookPen: IconComp = (p) => (
  <SVG {...p}>
    <rect x={4} y={3.5} width={13} height={17} rx={2.5} fill="currentColor" opacity={0.2} />
    <rect x={4} y={3.5} width={13} height={17} rx={2.5} />
    <path d="M4 8.5h2M4 12.5h2M4 16.5h2" />
    <path d="m15.5 14 4-4 2.5 2.5-4 4-2.5-2.5Zm0 0-1 3 3-1" fill="currentColor" />
  </SVG>
);

export const ImageIcon: IconComp = (p) => (
  <SVG {...p}>
    <rect x={3} y={4} width={18} height={16} rx={3} fill="currentColor" opacity={0.18} />
    <rect x={3} y={4} width={18} height={16} rx={3} />
    <circle cx={9} cy={10} r={1.6} fill="currentColor" stroke="none" />
    <path d="m4 18 5-5 4 4 3-3 4 4" />
  </SVG>
);

export const Megaphone: IconComp = (p) => (
  <SVG {...p}>
    <path d="M4 10.5v3a2.5 2.5 0 0 0 2.5 2.5H8l6 4V4l-6 4H6.5A2.5 2.5 0 0 0 4 10.5Z" fill="currentColor" opacity={0.22} />
    <path d="M4 10.5v3a2.5 2.5 0 0 0 2.5 2.5H8l6 4V4l-6 4H6.5A2.5 2.5 0 0 0 4 10.5Z" />
    <path d="M18 9v6" />
  </SVG>
);

// Wand → playful star-tipped magic wand
export const Wand2: IconComp = (p) => (
  <SVG {...p}>
    <path d="M4.5 19.5 14 10l2 2-9.5 9.5-2-2Z" fill="currentColor" opacity={0.22} />
    <path d="M4.5 19.5 14 10l2 2-9.5 9.5-2-2Z" />
    <path d="M17 3c.3 1.6.9 2.2 2.5 2.5C17.9 5.8 17.3 6.4 17 8c-.3-1.6-.9-2.2-2.5-2.5C16.1 5.2 16.7 4.6 17 3Z" fill="currentColor" />
    <path d="M20.5 9c.2 1 .55 1.3 1.5 1.5-.95.2-1.3.5-1.5 1.5-.2-1-.55-1.3-1.5-1.5.95-.2 1.3-.5 1.5-1.5Z" fill="currentColor" />
  </SVG>
);

// ─── tags / detail ───────────────────────────────────────────────────────

export const MapPin: IconComp = (p) => (
  <SVG {...p}>
    <path d="M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12Z" fill="currentColor" opacity={0.2} />
    <path d="M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12Z" />
    <circle cx={12} cy={9} r={2.5} fill="currentColor" />
  </SVG>
);

export const Target: IconComp = (p) => (
  <SVG {...p}>
    <circle cx={12} cy={12} r={9} fill="currentColor" opacity={0.16} />
    <circle cx={12} cy={12} r={9} />
    <circle cx={12} cy={12} r={5} />
    <circle cx={12} cy={12} r={1.6} fill="currentColor" stroke="none" />
  </SVG>
);

export const Star: IconComp = (p) => (
  <SVG {...p}>
    <path d="m12 3.5 2.7 5.6 6.1.8-4.5 4.3 1.2 6.1L12 17.3l-5.5 3 1.2-6.1L3.2 9.9l6.1-.8L12 3.5Z" fill="currentColor" opacity={0.85} stroke="currentColor" />
  </SVG>
);

// ─── editor controls ────────────────────────────────────────────────────

export const Pencil: IconComp = (p) => (
  <SVG {...p}>
    <path d="m4 20 4-1L20 7l-3-3L5 16l-1 4Z" fill="currentColor" opacity={0.22} />
    <path d="m4 20 4-1L20 7l-3-3L5 16l-1 4Z" />
    <path d="m14 6 3 3" />
  </SVG>
);

export const Pin: IconComp = (p) => (
  <SVG {...p}>
    <path d="M9 3h6l-1 5 3 3-3 3h-2v6l-2-2v-4H8l-3-3 3-3-1-5Z" fill="currentColor" opacity={0.22} />
    <path d="M9 3h6l-1 5 3 3-3 3h-2v6l-2-2v-4H8l-3-3 3-3-1-5Z" />
  </SVG>
);

export const GripVertical: IconComp = (p) => (
  <SVG {...p}>
    <circle cx={9} cy={6} r={1.4} fill="currentColor" stroke="none" />
    <circle cx={9} cy={12} r={1.4} fill="currentColor" stroke="none" />
    <circle cx={9} cy={18} r={1.4} fill="currentColor" stroke="none" />
    <circle cx={15} cy={6} r={1.4} fill="currentColor" stroke="none" />
    <circle cx={15} cy={12} r={1.4} fill="currentColor" stroke="none" />
    <circle cx={15} cy={18} r={1.4} fill="currentColor" stroke="none" />
  </SVG>
);

// folder + (new folder)
export const FolderPlus: IconComp = (p) => (
  <SVG {...p}>
    <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z" fill="currentColor" opacity={0.22} />
    <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z" />
    <path d="M12 11v5M9.5 13.5h5" />
  </SVG>
);

// History → clock with curved arrow
export const History: IconComp = (p) => (
  <SVG {...p}>
    <circle cx={12} cy={12} r={8} fill="currentColor" opacity={0.18} />
    <circle cx={12} cy={12} r={8} />
    <path d="M12 7.5V12l3 2" />
    <path d="M4.5 8.5 6 6.5" />
  </SVG>
);

export type LucideIcon = IconComp;
