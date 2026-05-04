"use client";

// ── TwinEntityAttribution ────────────────────────────────────────────
//
// Per-entity breakdown of how each entity moves the twin's health
// score. Reads `entities` and `cycles` from the space context, runs
// `computeEntityHealthContributions` (defined alongside computeTwinState
// — already exported, never surfaced before), and renders the result as
// two stacked horizontal bars: positive contributors and negative
// contributors, each ranked by magnitude.
//
// The reason field from each contribution is shown inline as a chip
// list ("high confidence", "leverage point", "critical risk", "harmful
// ambiguity", etc.) so the user can see *why* a given entity helps or
// hurts the score, not just that it does.
//
// This is the "twin is legible" surface — closes the gap between
// "health = 67" and "I can audit which entities drove that".

import { useMemo } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import { computeEntityHealthContributions, type EntityHealthContribution } from "@/lib/twin/compute-twin-state";
import type { Entity, Cycle } from "@/types";

interface Props {
  /** How many of the top contributors and detractors to show. Default 6+6. */
  topN?: number;
}

interface RankedRow {
  entity: Entity;
  contribution: number;
  reason: string;
}

export function TwinEntityAttribution({ topN = 6 }: Props) {
  const { entities, cycles } = useSpaceData();

  const { positives, negatives, totalPositive, totalNegative, maxAbs } = useMemo(() => {
    const contribs = computeEntityHealthContributions(entities as Entity[], cycles as Cycle[]);
    const entityById = new Map<string, Entity>();
    for (const e of entities as Entity[]) entityById.set(e.id, e);

    const all: RankedRow[] = [];
    contribs.forEach((c: EntityHealthContribution, id: string) => {
      const ent = entityById.get(id);
      if (!ent) return;
      all.push({ entity: ent, contribution: c.contribution, reason: c.reason });
    });

    const pos = all
      .filter((r) => r.contribution > 0)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, topN);
    const neg = all
      .filter((r) => r.contribution < 0)
      .sort((a, b) => a.contribution - b.contribution)
      .slice(0, topN);

    const tp = all.filter((r) => r.contribution > 0).reduce((s, r) => s + r.contribution, 0);
    const tn = all.filter((r) => r.contribution < 0).reduce((s, r) => s + r.contribution, 0);
    const mx = Math.max(
      0.1,
      ...pos.map((r) => r.contribution),
      ...neg.map((r) => Math.abs(r.contribution)),
    );

    return {
      positives: pos,
      negatives: neg,
      totalPositive: tp,
      totalNegative: tn,
      maxAbs: mx,
    };
  }, [entities, cycles, topN]);

  if (positives.length === 0 && negatives.length === 0) {
    return (
      <Shell>
        <Header />
        <div className="px-4 pb-4 text-[12px] leading-relaxed text-[color:var(--muted-fg,#86868b)]">
          No entity-level health contributions yet. As entities gain
          confidence, role flags (leverage / risk / bottleneck), or
          enter feedback loops, their contributions will appear here.
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Header
        positiveTotal={totalPositive}
        negativeTotal={totalNegative}
        coveredEntities={positives.length + negatives.length}
      />

      <div className="grid grid-cols-1 gap-4 px-4 pb-4 lg:grid-cols-2">
        <Column
          title="Helps health"
          rows={positives}
          maxAbs={maxAbs}
          accent="#30D158"
          direction="positive"
        />
        <Column
          title="Hurts health"
          rows={negatives}
          maxAbs={maxAbs}
          accent="#FF453A"
          direction="negative"
        />
      </div>
    </Shell>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="relative overflow-hidden rounded-[18px] border border-white/60 bg-gradient-to-br from-white/85 via-white/70 to-white/55 shadow-[0_4px_14px_rgba(15,23,42,0.04)]"
      style={{
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
      aria-label="Twin entity attribution"
    >
      {children}
    </section>
  );
}

function Header({
  positiveTotal,
  negativeTotal,
  coveredEntities,
}: {
  positiveTotal?: number;
  negativeTotal?: number;
  coveredEntities?: number;
}) {
  const net =
    positiveTotal != null && negativeTotal != null
      ? positiveTotal + negativeTotal
      : null;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/40 px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className="h-[6px] w-[6px] rounded-full"
          style={{
            background: net == null ? "#86868B" : net >= 0 ? "#30D158" : "#FF453A",
            boxShadow:
              net == null
                ? undefined
                : `0 0 10px ${net >= 0 ? "#30D158AA" : "#FF453AAA"}`,
          }}
        />
        <div>
          <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[color:var(--muted-fg,#6b7280)]">
            Entity Attribution
          </div>
          <div className="mt-0.5 text-[13px] font-medium text-[color:var(--fg,#1d1d1f)]">
            {coveredEntities == null
              ? "How each entity moves the score"
              : `${coveredEntities} entit${coveredEntities === 1 ? "y" : "ies"} contribute net-non-zero`}
          </div>
        </div>
      </div>
      {net != null ? (
        <div
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums"
          style={{
            color: net >= 0 ? "#30D158" : "#FF453A",
            borderColor: net >= 0 ? "#30D15855" : "#FF453A55",
            background: net >= 0 ? "#30D15812" : "#FF453A12",
          }}
          title={`+${formatPts(positiveTotal ?? 0)} from helpers · ${formatPts(negativeTotal ?? 0)} from detractors`}
        >
          {net >= 0 ? "+" : ""}
          {formatPts(net)} net
        </div>
      ) : null}
    </div>
  );
}

function Column({
  title,
  rows,
  maxAbs,
  accent,
  direction,
}: {
  title: string;
  rows: RankedRow[];
  maxAbs: number;
  accent: string;
  direction: "positive" | "negative";
}) {
  if (rows.length === 0) {
    return (
      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#6b7280)]">
          {title}
        </div>
        <div className="rounded-lg border border-white/40 bg-white/30 px-3 py-2 text-[11px] text-[color:var(--muted-fg,#86868b)]">
          None yet.
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#6b7280)]">
        {title}
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <Row
            key={r.entity.id}
            row={r}
            maxAbs={maxAbs}
            accent={accent}
            direction={direction}
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  row,
  maxAbs,
  accent,
  direction,
}: {
  row: RankedRow;
  maxAbs: number;
  accent: string;
  direction: "positive" | "negative";
}) {
  const magnitude = Math.abs(row.contribution);
  const widthPct = Math.min(100, (magnitude / maxAbs) * 100);
  const sign = direction === "positive" ? "+" : "−";
  return (
    <li
      className="rounded-md px-2 py-1.5 transition-colors hover:bg-black/[0.025]"
      title={`${row.entity.name}: ${sign}${magnitude.toFixed(1)} pts — ${row.reason}`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-[color:var(--fg,#1d1d1f)]">
          {row.entity.name}
        </span>
        <span
          className="whitespace-nowrap font-mono text-[11px] font-semibold tabular-nums"
          style={{ color: accent }}
        >
          {sign}
          {magnitude.toFixed(1)}
        </span>
      </div>
      <div className="relative h-[5px] w-full overflow-hidden rounded-full bg-black/[0.04]">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${widthPct}%`, background: accent, opacity: 0.85 }}
        />
      </div>
      {row.reason ? (
        <div className="mt-0.5 line-clamp-1 text-[10.5px] text-[color:var(--muted-fg,#86868b)]">
          {row.reason}
        </div>
      ) : null}
    </li>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatPts(n: number): string {
  return n.toFixed(1);
}
