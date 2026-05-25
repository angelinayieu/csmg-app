// ── Annotation versions — types + storage helpers ──
//
// Backs the Deepen / Compare / Synthesize loop on the Objective
// Canvas core-objective card. Versions live on
// `improvement_goals.annotations_versions` (jsonb array, capped at
// ~10 entries to bound row size). The active version's annotations
// are denormalized into `improvement_goals.annotations` for fast read.

import { randomUUID } from "crypto";
import type { ObjectiveAnnotation } from "./generate-annotations";

export type AnnotationGenerator = "initial" | "deepen" | "synthesis";

/** Per-annotation justification recorded when the LLM arbitrates
 *  between two versions during a synthesize pass. */
export interface ArbitrationRecord {
  phrase: string;
  picked_from: "v1" | "v2";
  why: string;
  kept_from_other: string | null;
}

export interface AnnotationVersion {
  id: string;
  generated_at: string;
  generator: AnnotationGenerator;
  /** For synthesis: the two version ids that were compared. For
   *  deepen: the single parent version id (or null on initial). */
  parent_version_ids: string[] | null;
  annotations: ObjectiveAnnotation[];
  /** Only populated on synthesis. */
  arbitration_record: ArbitrationRecord[] | null;
}

const MAX_VERSIONS = 10;

export function makeVersion(
  annotations: ObjectiveAnnotation[],
  generator: AnnotationGenerator,
  parents: string[] | null = null,
  arbitration: ArbitrationRecord[] | null = null,
): AnnotationVersion {
  return {
    id: `${generator[0]}-${randomUUID().slice(0, 8)}`,
    generated_at: new Date().toISOString(),
    generator,
    parent_version_ids: parents,
    annotations,
    arbitration_record: arbitration,
  };
}

/** Append a new version to the history. Caps at MAX_VERSIONS (oldest
 *  trimmed). Returns the trimmed array — caller writes it back to DB. */
export function appendVersion(
  history: AnnotationVersion[],
  version: AnnotationVersion,
): AnnotationVersion[] {
  const next = [...history, version];
  if (next.length <= MAX_VERSIONS) return next;
  return next.slice(next.length - MAX_VERSIONS);
}

/** Best-effort parse — drops malformed entries. Tolerates missing
 *  fields from older shapes. */
export function parseVersions(raw: unknown): AnnotationVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const r = entry as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const generated_at =
      typeof r.generated_at === "string"
        ? r.generated_at
        : new Date().toISOString();
    const generator: AnnotationGenerator =
      r.generator === "deepen" || r.generator === "synthesis"
        ? r.generator
        : "initial";
    const parent_version_ids = Array.isArray(r.parent_version_ids)
      ? (r.parent_version_ids as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : null;
    const annotations = Array.isArray(r.annotations)
      ? (r.annotations as ObjectiveAnnotation[])
      : [];
    const arbitration_record = Array.isArray(r.arbitration_record)
      ? (r.arbitration_record as ArbitrationRecord[]).filter(
          (a): a is ArbitrationRecord =>
            !!a &&
            typeof a === "object" &&
            typeof (a as ArbitrationRecord).phrase === "string",
        )
      : null;
    if (!id || annotations.length === 0) return [];
    return [
      {
        id,
        generated_at,
        generator,
        parent_version_ids,
        annotations,
        arbitration_record,
      },
    ];
  });
}
