// ── Active plan + layer ontology loaders ─────────────────────────
//
// Shared helpers for downstream pipeline stages (decompose,
// frame-extractor, etc.) to read the user-approved KG generation
// plan instead of silent defaults. Calls to these are cheap (~1
// query each, hits the active_plan_id index) so each stage can
// load fresh at its entry point without coordination overhead.
//
// Usage:
//   const plan = await loadActivePlan(db, spaceId);
//   const ontology = await loadLayerOntology(db, spaceId);
//   const layerIdMap = buildLayerSlugToIdMap(ontology);
//   ... use plan.axis_proposals to drive your stage's behavior ...
//
// All loaders soft-fail (return null / []). When the plan or
// ontology is missing (legacy spaces or skipPlanGate=true), stages
// fall back to their pre-plan behavior. Existing code paths keep
// working unchanged.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  KgGenerationPlan,
  KgPlanAxisProposal,
} from "@/types/kg-generation-plan";
import type { LayerOntologyRow } from "@/types/layer-ontology";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

// ── Active plan ──────────────────────────────────────────────────

/** Load the currently-approved plan for a space. Returns null when:
 *   - The space has no active_plan_id (pre-planning or legacy space)
 *   - The plan row was deleted (FK on_delete=set_null)
 *   - The query soft-fails (DB hiccup; caller falls back to defaults) */
export async function loadActivePlan(
  db: AnyDb,
  spaceId: string,
): Promise<KgGenerationPlan | null> {
  try {
    const { data: spaceRow } = await db
      .from("spaces")
      .select("active_plan_id")
      .eq("id", spaceId)
      .maybeSingle();
    const activePlanId = (spaceRow as { active_plan_id?: string } | null)
      ?.active_plan_id;
    if (!activePlanId) return null;

    const { data: planRow } = await db
      .from("kg_generation_plans")
      .select("*")
      .eq("id", activePlanId)
      .eq("space_id", spaceId)
      .eq("status", "approved")
      .maybeSingle();
    return (planRow as KgGenerationPlan | null) ?? null;
  } catch (err) {
    console.warn("[active-plan-loader] loadActivePlan soft-failed:", err);
    return null;
  }
}

// ── Layer ontology ───────────────────────────────────────────────

/** Load all layer_ontology rows for a space, ordered by ordinal.
 *  Returns [] when the space has no per-space ontology (legacy
 *  behavior — use the knowledge_layer enum fallback). */
export async function loadLayerOntology(
  db: AnyDb,
  spaceId: string,
): Promise<LayerOntologyRow[]> {
  try {
    const { data } = await db
      .from("layer_ontology")
      .select("*")
      .eq("space_id", spaceId)
      .order("ordinal", { ascending: true });
    return (data as LayerOntologyRow[] | null) ?? [];
  } catch (err) {
    console.warn("[active-plan-loader] loadLayerOntology soft-failed:", err);
    return [];
  }
}

// ── Slug → id map ────────────────────────────────────────────────

/** Build a quick lookup: layer slug → layer_ontology row id. Used by
 *  entity insert paths to set entities.layer_ontology_id when an
 *  entity's layer matches a per-space ontology layer. */
export function buildLayerSlugToIdMap(
  ontology: LayerOntologyRow[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const row of ontology) {
    m.set(row.slug, row.id);
  }
  return m;
}

/** Resolve a single layer slug to a layer_ontology row id. Convenience
 *  for callers that only need one lookup. */
export function resolveLayerOntologyId(
  ontology: LayerOntologyRow[],
  layerSlug: string | null | undefined,
): string | null {
  if (!layerSlug) return null;
  return ontology.find((l) => l.slug === layerSlug)?.id ?? null;
}

// ── Axis guidance for prompts ────────────────────────────────────

/** Build a Markdown block describing the plan's adaptive axes for
 *  injection into LLM system prompts (e.g. decompose). Returns ""
 *  when there's no plan or no axes — caller can simply concat. */
export function formatAxisGuidanceBlock(
  axes: KgPlanAxisProposal[] | undefined | null,
): string {
  if (!axes || axes.length === 0) return "";
  const sections = axes.map((a, i) => {
    const cells = a.target_cells
      .map((c) => `${c.layer_slug}×${c.category}`)
      .join(", ");
    return `${i + 1}. **${a.name}** (slug: \`${a.slug}\`)
   - Definition: ${a.definition}
   - Why this axis: ${a.rationale}
   - Generator strategy: ${a.generator_strategy}
   - Target cells: ${cells || "(unscoped)"}`;
  });
  return [
    "## Active KG generation plan — axes to address",
    "",
    "The user has approved a topic-adaptive plan. Decompose entities + edges that populate these axes specifically. Do NOT default to generic financial/timeline/actors lenses unless one of these axes explicitly calls for it.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

/** Build a Markdown block describing the per-space layer ontology
 *  for prompt injection. Helps the LLM tag entities with the right
 *  layer slug. Returns "" when no ontology exists. */
export function formatLayerOntologyBlock(
  ontology: LayerOntologyRow[],
): string {
  if (ontology.length === 0) return "";
  const layers = ontology.map(
    (l) =>
      `${l.ordinal}. **${l.label}** (slug: \`${l.slug}\`) — ${l.description ?? ""}${
        l.typical_node_kinds.length
          ? `\n   Typical node kinds: ${l.typical_node_kinds.join(", ")}`
          : ""
      }`,
  );
  return [
    "## Active layer ontology",
    "",
    "Tag every entity's `layer` field with the EXACT slug from this ontology (not the legacy enum). Use the layer that best matches what the entity represents.",
    "",
    layers.join("\n"),
  ].join("\n");
}
