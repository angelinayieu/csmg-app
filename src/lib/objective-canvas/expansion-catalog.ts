// ── Expansion Catalog ─────────────────────────────────────────────
//
// The registry of "what children does this node spawn?" — keyed by
// (domain, attach_point_or_node_type). Adding a new domain or a new
// depth layer = adding a CatalogEntry row. The expansion route reads
// this catalog and turns the entry into an LLM prompt + schema.
//
// Why hand-curated, not LLM-generated: catalog entries enforce a
// stable system-design discipline. The user needs to know what
// they'll see when they click [+] on a variation — letting the LLM
// invent the children each time would make depth feel chaotic. The
// LLM fills the BODY of each child; the catalog defines the SHAPE.

import type { ExpansionAttachPoint, ExpansionNodeType } from "./expansion-tree";
import type { DomainSignature } from "./domain-signature";
import type { LayerSlug } from "./context-helpers";

/** A single child the LLM should produce when this catalog entry
 *  fires. The label is what the user sees on the child card; the
 *  body_hint constrains what the LLM puts inside. */
export interface CatalogChildSpec {
  /** Catalog-stable type — used to look up renderers + further spawns. */
  node_type: ExpansionNodeType;
  /** User-readable label that becomes the child's `title`. */
  label: string;
  /** One-line description that goes into the LLM prompt as guidance
   *  for what body shape to fill. */
  body_hint: string;
  /** Optional structured body skeleton — when present, the LLM
   *  schema's `body` becomes a typed object instead of free string. */
  body_schema?: BodySchema;
}

export interface BodySchema {
  /** Top-level keys the body must contain. */
  required: string[];
  /** Brief description per key — guides the LLM. */
  properties: Record<string, { description: string; kind: "string" | "string_array" | "list_of_objects"; item_schema?: { fields: Record<string, string> } }>;
}

/** A single catalog entry — what to spawn when a user clicks [+]
 *  on a specific parent surface in a specific domain.
 *
 *  Triple-keyed by (domain, lane, parent). The lane key was added
 *  because the same parent surface (e.g., "variation") needs
 *  different deepening based on which lane the variation lives in.
 *  A pain variation deepens into root-cause / manifestation / etc;
 *  a feature variation deepens into data-model / telemetry; an
 *  outcome variation deepens into signal-spec / calibration. */
export interface CatalogEntry {
  domain: DomainSignature;
  /** Lane of the parent L1/L2 card — "pain" | "features" | "outcomes"
   *  | "objective". For L4+ entries (parent = a node_type from L3),
   *  this is the lane of the ORIGINAL L1 item the tree descends from. */
  lane: LayerSlug;
  /** When attaching to an L2 surface, parent is the attach_point.
   *  When attaching to a previously-spawned expansion_node, parent
   *  is the node_type of that node. */
  parent: ExpansionAttachPoint | ExpansionNodeType;
  /** Short framing the LLM gets — what kind of thinking to do here. */
  framing: string;
  /** What children to spawn. */
  spawns: CatalogChildSpec[];
}

// ── SOFTWARE / FEATURES — Variation → 5 children (the canonical L3 expansion) ──
// Lane-locked: only fires when the parent variation is on a Feature
// (Mechanism) card. Pain + Outcome variations have their own catalog
// entries below with lane-appropriate children.

const SOFTWARE_FEATURE_VARIATION_EXPANSION: CatalogEntry = {
  domain: "software",
  lane: "features",
  parent: "variation",
  framing:
    "You are deepening a single design-pattern variation into the technical surfaces a top-tier engineering team would write before building. Each child below is a focused depth surface — generate the body for each, anchored on the variation's specific design (not generic best-practice).",
  spawns: [
    {
      node_type: "software.mechanism_story",
      label: "Mechanism story",
      body_hint:
        "Why this variation works mechanistically. 2-3 sentences naming the actual causal chain — what produces the outcome and through what lever.",
      body_schema: {
        required: ["paragraph"],
        properties: {
          paragraph: {
            description:
              "2-3 sentences. Not what it is — WHY it works. Name the lever, the feedback loop, or the structural property that produces the effect.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "software.data_model",
      label: "Data model",
      body_hint:
        "Minimal data shape this variation requires. Entities + key fields + the critical relations between them.",
      body_schema: {
        required: ["entities", "relations_summary"],
        properties: {
          entities: {
            description:
              "2-4 entities. Each: name + 3-6 critical fields with types + 1-line notes for any unusual ones.",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                name: "Entity name in PascalCase.",
                fields:
                  "Pipe-separated list — '<field_name> <TYPE> [nullable] notes'. Example: 'streak_count INT, last_completed_at TIMESTAMP, grace_used BOOL'.",
                notes: "1 sentence on anything unusual or constraint-bearing.",
              },
            },
          },
          relations_summary: {
            description:
              "2-4 lines describing the relations between entities. Foreign keys, cardinality, lifecycle.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "software.edge_cases",
      label: "Edge cases",
      body_hint:
        "3-5 specific failure modes or boundary conditions and how the design handles each.",
      body_schema: {
        required: ["cases"],
        properties: {
          cases: {
            description:
              "3-5 entries. Each: scenario (concrete + specific) + handling (how the design copes — or admit if it doesn't).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                scenario:
                  "Specific failure scenario — not 'invalid input' but 'user resumes after 90 days offline with conflicting local state.'",
                handling:
                  "How the design copes. 1 sentence. If it doesn't, name what would break.",
              },
            },
          },
        },
      },
    },
    {
      node_type: "software.telemetry",
      label: "Telemetry",
      body_hint:
        "What to instrument to know whether this variation is working in production. Events + dashboards + the anti-metric to watch.",
      body_schema: {
        required: ["events", "anti_metric"],
        properties: {
          events: {
            description:
              "2-4 events to fire. Each: event_name + 1-line why (what question it answers).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                event_name: "snake_case event name.",
                why: "1 sentence: what question this answers.",
              },
            },
          },
          anti_metric: {
            description:
              "The single metric whose RISE means this variation is BACKFIRING. 1 sentence. Example: 'streak_break_rage_quits per active user'.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "software.rollback_strategy",
      label: "Rollback strategy",
      body_hint:
        "How to safely yank this variation if it goes wrong. Kill switch + data migration safety + recovery path.",
      body_schema: {
        required: ["kill_switch", "data_safety", "recovery"],
        properties: {
          kill_switch: {
            description:
              "How to disable the variation in production without redeploy. 1 sentence — flag name, gate, etc.",
            kind: "string",
          },
          data_safety: {
            description:
              "What happens to data created under this variation when it's disabled. 1-2 sentences — backfill, soft-delete, orphan.",
            kind: "string",
          },
          recovery: {
            description:
              "If the variation already broke something for a subset of users, the recovery path. 1-2 sentences.",
            kind: "string",
          },
        },
      },
    },
  ],
};

// ── SOFTWARE L4 — Data Model → Field Table / Relations / Migration ──

const SOFTWARE_DATA_MODEL_DETAIL: CatalogEntry = {
  domain: "software",
  lane: "features",
  parent: "software.data_model",
  framing:
    "You are deepening a data-model surface into the concrete artifacts an engineer would write before opening a migration PR.",
  spawns: [
    {
      node_type: "software.field_table",
      label: "Field tables",
      body_hint:
        "Per-entity full field lists with types, nullability, defaults, and notes.",
      body_schema: {
        required: ["tables"],
        properties: {
          tables: {
            description:
              "One per entity from the parent data_model. Each table: name + full field list.",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                name: "Entity name.",
                fields:
                  "JSON array of {field, type, nullable, default, notes}. Stringified.",
              },
            },
          },
        },
      },
    },
    {
      node_type: "software.relations_diagram",
      label: "Relations",
      body_hint:
        "Text-rendered relations diagram + cardinality notes. Mermaid-style allowed.",
      body_schema: {
        required: ["diagram_text"],
        properties: {
          diagram_text: {
            description:
              "Mermaid or plain-text. Lines like 'User 1—* Streak' with brief notes on lifecycle.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "software.migration_path",
      label: "Migration path",
      body_hint:
        "How to evolve the current schema (if any exists) into this one without downtime.",
      body_schema: {
        required: ["steps", "risks"],
        properties: {
          steps: {
            description:
              "Ordered migration steps. 3-6 lines. Each names a phase (e.g. 'add column nullable', 'backfill batch', 'switch reads').",
            kind: "string_array",
          },
          risks: {
            description: "1-3 risks during migration. 1 line each.",
            kind: "string_array",
          },
        },
      },
    },
  ],
};

// ── SOFTWARE — Open Question → experiment / simplest check / adjacent
//
// This DUPLICATES the prototype-brief route's intent at a different
// granularity. Keep separate: the prototype-brief is a full experiment
// design; these are quicker thought-starters the user can browse
// before committing to a full brief.

const SOFTWARE_OPEN_QUESTION_EXPANSION: CatalogEntry = {
  domain: "software",
  lane: "features",
  parent: "open_question",
  framing:
    "You are deepening a single open question into the candidate answers the user could pursue before committing to a full prototype.",
  spawns: [
    {
      node_type: "software.simplest_check",
      label: "Simplest check",
      body_hint:
        "The cheapest possible way to answer this. Often a 1-day desk-research or single-conversation move.",
      body_schema: {
        required: ["check", "duration", "what_it_resolves"],
        properties: {
          check: {
            description:
              "Concrete action. 1-2 sentences. Example: 'message 3 users in your beta about their streak rage-quits in week 2'.",
            kind: "string",
          },
          duration: {
            description: "Realistic time cost. 1 line.",
            kind: "string",
          },
          what_it_resolves: {
            description:
              "Which axis of the question this disambiguates. 1 sentence.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "software.adjacent_evidence",
      label: "Adjacent evidence",
      body_hint:
        "Who has already studied this or shipped a similar mechanism — pointers, not deep summaries.",
      body_schema: {
        required: ["pointers"],
        properties: {
          pointers: {
            description:
              "2-4 entries. Each: source (paper / app / blog / API) + 1-line takeaway.",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                source: "Specific source name.",
                takeaway: "1-sentence takeaway from that source.",
              },
            },
          },
        },
      },
    },
    {
      node_type: "software.disambiguation_decision",
      label: "How to decide",
      body_hint:
        "The criteria the user should apply to PICK an answer when evidence is mixed.",
      body_schema: {
        required: ["criteria", "default_path"],
        properties: {
          criteria: {
            description:
              "2-3 lines naming the most-relevant criteria. Specific to THIS user's constraints.",
            kind: "string_array",
          },
          default_path: {
            description:
              "If forced to pick today, which way the user should lean and why. 1-2 sentences.",
            kind: "string",
          },
        },
      },
    },
  ],
};

// ── SOFTWARE — Conflict (open) → resolution options ──

const SOFTWARE_CONFLICT_OPEN_EXPANSION: CatalogEntry = {
  domain: "software",
  lane: "features",
  parent: "conflict_open",
  framing:
    "You are deepening an unresolved conflict between elected variations into 3 candidate resolution paths.",
  spawns: [
    {
      node_type: "software.resolution_option",
      label: "Resolution options",
      body_hint:
        "3 distinct paths that would resolve this conflict, each with its tradeoff.",
      body_schema: {
        required: ["options"],
        properties: {
          options: {
            description:
              "3 entries. Each: path (1-2 sentences), tradeoff (what you give up), and which-variation-wins (which elected variation dominates under this resolution).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                path: "The resolution approach. 1-2 sentences.",
                tradeoff: "What you give up under this resolution. 1 sentence.",
                which_variation_wins:
                  "Name the variation that effectively wins under this path (or 'compromise' if neither cleanly wins).",
              },
            },
          },
        },
      },
    },
  ],
};

// ── SOFTWARE / PAIN — Variation → 4 lane-specific children ─────────
// Pain variations are "OBSERVABLE SHAPES this pain takes." Deepening
// one means: trace the causal stack below, map where it shows up,
// calibrate when it stops mattering, name the upstream pressures
// producing it. None of these are feature-shaped (no data_model,
// no telemetry, no rollback — pains aren't shipped).

const SOFTWARE_PAIN_VARIATION_EXPANSION: CatalogEntry = {
  domain: "software",
  lane: "pain",
  parent: "variation",
  framing:
    "You are deepening a single OBSERVABLE SHAPE of a pain into the four diagnostic surfaces a strategist would write before deciding whether to attack it. Pains don't ship — so the children below are about UNDERSTANDING and SCOPING the pain, not building anything. Each child is anchored on this specific variation, not the parent pain in general.",
  spawns: [
    {
      node_type: "pain.root_cause_tree",
      label: "Root cause tree",
      body_hint:
        "3-5 levels of 'and what causes that?' going below the surface shape. Each level adds specificity.",
      body_schema: {
        required: ["levels", "load_bearing_root"],
        properties: {
          levels: {
            description:
              "3-5 entries, from shallow to deep. Each: cause (1 sentence) + why_it_matters (1 sentence). Ordered shallowest → deepest.",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                cause:
                  "What causes the level above. 1 sentence — concrete, not generic.",
                why_it_matters:
                  "Why this specific level is load-bearing. 1 sentence.",
              },
            },
          },
          load_bearing_root: {
            description:
              "Which of the deepest causes is the MOST load-bearing — the one that, if you fixed only it, would most reduce the original pain. 1 sentence with reasoning.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "pain.manifestation_map",
      label: "Where it shows up",
      body_hint:
        "3-5 concrete contexts where this specific pain manifestation appears, with severity per context.",
      body_schema: {
        required: ["contexts"],
        properties: {
          contexts: {
            description:
              "3-5 entries. Each: context (specific situation/segment) + severity (low/medium/high) + tell (the signal that lets you detect it in that context).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                context:
                  "Specific situation: 'mobile users on first session', 'enterprise plan after seat #50', etc. Not generic.",
                severity: "low | medium | high",
                tell:
                  "How you'd detect this manifestation in that context. 1 sentence.",
              },
            },
          },
        },
      },
    },
    {
      node_type: "pain.severity_calibration",
      label: "When it stops mattering",
      body_hint:
        "The boundary conditions — who's affected most, what thresholds matter, when this becomes background noise.",
      body_schema: {
        required: ["affected_most", "threshold", "background_condition"],
        properties: {
          affected_most: {
            description:
              "The user segment / scenario for whom this pain is MOST acute. 1-2 sentences.",
            kind: "string",
          },
          threshold: {
            description:
              "The measurable level above which this pain warrants action. Numeric or behavioral, concrete. 1 sentence.",
            kind: "string",
          },
          background_condition: {
            description:
              "The condition under which this pain becomes acceptable / background. 1 sentence. (Helps the team know when to STOP investing.)",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "pain.upstream_inputs",
      label: "Upstream inputs",
      body_hint:
        "The decisions / external pressures producing this pain, and which are within the user's control.",
      body_schema: {
        required: ["inputs"],
        properties: {
          inputs: {
            description:
              "3-5 entries. Each: input (1 sentence — the upstream pressure / decision), controllable ('yes' | 'partial' | 'no'), and intervention (if controllable, 1 sentence on what would change it).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                input:
                  "The upstream pressure or decision producing this pain. Specific, not generic.",
                controllable: "yes | partial | no",
                intervention:
                  "If controllable, what intervention would change it. 1 sentence. Empty when 'no'.",
              },
            },
          },
        },
      },
    },
  ],
};

// ── SOFTWARE / OUTCOMES — Variation → 4 lane-specific children ─────
// Outcome variations are "SENSING / MEASUREMENT patterns." Deepening
// one means: specify exactly what gets measured, audit when the
// signal lies, calibrate what counts as success, name earlier
// indicators that predict it. Not feature-shaped (no data_model,
// no rollback — measurements aren't shipped).

const SOFTWARE_OUTCOME_VARIATION_EXPANSION: CatalogEntry = {
  domain: "software",
  lane: "outcomes",
  parent: "variation",
  framing:
    "You are deepening a single MEASUREMENT PATTERN for an outcome into the four surfaces an analyst would write before trusting it. Outcomes are signals — so the children below are about WHAT to measure, WHEN to mistrust it, WHAT counts as success, and WHAT predicts it earlier. Anchored on this specific measurement variation.",
  spawns: [
    {
      node_type: "outcome.signal_specification",
      label: "Signal spec",
      body_hint:
        "Exactly what gets measured: source, frequency, aggregation, precision.",
      body_schema: {
        required: ["source", "aggregation", "frequency", "precision"],
        properties: {
          source: {
            description:
              "Where the raw data comes from. 1-2 sentences. Specific: 'session_end events from mobile clients' not 'user data'.",
            kind: "string",
          },
          aggregation: {
            description:
              "How raw events become the signal. 1 sentence. Specific: 'median across rolling 7-day window per active user' not 'averaged'.",
            kind: "string",
          },
          frequency: {
            description:
              "How often the signal updates. 1 line — e.g., 'computed nightly', 'real-time stream'.",
            kind: "string",
          },
          precision: {
            description:
              "The smallest unit / minimum sample required for the signal to be trustworthy. 1 sentence.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "outcome.false_positive_audit",
      label: "When the signal lies",
      body_hint:
        "3-4 scenarios where the signal would spike (or fall) WITHOUT the underlying outcome actually moving.",
      body_schema: {
        required: ["scenarios"],
        properties: {
          scenarios: {
            description:
              "3-4 entries. Each: scenario (concrete situation that would skew the signal) + direction ('up' | 'down') + mitigation (1 sentence on how to catch it).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                scenario:
                  "Concrete situation that skews the signal without the underlying outcome moving. Specific: 'bot traffic during a press hit' not 'noise'.",
                direction: "up | down",
                mitigation:
                  "1 sentence: how to detect this is happening (cross-check, segmentation, filter).",
              },
            },
          },
        },
      },
    },
    {
      node_type: "outcome.calibration_baseline",
      label: "What's good?",
      body_hint:
        "Reference values for the signal: current baseline, target, ceiling, confidence interval.",
      body_schema: {
        required: ["baseline", "target", "confidence_interval"],
        properties: {
          baseline: {
            description:
              "Where the signal sits today (best estimate, with units). If unknown, say so explicitly and name the cheapest way to measure baseline. 1-2 sentences.",
            kind: "string",
          },
          target: {
            description:
              "The value above which the outcome counts as 'achieved'. 1 sentence — numeric or behavioral, with justification.",
            kind: "string",
          },
          confidence_interval: {
            description:
              "The range within which natural variation lives — moves inside this band are noise, not signal. 1 sentence.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "outcome.leading_indicators",
      label: "Earlier signals",
      body_hint:
        "2-4 EARLIER metrics that predict this outcome — what to watch this week instead of waiting for the quarterly result.",
      body_schema: {
        required: ["indicators"],
        properties: {
          indicators: {
            description:
              "2-4 entries. Each: indicator (specific earlier signal) + lead_time (how much earlier it appears) + correlation_strength (how reliably it predicts the outcome).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                indicator:
                  "Specific earlier signal — 'day-3 return rate' not 'engagement'. 1 sentence.",
                lead_time:
                  "How much earlier this fires vs the outcome itself. E.g., '4-6 weeks before retention shows', '24 hours before churn'.",
                correlation_strength:
                  "How reliably this predicts the outcome. 'High — historical r ≈ 0.8' or 'Hypothetical — no data yet'. 1 sentence.",
              },
            },
          },
        },
      },
    },
  ],
};

// ── JOURNALING / FEATURES — Variation → 5 practice-shaped children ─
// Journaling "features" are PRACTICE PATTERNS — prompt templates,
// rhythm designs, capture formats. They don't ship and they don't
// have a data model in the software sense. Deepening one means:
// name the lived-experience mechanism, design the daily prompt,
// design the cadence, name how it could quietly fail, and name how
// the user feels it working week-over-week.

const JOURNALING_FEATURE_VARIATION_EXPANSION: CatalogEntry = {
  domain: "journaling",
  lane: "features",
  parent: "variation",
  framing:
    "You are deepening a single journaling PRACTICE PATTERN into the surfaces a thoughtful coach would write before recommending it. Journaling practices aren't software — so the children below are about the lived-experience mechanism, the prompt design, the cadence, the failure modes, and the felt-sense signal. Anchored on this specific variation, not journaling in general.",
  spawns: [
    {
      node_type: "journaling.felt_mechanism",
      label: "Felt mechanism",
      body_hint:
        "Why this practice works internally — what shifts in attention / regulation / cognition during it.",
      body_schema: {
        required: ["paragraph"],
        properties: {
          paragraph: {
            description:
              "2-3 sentences. Not what the practice IS — WHY it works as a lived experience. Name the internal lever (e.g., 'narrative distance from the feeling', 'naming-to-tame', 're-consolidation window').",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "journaling.prompt_template",
      label: "Prompt template",
      body_hint:
        "The exact words / structure the user would write under this practice. 3-6 prompts in sequence.",
      body_schema: {
        required: ["prompts", "opening_grounding"],
        properties: {
          opening_grounding: {
            description:
              "1-2 sentence opening line the user reads before writing — sets the felt-sense frame. Specific, not 'take a deep breath'.",
            kind: "string",
          },
          prompts: {
            description:
              "3-6 ordered prompts the user answers in writing. Each: prompt (the actual question, in the user's voice) + why_this_prompt (1 sentence on what it surfaces).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                prompt:
                  "The literal question. Second-person, specific. 'What did the feeling in your chest want you to do today?' not 'Reflect on emotions.'",
                why_this_prompt:
                  "1 sentence: what this prompt surfaces that the others don't.",
              },
            },
          },
        },
      },
    },
    {
      node_type: "journaling.rhythm_design",
      label: "Rhythm",
      body_hint:
        "When + how often the user does this. Frequency, duration, trigger, environment.",
      body_schema: {
        required: ["frequency", "duration", "trigger", "environment"],
        properties: {
          frequency: {
            description:
              "How often. 1 line. Specific: 'daily, evenings' or '2x/week + after any conflict'.",
            kind: "string",
          },
          duration: {
            description:
              "How long each session. 1 line. Should match the practice's depth — 5min vs 20min vs 'until you feel a shift'.",
            kind: "string",
          },
          trigger: {
            description:
              "What cue starts the session. Habit-anchored — 'after dinner', 'when your shoulders are tight'. 1 sentence.",
            kind: "string",
          },
          environment: {
            description:
              "Physical context that supports this practice. 1 sentence — paper vs phone, alone vs near someone, quiet vs music.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "journaling.failure_modes",
      label: "How it quietly fails",
      body_hint:
        "3-4 ways this practice degrades without the user noticing — performative writing, avoidance, rumination spiral, journaling-about-journaling.",
      body_schema: {
        required: ["failures"],
        properties: {
          failures: {
            description:
              "3-4 entries. Each: failure_mode (specific pattern) + tell (how the user would notice it) + reset (1-sentence repair).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                failure_mode:
                  "Concrete degradation pattern. 'Listing gratitude items without feeling them.' Not 'losing motivation'.",
                tell:
                  "1 sentence: the inner or behavioral signal that this is happening.",
                reset:
                  "1 sentence: how to step out of this without abandoning the practice.",
              },
            },
          },
        },
      },
    },
    {
      node_type: "journaling.felt_sense_signal",
      label: "Felt-sense signal",
      body_hint:
        "How the user knows the practice is working — the bodily / emotional / behavioral marker that this specific practice produces.",
      body_schema: {
        required: ["weekly_signal", "session_signal", "anti_signal"],
        properties: {
          session_signal: {
            description:
              "The shift the user feels DURING or right after a session when it's working. 1-2 sentences, somatic or experiential.",
            kind: "string",
          },
          weekly_signal: {
            description:
              "What's different in the user's week-over-week life when this practice is landing. 1-2 sentences, behavioral.",
            kind: "string",
          },
          anti_signal: {
            description:
              "The feeling/behavior that, if it appears, means this practice is BACKFIRING (e.g., rumination intensifies). 1 sentence.",
            kind: "string",
          },
        },
      },
    },
  ],
};

// ── JOURNALING / PAIN — Variation → 4 diagnostic surfaces ──────────
// Journaling pains are inner blockers / recurring loops. Deepening
// one means: trace the cycle that keeps producing it, map the
// triggers, name what avoidance looks like, identify what already
// briefly interrupts it.

const JOURNALING_PAIN_VARIATION_EXPANSION: CatalogEntry = {
  domain: "journaling",
  lane: "pain",
  parent: "variation",
  framing:
    "You are deepening a single OBSERVABLE SHAPE of an inner blocker into the four diagnostic surfaces a thoughtful therapist would explore before suggesting any practice. These children are about UNDERSTANDING the loop — not fixing it yet. Anchored on this specific manifestation, not the parent pain in general.",
  spawns: [
    {
      node_type: "journaling.recurrence_cycle",
      label: "Recurrence cycle",
      body_hint:
        "The repeating loop — trigger → felt-experience → behavior → consequence → next trigger. 3-5 stages.",
      body_schema: {
        required: ["stages", "load_bearing_stage"],
        properties: {
          stages: {
            description:
              "3-5 stages of the cycle, in order. Each: stage (1 sentence — what happens at this point internally or behaviorally) + why_it_continues (1 sentence on what makes the user flow into the next stage).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                stage:
                  "What happens at this point — specific, felt. 'You re-read the email at 11pm and your chest tightens.' Not 'rumination begins.'",
                why_it_continues:
                  "1 sentence: what makes this stage hand off into the next.",
              },
            },
          },
          load_bearing_stage: {
            description:
              "Which stage of the cycle is most load-bearing — the one that, if interrupted, would most weaken the loop. 1 sentence with reasoning.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "journaling.trigger_pattern",
      label: "Triggers",
      body_hint:
        "3-5 specific situations that activate this blocker, ordered by intensity / frequency.",
      body_schema: {
        required: ["triggers"],
        properties: {
          triggers: {
            description:
              "3-5 entries. Each: trigger (specific situation), frequency (often/sometimes/rare), intensity (low/medium/high), and tell (the somatic or behavioral sign that the trigger fired).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                trigger:
                  "Specific situation. 'Receiving a Slack message after 7pm from your manager.' Not 'work stress.'",
                frequency: "often | sometimes | rare",
                intensity: "low | medium | high",
                tell:
                  "1 sentence: the felt or observable sign the trigger landed.",
              },
            },
          },
        },
      },
    },
    {
      node_type: "journaling.avoidance_path",
      label: "How you avoid feeling it",
      body_hint:
        "3-4 ways the user typically deflects from feeling this directly — productive distraction, intellectualizing, scrolling, etc.",
      body_schema: {
        required: ["avoidances"],
        properties: {
          avoidances: {
            description:
              "3-4 entries. Each: avoidance (specific behavior the user reaches for) + short_term_payoff (what it gives them) + long_term_cost (what the user loses by avoiding the felt experience).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                avoidance:
                  "Specific behavior. 'Opening Twitter for 40 minutes.' 'Suddenly reorganizing your desk.' Not 'distraction.'",
                short_term_payoff:
                  "1 sentence: what relief or function this provides immediately.",
                long_term_cost:
                  "1 sentence: what the user loses by routing around the feeling.",
              },
            },
          },
        },
      },
    },
    {
      node_type: "journaling.brief_interruptions",
      label: "What already briefly works",
      body_hint:
        "2-4 things the user has noticed temporarily interrupt or soften this blocker — partial existing strengths, not full solutions.",
      body_schema: {
        required: ["interruptions"],
        properties: {
          interruptions: {
            description:
              "2-4 entries. Each: interruption (a specific thing that has shifted the state, even briefly) + why_it_works (a 1-sentence guess at the mechanism) + why_it_doesn't_last (the constraint that limits it).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                interruption:
                  "Specific past micro-move. 'Walking around the block before responding.' Not 'self-care.'",
                why_it_works:
                  "1 sentence: best guess at the underlying mechanism.",
                why_it_doesnt_last:
                  "1 sentence: the constraint that keeps this from being the durable answer.",
              },
            },
          },
        },
      },
    },
  ],
};

// ── JOURNALING / OUTCOMES — Variation → 4 felt-evidence surfaces ───
// Journaling outcomes are felt-sense / behavioral signals — not
// metrics. Deepening one means: specify what the felt evidence
// looks like, name when it would be mistaken, calibrate week-over-
// week trajectory, name what shows up earlier (mid-day mood, sleep
// quality, etc.).

const JOURNALING_OUTCOME_VARIATION_EXPANSION: CatalogEntry = {
  domain: "journaling",
  lane: "outcomes",
  parent: "variation",
  framing:
    "You are deepening a single FELT EVIDENCE PATTERN for a journaling outcome into the four surfaces a thoughtful coach would write before trusting it. Felt evidence isn't a metric — it's a somatic / behavioral / relational signal. Anchored on this specific evidence variation.",
  spawns: [
    {
      node_type: "journaling.felt_evidence_spec",
      label: "Felt evidence",
      body_hint:
        "Exactly what the user would notice when this outcome is happening — somatic, behavioral, and relational markers.",
      body_schema: {
        required: ["somatic", "behavioral", "relational"],
        properties: {
          somatic: {
            description:
              "What the user feels in their body when this outcome is moving. 1-2 sentences — specific (e.g., 'shoulders unhitch on Friday evenings'), not 'feel calmer'.",
            kind: "string",
          },
          behavioral: {
            description:
              "What the user does (or stops doing) when this outcome is moving. 1-2 sentences — specific micro-behaviors.",
            kind: "string",
          },
          relational: {
            description:
              "What shifts in how the user shows up with others when this outcome is moving. 1-2 sentences.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "journaling.false_positive_audit",
      label: "When the signal lies",
      body_hint:
        "3-4 ways the user might feel like the outcome is moving when it isn't — performance, dissociation, temporary relief that masks the underlying state.",
      body_schema: {
        required: ["false_positives"],
        properties: {
          false_positives: {
            description:
              "3-4 entries. Each: scenario (the felt experience that mimics the outcome) + tell (how to know it's not the real thing) + check (1 sentence on how to ground-truth).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                scenario:
                  "Specific felt-state that imitates the outcome. 'Manic productivity that feels like clarity.' Not 'fake feeling.'",
                tell:
                  "1 sentence: how to recognize this is the imitation, not the real thing.",
                check:
                  "1 sentence: a small grounding move that tests whether the outcome is actually present.",
              },
            },
          },
        },
      },
    },
    {
      node_type: "journaling.week_to_week_delta",
      label: "Week-over-week trajectory",
      body_hint:
        "What good progress looks like over weeks — baseline this week, what to expect in 2-4 weeks, what 'enough' looks like at 8-12 weeks.",
      body_schema: {
        required: ["this_week", "two_to_four_weeks", "eight_to_twelve_weeks"],
        properties: {
          this_week: {
            description:
              "Realistic baseline for the first week of the practice. 1-2 sentences — name what's likely to feel hard.",
            kind: "string",
          },
          two_to_four_weeks: {
            description:
              "What a credible 2-4 week shift looks like. 1-2 sentences — specific, modest, somatic-or-behavioral.",
            kind: "string",
          },
          eight_to_twelve_weeks: {
            description:
              "The 'enough to keep going' marker at 8-12 weeks. 1-2 sentences — what would tell the user this practice has actually landed.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "journaling.leading_indicators",
      label: "Earlier signals",
      body_hint:
        "2-4 earlier markers that predict this outcome — mid-day mood, sleep quality, response latency in conversations, etc.",
      body_schema: {
        required: ["indicators"],
        properties: {
          indicators: {
            description:
              "2-4 entries. Each: indicator (specific earlier marker, somatic or behavioral) + lead_time (when it appears relative to the outcome) + how_to_notice (1 sentence on the practical noticing move).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                indicator:
                  "Specific earlier marker. 'Falling asleep within 15 minutes.' Not 'better sleep.'",
                lead_time:
                  "How much earlier this appears. 'About 1-2 weeks before the bigger relational shift.'",
                how_to_notice:
                  "1 sentence: the everyday cue the user can attend to without instruments.",
              },
            },
          },
        },
      },
    },
  ],
};

// ── JOURNALING — Open Question → smallest experiment / adjacent
// wisdom / decision rule.
//
// Mirrors the software open-question entry's intent (cheapest move
// before committing), but framed for inner-practice questions. The
// "adjacent_wisdom" surface replaces software's "adjacent_evidence"
// because reflective practice draws on lived wisdom + traditions
// rather than papers + APIs.

const JOURNALING_OPEN_QUESTION_EXPANSION: CatalogEntry = {
  domain: "journaling",
  lane: "features",
  parent: "open_question",
  framing:
    "You are deepening a single open question inside a reflective-practice space into the candidate moves the user could try before committing to a full practice change.",
  spawns: [
    {
      node_type: "journaling.smallest_experiment",
      label: "Smallest experiment",
      body_hint:
        "The cheapest in-life test that would let the user feel the answer — usually one week of one small move.",
      body_schema: {
        required: ["experiment", "duration", "what_it_resolves"],
        properties: {
          experiment: {
            description:
              "Concrete in-life move. 1-2 sentences. Specific: 'For one week, write 3 sentences before opening your phone each morning.' Not 'try journaling.'",
            kind: "string",
          },
          duration: {
            description: "Realistic time horizon. 1 line — usually 1-2 weeks.",
            kind: "string",
          },
          what_it_resolves: {
            description:
              "Which axis of the open question this would disambiguate. 1 sentence — somatic, relational, behavioral, etc.",
            kind: "string",
          },
        },
      },
    },
    {
      node_type: "journaling.adjacent_wisdom",
      label: "Adjacent wisdom",
      body_hint:
        "Who or what tradition has already explored this — a teacher, lineage, book, or framework — pointers, not deep summaries.",
      body_schema: {
        required: ["pointers"],
        properties: {
          pointers: {
            description:
              "2-4 entries. Each: source (teacher / lineage / book / framework name) + takeaway (1-sentence pointer at what they say about this question).",
            kind: "list_of_objects",
            item_schema: {
              fields: {
                source:
                  "Specific source — a person, lineage, or book. Not 'mindfulness research.'",
                takeaway: "1 sentence: the pointer / framing from that source.",
              },
            },
          },
        },
      },
    },
    {
      node_type: "journaling.decision_rule",
      label: "How to decide",
      body_hint:
        "The criteria the user should apply when picking a direction without certainty — usually felt-sense + sustainability + values-fit.",
      body_schema: {
        required: ["criteria", "default_path"],
        properties: {
          criteria: {
            description:
              "2-3 lines naming the most-relevant criteria. Specific to inner work: felt-sense, sustainability, values-fit, relational impact.",
            kind: "string_array",
          },
          default_path: {
            description:
              "If forced to pick today, which way the user should lean and why. 1-2 sentences — framed gently, with permission to revise.",
            kind: "string",
          },
        },
      },
    },
  ],
};

// ── Registry index ─────────────────────────────────────────────────

const CATALOG: CatalogEntry[] = [
  SOFTWARE_FEATURE_VARIATION_EXPANSION,
  SOFTWARE_PAIN_VARIATION_EXPANSION,
  SOFTWARE_OUTCOME_VARIATION_EXPANSION,
  SOFTWARE_DATA_MODEL_DETAIL,
  SOFTWARE_OPEN_QUESTION_EXPANSION,
  SOFTWARE_CONFLICT_OPEN_EXPANSION,
  JOURNALING_FEATURE_VARIATION_EXPANSION,
  JOURNALING_PAIN_VARIATION_EXPANSION,
  JOURNALING_OUTCOME_VARIATION_EXPANSION,
  JOURNALING_OPEN_QUESTION_EXPANSION,
];

/** Look up the catalog entry for a (domain, lane, parent) triple.
 *  Returns null when no entry exists — the UI then hides or
 *  greys-out the [+] button (graceful degradation). The lane key
 *  was added when pain + outcome cards started getting their own
 *  L3 deepening (previously every variation expansion routed to the
 *  feature-shaped catalog entry, which produced nonsense bodies for
 *  pain / outcome variations).
 *
 *  Back-compat note: when lane is omitted (legacy callers), we still
 *  match — but only against entries that don't specify a lane OR
 *  whose lane is "features" (the original default). New callers
 *  should always pass lane. */
/** Arc 2 — generic fallback expansion. The hand-authored CATALOG only
 *  covers software + journaling domains across a few attach points,
 *  so deepening an outcome/result (or any item in an uncovered
 *  domain) hard-failed with "no_catalog_entry" → the UI showed
 *  "Expansion failed". This builds a lane-agnostic 3-child outline
 *  that works for ANY (domain, lane, parent): how it concretely
 *  works, where it could fail, and how you'd know it succeeded. Less
 *  domain-tailored than a bespoke entry, but deepening now always
 *  produces something useful instead of erroring. */
function genericExpansionEntry(
  domain: DomainSignature,
  parent: ExpansionAttachPoint | ExpansionNodeType,
  lane: LayerSlug,
): CatalogEntry {
  return {
    domain,
    lane,
    parent,
    framing:
      "You are deepening this item into the three surfaces anyone would write before acting on it: how it concretely works, where it could fail, and how you'd know it succeeded. Anchor EVERY child to THIS specific item — no generic advice that could apply to anything else.",
    spawns: [
      {
        node_type: "generic.how_it_works",
        label: "How it works",
        body_hint:
          "The concrete mechanism / steps — 3-5 specifics anchored to this item, not abstractions.",
        body_schema: {
          required: ["steps"],
          properties: {
            steps: {
              description:
                "3-5 concrete steps or components that make this item work. Each a short sentence referencing something specific about this item.",
              kind: "string_array",
            },
          },
        },
      },
      {
        node_type: "generic.failure_modes",
        label: "Where it could fail",
        body_hint:
          "2-4 specific ways this item breaks or under-delivers, each with how to catch it early.",
        body_schema: {
          required: ["failures"],
          properties: {
            failures: {
              description:
                "2-4 entries. Each: failure (a concrete way this item fails) + early_signal (1 sentence on how you'd notice before it's too late).",
              kind: "list_of_objects",
            },
          },
        },
      },
      {
        node_type: "generic.success_signal",
        label: "Signal of success",
        body_hint:
          "The single observable that tells you this item is actually working.",
        body_schema: {
          required: ["signal"],
          properties: {
            signal: {
              description:
                "One concrete, observable signal that confirms this item is working. Specific — a number, a behavior, a sensed change — not 'it works'.",
              kind: "string",
            },
          },
        },
      },
    ],
  };
}

export function lookupCatalogEntry(
  domain: DomainSignature,
  parent: ExpansionAttachPoint | ExpansionNodeType,
  lane?: LayerSlug,
): CatalogEntry | null {
  // Lane-specific match first.
  if (lane) {
    const exact = CATALOG.find(
      (e) => e.domain === domain && e.parent === parent && e.lane === lane,
    );
    if (exact) return exact;
    // Arc 2 — no bespoke entry for this (domain, lane, parent); fall
    // back to the generic outline so deepening always works rather
    // than hard-failing with "Expansion failed".
    return genericExpansionEntry(domain, parent, lane);
  }
  // Legacy lookup (no lane provided): match on domain + parent only,
  // breaking ties by preferring "features" (the original behavior).
  return (
    CATALOG.find(
      (e) => e.domain === domain && e.parent === parent && e.lane === "features",
    ) ??
    CATALOG.find((e) => e.domain === domain && e.parent === parent) ??
    genericExpansionEntry(domain, parent, "features")
  );
}

/** Used by the UI to decide whether to show the [+] expand button. */
export function hasExpansion(
  domain: DomainSignature,
  parent: ExpansionAttachPoint | ExpansionNodeType,
  lane?: LayerSlug,
): boolean {
  return lookupCatalogEntry(domain, parent, lane) !== null;
}
