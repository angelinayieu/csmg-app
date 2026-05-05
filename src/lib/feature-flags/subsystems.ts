/**
 * When true, the synthesize chain runs extract-subsystems, populating
 * synthesis_data.subsystems[]. Strategy-refresh then consumes them as
 * constraint-bearing units (every micro_tactic must name a target subsystem).
 *
 * When false, the pipeline behaves exactly as before — no new stages run,
 * no new fields are written, strategy generation is unchanged. Old syntheses
 * without the field are handled by treating subsystems as an empty array.
 *
 * Rollout: flip to true after the constraint-injection prompt changes have
 * landed and been validated on existing spaces.
 */
export const ENABLE_SUBSYSTEMS_EXTRACTION = false;

/**
 * Hard-constraint enforcement on strategy generation. When true, the
 * coherence validator rejects strategies that miss critical axioms /
 * strong convergences / coverage gaps and triggers a single retry with
 * an explicit "you missed X" prompt. When false, misses just lower
 * coherence_score (current behavior — strategy still ships).
 */
export const ENABLE_HARD_CONSTRAINT_RETRY = false;

/**
 * When true, the Effect Propagator queries evidence_registries for the
 * entities in a chain, pools effect sizes via edge-strength-pooler (or
 * reads pre-pooled metadata from edges.dynamics_properties.pooling_metadata),
 * and forces the LLM to cite real evidence_ids on "research" steps. Steps
 * that fail validation trigger one retry with explicit citation violations.
 *
 * When false, the propagator runs as before — LLM invents effect sizes
 * inline with fabricated paper labels. Behavior unchanged.
 *
 * Independent of ENABLE_SUBSYSTEMS_EXTRACTION. Rollout: flip on after
 * manual eval against a space that has ingested evidence_registries rows.
 */
export const ENABLE_EVIDENCE_AWARE_TRACE = false;
