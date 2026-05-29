// ── Split annotations by section ──────────────────────────────────
//
// Sub-objective annotations are generated against the combined text
// "title\n\ndescription". For surface rendering we want them applied
// to whichever section they fall in — the h1 title gets its own
// inline underlines, the description card gets the rest.
//
// Boundary rules:
//   • offset.end ≤ title.length             → title annotation, offsets kept
//   • offset.start ≥ title.length + 2 (\n\n) → description annotation, offsets
//                                              re-based to description-local
//   • else                                  → cross-boundary, dropped (rare)
//
// If `description` is empty, all in-range annotations are titleAnns.
// If `title` is empty, the combined text is just description, so all
// annotations are descAnns (no re-offset needed).

import type { ObjectiveAnnotation } from "@/components/objective/annotated-objective-card";

const SPACER = "\n\n";

export interface SplitAnnotations {
  titleAnnotations: ObjectiveAnnotation[];
  descriptionAnnotations: ObjectiveAnnotation[];
}

export function splitAnnotationsByTitle(
  title: string,
  description: string | null | undefined,
  annotations: ObjectiveAnnotation[],
): SplitAnnotations {
  // Mirror EXACTLY how the annotation generator composed its focus
  // text (see /api/brainstorm/sub-objectives/[id]/annotate): the raw
  // title and description joined by "\n\n", with empties filtered.
  // Offsets are relative to that raw string, so the boundary must use
  // the RAW title length — trimming here would shift every offset.
  const rawTitle = typeof title === "string" ? title : "";
  const rawDesc = typeof description === "string" ? description : "";
  const titleIncluded = rawTitle.trim().length > 0;
  const descIncluded = rawDesc.trim().length > 0;

  if (!titleIncluded) {
    return { titleAnnotations: [], descriptionAnnotations: annotations };
  }
  if (!descIncluded) {
    return { titleAnnotations: annotations, descriptionAnnotations: [] };
  }

  const titleEnd = rawTitle.length;
  const descStart = titleEnd + SPACER.length;

  const titleAnnotations: ObjectiveAnnotation[] = [];
  const descriptionAnnotations: ObjectiveAnnotation[] = [];
  for (const a of annotations) {
    if (a.end_offset <= titleEnd) {
      titleAnnotations.push(a);
      continue;
    }
    if (a.start_offset >= descStart) {
      descriptionAnnotations.push({
        ...a,
        start_offset: a.start_offset - descStart,
        end_offset: a.end_offset - descStart,
      });
      continue;
    }
    // Cross-boundary — drop. Rare; would underline whitespace.
  }
  return { titleAnnotations, descriptionAnnotations };
}
