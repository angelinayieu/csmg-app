// ── IV Scorer agent (Phase 3 — VP Project report, writer path) ────────
//
// Given a hydrated variant (header row + extracted slot rows) + the
// space's taxonomy, assigns per-slot scores and aggregate scores so
// the decomposed-prompt rings + carousel KPI pills read meaningfully.
//
// Score semantics:
//   • score (0..1)    — per-slot "quality" — is this a strong, clear,
//                       well-targeted fill, or is it generic/weak?
//   • lift (-1..+1)   — estimated contribution of THIS slot to the
//                       variant's overall outcome-axis performance vs
//                       dropping the slot. Signed so negative = drag.
//   • heat (0..1)     — how much this slot is the "load-bearing"
//                       part of the variant. Drives the heatmap dot
//                       under each ring.
//   • spark_points    — 8-point history the widget sparklines. The
//                       scorer appends the NEW score to the tail and
//                       trims to length 8. First pass seeds with
//                       [score] so the sparkline isn't empty.
//
// Aggregate scores on `experiment_variants`:
//   • aggregate_quality — mean of slot scores, weighted by default_weight
//   • aggregate_lift    — sum of slot lifts, in percent
//   • aggregate_tokens  — sum of token_count across active slots
//
// LLM call structure:
//   • One call per variant — 5-6 slots per call, structured output.
//   • temperature: 0.15 — scoring should be stable across reruns so
//     the user doesn't see numbers wobble.
//   • maxTokens: 1500 — scorer returns compact JSON, no prose.

import { llmJSON } from "@/lib/llm";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExperimentTaxonomy,
  ExperimentVariantSlot,
} from "@/types/experiment-taxonomy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface IVScorerInput {
  taxonomy: ExperimentTaxonomy;
  /** The variant under scoring — pass the header row for label/summary. */
  variant: {
    id: string;
    label: string;
    summary: string | null;
    situationKey: string | null;
  };
  /** Hydrated slot rows (from experiment_variant_slots). The scorer
   *  reads value_full + value_preview to judge quality. Slots with
   *  is_active=false are forwarded to the LLM with a "absent" marker
   *  so the scorer can say "low score + negative lift". */
  slots: Array<
    Pick<
      ExperimentVariantSlot,
      "slot_id" | "value_preview" | "value_full" | "is_active" | "spark_points" | "score"
    >
  >;
}

export interface IVScorerSlotResult {
  slotId: string;
  score: number;      // 0..1
  lift: number;       // -1..+1 (stored as ratio; widget formats as %)
  heat: number;       // 0..1
  rationale: string;  // ≤ 160 chars — feeds popover tooltip
}

export interface IVScorerResult {
  slots: IVScorerSlotResult[];
  /** Self-reported confidence on the scoring decisions themselves. */
  confidence: number;
}

// ── Prompt construction ──────────────────────────────────────────────

function buildSystemPrompt(taxonomy: ExperimentTaxonomy): string {
  const axes = taxonomy.outcome_axes
    .map(
      (a) =>
        `  - ${a.key} (${a.label}) — ${a.higher_is_better ? "higher is better" : "lower is better"}`,
    )
    .join("\n");
  return `You are a scoring agent for a ${taxonomy.domain_key} experiment. Given ONE ${taxonomy.variant_noun} and its per-slot fills, you judge how strong each slot is and how much it contributes to the variant's performance on the outcome axes.

OUTCOME AXES for this domain:
${axes}

Per-slot dimensions you must return:
- score (0..1): is this fill strong, specific, well-targeted?
  0.9+ only for fills that are concrete and verifiably different from a generic version.
  0.5-0.8 for solid but generic fills.
  <0.5 for vague, missing, or off-topic fills.
- lift (-1..+1): estimated CONTRIBUTION of this slot to the variant's overall outcome-axis performance vs. a version with this slot blanked.
  Positive = including the slot makes the artifact work better on the higher-is-better axes.
  Negative = the slot is dragging the artifact down (e.g., too restrictive, too verbose).
- heat (0..1): how load-bearing is this slot — is the whole variant riding on this one piece?
  1.0 = if this slot disappeared, the variant collapses.
  0.5 = meaningful but not critical.
  0.1 = cosmetic / decorative.

Tonally: be calibrated, not generous. Most slots should land 0.4-0.7. Reserve 0.9+ for genuine standout fills.

Return ONLY valid JSON:
{
  "slots": [
    { "slotId": string, "score": number, "lift": number, "heat": number, "rationale": string }
  ],
  "confidence": number
}`;
}

function buildUserPrompt(input: IVScorerInput): string {
  const slotBlock = input.slots
    .map((s) => {
      const taxSlot = input.taxonomy.slots.find((t) => t.id === s.slot_id);
      const label = taxSlot?.label ?? s.slot_id;
      const body = s.is_active
        ? s.value_full && s.value_full.length > 0
          ? s.value_full.slice(0, 600)
          : s.value_preview ?? "(no content)"
        : "(SLOT ABSENT — not present on this variant)";
      return `SLOT "${label}" (id: ${s.slot_id})\n${body}`;
    })
    .join("\n\n---\n\n");

  return `VARIANT: ${input.variant.label}
${input.variant.summary ? `SUMMARY: ${input.variant.summary}\n` : ""}${
    input.variant.situationKey
      ? `SITUATION: ${input.variant.situationKey}\n`
      : ""
  }
FILLS:
${slotBlock}

Score each slot following the rubric.`;
}

function validateResult(
  raw: unknown,
  input: IVScorerInput,
): IVScorerResult {
  if (!raw || typeof raw !== "object") throw new Error("not an object");
  const r = raw as Record<string, unknown>;
  const slots = Array.isArray(r.slots) ? r.slots : [];
  if (slots.length === 0) throw new Error("no slots scored");

  const validSlotIds = new Set(input.slots.map((s) => s.slot_id));
  const parsed: IVScorerSlotResult[] = [];
  const seen = new Set<string>();
  for (const s of slots) {
    if (!s || typeof s !== "object") continue;
    const so = s as Record<string, unknown>;
    if (typeof so.slotId !== "string") continue;
    if (!validSlotIds.has(so.slotId)) continue;
    if (seen.has(so.slotId)) continue;
    seen.add(so.slotId);
    parsed.push({
      slotId: so.slotId,
      score: clamp(numOr(so.score, 0.5), 0, 1),
      lift: clamp(numOr(so.lift, 0), -1, 1),
      heat: clamp(numOr(so.heat, 0.4), 0, 1),
      rationale:
        typeof so.rationale === "string"
          ? so.rationale.trim().slice(0, 200)
          : "",
    });
  }
  if (parsed.length === 0) {
    throw new Error("no valid slot scores");
  }
  return {
    slots: parsed,
    confidence:
      typeof r.confidence === "number" ? clamp(r.confidence, 0, 1) : 0.6,
  };
}

// ── Public entry ─────────────────────────────────────────────────────

/**
 * Score one variant's slots. Always resolves; never throws.
 *
 * Empty `slots` + confidence:0 means the scorer couldn't produce a
 * usable result — caller should leave existing scores untouched.
 */
export async function runIVScorer(
  input: IVScorerInput,
): Promise<IVScorerResult> {
  // Quick skip if there are literally no slots to score.
  if (input.slots.length === 0) {
    return { slots: [], confidence: 0 };
  }
  try {
    return await llmJSON<IVScorerResult>({
      system: buildSystemPrompt(input.taxonomy),
      user: buildUserPrompt(input),
      maxTokens: 1500,
      temperature: 0.15,
      validator: (raw) => validateResult(raw, input),
      fallback: { slots: [], confidence: 0 },
    });
  } catch (err) {
    console.warn("[iv-scorer] scoring failed:", err);
    return { slots: [], confidence: 0 };
  }
}

// ── Persistence ──────────────────────────────────────────────────────

/**
 * Persist per-slot scores + the aggregate summary onto the variant.
 *
 * Scoring writes:
 *   - experiment_variant_slots: score, lift, heat, spark_points (+1 tail)
 *   - experiment_variants: aggregate_quality, aggregate_lift,
 *                          aggregate_tokens, usage_count++
 *
 * The aggregates are computed from the scorer's OWN output joined
 * against the existing slot rows (for token_count + default_weight),
 * so we don't do a second roundtrip to read the updated slots back.
 *
 * Returns true on success (even partial — aggregate_* may be null if
 * the joined read failed); false only on catastrophic throw.
 */
export async function persistScoring(
  db: AnyDb,
  variantId: string,
  result: IVScorerResult,
  taxonomy: ExperimentTaxonomy,
  /**
   * When provided, after the LLM-scored write lands we try to compute a
   * REAL MC lift for this variant by resolving a (lever, target) pair
   * from the variant's parent app and running `simulateVariantLift`
   * twice (baseline + perturbed). If it succeeds, the MC number
   * OVERWRITES the LLM self-rating in `aggregate_lift` and
   * `score_provenance` flips from "llm_review" to "mc_lift".
   *
   * Omit to keep the legacy LLM-only behavior (honest llm_review tag).
   */
  spaceId?: string,
): Promise<boolean> {
  if (result.slots.length === 0) return true;

  try {
    // Fetch existing slot rows so we can append to spark_points and
    // read token_count for the aggregate token sum. One round-trip.
    const { data: existing } = await db
      .from("experiment_variant_slots")
      .select("slot_id, score, token_count, spark_points, is_active")
      .eq("variant_id", variantId);
    const existingMap = new Map<
      string,
      {
        slot_id: string;
        score: number | null;
        token_count: number | null;
        spark_points: unknown;
        is_active: boolean;
      }
    >();
    for (const row of (existing ?? []) as Array<{
      slot_id: string;
      score: number | null;
      token_count: number | null;
      spark_points: unknown;
      is_active: boolean;
    }>) {
      existingMap.set(row.slot_id, row);
    }

    // Upsert slot scores.
    const slotRows = result.slots.map((s) => {
      const prior = existingMap.get(s.slotId);
      const priorSparks = Array.isArray(prior?.spark_points)
        ? (prior!.spark_points as number[])
        : [];
      const nextSparks = [...priorSparks, s.score].slice(-8);
      return {
        variant_id: variantId,
        slot_id: s.slotId,
        score: s.score,
        lift: s.lift,
        heat: s.heat,
        spark_points: nextSparks,
        iterations_touching: ((prior as unknown) as { iterations_touching?: number })?.iterations_touching
          ? ((prior as unknown) as { iterations_touching?: number }).iterations_touching! + 1
          : 1,
      };
    });

    const { error: slotErr } = await db
      .from("experiment_variant_slots")
      .upsert(slotRows, { onConflict: "variant_id,slot_id" });
    if (slotErr) {
      console.warn("[iv-scorer] slot upsert failed:", slotErr);
      return false;
    }

    // Compute aggregates, weighted by taxonomy.slots[*].default_weight
    // when the schema declares one; otherwise equal-weight.
    const slotWeight = new Map<string, number>();
    for (const t of taxonomy.slots) {
      slotWeight.set(t.id, typeof t.default_weight === "number" ? t.default_weight : 1);
    }
    let wSum = 0;
    let wAcc = 0;
    let liftSum = 0;
    for (const s of result.slots) {
      const w = slotWeight.get(s.slotId) ?? 1;
      wAcc += s.score * w;
      wSum += w;
      liftSum += s.lift;
    }
    const aggregateQuality = wSum > 0 ? wAcc / wSum : null;
    // Lift is percent-ish — store the mean (not the sum) scaled up 100×
    // so 0.12 lift across 5 slots → 12%. Matches the OutcomePill
    // `format: "percent"` convention on the carousel.
    const aggregateLift =
      result.slots.length > 0
        ? (liftSum / result.slots.length) * 100
        : null;

    // Token aggregate: sum of token_count across ACTIVE slots only.
    // We include existing tokens (set by variant-factory / iv-extractor
    // at fill time) because the scorer doesn't rewrite text.
    let tokenSum = 0;
    for (const s of result.slots) {
      const row = existingMap.get(s.slotId);
      if (row && row.is_active && typeof row.token_count === "number") {
        tokenSum += row.token_count;
      }
    }
    const aggregateTokens = tokenSum > 0 ? tokenSum : null;

    const { error: varErr } = await db
      .from("experiment_variants")
      .update({
        aggregate_quality: aggregateQuality,
        aggregate_lift: aggregateLift,
        aggregate_tokens: aggregateTokens,
        // Provenance — honest tag so the UI can disclose that these
        // numbers come from an LLM self-rating (this agent) rather than
        // a Monte Carlo lift computation. When a future MC-backed lift
        // lands it should write 'mc_lift' here instead. See
        // supabase/migrations/20260531_score_provenance.sql.
        score_provenance: "llm_review",
      })
      .eq("id", variantId);
    if (varErr) {
      console.warn("[iv-scorer] aggregate update failed:", varErr);
      // Slots persisted; aggregates missing. UI renders slot rings fine,
      // just no KPI pill numbers. Acceptable partial success.
      return true;
    }

    // ── MC-backed aggregate_lift upgrade (R1) ──────────────────────
    //
    // At this point the LLM-rated aggregate_lift + score_provenance=
    // "llm_review" are persisted. If the caller gave us a spaceId,
    // attempt the Tier 1 → Tier 4 bridge:
    //
    //   1. Resolve a (lever, target) pair from the variant's parent
    //      app's dominant_entity_ids[]. Requires ≥2 distinct entities
    //      with a causal path between them.
    //   2. Run `simulateVariantLift` — two real MC passes (baseline +
    //      perturbed), same seed.
    //   3. Overwrite aggregate_lift with the structural lift the MC
    //      computed, flip score_provenance to "mc_lift".
    //
    // When ANY step fails (no app_id, fewer than 2 dominant entities,
    // no path from lever to target, MC engine errored) we leave the
    // LLM-review values in place — the `llm_review` tag stays honest
    // and the UI's ✎ badge still discloses that. No fake mc_lift
    // values ever persisted.
    if (spaceId) {
      try {
        const { data: variantMeta } = await db
          .from("experiment_variants")
          .select("app_id")
          .eq("id", variantId)
          .maybeSingle();
        const appId = (variantMeta as { app_id?: string | null } | null)
          ?.app_id;
        if (appId) {
          const { resolveVariantLeverTarget } = await import(
            "@/lib/simulation/variant-lever-resolver"
          );
          const pair = await resolveVariantLeverTarget(db, {
            spaceId,
            appId,
          });
          if (pair) {
            const { simulateVariantLift } = await import(
              "@/lib/simulation/simulate-variant-lift"
            );
            // Perturbation magnitude scales with variant quality — a
            // higher-scoring variant represents a stronger, more
            // specific intervention. Clamped into [0.25, 1.0] so even a
            // low-quality variant tests a meaningful counterfactual
            // and a high-quality one doesn't saturate the engine.
            const quality =
              typeof aggregateQuality === "number" &&
              Number.isFinite(aggregateQuality)
                ? aggregateQuality
                : 0.5;
            const magnitude = Math.max(0.25, Math.min(1.0, 0.25 + 0.75 * quality));
            const mcResult = await simulateVariantLift(db, {
              spaceId,
              leverEntityId: pair.leverEntityId,
              targetEntityId: pair.targetEntityId,
              perturbationMagnitude: magnitude,
              iterations: 400,
            });
            if (mcResult.error === null) {
              // Present as a percent number (the aggregate_lift column
              // already uses "% vs baseline" convention per
              // 20260422_experiment_taxonomies.sql:124). liftPct is
              // [-3, +3] in sigma-equivalent units; multiply by 100 so
              // the carousel's formatter still reads naturally.
              const mcLiftPct = mcResult.liftPct * 100;
              const { error: mcUpdateErr } = await db
                .from("experiment_variants")
                .update({
                  aggregate_lift: mcLiftPct,
                  score_provenance: "mc_lift",
                })
                .eq("id", variantId);
              if (mcUpdateErr) {
                console.warn(
                  "[iv-scorer] MC lift persist failed (keeping LLM review):",
                  mcUpdateErr,
                );
              } else {
                console.log(
                  `[iv-scorer] Variant ${variantId}: MC lift ${mcLiftPct.toFixed(2)}% (baseline p50 ${mcResult.baseline.p50.toFixed(3)}, variant p50 ${mcResult.variant.p50.toFixed(3)}, Δ=${magnitude.toFixed(2)}, ${mcResult.sampleCount} samples; lever=${pair.leverEntityId.slice(0, 8)} target=${pair.targetEntityId.slice(0, 8)})`,
                );
              }
            } else {
              console.log(
                `[iv-scorer] Variant ${variantId}: MC lift skipped — ${mcResult.error}. Keeping LLM review.`,
              );
            }
          } else {
            // No mappable lever/target — honest keep of LLM review.
            // Not logged at WARN because this is common for
            // well-formed runs whose apps have only one dominant entity.
          }
        }
      } catch (mcErr) {
        console.warn(
          "[iv-scorer] MC lift upgrade threw (keeping LLM review):",
          mcErr,
        );
      }
    }

    return true;
  } catch (err) {
    console.warn("[iv-scorer] persist threw:", err);
    return false;
  }
}

// ── Champion picker ──────────────────────────────────────────────────

/**
 * After scoring a batch of variants, choose ONE champion per
 * situation_key and set its is_active=true.
 *
 * Strategy:
 *   • Group variants by situation_key.
 *   • Within each group, pick the variant with the highest
 *     aggregate_quality (ties: lowest aggregate_tokens).
 *   • Set its is_active=true; reset is_active=false on every other
 *     variant in the same group.
 *
 * The partial unique index
 * `uq_experiment_variants_active_per_situation` enforces at most one
 * active per situation — this helper keeps us on the right side of
 * that invariant across re-runs.
 *
 * Returns the count of variants flipped to active.
 */
export async function pickChampions(
  db: AnyDb,
  spaceId: string,
): Promise<number> {
  try {
    const { data: rows } = await db
      .from("experiment_variants")
      .select(
        "id, situation_key, aggregate_quality, aggregate_tokens, is_active",
      )
      .eq("space_id", spaceId);
    const variants = (rows ?? []) as Array<{
      id: string;
      situation_key: string | null;
      aggregate_quality: number | null;
      aggregate_tokens: number | null;
      is_active: boolean;
    }>;
    if (variants.length === 0) return 0;

    const groups = new Map<string, typeof variants>();
    for (const v of variants) {
      const key = v.situation_key ?? "__space__";
      const list = groups.get(key) ?? [];
      list.push(v);
      groups.set(key, list);
    }

    let activations = 0;
    for (const [, list] of groups) {
      list.sort((a, b) => {
        const qa = a.aggregate_quality ?? 0;
        const qb = b.aggregate_quality ?? 0;
        if (qb !== qa) return qb - qa;
        const ta = a.aggregate_tokens ?? Number.POSITIVE_INFINITY;
        const tb = b.aggregate_tokens ?? Number.POSITIVE_INFINITY;
        return ta - tb;
      });
      const [champion, ...losers] = list;
      if (!champion) continue;

      // Only write when state would actually change — avoids churning
      // updated_at on every run.
      if (!champion.is_active) {
        // First clear losers in the same situation to avoid conflicting
        // with the partial unique index mid-update.
        for (const l of losers) {
          if (l.is_active) {
            await db
              .from("experiment_variants")
              .update({ is_active: false })
              .eq("id", l.id);
          }
        }
        await db
          .from("experiment_variants")
          .update({ is_active: true })
          .eq("id", champion.id);
        activations++;
      } else {
        // Champion already active — still clear any stale losers.
        for (const l of losers) {
          if (l.is_active) {
            await db
              .from("experiment_variants")
              .update({ is_active: false })
              .eq("id", l.id);
          }
        }
      }
    }
    return activations;
  } catch (err) {
    console.warn("[iv-scorer] champion pick threw:", err);
    return 0;
  }
}

// ── helpers ──────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function numOr(v: unknown, fallback: number): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return Number(v);
  return fallback;
}
