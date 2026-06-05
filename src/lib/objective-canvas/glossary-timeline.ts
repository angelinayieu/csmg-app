// ── glossary-timeline ───────────────────────────────────────────────
//
// "How your glossary was built" — a single, time-ordered STORY of how the
// space's understanding accreted: raw objective → sharpened → ambiguities
// surfaced → references you fed in → answers you gave (your taste) → terms
// pinned → decomposed into building blocks.
//
// Two sources, merged + sorted:
//   1. RECONSTRUCTION (works retroactively, no schema) — from the timestamps
//      already persisted: prompt_sharpening.generated_at, salience.generated_at,
//      resolutions[].resolved_at (+source), resolutions_applied_at,
//      glossary[].updated_at (+source/provenance), context_concept.created_at,
//      and the decompose objects' created_at.
//   2. LOGGED events (precise, forward-looking) — the append-only `glossary_events`
//      table, when present. Soft-fails to reconstruction-only if not migrated.
//
// Pure read + soft-fail: any error → returns whatever assembled so far (or []),
// so a caller can always render *something*. Reuses taste-glossary's evidence
// join so each pinned term carries the same provenance the rest of the app shows.

import { enrichGlossaryWithEvidence, type TasteProvenance } from "./taste-glossary";
import type { GlossaryTerm } from "./generate-glossary";

/** The arc of how meaning accretes — drives grouping + the rail color. */
export type GlossaryTimelinePhase =
  | "sharpen" // the objective was distilled / re-sharpened
  | "map" // ambiguities + salience surfaced
  | "reference" // the user fed in reference material / prior ideas
  | "resolve" // the user answered an ambiguity (their taste)
  | "define" // a glossary term was created / refined
  | "apply" // answers were applied (glossary pinned + objective re-framed)
  | "decompose"; // the objective was decomposed into building blocks

export interface GlossaryTimelineEvent {
  /** ISO timestamp the event happened (sort key). */
  at: string;
  phase: GlossaryTimelinePhase;
  /** Short headline for the row. */
  title: string;
  /** One-line elaboration (definition / answer / summary). */
  detail?: string;
  /** When the event is about a specific term. */
  term?: string;
  /** Cross-surface identity, when known. */
  concept_slug?: string;
  /** Origin/authority label: user|annotation|entity|llm | manual|voice|ai | reference|prior_idea. */
  source?: string;
  /** For `define` rows — the 3-tier taste cue (yours/grounded/ai). */
  provenance?: TasteProvenance;
  /** For clustered rows (e.g. "12 terms defined"). */
  count?: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isoLt = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Assemble the full glossary-build timeline for a space, ascending by time.
 * Soft-fail throughout — partial data still yields a usable story.
 */
export async function buildGlossaryTimeline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
): Promise<GlossaryTimelineEvent[]> {
  const events: GlossaryTimelineEvent[] = [];

  try {
    const { data: space } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space) return [];

    const synth = (space.synthesis_data as Record<string, unknown> | null) ?? {};
    const oc = (synth.objective_canvas as Record<string, unknown> | null) ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const art = oc.prompt_sharpening as any;

    // ── 1. Objective sharpened ──
    if (art?.generated_at) {
      events.push({
        at: str(art.generated_at),
        phase: "sharpen",
        title: "Objective sharpened",
        detail:
          str(art.distilled_title) || str(art.sharpened_prompt).slice(0, 120),
      });
    }

    // ── 2. Ambiguities + salience surfaced ──
    const annotations: Array<{ phrase?: unknown }> = Array.isArray(
      art?.salience?.annotations,
    )
      ? art.salience.annotations
      : [];
    if (art?.salience?.generated_at) {
      const top = annotations
        .slice(0, 3)
        .map((a) => str(a.phrase))
        .filter(Boolean)
        .join(", ");
      const n = annotations.length;
      events.push({
        at: str(art.salience.generated_at),
        phase: "map",
        title: `${n} key ambiguit${n === 1 ? "y" : "ies"} surfaced`,
        detail: top ? `Highest-leverage: ${top}` : undefined,
        count: n,
      });
    }

    // ── 3. Resolutions — the user's taste, per answered ambiguity ──
    const resolutions: Array<Record<string, unknown>> = Array.isArray(
      art?.resolutions,
    )
      ? art.resolutions
      : [];
    for (const r of resolutions) {
      const at = str(r.resolved_at);
      if (!at) continue;
      const phrase = str(r.phrase);
      const answer =
        str(r.answer_text).trim() ||
        (Array.isArray(r.chosen_readings)
          ? (r.chosen_readings as unknown[]).filter((x) => typeof x === "string").join("; ")
          : "");
      events.push({
        at,
        phase: "resolve",
        title: phrase ? `Resolved “${phrase}”` : "Resolved an ambiguity",
        detail: answer.slice(0, 180),
        concept_slug: str(r.concept_slug) || undefined,
        source: str(r.source) || "manual", // manual | voice | ai
      });
    }

    // ── 4. Answers applied (write-back) ──
    if (art?.resolutions_applied_at) {
      events.push({
        at: str(art.resolutions_applied_at),
        phase: "apply",
        title: "Answers applied → glossary pinned + objective re-framed",
      });
    }

    // ── 5. Glossary terms — precise logged events first, then reconstruct ──
    // Logged glossary_events (forward-looking audit trail) SUPERSEDE the coarse
    // glossary[].updated_at reconstruction for the same concept_slug, so a
    // pinned/redefined term shows its real history without duplicating.
    const loggedSlugs = new Set<string>();
    try {
      const { data: logged } = await db
        .from("glossary_events")
        .select("created_at, term, concept_slug, event_kind, source, new_definition")
        .eq("space_id", spaceId);
      for (const ev of (logged as Array<Record<string, unknown>> | null) ?? []) {
        const at = str(ev.created_at);
        if (!at) continue;
        const slug = str(ev.concept_slug);
        if (slug) loggedSlugs.add(slug);
        const kind = str(ev.event_kind).replace(/_/g, " ");
        events.push({
          at,
          phase: "define",
          title: str(ev.term) ? `${str(ev.term)} — ${kind}` : kind || "term updated",
          detail: str(ev.new_definition) || undefined,
          term: str(ev.term) || undefined,
          concept_slug: slug || undefined,
          source: str(ev.source) || undefined,
        });
      }
    } catch {
      /* glossary_events not migrated — reconstruction stands alone */
    }

    const glossary: GlossaryTerm[] = Array.isArray(synth.glossary)
      ? (synth.glossary as GlossaryTerm[])
      : [];
    const enriched = await enrichGlossaryWithEvidence(db, spaceId, glossary);
    for (const t of enriched) {
      const at = str(t.updated_at);
      if (!at || !t.term) continue;
      // a logged event already tells this term's story — don't double-count.
      if (t.concept_slug && loggedSlugs.has(t.concept_slug)) continue;
      events.push({
        at,
        phase: "define",
        title: t.term,
        detail: t.definition,
        term: t.term,
        concept_slug: t.concept_slug,
        source: t.source,
        provenance: t.provenance,
      });
    }

    // ── 6. References / prior ideas the user fed in ──
    try {
      const { data: refs } = await db
        .from("library_objects")
        .select("title, summary, content_snapshot, created_at")
        .eq("space_id", spaceId)
        .eq("object_type", "context_concept");
      for (const r of (refs as Array<Record<string, unknown>> | null) ?? []) {
        const at = str(r.created_at);
        if (!at) continue;
        const snap =
          r.content_snapshot && typeof r.content_snapshot === "object"
            ? (r.content_snapshot as { role?: unknown })
            : null;
        const role = snap?.role === "reference" ? "reference" : "prior_idea";
        events.push({
          at,
          phase: "reference",
          title:
            role === "reference"
              ? `Reference added: ${str(r.title)}`
              : `Prior idea: ${str(r.title)}`,
          detail: str(r.summary).slice(0, 160),
          source: role,
        });
      }
    } catch {
      /* context layer may be empty — skip */
    }

    // ── 7. Decomposed into building blocks (one summary row) ──
    try {
      const { data: objs } = await db
        .from("library_objects")
        .select("created_at")
        .eq("space_id", spaceId)
        .in("object_type", ["feature", "variable"]);
      const stamps = ((objs as Array<{ created_at?: unknown }> | null) ?? [])
        .map((o) => str(o.created_at))
        .filter(Boolean)
        .sort();
      if (stamps.length > 0) {
        events.push({
          at: stamps[0],
          phase: "decompose",
          title: `Decomposed into ${stamps.length} building block${stamps.length === 1 ? "" : "s"}`,
          count: stamps.length,
        });
      }
    } catch {
      /* no decompose objects yet — skip */
    }

  } catch (err) {
    console.warn(
      "[glossary-timeline] build failed (soft):",
      err instanceof Error ? err.message : String(err),
    );
  }

  return events
    .filter((e) => e.at)
    .sort((a, b) => isoLt(a.at, b.at));
}
