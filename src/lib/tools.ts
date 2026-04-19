import {
  MessageCircle,
  MessageSquarePlus,
  Sparkles,
  Zap,
  Search,
  Compass,
  Layers,
  type LucideIcon,
} from "lucide-react";

export type ToolId =
  | "chat"
  | "comment"
  | "reevaluate"
  | "refresh_strategy"
  | "quick_check"
  | "quick_decompose"
  | "research";

export interface ToolDef {
  id: ToolId;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Keyboard shortcut letter shown on the pill */
  kbd: string;
  actionLabel: string;
  /** Position in the fan: angle in degrees. 90 = straight up, sweeps 0-180 counterclockwise (right → up → left) */
  angle: number;
  /** Only available when the user is on a space page */
  requiresSpace: boolean;
}

/**
 * Sphere sits in the bottom-right corner. Tools fan UP-and-LEFT in a clean arc.
 * Standard math angles: 90° = straight up, 180° = straight left.
 * Space: 90° to 180° spread evenly = 15° between each of 7 tools.
 * Ordered so most-used tools sit nearest the sphere (top area).
 */
export const TOOLS: ToolDef[] = [
  {
    id: "chat",
    label: "AI Chat",
    icon: MessageCircle,
    description: "Chat with the graph — ask, explore, drill in.",
    kbd: "C",
    actionLabel: "Open Chat",
    angle: 90, // straight up from sphere
    requiresSpace: false,
  },
  {
    id: "comment",
    label: "Comment",
    icon: MessageSquarePlus,
    description: "Annotate insights & ask the AI to reason.",
    kbd: "M",
    actionLabel: "Open Comments",
    angle: 105,
    requiresSpace: false,
  },
  {
    id: "reevaluate",
    label: "Re-evaluate",
    icon: Sparkles,
    description: "Deep-pass resynthesis of the full dashboard.",
    kbd: "R",
    actionLabel: "Run Deep Pass",
    angle: 120,
    requiresSpace: true,
  },
  {
    id: "refresh_strategy",
    label: "Refresh Strategy",
    icon: Zap,
    description: "Regenerate the #1 Recommendation.",
    kbd: "S",
    actionLabel: "Regenerate",
    angle: 135,
    requiresSpace: true,
  },
  {
    id: "quick_check",
    label: "Quick Check",
    icon: Search,
    description: "Fast re-check for missing edges & cycles.",
    kbd: "Q",
    actionLabel: "Run Quick Check",
    angle: 150,
    requiresSpace: true,
  },
  {
    id: "quick_decompose",
    label: "Quick Decompose",
    icon: Layers,
    description: "Break 2-3 abstract entities into sub-components.",
    kbd: "X",
    actionLabel: "Run Quick Decompose",
    angle: 165,
    requiresSpace: true,
  },
  {
    id: "research",
    label: "Deep Research",
    icon: Compass,
    description: "Pull external knowledge into the graph.",
    kbd: "D",
    actionLabel: "Start Research",
    angle: 180, // straight left from sphere
    requiresSpace: true,
  },
];

/** Radius of the fan arc, from sphere center, in px */
export const ORBIT_RADIUS = 155;

/** Sphere diameter in px */
export const SPHERE_SIZE = 56;
