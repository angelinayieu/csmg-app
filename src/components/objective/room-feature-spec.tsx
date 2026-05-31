"use client";

// ── Room Feature Spec ──
//
// Replaces the macro "Objective coverage" annotation rollup in the
// room hero. Where that strip answered "which readings of the parent
// objective does this room cover", this answers the question the user
// actually has standing inside a room: *what is this feature trying to
// do, and how rigorously is it specced?*
//
// It is a ROLL-UP, not a new generator. Every value here is read from
// data already in scope in the room view:
//   • Optimizes for     ← outcomeItems (name + measured_by)
//   • Problems in focus  ← painItems (top by influence_rank + root cause)
//   • Experience         ← mechanism_spec.user_visible_behavior +
//                          runtime_flow (steps with a user-facing surface)
//   • Feasibility & rigor← mechanism_spec.quality_score (6-axis mean),
//                          acceptance-criteria count, spec coverage
//
// It deliberately does NOT restate the deep technical detail — that
// lives on each feature card's mechanism lineup / Experience view.
// The rigor section points there ("where do they surface?").

import { appleVibe } from "@/lib/apple-vibe-tokens";

// ── Minimal structural shapes ───────────────────────────────────────
// Typed locally + read defensively so this stays decoupled from the
// full MechanismSpec interface (which evolves on its own cadence) and
// tolerant of legacy stored rows that lack newer fields.

interface FeatureItem {
  id: string;
  name: string;
  positive_outcome?: string;
  /** Holds { mechanism_spec?: MechanismSpec } when the feature has
   *  been specced. Parsed defensively below. */
  expanded_detail?: unknown;
}

interface PainItem {
  id: string;
  name: string;
  negative_outcome?: string;
  root_causes: string[];
  influence_rank: number;
}

interface OutcomeItem {
  id: string;
  name: string;
  measured_by?: string;
  indicators: string[];
}

interface Props {
  featureItems: FeatureItem[];
  painItems: PainItem[];
  outcomeItems: OutcomeItem[];
}

// What we actually read off a stored mechanism_spec. Everything
// optional → a malformed / partial spec degrades gracefully instead
// of throwing.
interface SpecShape {
  user_visible_behavior?: unknown;
  runtime_flow?: unknown;
  quality_score?: Record<string, unknown>;
  acceptance_criteria?: unknown;
}

const QUALITY_AXES = [
  "specificity",
  "technical_depth",
  "measurability",
  "ui_connection",
  "feasibility",
  "failure_mode_clarity",
] as const;

const AXIS_LABEL: Record<(typeof QUALITY_AXES)[number], string> = {
  specificity: "specificity",
  technical_depth: "technical depth",
  measurability: "measurability",
  ui_connection: "UI connection",
  feasibility: "feasibility",
  failure_mode_clarity: "failure-mode clarity",
};

function readSpec(expanded: unknown): SpecShape | null {
  if (!expanded || typeof expanded !== "object") return null;
  const ms = (expanded as Record<string, unknown>).mechanism_spec;
  if (!ms || typeof ms !== "object") return null;
  return ms as SpecShape;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Mean of a spec's 6 quality axes, or null when none are numeric. */
function specRigor(spec: SpecShape): number | null {
  const qs = spec.quality_score;
  if (!qs || typeof qs !== "object") return null;
  const vals = QUALITY_AXES.map((a) => qs[a]).filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n),
  );
  if (vals.length === 0) return null;
  return vals.reduce((s, n) => s + n, 0) / vals.length;
}

function rigorTier(score: number): { word: string; color: string } {
  if (score < 0.45) return { word: "thin", color: "rgba(180,83,9,0.95)" };
  if (score < 0.6)
    return { word: "developing", color: "rgba(146,64,14,0.9)" };
  if (score < 0.78) return { word: "solid", color: appleVibe.text.secondary };
  return { word: "strong", color: "rgba(21,128,61,0.95)" };
}

// ── Sub-section label ───────────────────────────────────────────────
// Matches the standardized hierarchy from the ExperimentFrame pass:
// the label is bigger + darker + bolder than the body beneath it, so
// the eye reads label → detail, never the inverse.
function SpecLabel({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "pain";
}) {
  return (
    <div
      className="text-[12.5px] font-semibold leading-tight"
      style={{
        color: tone === "pain" ? appleVibe.stage.pain : appleVibe.text.primary,
        letterSpacing: "-0.006em",
      }}
    >
      {children}
    </div>
  );
}

function ItemRow({
  dotColor,
  title,
  sub,
}: {
  dotColor: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="flex gap-2">
      <span
        className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: dotColor }}
        aria-hidden
      />
      <div className="min-w-0">
        <div
          className="text-[12.5px] font-medium leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {title}
        </div>
        {sub && (
          <div
            className="truncate text-[11px] leading-snug"
            style={{ color: appleVibe.text.faint }}
            title={sub}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

export function RoomFeatureSpec({
  featureItems,
  painItems,
  outcomeItems,
}: Props) {
  const specs = featureItems
    .map((f) => readSpec(f.expanded_detail))
    .filter((s): s is SpecShape => s !== null);

  const featureCount = featureItems.length;
  const specCount = specs.length;

  // Nothing to roll up → don't render an empty block.
  if (featureCount === 0 && painItems.length === 0 && outcomeItems.length === 0)
    return null;

  // ── Optimizes for — the room's actual objectives ──
  const topOutcomes = outcomeItems.slice(0, 3);

  // ── Problems in focus — already sorted desc by influence_rank ──
  const topPains = painItems.slice(0, 3);

  // ── Experience ──
  const behaviors = specs
    .map((s) => asString(s.user_visible_behavior))
    .filter((b) => b.length > 0);
  const exampleBehavior =
    behaviors.length > 0
      ? behaviors.reduce((a, b) => (b.length > a.length ? b : a))
      : "";
  const interactionSteps = specs.reduce((sum, s) => {
    if (!Array.isArray(s.runtime_flow)) return sum;
    const userFacing = (s.runtime_flow as unknown[]).filter((step) => {
      if (!step || typeof step !== "object") return false;
      const vi = (step as Record<string, unknown>).visual_intent;
      return typeof vi === "string" && vi.length > 0;
    });
    return sum + userFacing.length;
  }, 0);

  // ── Feasibility & rigor ──
  const rigors = specs
    .map(specRigor)
    .filter((n): n is number => n !== null);
  const meanRigor =
    rigors.length > 0 ? rigors.reduce((s, n) => s + n, 0) / rigors.length : null;
  const tier = meanRigor !== null ? rigorTier(meanRigor) : null;

  // Weakest axis across specced features.
  let weakestAxis: string | null = null;
  if (specCount > 0) {
    let worst = Infinity;
    for (const axis of QUALITY_AXES) {
      const vals = specs
        .map((s) => s.quality_score?.[axis])
        .filter((n): n is number => typeof n === "number");
      if (vals.length === 0) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (mean < worst) {
        worst = mean;
        weakestAxis = AXIS_LABEL[axis];
      }
    }
  }

  const acceptanceTotal = specs.reduce((sum, s) => {
    return sum + (Array.isArray(s.acceptance_criteria) ? s.acceptance_criteria.length : 0);
  }, 0);

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* Header — mirrors the hero blocks: a neutral dot (this is a
          cross-cutting overview, not one stage) + standard title +
          quiet count metadata. */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-2">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: "rgba(15,23,42,0.4)" }}
            aria-hidden
          />
          <span
            className="text-[15px] font-semibold leading-tight"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.015em",
              fontFamily: appleVibe.font.display,
            }}
          >
            Feature spec
          </span>
        </span>
        <span
          className="text-[12px] font-normal"
          style={{ color: appleVibe.text.tertiary }}
        >
          · {featureCount} feature{featureCount === 1 ? "" : "s"}
          {specCount > 0 ? ` · ${specCount} specced` : ""}
        </span>
      </div>

      {/* Body prose — same type as the hero so the blocks read as a
          coordinated stack. */}
      <p
        className="mb-3 max-w-[70ch] text-[13.5px] font-normal leading-relaxed"
        style={{ color: appleVibe.text.secondary }}
      >
        The working brief for this room — what it optimizes for, the problems
        in focus, the experience it creates, and how rigorously it&rsquo;s
        specified. Full technical detail lives on each feature card.
      </p>

      <div className="flex flex-col gap-3.5">
        {/* Optimizes for — the room's actual objectives */}
        <div>
          <SpecLabel>Optimizes for</SpecLabel>
          {topOutcomes.length > 0 ? (
            <div className="mt-1.5 flex flex-col gap-1">
              {topOutcomes.map((o) => (
                <ItemRow
                  key={o.id}
                  dotColor={appleVibe.stage.outcomes}
                  title={o.name}
                  sub={o.measured_by}
                />
              ))}
            </div>
          ) : (
            <p
              className="mt-1 text-[11.5px] italic"
              style={{ color: appleVibe.text.faint }}
            >
              No target outcomes defined yet.
            </p>
          )}
        </div>

        {/* Problems in focus — top pains by influence */}
        <div>
          <SpecLabel tone="pain">Problems in focus</SpecLabel>
          {topPains.length > 0 ? (
            <div className="mt-1.5 flex flex-col gap-1">
              {topPains.map((p) => (
                <ItemRow
                  key={p.id}
                  dotColor={appleVibe.stage.pain}
                  title={p.name}
                  sub={p.root_causes[0]}
                />
              ))}
            </div>
          ) : (
            <p
              className="mt-1 text-[11.5px] italic"
              style={{ color: appleVibe.text.faint }}
            >
              No problems captured yet.
            </p>
          )}
        </div>

        {/* Experience — the mechanism→UI link, rolled up */}
        <div>
          <SpecLabel>Experience</SpecLabel>
          {specCount > 0 && behaviors.length > 0 ? (
            <div className="mt-1">
              <p
                className="text-[12.5px] leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                {behaviors.length} of {specCount} feature
                {specCount === 1 ? "" : "s"} describe what the user sees
                {interactionSteps > 0
                  ? ` · ${interactionSteps} interaction step${interactionSteps === 1 ? "" : "s"} mapped`
                  : ""}
                .
              </p>
              {exampleBehavior && (
                <p
                  className="mt-1 line-clamp-2 text-[11.5px] leading-snug"
                  style={{ color: appleVibe.text.faint }}
                  title={exampleBehavior}
                >
                  e.g. {exampleBehavior}
                </p>
              )}
            </div>
          ) : (
            <p
              className="mt-1 text-[11.5px] italic"
              style={{ color: appleVibe.text.faint }}
            >
              Not specced yet — open a feature card to define its UX.
            </p>
          )}
        </div>

        {/* Feasibility & rigor — the build-readiness gauge + pointer */}
        <div>
          <SpecLabel>Feasibility &amp; rigor</SpecLabel>
          {meanRigor !== null && tier ? (
            <div className="mt-1">
              <p className="text-[12.5px] leading-snug">
                <span className="font-semibold" style={{ color: tier.color }}>
                  {tier.word}
                </span>
                <span
                  className="ml-1 tabular-nums"
                  style={{ color: appleVibe.text.faint }}
                >
                  {meanRigor.toFixed(2)}
                </span>
                {weakestAxis && (
                  <span style={{ color: appleVibe.text.tertiary }}>
                    {" "}
                    · weakest: {weakestAxis}
                  </span>
                )}
              </p>
              <p
                className="mt-0.5 text-[11.5px] leading-snug"
                style={{ color: appleVibe.text.faint }}
              >
                {specCount}/{featureCount} feature
                {featureCount === 1 ? "" : "s"} specced
                {acceptanceTotal > 0
                  ? ` · ${acceptanceTotal} acceptance criteri${acceptanceTotal === 1 ? "on" : "a"}`
                  : ""}
              </p>
            </div>
          ) : (
            <p
              className="mt-1 text-[11.5px] italic"
              style={{ color: appleVibe.text.faint }}
            >
              Not specced yet — generate a feature&rsquo;s mechanism to gauge
              build-readiness.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
