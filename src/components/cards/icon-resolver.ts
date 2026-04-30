// ── Icon resolver ───────────────────────────────────────────────────
//
// CardSpec.header.icon is a string slug (e.g., "moon", "coffee") rather
// than a React component, so the spec can be persisted as JSON. This
// module resolves a slug to the actual lucide component at render time.
//
// Adding a new icon = (1) import it here, (2) add a key to the map.
// Unknown slugs fall back to `Activity` so the renderer never throws —
// the agent picking a never-before-seen slug shouldn't blank the card.

import {
  Activity,
  Brain,
  Coffee,
  Droplets,
  FlaskConical,
  Gamepad2,
  Heart,
  LayoutDashboard,
  LineChart,
  type LucideIcon,
  Moon,
  Pill,
  Plug,
  Smile,
  Stethoscope,
  Users,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  activity: Activity,
  brain: Brain,
  coffee: Coffee,
  dashboard: LayoutDashboard,
  droplets: Droplets,
  flask: FlaskConical,
  game: Gamepad2,
  heart: Heart,
  integration: Plug,
  "line-chart": LineChart,
  monitor: LineChart,
  moon: Moon,
  pill: Pill,
  smile: Smile,
  stethoscope: Stethoscope,
  tool: Wrench,
  users: Users,
  workflow: Workflow,
  zap: Zap,
};

export function resolveIcon(slug: string): LucideIcon {
  return ICON_MAP[slug.toLowerCase()] ?? Activity;
}
