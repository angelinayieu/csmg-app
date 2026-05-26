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
 *  on a specific parent surface in a specific domain. */
export interface CatalogEntry {
  domain: DomainSignature;
  /** When attaching to an L2 surface, parent is the attach_point.
   *  When attaching to a previously-spawned expansion_node, parent
   *  is the node_type of that node. */
  parent: ExpansionAttachPoint | ExpansionNodeType;
  /** Short framing the LLM gets — what kind of thinking to do here. */
  framing: string;
  /** What children to spawn. */
  spawns: CatalogChildSpec[];
}

// ── SOFTWARE — Variation → 5 children (the canonical L3 expansion) ──

const SOFTWARE_VARIATION_EXPANSION: CatalogEntry = {
  domain: "software",
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

// ── Registry index ─────────────────────────────────────────────────

const CATALOG: CatalogEntry[] = [
  SOFTWARE_VARIATION_EXPANSION,
  SOFTWARE_DATA_MODEL_DETAIL,
  SOFTWARE_OPEN_QUESTION_EXPANSION,
  SOFTWARE_CONFLICT_OPEN_EXPANSION,
];

/** Look up the catalog entry for a (domain, parent) pair. Returns
 *  null when no entry exists — the UI then hides the [+] button. */
export function lookupCatalogEntry(
  domain: DomainSignature,
  parent: ExpansionAttachPoint | ExpansionNodeType,
): CatalogEntry | null {
  return (
    CATALOG.find((e) => e.domain === domain && e.parent === parent) ?? null
  );
}

/** Used by the UI to decide whether to show the [+] expand button. */
export function hasExpansion(
  domain: DomainSignature,
  parent: ExpansionAttachPoint | ExpansionNodeType,
): boolean {
  return lookupCatalogEntry(domain, parent) !== null;
}
