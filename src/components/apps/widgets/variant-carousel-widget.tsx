"use client";

// ── Variant Carousel widget (VP Project "variation flashcards") ──────
//
// Coverflow of experiment variants. Each card is one complete IV
// configuration for one situation (prompt variant for one niche,
// recipe version for one cuisine, routine version for one lifestyle
// …). The active card surfaces front-and-center; siblings drift in
// 3D back and to the side with reduced opacity + scale.
//
// Reads:
//   • variants   — ExperimentVariant[] (aggregate-scored, status-tagged)
//   • taxonomy   — ExperimentTaxonomy  (status colors, outcome axes, nouns)
//
// Actions (dispatched via context.dispatch):
//   • activate_variant({ variantId })   — mark one as active; carousel scrolls
//   • focus_variant({ variantId })      — zoom a single card (navigates to App)
//
// This is the middle band of the Report layout — between the IV
// decomposition hero above and the downstream-reality band below.
// The report regenerates from the same resolver snapshot so the
// frozen report matches the live app exactly.

import { useMemo, useState } from "react";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import type {
  ExperimentTaxonomy,
  ExperimentVariant,
  TaxonomyOutcomeAxis,
  TaxonomyStatus,
} from "@/types/experiment-taxonomy";
import { Surface, WidgetTitle, WidgetEmpty } from "./shared";
import { cn } from "@/lib/utils";

interface VariantCarouselConfig {
  /** Optional card title override. */
  title?: string;
  /** Max visible cards on each side of the active one. Default 2. */
  visibleWings?: number;
  /** Hide the outcome pills (useful for compact layouts). */
  hideOutcomes?: boolean;
}

export function VariantCarousel({
  instance,
  context,
}: WidgetComponentProps<VariantCarouselConfig>) {
  const cfg = instance.config ?? {};
  const variantsRes = context.resolve<ExperimentVariant[]>(
    instance.bindings?.variants,
  );
  const taxonomyRes = context.resolve<ExperimentTaxonomy>(
    instance.bindings?.taxonomy,
  );

  const variants = useMemo(
    () =>
      Array.isArray(variantsRes.value)
        ? variantsRes.value
            .slice()
            .sort((a, b) => {
              // Active always first; then by aggregate_quality desc.
              if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
              const qa = a.aggregate_quality ?? 0;
              const qb = b.aggregate_quality ?? 0;
              return qb - qa;
            })
        : [],
    [variantsRes.value],
  );

  const taxonomy = taxonomyRes.value ?? null;

  // Index of the card centered in the coverflow.
  const initialIdx = Math.max(
    0,
    variants.findIndex((v) => v.is_active),
  );
  const [cursor, setCursor] = useState<number>(
    initialIdx >= 0 ? initialIdx : 0,
  );

  // Resync cursor if variants list changes beneath us.
  const safeCursor = Math.min(cursor, Math.max(0, variants.length - 1));

  const statusByKey = useMemo(() => {
    const map = new Map<string, TaxonomyStatus>();
    for (const s of taxonomy?.status_vocabulary ?? []) map.set(s.key, s);
    return map;
  }, [taxonomy]);

  const outcomeAxes = taxonomy?.outcome_axes ?? [];
  const variantNoun = taxonomy?.variant_noun ?? "variant";
  const situationNoun = taxonomy?.situation_noun ?? "situation";

  if (variants.length === 0) {
    return (
      <Surface density="comfortable">
        <WidgetTitle
          eyebrow={`${variantNoun.toUpperCase()} CAROUSEL`}
          title={cfg.title ?? "Variants"}
          subtitle={`No ${variantNoun}s yet`}
        />
        <WidgetEmpty>
          Variants appear as the writer-path agents produce and score them.
        </WidgetEmpty>
      </Surface>
    );
  }

  const wings = Math.max(1, cfg.visibleWings ?? 2);

  function activate(variantId: string) {
    // "activate" action key (local to this widget's ActionBinding map).
    // If the manifest doesn't declare it, dispatch no-ops silently.
    void context.dispatch(instance.id, "activate", { variantId });
  }

  function focus(variantId: string) {
    // "focus" action key — typically wired to a focus_entity-style binding
    // that navigates the app shell to a variant detail view.
    void context.dispatch(instance.id, "focus", { variantId });
  }

  return (
    <Surface density="comfortable" accent="#8a56cc">
      <WidgetTitle
        eyebrow={`${variantNoun.toUpperCase()} CAROUSEL`}
        title={cfg.title ?? `${capitalize(variantNoun)} flashcards`}
        subtitle={
          variants.length === 1
            ? `1 ${variantNoun}`
            : `${variants.length} ${variantNoun}s across ${countSituations(
                variants,
              )} ${situationNoun}s`
        }
        rightSlot={
          <div className="flex items-center gap-1">
            <NavBtn
              dir="prev"
              disabled={safeCursor <= 0}
              onClick={() => setCursor((c) => Math.max(0, c - 1))}
            />
            <NavBtn
              dir="next"
              disabled={safeCursor >= variants.length - 1}
              onClick={() =>
                setCursor((c) => Math.min(variants.length - 1, c + 1))
              }
            />
          </div>
        }
      />

      {/* Coverflow stage */}
      <div className="relative mx-auto flex min-h-[200px] w-full items-center justify-center overflow-hidden py-4">
        <div
          className="relative flex items-center justify-center"
          style={{ perspective: 1200 }}
        >
          {variants.map((v, i) => {
            const delta = i - safeCursor;
            const dist = Math.abs(delta);
            if (dist > wings) return null;

            const status = statusByKey.get(v.status);
            const isCenter = delta === 0;

            // 3D stacking: each wing shifts by ~140px + rotates ±18°.
            const translateX = delta * 140;
            const rotateY = delta * -18;
            const scale = 1 - dist * 0.08;
            const opacity = 1 - dist * 0.28;

            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  if (isCenter) {
                    focus(v.id);
                  } else {
                    setCursor(i);
                  }
                }}
                onDoubleClick={() => activate(v.id)}
                className={cn(
                  "absolute cursor-pointer rounded-2xl border bg-white/90 text-left shadow-[0_10px_30px_-10px_rgba(15,23,42,0.25)] transition-all duration-500 ease-out",
                  isCenter
                    ? "border-gray-300/80 ring-1 ring-black/5"
                    : "border-gray-200/60",
                )}
                style={{
                  width: 260,
                  transform: `translateX(${translateX}px) rotateY(${rotateY}deg) scale(${scale})`,
                  transformStyle: "preserve-3d",
                  zIndex: 100 - dist,
                  opacity,
                }}
              >
                <FlashCardBody
                  variant={v}
                  status={status}
                  outcomeAxes={outcomeAxes}
                  hideOutcomes={cfg.hideOutcomes}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Caption — click hints */}
      <div className="mt-2 text-center text-[10.5px] text-gray-400">
        Click a card to focus · double-click to activate
      </div>
    </Surface>
  );
}

// ── Card body ────────────────────────────────────────────────────────

function FlashCardBody({
  variant,
  status,
  outcomeAxes,
  hideOutcomes,
}: {
  variant: ExperimentVariant;
  status?: TaxonomyStatus;
  outcomeAxes: TaxonomyOutcomeAxis[];
  hideOutcomes?: boolean;
}) {
  const accent = variant.accent_color ?? status?.accent ?? "#1a7aff";

  return (
    <div className="flex flex-col gap-2.5 p-4">
      {/* Spine: status pill + short_id */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white"
          style={{
            background: status?.accent ?? "#7a8698",
            boxShadow: `0 0 0 3px ${status?.accent ?? "#7a8698"}22`,
          }}
        >
          {status?.label ?? variant.status}
        </span>
        {variant.short_id && (
          <span className="font-mono text-[10.5px] font-semibold text-gray-500">
            {variant.short_id}
          </span>
        )}
      </div>

      {/* Accent bar */}
      <div
        className="h-[3px] w-full rounded-full"
        style={{
          background: `linear-gradient(90deg, ${accent}, ${accent}00)`,
        }}
      />

      {/* Label */}
      <div className="text-[14px] font-semibold tracking-tight text-gray-900">
        {variant.label}
      </div>

      {/* Situation chip */}
      {variant.situation_key && (
        <div className="text-[11px] text-gray-500">
          <span className="font-medium text-gray-700">Situation:</span>{" "}
          {variant.situation_key}
        </div>
      )}

      {/* Summary */}
      {variant.summary && (
        <div className="line-clamp-3 text-[11.5px] leading-snug text-gray-600">
          {variant.summary}
        </div>
      )}

      {/* Outcome pills */}
      {!hideOutcomes && outcomeAxes.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {outcomeAxes.slice(0, 3).map((axis) => (
            <OutcomePill key={axis.key} axis={axis} variant={variant} />
          ))}
        </div>
      )}

      {variant.is_active && (
        <div
          className="absolute -top-2 -right-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-white shadow-md"
          style={{ letterSpacing: "0.1em" }}
        >
          Active
        </div>
      )}
    </div>
  );
}

// ── Outcome pill — one KPI reading from the aggregate columns ────────

function OutcomePill({
  axis,
  variant,
}: {
  axis: TaxonomyOutcomeAxis;
  variant: ExperimentVariant;
}) {
  const raw = readAxisValue(variant, axis.key);
  if (raw == null) return null;

  const formatted = formatByAxis(raw, axis);
  // color: green if higher_is_better and above .5, rose if below
  const good = axis.higher_is_better ? raw >= 0.5 : raw <= 0.5;
  const tone = good
    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
    : "bg-rose-50 text-rose-700 border-rose-100";

  // Provenance disclosure — when we're showing a lift/quality score
  // that came from iv-scorer LLM self-rating, show a subtle ✎ icon
  // so the user doesn't confuse "LLM reviewer score" with "real MC
  // lift". Only applies to score-derived axes (quality/lift); axes
  // like tokens/cost don't have provenance. See migration
  // 20260531_score_provenance.sql.
  const isScoreAxis = axis.key === "quality" || axis.key === "lift";
  const prov = variant.score_provenance ?? "llm_review";
  const showProvenance = isScoreAxis;
  const provTitle =
    prov === "mc_lift"
      ? "Monte Carlo lift — p50 delta vs baseline"
      : prov === "hybrid"
        ? "Hybrid — LLM review blended with MC lift"
        : "LLM reviewer score — not sample-derived";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold",
        tone,
      )}
      title={showProvenance ? provTitle : undefined}
    >
      {showProvenance && (
        <span
          className="inline-flex h-3 w-3 items-center justify-center rounded-sm text-[9px]"
          style={{
            background:
              prov === "llm_review"
                ? "rgba(217,119,6,0.16)"
                : "rgba(37,99,235,0.16)",
            color: prov === "llm_review" ? "#b45309" : "#2563eb",
          }}
          aria-label={provTitle}
        >
          {prov === "llm_review" ? "✎" : "⚡"}
        </span>
      )}
      {axis.label}:{" "}
      {prov === "llm_review" && axis.key === "lift" ? "~" : ""}
      {formatted}
    </span>
  );
}

function readAxisValue(
  variant: ExperimentVariant,
  key: string,
): number | null {
  if (key === "quality") return variant.aggregate_quality;
  if (key === "lift") return variant.aggregate_lift;
  if (key === "tokens" || key === "cost") return variant.aggregate_tokens;
  return null;
}

function formatByAxis(n: number, axis: TaxonomyOutcomeAxis): string {
  const fmt = axis.format ?? "ratio";
  if (fmt === "percent") return `${Math.round(n * 100)}%`;
  if (fmt === "ratio") return n.toFixed(2);
  if (fmt === "currency")
    return `$${n >= 1000 ? (n / 1000).toFixed(1) + "K" : n.toFixed(2)}`;
  if (fmt === "count") {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return Math.round(n).toLocaleString();
  }
  if (fmt === "duration") return `${Math.round(n)}s`;
  return String(n);
}

// ── Nav button ───────────────────────────────────────────────────────

function NavBtn({
  dir,
  onClick,
  disabled,
}: {
  dir: "prev" | "next";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous variant" : "Next variant"}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-full border border-gray-200/80 bg-white/90 text-gray-600 transition-all hover:border-gray-300 hover:text-gray-900",
        disabled && "opacity-30",
      )}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path
          d={dir === "prev" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function countSituations(variants: ExperimentVariant[]): number {
  const set = new Set<string>();
  for (const v of variants) {
    if (v.situation_key) set.add(v.situation_key);
  }
  return Math.max(1, set.size);
}
