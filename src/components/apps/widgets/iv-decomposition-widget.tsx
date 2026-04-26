"use client";

// ── IV Decomposition widget (VP Project — "decomposed prompt" viz) ─────
//
// The hero card of the experiment App. Given one active variant +
// the taxonomy schema, it paints a row of "slot rings" — one per
// independent variable — with:
//
//   • a colored ring whose fill reflects that slot's score
//   • the slot label + current value preview
//   • a tiny sparkline of recent per-slot scores (spark_points)
//   • a heat chip (how often that slot gets perturbed) + lift delta
//
// The whole layout is driven by the taxonomy row, NOT hardcoded to
// "Role / Task / Context / Constraint / Rubric". A prompt-domain
// space yields 5 prompt slots; a recipe-domain space yields 5 recipe
// slots; nothing else changes. The widget is the final visual output
// of the taxonomy-as-data pipeline delivered in the VP Project Report.

import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import type {
  VariantWithSlots,
  ExperimentTaxonomy,
  TaxonomySlot,
  ExperimentVariantSlot,
} from "@/types/experiment-taxonomy";
import { Surface, WidgetTitle, WidgetEmpty } from "./shared";
import { cn } from "@/lib/utils";

interface IVDecompositionConfig {
  /** Optional card title override. */
  title?: string;
  /** Render a compact single-line variant (no sparklines, no previews). */
  dense?: boolean;
  /** Hide the value previews (useful for read-only report layouts). */
  hidePreviews?: boolean;
}

export function IVDecomposition({
  instance,
  context,
}: WidgetComponentProps<IVDecompositionConfig>) {
  const cfg = instance.config ?? {};
  const variantRes = context.resolve<VariantWithSlots>(
    instance.bindings?.variant,
  );
  const taxonomyRes = context.resolve<ExperimentTaxonomy>(
    instance.bindings?.taxonomy,
  );

  const variant = variantRes.value ?? null;
  const taxonomy = taxonomyRes.value ?? null;

  // Empty → nothing has been scored yet OR no active variant picked.
  if (!taxonomy) {
    return (
      <Surface density="comfortable">
        <WidgetTitle
          eyebrow="Independent variables"
          title={cfg.title ?? "Decomposition"}
          subtitle="Waiting for taxonomy to be inferred"
        />
        <WidgetEmpty>Run intake to infer the experiment taxonomy.</WidgetEmpty>
      </Surface>
    );
  }

  const slots = taxonomy.slots ?? [];
  const slotById = new Map<string, ExperimentVariantSlot>();
  if (variant) {
    for (const s of variant.slots ?? []) {
      slotById.set(s.slot_id, s);
    }
  }

  const artifactNoun = taxonomy.artifact_noun || "artifact";
  const variantLabel = variant?.label ?? "No active variant";

  return (
    <Surface density="comfortable" accent="#1a7aff">
      <WidgetTitle
        eyebrow={`${artifactNoun.toUpperCase()} · INDEPENDENT VARIABLES`}
        title={cfg.title ?? `Decomposed ${artifactNoun}`}
        subtitle={
          variant
            ? `Active ${taxonomy.variant_noun}: ${variantLabel}`
            : `No active ${taxonomy.variant_noun}`
        }
        rightSlot={
          variant?.short_id ? (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-gray-600">
              {variant.short_id}
            </span>
          ) : undefined
        }
      />

      {slots.length === 0 ? (
        <WidgetEmpty>
          Taxonomy has no slots yet — inferrer is still thinking.
        </WidgetEmpty>
      ) : (
        <div
          className={cn(
            "grid gap-3",
            cfg.dense
              ? "grid-cols-2 sm:grid-cols-3"
              : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
          )}
        >
          {slots.map((slot) => (
            <SlotCell
              key={slot.id}
              slot={slot}
              row={slotById.get(slot.id)}
              dense={cfg.dense}
              hidePreviews={cfg.hidePreviews}
            />
          ))}
        </div>
      )}
    </Surface>
  );
}

// ── Slot cell — one ring + label + value + sparkline ─────────────────

function SlotCell({
  slot,
  row,
  dense,
  hidePreviews,
}: {
  slot: TaxonomySlot;
  row?: ExperimentVariantSlot;
  dense?: boolean;
  hidePreviews?: boolean;
}) {
  const score = clamp01(row?.score ?? 0);
  const lift = row?.lift ?? null;
  const heat = row?.heat ?? null;
  const preview = row?.value_preview ?? null;
  const sparks = (row?.spark_points ?? []).slice(-8);

  return (
    <div
      className="group relative flex flex-col gap-2 rounded-xl border border-gray-200/70 bg-white/70 p-3 backdrop-blur-sm transition-all hover:border-gray-300 hover:shadow-sm"
      style={{
        background: `linear-gradient(180deg, ${slot.color}06 0%, rgba(255,255,255,0.85) 60%)`,
      }}
    >
      {/* Top row — ring + label + heat pip */}
      <div className="flex items-center gap-2.5">
        <SlotRing color={slot.color} value={score} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold tracking-tight text-gray-900">
            {slot.label}
          </div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-gray-500">
            {score > 0 ? (
              <span>{Math.round(score * 100)}%</span>
            ) : (
              <span className="text-gray-400">no score</span>
            )}
            {typeof lift === "number" && lift !== 0 && (
              <span
                className={cn(
                  "font-semibold",
                  lift > 0 ? "text-emerald-600" : "text-rose-500",
                )}
              >
                {lift > 0 ? "+" : ""}
                {Math.round(lift * 100)}%
              </span>
            )}
            {typeof heat === "number" && heat > 0 && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  background: slot.color,
                  opacity: 0.4 + Math.min(0.6, heat),
                }}
                aria-label={`heat ${heat.toFixed(2)}`}
              />
            )}
          </div>
        </div>
      </div>

      {/* Value preview — what's actually in this slot right now */}
      {!dense && !hidePreviews && preview && (
        <div className="line-clamp-2 rounded-lg bg-gray-50/70 px-2 py-1.5 text-[11px] leading-snug text-gray-600">
          {preview}
        </div>
      )}

      {/* Sparkline — tiny history of this slot's score */}
      {!dense && sparks.length >= 2 && (
        <Sparkline points={sparks} color={slot.color} />
      )}
    </div>
  );
}

// ── Ring primitive (local, so we don't bloat the shared Ring) ────────

function SlotRing({ color, value }: { color: string; value: number }) {
  const size = 34;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="flex-shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={`${color}22`}
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 600ms ease-out" }}
      />
    </svg>
  );
}

// ── Sparkline primitive ──────────────────────────────────────────────

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const W = 110;
  const H = 22;
  const pad = 2;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 1);
  const range = max - min || 1;

  const path = points
    .map((p, i) => {
      const x = pad + (i * (W - pad * 2)) / (points.length - 1);
      const y = H - pad - ((p - min) / range) * (H - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
    </svg>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
