// ── Use-Case Library (registry) ──
//
// Central registry of all available templates. Importing from here rather
// than from individual template files lets callers enumerate everything,
// look up by ID, or filter by category. Adding a new template = adding it
// to the imports and the TEMPLATES map.

import { journalSelfDiscoveryTemplate } from "./templates/journal-self-discovery";
import {
  startupStrategyTemplate,
  researchProjectTemplate,
  careerPivotTemplate,
  readingSynthesisTemplate,
  relationshipDynamicsTemplate,
  teamRetroTemplate,
} from "./templates/other-templates";
import type { UseCaseId, UseCaseTemplate } from "@/types/use-case";

export const TEMPLATES: Record<UseCaseId, UseCaseTemplate> = {
  journal_self_discovery: journalSelfDiscoveryTemplate,
  startup_strategy: startupStrategyTemplate,
  research_project: researchProjectTemplate,
  career_pivot: careerPivotTemplate,
  reading_synthesis: readingSynthesisTemplate,
  relationship_dynamics: relationshipDynamicsTemplate,
  team_retro: teamRetroTemplate,
};

export const TEMPLATE_LIST: UseCaseTemplate[] = Object.values(TEMPLATES);

export function getTemplate(id: UseCaseId | string): UseCaseTemplate | null {
  return TEMPLATES[id as UseCaseId] ?? null;
}

export function getTemplatesByCategory(category: UseCaseTemplate["category"]): UseCaseTemplate[] {
  return TEMPLATE_LIST.filter((t) => t.category === category);
}

export function findQuestionsByKind(
  template: UseCaseTemplate,
  kind: UseCaseTemplate["question_library"][number]["kind"],
): UseCaseTemplate["question_library"] {
  return template.question_library.filter((q) => q.kind === kind);
}
