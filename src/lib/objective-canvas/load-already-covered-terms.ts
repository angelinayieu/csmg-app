// ── #3 — Room-lens exclusion context ──────────────────────────────
//
// A ROOM annotation lens must NOT re-highlight terms the user already
// defined at a higher altitude — the space glossary + the parent
// objective's own annotations. (The user's complaint: a room kept
// re-annotating "monetary" / macro words already covered on the main
// objective page, instead of defining what an ambiguous term like
// "model" concretely corresponds to IN THIS room.)
//
// This helper assembles that "already covered" term list for EVERY
// room-lens generation site so they stay consistent:
//   • POST /sub-objectives/[id]/annotate (manual + force regen)
//   • room/generate K3 (auto-fire on first room generation)
//
// Pass the result as generateObjectiveAnnotations' `alreadyCovered`.

import { normalizeAnnotations } from "./normalize-annotations";

/** Pull glossary surface strings (term + aliases) from
 *  spaces.synthesis_data.glossary. Tolerant of legacy/malformed rows. */
function collectGlossaryTerms(synthesisData: unknown): string[] {
  if (!synthesisData || typeof synthesisData !== "object") return [];
  const g = (synthesisData as Record<string, unknown>).glossary;
  if (!Array.isArray(g)) return [];
  const out: string[] = [];
  for (const t of g as unknown[]) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    if (typeof o.term === "string" && o.term.trim()) out.push(o.term.trim());
    if (Array.isArray(o.aliases)) {
      for (const a of o.aliases) {
        if (typeof a === "string" && a.trim()) out.push(a.trim());
      }
    }
  }
  return out;
}

/** Assemble the room-lens exclusion list: the parent objective's
 *  annotation phrases + canonical concepts, plus every space glossary
 *  term + alias. Reads run in parallel; soft on missing rows. */
export async function loadAlreadyCoveredTerms(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  args: { spaceId: string; parentGoalId: string | null },
): Promise<string[]> {
  const [parentRes, spaceRes] = await Promise.all([
    args.parentGoalId
      ? db
          .from("improvement_goals")
          .select("annotations")
          .eq("id", args.parentGoalId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", args.spaceId)
      .maybeSingle(),
  ]);

  const terms: string[] = [];
  for (const a of normalizeAnnotations(parentRes.data?.annotations)) {
    if (a.phrase) terms.push(a.phrase);
    if (a.concept) terms.push(a.concept);
  }
  terms.push(...collectGlossaryTerms(spaceRes.data?.synthesis_data));
  return terms;
}
