"use client";

// ── Space-wide subject-scope index (F2 / D14) ────────────────────────
//
// Builds a per-entity map of "which Subjects (Twins) scope this
// entity?" so kg-node-shape can render a small colored ring per node
// indicating Twin participation.
//
// Reads:
//   - GET /api/spaces/{id}/subjects        → Subject[] with scope_system_id
//   - GET /api/spaces/{id}/systems         → System[] with entity_ids[]
//
// Index shape: Map<entityId, Array<{ subjectId, subjectName, focusKind }>>
// — each entity can be inside multiple Subjects (e.g. "Working Memory"
// is scoped by both the "Healthy Adult" twin and the "CRCI Recovery"
// twin). The kg-node ring stacks colors per twin.
//
// Single fetch per space, refreshKey to re-fetch after mutations
// (mirrors useSpaceReactions). Returns an empty index gracefully when
// either API is missing or the space has no subjects.

import { useEffect, useMemo, useState } from "react";
import type { Subject, SubjectFocusKind } from "@/types/subject";

export interface ScopingSubjectRef {
  subject_id: string;
  subject_name: string;
  focus_kind: SubjectFocusKind | string;
  /** Snapshot of the system's entity-count for tooltip rendering. */
  scope_size: number;
}

export interface SubjectScopeIndex {
  /** Map of entityId → array of subjects that scope this entity. */
  byEntity: Map<string, ScopingSubjectRef[]>;
  /** Total subjects loaded (including ones without a scope). */
  total_subjects: number;
  /** Total entities scoped by AT LEAST ONE subject. */
  total_scoped_entities: number;
  loading: boolean;
}

interface SystemRow {
  id: string;
  name?: string;
  entity_ids?: string[] | null;
}

const EMPTY_INDEX: SubjectScopeIndex = {
  byEntity: new Map(),
  total_subjects: 0,
  total_scoped_entities: 0,
  loading: false,
};

/**
 * Fetches every subject + system in a space and builds the per-entity
 * scope index. Re-runs on `refreshKey` change (parallel work that
 * adds/removes subjects can bump this to re-index without reload).
 */
export function useSpaceSubjectScopes(
  spaceId: string | null | undefined,
  refreshKey: number = 0,
): SubjectScopeIndex {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [systems, setSystems] = useState<SystemRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!spaceId) {
      setSubjects([]);
      setSystems([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);

    Promise.all([
      fetch(`/api/spaces/${encodeURIComponent(spaceId)}/subjects`, {
        signal: ctrl.signal,
        credentials: "include",
      }).then((r) => (r.ok ? r.json() : { subjects: [] })),
      fetch(`/api/spaces/${encodeURIComponent(spaceId)}/systems`, {
        signal: ctrl.signal,
        credentials: "include",
      }).then((r) => (r.ok ? r.json() : { systems: [] })),
    ])
      .then(([subjData, sysData]) => {
        const subjArr = Array.isArray(subjData?.subjects)
          ? (subjData.subjects as Subject[])
          : [];
        const sysArr = Array.isArray(sysData?.systems)
          ? (sysData.systems as SystemRow[])
          : [];
        setSubjects(subjArr);
        setSystems(sysArr);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        // Soft-fail: empty index is the safe default.
        setSubjects([]);
        setSystems([]);
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [spaceId, refreshKey]);

  return useMemo(() => {
    if (subjects.length === 0) {
      return { ...EMPTY_INDEX, loading };
    }
    // Build system_id → entity_ids lookup once.
    const systemEntities = new Map<string, string[]>();
    for (const sys of systems) {
      if (!sys.id || !Array.isArray(sys.entity_ids)) continue;
      systemEntities.set(sys.id, sys.entity_ids);
    }

    // For each Subject with a scope_system_id, fan out its entities
    // into the byEntity map.
    const byEntity = new Map<string, ScopingSubjectRef[]>();
    for (const subj of subjects) {
      if (!subj.scope_system_id) continue;
      const entIds = systemEntities.get(subj.scope_system_id);
      if (!entIds || entIds.length === 0) continue;
      const ref: ScopingSubjectRef = {
        subject_id: subj.id,
        subject_name: subj.name,
        focus_kind: subj.focus_kind,
        scope_size: entIds.length,
      };
      for (const eid of entIds) {
        const existing = byEntity.get(eid);
        if (existing) {
          existing.push(ref);
        } else {
          byEntity.set(eid, [ref]);
        }
      }
    }

    return {
      byEntity,
      total_subjects: subjects.length,
      total_scoped_entities: byEntity.size,
      loading,
    };
  }, [subjects, systems, loading]);
}
