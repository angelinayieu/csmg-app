// ── Lens resolver ──
//
// Given a detected lens id (from the intelligence router) OR a use-case
// template id (from the space), resolve to the decomposition frame — the
// piece of prompt text that gets prepended to downstream decomposition
// prompts to bias extraction toward the domain.
//
// This is the mechanism that lets the agent work without the user picking a
// template: the router detects a likely lens, and downstream extraction
// picks up the same domain-specific framing automatically.

import { getTemplate } from "./library";
import type { UseCaseId, UseCaseTemplate } from "@/types/use-case";
import type { SuggestedLens } from "@/types/intelligence-router";

// ── Resolvers ──

/**
 * Resolve a detected router lens ("journal_self_discovery" etc.) to its
 * template. Returns null for "none" or unrecognized ids.
 */
export function resolveLensToTemplate(lens: SuggestedLens | string | null | undefined): UseCaseTemplate | null {
  if (!lens || lens === "none") return null;
  return getTemplate(lens as UseCaseId);
}

/**
 * Get the prompt addendum text for a lens. Safe to call even if lens is
 * unrecognized — returns null in that case, which callers interpret as
 * "use default decomposition prompt only".
 */
export function getLensAddendum(lens: SuggestedLens | string | null | undefined): string | null {
  const template = resolveLensToTemplate(lens);
  if (!template) return null;
  return template.decomposition_frame.system_prefix;
}

/**
 * Compose a system prompt with a lens addendum. The addendum goes BEFORE the
 * base prompt so domain framing is established first; base prompt still
 * carries the structural rules (format, categories, etc.).
 *
 * If no lens is active, returns the base prompt unchanged.
 */
export function applyLensToPrompt(basePrompt: string, lens: SuggestedLens | string | null | undefined): string {
  const addendum = getLensAddendum(lens);
  if (!addendum) return basePrompt;
  return `${addendum}\n\n---\n\n${basePrompt}`;
}

// ── Template-id direct lookup ──

/**
 * When a space has a use_case_template_id, this looks up the template and
 * returns its decomposition frame addendum. Convenience wrapper — same as
 * resolveLensToTemplate but named for the template-source origin.
 */
export function getTemplateAddendum(templateId: string | null | undefined): string | null {
  return getLensAddendum(templateId);
}

// ── Preferred entity-category hint ──

/**
 * Returns the set of preferred categories a lens wants to surface. Prompts
 * can use this to bias extraction (e.g. "especially look for relational and
 * epistemic entities"). Returns null if no lens active.
 */
export function getLensPreferredCategories(
  lens: SuggestedLens | string | null | undefined,
): UseCaseTemplate["decomposition_frame"]["preferred_entity_categories"] | null {
  const template = resolveLensToTemplate(lens);
  if (!template) return null;
  return template.decomposition_frame.preferred_entity_categories;
}

/**
 * Returns the preferred entity_type vocabulary for a lens (e.g., for
 * journaling: ["value", "tension", "emotion_signal", ...]). Useful when the
 * prompt should enumerate domain-specific type examples.
 */
export function getLensPreferredTypes(
  lens: SuggestedLens | string | null | undefined,
): string[] | null {
  const template = resolveLensToTemplate(lens);
  if (!template) return null;
  return template.decomposition_frame.preferred_entity_types;
}
