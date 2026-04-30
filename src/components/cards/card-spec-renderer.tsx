"use client";

// ── CardSpecRenderer ────────────────────────────────────────────────
//
// Single dispatch point: takes a `CardSpec` (the persisted JSON the
// CardGenerator agent emits at T7), reads its discriminator, and
// renders the matching archetype component. This is the only seam any
// surface (canvas shape, lab panel, app dashboard, preflight) needs to
// touch when card_spec is present.
//
// Mode:
//   - "forecast" — header badge says "Forecast", reads as a prediction
//   - "live"     — header badge says "Today", reads as observed reality
//
// Size:
//   - "compact"  — 220px-ish, terse padding (canvas drop)
//   - "expanded" — ~360px, generous padding (lab / dashboard)
//
// Adding a new archetype is a one-line change here once the renderer
// + slot type land. No other consumers need updates.

import type { CardSpec } from "@/types/card-spec";
import {
  BiomarkerTimeCourseCard,
  ClinicalInterventionCard,
  ConsumerHealthCard,
  GameProgressionCard,
  SocialCohortCard,
  WorkflowHabitCard,
} from "./archetypes";
import type { CardMode, CardSize } from "./card-shell";

export interface CardSpecRendererProps {
  spec: CardSpec;
  mode?: CardMode;
  size?: CardSize;
}

export function CardSpecRenderer({ spec, mode = "forecast", size = "expanded" }: CardSpecRendererProps) {
  switch (spec.archetype) {
    case "consumer-health":
      return <ConsumerHealthCard header={spec.header} slots={spec.slots} mode={mode} size={size} />;
    case "clinical-intervention":
      return <ClinicalInterventionCard header={spec.header} slots={spec.slots} mode={mode} size={size} />;
    case "workflow-habit":
      return <WorkflowHabitCard header={spec.header} slots={spec.slots} mode={mode} size={size} />;
    case "game-progression":
      return <GameProgressionCard header={spec.header} slots={spec.slots} mode={mode} size={size} />;
    case "biomarker-time-course":
      return <BiomarkerTimeCourseCard header={spec.header} slots={spec.slots} mode={mode} size={size} />;
    case "social-cohort":
      return <SocialCohortCard header={spec.header} slots={spec.slots} mode={mode} size={size} />;
    default: {
      // Exhaustiveness guard — TS will error here if a new archetype
      // is added to CardSpec without a case above.
      const _exhaustive: never = spec;
      return null;
    }
  }
}

/**
 * Best-effort JSON parser for card_spec payloads stored as strings on
 * tldraw shape props. Returns null on bad JSON or missing archetype —
 * the shape view falls back to its legacy rendering.
 */
export function parseCardSpec(json: string | null | undefined): CardSpec | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.archetype !== "string" || !parsed.header || !parsed.slots) return null;
    return parsed as CardSpec;
  } catch {
    return null;
  }
}
