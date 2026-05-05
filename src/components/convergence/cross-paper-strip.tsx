"use client";

// ── Cross-paper synthesis strip ──────────────────────────────────
//
// Mounted at the top of the Convergence tab when the active space has
// ≥2 ingested papers in `evidence_registries`. Renders three columns —
// recurring claims, contradictions, under-supported critical entities —
// each with the top 3 cards. Click a card → expands inline with the
// full paper list + effect sizes.
//
// Suppress entirely when:
//   - synthesis hasn't run yet (no evidence to read)
//   - the endpoint returned 0 papers (no cross-source comparison
//     possible)
//   - we're loading or errored
//
// Single-paper case shows a quiet "upload more papers to unlock" CTA
// strip instead of the full grid.

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Layers,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CrossPaperSynthesis,
  RecurringClaim,
  Contradiction,
  UnderSupportedClaim,
} from "@/types/cross-paper-synthesis";

interface Props {
  spaceId: string;
  className?: string;
}

const TOP_N_PER_COLUMN = 3;

export function CrossPaperStrip({ spaceId, className }: Props) {
  const [data, setData] = useState<CrossPaperSynthesis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/cross-paper-synthesis`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      const payload = (await res.json()) as CrossPaperSynthesis;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const totalFindings = useMemo(() => {
    if (!data) return 0;
    return (
      data.recurring.length +
      data.contradictions.length +
      data.under_supported.length
    );
  }, [data]);

  // Collapse cases where the strip would be empty / pre-empty:
  if (loading) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-gray-100 bg-white px-5 py-3.5",
          className,
        )}
      >
        <div className="h-3 w-48 animate-pulse rounded bg-gray-100" />
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="h-16 animate-pulse rounded-lg bg-gray-50" />
          <div className="h-16 animate-pulse rounded-lg bg-gray-50" />
          <div className="h-16 animate-pulse rounded-lg bg-gray-50" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-2xl border border-red-100 bg-red-50/40 px-4 py-2.5 text-[11.5px] text-red-700",
          className,
        )}
      >
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span className="font-semibold">
          Cross-paper synthesis unavailable.
        </span>
        <span className="truncate text-red-600/80">{error}</span>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void fetchData();
          }}
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-red-200 bg-white text-red-700 hover:bg-red-50"
        >
          <RefreshCw className="h-2.5 w-2.5" />
          retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  // Zero-paper case — completely silent. Strip would just be noise.
  if (data.counts.total_papers === 0) return null;

  // Single-paper case — soft CTA, doesn't try to fake findings.
  if (data.counts.total_papers === 1) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-5 py-3 text-[11.5px] text-gray-600",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-gray-400" />
          <span className="font-semibold text-gray-700">
            Cross-paper synthesis
          </span>
          <span className="text-gray-400">·</span>
          <span>
            1 paper extracted — upload at least one more to unlock recurring
            claims, contradictions, and gap detection.
          </span>
        </div>
      </div>
    );
  }

  // Two+ papers but the algorithm produced zero findings — also keep
  // quiet. Could happen with very short papers or all-temporal-only rows.
  if (totalFindings === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-5 py-3 text-[11.5px] text-gray-600",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-gray-400" />
          <span className="font-semibold text-gray-700">
            Cross-paper synthesis
          </span>
          <span className="text-gray-400">·</span>
          <span>
            {data.counts.total_papers} papers indexed, {data.counts.total_evidence_rows} evidence rows. No
            recurring claims yet — uploaded papers may cover non-overlapping
            interventions.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-gray-100 bg-white shadow-sm",
        className,
      )}
    >
      {/* Header row */}
      <div className="border-b border-gray-100 px-5 py-3 flex items-center gap-2">
        <Layers className="h-3.5 w-3.5 text-violet-600" />
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">
          Cross-paper synthesis
        </span>
        <span className="text-gray-400">·</span>
        <span className="text-[11px] font-semibold text-gray-700">
          from {data.counts.total_papers} papers
        </span>
        <span className="text-gray-400">·</span>
        <span className="text-[11px] text-gray-500 tabular-nums">
          {data.counts.total_evidence_rows} evidence rows
        </span>
      </div>

      {/* Three-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-gray-100">
        <RecurringColumn
          claims={data.recurring}
          expanded={expanded}
          onToggle={(id) => setExpanded(expanded === id ? null : id)}
        />
        <ContradictionsColumn
          items={data.contradictions}
          expanded={expanded}
          onToggle={(id) => setExpanded(expanded === id ? null : id)}
        />
        <GapsColumn items={data.under_supported} />
      </div>
    </div>
  );
}

// ── Recurring column ─────────────────────────────────────────────

function RecurringColumn({
  claims,
  expanded,
  onToggle,
}: {
  claims: RecurringClaim[];
  expanded: string | null;
  onToggle: (id: string) => void;
}) {
  const visible = claims.slice(0, TOP_N_PER_COLUMN);
  return (
    <div className="bg-white p-4">
      <ColumnHeader
        title="Recurring claims"
        count={claims.length}
        tone="emerald"
      />
      {visible.length === 0 ? (
        <EmptyHint text="No claim appears in ≥2 papers yet." />
      ) : (
        <ul className="space-y-2">
          {visible.map((c) => {
            const isExp = expanded === c.id;
            return (
              <li
                key={c.id}
                className="rounded-lg ring-1 ring-emerald-100 bg-emerald-50/30"
              >
                <button
                  type="button"
                  onClick={() => onToggle(c.id)}
                  className="w-full text-left px-3 py-2 text-[11.5px] hover:bg-emerald-50/60 rounded-lg"
                >
                  <div className="font-semibold text-gray-900 leading-snug">
                    {c.representative_text}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-emerald-700 tabular-nums">
                    {c.paper_count} papers
                    {c.aggregate_effect && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span>
                          mean {formatEffect(c.aggregate_effect.mean)} ±{" "}
                          {formatEffect(c.aggregate_effect.se)} (
                          {c.aggregate_effect.metric})
                        </span>
                      </>
                    )}
                  </div>
                </button>
                {isExp && <RecurringDetail claim={c} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RecurringDetail({ claim }: { claim: RecurringClaim }) {
  return (
    <div className="px-3 pb-3 pt-1 border-t border-emerald-100/60 text-[10.5px] text-gray-600 space-y-1">
      {claim.papers.map((p) => (
        <div
          key={p.asset_id}
          className="flex items-center gap-2 tabular-nums"
        >
          <span className="truncate flex-1 text-gray-800">{p.title}</span>
          {p.effect_size !== null && (
            <span
              className={cn(
                "font-mono",
                p.direction === "supports"
                  ? "text-emerald-700"
                  : p.direction === "contradicts"
                    ? "text-rose-700"
                    : "text-gray-500",
              )}
            >
              {formatEffect(p.effect_size)}
            </span>
          )}
          {p.n_treatment !== null && (
            <span className="text-gray-400">n={p.n_treatment}</span>
          )}
        </div>
      ))}
      {claim.aggregate_effect &&
        claim.aggregate_effect.heterogeneity_i2 !== null && (
          <div className="pt-1 mt-1 border-t border-emerald-100/40 text-[10px] text-gray-500">
            heterogeneity I² ={" "}
            {Math.round(claim.aggregate_effect.heterogeneity_i2 * 100)}%
            {claim.aggregate_effect.metric === "mixed" && (
              <span className="ml-1 text-amber-700">
                · mixed metrics — interpret with caution
              </span>
            )}
          </div>
        )}
    </div>
  );
}

// ── Contradictions column ────────────────────────────────────────

function ContradictionsColumn({
  items,
  expanded,
  onToggle,
}: {
  items: Contradiction[];
  expanded: string | null;
  onToggle: (id: string) => void;
}) {
  const visible = items.slice(0, TOP_N_PER_COLUMN);
  return (
    <div className="bg-white p-4">
      <ColumnHeader
        title="Contradictions"
        count={items.length}
        tone="rose"
      />
      {visible.length === 0 ? (
        <EmptyHint text="No contradicting evidence detected — recurring claims agree on direction." />
      ) : (
        <ul className="space-y-2">
          {visible.map((c) => {
            const isExp = expanded === c.id;
            const sev = c.severity;
            const sevLabel =
              sev === "high" ? "high" : sev === "medium" ? "moderate" : "low";
            const sevTone =
              sev === "high"
                ? "text-rose-700 bg-rose-100"
                : sev === "medium"
                  ? "text-amber-700 bg-amber-100"
                  : "text-gray-700 bg-gray-100";
            return (
              <li
                key={c.id}
                className="rounded-lg ring-1 ring-rose-100 bg-rose-50/30"
              >
                <button
                  type="button"
                  onClick={() => onToggle(c.id)}
                  className="w-full text-left px-3 py-2 text-[11.5px] hover:bg-rose-50/60 rounded-lg"
                >
                  <div className="font-semibold text-gray-900 leading-snug flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3 text-rose-600 shrink-0" />
                    {c.representative_text}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-rose-700 tabular-nums flex items-center gap-1.5">
                    <span>
                      {c.supporting_papers.length} support /{" "}
                      {c.contradicting_papers.length} contradict
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-[1px] text-[9.5px] font-semibold",
                        sevTone,
                      )}
                    >
                      {sevLabel}
                    </span>
                  </div>
                </button>
                {isExp && <ContradictionDetail item={c} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ContradictionDetail({ item }: { item: Contradiction }) {
  return (
    <div className="px-3 pb-3 pt-1 border-t border-rose-100/60 text-[10.5px] space-y-1.5">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 mb-0.5">
          Supports ({item.supporting_papers.length})
        </div>
        {item.supporting_papers.map((p) => (
          <div key={p.asset_id} className="flex items-center gap-2 tabular-nums">
            <span className="truncate flex-1 text-gray-800">{p.title}</span>
            {p.effect_size !== null && (
              <span className="font-mono text-emerald-700">
                {formatEffect(p.effect_size)}
              </span>
            )}
          </div>
        ))}
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-700 mb-0.5">
          Contradicts ({item.contradicting_papers.length})
        </div>
        {item.contradicting_papers.map((p) => (
          <div key={p.asset_id} className="flex items-center gap-2 tabular-nums">
            <span className="truncate flex-1 text-gray-800">{p.title}</span>
            {p.effect_size !== null && (
              <span className="font-mono text-rose-700">
                {formatEffect(p.effect_size)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Gaps column ──────────────────────────────────────────────────

function GapsColumn({ items }: { items: UnderSupportedClaim[] }) {
  const visible = items.slice(0, TOP_N_PER_COLUMN);
  return (
    <div className="bg-white p-4">
      <ColumnHeader
        title="Under-supported"
        count={items.length}
        tone="amber"
        icon={<HelpCircle className="h-3 w-3" />}
      />
      {visible.length === 0 ? (
        <EmptyHint text="Every fundamental/critical entity has multi-paper support." />
      ) : (
        <ul className="space-y-2">
          {visible.map((u) => (
            <li
              key={u.entity_id}
              className="rounded-lg ring-1 ring-amber-100 bg-amber-50/30 px-3 py-2 text-[11.5px]"
            >
              <div className="font-semibold text-gray-900 leading-snug">
                {u.entity_name}
              </div>
              <div className="mt-0.5 text-[10.5px] text-amber-700 truncate">
                only 1 paper · {u.sole_paper.title}
              </div>
              {u.suggested_search && (
                <div className="mt-1 text-[10.5px] text-gray-500 italic line-clamp-2">
                  next: {u.suggested_search}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────

function ColumnHeader({
  title,
  count,
  tone,
  icon,
}: {
  title: string;
  count: number;
  tone: "emerald" | "rose" | "amber";
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "rose"
        ? "text-rose-700"
        : "text-amber-700";
  return (
    <div className="mb-2.5 flex items-center gap-1.5">
      {icon && <span className={toneClass}>{icon}</span>}
      <span
        className={cn(
          "text-[10px] font-bold uppercase tracking-[0.12em]",
          toneClass,
        )}
      >
        {title}
      </span>
      <span className="text-[10px] text-gray-400 tabular-nums">({count})</span>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="text-[10.5px] text-gray-500 italic leading-snug py-2">
      {text}
    </div>
  );
}

function formatEffect(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1) return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}
