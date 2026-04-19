/**
 * Build metric_trackers rows from a confirmed StrategicRecommendation.
 *
 * The LLM generates 10–25 metrics per strategy across perspectives, tactics,
 * learning loop indicators, and the target objective. This helper normalizes
 * them into upsertable rows keyed by a stable `source_key` so regeneration
 * keeps identity for name-stable metrics (tactics have real IDs; perspectives
 * / indicators use deterministic slugs).
 */

import type { StrategicRecommendation } from "@/types/strategy";
import type { DataCategory, DepthTier } from "@/types/consent";
import { classifyTracker } from "@/lib/strategy/classify-tracker";

export type TrackerSourceKind =
  | "goal"
  | "target_objective"
  | "perspective_key_metric"
  | "micro_tactic_metric"
  | "leading_indicator"
  | "lagging_indicator";

export interface TrackerRowInsert {
  space_id: string;
  user_id: string;
  source_kind: TrackerSourceKind;
  source_key: string;
  source_id: string | null;
  label: string;
  measurement_method: string | null;
  unit: string | null;
  cadence: "daily" | "weekly" | "biweekly" | "monthly" | "adhoc";
  baseline_value: number | null;
  current_value: number | null;
  target_value: number | null;
  baseline_text: string | null;
  current_text: string | null;
  target_text: string | null;
  green_reading: string | null;
  yellow_reading: string | null;
  red_reading: string | null;
  strategy_generated_at: string | null;
  status: "active";
  metric_definition: Record<string, unknown> | null;

  // Phase 4a classification — enables consent filtering and future UPF selection.
  depth_tier: DepthTier;
  friction_cost: number;
  data_category: DataCategory;
}

// ── Helpers ──

function slugify(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unnamed";
}

/**
 * Try to extract a numeric value from a string like "12", "12%", "$1,200", "1.5M".
 * Returns null if nothing parseable is found.
 */
function parseNumeric(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return null;
  // Strip common formatting
  const cleaned = s.replace(/[,$\s%]/g, "");
  // Handle shorthand multipliers
  const shorthandMatch = cleaned.match(/^(-?\d*\.?\d+)([kmb])$/i);
  if (shorthandMatch) {
    const [, n, suffix] = shorthandMatch;
    const mult = suffix.toLowerCase() === "k" ? 1e3 : suffix.toLowerCase() === "m" ? 1e6 : 1e9;
    const v = parseFloat(n) * mult;
    return Number.isFinite(v) ? v : null;
  }
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : null;
}

/** Safe string access; returns null if empty or not a string. */
function asText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── Main ──

export interface BuildTrackerRowsArgs {
  spaceId: string;
  userId: string;
  recommendation: StrategicRecommendation;
  strategyGeneratedAt?: string | null;
}

// Internal row type before classification — lets the per-source push sites stay
// minimal; we enrich with depth_tier/friction_cost/data_category in one pass at
// the end (below, before dedup) so the UPF classifier is called once per row.
type UnclassifiedRow = Omit<TrackerRowInsert, "depth_tier" | "friction_cost" | "data_category">;

export function buildTrackerRowsFromStrategy(args: BuildTrackerRowsArgs): TrackerRowInsert[] {
  const { spaceId, userId, recommendation, strategyGeneratedAt } = args;
  const rows: UnclassifiedRow[] = [];
  const genAt = strategyGeneratedAt ?? null;

  const base = {
    space_id: spaceId,
    user_id: userId,
    status: "active" as const,
    strategy_generated_at: genAt,
  };

  // ── target_objective ──
  if (recommendation.target_objective) {
    const tgt = recommendation.target_objective;
    rows.push({
      ...base,
      source_kind: "target_objective",
      source_key: "target_objective",
      source_id: null,
      label: tgt.title || tgt.metric || "Target objective",
      measurement_method: null,
      unit: null,
      cadence: "adhoc",
      baseline_value: null,
      current_value: parseNumeric(tgt.current),
      target_value: parseNumeric(tgt.target),
      baseline_text: null,
      current_text: asText(tgt.current),
      target_text: asText(tgt.target),
      green_reading: null,
      yellow_reading: null,
      red_reading: null,
      metric_definition: tgt as unknown as Record<string, unknown>,
    });
  }

  // ── perspectives[].key_metric ──
  for (const p of recommendation.perspectives ?? []) {
    const km = p.key_metric;
    if (!km || !km.name) continue;
    const perspSlug = slugify(p.id ?? p.name);
    rows.push({
      ...base,
      source_kind: "perspective_key_metric",
      source_key: `perspective:${perspSlug}:key_metric`,
      source_id: p.id ?? null,
      label: `${p.name} — ${km.name}`,
      measurement_method: null,
      unit: asText(km.unit),
      cadence: "adhoc",
      baseline_value: null,
      current_value: parseNumeric(km.current),
      target_value: parseNumeric(km.target),
      baseline_text: null,
      current_text: asText(km.current),
      target_text: asText(km.target),
      green_reading: null,
      yellow_reading: null,
      red_reading: null,
      metric_definition: km as unknown as Record<string, unknown>,
    });
  }

  // ── micro_tactics[].metric ──
  for (const t of recommendation.micro_tactics ?? []) {
    const m = t.metric;
    if (!m || !m.name) continue;
    rows.push({
      ...base,
      source_kind: "micro_tactic_metric",
      source_key: `tactic:${t.id}:metric`,
      source_id: t.id,
      label: `${t.title || t.entity_name || "Tactic"} — ${m.name}`,
      measurement_method: null,
      unit: asText(m.unit),
      cadence: "adhoc",
      baseline_value: null,
      current_value: parseNumeric(m.current_value),
      target_value: parseNumeric(m.target),
      baseline_text: null,
      current_text: asText(m.current_value),
      target_text: asText(m.target),
      green_reading: null,
      yellow_reading: null,
      red_reading: null,
      metric_definition: m as unknown as Record<string, unknown>,
    });
  }

  // ── learning_loop.leading_indicators[] ──
  const learn = recommendation.learning_loop;
  if (learn?.leading_indicators?.length) {
    for (const li of learn.leading_indicators) {
      if (!li.metric) continue;
      rows.push({
        ...base,
        source_kind: "leading_indicator",
        source_key: `leading_indicator:${slugify(li.metric)}`,
        source_id: null,
        label: li.metric,
        measurement_method: asText(li.measurement_method),
        unit: null,
        cadence: (li.cadence ?? "adhoc") as TrackerRowInsert["cadence"],
        baseline_value: null,
        current_value: null,
        target_value: null,
        baseline_text: null,
        current_text: null,
        target_text: null,
        green_reading: asText(li.green_reading),
        yellow_reading: asText(li.yellow_reading),
        red_reading: asText(li.red_reading),
        metric_definition: li as unknown as Record<string, unknown>,
      });
    }
  }

  // ── learning_loop.lagging_indicator ──
  if (learn?.lagging_indicator?.metric) {
    const lag = learn.lagging_indicator;
    rows.push({
      ...base,
      source_kind: "lagging_indicator",
      source_key: "lagging_indicator",
      source_id: null,
      label: lag.metric,
      measurement_method: null,
      unit: null,
      cadence: "adhoc",
      baseline_value: null,
      current_value: null,
      target_value: parseNumeric(lag.target),
      baseline_text: null,
      current_text: null,
      target_text: asText(lag.target),
      green_reading: null,
      yellow_reading: null,
      red_reading: null,
      metric_definition: lag as unknown as Record<string, unknown>,
    });
  }

  // Deduplicate on source_key (safety: if slugs collide, keep first occurrence).
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const k = `${r.source_kind}|${r.source_key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Phase 4a: classify every row (depth_tier / friction_cost / data_category).
  return deduped.map((r) => ({
    ...r,
    ...classifyTracker({
      sourceKind: r.source_kind,
      label: r.label,
      measurementMethod: r.measurement_method,
    }),
  }));
}

/** Count trackers by source_kind — useful for changelog details. */
export function tallyTrackersByKind(rows: TrackerRowInsert[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.source_kind] = (out[r.source_kind] ?? 0) + 1;
  return out;
}
