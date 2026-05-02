// ── Phase 1: KG Context Construction Layer ──
//
// Single canonical seam for KG-augmented LLM prompts. Endpoints stop
// hand-rolling joins + prompt-formatting and instead call:
//
//   const ctx = await buildKgContext(supabase, { spaceId, mode, ... });
//   const grounding = renderKgContext(ctx);
//   const prompt = `${grounding}\n\n${taskSpecificInstructions}`;
//
// Phase 2 (community report generation) and Phase 3 (LLMLingua-style
// compression) plug into this layer without endpoint changes.

export { buildKgContext } from "./build-kg-context";
export { renderKgContext, renderKgContextSupplements } from "./render";
export type {
  KgContext,
  KgContextMode,
  BuildKgContextOpts,
  KgContextCaps,
  KgCommunityInfo,
  KgCommunitySummary,
  RenderKgContextOpts,
} from "./types";
