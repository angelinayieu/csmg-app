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

// ── Registry index ─────────────────────────────────────────────────

const CATALOG: CatalogEntry[] = [
  SOFTWARE_FEATURE_VARIATION_EXPANSION,
  SOFTWARE_PAIN_VARIATION_EXPANSION,
  SOFTWARE_OUTCOME_VARIATION_EXPANSION,
  SOFTWARE_DATA_MODEL_DETAIL,
  SOFTWARE_OPEN_QUESTION_EXPANSION,
  SOFTWARE_CONFLICT_OPEN_EXPANSION,
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
    return null;
  }
  // Legacy lookup (no lane provided): match on domain + parent only,
  // breaking ties by preferring "features" (the original behavior).
  return (
    CATALOG.find(
      (e) => e.domain === domain && e.parent === parent && e.lane === "features",
    ) ??
    CATALOG.find((e) => e.domain === domain && e.parent === parent) ??
    null
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
