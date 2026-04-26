"use client";

// ── Downstream Reality widget (VP Project — "what happens when") ────────
//
// Heatmap of variants × latent outcome dimensions. Rows = variants
// (ordered champion-first, then by aggregate_quality). Columns =
// latent variables discovered by the latent_variable_finder agent
// (e.g., "specificity", "emotional_tone"). Cells show the
// 0..1 score + an on-hover evidence tooltip.
//
// This is NOT a rehash of the iv_decomposition widget — that one
// shows how the active variant decomposes into its taxonomy slots.
// This widget shows how the WHOLE variant landscape differentiates
// across dimensions that were only visible AFTER materialization.
//
// Data source: `downstream_reality` resolver returns a pre-joined
// DownstreamReality shape (latent_variables[] + scores_by_variant
// map). The widget does zero joining at render time.

import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import type {
  ExperimentTaxonomy,
  ExperimentVariant,
} from "@/types/experiment-taxonomy";
import type {
  DownstreamReality,
  LatentVariable,
  VariantOutcomeScore,
} from "@/types/variant-outcomes";
import { Surface, WidgetTitle, WidgetEmpty } from "./shared";
import { cn } from "@/lib/utils";

interface DownstreamRealityConfig {
  title?: string;
  /** Cap on how many variants to render as rows. Default 8. */
  maxVariants?: number;
}

export function DownstreamReality({
  instance,
  context,
}: WidgetComponentProps<DownstreamRealityConfig>) {
  const cfg = instance.config ?? {};
  const realityRes = context.resolve<DownstreamReality>(
    instance.bindings?.reality,
  );
  const variantsRes = context.resolve<ExperimentVariant[]>(
    instance.bindings?.variants,
  );
  const taxonomyRes = context.resolve<ExperimentTaxonomy>(
    instance.bindings?.taxonomy,
  );

  const reality = realityRes.value ?? null;
  const allVariants = variantsRes.value ?? [];
  const taxonomy = taxonomyRes.value ?? null;

  const latents = reality?.latent_variables ?? [];
  const scoresByVariant = reality?.scores_by_variant ?? {};

  // Empty states — distinguish between "no variants yet" (writer-path
  // hasn't run) and "variants exist but finder produced nothing".
  if (!taxonomy || allVariants.length < 2) {
    return (
      <Surface density="comfortable">
        <WidgetTitle
          eyebrow="Downstream reality"
          title={cfg.title ?? "Variant landscape"}
        />
        <WidgetEmpty>
          At least two variants are needed before the finder can
          identify dimensions that differentiate them.
        </WidgetEmpty>
      </Surface>
    );
  }

  if (latents.length === 0) {
    return (
      <Surface density="comfortable">
        <WidgetTitle
          eyebrow="Downstream reality"
          title={cfg.title ?? "Variant landscape"}
        />
        <WidgetEmpty>
          No latent dimensions discovered yet. The writer path runs
          the finder after scoring; check back after the next run.
        </WidgetEmpty>
      </Surface>
    );
  }

  // Sort variants champion-first, then by aggregate_quality desc.
  // Cap at cfg.maxVariants so the heatmap doesn't balloon on spaces
  // with dozens of variants.
  const maxRows = cfg.maxVariants ?? 8;
  const sortedVariants = [...allVariants]
    .sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      const qa = a.aggregate_quality ?? 0;
      const qb = b.aggregate_quality ?? 0;
      return qb - qa;
    })
    .slice(0, maxRows);

  return (
    <Surface density="comfortable">
      <WidgetTitle
        eyebrow="Downstream reality"
        title={cfg.title ?? "Variant landscape"}
        subtitle={`${sortedVariants.length} ${taxonomy.variant_noun}s × ${latents.length} discovered dimensions`}
      />
      <div className="mt-3 overflow-x-auto">
        <div
          className="grid gap-1.5"
          style={{
            gridTemplateColumns: `minmax(148px, 1.4fr) repeat(${latents.length}, minmax(80px, 1fr))`,
          }}
        >
          {/* Header row — corner + one cell per latent */}
          <div />
          {latents.map((l) => (
            <LatentHeaderCell key={l.id} latent={l} />
          ))}

          {/* Data rows */}
          {sortedVariants.map((v) => (
            <VariantRow
              key={v.id}
              variant={v}
              latents={latents}
              scores={scoresByVariant[v.id] ?? {}}
            />
          ))}
        </div>
      </div>
    </Surface>
  );
}

// ── Header cell ─────────────────────────────────────────────────────

function LatentHeaderCell({ latent }: { latent: LatentVariable }) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-center"
      style={{
        background: `${latent.color}12`,
        border: `1px solid ${latent.color}33`,
      }}
      title={latent.description}
    >
      <div
        className="truncate text-[10px] font-bold uppercase tracking-wider"
        style={{ color: latent.color }}
      >
        {latent.label}
      </div>
      {latent.confidence != null && latent.confidence < 0.6 && (
        <div className="text-[9px] font-semibold text-amber-600">
          ⚠ low conf.
        </div>
      )}
    </div>
  );
}

// ── Data row ────────────────────────────────────────────────────────

function VariantRow({
  variant,
  latents,
  scores,
}: {
  variant: ExperimentVariant;
  latents: LatentVariable[];
  scores: Record<string, VariantOutcomeScore>;
}) {
  return (
    <>
      {/* Row header — variant spine */}
      <div className="flex min-w-0 items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5">
        <span
          className="inline-block h-6 w-1 flex-shrink-0 rounded-sm"
          style={{ background: variant.accent_color }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {variant.short_id ?? "V-?"}
            </span>
            {variant.is_active && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
                style={{
                  background: `${variant.accent_color}22`,
                  color: variant.accent_color,
                }}
              >
                champion
              </span>
            )}
          </div>
          <div className="truncate text-xs font-semibold text-slate-900">
            {variant.label}
          </div>
        </div>
      </div>
      {/* Cells */}
      {latents.map((l) => (
        <HeatCell
          key={l.id}
          latent={l}
          scoreRow={scores[l.id] ?? null}
        />
      ))}
    </>
  );
}

// ── Cell ────────────────────────────────────────────────────────────

function HeatCell({
  latent,
  scoreRow,
}: {
  latent: LatentVariable;
  scoreRow: VariantOutcomeScore | null;
}) {
  if (!scoreRow) {
    return (
      <div className="flex items-center justify-center rounded-md bg-slate-50 text-[10px] text-slate-400">
        —
      </div>
    );
  }

  // Map 0..1 score → alpha 0.12..0.96 on the latent's accent.
  const alpha = Math.round((0.12 + scoreRow.score * 0.84) * 255)
    .toString(16)
    .padStart(2, "0");
  const bg = `${latent.color}${alpha}`;
  const pct = Math.round(scoreRow.score * 100);
  // Text color: flip to white above 55% so the score stays readable
  // against the darker cell.
  const textClass = scoreRow.score >= 0.55 ? "text-white" : "text-slate-900";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-md px-1.5 py-1.5 text-center",
        textClass,
      )}
      style={{ background: bg }}
      title={scoreRow.evidence ?? `${latent.label}: ${pct}%`}
    >
      <span className="text-sm font-bold tabular-nums leading-none">
        {pct}
      </span>
      {scoreRow.evidence && (
        <span className="mt-0.5 line-clamp-1 text-[9px] font-medium opacity-80">
          {truncate(scoreRow.evidence, 28)}
        </span>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
