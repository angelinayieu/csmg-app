"use client";

// ── Archetype renderers ─────────────────────────────────────────────
//
// One renderer per `CardArchetype`. Each takes its archetype-specific
// `slots`, plus shared header + mode + size, and composes primitives
// inside `CardShell` to produce a finished card. No data fetching, no
// state — pure presentational.
//
// Adding an archetype:
//   1. Add the slot interface + discriminator entry to `card-spec.ts`.
//   2. Write a renderer here that takes `{ header, slots, mode, size }`.
//   3. Add a case to `card-spec-renderer.tsx`.
// The agent + persistence side require no changes to add a renderer.

import type {
  BiomarkerTimeCourseSlots,
  CardHeader,
  ClinicalInterventionSlots,
  ConsumerHealthSlots,
  GameProgressionSlots,
  SocialCohortSlots,
  WorkflowHabitSlots,
} from "@/types/card-spec";
import { CardShell, type CardMode, type CardSize } from "./card-shell";
import {
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
import { MONO_FONT, TEXT_MUTED, TEXT_PRIMARY } from "./tokens";

interface ArchetypeRendererProps<S> {
  header: CardHeader;
  slots: S;
  mode?: CardMode;
  size?: CardSize;
}

// ── Consumer health ─────────────────────────────────────────────────

export function ConsumerHealthCard({
  header,
  slots,
  mode,
  size = "expanded",
}: ArchetypeRendererProps<ConsumerHealthSlots>) {
  const isCompact = size === "compact";
  return (
    <CardShell header={header} mode={mode} size={size}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span
              style={{
                fontSize: isCompact ? 22 : 32,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: TEXT_PRIMARY,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {slots.metric}
            </span>
            {slots.unit ? (
              <span style={{ fontSize: isCompact ? 11 : 14, color: TEXT_MUTED, fontWeight: 500 }}>
                {slots.unit}
              </span>
            ) : null}
          </div>
          <span
            style={{
              fontSize: isCompact ? 10.5 : 13,
              color: TEXT_MUTED,
              letterSpacing: "-0.005em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {slots.status}
          </span>
        </div>
        <div style={{ flexShrink: 0 }}>
          {slots.viz.kind === "bar-chart" ? (
            <BarChart7
              values={slots.viz.values}
              color={slots.viz.color}
              faintColor={slots.viz.faintColor}
            />
          ) : slots.viz.kind === "line-chart" ? (
            <LineChart7 values={slots.viz.values} color={slots.viz.color} />
          ) : (
            <RingGrid7 hits={slots.viz.hits} color={slots.viz.color} />
          )}
        </div>
      </div>
    </CardShell>
  );
}

// ── Clinical intervention ───────────────────────────────────────────

export function ClinicalInterventionCard({
  header,
  slots,
  mode,
  size = "expanded",
}: ArchetypeRendererProps<ClinicalInterventionSlots>) {
  return (
    <CardShell
      header={header}
      eyebrow={size === "expanded" ? "Intervention" : undefined}
      mode={mode}
      size={size}
      footer={size === "expanded" ? slots.onsetCopy : undefined}
    >
      {size === "expanded" ? (
        <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: -8 }}>{slots.subtitle}</div>
      ) : null}
      <DoseResponseCurve color={slots.accent} dosePct={slots.dosePct} />
      <OutcomeBars items={slots.outcomes} color={slots.accent} />
    </CardShell>
  );
}

// ── Workflow habit ──────────────────────────────────────────────────

export function WorkflowHabitCard({
  header,
  slots,
  mode,
  size = "expanded",
}: ArchetypeRendererProps<WorkflowHabitSlots>) {
  const isCompact = size === "compact";
  return (
    <CardShell
      header={header}
      eyebrow={size === "expanded" ? "Habit" : undefined}
      mode={mode}
      size={size}
      footer={size === "expanded" ? slots.cadenceCopy : undefined}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span
            style={{
              fontSize: isCompact ? 22 : 32,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              color: TEXT_PRIMARY,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {slots.count}
          </span>
          {slots.outOf ? (
            <span style={{ fontSize: isCompact ? 11 : 14, color: TEXT_MUTED, fontWeight: 500 }}>
              {slots.outOf}
            </span>
          ) : null}
        </div>
        <div style={{ flexShrink: 0 }}>
          <StreakDots done={slots.streak} color={slots.color} />
        </div>
      </div>
      {isCompact && slots.cadenceCopy ? (
        <span
          style={{
            fontSize: 10,
            color: TEXT_MUTED,
            fontFamily: MONO_FONT,
            letterSpacing: "0.01em",
          }}
        >
          {slots.cadenceCopy}
        </span>
      ) : null}
    </CardShell>
  );
}

// ── Game progression ────────────────────────────────────────────────

export function GameProgressionCard({
  header,
  slots,
  mode,
  size = "expanded",
}: ArchetypeRendererProps<GameProgressionSlots>) {
  return (
    <CardShell
      header={header}
      eyebrow={size === "expanded" ? "Training" : undefined}
      mode={mode}
      size={size}
      footer={size === "expanded" ? slots.cadenceCopy : undefined}
    >
      <ProgressBar
        progress={slots.progress}
        color={slots.color}
        startLabel={slots.currentLevel}
        endLabel={slots.nextLevel}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: size === "compact" ? 10 : 11,
          color: TEXT_MUTED,
        }}
      >
        <span style={{ fontWeight: 500 }}>Best</span>
        <span style={{ fontFamily: MONO_FONT, fontVariantNumeric: "tabular-nums" }}>
          {slots.best}
        </span>
      </div>
      <ScoreRangeBar range={slots.scoreRange} best={slots.best} color={slots.color} />
    </CardShell>
  );
}

// ── Biomarker time-course ───────────────────────────────────────────

export function BiomarkerTimeCourseCard({
  header,
  slots,
  mode,
  size = "expanded",
}: ArchetypeRendererProps<BiomarkerTimeCourseSlots>) {
  return (
    <CardShell
      header={header}
      eyebrow={size === "expanded" ? "Biomarkers" : undefined}
      mode={mode}
      size={size}
      footer={size === "expanded" ? slots.horizon : undefined}
    >
      {size === "expanded" ? (
        <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: -8 }}>{slots.subtitle}</div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {slots.biomarkers.slice(0, size === "compact" ? 2 : 4).map((bm, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: size === "compact" ? "60px 1fr 56px" : "78px 1fr 70px",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(20,30,60,0.7)" }}>
              {bm.label}
            </span>
            <BiomarkerMiniLine values={bm.values} color={bm.color} />
            <span
              style={{
                fontSize: 10,
                color: TEXT_MUTED,
                fontFamily: MONO_FONT,
                fontVariantNumeric: "tabular-nums",
                textAlign: "right",
              }}
            >
              {bm.current}
              <span style={{ opacity: 0.5 }}> → {bm.target}</span>
            </span>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ── Social cohort ───────────────────────────────────────────────────

export function SocialCohortCard({
  header,
  slots,
  mode,
  size = "expanded",
}: ArchetypeRendererProps<SocialCohortSlots>) {
  const isCompact = size === "compact";
  return (
    <CardShell
      header={header}
      eyebrow={size === "expanded" ? "Cohort" : undefined}
      mode={mode}
      size={size}
      footer={size === "expanded" ? slots.subtitle : undefined}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span
              style={{
                fontSize: isCompact ? 22 : 32,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: TEXT_PRIMARY,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {slots.attending}
            </span>
            <span style={{ fontSize: isCompact ? 11 : 14, color: TEXT_MUTED, fontWeight: 500 }}>
              / {slots.cohortSize}
            </span>
          </div>
          <span
            style={{
              fontSize: isCompact ? 10.5 : 13,
              color: TEXT_MUTED,
              letterSpacing: "-0.005em",
            }}
          >
            {slots.status}
          </span>
        </div>
        <div style={{ flexShrink: 0 }}>
          <CohortAvatars total={slots.cohortSize} colors={slots.avatarColors} />
        </div>
      </div>
    </CardShell>
  );
}
