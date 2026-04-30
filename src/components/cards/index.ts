// ── Cards barrel ────────────────────────────────────────────────────
//
// Public surface for the archetype-driven card system. Consumers
// (canvas shape, lab panel, dashboard widget) import from here so the
// internal layout (primitives.tsx, archetypes.tsx, card-shell.tsx) can
// be reorganized without ripple.

export { CardSpecRenderer, parseCardSpec, type CardSpecRendererProps } from "./card-spec-renderer";
export { CardShell, type CardMode, type CardSize, type CardShellProps } from "./card-shell";
export {
  BiomarkerTimeCourseCard,
  ClinicalInterventionCard,
  ConsumerHealthCard,
  GameProgressionCard,
  SocialCohortCard,
  WorkflowHabitCard,
} from "./archetypes";
export {
  BarChart7,
  BiomarkerMiniLine,
  CohortAvatars,
  DoseResponseCurve,
  LineChart7,
  OutcomeBars,
  ProgressBar,
  RingGrid7,
  ScoreRangeBar,
  StreakDots,
} from "./primitives";
export { resolveIcon } from "./icon-resolver";
export {
  DAYS_M_S,
  HAIRLINE,
  MONO_FONT,
  POLARITY_COLOR,
  SYSTEM_FONT,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SUBTLE,
  fmtPct,
  polarityFor,
  type Polarity,
} from "./tokens";
