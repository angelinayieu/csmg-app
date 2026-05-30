// ── Data Unit Registry ────────────────────────────────────────────
//
// A typed semantic ontology for the data tokens that flow between
// mechanism steps (the `produces` / `consumes` arrays on
// `MechanismRuntimeStep`). Replaces free-text string matching with
// a registered vocabulary scoped to ONE space.
//
// Why this exists:
//
//   Today, the LLM emits `produces: ["attention_units"]` on one
//   step and `consumes: ["attention_signals"]` on another. The
//   downstream renderers and the depends_on derivation match by
//   exact string → these never connect even though they refer to
//   the same thing. The macro data-flow view is left disjoint, the
//   brief's cross-feature flow is uncalibrated, and the user sees
//   broken edges.
//
//   This registry IS the substrate that makes everything else work:
//
//     • the per-mechanism DAG can wire steps that use synonyms,
//     • the AgentBuildSpec's cross-feature flow can be derived
//       from typed tokens (not LLM-asserted),
//     • the chat row can name the data unit ("Spec'd Pomodoro Timer
//       — produces 2 attention metrics, consumes user_goal"),
//     • the brief can render a "base data unit lineage" section.
//
// Why a NEW file:
//
//   The current `enrich-mechanism-spec.ts` is flagged parallel-owned
//   in SYSTEMS_WIRING_MASTER_PLAN.md. The pure helpers in this
//   module are import-only — any parallel session can pick them up
//   without merge conflict, and the minimal wiring point (one prompt
//   concat in enrich-mechanism-spec.ts) is a 3-line change that
//   composes cleanly.
//
// Persistence:
//
//   Lives on `spaces.synthesis_data.data_unit_registry` (JSONB,
//   no migration). Mirrors the pattern established by the rest of
//   the synthesis_data subkeys (objective_canvas.layers,
//   includeUi, enableResearch, etc.).
//
// Reference:
//   • INTAKE_TO_BRIEF_SURFACING_PLAN.md (the why)
//   • SYSTEMS_WIRING_MASTER_PLAN.md §A (base-unit data-flow gap)
//   • MECHANISM_EXPERIENCE_SPEC.md §2e (concept_slug stub —
//     conceptually related but scoped to mechanism identity,
//     not to data units)

/** A semantically-grounded data token. The slug is the machine ID
 *  used in produces[]/consumes[]; everything else is for the
 *  surfaces (chat row, brief section, macro view). */
export interface DataUnit {
  /** Canonical machine ID. snake_case, ≤40 chars. The string the
   *  LLM emits in `runtime_flow[].produces`/`consumes`. */
  slug: string;
  /** Human-readable display name. Surfaces in chat + brief. */
  name: string;
  /** One-sentence definition — what this unit IS, semantically. */
  description: string;
  /** Coarse type. Drives icon + grouping in surfaces:
   *    • event    — a discrete occurrence ("focus_session_started")
   *    • metric   — a measurable scalar/time-series ("attention_score")
   *    • state    — a persistent property ("active_goal")
   *    • signal   — a derived flag/level ("distraction_risk")
   *    • artifact — a generated object/document ("session_summary") */
  kind: "event" | "metric" | "state" | "signal" | "artifact";
  /** Measurement unit, when the unit is a metric. Free-text
   *  ("minutes/day", "score 0-1", "events/hour"). Null for non-metrics. */
  units: string | null;
  /** Alternative names users / LLMs might use. Soft-match aliases
   *  the fuzzy lookup tolerates ("attention_units" → "attention_score"). */
  aliases: string[];
  /** Optional binding to the macro stack — which abstraction layer
   *  this unit lives at (L1–L4 ordinal). Lets the macro data-flow
   *  view band units by layer. Null when unbound. */
  layer_ordinal: number | null;
  /** Provenance — useful for debugging + the audit trail. */
  origin: "system" | "user" | "llm";
  /** ISO 8601 — when the unit was first registered in this space. */
  registered_at: string;
}

/** The per-space registry. Keyed by slug for O(1) canonical lookup;
 *  alias resolution scans the values. The shape is JSONB-stable
 *  (no Maps, no Sets) for safe Supabase round-trips. */
export interface SpaceDataUnitRegistry {
  /** Slug → DataUnit. */
  units: Record<string, DataUnit>;
  /** ISO 8601 — last mutation timestamp. */
  updated_at: string;
}

// ─── Construction / empty ────────────────────────────────────────

export function emptyRegistry(): SpaceDataUnitRegistry {
  return {
    units: {},
    updated_at: new Date().toISOString(),
  };
}

/** Tolerate the JSONB column being null OR an old-shape object.
 *  Returns a usable registry no matter what's in the row. */
export function normalizeRegistry(raw: unknown): SpaceDataUnitRegistry {
  if (!raw || typeof raw !== "object") return emptyRegistry();
  const obj = raw as Record<string, unknown>;
  const units =
    obj.units && typeof obj.units === "object" && !Array.isArray(obj.units)
      ? (obj.units as Record<string, unknown>)
      : {};
  const cleanUnits: Record<string, DataUnit> = {};
  for (const [slug, u] of Object.entries(units)) {
    if (!u || typeof u !== "object") continue;
    const cleaned = sanitizeUnit(slug, u as Record<string, unknown>);
    if (cleaned) cleanUnits[cleaned.slug] = cleaned;
  }
  return {
    units: cleanUnits,
    updated_at:
      typeof obj.updated_at === "string"
        ? obj.updated_at
        : new Date().toISOString(),
  };
}

function sanitizeUnit(
  slugHint: string,
  raw: Record<string, unknown>,
): DataUnit | null {
  const slug = sanitizeSlug(
    typeof raw.slug === "string" ? raw.slug : slugHint,
  );
  if (!slug) return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : slug;
  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";
  const kindRaw = typeof raw.kind === "string" ? raw.kind : "";
  const kind: DataUnit["kind"] = (
    ["event", "metric", "state", "signal", "artifact"] as const
  ).includes(kindRaw as DataUnit["kind"])
    ? (kindRaw as DataUnit["kind"])
    : "state";
  const units =
    typeof raw.units === "string" && raw.units.trim().length > 0
      ? raw.units.trim()
      : null;
  const aliases = Array.isArray(raw.aliases)
    ? (raw.aliases as unknown[])
        .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
        .map((a) => sanitizeSlug(a))
        .filter((a): a is string => a.length > 0)
    : [];
  const layer_ordinal =
    typeof raw.layer_ordinal === "number" && Number.isFinite(raw.layer_ordinal)
      ? raw.layer_ordinal
      : null;
  const originRaw = typeof raw.origin === "string" ? raw.origin : "";
  const origin: DataUnit["origin"] = (
    ["system", "user", "llm"] as const
  ).includes(originRaw as DataUnit["origin"])
    ? (originRaw as DataUnit["origin"])
    : "llm";
  const registered_at =
    typeof raw.registered_at === "string"
      ? raw.registered_at
      : new Date().toISOString();
  return {
    slug,
    name,
    description,
    kind,
    units,
    aliases,
    layer_ordinal,
    origin,
    registered_at,
  };
}

/** Normalize a raw token string into a valid slug. snake_case,
 *  alphanumerics + underscore only, capped at 40 chars. */
export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_\s-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// ─── Lookup ──────────────────────────────────────────────────────

/** Canonical lookup by slug. Returns null when not found. */
export function lookupUnit(
  registry: SpaceDataUnitRegistry,
  slug: string,
): DataUnit | null {
  const cleaned = sanitizeSlug(slug);
  if (!cleaned) return null;
  return registry.units[cleaned] ?? null;
}

/** Find a unit by name / alias (case-insensitive substring match,
 *  prefer exact slug match). Returns the best candidate or null.
 *
 *  Used when the LLM emits a token that doesn't exactly match an
 *  existing slug — "attention_signal" should resolve to
 *  "attention_score" via the aliases list. */
export function fuzzyMatchUnit(
  registry: SpaceDataUnitRegistry,
  query: string,
): DataUnit | null {
  const slug = sanitizeSlug(query);
  if (!slug) return null;

  // Pass 1: exact slug.
  const direct = registry.units[slug];
  if (direct) return direct;

  // Pass 2: alias hit.
  for (const u of Object.values(registry.units)) {
    if (u.aliases.includes(slug)) return u;
  }

  // Pass 3: token-level fuzzy. Split on _ and compare overlap.
  const queryTokens = new Set(slug.split("_").filter((t) => t.length > 1));
  if (queryTokens.size === 0) return null;
  let best: { unit: DataUnit; score: number } | null = null;
  for (const u of Object.values(registry.units)) {
    const candidateTokens = new Set(
      [u.slug, u.name.toLowerCase(), ...u.aliases]
        .join("_")
        .split(/[_\s]/)
        .filter((t) => t.length > 1),
    );
    let overlap = 0;
    for (const t of queryTokens) if (candidateTokens.has(t)) overlap += 1;
    const score = overlap / queryTokens.size;
    if (score >= 0.6 && (best === null || score > best.score)) {
      best = { unit: u, score };
    }
  }
  return best?.unit ?? null;
}

// ─── Registration / mutation ─────────────────────────────────────

export interface RegisterUnitInput {
  slug?: string;
  name: string;
  description?: string;
  kind?: DataUnit["kind"];
  units?: string | null;
  aliases?: string[];
  layer_ordinal?: number | null;
  origin?: DataUnit["origin"];
}

/** Pure: add or overwrite a unit. Returns a NEW registry; callers
 *  decide whether to persist. */
export function registerUnit(
  registry: SpaceDataUnitRegistry,
  input: RegisterUnitInput,
): SpaceDataUnitRegistry {
  const slug = sanitizeSlug(input.slug ?? input.name);
  if (!slug) return registry;
  const existing = registry.units[slug];
  const next: DataUnit = {
    slug,
    name: input.name.trim() || slug,
    description: (input.description ?? existing?.description ?? "").trim(),
    kind: input.kind ?? existing?.kind ?? "state",
    units: input.units ?? existing?.units ?? null,
    aliases: dedupe(
      (input.aliases ?? []).concat(existing?.aliases ?? []).map(sanitizeSlug),
    ).filter((a) => a.length > 0 && a !== slug),
    layer_ordinal: input.layer_ordinal ?? existing?.layer_ordinal ?? null,
    origin: input.origin ?? existing?.origin ?? "llm",
    registered_at: existing?.registered_at ?? new Date().toISOString(),
  };
  return {
    units: { ...registry.units, [slug]: next },
    updated_at: new Date().toISOString(),
  };
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// ─── Token validation (the substrate for the macro DAG) ──────────

export interface TokenValidationResult {
  /** Tokens that resolved to an existing slug — either directly or
   *  via fuzzy match. The .resolved field is the canonical slug. */
  registered: Array<{ raw: string; resolved: string }>;
  /** Tokens that didn't match anything. Candidates for
   *  auto-registration in a soft-fail pass. */
  novel: string[];
}

/** Resolve a `produces`/`consumes` array against the registry.
 *  Pure — does not mutate the registry. The caller decides whether
 *  to call `registerUnit` for the novel ones. */
export function validateTokens(
  registry: SpaceDataUnitRegistry,
  tokens: string[],
): TokenValidationResult {
  const registered: TokenValidationResult["registered"] = [];
  const novel: string[] = [];
  for (const raw of tokens) {
    const hit = fuzzyMatchUnit(registry, raw);
    if (hit) {
      registered.push({ raw, resolved: hit.slug });
    } else {
      const slug = sanitizeSlug(raw);
      if (slug) novel.push(slug);
    }
  }
  return { registered, novel };
}

// ─── Prompt context — the bridge into the LLM ────────────────────

/** Build a compact prompt block listing the registry's units so the
 *  generator's LLM picks from registered slugs before inventing new
 *  tokens. Capped at `limit` units to keep the system message small.
 *
 *  Returns "" when the registry is empty so the generator falls back
 *  to free-text token emission gracefully. */
export function buildRegistryPromptContext(
  registry: SpaceDataUnitRegistry,
  limit = 40,
): string {
  const units = Object.values(registry.units).slice(0, limit);
  if (units.length === 0) return "";
  const lines = units.map((u) => {
    const aliasFrag =
      u.aliases.length > 0 ? ` (aliases: ${u.aliases.join(", ")})` : "";
    const unitFrag = u.units ? ` [${u.units}]` : "";
    return `  • ${u.slug}${unitFrag} — ${u.kind}: ${u.description.slice(0, 120) || u.name}${aliasFrag}`;
  });
  return [
    "── DATA UNIT REGISTRY (use these slugs for runtime_flow produces/consumes when applicable) ──",
    "",
    "When a step's produces or consumes refers to a concept already in this registry,",
    "USE THE REGISTERED SLUG — do not invent a synonym. Coining new units is fine when",
    "the concept genuinely doesn't fit any registered unit; otherwise reuse.",
    "",
    ...lines,
    "",
    "── END REGISTRY ──",
    "",
  ].join("\n");
}

// ─── Persistence (DB helpers) ────────────────────────────────────

/** Load the registry off `spaces.synthesis_data.data_unit_registry`.
 *  Returns an empty registry on any failure / missing data. Never
 *  throws — registry is enrichment, not a hard dependency. */
export async function loadRegistry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
): Promise<SpaceDataUnitRegistry> {
  try {
    const { data, error } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    if (error || !data) return emptyRegistry();
    const synth =
      data.synthesis_data && typeof data.synthesis_data === "object"
        ? (data.synthesis_data as Record<string, unknown>)
        : {};
    return normalizeRegistry(synth.data_unit_registry);
  } catch (err) {
    console.warn(
      "[data-unit-registry] load failed (returning empty):",
      err instanceof Error ? err.message : String(err),
    );
    return emptyRegistry();
  }
}

/** Persist the registry back to `spaces.synthesis_data.data_unit_registry`.
 *  Merges into the existing synthesis_data blob so other JSONB
 *  subkeys (includeUi, enableResearch, objective_canvas.layers, etc.)
 *  are preserved. Soft-fails. */
export async function saveRegistry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  registry: SpaceDataUnitRegistry,
): Promise<void> {
  try {
    const { data } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const prior =
      data?.synthesis_data && typeof data.synthesis_data === "object"
        ? (data.synthesis_data as Record<string, unknown>)
        : {};
    const next = { ...prior, data_unit_registry: registry };
    const writeRes = await db
      .from("spaces")
      .update({ synthesis_data: next })
      .eq("id", spaceId);
    if (writeRes.error) {
      console.warn(
        "[data-unit-registry] save failed:",
        writeRes.error.message,
      );
    }
  } catch (err) {
    console.warn(
      "[data-unit-registry] save threw:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
