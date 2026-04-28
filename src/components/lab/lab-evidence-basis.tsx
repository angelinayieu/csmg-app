"use client";

// ── Lab Evidence Basis (Phase 5B) ────────────────────────────────
//
// Right-rail panel surfacing the evidence_registries rows that
// substantiate the in-scope entities. Mirrors the photo's "EVIDENCE
// BASIS" panel — a compact citation strip the researcher reads as
// "what literature backs this baseline / prediction".
//
// Fetches lazily via /api/spaces/[id]/evidence-rollup?entity_ids=
// (a small endpoint that joins evidence_registries to attached
// entities). Cached per (spaceId, entity-id-fingerprint) so flipping
// between scopes doesn't re-fetch the same rollup.
//
// Each row shows:
//   • outcome / intervention label (truncated)
//   • effect_metric + size + CI
//   • author short citation when present in llm_label_provenance
//   • status badge (reviewed / pending review)
//
// When no evidence is attached, renders a soft empty state — does
// NOT fail loud, since most v1 labs run without curated evidence.

import { useEffect, useState } from "react";
import { FileBarChart } from "lucide-react";
import type { EvidenceRegistryRow } from "@/types/evidence-registry";

interface LabEvidenceBasisProps {
  spaceId: string;
  /** Entity IDs in the current lab scope (subject + heroes + reagent
   *  bay union). Used to filter which evidence rows surface. */
  entityIds: string[];
  /** Limit. Defaults to 4 — anything more crowds the rail. */
  limit?: number;
}

interface RollupResponse {
  rows: EvidenceRegistryRow[];
  total: number;
}

async function fetchRollup(
  spaceId: string,
  entityIds: string[],
  signal: AbortSignal,
): Promise<RollupResponse> {
  if (entityIds.length === 0) return { rows: [], total: 0 };
  const params = new URLSearchParams();
  params.set("entity_ids", entityIds.slice(0, 80).join(","));
  const res = await fetch(
    `/api/spaces/${spaceId}/evidence-rollup?${params.toString()}`,
    { credentials: "include", signal, cache: "no-store" },
  );
  if (!res.ok) return { rows: [], total: 0 };
  const j = (await res.json()) as RollupResponse;
  return j;
}

export function LabEvidenceBasis({
  spaceId,
  entityIds,
  limit = 4,
}: LabEvidenceBasisProps) {
  const [rollup, setRollup] = useState<RollupResponse>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!spaceId || entityIds.length === 0) {
      setRollup({ rows: [], total: 0 });
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetchRollup(spaceId, entityIds, ctrl.signal)
      .then((r) => setRollup(r))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
    // entity-id fingerprint via stringification — keeps the effect
    // stable across reorderings while still re-fetching on scope
    // change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, entityIds.slice().sort().join(",")]);

  return (
    <section className="border-b border-white/[0.06] bg-[rgba(8,12,22,0.5)] px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[#7a8da8]">
          <FileBarChart className="h-3 w-3" />
          Evidence Basis
        </h3>
        {rollup.total > 0 && (
          <span className="text-[9px] font-medium text-[#6a7a95]">
            {rollup.total} attached
          </span>
        )}
      </div>

      {loading && rollup.rows.length === 0 && (
        <div className="text-[10.5px] italic text-[#6a7a95]">
          Loading evidence…
        </div>
      )}

      {!loading && rollup.rows.length === 0 && (
        <div className="text-[10.5px] italic text-[#6a7a95]">
          No evidence attached to in-scope entities. Drop a paper on the
          canvas + run extraction to bind effect-size rows.
        </div>
      )}

      {rollup.rows.length > 0 && (
        <ul className="space-y-1.5">
          {rollup.rows.slice(0, limit).map((row) => {
            const ci =
              row.ci_lower !== null && row.ci_upper !== null
                ? `[${row.ci_lower}, ${row.ci_upper}]`
                : null;
            const reviewed = row.status === "reviewed";
            return (
              <li
                key={row.id}
                className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5"
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[10.5px] font-bold text-emerald-300">
                    {row.effect_metric ?? "effect"}{" "}
                    {row.effect_size !== null ? row.effect_size : "—"}
                  </span>
                  {ci && (
                    <span className="font-mono text-[9.5px] text-[#7a8da8]">
                      {ci}
                    </span>
                  )}
                  <span
                    className={`ml-auto rounded px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider ${
                      reviewed
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {reviewed ? "reviewed" : "pending"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-[#a8b8d0]">
                  {row.outcome_label ?? row.intervention_label ?? "Untitled"}
                </div>
                {row.study_design && (
                  <div className="text-[9px] text-[#6a7a95]">
                    {row.study_design}
                    {row.population_label ? ` · ${row.population_label}` : ""}
                  </div>
                )}
              </li>
            );
          })}
          {rollup.total > limit && (
            <li className="text-[9.5px] italic text-[#6a7a95]">
              +{rollup.total - limit} more — open Evidence drawer for full list
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
