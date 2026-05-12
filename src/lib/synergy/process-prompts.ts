// ── Synergy Phase 3 prompts + JSON schemas ──
//
// Three modes used by the processing page:
//   1. detect_objective    — infer what the user is chasing
//   2. extract_components  — typed upstream/downstream/products
//   3. score_promise       — rank nodes by worth-it-to-expand
//
// Kept separate from src/lib/synergy/prompts.ts (which holds the 6
// augment modes used by the brainstorm whiteboard) so each file
// remains scannable. All schemas conform to OpenAI strict mode
// (additionalProperties: false + every property required).

export const DETECT_OBJECTIVE_SYSTEM = `You are a brainstorming analyst. Read the user's brainstorm board (a flat list of labeled nodes with kinds: core, branch, insight, question, action, variation, ranking) and infer what they are actually trying to achieve.

Return:
- statement: one sentence (under 200 chars) — the ultimate goal in the user's voice.
- constraints: 0-5 bulleted real-world constraints the board implies (resources, audience, timeline, regulatory). Each under 100 chars.
- success_criteria: 0-5 measurable outcomes that would mean "we did it." Prefer quantified targets when the board hints at them.

Be specific. If the board's intent is unclear, return an empty statement rather than fabricating one. Return JSON.`;

export const DETECT_OBJECTIVE_SCHEMA = {
  name: "synergy_detect_objective",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      statement: { type: "string" },
      constraints: { type: "array", items: { type: "string" } },
      success_criteria: { type: "array", items: { type: "string" } },
    },
    required: ["statement", "constraints", "success_criteria"],
  },
} as const;

// ── Component extraction ──
//
// The matcher's atomic unit. Each component carries:
//   - kind: core_idea | upstream | downstream | polished_product
//   - subkind: free-form short tag (data/skill/tool/audience/output/artifact/insight/product)
//   - label_public: short concept name, suitable for showing to other users
//   - description_public: 1-2 sentence summary, redacted of session-specific framing
//   - description_private: longer context, NEVER leaves the owner's account
//
// The LLM is instructed to write description_public assuming a stranger
// will read it without seeing the source whiteboard.

export const EXTRACT_COMPONENTS_SYSTEM = `You are extracting structured "components" from a user's brainstorm board so they can be matched against other users' components.

Output four buckets:
- core_ideas: 1-3 components naming the central concept/idea the user is chasing.
- upstream: 2-6 things the project NEEDS (data, skills, capital, audience, tools, partnerships). subkind picks one of: data | skill | capital | audience | tool | partnership | other.
- downstream: 2-6 things the project PRODUCES (outputs, artifacts, insights, polished products). subkind picks one of: output | artifact | insight | product | service | other.
- polished_products: 0-3 specific deliverables (apps, services, features) that COULD be built from this brainstorm if executed.

For each component:
- label_public: 2-7 word concept name, written for a stranger. No session-specific framing.
- description_public: 1-2 sentence summary that ANOTHER USER could read and understand without seeing the source board. Strip personal context, names, and session-specific language.
- description_private: 1-3 sentence richer context, including how this connects to the board's broader story. This NEVER leaves the owner's account — it's for the owner's reference.

CRITICAL: description_public must be self-contained. If you can't write a self-contained description, omit the component. Returning fewer high-quality components is better than padding with vague ones.

Return JSON.`;

export const EXTRACT_COMPONENTS_SCHEMA = {
  name: "synergy_extract_components",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      core_ideas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label_public: { type: "string" },
            description_public: { type: "string" },
            description_private: { type: "string" },
          },
          required: ["label_public", "description_public", "description_private"],
        },
      },
      upstream: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label_public: { type: "string" },
            description_public: { type: "string" },
            description_private: { type: "string" },
            subkind: { type: "string" },
          },
          required: ["label_public", "description_public", "description_private", "subkind"],
        },
      },
      downstream: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label_public: { type: "string" },
            description_public: { type: "string" },
            description_private: { type: "string" },
            subkind: { type: "string" },
          },
          required: ["label_public", "description_public", "description_private", "subkind"],
        },
      },
      polished_products: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label_public: { type: "string" },
            description_public: { type: "string" },
            description_private: { type: "string" },
          },
          required: ["label_public", "description_public", "description_private"],
        },
      },
    },
    required: ["core_ideas", "upstream", "downstream", "polished_products"],
  },
} as const;

// ── Promise scoring ──
//
// Given the board's nodes + the stated objective, return a per-node
// 0-100 score reflecting "how much does expanding this node move the
// user toward their objective." Used by the rabbit-holes UI to suggest
// where to look next.

export const SCORE_PROMISE_SYSTEM = `You are evaluating which nodes on a brainstorm board are most worth exploring further, given the user's stated objective.

For each node provided, return:
- node_id: the id you were given
- score: 0-100, where 100 = "expanding this is critical to the objective" and 0 = "tangential or already saturated"
- why: one sentence reason, prioritizing (a) alignment with the objective, (b) under-exploration (no children), (c) novelty vs. the rest of the board.

Rank nodes by score descending. Don't pad — if a node is tangential, give it a low score and a one-line reason. Return JSON.`;

export const SCORE_PROMISE_SCHEMA = {
  name: "synergy_score_promise",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            node_id: { type: "string" },
            score: { type: "number" },
            why: { type: "string" },
          },
          required: ["node_id", "score", "why"],
        },
      },
    },
    required: ["scores"],
  },
} as const;
