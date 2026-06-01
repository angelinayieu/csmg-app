"use client";

// ── Situation Timeline (View 1) ────────────────────────────────────
//
// The iteration timeline for the situation model: each Deepen → v2 run
// recorded a structure snapshot (the ledger from
// /api/brainstorm/space/[id]/structure-snapshot), and this view plots
// them oldest→newest so you can see how the model GREW per iteration.
//
// White-minimal, date-grouped (the user's reference image 2). NO manual
// input — it's a read-only record of what the deepen passes produced.
//
// v1 metric = KG growth (Δ nodes/edges per iteration), which is real and
// already in the ledger's counts. "Value vs the macro objective"
// (twin_snapshots health series) is a follow-up enrichment — flagged in
// the empty/footer copy, not faked here.

const FONT =
  'Pretendard, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

const INK = {
  label: "rgba(15,23,42,0.84)",
  soft: "rgba(15,23,42,0.55)",
  faint: "rgba(15,23,42,0.4)",
  line: "rgba(15,23,42,0.12)",
  dot: "rgba(15,23,42,0.45)",
  gain: "rgba(22,163,74,0.95)",
  accent: "rgba(234,88,12,0.95)",
  paper: "#ffffff",
  stroke: "rgba(15,23,42,0.13)",
};

/** Lightweight snapshot row from GET /structure-snapshot (no payload). */
export interface SnapshotLite {
  id: string;
  created_at: string;
  reason: string;
  entity_count: number;
  edge_count: number;
  room_count: number;
  content_hash: string | null;
  /** Only from the detail endpoint (?id=) or the harness — lets the
   *  time-scrub filter the radial to this iteration's nodes. */
  entityIds?: string[];
  goalIds?: string[];
  /** Top entity names added vs. the prior iteration (from ?activities=1). */
  added?: string[];
}

/** A twin health reading (from /api/spaces/[id]/snapshots/history) — aligned
 *  per iteration as the "value vs. the macro objective" metric. */
export interface HealthPoint {
  captured_at: string;
  health_score: number;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface Props {
  snapshots: SnapshotLite[];
  /** Twin health series — aligned per iteration as the "value" metric. */
  healthPoints?: HealthPoint[];
}

export function SituationTimelineView({ snapshots, healthPoints }: Props) {
  // Oldest→newest to compute growth deltas, then render newest-first.
  const asc = [...snapshots].sort(
    (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
  );
  const health = [...(healthPoints ?? [])].sort(
    (a, b) => +new Date(a.captured_at) - +new Date(b.captured_at),
  );
  // Align an iteration to the latest health reading at/before its time;
  // returns a 0–100 value, or null when there's no health series yet.
  const valueAt = (iso: string): number | null => {
    if (health.length === 0) return null;
    const t = +new Date(iso);
    let chosen = health[0];
    for (const p of health) {
      if (+new Date(p.captured_at) <= t) chosen = p;
    }
    const s = chosen.health_score;
    return s <= 1 ? Math.round(s * 100) : Math.round(s);
  };
  const rows = asc.map((s, i) => {
    const prev = i > 0 ? asc[i - 1] : null;
    const dNodes = s.entity_count - (prev?.entity_count ?? 0);
    const dEdges = s.edge_count - (prev?.edge_count ?? 0);
    const value = valueAt(s.created_at);
    const prevValue = prev ? valueAt(prev.created_at) : null;
    const dValue =
      value != null && prevValue != null ? value - prevValue : null;
    return {
      ...s,
      iteration: i + 1,
      dNodes,
      dEdges,
      value,
      dValue,
      isFirst: i === 0,
    };
  });
  if (rows.length === 0) {
    return (
      <div
        className="mx-auto mt-3 w-full max-w-2xl rounded-2xl p-8 text-center"
        style={{
          background: INK.paper,
          border: `1px solid ${INK.stroke}`,
          fontFamily: FONT,
        }}
      >
        <div className="text-[13px] font-semibold" style={{ color: INK.label }}>
          No iterations yet
        </div>
        <p className="mt-1.5 text-[12px] leading-snug" style={{ color: INK.soft }}>
          Run <strong>Deepen → v2</strong> to grow the model. Each pass records
          an iteration here — you&apos;ll watch the knowledge graph expand over
          time.
        </p>
      </div>
    );
  }

  // Newest-first + per-row day header, precomputed (no render-time mutation).
  const display = [...rows].reverse().map((r, i, arr) => {
    const day = dayLabel(r.created_at);
    const prevDay = i > 0 ? dayLabel(arr[i - 1].created_at) : null;
    return { ...r, day, showDay: day !== prevDay };
  });

  return (
    <div
      className="mx-auto mt-3 w-full max-w-2xl rounded-2xl p-5"
      style={{
        background: INK.paper,
        border: `1px solid ${INK.stroke}`,
        fontFamily: FONT,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: INK.accent }}
          aria-hidden
        />
        <span
          className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: INK.soft }}
        >
          Timeline
        </span>
        <span className="ml-auto text-[11px]" style={{ color: INK.faint }}>
          {rows.length} iteration{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="relative mt-4 pl-5">
        {/* the spine */}
        <div
          className="absolute bottom-1 left-[5px] top-1 w-px"
          style={{ background: INK.line }}
          aria-hidden
        />
        <ul className="space-y-4" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {display.map((r) => {
            const grew = r.dNodes > 0 || r.dEdges > 0;
            return (
              <li key={r.id} className="relative">
                {r.showDay && (
                  <div
                    className="mb-2 text-[11px] font-semibold"
                    style={{ color: INK.label }}
                  >
                    {r.day}
                  </div>
                )}
                {/* dot */}
                <span
                  className="absolute -left-5 mt-[3px] inline-block h-2 w-2 rounded-full"
                  style={{
                    background: r.isFirst ? INK.dot : INK.accent,
                    boxShadow: `0 0 0 3px ${INK.paper}`,
                  }}
                  aria-hidden
                />
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="text-[12.5px] font-medium"
                    style={{ color: INK.label }}
                  >
                    {r.isFirst ? "Baseline" : `Deepen → v${r.iteration}`}
                  </span>
                  <span className="text-[11px]" style={{ color: INK.faint }}>
                    {timeLabel(r.created_at)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px]">
                  {r.value != null && (
                    <span style={{ color: INK.label, fontWeight: 600 }}>
                      value {r.value}%
                      {r.dValue != null && r.dValue !== 0 ? (
                        <span
                          style={{
                            color: r.dValue > 0 ? INK.gain : INK.faint,
                            fontWeight: 600,
                          }}
                        >
                          {" "}
                          {r.dValue > 0 ? "+" : ""}
                          {r.dValue}
                        </span>
                      ) : null}
                    </span>
                  )}
                  {!r.isFirst && grew && (
                    <span style={{ color: INK.gain, fontWeight: 600 }}>
                      +{r.dNodes} node{r.dNodes === 1 ? "" : "s"} · +{r.dEdges}{" "}
                      edge{r.dEdges === 1 ? "" : "s"}
                    </span>
                  )}
                  <span style={{ color: INK.soft }}>
                    {r.entity_count} nodes · {r.edge_count} edges ·{" "}
                    {r.room_count} room{r.room_count === 1 ? "" : "s"}
                  </span>
                </div>
                {r.added && r.added.length > 0 && (
                  <div
                    className="mt-0.5 text-[11px] leading-snug"
                    style={{ color: INK.soft }}
                  >
                    <span style={{ color: INK.faint }}>Added: </span>
                    {r.added.join(" · ")}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <p
        className="mt-4 border-t pt-3 text-[10.5px] leading-snug"
        style={{ borderColor: INK.line, color: INK.faint }}
      >
        Value = twin health vs. the macro objective · Growth = knowledge-graph
        expansion · Added = what each pass introduced.
      </p>
    </div>
  );
}
