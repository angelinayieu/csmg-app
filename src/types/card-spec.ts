// ── Card spec — archetype-driven app card rendering ───────────────────
//
// Apps render on the canvas (proposal stage) and on /app/[id] (active
// stage) using a generated `card_spec`. The spec is produced at T7 by
// the CardGenerator agent and persists on the App row. The renderer
// reads the spec's discriminator and dispatches to the matching
// archetype renderer — no rendering logic lives on the agent side, no
// generation logic lives on the renderer side.
//
// Adding a new archetype = (1) extend `CardArchetype`, (2) declare the
// slot shape, (3) write the React renderer, (4) teach the agent when
// to pick it. No existing archetypes need to change.

import type { AppType } from "./app";

// ── Archetype enum ─────────────────────────────────────────────────────

export type CardArchetype =
  | "consumer-health"
  | "clinical-intervention"
  | "workflow-habit"
  | "game-progression"
  | "biomarker-time-course"
  | "social-cohort";

// ── Common header ──────────────────────────────────────────────────────
//
// Every archetype shares an icon + name + status badge. The discriminated
// payload below carries archetype-specific slots.

export interface CardHeader {
  /** Icon slug — resolved by the renderer to a lucide icon component. */
  icon: string;
  /** Color tokens for the icon badge (foreground + background). */
  iconFg: string;
  iconBg: string;
  /** Display name. */
  name: string;
  /** "Forecast" during proposal/preview, "Today" once data is live. */
  badge: "Forecast" | "Today";
}

// ── Per-archetype slot shapes ──────────────────────────────────────────

/**
 * Consumer-health archetype — single headline metric + a small recurring
 * visualization. Apple-Health-style.
 */
export interface ConsumerHealthSlots {
  metric: string;             // "6.5"
  unit?: string;              // "hr"
  status: string;             // "Restful nights expected"
  viz:
    | { kind: "ring-grid"; hits: boolean[]; color: string }
    | { kind: "bar-chart"; values: number[]; color: string; faintColor: string }
    | { kind: "line-chart"; values: number[]; color: string };
}

/**
 * Clinical-intervention archetype — dose-response curve + multiple
 * outcome bars + onset/plateau footer. Matches the cognition template.
 */
export interface ClinicalInterventionSlots {
  /** Subtitle line: dosage + class (e.g., "150 min/wk · Anti-inflammatory"). */
  subtitle: string;
  /** Where on the dose-response curve the recommended dose sits (0..1). */
  dosePct: number;
  /** 1..5 outcome rows. Each pct is 0..100. */
  outcomes: Array<{ label: string; pct: number }>;
  /** Footer copy: "Onset 2w · Plateau 20w". */
  onsetCopy: string;
  /** Single accent color for curve + bars + chip. */
  accent: string;
}

/**
 * Workflow-habit archetype — cadence-driven completion tracking. Streak
 * dots + counted-of-target metric.
 */
export interface WorkflowHabitSlots {
  /** Headline metric: e.g., "6". */
  count: string;
  /** Suffix: e.g., "of 7". */
  outOf?: string;
  /** Cadence + reminder: "Daily · 3 min · 8 AM". */
  cadenceCopy: string;
  /** Per-day completion booleans, length matches the cadence period. */
  streak: boolean[];
  color: string;
}

/**
 * Game-progression archetype — level + progress bar + score range.
 */
export interface GameProgressionSlots {
  /** Current label: "L4". */
  currentLevel: string;
  /** Next-level label: "L5". */
  nextLevel: string;
  /** 0..1 progress toward next level. */
  progress: number;
  /** Cadence subtitle: "3×/wk · Working memory". */
  cadenceCopy: string;
  /** Score range tuple [min, max]. */
  scoreRange: [number, number];
  /** Best score so far (within range). */
  best: number;
  color: string;
}

/**
 * Biomarker-time-course archetype — multiple stacked mini-trajectories.
 * Best for clinical interventions where the scientific story is a set
 * of biomarkers each moving on its own time-course (e.g., IL-6 ↓,
 * cortisol ↓, BDNF ↑ over 12 weeks). Richer than clinical-intervention
 * when the simulator returns time-series instead of point estimates.
 */
export interface BiomarkerTimeCourseSlots {
  /** Subtitle line: protocol summary. */
  subtitle: string;
  /** 2..4 biomarker rows. `values` is a normalized 0..1 trajectory.
   *  `current` and `target` are pre-formatted display strings. */
  biomarkers: Array<{
    label: string;
    values: number[];
    color: string;
    current: string;
    target: string;
  }>;
  /** Footer: time horizon copy. */
  horizon: string;
}

/**
 * Social-cohort archetype — group/peer interventions where adherence and
 * cohort dynamics matter. Shows attending-of-cohort, dropout indicator,
 * and a small avatar cluster.
 */
export interface SocialCohortSlots {
  /** Subtitle line: program name + duration (e.g., "8-wk MBSR · group of 15"). */
  subtitle: string;
  cohortSize: number;
  attending: number;
  /** Short status: "low dropout risk", "early cohort", "established". */
  status: string;
  /** Avatar colors (max 5 rendered + "+N" overflow chip). */
  avatarColors: string[];
  color: string;
}

// ── Discriminated union ────────────────────────────────────────────────

export type CardSpec =
  | { archetype: "consumer-health"; header: CardHeader; slots: ConsumerHealthSlots }
  | { archetype: "clinical-intervention"; header: CardHeader; slots: ClinicalInterventionSlots }
  | { archetype: "workflow-habit"; header: CardHeader; slots: WorkflowHabitSlots }
  | { archetype: "game-progression"; header: CardHeader; slots: GameProgressionSlots }
  | { archetype: "biomarker-time-course"; header: CardHeader; slots: BiomarkerTimeCourseSlots }
  | { archetype: "social-cohort"; header: CardHeader; slots: SocialCohortSlots };

// ── Domain template — declares allowed archetypes ──────────────────────
//
// Twins carry a domain-template id. The template names which archetypes
// are valid for apps in this domain, and which is the default when the
// agent has no other signal to choose from. New domains plug in by
// adding a row to `domain_templates`.

export interface DomainCardPolicy {
  domainTemplateId: string;       // e.g., "cognition", "sleep", "wellness"
  defaultArchetype: CardArchetype;
  allowedArchetypes: CardArchetype[];
}

// ── Agent input → output contract ──────────────────────────────────────
//
// The CardGenerator reads these inputs and emits a CardSpec. Pure
// function — no DB writes here, no fetching. The pipeline runner
// persists the result on the App row.

export interface CardGeneratorInput {
  app: {
    id: string;
    name: string;
    appType: AppType;
    /** App's high-level intervention class — drives archetype selection. */
    interventionClass:
      | "tracker"           // → consumer-health
      | "protocol"          // → clinical-intervention
      | "habit"             // → workflow-habit
      | "training"          // → game-progression
      | "monitor";          // → consumer-health (with multi-metric upgrade)
    manifest: Record<string, unknown>;
  };
  /** Output of the strategizer simulation at T7. Shape varies by what
   *  the simulator returned for this app. */
  simulation:
    | { kind: "single-endpoint"; p10: number; p50: number; p90: number; unit?: string }
    | { kind: "multi-endpoint"; outcomes: Array<{ label: string; pct: number }>; dosePct: number; onsetCopy: string }
    | { kind: "habit-completion"; cadenceCopy: string; predictedCompletion: boolean[]; outOf?: string }
    | { kind: "progression"; currentLevel: string; nextLevel: string; progress: number; scoreRange: [number, number]; best: number; cadenceCopy: string }
    | { kind: "biomarker-trajectory"; biomarkers: BiomarkerTimeCourseSlots["biomarkers"]; horizon: string }
    | { kind: "cohort"; cohortSize: number; attending: number; status: string; avatarColors: string[] };
  domainPolicy: DomainCardPolicy;
}

export type CardGenerator = (input: CardGeneratorInput) => CardSpec;

// ── Default archetype-pick rule ────────────────────────────────────────
//
// Reference implementation the agent can use. Decision order:
//   1. Simulation shape forces the archetype where the mapping is
//      lossless (e.g., multi-endpoint → clinical-intervention).
//   2. Otherwise fall back to the app's interventionClass mapping.
//   3. Otherwise fall back to the domain policy's defaultArchetype.
//   4. Validate the pick against domainPolicy.allowedArchetypes; if
//      disallowed, downgrade to the policy default.

export function defaultArchetypeFor(input: CardGeneratorInput): CardArchetype {
  const sim = input.simulation;
  const cls = input.app.interventionClass;

  // (1) simulation shape
  let pick: CardArchetype;
  if (sim.kind === "biomarker-trajectory") pick = "biomarker-time-course";
  else if (sim.kind === "cohort") pick = "social-cohort";
  else if (sim.kind === "multi-endpoint") pick = "clinical-intervention";
  else if (sim.kind === "habit-completion") pick = "workflow-habit";
  else if (sim.kind === "progression") pick = "game-progression";
  else {
    // (2) interventionClass
    pick =
      cls === "protocol" ? "clinical-intervention" :
      cls === "habit" ? "workflow-habit" :
      cls === "training" ? "game-progression" :
      "consumer-health";
  }

  // (4) downgrade if disallowed
  if (!input.domainPolicy.allowedArchetypes.includes(pick)) {
    return input.domainPolicy.defaultArchetype;
  }
  return pick;
}
