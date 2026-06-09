// ── assemble-seed ────────────────────────────────────────────────────
//
// Build `seed.internal` from the engine outputs already persisted — the
// prompt_sharpening artifact + the crucible state — both living in
// synthesis_data.objective_canvas. NOTHING is regenerated; this just GATHERS the
// internal metadata into one place so distill-external can read it.
//
// Read defensively (everything `any` + guarded) so the parallel session's churn
// on crucible-types never breaks the gather. SERVER-ONLY. Soft-fails to an empty
// internal so a partial graph still yields a partial seed.

import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";
import {
  emptySeedInternal,
  type SeedEdge,
  type SeedInternal,
  type SeedNode,
} from "./seed-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;
function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export async function assembleSeedInternal(db: AnyDb, spaceId: string): Promise<SeedInternal> {
  let objective = "";
  try {
    const ctx = await buildSpaceContext(db, spaceId);
    objective = (ctx.objective ?? "").trim();
  } catch {
    /* soft */
  }
  const internal = emptySeedInternal(objective);

  let synth: Record<string, unknown> = {};
  try {
    const { data } = await db.from("spaces").select("synthesis_data").eq("id", spaceId).maybeSingle();
    synth = rec(data?.synthesis_data);
  } catch {
    return internal;
  }
  const oc = rec(synth.objective_canvas);

  // ── prompt_sharpening → sharpenedObjective, ambiguities, optimizationPoints ──
  const ps = rec(oc.prompt_sharpening);
  if (str(ps.sharpened_prompt)) internal.sharpenedObjective = str(ps.sharpened_prompt);
  internal.ambiguities = arr(ps.ranked_ambiguities)
    .slice(0, 10)
    .map((a) => ({
      zone: str(rec(a).ambiguity_type).replace(/ambiguity/i, "").trim() || "Ambiguity",
      question: str(rec(a).question_to_resolve),
      resolved: false,
    }))
    .filter((a) => a.question);
  const salience = rec(ps.salience);
  internal.optimizationPoints = arr(salience.annotations)
    .map((a) => ({
      slug: str(rec(a).concept) || str(rec(a).phrase).toLowerCase().replace(/\s+/g, "-").slice(0, 48),
      label: str(rec(a).phrase),
      weight: num(rec(a).priority) || num(rec(a).leverage) || 0.5,
    }))
    .filter((p) => p.label)
    .slice(0, 8);

  // ── crucible → leverage / principles / variables / constraints + graph ──
  const cru = rec(oc.crucible);
  internal.leveragePoints = arr(cru.leveragePoints).map((l) => ({
    slug: str(rec(l).slug),
    label: str(rec(l).label),
    score: num(rec(l).score),
    meadows: str(rec(l).meadowsLevel) || undefined,
    rationale: str(rec(l).rationale) || undefined,
  })).filter((l) => l.slug && l.label);
  internal.firstPrinciples = arr(cru.firstPrinciples).map((f) => ({
    slug: str(rec(f).slug),
    label: str(rec(f).label),
    statement: str(rec(f).statement),
    score: num(rec(f).score),
  })).filter((f) => f.slug && f.label);
  internal.canonicalVariables = arr(cru.variables).map((v) => ({
    slug: str(rec(v).slug),
    label: str(rec(v).label),
    note: str(rec(v).note) || undefined,
  })).filter((v) => v.slug && v.label);
  internal.constraints = arr(cru.constraintObjects).map((c) => ({
    slug: str(rec(c).slug),
    label: str(rec(c).label),
    kind: rec(c).kind === "soft" ? ("soft" as const) : ("hard" as const),
  })).filter((c) => c.slug && c.label);

  // ── reasoning graph (the Map tab) — nodes + edges from the crucible refs ──
  const nodes: SeedNode[] = [];
  const edges: SeedEdge[] = [];
  const push = (id: string, label: string, type: string, score?: number) => {
    if (id && !nodes.some((n) => n.id === id)) nodes.push({ id, label, keyword: label.split(" ").slice(0, 2).join(" "), type, score });
  };
  for (const f of internal.firstPrinciples) push(f.slug, f.label, "first_principle", f.score);
  for (const v of internal.canonicalVariables) push(v.slug, v.label, "variable");
  for (const c of internal.constraints) push(c.slug, c.label, "constraint");
  for (const l of internal.leveragePoints) push(l.slug, l.label, "leverage_point", l.score);
  // edges from the crucible structured refs
  for (const l of arr(cru.leveragePoints)) {
    const ls = str(rec(l).slug);
    for (const t of arr(rec(l).targetsVariableSlugs)) edges.push({ source: ls, target: str(t), relation: "feeds" });
    for (const t of arr(rec(l).boundedByConstraintSlugs)) edges.push({ source: ls, target: str(t), relation: "depends_on" });
  }
  for (const f of arr(cru.firstPrinciples)) {
    const fs = str(rec(f).slug);
    for (const t of arr(rec(f).groundsLeverageSlugs)) edges.push({ source: str(t), target: fs, relation: "derived_from" });
  }
  internal.reasoningGraph = {
    nodes,
    edges: edges.filter((e) => e.source && e.target && nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target)),
  };

  return internal;
}
