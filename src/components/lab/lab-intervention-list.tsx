"use client";

// ── Lab Intervention List (Phase 5B) ─────────────────────────────
//
// Right-rail panel listing the intervention-kernel entities in scope
// with a small play-style icon + relevance ranking. Mirrors the
// photo's "Intervention" footer card.
//
// Source: filters the in-scope entities for those tagged as
// interventions (causal_role="application" OR entity_type matches
// /intervention/i OR entity_category="process" with verbs hint).
// Ranks by importance / leverage / blast radius.
//
// Click → focuses the entity in the reagent bay (dispatches a
// `lab:focus-subunit` window event the LabReagentBay listens for).

import { useMemo } from "react";
import type { Entity } from "@/types";
import { Beaker, Sparkles, Target } from "lucide-react";

interface LabInterventionListProps {
  entities: Entity[];
  /** Limit to top-N. Defaults to 5 — anything more becomes a list
   *  rather than a quick-pick pane. */
  limit?: number;
  onSelect?: (entityId: string) => void;
}

const INTERVENTION_VERBS = [
  "increase",
  "improve",
  "reduce",
  "train",
  "exercise",
  "rehearse",
  "supplement",
  "intervene",
  "manage",
  "modulate",
];

function isIntervention(e: Entity): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ee = e as any;
  if (ee.causal_role === "application") return true;
  const t = (ee.entity_type ?? "").toLowerCase();
  if (t === "intervention" || t.includes("intervention")) return true;
  if (t === "intervention_kernel") return true;
  const name = (ee.name ?? "").toLowerCase();
  if (INTERVENTION_VERBS.some((v) => name.startsWith(v + " "))) return true;
  return false;
}

function rankScore(e: Entity): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ee = e as any;
  const importanceWeight: Record<string, number> = {
    fundamental: 4,
    critical: 3,
    important: 2,
    moderate: 1,
  };
  const imp = importanceWeight[ee.importance ?? "moderate"] ?? 1;
  const lev = ee.is_leverage_point ? 1.5 : 0;
  const blast = typeof ee.blast_radius === "number" ? ee.blast_radius / 50 : 0;
  const conf = typeof ee.confidence === "number" ? ee.confidence : 0.5;
  return imp + lev + blast + conf;
}

export function LabInterventionList({
  entities,
  limit = 5,
  onSelect,
}: LabInterventionListProps) {
  const ranked = useMemo(() => {
    const candidates = entities.filter(isIntervention);
    candidates.sort((a, b) => rankScore(b) - rankScore(a));
    return candidates.slice(0, limit);
  }, [entities, limit]);

  if (ranked.length === 0) {
    return (
      <section className="border-b border-white/[0.06] bg-[rgba(8,12,22,0.5)] px-4 py-3">
        <h3 className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[#7a8da8]">
          Interventions
        </h3>
        <div className="text-[10.5px] italic text-[#6a7a95]">
          No interventions in scope. Add via +Intervention button or attach
          a paper that references one.
        </div>
      </section>
    );
  }

  return (
    <section className="border-b border-white/[0.06] bg-[rgba(8,12,22,0.5)] px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#7a8da8]">
          Interventions
        </h3>
        <span className="text-[9px] font-medium text-[#6a7a95]">
          {ranked.length} ranked
        </span>
      </div>

      <ol className="space-y-1.5">
        {ranked.map((e, i) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ee = e as any;
          const isLeverage = ee.is_leverage_point;
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect?.(e.id);
                  window.dispatchEvent(
                    new CustomEvent("lab:focus-subunit", {
                      detail: { entityId: e.id },
                    }),
                  );
                }}
                className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
                title={ee.description ?? ""}
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/5 text-[9.5px] font-mono font-bold text-[#a8b8d0] group-hover:bg-amber-500/20 group-hover:text-amber-300">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {isLeverage ? (
                      <Sparkles className="h-3 w-3 flex-shrink-0 text-amber-400" />
                    ) : ee.entity_category === "process" ? (
                      <Beaker className="h-3 w-3 flex-shrink-0 text-orange-400" />
                    ) : (
                      <Target className="h-3 w-3 flex-shrink-0 text-blue-400" />
                    )}
                    <span className="truncate text-[11px] font-medium text-[#e8edf4]">
                      {e.name}
                    </span>
                  </div>
                  {ee.entity_type && (
                    <div className="truncate text-[9.5px] text-[#7a8da8]">
                      {(ee.entity_type as string).replace(/_/g, " ")}
                      {ee.confidence !== undefined &&
                        ee.confidence !== null && (
                          <span className="ml-1.5 font-mono">
                            · {Math.round((ee.confidence as number) * 100)}%
                          </span>
                        )}
                    </div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
