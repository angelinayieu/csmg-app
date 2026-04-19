// ── Template: Journal for Self-Discovery ──
//
// Exemplar template. Seeds a space with life-area systems + core value /
// tension domains, frames decomposition toward self-understanding (values,
// emotions, tensions, flow states), provides a question library that asks
// questions designed to get beneath surface narratives, and defines
// synthesis as "what's the one tension that if resolved would most move
// your life forward."

import type { UseCaseTemplate } from "@/types/use-case";

export const journalSelfDiscoveryTemplate: UseCaseTemplate = {
  id: "journal_self_discovery",
  name: "Self-Discovery Journal",
  tagline: "Daily journaling that asks better questions over time",
  description:
    "Write about your life each day; the system extracts the values, tensions, emotions, and flow activities that matter, " +
    "weaves them into a living graph of who you are, and surfaces patterns you wouldn't catch alone. " +
    "Each entry becomes structured memory. Every week, the synthesis shows you the one load-bearing tension to resolve next.",

  icon: "BookOpen",
  accent_color: "#d97706",
  accent_color_light: "#fef3c7",

  category: "personal",
  context_type: "strategy",

  default_surface: "journal",
  unlocked_surfaces: ["journal", "whiteboard_overview"],

  default_space_name: "My self-discovery journal",
  default_description:
    "A living record of values, tensions, and flow states — updated with each entry.",

  // ── Seed entities ──
  // Life-areas at the system level (L0), values at the domain level (L1),
  // and the four "primitives" (tension, flow, drain, value) as threads (L2).
  // User's entries will augment these + create new ones.

  seed_entities: [
    // ── Systems (life areas) ──
    {
      seed_id: "LA_work",
      name: "Work & Craft",
      description:
        "Your professional life, vocation, and relationship to the work itself. Includes what you do, how you do it, and why.",
      entity_category: "abstract",
      entity_type: "life_area",
      layer: "system",
      importance: "fundamental",
    },
    {
      seed_id: "LA_relationships",
      name: "Relationships",
      description:
        "Close relationships in your life: partner, family, close friends. Includes the dynamics and tensions within them.",
      entity_category: "relational",
      entity_type: "life_area",
      layer: "system",
      importance: "fundamental",
    },
    {
      seed_id: "LA_health",
      name: "Body & Health",
      description:
        "Physical and mental health. Sleep, movement, energy, nutrition, mental state.",
      entity_category: "concrete",
      entity_type: "life_area",
      layer: "system",
      importance: "critical",
    },
    {
      seed_id: "LA_growth",
      name: "Growth & Learning",
      description:
        "What you're learning, studying, or trying to become better at. Includes skills, reading, and reflection.",
      entity_category: "process",
      entity_type: "life_area",
      layer: "system",
      importance: "important",
    },
    {
      seed_id: "LA_identity",
      name: "Identity & Meaning",
      description:
        "Who you understand yourself to be. Beliefs, values, purpose, spirituality, the big questions.",
      entity_category: "epistemic",
      entity_type: "life_area",
      layer: "system",
      importance: "fundamental",
    },
    // ── Domains (value anchors) ──
    {
      seed_id: "V_autonomy",
      name: "Autonomy",
      description:
        "The degree to which you direct your own decisions, time, and energy. High when you act from choice; low when you act from obligation.",
      entity_category: "abstract",
      entity_type: "value",
      layer: "domain",
      importance: "important",
    },
    {
      seed_id: "V_belonging",
      name: "Belonging",
      description:
        "Feeling seen, accepted, and connected in your relationships and community.",
      entity_category: "abstract",
      entity_type: "value",
      layer: "domain",
      importance: "important",
    },
    {
      seed_id: "V_mastery",
      name: "Mastery",
      description:
        "Skill in something you care about; the satisfaction of getting better at things that matter to you.",
      entity_category: "abstract",
      entity_type: "value",
      layer: "domain",
      importance: "important",
    },
    {
      seed_id: "V_meaning",
      name: "Meaning",
      description:
        "Sense that what you do matters — either to others, to a bigger project, or to your own story.",
      entity_category: "abstract",
      entity_type: "value",
      layer: "domain",
      importance: "important",
    },
  ],

  seed_edges: [
    // Life areas commonly relate to each other — start with the strongest
    // links so the user sees a connected graph rather than islands.
    { source_seed_id: "LA_work", target_seed_id: "LA_identity", relationship_type: "contributes_to", dimension: "causal" },
    { source_seed_id: "LA_relationships", target_seed_id: "LA_health", relationship_type: "contributes_to", dimension: "causal" },
    { source_seed_id: "LA_health", target_seed_id: "LA_work", relationship_type: "enables", dimension: "functional" },
    { source_seed_id: "LA_growth", target_seed_id: "LA_identity", relationship_type: "contributes_to", dimension: "causal" },
    // Values anchor to the life areas they're most relevant to
    { source_seed_id: "V_autonomy", target_seed_id: "LA_work", relationship_type: "relates_to", dimension: "logical" },
    { source_seed_id: "V_belonging", target_seed_id: "LA_relationships", relationship_type: "relates_to", dimension: "logical" },
    { source_seed_id: "V_mastery", target_seed_id: "LA_growth", relationship_type: "relates_to", dimension: "logical" },
    { source_seed_id: "V_meaning", target_seed_id: "LA_identity", relationship_type: "relates_to", dimension: "logical" },
  ],

  // ── Decomposition frame ──

  decomposition_frame: {
    system_prefix: `## LENS: Self-Discovery Journaling

You are analyzing a journal entry written by someone exploring their own life, values, and fulfillment. Your job is to extract structural material that helps them see themselves more clearly — not to summarize.

Prioritize extracting:

1. VALUES SURFACED — what does this entry show the writer cares about? Be specific: not "freedom" but "autonomy in how I structure my mornings". Values are named by the writer's behavior, not by their declarations.

2. TENSIONS — contradictions or frictions the entry reveals. "I say I want rest but I took three meetings on Saturday" is a tension. "Money vs. meaning" is a lazy tension; "the job I trained 8 years for uses 20% of what I love" is a real one.

3. EMOTIONS as signals — not as facts. An emotion named repeatedly is telling you what system is activated. Flag specific + grounded emotional signals.

4. FLOW ACTIVITIES — things the writer did that produced energy / engagement / a sense of rightness.

5. DRAIN ACTIVITIES — things that depleted them beyond what the task warranted.

6. RELATIONAL DYNAMICS — specific patterns of interaction, not abstract "family stuff".

7. STORIES they're telling themselves — beliefs about how the world works that may or may not be true. "I have to be the responsible one" is a story. "I am the only one who can fix this" is a story.

## Rules

- NEVER extract generic categories (e.g., "work stress") — require specificity
- An entity named once is a signal; named three times is a pattern; named in contradiction with another entity is a fault
- Default importance is "moderate". Only mark "critical" or "fundamental" when the entry shows this is structurally load-bearing for the writer's life
- If the writer names a TENSION, create it as an entity with entity_category="relational"
- If the writer shows a contradiction between stated-value and actual-behavior, mark it as entity_category="fault" — these are the most useful extractions`,
    preferred_entity_categories: ["relational", "abstract", "process", "epistemic"],
    preferred_entity_types: [
      "value",
      "tension",
      "emotion_signal",
      "flow_activity",
      "drain_activity",
      "relational_dynamic",
      "story_belief",
      "life_area",
    ],
  },

  // ── Synthesis frame ──

  synthesis_frame: {
    fulcrum_definition:
      "The single unresolved tension whose resolution would most change the writer's life. Not their biggest problem — the one that, if addressed, would unlock downstream movement across multiple life areas.",
    outcome_criterion:
      "A named, specific next action the writer can take this week to test their hypothesis about the tension. Concrete enough to do tomorrow.",
    narrative_hint:
      "Speak to the writer directly, in second person. Be honest. Name what their entries show without flattery. Reference specific entries or patterns rather than generic advice.",
  },

  // ── Question library ──

  question_library: [
    // ── Openers ──
    {
      id: "opener_standout",
      kind: "opener",
      text: "What stood out today — any moment that felt bigger than it should have?",
    },
    {
      id: "opener_drained",
      kind: "opener",
      text: "What drained you today, and was it the thing itself or something about how you did it?",
    },
    {
      id: "opener_avoid",
      kind: "opener",
      text: "What did you avoid today? What were you choosing instead?",
    },
    {
      id: "opener_surprise",
      kind: "opener",
      text: "What surprised you today — about yourself, someone else, or what you noticed?",
    },

    // ── Deepeners ──
    {
      id: "deepener_should",
      kind: "deepener",
      text: "You used the word 'should' — whose expectation is that?",
      applicable_when: { mentions_text_fragment: ["should", "need to", "have to"] },
    },
    {
      id: "deepener_always",
      kind: "deepener",
      text: "You said 'always' / 'never' — is that actually true, or is it how you feel about it right now?",
      applicable_when: { mentions_text_fragment: ["always", "never"] },
    },
    {
      id: "deepener_then_what",
      kind: "deepener",
      text: "If that turned out to be true, then what?",
    },

    // ── Tension probers ──
    {
      id: "tension_value_vs_action",
      kind: "tension_prober",
      text: "You wrote that you value X, and this week you did Y that contradicts it. Which is the real signal — what you say or what you do?",
      applicable_when: { requires_fault_detected: true },
    },
    {
      id: "tension_tradeoff",
      kind: "tension_prober",
      text: "What would you have to give up to have more of what you're wanting?",
    },

    // ── Pattern probes ──
    {
      id: "pattern_recurring",
      kind: "pattern_probe",
      text: "This is the {{N}}th time {{topic}} has come up. What's still unresolved about it?",
      applicable_when: { min_entries: 3 },
    },
    {
      id: "pattern_flow",
      kind: "pattern_probe",
      text: "Your entries show you feel most alive when {{flow_activity}} happens. What's stopping more of that?",
      applicable_when: { min_entries: 4 },
    },

    // ── Values checks ──
    {
      id: "values_where_time",
      kind: "values_check",
      text: "Where did your time go this week? Does that match what you say matters?",
      applicable_when: { min_entries: 5 },
    },
    {
      id: "values_say_vs_pay",
      kind: "values_check",
      text: "What are you currently paying (time, money, attention) for that you don't actually value?",
    },

    // ── Future scope ──
    {
      id: "future_if_resolved",
      kind: "future_scope",
      text: "If your biggest current tension were resolved six months from now, what would your daily life look like?",
    },
    {
      id: "future_first_move",
      kind: "future_scope",
      text: "What's the smallest thing you could do tomorrow to test whether your hypothesis about this tension is correct?",
    },
  ],
};
