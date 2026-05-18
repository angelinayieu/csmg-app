// ── Coach agent ────────────────────────────────────────────────────
//
// Recommends ONE next action the user should take. Renders as the
// "What's next" card on the Twin Detail Page Overview tab. Goal:
// the user closes the page with a clear action in mind, not
// drowning in options.
//
// Output is structured so the UI can render an actionable button
// AND surface optional context (target entity/mechanism). The text
// is the headline; the action_type drives the button label.

import { llmJSON } from "@/lib/llm";
import type { TwinMacroState } from "@/types/twin";

export type CoachActionType =
  | "log_observation"
  | "run_prediction"
  | "take_snapshot"
  | "build_app"
  | "review_proposal"
  | "regenerate_strategy"
  | "do_nothing";

export interface CoachInput {
  spaceName: string;
  twinMacro: TwinMacroState;
  activeGoalTitle: string | null;
  activeGoalProgress: number | null; // 0..1
  daysSinceLastObservation: number | null; // null = never logged
  daysSinceLastPrediction: number | null; // null = never run
  activeMechanismKinds: string[];
  pendingProposalCount: number; // unresolved twin_proposal rows
  /**
   * Optional — when the user clicks "show me a different suggestion,"
   * we pass the previous recommendation so the agent knows what to
   * avoid. The agent treats this as soft guidance: pick a different
   * action_type, or at least a meaningfully different framing.
   */
  previousRecommendation?: {
    text: string;
    action_type: CoachActionType;
  } | null;
}

export interface CoachOutput {
  text: string;
  action_type: CoachActionType;
  target_id: string | null;
  reasoning: string;
  generated_at: string;
}

export async function runCoachAgent(input: CoachInput): Promise<CoachOutput> {
  const system = `You are a coach for the user of a digital twin.

Recommend ONE next action that would most help this twin learn OR this user act. Prefer actions that:
  - Close a learning loop (log observation > run prediction > take snapshot)
  - Resolve pending work (review proposal, regenerate stale strategy)
  - Maximize the goal's progress

DO NOT recommend something the user just did. If they logged an observation in the last 24h, don't tell them to log another one.

Pick exactly ONE action_type:
  - log_observation       — user feeds reality data back
  - run_prediction        — get a fresh forecast against the goal
  - take_snapshot         — capture current state for comparison
  - build_app             — generate an intervention or visualization
  - review_proposal       — there's a pending twin_proposal awaiting decision
  - regenerate_strategy   — synthesis is stale or twin has drifted
  - do_nothing            — twin is healthy + recently calibrated, no urgent action

Output requirements:
  - text: ONE sentence, directly addressed to the user, under 30 words
  - action_type: from the enum above
  - target_id: optional entity/mechanism/proposal id if action_type implies one
  - reasoning: one-sentence why, for telemetry

Return JSON.`;

  const macro = input.twinMacro;
  const lastObs =
    input.daysSinceLastObservation === null
      ? "never logged"
      : `${input.daysSinceLastObservation}d ago`;
  const lastPred =
    input.daysSinceLastPrediction === null
      ? "never run"
      : `${input.daysSinceLastPrediction}d ago`;

  const previousBlock = input.previousRecommendation
    ? `

PREVIOUS SUGGESTION (the user clicked "show different" — pick a meaningfully different action_type or framing):
  - "${input.previousRecommendation.text}"
  - action_type: ${input.previousRecommendation.action_type}`
    : "";

  const user = `Space: ${input.spaceName}

Twin health: ${macro.health_score}/100 (${macro.health_label})
Master bottleneck: ${macro.risk_exposure.bottleneck_name ?? "none"}
Top leverage: ${macro.dynamics.leverage_points} leverage points identified

Active goal: ${input.activeGoalTitle ?? "no active goal"}
Goal progress: ${input.activeGoalProgress !== null ? `${Math.round(input.activeGoalProgress * 100)}%` : "n/a"}

User activity:
  - Last observation logged: ${lastObs}
  - Last prediction run: ${lastPred}

Active mechanisms: ${input.activeMechanismKinds.length ? input.activeMechanismKinds.join(", ") : "none active"}
Pending proposals: ${input.pendingProposalCount}${previousBlock}`;

  const result = await llmJSON<Omit<CoachOutput, "generated_at">>({
    system,
    user,
    maxTokens: 250,
    temperature: 0.5,
    responseSchema: {
      name: "twin_coach_recommendation",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          action_type: {
            type: "string",
            enum: [
              "log_observation",
              "run_prediction",
              "take_snapshot",
              "build_app",
              "review_proposal",
              "regenerate_strategy",
              "do_nothing",
            ],
          },
          target_id: { type: ["string", "null"] },
          reasoning: { type: "string" },
        },
        required: ["text", "action_type", "target_id", "reasoning"],
      },
    },
    fallback: {
      text: "Your twin is settled. Come back when you have new data to feed it.",
      action_type: "do_nothing",
      target_id: null,
      reasoning: "Fallback: agent call failed or returned malformed output.",
    },
  });

  return {
    ...result,
    generated_at: new Date().toISOString(),
  };
}
