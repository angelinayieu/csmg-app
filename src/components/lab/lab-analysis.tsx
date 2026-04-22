"use client";

import type { Entity } from "@/types";
import type { FailurePoint } from "@/types/probability-space";
import { useProbabilitySpaces } from "@/lib/hooks/use-probability-spaces";

export interface LabAnalysisProps {
  focal: Entity;
  subunits: Entity[];
  /** When provided, enables the Failure Points section backed by probability spaces. */
  spaceId?: string;
}

const BLAST_COLOR: Record<FailurePoint["blast_radius"], string> = {
  local: "#fbbf24",
  cascading: "#fb923c",
  systemic: "#ef4444",
};

const CATEGORY_COLOR: Record<string, string> = {
  concrete: "#4ade80",
  abstract: "#a78bfa",
  process: "#fbbf24",
  relational: "#22d3ee",
  epistemic: "#f472b6",
  fault: "#ef4444",
};

export function LabAnalysis({ focal, subunits, spaceId }: LabAnalysisProps) {
  const confidencePct = Math.round(((focal.confidence as number | null) ?? 0.8) * 100);
  const blast = Math.round(((focal.blast_radius as number | null) ?? 0) * 100) / 100;
  const analysisCount = (focal.analysis_count as number | null) ?? 0;

  const { spaces: probSpaces } = useProbabilitySpaces({
    spaceId: spaceId ?? "",
    focalEntityId: focal.id,
    enabled: !!spaceId,
  });

  // Deduplicate failure points by node_id, keeping the worst blast radius seen.
  const failurePoints: Array<FailurePoint & { space_label: string }> = (() => {
    const byKey = new Map<string, FailurePoint & { space_label: string }>();
    const rank: Record<FailurePoint["blast_radius"], number> = {
      local: 1,
      cascading: 2,
      systemic: 3,
    };
    for (const s of probSpaces) {
      const otherName = s.source_entity_id === focal.id ? s.target_entity_name : s.source_entity_name;
      for (const f of s.failure_points) {
        const prev = byKey.get(f.node_id);
        if (!prev || rank[f.blast_radius] > rank[prev.blast_radius]) {
          byKey.set(f.node_id, { ...f, space_label: otherName });
        }
      }
    }
    return Array.from(byKey.values()).sort(
      (a, b) => rank[b.blast_radius] - rank[a.blast_radius] || b.failure_probability - a.failure_probability,
    );
  })();

  const provenance = (focal.provenance as Record<string, unknown> | null) ?? null;
  const sourceType = provenance?.["source_type"] as string | undefined;
  const parentName = provenance?.["parent_name"] as string | undefined;

  return (
    <aside className="flex h-full flex-col overflow-y-auto bg-[var(--lab-panel-bg)] px-3.5 py-3.5">
      {/* Vitals */}
      <Section title="Vitals">
        <div className="grid grid-cols-2 gap-1.5">
          <StatCell label="Confidence" value={`${confidencePct}`} unit="%" accent="#4ade80" />
          <StatCell
            label="Importance"
            value={(focal.importance ?? "mod").slice(0, 3).toUpperCase()}
            accent="#fbbf24"
          />
          <StatCell label="Blast radius" value={blast.toFixed(2)} accent="#22d3ee" />
          <StatCell
            label="Analyzed"
            value={analysisCount.toString()}
            unit="×"
            accent="#f472b6"
          />
        </div>
      </Section>

      {/* Composition */}
      <Section title="Composition" count={subunits.length}>
        {subunits.length === 0 ? (
          <div className="px-1 py-2 text-[10px] italic text-[var(--lab-text-faint)]">
            No subunits decomposed yet.
          </div>
        ) : (
          subunits.map((s) => {
            const cat = (s.entity_category as string) ?? "concept";
            const color = CATEGORY_COLOR[cat] ?? "#4ade80";
            const w = Math.round(((s.confidence as number | null) ?? 0.7) * 100);
            return (
              <div
                key={s.id}
                className="flex items-center gap-2 border-b border-[var(--lab-border)] py-1.5 text-[10px]"
              >
                <div
                  className="w-[22px] text-center font-mono font-bold"
                  style={{ color }}
                >
                  ◆
                </div>
                <div className="flex-1 truncate text-[10.5px] text-[var(--lab-text-mid)]">
                  {s.name}
                </div>
                <div className="h-[3px] w-[60px] overflow-hidden rounded-[1px] bg-[var(--lab-panel-raised)]">
                  <div
                    className="h-full"
                    style={{
                      width: `${w}%`,
                      background: color,
                      boxShadow: `0 0 4px ${color}`,
                      opacity: 0.8,
                    }}
                  />
                </div>
                <div className="w-[30px] text-right font-mono font-semibold tabular-nums text-[var(--lab-text)]">
                  {w}
                </div>
              </div>
            );
          })
        )}
      </Section>

      {/* Failure points — only when probability spaces are fetched */}
      {spaceId && (
        <Section title="Failure Points" count={failurePoints.length}>
          {failurePoints.length === 0 ? (
            <div className="px-1 py-2 text-[10px] italic text-[var(--lab-text-faint)]">
              No failure points in surrounding probability space.
            </div>
          ) : (
            failurePoints.slice(0, 8).map((f) => {
              const color = BLAST_COLOR[f.blast_radius];
              const pct = Math.round(f.failure_probability * 100);
              return (
                <div
                  key={f.node_id}
                  className="flex items-center gap-2 border-b border-[var(--lab-border)] py-1.5 text-[10px]"
                  title={`${f.failure_mode}${f.classification_rationale ? `\n${f.classification_rationale}` : ""}`}
                >
                  <div
                    className="w-[22px] text-center font-mono font-bold"
                    style={{ color }}
                  >
                    ◇
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="truncate text-[10.5px] text-[var(--lab-text)]">
                      {f.node_name}
                    </div>
                    <div
                      className="truncate text-[8.5px] font-mono uppercase tracking-[0.14em]"
                      style={{ color }}
                    >
                      {f.blast_radius} · via {f.space_label}
                    </div>
                  </div>
                  <div className="w-[30px] text-right font-mono font-semibold tabular-nums text-[var(--lab-text)]">
                    {pct}%
                  </div>
                </div>
              );
            })
          )}
        </Section>
      )}

      {/* Evidence / Provenance */}
      <Section title="Provenance">
        <ProvRow k="Entity id" v={focal.entity_id} />
        <ProvRow k="Layer" v={focal.layer ?? "(none)"} />
        <ProvRow
          k="Depth"
          v={
            typeof (focal as unknown as { depth?: number | null }).depth === "number"
              ? String((focal as unknown as { depth?: number | null }).depth)
              : "(n/a)"
          }
        />
        <ProvRow k="Source" v={focal.source_tag ?? "implicit"} />
        {sourceType && <ProvRow k="Origin" v={sourceType.replace(/_/g, " ")} />}
        {parentName && <ProvRow k="Parent" v={parentName} />}
        {focal.last_analyzed_at && (
          <ProvRow
            k="Last analyzed"
            v={new Date(focal.last_analyzed_at).toLocaleDateString()}
          />
        )}
      </Section>

      {focal.description && (
        <Section title="Description">
          <p className="text-[11px] leading-relaxed text-[var(--lab-text-mid)]">{focal.description}</p>
        </Section>
      )}
    </aside>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-[var(--lab-text-dim)]">
          {title}
        </div>
        <div className="h-px flex-1 bg-[var(--lab-border-strong)]" />
        {count !== undefined && (
          <div className="font-mono text-[9px] text-[var(--lab-text-faint)]">{count}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function StatCell({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[2px] border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] px-2.5 py-2"
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-[2px]"
        style={{ background: accent, opacity: 0.4 }}
      />
      <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-text-dim)]">
        {label}
      </div>
      <div className="font-mono text-[20px] leading-none tabular-nums text-[var(--lab-text)]">
        {value}
        {unit && <span className="ml-1 text-[9px] text-[var(--lab-text-dim)]">{unit}</span>}
      </div>
    </div>
  );
}

function ProvRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-[var(--lab-border)] py-1 text-[10px]">
      <span className="text-[var(--lab-text-dim)]">{k}</span>
      <span className="max-w-[60%] truncate font-mono font-medium tabular-nums text-[var(--lab-text-mid)]">
        {v}
      </span>
    </div>
  );
}
