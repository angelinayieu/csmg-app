// ── Tech-spec section addressing ─────────────────────────────────────
//
// The structured TechSpec already has named fields (overview, problem,
// architecture, …). For inline-on-the-board selection / per-section refine /
// pending-improvements, we just use those field keys as stable section IDs.
// No fragile markdown parsing, no separate ID scheme. The single source of
// truth for which sections exist + how to render-extract them + how to
// re-inject refined content back into the spec.

import type {
  TechSpec,
  TechSpecArchitecture,
  TechSpecDataEntity,
  TechSpecFeature,
  TechSpecBuildPhase,
  TechSpecUiPlan,
} from "./types";

export type TechSpecSectionId =
  | "overview"
  | "problem"
  | "target_users"
  | "goals"
  | "success_metrics"
  | "non_goals"
  | "architecture"
  | "data_model"
  | "integrations"
  | "features"
  | "build_phases"
  | "risks"
  | "open_questions"
  | "ui_plan";

export const SECTION_IDS: TechSpecSectionId[] = [
  "overview",
  "problem",
  "target_users",
  "goals",
  "success_metrics",
  "non_goals",
  "architecture",
  "data_model",
  "integrations",
  "features",
  "build_phases",
  "risks",
  "open_questions",
  "ui_plan",
];

/** Human label shown in the card heading + on result-card eyebrows. */
export const SECTION_LABEL: Record<TechSpecSectionId, string> = {
  overview: "Overview",
  problem: "Problem",
  target_users: "Target users",
  goals: "Goals",
  success_metrics: "Success metrics",
  non_goals: "Non-goals",
  architecture: "Architecture",
  data_model: "Data model",
  integrations: "Integrations",
  features: "Features",
  build_phases: "Build phases",
  risks: "Risks",
  open_questions: "Open questions",
  ui_plan: "UI plan",
};

/** Per-section runtime meta tracked in the tech-spec card props. */
export interface SectionMeta {
  /** Past versions of the section's content (oldest → newest). The CURRENT
   *  value lives in the spec itself; this is the rollback log. Capped to 5. */
  versions: Array<{ value: unknown; createdAt: number }>;
  /** Pending improvements queued by Improve ops + attached cards.
   *  Drained on refine. */
  pending: Array<{
    source: "inline_improve" | "card";
    content: string;
    cardId?: string;
    addedAt: number;
  }>;
  /** When the section last got refined (drives the diff-flash). */
  lastRefinedAt?: number;
}

export type SectionMetaMap = Partial<Record<TechSpecSectionId, SectionMeta>>;

/** Empty section meta — used when first queueing a pending improvement. */
export function emptySectionMeta(): SectionMeta {
  return { versions: [], pending: [] };
}

/** Read the JSON-stringified sectionMeta prop into a typed map. Safe on
 *  bad/empty input (returns {}). */
export function parseSectionMeta(json: string | undefined): SectionMetaMap {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as SectionMetaMap;
  } catch {
    return {};
  }
}

export function serializeSectionMeta(map: SectionMetaMap): string {
  return JSON.stringify(map);
}

/** Extract a section's current value from the spec. The return type is
 *  intentionally `unknown` — callers cast based on the section kind, but
 *  we don't want to leak section-specific types into generic helpers. */
export function getSectionValue(
  spec: TechSpec,
  id: TechSpecSectionId,
): unknown {
  return (spec as unknown as Record<string, unknown>)[id];
}

/** Replace one section in the spec, returning a new spec object. Does NOT
 *  mutate. */
export function setSectionValue(
  spec: TechSpec,
  id: TechSpecSectionId,
  value: unknown,
): TechSpec {
  return {
    ...spec,
    [id]: value,
  } as TechSpec;
}

/** Render a section's current value as plain text for the prompt + the
 *  expanded card body. Keeps formatting predictable across section kinds. */
export function sectionToText(spec: TechSpec, id: TechSpecSectionId): string {
  const v = getSectionValue(spec, id);
  switch (id) {
    case "overview":
    case "problem":
      return typeof v === "string" ? v : "";
    case "target_users":
    case "goals":
    case "success_metrics":
    case "non_goals":
    case "integrations":
    case "risks":
    case "open_questions":
      return Array.isArray(v) ? v.map(String).filter(Boolean).join("\n• ") : "";
    case "architecture": {
      const a = v as TechSpecArchitecture | undefined;
      if (!a) return "";
      const parts: string[] = [];
      if (a.summary) parts.push(a.summary);
      if (a.layers?.length) parts.push(`Layers: ${a.layers.join(" → ")}`);
      if (a.components?.length) {
        parts.push(
          a.components
            .map((c) => `• ${c.name} — ${c.responsibility} [${c.tech}]`)
            .join("\n"),
        );
      }
      return parts.join("\n\n");
    }
    case "data_model": {
      const entities = (v as TechSpecDataEntity[] | undefined) ?? [];
      return entities
        .map((e) => {
          const fields = (e.fields ?? []).join(", ");
          return `${e.entity}${fields ? ` { ${fields} }` : ""}${
            e.notes ? `\n  ${e.notes}` : ""
          }`;
        })
        .join("\n\n");
    }
    case "features": {
      const features = (v as TechSpecFeature[] | undefined) ?? [];
      return features
        .map((f) => {
          const lines = [`${f.name}: ${f.description}`];
          if (f.components?.length) {
            lines.push(`  components: ${f.components.join(", ")}`);
          }
          if (f.acceptance_criteria?.length) {
            lines.push(`  acceptance: ${f.acceptance_criteria.join("; ")}`);
          }
          return lines.join("\n");
        })
        .join("\n\n");
    }
    case "build_phases": {
      const phases = (v as TechSpecBuildPhase[] | undefined) ?? [];
      return phases
        .map((p) => {
          const lines = [`${p.phase} — ${p.goal}`];
          if (p.deliverables?.length) {
            lines.push(`  deliver: ${p.deliverables.join("; ")}`);
          }
          if (p.depends_on?.length) {
            lines.push(`  depends on: ${p.depends_on.join(", ")}`);
          }
          if (p.acceptance_criteria?.length) {
            lines.push(`  acceptance: ${p.acceptance_criteria.join("; ")}`);
          }
          return lines.join("\n");
        })
        .join("\n\n");
    }
    case "ui_plan": {
      const u = v as TechSpecUiPlan | undefined;
      if (!u) return "";
      const parts: string[] = [];
      if (u.design_language) {
        const d = u.design_language;
        parts.push(
          `Design language: ${d.glass_tier}/${d.accent_intent}/${d.density}/${d.motion_intent}/${d.hero_pattern}`,
        );
      }
      if (u.screens?.length) {
        parts.push(
          u.screens
            .map((s) => {
              const lines = [`${s.name} — ${s.purpose}`];
              if (s.key_components?.length) {
                lines.push(`  components: ${s.key_components.join(", ")}`);
              }
              if (s.states?.length) {
                lines.push(`  states: ${s.states.join(", ")}`);
              }
              return lines.join("\n");
            })
            .join("\n\n"),
        );
      }
      if (u.component_inventory?.length) {
        parts.push(`Components: ${u.component_inventory.join(", ")}`);
      }
      if (u.interaction_notes?.length) {
        parts.push(
          `Interactions:\n• ${u.interaction_notes.join("\n• ")}`,
        );
      }
      if (u.reduction_log?.length) {
        parts.push(`Reductions:\n• ${u.reduction_log.join("\n• ")}`);
      }
      if (u.inspiration_cues?.length) {
        parts.push(`Inspiration: ${u.inspiration_cues.join("; ")}`);
      }
      return parts.join("\n\n");
    }
  }
}

/** Number of pending improvements across all sections. */
export function totalPending(meta: SectionMetaMap): number {
  let n = 0;
  for (const id of SECTION_IDS) {
    n += meta[id]?.pending.length ?? 0;
  }
  return n;
}

/** Coerce an arbitrary `kind` value to a `TechSpecSectionId` if it's valid. */
export function asSectionId(value: unknown): TechSpecSectionId | null {
  if (typeof value !== "string") return null;
  return (SECTION_IDS as string[]).includes(value)
    ? (value as TechSpecSectionId)
    : null;
}
