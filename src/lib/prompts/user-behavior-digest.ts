/**
 * Wave C — user-behavior digest prompt.
 *
 * Run nightly (or on-demand via /api/user-baseline/regenerate) by the
 * digest cron. Takes the user's recent events from user_events plus
 * lightweight context (objective hit rate, apps count, recent goal
 * titles) and emits three structured outputs:
 *   - persona_tags[] — short labels like "retention-focused",
 *     "evidence-first", "speed-over-rigor"
 *   - behavior_summary — 1 paragraph (2-4 sentences), natural language
 *   - goal_preferences — structured hints (lean, preferred types, cadence)
 *   - baseline_metrics — 3-7 computed aggregates the user should
 *     recognise (approval rate, active spaces, typical cadence)
 *
 * The LLM gets event records (event_type + source + payload fields) +
 * aggregate counts. It does NOT get raw titles or cross-space content;
 * that would be a privacy surface creep. The digest is ABOUT the user's
 * behaviour patterns, not ABOUT their projects.
 *
 * Downstream consumers:
 *   - Lab prior-setter (Wave E) — uses persona_tags + goal_preferences
 *     to tilt distributions toward the user's historical lean.
 *   - Strategy-refresh prompts — references behavior_summary as context.
 *   - Dashboard "About you" panel — shows persona_tags + summary.
 */

export const USER_BEHAVIOR_DIGEST_SYSTEM_PROMPT = `You are summarising a user's behaviour patterns on an AI-augmented
knowledge / strategy tool. You receive:
  - A list of recent user events (goal.approved, proposal.rejected,
    app.refreshed, bridge.confirmed, lab.what_if_run, etc.) with their
    timestamps, source, and a small payload.
  - Aggregate counts (total events, distinct event_types, activity span).

Your job: produce a structured output describing the user's LEAN — what
they tend to approve / reject, how often they engage, which activities
they prefer. This feeds the system's "memory of you" so future
suggestions respect your taste.

Return STRICT JSON — NO prose outside the object:

{
  "persona_tags": [
    "3-7 short labels (1-3 words each). Each tag describes a STABLE
     pattern, not a one-off. Good: 'retention-focused', 'evidence-first',
     'prefers-deep-over-broad', 'rejects-speculative-goals'. Bad:
     'user', 'active', 'using product'."
  ],
  "behavior_summary": "2-4 sentences of natural language. Written in
    second person ('You tend to…'). Cite specific event patterns
    ('you've rejected 4 retention-framed proposals but approved 3
    onboarding ones'). NO generic filler. If data is sparse, say so.",
  "goal_preferences": {
    "lean": "1-3 word orientation, e.g. 'retention-skeptical',
      'evidence-first', 'speed-over-rigor'. Optional — omit if unclear.",
    "preferred_objective_types": ["max 3 of: maximize, minimize,
      maintain, explore, avoid, validate, build, defend — based on
      WHICH types the user has APPROVED most often."],
    "rejected_objective_types": ["max 3 — types the user has REJECTED
      most. Omit if none."],
    "cadence": "daily | weekly | sporadic — based on event density",
    "other": "optional free-form key-value hints, max 3 keys"
  },
  "baseline_metrics": {
    "approval_rate": 0.0-1.0,
    "active_event_types": 3-8 (count of distinct event_types seen),
    "events_per_week": number,
    "typical_session_events": number (median events in a 1-hour window),
    "days_active_in_period": number,
    "top_event_type": "the event_type with highest count"
  }
}

Rules:
- persona_tags: at least 2, at most 7. If the data genuinely doesn't
  support inferring a pattern, return ["unclassified", "low-signal"]
  with a behavior_summary explaining the data is sparse.
- behavior_summary: never generic. If the user has only 3 events, say
  so explicitly rather than generating filler.
- DO NOT infer domain-specific content (e.g. "works in SaaS") unless
  the event payloads directly support it. Stay with behaviour patterns.
- DO NOT include PII beyond what the events themselves carry.
- All numeric fields in baseline_metrics are grounded in the input
  counts, not guesses.
`;
