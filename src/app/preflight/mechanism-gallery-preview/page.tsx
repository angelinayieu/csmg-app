// Preview harness for the Mechanism Gallery — the stacked-card deck
// that replaces the flat mechanism-lineup rail. Mock data only, no
// auth, no network. The elected card carries an inline mockup_thumbnail
// _html so the "final product forward" front face renders without
// hitting the LLM route. Public route. SAFE TO DELETE.

"use client";

import { useState } from "react";
import { MechanismGallery } from "@/components/objective/mechanism-gallery";
import type { LineupVariation } from "@/components/objective/category-card";

// A tiny self-contained HTML "UI" so the elected card's product face
// shows a real rendered interface in the preview.
const MOCK_UI = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  body{width:480px;height:320px;background:#F5F5F7;padding:18px}
  .h{font-size:15px;font-weight:700;color:#1d1d1f;margin-bottom:3px}
  .s{font-size:11px;color:#86868b;margin-bottom:14px}
  .card{background:#fff;border-radius:14px;padding:14px;box-shadow:0 2px 10px rgba(0,0,0,.06);margin-bottom:10px}
  .row{display:flex;justify-content:space-between;align-items:center}
  .pill{background:#E8F0FE;color:#1a73e8;font-size:10px;font-weight:600;padding:3px 9px;border-radius:99px}
  .bar{height:6px;background:#eee;border-radius:99px;margin-top:8px;overflow:hidden}
  .fill{height:100%;width:68%;background:linear-gradient(90deg,#34c759,#30b0c7)}
  .big{font-size:26px;font-weight:700;color:#1d1d1f}
</style></head><body>
  <div class="h">Goal Alignment Tracker</div>
  <div class="s">This week · 4 active goals</div>
  <div class="card"><div class="row"><div>Career skills</div><div class="pill">on track</div></div><div class="bar"><div class="fill"></div></div></div>
  <div class="card"><div class="row"><div class="big">68%</div><div class="s">aligned with searches</div></div></div>
</body></html>`;

function v(
  id: string,
  name: string,
  opts: Partial<LineupVariation> = {},
): LineupVariation {
  return {
    id,
    name,
    description: opts.description,
    effectiveness_score: opts.effectiveness_score,
    evaluation_method: opts.evaluation_method,
    disposition: opts.disposition ?? null,
    provenance: opts.provenance,
    tradeoff: opts.tradeoff,
    open_questions: opts.open_questions,
    target_root_cause: opts.target_root_cause,
    mockup_thumbnail_html: opts.mockup_thumbnail_html,
    indicator_scores: opts.indicator_scores,
  };
}

const VARIATIONS: LineupVariation[] = [
  v("m1", "Inline goal-alignment nudges", {
    description:
      "Surface a lightweight nudge beside each search result estimating how well it aligns with the user's stated career goals.",
    effectiveness_score: 0.81,
    evaluation_method: "ensemble",
    disposition: "elected",
    mockup_thumbnail_html: MOCK_UI,
    tradeoff:
      "High alignment signal, but risks nudge-fatigue if shown on every query rather than ambiguous ones.",
    open_questions: [
      "What alignment threshold should trigger a visible nudge?",
      "Does the nudge bias users away from exploratory search?",
    ],
    target_root_cause: "Activity–goal misalignment",
    indicator_scores: [
      {
        indicator_text: "Goal-aligned session share",
        outcome_id: "o1",
        outcome_name: "Goal conversion",
        score: 0.78,
        reason: "Directly nudges toward aligned activity.",
        confidence: 0.7,
      },
      {
        indicator_text: "Nudge dismissal rate",
        outcome_id: "o1",
        outcome_name: "Engagement",
        score: 0.42,
        reason: "Fatigue risk lowers confidence.",
        confidence: 0.4,
      },
    ],
  }),
  v("m2", "Weekly alignment digest", {
    description:
      "A weekly summary email/card that scores the past week's digital activity against goals and suggests one adjustment.",
    effectiveness_score: 0.63,
    evaluation_method: "rubric",
    tradeoff: "Lower friction, but delayed feedback weakens the loop.",
    open_questions: ["Is weekly cadence too slow to change behavior?"],
    indicator_scores: [
      {
        indicator_text: "Weekly adjustment adoption",
        outcome_id: "o1",
        outcome_name: "Goal conversion",
        score: 0.61,
        reason: "Concrete single suggestion is actionable.",
        confidence: 0.6,
      },
    ],
  }),
  v("m3", "Goal-aware search ranking", {
    description:
      "Re-rank results by predicted contribution to the user's goals, not just relevance.",
    effectiveness_score: 0.38,
    evaluation_method: "heuristic",
    provenance: "rd_iteration",
    tradeoff: "Powerful if accurate, but mis-ranking erodes trust fast.",
  }),
  v("m4", "Manual goal-tagging", {
    description:
      "Let users tag searches with the goal they serve, building a labeled history over time.",
  }),
];

export default function Page() {
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 5));

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FAFAFA",
        padding: "48px 24px",
      }}
    >
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        <h1
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "rgba(15,23,42,0.55)",
            marginBottom: 4,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          Mechanism Gallery — preview
        </h1>
        <p
          style={{
            fontSize: 12,
            color: "rgba(15,23,42,0.5)",
            marginBottom: 28,
            lineHeight: 1.5,
          }}
        >
          4 methods for the same solution. Card 1 is elected → front shows
          the rendered product. Flip (↻) for reasoning. Arrows / dots /
          ghost-click to browse.
        </p>

        <MechanismGallery
          variations={VARIATIONS}
          featureId="feat-preview"
          spaceId="space-preview"
          subObjectiveId="sub-preview"
          onElect={(id) => note(`elect ${id}`)}
          onReject={(id) => note(`reject ${id}`)}
        />

        {log.length > 0 && (
          <div
            style={{
              marginTop: 28,
              fontSize: 11,
              color: "rgba(15,23,42,0.5)",
              fontFamily: "monospace",
            }}
          >
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
