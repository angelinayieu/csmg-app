// ── Crucible persistence (Phase 2 convergence) ───────────────────────
//
// Runs the Synthesizer over the converged problem-model and promotes the
// outputs into the shared object layer:
//   • variables       → library_objects(object_type:"variable")
//   • constraints     → library_objects(object_type:"constraint")
//   • leverage points → library_objects(object_type:"leverage_point"),
//                       rank_score = the normalized leverage score
//   • dependencies    → object_links:  leverage --feeds--> variable
//                                        leverage --depends_on--> constraint
//
// Because the KG + Library rail read library_objects + object_links, the ranked
// leverage points, the variables they move, and the constraints that bound them
// appear in the knowledge graph automatically — no extra view code. Idempotent
// on source_ref (`crucible:{var|con|lev}:{slug}`) so a re-run updates in place.
// SERVER-ONLY. Soft-fails: a persistence miss leaves the structured result on
// the card state regardless, so the user still sees the leverage points.

import type { SupabaseClient } from "@supabase/supabase-js";
import { linkObjects, upsertLibraryObject } from "@/lib/objective-canvas/library-objects";
import { mergeGlossary, type GlossaryTerm } from "@/lib/objective-canvas/generate-glossary";
import { synthesizeFirstPrinciples, synthesizeLeverage, synthesizeRoadmap } from "./crucible-engine";
import type { FactorLite } from "./crucible-prompts";
import type { CrucibleState, CrucibleVariable } from "./crucible-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface SynthesisCtx {
  objective: string;
  preamble: string;
  factors: FactorLite[];
}

/** Synthesize ranked leverage points from `state`, persist them (+ variables +
 *  constraints + dependency links), and fold the results back onto `state`.
 *  Mutates + returns `state`. Sets `synthesisDone` only on success so the route
 *  can retry a failed synthesis on the next poll. */
export async function synthesizeAndPersist(
  db: AnyDb,
  userId: string,
  spaceId: string,
  ctx: SynthesisCtx,
  state: CrucibleState,
): Promise<CrucibleState> {
  const result = await synthesizeLeverage({
    objective: ctx.objective,
    preamble: ctx.preamble,
    factors: ctx.factors,
    questions: state.questions,
    answers: state.answers,
    landscape: state.landscape,
    solutions: state.solutions,
    constraints: state.constraints,
    variables: state.variables,
  });
  if (!result) return state; // synthesisDone stays false → retried next poll

  // 1. Variables → library_objects. concept_slug carried for Phase 3 glossary.
  const varIdBySlug = new Map<string, string>();
  await Promise.all(
    result.variables.map(async (v) => {
      const id = await upsertLibraryObject(db, {
        spaceId,
        userId,
        objectType: "variable",
        title: v.label,
        summary: v.note ?? null,
        sourceRef: `crucible:var:${v.slug}`,
        contentSnapshot: { slug: v.slug, note: v.note ?? null, concept_slug: v.slug },
      });
      if (id) varIdBySlug.set(v.slug, id);
    }),
  );

  // 2. Constraints → library_objects.
  const conIdBySlug = new Map<string, string>();
  await Promise.all(
    result.constraints.map(async (c) => {
      const id = await upsertLibraryObject(db, {
        spaceId,
        userId,
        objectType: "constraint",
        title: c.label,
        summary: c.why ?? null,
        sourceRef: `crucible:con:${c.slug}`,
        contentSnapshot: { slug: c.slug, kind: c.kind, why: c.why ?? null },
      });
      if (id) conIdBySlug.set(c.slug, id);
    }),
  );

  // 3. Leverage points → library_objects (rank_score = leverage score).
  const levIdBySlug = new Map<string, string>();
  await Promise.all(
    result.leveragePoints.map(async (lp) => {
      const id = await upsertLibraryObject(db, {
        spaceId,
        userId,
        objectType: "leverage_point",
        title: lp.label,
        summary: lp.rationale,
        sourceRef: `crucible:lev:${lp.slug}`,
        rankScore: lp.score,
        contentSnapshot: {
          slug: lp.slug,
          rationale: lp.rationale,
          meadows_level: lp.meadowsLevel,
          scores: lp.scores,
          score: lp.score,
          targets: lp.targetsVariableSlugs,
          bounded_by: lp.boundedByConstraintSlugs,
        },
      });
      if (id) levIdBySlug.set(lp.slug, id);
    }),
  );

  // 4. Dependency links — leverage feeds the variable it moves + depends_on the
  //    constraint that bounds it. The causal map the KG renders.
  const edges: Promise<void>[] = [];
  for (const lp of result.leveragePoints) {
    const lid = levIdBySlug.get(lp.slug);
    if (!lid) continue;
    for (const vSlug of lp.targetsVariableSlugs) {
      const vid = varIdBySlug.get(vSlug);
      if (vid) edges.push(linkObjects(db, { spaceId, fromObjectId: lid, toObjectId: vid, relation: "feeds" }));
    }
    for (const cSlug of lp.boundedByConstraintSlugs) {
      const cid = conIdBySlug.get(cSlug);
      if (cid) edges.push(linkObjects(db, { spaceId, fromObjectId: lid, toObjectId: cid, relation: "depends_on" }));
    }
  }
  await Promise.all(edges);

  // 4b. First-principles lens — the irreducible truths the levers rest on.
  //     Scored on the eval rubric; persisted as first_principle objects with
  //     `leverage_point --derived_from--> first_principle` edges.
  const variableSlugs = new Set(result.variables.map((v) => v.slug));
  const leverageSlugs = new Set(result.leveragePoints.map((l) => l.slug));
  const firstPrinciples = await synthesizeFirstPrinciples({
    objective: ctx.objective,
    preamble: ctx.preamble,
    variables: result.variables,
    constraintLines: result.constraints.map((c) => `${c.label} (${c.kind})`),
    leverageLines: result.leveragePoints.map((l) => `- ${l.slug} — ${l.label}`),
    leverageSlugs,
    variableSlugs,
    questions: state.questions,
    answers: state.answers,
  });

  const fpIdBySlug = new Map<string, string>();
  await Promise.all(
    firstPrinciples.map(async (fp) => {
      const id = await upsertLibraryObject(db, {
        spaceId,
        userId,
        objectType: "first_principle",
        title: fp.label,
        summary: fp.statement,
        sourceRef: `crucible:fp:${fp.slug}`,
        rankScore: fp.score,
        contentSnapshot: {
          slug: fp.slug,
          statement: fp.statement,
          scores: fp.scores,
          score: fp.score,
          grounds_leverage: fp.groundsLeverageSlugs,
          grounds_variables: fp.groundsVariableSlugs,
        },
      });
      if (id) fpIdBySlug.set(fp.slug, id);
    }),
  );

  // Each leverage point rests on the principle(s) that ground it.
  const fpEdges: Promise<void>[] = [];
  for (const fp of firstPrinciples) {
    const fid = fpIdBySlug.get(fp.slug);
    if (!fid) continue;
    for (const lSlug of fp.groundsLeverageSlugs) {
      const lid = levIdBySlug.get(lSlug);
      if (lid) fpEdges.push(linkObjects(db, { spaceId, fromObjectId: lid, toObjectId: fid, relation: "derived_from" }));
    }
  }
  await Promise.all(fpEdges);

  // 4c. Roadmap (Phase 4) — coin sub-objectives (branches pursuing leverage
  //     clusters) + seed features (each operationalizing a leverage point).
  const roadmap = await synthesizeRoadmap({
    objective: ctx.objective,
    preamble: ctx.preamble,
    leverageLines: result.leveragePoints.map((l) => `- ${l.slug} — ${l.label} · ${l.score}`),
    principleLines: firstPrinciples.map((fp) => `${fp.label}: ${fp.statement}`),
    constraintLines: result.constraints.map((c) => `${c.label} (${c.kind})`),
    leverageSlugs,
  });

  // Sub-objectives → library_objects(sub_objective); each DEPENDS_ON the
  // leverage points it pursues.
  const soIdBySlug = new Map<string, string>();
  await Promise.all(
    roadmap.subObjectives.map(async (so) => {
      const id = await upsertLibraryObject(db, {
        spaceId,
        userId,
        objectType: "sub_objective",
        title: so.title,
        summary: so.rationale,
        sourceRef: `crucible:so:${so.slug}`,
        contentSnapshot: { slug: so.slug, rationale: so.rationale, leverage: so.leverageSlugs },
      });
      if (id) soIdBySlug.set(so.slug, id);
    }),
  );

  // Seed features → library_objects(feature); each DERIVED_FROM its lever, so
  // existing card ops (unpack / decompose / micros) work on them out of the box.
  const featIdBySlug = new Map<string, string>();
  await Promise.all(
    roadmap.features.map(async (f) => {
      const id = await upsertLibraryObject(db, {
        spaceId,
        userId,
        objectType: "feature",
        title: f.title,
        summary: f.description,
        sourceRef: `crucible:feat:${f.slug}`,
        rankScore: Math.round(f.confidence * 100),
        contentSnapshot: {
          slug: f.slug,
          description: f.description,
          leverage: f.leverageSlug,
          confidence: f.confidence,
        },
      });
      if (id) featIdBySlug.set(f.slug, id);
    }),
  );

  const roadmapEdges: Promise<void>[] = [];
  for (const so of roadmap.subObjectives) {
    const sid = soIdBySlug.get(so.slug);
    if (!sid) continue;
    for (const lSlug of so.leverageSlugs) {
      const lid = levIdBySlug.get(lSlug);
      if (lid) roadmapEdges.push(linkObjects(db, { spaceId, fromObjectId: sid, toObjectId: lid, relation: "depends_on" }));
    }
  }
  for (const f of roadmap.features) {
    const fid = featIdBySlug.get(f.slug);
    const lid = levIdBySlug.get(f.leverageSlug);
    if (fid && lid) roadmapEdges.push(linkObjects(db, { spaceId, fromObjectId: fid, toObjectId: lid, relation: "derived_from" }));
  }
  await Promise.all(roadmapEdges);

  // 5. Fold ids back onto the state for the card to render (+ navigate).
  state.variables = result.variables.map((v) => ({
    ...v,
    objectId: varIdBySlug.get(v.slug) ?? null,
  }));
  state.constraintObjects = result.constraints.map((c) => ({
    ...c,
    objectId: conIdBySlug.get(c.slug) ?? null,
  }));
  state.leveragePoints = result.leveragePoints.map((lp) => ({
    ...lp,
    objectId: levIdBySlug.get(lp.slug) ?? null,
  }));
  state.firstPrinciples = firstPrinciples.map((fp) => ({
    ...fp,
    objectId: fpIdBySlug.get(fp.slug) ?? null,
  }));
  state.subObjectives = roadmap.subObjectives.map((so) => ({
    ...so,
    objectId: soIdBySlug.get(so.slug) ?? null,
  }));
  state.features = roadmap.features.map((f) => ({
    ...f,
    objectId: featIdBySlug.get(f.slug) ?? null,
  }));

  // 6. Glossary wiring — the canonical variables become defined terms the rest
  //    of the app reasons with (source "llm" = lowest authority, so user/pinned
  //    terms always win). Merge into spaces.synthesis_data.glossary, re-reading
  //    fresh so we don't clobber the crucible state key the route writes after.
  await wireVariablesIntoGlossary(db, spaceId, result.variables);

  state.synthesisDone = true;
  return state;
}

/** Merge the Crucible's variables into the space glossary (concept_slug-keyed,
 *  source "llm"). Soft-fail. */
async function wireVariablesIntoGlossary(
  db: AnyDb,
  spaceId: string,
  variables: CrucibleVariable[],
): Promise<void> {
  if (variables.length === 0) return;
  try {
    const nowIso = new Date().toISOString();
    const incoming: GlossaryTerm[] = variables
      .filter((v) => v.note && v.note.trim())
      .map((v) => ({
        term: v.label,
        definition: v.note!.trim(),
        aliases: [],
        source: "llm",
        concept_slug: v.slug,
        kind: null,
        updated_at: nowIso,
      }));
    if (incoming.length === 0) return;

    const { data } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const synth =
      data?.synthesis_data && typeof data.synthesis_data === "object"
        ? { ...(data.synthesis_data as Record<string, unknown>) }
        : {};
    const existing: GlossaryTerm[] = Array.isArray(synth.glossary)
      ? (synth.glossary as GlossaryTerm[])
      : [];
    synth.glossary = mergeGlossary(existing, incoming);
    await db.from("spaces").update({ synthesis_data: synth }).eq("id", spaceId);
  } catch (err) {
    console.warn("[crucible-persist] glossary wiring failed (soft):", err);
  }
}
