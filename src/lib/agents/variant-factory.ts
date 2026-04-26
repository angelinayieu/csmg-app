// ── Variant Factory agent (Phase 3 — VP Project report, writer path) ──
//
// Given:
//   • the space's ExperimentTaxonomy (slot schema + status vocab)
//   • the user's original input text
//   • optional top entity names / situation hints from the KG
//
// Produces 3-5 complete VARIANT configurations, one per "situation"
// the LLM identifies in the input. Each variant is:
//   • a named flashcard (label, summary, accent)
//   • a full content payload for every slot in the taxonomy
//
// The content gets persisted as one `experiment_variants` row +
// N `experiment_variant_slots` rows (N = slot count). Aggregate
// scores are left null — the `iv_scorer` agent fills those in on
// the next step.
//
// Why a single LLM call produces ALL variants in one pass rather
// than spawning one call per variant:
//   • The model writes better variants when it sees the siblings it
//     needs to differ from. "Exhaustive vs concise vs persona-led"
//     is a comparative judgement — asking for it sequentially yields
//     variants that drift toward the same shape.
//   • One 4k-token structured call is cheaper than 4x 1k calls and
//     crucially stays inside a single context window.
//
// Runtime contract:
//   • Soft-fail: returns an empty array on any error. The caller
//     treats "zero variants" as "skip the writer path this run".
//   • Token budget: 3500 max — rich enough for 4 variants × 5 slots
//     × ~120-char preview + full text. Validator trims if we get
//     more.
//   • Temperature: 0.55 — variants must feel DIFFERENT, so we dial
//     up diversity vs the taxonomy inferrer's 0.25.

import { llmJSON } from "@/lib/llm";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExperimentTaxonomy } from "@/types/experiment-taxonomy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface VariantFactoryInput {
  /** Canonical taxonomy for the space. Slots + statuses come from here. */
  taxonomy: ExperimentTaxonomy;
  /** Raw user input text — the primary signal for what to vary. */
  inputText: string;
  /** Optional: top 3-6 entity names from the KG, used to ground variants
   *  in the actual actors/factors the decomposer identified. */
  topEntityNames?: string[];
  /** Optional: if provided, the generated variants hang off this App
   *  (one intervention-cluster). When omitted, variants live at the
   *  space level (the champion template lane). */
  appId?: string | null;
  /** How many variants to generate. Hard-capped [2, 6]. Default 4. */
  variantCount?: number;
}

export interface VariantDraft {
  /** Card label — short, distinct. Must differ across the batch. */
  label: string;
  /** 1-line summary shown on the flashcard body. ≤ 140 chars. */
  summary: string;
  /** Taxonomy status key — must match one of
   *  taxonomy.status_vocabulary[].key. */
  status: string;
  /** Hex accent color for the card spine. Defaults to taxonomy-accent
   *  if missing. */
  accent: string;
  /** Loose situation tag — "pharma-patients", "retail-shoppers",
   *  "enterprise-users". Snake_case ASCII. Used by the partial
   *  unique index on (space, situation_key, is_active). Can be
   *  null for space-wide champion. */
  situationKey: string | null;
  /** Per-slot content. One entry per taxonomy.slots[*]. */
  slotFills: Array<{
    slotId: string;
    preview: string; // ≤ 120 chars teaser
    full: string;    // full content, no ceiling but reasonable
  }>;
}

export interface VariantFactoryResult {
  variants: VariantDraft[];
  confidence: number; // self-assessed 0..1
  note: string | null; // optional model-side hint (skipped situations etc.)
}

// ── Prompt construction ──────────────────────────────────────────────

function buildSystemPrompt(taxonomy: ExperimentTaxonomy): string {
  const slotLines = taxonomy.slots
    .slice()
    .sort((a, b) => a.ordering - b.ordering)
    .map(
      (s) => `  - ${s.id} ("${s.label}"): ${s.description ?? s.label}`,
    )
    .join("\n");
  const statusLines = taxonomy.status_vocabulary
    .map((s) => `  - ${s.key} (${s.label})`)
    .join("\n");

  return `You are a writer-path agent generating experiment VARIANTS for a ${taxonomy.domain_key} experiment.

DOMAIN: ${taxonomy.domain_key}
WE CALL THE ARTIFACT A: ${taxonomy.artifact_noun}
WE CALL EACH VARIANT A: ${taxonomy.variant_noun}

SLOTS (the independent variables — each variant fills ALL of these):
${slotLines}

LIFECYCLE STATUSES (pick one per variant; one must be primary/winning):
${statusLines}

Your job: produce 3-5 DISTINCT ${taxonomy.variant_noun}s that cover different situations the user might face. Each variant is a complete, usable ${taxonomy.artifact_noun} — not a fragment.

Rules:
- Variants must MEANINGFULLY DIFFER. Not cosmetic rewording — different strategic bets.
- Each variant is grounded in the USER INPUT. Don't invent new domains.
- Fill EVERY slot on EVERY variant. Missing slots confuse the UI.
- Each variant needs a situationKey (lowercase_snake_case tag) or null for "space-wide champion". Use null sparingly — at most ONE variant per batch.
- preview is ≤ 120 chars, imperative voice. full is the real content an operator would use.
- label is 2-5 words, distinct across the batch.
- summary is 1 line, ≤ 140 chars, describes the strategic bet.
- accent is a hex color. Pick differently for each card to help the carousel.

Return ONLY valid JSON:
{
  "variants": [
    {
      "label": string,
      "summary": string,
      "status": string (must match a lifecycle key above),
      "accent": string (hex),
      "situationKey": string|null,
      "slotFills": [
        { "slotId": string (must match a slot id), "preview": string, "full": string }
      ]
    }
  ],
  "confidence": number (0..1),
  "note": string|null
}`;
}

function buildUserPrompt(input: VariantFactoryInput): string {
  const entityBlock =
    input.topEntityNames && input.topEntityNames.length > 0
      ? `\nTOP ENTITIES FROM THE KG:\n${input.topEntityNames
          .slice(0, 6)
          .map((e) => `- ${e}`)
          .join("\n")}\n`
      : "";
  const count = clamp(input.variantCount ?? 4, 2, 6);
  return `USER INPUT:
${input.inputText.slice(0, 2400)}
${entityBlock}
Generate ${count} distinct variants following the rules above.`;
}

function validateResult(
  raw: unknown,
  taxonomy: ExperimentTaxonomy,
): VariantFactoryResult {
  if (!raw || typeof raw !== "object") throw new Error("not an object");
  const r = raw as Record<string, unknown>;
  const variants = Array.isArray(r.variants) ? r.variants : [];
  if (variants.length === 0) throw new Error("no variants returned");

  const validSlotIds = new Set(taxonomy.slots.map((s) => s.id));
  const validStatusKeys = new Set(
    taxonomy.status_vocabulary.map((s) => s.key),
  );
  // Fallback status if the model hallucinates — the first primary, else
  // the first status in the vocab.
  const fallbackStatus =
    taxonomy.status_vocabulary.find((s) => s.role === "primary")?.key ??
    taxonomy.status_vocabulary[0]?.key ??
    "CANDIDATE";

  const parsed: VariantDraft[] = [];
  for (const v of variants.slice(0, 6)) {
    if (!v || typeof v !== "object") continue;
    const vo = v as Record<string, unknown>;
    const label = typeof vo.label === "string" ? vo.label.trim() : "";
    if (!label) continue;

    const fills = Array.isArray(vo.slotFills) ? vo.slotFills : [];
    const slotFills: VariantDraft["slotFills"] = [];
    for (const f of fills) {
      if (!f || typeof f !== "object") continue;
      const fo = f as Record<string, unknown>;
      if (typeof fo.slotId !== "string") continue;
      if (!validSlotIds.has(fo.slotId)) continue;
      slotFills.push({
        slotId: fo.slotId,
        preview: trimTo(
          typeof fo.preview === "string" ? fo.preview : "",
          120,
        ),
        full: typeof fo.full === "string" ? fo.full : "",
      });
    }
    // Require at least half the slots filled to call this a real variant.
    if (slotFills.length < Math.ceil(taxonomy.slots.length / 2)) continue;

    const status =
      typeof vo.status === "string" && validStatusKeys.has(vo.status)
        ? vo.status
        : fallbackStatus;
    const accent =
      typeof vo.accent === "string" && /^#[0-9a-fA-F]{3,8}$/.test(vo.accent)
        ? vo.accent
        : "#1a7aff";
    const situationKey =
      typeof vo.situationKey === "string" && vo.situationKey.trim().length > 0
        ? vo.situationKey.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40)
        : null;

    parsed.push({
      label: label.slice(0, 80),
      summary: trimTo(typeof vo.summary === "string" ? vo.summary : "", 180),
      status,
      accent,
      situationKey,
      slotFills,
    });
  }

  if (parsed.length === 0) throw new Error("no valid variants after parsing");

  // Enforce: at most one null situationKey (space-wide champion).
  let seenNullSituation = false;
  for (const v of parsed) {
    if (v.situationKey === null) {
      if (seenNullSituation) {
        v.situationKey = `variant_${parsed.indexOf(v) + 1}`;
      }
      seenNullSituation = true;
    }
  }

  return {
    variants: parsed,
    confidence: typeof r.confidence === "number" ? clamp(r.confidence, 0, 1) : 0.65,
    note: typeof r.note === "string" ? r.note.slice(0, 240) : null,
  };
}

// ── Public entry ─────────────────────────────────────────────────────

/**
 * Generate variant drafts. Always resolves; never throws.
 *
 * Returns an empty list on any failure (LLM error, validation, etc.)
 * so the caller can treat it as "skip variant persistence this run"
 * without special-case error handling.
 */
export async function runVariantFactory(
  input: VariantFactoryInput,
): Promise<VariantFactoryResult> {
  try {
    const result = await llmJSON<VariantFactoryResult>({
      system: buildSystemPrompt(input.taxonomy),
      user: buildUserPrompt(input),
      maxTokens: 3500,
      temperature: 0.55,
      validator: (raw) => validateResult(raw, input.taxonomy),
      fallback: { variants: [], confidence: 0, note: "fallback" },
    });
    return result;
  } catch (err) {
    console.warn("[variant-factory] generation failed:", err);
    return { variants: [], confidence: 0, note: "error" };
  }
}

// ── Persistence helper ───────────────────────────────────────────────

export interface PersistedVariant {
  variantId: string;
  shortId: string;
  label: string;
  accent: string;
  status: string;
  summary: string | null;
  situationKey: string | null;
}

/**
 * Persist a batch of variant drafts. Each draft becomes one
 * `experiment_variants` row + N `experiment_variant_slots` rows.
 *
 * Returns the persisted rows' card-header metadata so the caller can
 * emit `variant_proposed` structural events keyed on the real DB ids.
 *
 * Soft-fail: a failure on one variant does not prevent the others
 * from being persisted. Failed rows are simply omitted from the
 * return array.
 */
export async function persistVariants(
  db: AnyDb,
  spaceId: string,
  appId: string | null,
  drafts: VariantDraft[],
): Promise<PersistedVariant[]> {
  const out: PersistedVariant[] = [];

  // Count existing variants for short_id numbering ("V-3", "V-4").
  let startingIndex = 1;
  try {
    const { count } = await db
      .from("experiment_variants")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId);
    if (typeof count === "number") startingIndex = count + 1;
  } catch {
    /* non-fatal — fall back to 1-based */
  }

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const shortId = `V-${startingIndex + i}`;
    try {
      // Insert the variant header row.
      const { data: inserted, error: insErr } = await db
        .from("experiment_variants")
        .insert({
          space_id: spaceId,
          app_id: appId,
          label: draft.label,
          accent_color: draft.accent,
          status: draft.status,
          summary: draft.summary,
          short_id: shortId,
          signature: computeSignature(draft),
          aggregate_quality: null,
          aggregate_lift: null,
          aggregate_tokens: null,
          usage_count: 0,
          is_active: false, // activation happens on user action or by iv_scorer champion-pick
          situation_key: draft.situationKey,
        })
        .select("id")
        .single();

      if (insErr || !inserted) {
        console.warn("[variant-factory] insert variant failed:", insErr);
        continue;
      }

      const variantId = (inserted as { id: string }).id;

      // Insert slot rows in one go.
      if (draft.slotFills.length > 0) {
        const slotRows = draft.slotFills.map((sf) => ({
          variant_id: variantId,
          slot_id: sf.slotId,
          value_preview: sf.preview,
          value_full: sf.full,
          score: null,
          lift: null,
          token_count: estimateTokens(sf.full),
          iterations_touching: 0,
          heat: null,
          proposal_count: 0,
          spark_points: [],
          is_active: true,
        }));
        const { error: slotErr } = await db
          .from("experiment_variant_slots")
          .insert(slotRows);
        if (slotErr) {
          console.warn(
            "[variant-factory] slot insert failed (variant persisted):",
            slotErr,
          );
        }
      }

      out.push({
        variantId,
        shortId,
        label: draft.label,
        accent: draft.accent,
        status: draft.status,
        summary: draft.summary || null,
        situationKey: draft.situationKey,
      });
    } catch (err) {
      console.warn("[variant-factory] persist row threw:", err);
    }
  }

  return out;
}

// ── helpers ──────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function trimTo(s: string, max: number): string {
  const clean = s.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}

function computeSignature(draft: VariantDraft): string {
  // Cheap stable signature — ordered slot fills concatenated.
  const flat = draft.slotFills
    .slice()
    .sort((a, b) => a.slotId.localeCompare(b.slotId))
    .map((s) => `${s.slotId}=${s.full.slice(0, 160)}`)
    .join("||");
  return hashString(`${draft.label}::${flat}`);
}

function hashString(s: string): string {
  // FNV-1a 32-bit — not cryptographic, just needs to be stable +
  // cheap enough to call on every variant write.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h >>> 0) * 0x01000193;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function estimateTokens(s: string): number {
  // Rough ~4 chars/token — good enough for the carousel's "Tokens" pill
  // pre-scoring. The iv_scorer overwrites this with a real count.
  if (!s) return 0;
  return Math.ceil(s.length / 4);
}
