// ── Generate Expansion Node ───────────────────────────────────────
//
// One LLM call: takes a catalog entry + the parent context + the
// user's constraints + the annotation lens, and produces all the
// children specified by the catalog entry's `spawns` list.
//
// We do ONE call per (parent, catalog entry) rather than N calls per
// child — keeps token cost predictable and lets the model think
// about the children as a coherent set (no duplication, consistent
// granularity).

import { llmJSON } from "@/lib/llm";
import type {
  CatalogChildSpec,
  CatalogEntry,
} from "./expansion-catalog";
import type { ObjectiveAnnotation } from "./generate-annotations";
import type { AnnotationProvenance } from "./layered-generation";
import {
  buildConstraintsBlock,
  type OperationalConstraints,
} from "./constraints";
import type { ExpansionNode } from "./expansion-tree";

/** What the LLM sees about the parent surface. Different attach
 *  points produce different parent blocks — the route shapes this
 *  before calling. */
export interface ParentContext {
  /** Human label rendered into the prompt header. */
  title: string;
  /** Free-form description of the parent. For a variation: the
   *  variation.description + tradeoff. For an open_question: the
   *  question text. For a conflict_open: the conflict text. */
  description: string;
  /** Layer of the item that owns this expansion. */
  itemLayer: "pain" | "features" | "outcomes" | "objective";
  /** Item name + sub-objective + core objective — same domain
   *  grounding the other prompts use. */
  itemName: string;
  subObjectiveTitle: string;
  coreObjectiveText: string;
  /** Optional ancestor lineage when this is L4+ — shown to the LLM
   *  so it doesn't redundantly cover ground already in an ancestor. */
  ancestorLineage?: string[];
}

export interface GenerateExpansionNodeContext {
  catalogEntry: CatalogEntry;
  parent: ParentContext;
  constraints?: OperationalConstraints | null;
  annotations?: ObjectiveAnnotation[];
  /** Closed read loop — top-signal nodes already KEPT on THIS item's
   *  expansion tree, beyond the direct ancestor lineage. The ancestor
   *  block tells the LLM "you came from here"; this block tells the
   *  LLM "you have siblings + cousins on the same card — don't
   *  redundantly cover their ground."
   *
   *  Caller filters `detail.expansion_tree[]` to
   *  `disposition === "kept"`, drops direct ancestors (already in
   *  `parent.ancestorLineage`), and caps to ~6 by depth × recency.
   *  Empty array → block omitted; cold-start cards never inject this.
   *
   *  Soft signal — empty / undefined tolerated. */
  existingTreeSummary?: Array<{
    /** Node title — short, ≤ 80 chars. */
    title: string;
    /** Depth: 3 = L3, 4 = L4, etc. */
    depth: number;
    /** Attach point so the LLM knows what slot this deepened
     *  (variation / open_question / conflict_open / etc.). */
    attach_point: string;
  }>;
  /** Closed read loop — distill themes (cross-room recurring patterns)
   *  the Analysis Workbench has surfaced. Bias new nodes toward
   *  respecting these threads instead of cutting across them.
   *
   *  Same shape as the field in `ExpandItemContext.distillThemes`.
   *  Empty array → no block injected. */
  distillThemes?: Array<{ name: string; description: string }>;
}

/** Output: one child PER spec in the catalog entry's spawns list.
 *  The route persists these as ExpansionNode rows with depth + lineage
 *  derived from the parent. */
export interface GeneratedExpansionChild {
  /** Mirrors the spec's node_type — used by the route to look up the
   *  type and lock the child to a known catalog slot. */
  node_type: string;
  /** Final title for the card — usually mirrors the spec's label
   *  but the LLM can specialize ("Field tables for Streak" rather
   *  than "Field tables"). Capped at 80 chars. */
  title: string;
  /** Body shape matches the spec's body_schema. Free jsonb otherwise. */
  body: Record<string, unknown>;
  /** Optional annotation lens provenance — kept lightweight (≤2). */
  derived_from_annotations?: AnnotationProvenance[];
}

export async function generateExpansionNode(
  ctx: GenerateExpansionNodeContext,
): Promise<GeneratedExpansionChild[]> {
  const { catalogEntry, parent } = ctx;

  // ── Build the lens block (same shape as elsewhere) ──
  const ranked = (ctx.annotations ?? [])
    .slice()
    .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
    .slice(0, 6);
  const lensBlock =
    ranked.length > 0
      ? `\n\nANNOTATION LENS (parent-objective readings — each child may cite 0-2 indices):\n${ranked
          .map((a, i) => {
            const lines = [`  [${i + 1}] "${a.phrase}"`];
            if (a.reading) lines.push(`        reading: ${a.reading}`);
            if (a.fragility?.when)
              lines.push(`        fragility: when ${a.fragility.when}`);
            return lines.join("\n");
          })
          .join("\n")}`
      : "";
  const hasLens = ranked.length > 0;

  const constraintsBlock = buildConstraintsBlock(ctx.constraints ?? null);

  // ── Build the children spec block — each child appears with its
  //    node_type + label + body_hint + optional body_schema ──
  const childrenSpecBlock = catalogEntry.spawns
    .map((s, i) => formatChildSpec(s, i + 1))
    .join("\n\n");

  const ancestorBlock =
    parent.ancestorLineage && parent.ancestorLineage.length > 0
      ? `\n\nANCESTOR PATH (do not re-cover ground already in these):\n  ${parent.ancestorLineage.join(" › ")}`
      : "";

  // Existing-deepenings block — top siblings + cousins on this item.
  // Sort by depth ASC (L3 first, then L4, …) so the LLM sees the
  // broadest deepenings first. Cap at 6 to bound token cost.
  const siblings = ctx.existingTreeSummary ?? [];
  const existingDeepeningsBlock =
    siblings.length > 0
      ? `\n\nEXISTING DEEPENINGS ON THIS ITEM (already explored on sibling / cousin slots — don't redundantly cover the same ground):\n${[
          ...siblings,
        ]
          .sort((a, b) => a.depth - b.depth)
          .slice(0, 6)
          .map(
            (n) =>
              `  [L${n.depth} · ${n.attach_point}] ${n.title.slice(0, 80)}`,
          )
          .join(
            "\n",
          )}\n  SIBLING RULE: When a child you'd otherwise emit overlaps with one above, EITHER (a) re-frame it to cover ground these don't, OR (b) explicitly compose with them (your child depends on or extends the existing node — say so in the body). Do not silently duplicate.`
      : "";

  // Distilled themes block — cross-room recurring patterns the user
  // keeps electing toward. Bias new children to respect (not violate)
  // these threads.
  const themes = ctx.distillThemes ?? [];
  const distillThemesBlock =
    themes.length > 0
      ? `\n\nDISTILLED THEMES (recurring across this user's rooms — children should RESPECT these, not cut across them):\n${themes
          .slice(0, 4)
          .map((t) => `  • "${t.name}" — ${t.description.slice(0, 160)}`)
          .join(
            "\n",
          )}\n  When a candidate child contradicts an established theme, either drop it or name the tension explicitly in the child's body so the user sees what they'd be giving up.`
      : "";

  const system = `You expand a single parent surface into the structured children defined below. Each child is a focused depth artifact — generate the body for each, anchored on THIS parent (not generic best-practice).

FRAMING: ${catalogEntry.framing}

OUTPUT: an array of children, one per CHILD SPEC below, IN THE SAME ORDER. For each:
  • node_type — exactly the slot id from the spec (do not invent)
  • title — usually the spec's label, optionally specialized to this parent (≤80 chars)
  • body — a JSON OBJECT, SERIALIZED TO A STRING (valid JSON), with the keys per the spec's body_hint / schema. e.g. body: "{\\"how_it_works\\": [\\"step one\\", \\"step two\\"]}". Always a parseable JSON string, never a bare object.
  • derived_from_annotations — when this child draws on a specific annotation, 0-2 entries of { index, facet: "fragility" | "analogy" | "tension" | "dimension" | "inference" | "reading" }. Omit when ambient.

ANTI-PLATITUDE: every child must reference something specific about the parent's design / question / conflict — generic strategy filler is forbidden.

CHILD SPECS:
${childrenSpecBlock}

Return strict JSON.`;

  const user = `PARENT (${parent.itemLayer}): ${parent.itemName}\nSUB-OBJECTIVE: ${parent.subObjectiveTitle}\nCORE OBJECTIVE: ${parent.coreObjectiveText.slice(0, 600)}\n\nPARENT SURFACE TO EXPAND:\n  title: ${parent.title}\n  description: ${parent.description}${ancestorBlock}${existingDeepeningsBlock}${distillThemesBlock}${constraintsBlock}${lensBlock}\n\nGenerate the children per the system instructions.`;

  // ── Schema — strict mode, every spec child must appear. ──
  const childItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      node_type: { type: "string" },
      title: { type: "string" },
      // body is free-form (its shape varies per node_type), and OpenAI
      // strict structured outputs forbid `additionalProperties: true` on
      // objects. So we transport it as a JSON STRING the model fills,
      // then JSON.parse it in cleanup (parseBody). This is the standard
      // strict-mode workaround for a variable-shape object.
      body: { type: "string" },
      ...(hasLens
        ? {
            derived_from_annotations: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  index: { type: "number" },
                  facet: {
                    type: "string",
                    enum: [
                      "fragility",
                      "analogy",
                      "tension",
                      "dimension",
                      "inference",
                      "reading",
                    ],
                  },
                },
                required: ["index", "facet"],
              },
            },
          }
        : {}),
    },
    required: hasLens
      ? ["node_type", "title", "body", "derived_from_annotations"]
      : ["node_type", "title", "body"],
  };

  const raw = await llmJSON<{
    children?: Array<{
      node_type?: unknown;
      title?: unknown;
      body?: unknown;
      derived_from_annotations?: unknown;
    }>;
  }>({
    system,
    user,
    responseSchema: {
      name: "expansion_children",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          children: { type: "array", items: childItem },
        },
        required: ["children"],
      },
    },
    temperature: 0.4,
    maxTokens: 2200,
  });

  // ── Clean + lock to the spec set. Drop any child whose node_type
  //    doesn't match a spec (LLM hallucinated); fill missing children
  //    with empty-body fallbacks so the UI doesn't crash. ──
  const specByType = new Map(
    catalogEntry.spawns.map((s) => [s.node_type, s]),
  );
  const seen = new Set<string>();
  const out: GeneratedExpansionChild[] = [];

  for (const c of raw?.children ?? []) {
    const nodeType =
      typeof c?.node_type === "string" ? c.node_type.trim() : "";
    const spec = specByType.get(nodeType);
    if (!spec || seen.has(nodeType)) continue;
    seen.add(nodeType);
    out.push({
      node_type: nodeType,
      title:
        typeof c?.title === "string" && c.title.trim().length > 0
          ? c.title.trim().slice(0, 80)
          : spec.label,
      body: parseBody(c?.body),
      derived_from_annotations: cleanProv(
        c?.derived_from_annotations,
        ranked,
      ),
    });
  }
  // Fill missing spec children so the L3 surface always renders the
  // promised set — even when the LLM dropped one.
  for (const spec of catalogEntry.spawns) {
    if (seen.has(spec.node_type)) continue;
    out.push({
      node_type: spec.node_type,
      title: spec.label,
      body: {},
    });
  }

  return out;
}

function formatChildSpec(spec: CatalogChildSpec, ordinal: number): string {
  const lines: string[] = [
    `[${ordinal}] node_type: "${spec.node_type}"`,
    `    label: ${spec.label}`,
    `    body_hint: ${spec.body_hint}`,
  ];
  if (spec.body_schema) {
    lines.push(`    body keys:`);
    for (const [key, val] of Object.entries(spec.body_schema.properties)) {
      const kindNote =
        val.kind === "list_of_objects"
          ? " (array of objects)"
          : val.kind === "string_array"
            ? " (array of strings)"
            : "";
      lines.push(`      - ${key}${kindNote}: ${val.description}`);
      if (val.item_schema?.fields) {
        for (const [sub, subDesc] of Object.entries(val.item_schema.fields)) {
          lines.push(`        · ${sub}: ${subDesc}`);
        }
      }
    }
  }
  return lines.join("\n");
}

function cleanProv(
  raw: unknown,
  lens: ObjectiveAnnotation[],
): AnnotationProvenance[] | undefined {
  if (lens.length === 0) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const out: AnnotationProvenance[] = [];
  const seen = new Set<number>();
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const index =
      typeof r.index === "number" && Number.isFinite(r.index)
        ? Math.floor(r.index)
        : NaN;
    if (!Number.isFinite(index) || index < 1) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    const ann = lens[index - 1];
    if (!ann) continue;
    const facet =
      typeof r.facet === "string"
        ? (r.facet as AnnotationProvenance["facet"])
        : "reading";
    out.push({ index, phrase: ann.phrase, facet });
    if (out.length >= 2) break;
  }
  return out;
}

/** Parse the model's `body` field, which is now transported as a JSON
 *  STRING (strict-mode workaround for a variable-shape object). Accepts
 *  a real object too (lenient / back-compat). Falls back to {} on
 *  garbage, or wraps an unparseable non-empty string under `text` so
 *  the content isn't silently lost. */
function parseBody(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { text: raw.trim().slice(0, 2000) };
    }
  }
  return {};
}

/** Convenience: convert generated children into ExpansionNode rows
 *  ready for tree-append. The route owns id + depth + lineage so we
 *  don't pass those concerns into the LLM layer. */
export function asExpansionNodes(
  children: GeneratedExpansionChild[],
  build: (
    child: GeneratedExpansionChild,
    ordinal: number,
  ) => Pick<
    ExpansionNode,
    "id" | "parent_node_id" | "depth" | "lineage_titles" | "attach_point" | "attach_ref"
  >,
): ExpansionNode[] {
  const now = new Date().toISOString();
  return children.map((c, i) => {
    const meta = build(c, i);
    return {
      ...meta,
      node_type: c.node_type,
      title: c.title,
      body: c.body,
      source: "ai_auto" as const,
      disposition: null,
      derived_from_annotations: c.derived_from_annotations,
      generated_at: now,
    };
  });
}
