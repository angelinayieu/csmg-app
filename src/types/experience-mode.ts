// ── Dashboard experience modes ──
//
// Four "experience pills" surface on the dashboard hero. They each
// dictate what happens AFTER the user enters a prompt:
//
//   brain_probe       — interactive question + deep-research support
//   brainstorm_speed  — autopilot brainstorm given the user's goal
//   precise_rd        — full multiagent strategy + lab + apps pipeline
//   digital_twin      — focused knowledge-graph curation for prediction
//
// The mode is persisted in the URL (?mode=...) so the destination
// surface can read it and adapt its behavior. Wiring at the
// destination is downstream of this UI; the dashboard's only job is
// to forward the choice + the prompt + (optionally) clarifier
// answers.

export type ExperienceMode =
  | "brain_probe"
  | "brainstorm_speed"
  | "precise_rd"
  | "digital_twin";

export interface ExperienceModeMeta {
  id: ExperienceMode;
  label: string;
  /** One-line tagline shown under the pill in the tooltip header. */
  tagline: string;
  /** Long description shown in the tooltip body. Explains what the
   *  pipeline does in this mode. */
  description: string;
  /** Hex accent for the pill highlight, hover glow, and tooltip
   *  border. Keep these inside the cyan→violet ambient palette so
   *  they don't clash with the background. */
  accent: string;
  /** Secondary accent used in the gradient highlight. */
  accentSoft: string;
  /** Lucide icon name as a string — the component is resolved at
   *  render time so this file stays tree-shake friendly. */
  icon: "Brain" | "FastForward" | "FlaskConical" | "Layers3";
  /** Destination + query params when the user submits with this
   *  mode. The prompt is appended as `seed` or `prompt` depending
   *  on the destination. */
  destination: {
    /** Route path — `?mode=` is always appended; the prompt is
     *  appended as the named field. */
    route: string;
    /** Which query key carries the user's prompt at this route.
     *  `/app/synergy/new` reads `seed`; `/app/strategy/new` reads
     *  `prompt`. */
    promptField: "seed" | "prompt";
  };
}

// All four modes route through the SAME unified launcher
// (/app/whiteboard/new) which calls /api/intake/bootstrap, creates a
// `spaces` row with the mode persisted into reasoning_settings, and
// lands the user on the InteraxisCanvas with mode-aware chrome
// gating. brain_probe + brainstorm_speed pass skipPipeline=true so
// they don't fire the heavy decompose chain; precise_rd +
// digital_twin let the full pipeline run.
//
// `promptField` is preserved for the dashboard hero's URL builder so
// the unified launcher reads either ?prompt or ?seed (legacy callers
// may still hit the old routes during the transition window).

export const EXPERIENCE_MODES: ExperienceModeMeta[] = [
  {
    id: "brain_probe",
    label: "Brain Probe",
    tagline: "Interactive probe with deep-research support",
    description:
      "Consistent question engagement plus AI reasoning. Like brainstorming, but more proactive — the system probes you for what it needs to know, runs research in the background, and surfaces what it found.",
    accent: "#06b6d4",
    accentSoft: "rgba(6, 182, 212, 0.18)",
    icon: "Brain",
    destination: { route: "/app/whiteboard/new", promptField: "prompt" },
  },
  {
    id: "brainstorm_speed",
    label: "Brainstorm Speedrun",
    tagline: "Autopilot brainstorm against your goal",
    description:
      "Hands-off ideation. Given your goal, the system runs rounds of expansion on its own — variations, first-principles re-frames, upstream and downstream chains — and hands back the structured board.",
    accent: "#a855f7",
    accentSoft: "rgba(168, 85, 247, 0.18)",
    icon: "FastForward",
    destination: { route: "/app/whiteboard/new", promptField: "prompt" },
  },
  {
    id: "precise_rd",
    label: "Precise R&D",
    tagline: "Multiagent strategy → lab → app pipeline",
    description:
      "The full operation. Multiagent strategists draft and rank options, the lab runs simulations on the candidates, and the highest-scoring strategies materialize into apps. Use this when you have a specific application or outcome in mind.",
    accent: "#6366f1",
    accentSoft: "rgba(99, 102, 241, 0.18)",
    icon: "FlaskConical",
    destination: { route: "/app/whiteboard/new", promptField: "prompt" },
  },
  {
    id: "digital_twin",
    label: "Build Digital Twin",
    tagline: "Causal model of a situation for prediction",
    description:
      "Curates a focused knowledge graph for a set of conditions, situations, or data points and uses causal modeling to predict reality. Less about a specific application — more about modeling the system itself.",
    accent: "#10b981",
    accentSoft: "rgba(16, 185, 129, 0.18)",
    icon: "Layers3",
    destination: { route: "/app/whiteboard/new", promptField: "prompt" },
  },
];

export function isExperienceMode(value: unknown): value is ExperienceMode {
  return (
    value === "brain_probe" ||
    value === "brainstorm_speed" ||
    value === "precise_rd" ||
    value === "digital_twin"
  );
}

export function findExperienceMode(
  id: string | null | undefined,
): ExperienceModeMeta | null {
  if (!id) return null;
  return EXPERIENCE_MODES.find((m) => m.id === id) ?? null;
}
